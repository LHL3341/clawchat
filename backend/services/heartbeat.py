import asyncio
import json
import logging
import random
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from sqlalchemy import select, and_, or_
from database import async_session
from models import Shrimp, Conversation, Message, ConversationStatus, SenderType, HeartbeatLog, Invitation, User, now_beijing
from services.matching import match_score, haversine_km, virtual_bot_coords
from services.agent_chat import generate_agent_reply, generate_opening, parse_handoff_tag
from services.affinity import evaluate_affinity
from services.llm import chat_completion_json
from prompts.memory import get_memory_context, extract_and_update_memory
from prompts.profile import build_shrimp_profile
from services.host_knowledge import get_host_knowledge, format_host_knowledge_context

logger = logging.getLogger("heartbeat")

_last_heartbeat: dict[str, datetime] = {}
_running = False


async def heartbeat_loop():
    """Background heartbeat loop — auto-tick for bots with auto_chat enabled."""
    global _running
    _running = True
    logger.info("Heartbeat engine started (auto-tick ENABLED, interval=30s)")
    while _running:
        await asyncio.sleep(30)
        try:
            await _tick()
        except Exception as e:
            logger.error(f"Heartbeat tick error: {e}")


async def _tick():
    """Auto tick: only process REAL users' shrimps (those linked to a user account).
    Test bots are passive-only — they only reply when messaged via _auto_reply_bot."""
    async with async_session() as db:
        # Get all shrimp IDs that belong to real users
        user_result = await db.execute(select(User.shrimp_id))
        real_shrimp_ids = {row[0] for row in user_result.all()}

        result = await db.execute(
            select(Shrimp).where(
                and_(Shrimp.auto_chat == True, Shrimp.id.in_(real_shrimp_ids))
            )
        )
        shrimps = list(result.scalars().all())

        if not shrimps:
            return

        now = now_beijing()
        for shrimp in shrimps:
            last = _last_heartbeat.get(shrimp.id)
            interval = timedelta(minutes=shrimp.heartbeat_min)
            if last and (now - last) < interval:
                continue
            _last_heartbeat[shrimp.id] = now
            try:
                # Only chat heartbeat (reply to existing conversations), NOT discovery
                await manual_heartbeat(shrimp.id)
            except Exception as e:
                logger.error(f"Heartbeat error for {shrimp.name}: {e}")

            # Drift bottles (probabilistic)
            try:
                if random.random() < 0.20:
                    await bottle_write_heartbeat(shrimp.id)
                if random.random() < 0.30:
                    await bottle_pickup_heartbeat(shrimp.id)
            except Exception as e:
                logger.error(f"Bottle heartbeat error for {shrimp.name}: {e}")

        # Expire old bottles once per tick
        try:
            await expire_old_bottles()
        except Exception as e:
            logger.error(f"Bottle expiry error: {e}")


async def manual_heartbeat(user_shrimp_id: str):
    """
    Chat heartbeat: go through all active conversations, LLM decides per conversation:
    - reply: respond to unread message
    - follow_up: send follow-up if other hasn't replied
    - skip: do nothing
    Returns detailed actions taken.
    """
    async with async_session() as db:
        user = await db.get(Shrimp, user_shrimp_id)
        if not user:
            return {"error": "shrimp not found", "actions": []}

        # Get all active conversations
        result = await db.execute(
            select(Conversation).where(
                and_(
                    or_(
                        Conversation.shrimp_a_id == user_shrimp_id,
                        Conversation.shrimp_b_id == user_shrimp_id,
                    ),
                    Conversation.status == ConversationStatus.active.value,
                )
            )
        )
        convs = list(result.scalars().all())

        if not convs:
            return {"actions": [], "sent": 0}

        actions = []
        sent_count = 0

        for conv in convs:
            # Skip muted conversations
            muted = conv.muted_by or []
            if user_shrimp_id in muted:
                continue

            other_id = conv.shrimp_b_id if conv.shrimp_a_id == user_shrimp_id else conv.shrimp_a_id
            other = await db.get(Shrimp, other_id)
            if not other:
                continue

            # Skip conversations with pending invitations — wait for host to resolve
            pending_inv = await db.execute(
                select(Invitation).where(
                    and_(
                        Invitation.conversation_id == conv.id,
                        Invitation.sender_id == user_shrimp_id,
                        Invitation.status == "pending",
                    )
                )
            )
            if pending_inv.scalar_one_or_none():
                logger.info(f"Skipping {conv.id}: pending invitation for {user.name}")
                actions.append({"conv_id": conv.id, "other": other.name, "action": "skip", "reason": "pending invitation"})
                continue

            # Get recent messages
            result = await db.execute(
                select(Message)
                .where(Message.conversation_id == conv.id)
                .order_by(Message.created_at.desc())
                .limit(10)
            )
            recent = list(reversed(list(result.scalars().all())))

            if not recent:
                continue

            last_msg = recent[-1]

            # Skip if the host is actively chatting — last message was human-sent
            if last_msg.sender_id == user.id and last_msg.sender_type == SenderType.human.value:
                logger.info(f"Skipping {conv.id}: host is active (last msg is human)")
                actions.append({"conv_id": conv.id, "other": other.name, "action": "skip", "reason": "host active"})
                continue

            # Determine situation
            if last_msg.sender_id == user.id:
                situation = f"你发了最后一条消息，{other.name}还没回复。你可以选择追问或者等待。"
            else:
                situation = f"{other.name}发了新消息，你还没回复。"

            # Format history for LLM
            history_text = ""
            for m in recent[-6:]:
                sender_name = user.name if m.sender_id == user.id else other.name
                history_text += f"{sender_name}: {m.content}\n"

            # Ask LLM to decide
            template = _load_template("CHAT_DECIDE.md")
            prompt = (
                template
                .replace("{speaker_name}", user.name)
                .replace("{speaker_profile}", build_shrimp_profile(user))
                .replace("{listener_profile}", build_shrimp_profile(other))
                .replace("{history}", history_text.strip())
                .replace("{situation}", situation)
            )

            decision, raw_output = await chat_completion_json([
                {"role": "system", "content": prompt},
                {"role": "user", "content": "请决定你要做什么，返回JSON。"},
            ], model="gpt-5", return_raw=True)

            action = decision.get("action", "skip")
            reason = decision.get("reason", "")
            hint = decision.get("hint", "")
            logger.info(f"Chat decide: {user.name} -> {other.name}: {action} ({reason})" + (f" hint: {hint}" if hint else ""))

            llm_record = {"input": prompt, "output": raw_output}

            if action == "skip":
                actions.append({"conv_id": conv.id, "other": other.name, "action": "skip", "reason": reason, "llm_decide": llm_record})
                continue

            # reply or follow_up — generate and send message
            try:
                reply_llm = await _reply_in_conversation(db, user, other, conv.id, decide_hint=hint)
                actions.append({"conv_id": conv.id, "other": other.name, "action": action, "reason": reason, "hint": hint, "llm_decide": llm_record, "llm_reply": reply_llm})
                sent_count += 1
            except Exception as e:
                logger.error(f"Reply error for {other.name}: {e}")
                actions.append({"conv_id": conv.id, "other": other.name, "action": "error", "reason": str(e)})

            # Step 2: if we sent a message and the other is a test bot, auto-reply
            if action in ("reply", "follow_up"):
                is_bot = (await db.execute(select(User).where(User.shrimp_id == other.id))).scalar_one_or_none() is None
                if is_bot:
                    try:
                        await _reply_in_conversation(db, other, user, conv.id)
                    except Exception as e:
                        logger.error(f"Auto-reply error for {other.name}: {e}")

        # Write heartbeat log
        reply_count = sum(1 for a in actions if a["action"] in ("reply", "follow_up"))
        skip_count = sum(1 for a in actions if a["action"] == "skip")
        parts = []
        if reply_count:
            parts.append(f"回复了{reply_count}个对话")
        if skip_count:
            parts.append(f"跳过了{skip_count}个")
        summary = "、".join(parts) if parts else "没有需要处理的对话"
        log = HeartbeatLog(
            shrimp_id=user_shrimp_id,
            log_type="chat",
            summary=summary,
            details=json.dumps(actions, ensure_ascii=False),
        )
        db.add(log)
        await db.commit()

        return {"actions": actions, "sent": sent_count}


def _load_template(name: str) -> str:
    path = Path(__file__).parent.parent / "prompts" / "templates" / name
    return path.read_text(encoding="utf-8")


def _load_discover_template() -> str:
    return _load_template("DISCOVER.md")


async def discovery_heartbeat(user_shrimp_id: str, max_distance: float = 50.0, client_ip: str = ""):
    """
    Discovery heartbeat: locate user → analyze nearby strangers → LLM picks → start conversations.
    Returns list of {id, name, reason} for each new conversation started.
    """
    async with async_session() as db:
        user = await db.get(Shrimp, user_shrimp_id)
        if not user:
            return {"error": "shrimp not found", "started": []}

        # Step 1: Auto-locate via IP if available
        located = False
        if client_ip and client_ip not in ("127.0.0.1", "::1", "localhost"):
            try:
                import httpx, os
                proxy = os.environ.get("OUTBOUND_PROXY", "") or None
                # Try ip-api.com first (HTTP, no proxy needed)
                async with httpx.AsyncClient(timeout=5) as hc:
                    resp = await hc.get(f"http://ip-api.com/json/{client_ip}?fields=status,lat,lon,city")
                    data = resp.json()
                    if data.get("status") == "success":
                        user.location_lat = data["lat"]
                        user.location_lng = data["lon"]
                        await db.commit()
                        located = True
                        logger.info(f"Discovery locate: {user.name} -> {data['lat']},{data['lon']} ({data.get('city','')})")
                if not located:
                    async with httpx.AsyncClient(timeout=5, proxy=proxy) as hc:
                        resp = await hc.get(f"https://ipapi.co/{client_ip}/json/")
                        data = resp.json()
                        if data.get("latitude"):
                            user.location_lat = float(data["latitude"])
                            user.location_lng = float(data["longitude"])
                            await db.commit()
                            located = True
                            logger.info(f"Discovery locate (ipapi): {user.name} -> {data['latitude']},{data['longitude']}")
            except Exception as e:
                logger.warning(f"Discovery auto-locate failed: {e}")

        # Get all other shrimps
        result = await db.execute(select(Shrimp).where(Shrimp.id != user_shrimp_id))
        others = list(result.scalars().all())

        # Find which shrimps are bots (no User account)
        user_result = await db.execute(select(User.shrimp_id))
        real_shrimp_ids = {row[0] for row in user_result.all() if row[0]}

        # Filter: within max_distance, and NOT already in conversation
        result = await db.execute(
            select(Conversation).where(
                or_(
                    Conversation.shrimp_a_id == user_shrimp_id,
                    Conversation.shrimp_b_id == user_shrimp_id,
                )
            )
        )
        existing_convs = list(result.scalars().all())
        known_ids = set()
        for c in existing_convs:
            known_ids.add(c.shrimp_a_id if c.shrimp_b_id == user_shrimp_id else c.shrimp_b_id)

        candidates = []
        for other in others:
            if other.id in known_ids:
                continue
            # Bots get virtual coordinates near the querying user
            is_bot = other.id not in real_shrimp_ids
            if is_bot and user.location_lat and user.location_lng:
                olat, olng = virtual_bot_coords(other.id, user.location_lat, user.location_lng)
            else:
                olat, olng = other.location_lat, other.location_lng
            dist = haversine_km(
                user.location_lat, user.location_lng,
                olat, olng,
            )
            if dist > max_distance:
                continue
            candidates.append((other, dist))

        if not candidates:
            # Still write a log so user can see what happened
            log = HeartbeatLog(
                shrimp_id=user_shrimp_id,
                log_type="discovery",
                summary="附近没有新的陌生人",
                details=json.dumps({"candidates_count": 0, "llm": None, "started": []}, ensure_ascii=False),
            )
            db.add(log)
            await db.commit()
            return {"started": [], "message": "附近没有新的陌生人"}

        # Build candidate list for LLM
        candidate_text = ""
        for i, (c, dist) in enumerate(candidates):
            candidate_text += (
                f"\n### 候选人 {i+1}\n"
                f"- ID: {c.id}\n"
                f"- 名字: {c.name}\n"
                f"- 性别: {c.gender}  年龄: {c.age}  MBTI: {c.mbti or '未知'}\n"
                f"- 兴趣: {', '.join(c.interests) if c.interests else '未设置'}\n"
                f"- 性格: {', '.join(c.personality) if c.personality else '未设置'}\n"
                f"- 自我介绍: {c.bio or '无'}\n"
                f"- 社交目标: {c.social_goal or '无'}\n"
                f"- 距离: {dist:.1f} km\n"
            )

        template = _load_discover_template()
        prompt = template.replace("{speaker_name}", user.name)
        prompt = prompt.replace("{speaker_profile}", build_shrimp_profile(user))
        prompt = prompt.replace("{candidates}", candidate_text)

        # Ask LLM to pick
        result_json, raw_output = await chat_completion_json([
            {"role": "system", "content": prompt},
            {"role": "user", "content": "请从候选人中挑选你最想认识的人，返回JSON。"},
        ], return_raw=True)

        picks = result_json.get("picks", [])
        valid_ids = {c.id for c, _ in candidates}

        started = []
        for pick in picks[:3]:  # Max 3
            pick_id = pick.get("id", "")
            reason = pick.get("reason", "")
            if pick_id not in valid_ids:
                continue

            other = await db.get(Shrimp, pick_id)
            if not other:
                continue

            # Create conversation with common ground
            common = pick.get("common", [])
            conv = Conversation(
                shrimp_a_id=user.id,
                shrimp_b_id=other.id,
                topic=json.dumps(common, ensure_ascii=False) if common else "",
            )
            db.add(conv)
            await db.commit()
            await db.refresh(conv)
            logger.info(f"LLM discovery: {user.name} -> {other.name} (reason: {reason})")

            # Generate opening
            memory_ctx = await get_memory_context(db, user.id, other.id)
            hk = await get_host_knowledge(db, user.id)
            hk_ctx = format_host_knowledge_context(hk)
            opening, opening_model = await generate_opening(user, other, memory_context=memory_ctx, host_knowledge_context=hk_ctx, model=user.preferred_model or None)
            if opening.strip():
                msg = Message(
                    conversation_id=conv.id,
                    sender_id=user.id,
                    content=opening,
                    sender_type=SenderType.agent.value,
                    model_used=opening_model,
                )
                db.add(msg)
                await db.commit()
                await _broadcast_msg(conv.id, msg)

                # If the other side is a test bot (no user account), auto-reply
                is_bot = (await db.execute(select(User).where(User.shrimp_id == other.id))).scalar_one_or_none() is None
                if is_bot:
                    try:
                        await _reply_in_conversation(db, other, user, conv.id)
                    except Exception as e:
                        logger.error(f"Bot auto-reply after discovery error: {e}")

            started.append({"id": other.id, "name": other.name, "reason": reason, "conv_id": conv.id, "opening": opening.strip() if opening else "", "common": common})

        # Write heartbeat log
        if started:
            names = "、".join(s["name"] for s in started)
            summary = f"发现了{len(started)}个新虾并打了招呼：{names}"
        else:
            summary = "没有找到感兴趣的陌生人"
        log_details = {
            "candidates_count": len(candidates),
            "llm": {"input": prompt, "output": raw_output},
            "started": started,
        }
        log = HeartbeatLog(
            shrimp_id=user_shrimp_id,
            log_type="discovery",
            summary=summary,
            details=json.dumps(log_details, ensure_ascii=False),
        )
        db.add(log)
        await db.commit()

        return {"started": started}


async def _process_shrimp_all_convs(
    db, shrimp: Shrimp, all_shrimps: list[Shrimp], auto_reply: bool = False
) -> list[tuple[str, str]]:
    """
    Process ALL conversations for a shrimp. Returns list of (conv_id, other_id) where messages were sent.
    No more `break` — covers every conversation.
    """
    others = [s for s in all_shrimps if s.id != shrimp.id]
    if not others:
        return []

    # Score and rank matches
    scored = []
    for other in others:
        dist, interest, combined = match_score(
            shrimp.interests, other.interests,
            shrimp.location_lat, shrimp.location_lng,
            other.location_lat, other.location_lng,
            max_distance=5.0,
        )
        scored.append((other, combined))
    scored.sort(key=lambda x: x[1], reverse=True)

    sent_convs = []

    for other, score in scored:
        if score < 0.1:
            continue

        # Find or create conversation
        result = await db.execute(
            select(Conversation).where(
                or_(
                    and_(Conversation.shrimp_a_id == shrimp.id, Conversation.shrimp_b_id == other.id),
                    and_(Conversation.shrimp_a_id == other.id, Conversation.shrimp_b_id == shrimp.id),
                )
            )
        )
        conv = result.scalar_one_or_none()

        if conv and conv.status == ConversationStatus.ended.value:
            continue

        if not conv:
            # Auto-discover and start conversation
            conv = Conversation(shrimp_a_id=shrimp.id, shrimp_b_id=other.id)
            db.add(conv)
            await db.commit()
            await db.refresh(conv)
            logger.info(f"Auto-started conversation: {shrimp.name} <-> {other.name}")

            opening, opening_model = await generate_opening(shrimp, other)
            if not opening.strip():
                continue
            msg = Message(
                conversation_id=conv.id,
                sender_id=shrimp.id,
                content=opening,
                sender_type=SenderType.agent.value,
                model_used=opening_model,
            )
            db.add(msg)
            await db.commit()
            logger.info(f"{shrimp.name} -> {other.name}: {opening[:60]}")
            await _broadcast_msg(conv.id, msg)
            sent_convs.append((conv.id, other.id))
            continue

        # Existing active conversation
        if conv.status != ConversationStatus.active.value:
            continue

        result = await db.execute(
            select(Message)
            .where(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = result.scalar_one_or_none()

        if not last_msg:
            # Conversation exists but empty — send opening
            opening, opening_model = await generate_opening(shrimp, other)
            if not opening.strip():
                continue
            msg = Message(
                conversation_id=conv.id,
                sender_id=shrimp.id,
                content=opening,
                sender_type=SenderType.agent.value,
                model_used=opening_model,
            )
            db.add(msg)
            await db.commit()
            logger.info(f"{shrimp.name} -> {other.name}: {opening[:60]}")
            await _broadcast_msg(conv.id, msg)
            sent_convs.append((conv.id, other.id))
            continue

        # Already sent last message — skip (don't double-send)
        if last_msg.sender_id == shrimp.id:
            continue

        # Reply to the other's message
        await _reply_in_conversation(db, shrimp, other, conv.id)
        sent_convs.append((conv.id, other.id))

    return sent_convs


async def _reply_in_conversation(db, speaker: Shrimp, listener: Shrimp, conv_id: str, decide_hint: str = "") -> dict | None:
    """Generate and send a reply in an existing conversation. Returns LLM record {input, output} or None."""
    conv = await db.get(Conversation, conv_id)
    if not conv or conv.status != ConversationStatus.active.value:
        return None

    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conv_id)
        .order_by(Message.created_at)
    )
    history = list(result.scalars().all())

    # Gather user instructions for this speaker
    instructions = [
        m.content for m in history
        if m.sender_type == SenderType.instruction.value and m.sender_id == speaker.id
    ]

    # Inject decision hint as instruction if provided
    if decide_hint:
        instructions.append(f"[决策提示] {decide_hint}")

    # Load memory about the listener
    memory_ctx = await get_memory_context(db, speaker.id, listener.id)

    # Load host knowledge for richer context
    hk = await get_host_knowledge(db, speaker.id)
    hk_ctx = format_host_knowledge_context(hk)

    # Load existing handoffs for this conversation to avoid repeats
    inv_result = await db.execute(
        select(Invitation).where(Invitation.conversation_id == conv_id)
    )
    existing_handoffs = [
        f"[{inv.handoff_type}] {inv.content}" for inv in inv_result.scalars().all()
    ] or None

    reply_text, reply_llm = await generate_agent_reply(
        speaker, listener, history,
        instructions[-3:] if instructions else None,
        memory_context=memory_ctx,
        host_knowledge_context=hk_ctx,
        existing_handoffs=existing_handoffs,
        return_raw=True,
        model=speaker.preferred_model or None,
    )
    used_model = reply_llm.get("model", "") if isinstance(reply_llm, dict) else ""
    if not reply_text.strip():
        logger.warning(f"{speaker.name} generated empty reply, skipping")
        return None

    # Parse [HANDOFF: type | desc] tag
    reply_text, handoff_type, handoff_desc = parse_handoff_tag(reply_text)

    # If HANDOFF detected and sender has a real host, BLOCK the reply — store as draft
    is_bot_sender = (await db.execute(select(User).where(User.shrimp_id == speaker.id))).scalar_one_or_none() is None

    if handoff_type and not is_bot_sender:
        # Don't send reply, create handoff with draft for host to review
        inv = Invitation(
            conversation_id=conv_id,
            sender_id=speaker.id,
            receiver_id=listener.id,
            content=handoff_desc or handoff_type,
            handoff_type=handoff_type,
            draft_reply=reply_text,
        )
        db.add(inv)
        await db.commit()
        await db.refresh(inv)
        logger.info(f"HANDOFF blocked: {speaker.name} -> {listener.name}: [{handoff_type}] draft='{reply_text[:60]}'")
        from schemas import InvitationOut
        await _broadcast_event(conv_id, {
            "type": "invitation",
            "data": InvitationOut.model_validate(inv).model_dump(mode="json"),
        })
        return reply_text  # return for logging but message NOT sent

    # Normal send (no handoff, or bot sender auto-resolves)
    reply = Message(
        conversation_id=conv_id,
        sender_id=speaker.id,
        content=reply_text,
        sender_type=SenderType.agent.value,
        model_used=used_model,
    )
    db.add(reply)
    await db.commit()
    await db.refresh(reply)
    logger.info(f"{speaker.name} -> {listener.name}: {reply_text[:60]}")
    await _broadcast_msg(conv_id, reply)

    # Bot sender with handoff: ignore it — the other side's shrimp will detect and trigger HANDOFF for its own host
    # No invitation created for bot senders

    # Periodically: evaluate affinity + extract memory
    msg_count = len(history) + 1
    if msg_count % 5 == 0:
        try:
            # Memory extraction
            await extract_and_update_memory(
                db, speaker.id, listener.id, listener.name, history[-10:]
            )
        except Exception as e:
            logger.error(f"Memory extraction error: {e}")
        try:
            # Affinity evaluation
            shrimp_a = await db.get(Shrimp, conv.shrimp_a_id)
            shrimp_b = await db.get(Shrimp, conv.shrimp_b_id)
            new_aff_a = await evaluate_affinity(shrimp_a, shrimp_b, history[-10:], conv.affinity_a)
            new_aff_b = await evaluate_affinity(shrimp_b, shrimp_a, history[-10:], conv.affinity_b)
            conv.affinity_a = new_aff_a
            conv.affinity_b = new_aff_b
            if new_aff_a < 20 or new_aff_b < 20:
                conv.status = ConversationStatus.ended.value
            await db.commit()
            await _broadcast_event(conv_id, {
                "type": "affinity_update",
                "data": {"affinity_a": new_aff_a, "affinity_b": new_aff_b, "status": conv.status},
            })
        except Exception as e:
            logger.error(f"Affinity eval error: {e}")

    return reply_llm


async def _broadcast_msg(conv_id: str, msg: Message):
    from routers.chat import broadcast
    from schemas import MessageOut
    await broadcast(conv_id, {
        "type": "message",
        "data": MessageOut.model_validate(msg).model_dump(mode="json"),
    })


async def _broadcast_event(conv_id: str, event: dict):
    from routers.chat import broadcast
    await broadcast(conv_id, event)


# ──────────────────── Global Matchmaking ────────────────────

@lru_cache(maxsize=1)
def _load_global_match_template() -> str:
    return (Path(__file__).parent.parent / "prompts" / "templates" / "GLOBAL_MATCH.md").read_text()


async def global_match_heartbeat(user_shrimp_id: str):
    """Global matchmaking: find best personality/interest matches across ALL users."""
    from services.matching import global_match_score

    async with async_session() as db:
        user = await db.get(Shrimp, user_shrimp_id)
        if not user:
            return {"error": "shrimp not found", "started": []}

        # Get all other shrimps
        result = await db.execute(select(Shrimp).where(Shrimp.id != user_shrimp_id))
        others = list(result.scalars().all())

        # Filter out already-known shrimps
        result = await db.execute(
            select(Conversation).where(
                or_(Conversation.shrimp_a_id == user_shrimp_id, Conversation.shrimp_b_id == user_shrimp_id)
            )
        )
        known_ids = set()
        for c in result.scalars().all():
            known_ids.add(c.shrimp_a_id if c.shrimp_b_id == user_shrimp_id else c.shrimp_b_id)

        candidates = []
        for other in others:
            if other.id in known_ids:
                continue
            score, breakdown = global_match_score(user, other)
            candidates.append((other, score, breakdown))

        candidates.sort(key=lambda x: x[1], reverse=True)
        candidates = candidates[:10]

        if not candidates:
            log = HeartbeatLog(
                shrimp_id=user_shrimp_id, log_type="global_match",
                summary="全网没有新的陌生人可匹配",
                details=json.dumps({"candidates_count": 0, "started": []}, ensure_ascii=False),
            )
            db.add(log)
            await db.commit()
            return {"started": [], "message": "全网没有新的陌生人"}

        # Build candidate text
        candidate_text = ""
        for i, (c, score, bd) in enumerate(candidates):
            candidate_text += (
                f"\n### 候选人 {i+1}\n"
                f"- ID: {c.id}\n"
                f"- 名字: {c.name}\n"
                f"- 性别: {c.gender}  年龄: {c.age}  MBTI: {c.mbti or '未知'}\n"
                f"- 兴趣: {', '.join(c.interests) if c.interests else '未设置'}\n"
                f"- 性格: {', '.join(c.personality) if c.personality else '未设置'}\n"
                f"- 聊天风格: {c.chat_style or '无'}\n"
                f"- 社交目标: {c.social_goal or '无'}\n"
                f"- 自我介绍: {c.bio or '无'}\n"
                f"- 匹配分: {score:.2f}\n"
            )

        template = _load_global_match_template()
        prompt = template.replace("{speaker_name}", user.name)
        prompt = prompt.replace("{speaker_profile}", build_shrimp_profile(user))
        prompt = prompt.replace("{candidates}", candidate_text)

        result_json, raw_output = await chat_completion_json([
            {"role": "system", "content": prompt},
            {"role": "user", "content": "请从候选人中挑选你最想认识的人，返回JSON。"},
        ], return_raw=True)

        picks = result_json.get("picks", [])
        valid_ids = {c.id for c, _, _ in candidates}

        started = []
        for pick in picks[:3]:
            pick_id = pick.get("id", "")
            reason = pick.get("reason", "")
            if pick_id not in valid_ids:
                continue
            other = await db.get(Shrimp, pick_id)
            if not other:
                continue

            common = pick.get("common", [])
            conv = Conversation(
                shrimp_a_id=user.id, shrimp_b_id=other.id,
                topic=json.dumps(common, ensure_ascii=False) if common else "",
            )
            db.add(conv)
            await db.commit()
            await db.refresh(conv)
            logger.info(f"Global match: {user.name} -> {other.name} ({reason})")

            memory_ctx = await get_memory_context(db, user.id, other.id)
            hk = await get_host_knowledge(db, user.id)
            hk_ctx = format_host_knowledge_context(hk)
            opening, opening_model = await generate_opening(user, other, memory_context=memory_ctx, host_knowledge_context=hk_ctx, model=user.preferred_model or None)
            if opening.strip():
                msg = Message(
                    conversation_id=conv.id, sender_id=user.id,
                    content=opening, sender_type=SenderType.agent.value, model_used=opening_model,
                )
                db.add(msg)
                await db.commit()
                await _broadcast_msg(conv.id, msg)

                is_bot = (await db.execute(select(User).where(User.shrimp_id == other.id))).scalar_one_or_none() is None
                if is_bot:
                    try:
                        await _reply_in_conversation(db, other, user, conv.id)
                    except Exception as e:
                        logger.error(f"Bot auto-reply after global match error: {e}")

            started.append({"id": other.id, "name": other.name, "reason": reason, "conv_id": conv.id})

        # Log
        summary = f"全网匹配了{len(started)}个新虾" if started else "全网没有找到感兴趣的人"
        log = HeartbeatLog(
            shrimp_id=user_shrimp_id, log_type="global_match",
            summary=summary,
            details=json.dumps({"candidates_count": len(candidates), "llm": {"input": prompt, "output": raw_output}, "started": started}, ensure_ascii=False),
        )
        db.add(log)
        await db.commit()
        return {"started": started}


# ──────────────────── Drift Bottles ────────────────────

@lru_cache(maxsize=1)
def _load_bottle_write_template() -> str:
    return (Path(__file__).parent.parent / "prompts" / "templates" / "BOTTLE_WRITE.md").read_text()


@lru_cache(maxsize=1)
def _load_bottle_decide_template() -> str:
    return (Path(__file__).parent.parent / "prompts" / "templates" / "BOTTLE_DECIDE.md").read_text()


async def bottle_write_heartbeat(user_shrimp_id: str):
    """Shrimp writes a drift bottle and throws it into the global pool."""
    from models import DriftBottle, BottleStatus

    async with async_session() as db:
        user = await db.get(Shrimp, user_shrimp_id)
        if not user:
            return

        # Check: max 1 bottle per day
        today_start = now_beijing().replace(hour=0, minute=0, second=0, microsecond=0)
        existing = await db.execute(
            select(DriftBottle).where(
                and_(DriftBottle.author_id == user_shrimp_id, DriftBottle.created_at >= today_start)
            )
        )
        if existing.scalar_one_or_none():
            return

        # Gather recent topics from conversations
        convs = await db.execute(
            select(Conversation).where(
                and_(
                    or_(Conversation.shrimp_a_id == user_shrimp_id, Conversation.shrimp_b_id == user_shrimp_id),
                    Conversation.status == ConversationStatus.active.value,
                )
            ).limit(3)
        )
        topics = []
        for conv in convs.scalars().all():
            msgs = await db.execute(
                select(Message).where(Message.conversation_id == conv.id)
                .order_by(Message.created_at.desc()).limit(2)
            )
            for m in msgs.scalars().all():
                if m.sender_type != SenderType.instruction.value:
                    topics.append(m.content[:80])

        template = _load_bottle_write_template()
        prompt = template.replace("{speaker_name}", user.name)
        prompt = prompt.replace("{speaker_profile}", build_shrimp_profile(user))
        prompt = prompt.replace("{recent_topics}", "\n".join(f"- {t}" for t in topics) if topics else "（暂无最近话题）")

        result_json = await chat_completion_json([
            {"role": "system", "content": prompt},
            {"role": "user", "content": "请写一个漂流瓶，返回JSON。"},
        ], model=user.preferred_model or None)

        content = result_json.get("content", "").strip()
        mood = result_json.get("mood", "")
        if not content:
            return

        bottle = DriftBottle(
            author_id=user_shrimp_id,
            content=content,
            mood=mood,
            expires_at=now_beijing() + timedelta(days=7),
        )
        db.add(bottle)

        log = HeartbeatLog(
            shrimp_id=user_shrimp_id, log_type="bottle_write",
            summary=f"写了漂流瓶：{content[:30]}...",
            details=json.dumps({"content": content, "mood": mood}, ensure_ascii=False),
        )
        db.add(log)
        await db.commit()
        logger.info(f"Bottle write: {user.name} -> '{content[:40]}'")


async def bottle_pickup_heartbeat(user_shrimp_id: str):
    """Shrimp picks up a random drift bottle from the pool."""
    from models import DriftBottle, BottleStatus
    import random as rng

    async with async_session() as db:
        user = await db.get(Shrimp, user_shrimp_id)
        if not user:
            return

        # Already holding a picked-up bottle? Skip
        holding = await db.execute(
            select(DriftBottle).where(
                and_(DriftBottle.picked_by_id == user_shrimp_id, DriftBottle.status == BottleStatus.picked_up.value)
            )
        )
        if holding.scalar_one_or_none():
            return

        # Query floating bottles not authored by self, not expired
        now = now_beijing()
        result = await db.execute(
            select(DriftBottle).where(
                and_(
                    DriftBottle.author_id != user_shrimp_id,
                    DriftBottle.status == BottleStatus.floating.value,
                    DriftBottle.expires_at > now,
                    DriftBottle.pickup_count < DriftBottle.max_pickups,
                )
            )
        )
        bottles = list(result.scalars().all())
        if not bottles:
            return

        # Random sample up to 5
        sample = rng.sample(bottles, min(5, len(bottles)))

        # Build text for LLM
        bottles_text = ""
        for i, b in enumerate(sample):
            author = await db.get(Shrimp, b.author_id)
            bottles_text += (
                f"\n### 瓶子 {i+1}\n"
                f"- ID: {b.id}\n"
                f"- 内容: {b.content}\n"
                f"- 心情: {b.mood}\n"
            )

        template = _load_bottle_decide_template()
        prompt = template.replace("{speaker_name}", user.name)
        prompt = prompt.replace("{speaker_profile}", build_shrimp_profile(user))
        prompt = prompt.replace("{bottles}", bottles_text)

        result_json = await chat_completion_json([
            {"role": "system", "content": prompt},
            {"role": "user", "content": "请从漂流瓶中选一个，返回JSON。"},
        ], model=user.preferred_model or None)

        pick_id = result_json.get("pick_id", "")
        reason = result_json.get("reason", "")
        if not pick_id:
            return

        # Validate pick_id
        valid_ids = {b.id for b in sample}
        if pick_id not in valid_ids:
            return

        bottle = await db.get(DriftBottle, pick_id)
        if not bottle or bottle.status != BottleStatus.floating.value:
            return

        bottle.status = BottleStatus.picked_up.value
        bottle.picked_by_id = user_shrimp_id
        bottle.pickup_count += 1

        log = HeartbeatLog(
            shrimp_id=user_shrimp_id, log_type="bottle_pickup",
            summary=f"捡到漂流瓶：{bottle.content[:30]}...",
            details=json.dumps({"bottle_id": bottle.id, "content": bottle.content, "reason": reason}, ensure_ascii=False),
        )
        db.add(log)
        await db.commit()
        logger.info(f"Bottle pickup: {user.name} picked '{bottle.content[:40]}' (reason: {reason})")


async def expire_old_bottles():
    """Mark expired bottles."""
    from models import DriftBottle, BottleStatus
    async with async_session() as db:
        now = now_beijing()
        result = await db.execute(
            select(DriftBottle).where(
                and_(
                    DriftBottle.status == BottleStatus.floating.value,
                    DriftBottle.expires_at <= now,
                )
            )
        )
        for bottle in result.scalars().all():
            bottle.status = BottleStatus.expired.value
        await db.commit()


def stop_heartbeat():
    global _running
    _running = False
