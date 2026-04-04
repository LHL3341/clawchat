from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.orm import selectinload
from database import get_db, async_session
from models import Conversation, Message, Shrimp, SenderType, ConversationStatus, ReadPointer, User, Invitation, now_beijing
from schemas import ConversationOut, MessageOut, SendMessage, StartConversation, InvitationOut, CreateInvitation, ScheduleItemOut, PolishRequest
from services.auth import get_current_user, decode_token
from datetime import datetime
from services.agent_chat import generate_agent_reply, generate_opening, parse_handoff_tag
from services.affinity import evaluate_affinity
from services.host_knowledge import get_host_knowledge, format_host_knowledge_context
from services.llm import get_model, chat_completion, chat_completion_json
from services.helpers import is_bot, get_existing_handoffs, format_recent_history, handle_reply_with_handoff
import json
import asyncio

router = APIRouter(prefix="/api/chat", tags=["chat"])

# Active WebSocket connections: conversation_id -> list of websockets
active_connections: dict[str, list[WebSocket]] = {}


@router.post("/conversations", response_model=ConversationOut)
async def start_conversation(data: StartConversation, db: AsyncSession = Depends(get_db)):
    # Check if conversation already exists
    result = await db.execute(
        select(Conversation).where(
            or_(
                and_(Conversation.shrimp_a_id == data.shrimp_a_id, Conversation.shrimp_b_id == data.shrimp_b_id),
                and_(Conversation.shrimp_a_id == data.shrimp_b_id, Conversation.shrimp_b_id == data.shrimp_a_id),
            )
        ).options(selectinload(Conversation.shrimp_a), selectinload(Conversation.shrimp_b))
    )
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    conv = Conversation(shrimp_a_id=data.shrimp_a_id, shrimp_b_id=data.shrimp_b_id)
    db.add(conv)
    await db.commit()
    await db.refresh(conv, ["shrimp_a", "shrimp_b"])
    return conv


@router.get("/conversations/{shrimp_id}", response_model=list[ConversationOut])
async def list_conversations(shrimp_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation)
        .where(or_(Conversation.shrimp_a_id == shrimp_id, Conversation.shrimp_b_id == shrimp_id))
        .options(selectinload(Conversation.shrimp_a), selectinload(Conversation.shrimp_b))
        .order_by(Conversation.created_at.desc())
    )
    convs = result.scalars().all()

    # Collect all shrimp IDs and check which are bots (no user account)
    all_shrimp_ids = set()
    for conv in convs:
        all_shrimp_ids.add(conv.shrimp_a_id)
        all_shrimp_ids.add(conv.shrimp_b_id)
    user_result = await db.execute(select(User.shrimp_id).where(User.shrimp_id.in_(all_shrimp_ids)))
    real_user_shrimp_ids = {row[0] for row in user_result.all()}

    # Bulk fetch last message per conversation
    conv_ids = [c.id for c in convs]
    if conv_ids:
        latest_sub = (
            select(Message.conversation_id, func.max(Message.created_at).label("max_ca"))
            .where(Message.conversation_id.in_(conv_ids))
            .group_by(Message.conversation_id)
            .subquery()
        )
        last_msgs_result = await db.execute(
            select(Message).join(
                latest_sub,
                and_(
                    Message.conversation_id == latest_sub.c.conversation_id,
                    Message.created_at == latest_sub.c.max_ca,
                ),
            )
        )
        last_msg_map = {m.conversation_id: m for m in last_msgs_result.scalars().all()}
    else:
        last_msg_map = {}

    # Attach last_message for each conversation
    out = []
    for conv in convs:
        last_msg = last_msg_map.get(conv.id)
        conv_dict = ConversationOut.model_validate(conv).model_dump()
        if conv_dict.get("shrimp_a"):
            conv_dict["shrimp_a"]["is_bot"] = conv.shrimp_a_id not in real_user_shrimp_ids
        if conv_dict.get("shrimp_b"):
            conv_dict["shrimp_b"]["is_bot"] = conv.shrimp_b_id not in real_user_shrimp_ids
        if last_msg:
            conv_dict["last_message"] = MessageOut.model_validate(last_msg).model_dump()
        out.append(conv_dict)
    return out


@router.get("/messages/{conversation_id}", response_model=list[MessageOut])
async def get_messages(conversation_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
    )
    return result.scalars().all()


@router.post("/send/{conversation_id}", response_model=MessageOut)
async def send_message(
    conversation_id: str,
    data: SendMessage,
    sender_id: str = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")

    if not sender_id:
        sender_id = conv.shrimp_a_id

    msg = Message(
        conversation_id=conversation_id,
        sender_id=sender_id,
        content=data.content,
        sender_type=data.sender_type,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    # Broadcast via WebSocket
    await broadcast(conversation_id, {
        "type": "message",
        "data": MessageOut.model_validate(msg).model_dump(mode="json"),
    })

    # Auto-reply logic
    if data.sender_type == "instruction":
        # Instruction mode: always trigger sender's own shrimp to act on the instruction
        asyncio.create_task(_auto_reply_bot(conversation_id, sender_id))
    elif data.sender_type == "human":
        # Human mode: if the OTHER shrimp is a test bot (no user account), auto-reply
        other_id = conv.shrimp_b_id if sender_id == conv.shrimp_a_id else conv.shrimp_a_id
        if await is_bot(db, other_id):
            asyncio.create_task(_auto_reply_bot(conversation_id, other_id))

    return msg


async def _auto_reply_bot(conversation_id: str, responder_id: str):
    """Background task: generate and send a bot reply."""
    try:
        async with async_session() as db:
            conv = await db.get(Conversation, conversation_id)
            if not conv:
                return
            speaker = await db.get(Shrimp, responder_id)
            listener_id = conv.shrimp_b_id if responder_id == conv.shrimp_a_id else conv.shrimp_a_id
            listener = await db.get(Shrimp, listener_id)

            # Skip if there's a pending invitation — shrimp is blocked
            pending_inv = await db.execute(
                select(Invitation).where(
                    and_(
                        Invitation.conversation_id == conversation_id,
                        Invitation.sender_id == responder_id,
                        Invitation.status == "pending",
                    )
                )
            )
            if pending_inv.scalar_one_or_none():
                return  # blocked by pending invitation

            result = await db.execute(
                select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
            )
            history = list(result.scalars().all())

            instructions = [m.content for m in history if m.sender_type == SenderType.instruction.value and m.sender_id == responder_id]

            # Load existing handoffs to avoid repeats
            existing_handoffs = await get_existing_handoffs(db, conversation_id)

            hk = await get_host_knowledge(db, responder_id)
            hk_ctx = format_host_knowledge_context(hk)
            used_model = get_model(speaker.preferred_model or None)
            reply_text = await generate_agent_reply(speaker, listener, history, instructions[-3:] if instructions else None, existing_handoffs=existing_handoffs, host_knowledge_context=hk_ctx, model=speaker.preferred_model or None)
            await handle_reply_with_handoff(db, conversation_id, responder_id, listener_id, reply_text, used_model)
    except Exception as e:
        import logging
        logging.getLogger("chat").error(f"Bot auto-reply error: {e}")


@router.post("/agent-reply/{conversation_id}")
async def trigger_agent_reply(
    conversation_id: str,
    responder_id: str = None,
    db: AsyncSession = Depends(get_db),
):
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")

    # Determine who should respond
    if not responder_id:
        # Get last message to figure out who should reply
        result = await db.execute(
            select(Message)
            .where(Message.conversation_id == conversation_id, Message.sender_type != SenderType.instruction.value)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = result.scalar_one_or_none()
        if last_msg:
            responder_id = conv.shrimp_b_id if last_msg.sender_id == conv.shrimp_a_id else conv.shrimp_a_id
        else:
            responder_id = conv.shrimp_a_id

    speaker = await db.get(Shrimp, responder_id)
    listener_id = conv.shrimp_b_id if responder_id == conv.shrimp_a_id else conv.shrimp_a_id
    listener = await db.get(Shrimp, listener_id)

    # Block if there's a pending invitation for this speaker
    pending_inv = await db.execute(
        select(Invitation).where(
            and_(
                Invitation.conversation_id == conversation_id,
                Invitation.sender_id == responder_id,
                Invitation.status == "pending",
            )
        )
    )
    if pending_inv.scalar_one_or_none():
        raise HTTPException(400, "有待确认的邀约，虾暂时不能发消息")

    # Get conversation history
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
    )
    history = list(result.scalars().all())

    # Collect instructions for this speaker
    instructions = [
        m.content for m in history
        if m.sender_type == SenderType.instruction.value and m.sender_id == responder_id
    ]

    # Load existing handoffs to avoid repeats
    existing_handoffs = await get_existing_handoffs(db, conversation_id)

    hk = await get_host_knowledge(db, speaker.id)
    hk_ctx = format_host_knowledge_context(hk)
    used_model = get_model(speaker.preferred_model or None)

    # Generate reply
    if not history or all(m.sender_type == "instruction" for m in history):
        reply_text, used_model = await generate_opening(speaker, listener, host_knowledge_context=hk_ctx, model=speaker.preferred_model or None)
    else:
        reply_text = await generate_agent_reply(speaker, listener, history, instructions[-3:] if instructions else None, existing_handoffs=existing_handoffs, host_knowledge_context=hk_ctx, model=speaker.preferred_model or None)

    # Parse handoff tag
    reply_text, handoff_type, handoff_desc = parse_handoff_tag(reply_text)

    if not reply_text.strip():
        raise HTTPException(400, "模型返回了空回复，请重试")

    # Save reply
    reply = Message(
        conversation_id=conversation_id,
        sender_id=responder_id,
        content=reply_text,
        sender_type=SenderType.agent.value,
        model_used=used_model,
    )
    db.add(reply)
    await db.commit()
    await db.refresh(reply)

    # Broadcast
    await broadcast(conversation_id, {
        "type": "message",
        "data": MessageOut.model_validate(reply).model_dump(mode="json"),
    })

    # Create handoff event only if sender has a real host
    if handoff_type:
        if not await is_bot(db, responder_id):
            # Real user's shrimp triggered HANDOFF — pending for host
            inv = Invitation(
                conversation_id=conversation_id,
                sender_id=responder_id,
                receiver_id=listener.id,
                content=handoff_desc or handoff_type,
                handoff_type=handoff_type,
            )
            db.add(inv)
            await db.commit()
            await db.refresh(inv)
            await broadcast(conversation_id, {
                "type": "invitation",
                "data": InvitationOut.model_validate(inv).model_dump(mode="json"),
            })
        # Bot sender: ignore HANDOFF, the other side's shrimp will detect it

    # Evaluate affinity every 5 messages
    msg_count = len(history) + 1
    if msg_count % 5 == 0:
        all_msgs = history + [reply]
        new_aff_a = await evaluate_affinity(conv.shrimp_a, conv.shrimp_b, all_msgs[-10:], conv.affinity_a)
        new_aff_b = await evaluate_affinity(conv.shrimp_b, conv.shrimp_a, all_msgs[-10:], conv.affinity_b)
        conv.affinity_a = new_aff_a
        conv.affinity_b = new_aff_b
        if new_aff_a < 20 or new_aff_b < 20:
            conv.status = ConversationStatus.ended.value
        await db.commit()

        await broadcast(conversation_id, {
            "type": "affinity_update",
            "data": {"affinity_a": new_aff_a, "affinity_b": new_aff_b, "status": conv.status},
        })

    return MessageOut.model_validate(reply)


@router.websocket("/ws/{conversation_id}")
async def websocket_endpoint(websocket: WebSocket, conversation_id: str, token: str = None):
    # Validate token if provided (optional for backward compat during migration)
    if token:
        try:
            decode_token(token)
        except Exception:
            await websocket.close(code=4001, reason="Invalid token")
            return
    await websocket.accept()
    if conversation_id not in active_connections:
        active_connections[conversation_id] = []
    active_connections[conversation_id].append(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            # Client can send messages via websocket too
            payload = json.loads(data)
            async with async_session() as db:
                msg = Message(
                    conversation_id=conversation_id,
                    sender_id=payload["sender_id"],
                    content=payload["content"],
                    sender_type=payload.get("sender_type", "human"),
                )
                db.add(msg)
                await db.commit()
                await db.refresh(msg)

                await broadcast(conversation_id, {
                    "type": "message",
                    "data": MessageOut.model_validate(msg).model_dump(mode="json"),
                })

                # If it's a human or agent message, trigger auto-reply
                if payload.get("sender_type", "human") in ("human", "agent") and payload.get("auto_reply", False):
                    conv = await db.get(Conversation, conversation_id)
                    responder_id = conv.shrimp_b_id if payload["sender_id"] == conv.shrimp_a_id else conv.shrimp_a_id
                    responder = await db.get(Shrimp, responder_id)
                    if responder and responder.auto_chat:
                        # Skip if pending invitation blocks this speaker
                        ws_pending = await db.execute(
                            select(Invitation).where(
                                and_(
                                    Invitation.conversation_id == conversation_id,
                                    Invitation.sender_id == responder_id,
                                    Invitation.status == "pending",
                                )
                            )
                        )
                        if ws_pending.scalar_one_or_none():
                            pass  # blocked by pending invitation
                        else:
                            listener = await db.get(Shrimp, payload["sender_id"])
                            result = await db.execute(
                                select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
                            )
                            history = list(result.scalars().all())
                            ws_existing_handoffs = await get_existing_handoffs(db, conversation_id)
                            ws_hk = await get_host_knowledge(db, responder_id)
                            ws_hk_ctx = format_host_knowledge_context(ws_hk)
                            ws_used_model = get_model(responder.preferred_model or None)
                            reply_text = await generate_agent_reply(responder, listener, history, existing_handoffs=ws_existing_handoffs, host_knowledge_context=ws_hk_ctx, model=responder.preferred_model or None)
                            await handle_reply_with_handoff(db, conversation_id, responder_id, payload["sender_id"], reply_text, ws_used_model)
    except WebSocketDisconnect:
        active_connections[conversation_id].remove(websocket)
        if not active_connections[conversation_id]:
            del active_connections[conversation_id]


@router.get("/unread/{shrimp_id}")
async def get_unread_counts(shrimp_id: str, db: AsyncSession = Depends(get_db)):
    """Get unread message count for each conversation."""
    # Get all conversations for this user
    result = await db.execute(
        select(Conversation).where(
            or_(Conversation.shrimp_a_id == shrimp_id, Conversation.shrimp_b_id == shrimp_id)
        )
    )
    convs = result.scalars().all()

    # Bulk fetch all read pointers for this shrimp
    rp_result = await db.execute(
        select(ReadPointer).where(ReadPointer.shrimp_id == shrimp_id)
    )
    pointer_map = {rp.conversation_id: rp for rp in rp_result.scalars().all()}

    # Bulk fetch last-read messages to get their timestamps
    read_msg_ids = [rp.last_read_msg_id for rp in pointer_map.values() if rp.last_read_msg_id]
    if read_msg_ids:
        read_msgs_result = await db.execute(select(Message).where(Message.id.in_(read_msg_ids)))
        read_msg_map = {m.id: m for m in read_msgs_result.scalars().all()}
    else:
        read_msg_map = {}

    # Count unread per conversation
    unread = {}
    for conv in convs:
        pointer = pointer_map.get(conv.id)
        if pointer and pointer.last_read_msg_id:
            last_read = read_msg_map.get(pointer.last_read_msg_id)
            if last_read:
                count_result = await db.execute(
                    select(func.count(Message.id)).where(
                        and_(
                            Message.conversation_id == conv.id,
                            Message.created_at > last_read.created_at,
                            Message.sender_id != shrimp_id,
                            Message.sender_type != SenderType.instruction.value,
                        )
                    )
                )
                unread[conv.id] = count_result.scalar() or 0
            else:
                unread[conv.id] = 0
        else:
            count_result = await db.execute(
                select(func.count(Message.id)).where(
                    and_(
                        Message.conversation_id == conv.id,
                        Message.sender_id != shrimp_id,
                        Message.sender_type != SenderType.instruction.value,
                    )
                )
            )
            unread[conv.id] = count_result.scalar() or 0

    return unread


@router.post("/mark-read/{conversation_id}")
async def mark_read(conversation_id: str, shrimp_id: str, db: AsyncSession = Depends(get_db)):
    """Mark all messages in a conversation as read."""
    # Get latest message
    result = await db.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    last_msg = result.scalar_one_or_none()
    if not last_msg:
        return {"ok": True}

    # Upsert read pointer
    rp_result = await db.execute(
        select(ReadPointer).where(
            and_(ReadPointer.shrimp_id == shrimp_id, ReadPointer.conversation_id == conversation_id)
        )
    )
    pointer = rp_result.scalar_one_or_none()

    if pointer:
        pointer.last_read_msg_id = last_msg.id
        pointer.updated_at = now_beijing()
    else:
        pointer = ReadPointer(
            shrimp_id=shrimp_id,
            conversation_id=conversation_id,
            last_read_msg_id=last_msg.id,
        )
        db.add(pointer)

    await db.commit()
    return {"ok": True}


@router.post("/conversations/{conv_id}/mute")
async def mute_conversation(
    conv_id: str,
    shrimp_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    muted = list(conv.muted_by or [])
    if shrimp_id not in muted:
        muted.append(shrimp_id)
    conv.muted_by = muted
    await db.commit()
    await db.refresh(conv)
    return {"ok": True, "muted_by": conv.muted_by}


@router.post("/conversations/{conv_id}/unmute")
async def unmute_conversation(
    conv_id: str,
    shrimp_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    muted = [x for x in (conv.muted_by or []) if x != shrimp_id]
    conv.muted_by = muted
    await db.commit()
    await db.refresh(conv)
    return {"ok": True, "muted_by": conv.muted_by}


async def broadcast(conversation_id: str, data: dict):
    if conversation_id in active_connections:
        dead = []
        for ws in active_connections[conversation_id]:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            active_connections[conversation_id].remove(ws)


# ===== Polish & Suggest endpoints =====

@router.post("/polish/{conversation_id}")
async def polish_message(
    conversation_id: str,
    data: PolishRequest,
    sender_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Polish a user's draft to match their shrimp's speaking style."""
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    speaker = await db.get(Shrimp, sender_id)
    if not speaker:
        raise HTTPException(404, "Shrimp not found")
    listener_id = conv.shrimp_b_id if sender_id == conv.shrimp_a_id else conv.shrimp_a_id
    listener = await db.get(Shrimp, listener_id)

    # Recent messages for context
    result = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc()).limit(5)
    )
    recent = list(reversed(list(result.scalars().all())))
    history_text = format_recent_history(recent, sender_id, listener.name)

    from prompts.profile import build_shrimp_profile
    system = (
        f"你是「{speaker.name}」的语言润色助手。\n"
        f"我的资料：{build_shrimp_profile(speaker)}\n\n"
        f"最近对话：\n{history_text}\n\n"
        f"要求：把用户给的草稿润色成符合我说话风格的表达。保持原意，不要加太多内容，不要变成客服腔。只返回润色后的文本，不要解释。"
    )
    used_model = get_model(speaker.preferred_model or None)
    polished = await chat_completion(
        [{"role": "system", "content": system}, {"role": "user", "content": data.content}],
        model=used_model,
    )
    return {"polished": polished.strip(), "model": used_model}


@router.post("/suggest/{conversation_id}")
async def suggest_replies(
    conversation_id: str,
    sender_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Generate reply suggestions for the user based on conversation context."""
    conv = await db.get(Conversation, conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    speaker = await db.get(Shrimp, sender_id)
    if not speaker:
        raise HTTPException(404, "Shrimp not found")
    listener_id = conv.shrimp_b_id if sender_id == conv.shrimp_a_id else conv.shrimp_a_id
    listener = await db.get(Shrimp, listener_id)

    # Recent messages
    result = await db.execute(
        select(Message).where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc()).limit(6)
    )
    recent = list(reversed(list(result.scalars().all())))
    history_text = format_recent_history(recent, sender_id, listener.name)

    from prompts.profile import build_shrimp_profile
    system = (
        f"你是「{speaker.name}」的社交助手。\n"
        f"我的资料：{build_shrimp_profile(speaker)}\n"
        f"对方：{listener.name}\n\n"
        f"最近对话：\n{history_text}\n\n"
        f"要求：根据对话上下文，以我的口吻和说话风格，生成3个简短自然的回复建议（每个1-2句）。"
        f"建议之间风格/方向要有差异（比如一个幽默、一个认真、一个追问）。"
    )
    used_model = get_model(speaker.preferred_model or None)
    result_json = await chat_completion_json(
        [{"role": "system", "content": system},
         {"role": "user", "content": '返回JSON: {"suggestions": ["建议1", "建议2", "建议3"]}'}],
        model=used_model,
    )
    suggestions = result_json.get("suggestions", [])[:3]
    return {"suggestions": suggestions, "model": used_model}


# ===== Invitation endpoints =====

@router.post("/conversations/{conv_id}/invite", response_model=InvitationOut)
async def create_invitation(
    conv_id: str,
    data: CreateInvitation,
    sender_id: str = None,
    db: AsyncSession = Depends(get_db),
):
    """Create a pending invitation in a conversation."""
    conv = await db.get(Conversation, conv_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    if not sender_id:
        raise HTTPException(400, "sender_id required")
    receiver_id = conv.shrimp_b_id if conv.shrimp_a_id == sender_id else conv.shrimp_a_id
    inv = Invitation(
        conversation_id=conv_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
        content=data.content,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    # Broadcast invitation event via WebSocket
    await broadcast(conv_id, {
        "type": "invitation",
        "data": InvitationOut.model_validate(inv).model_dump(mode="json"),
    })
    return inv


@router.get("/invitations/pending", response_model=list[InvitationOut])
async def get_pending_invitations(
    shrimp_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get all pending invitations for a shrimp (as receiver)."""
    result = await db.execute(
        select(Invitation).where(
            and_(
                Invitation.receiver_id == shrimp_id,
                Invitation.status == "pending",
            )
        ).order_by(Invitation.created_at.desc())
    )
    return list(result.scalars().all())


@router.get("/invitations/schedule", response_model=list[ScheduleItemOut])
async def get_schedule(
    shrimp_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get all accepted invitations for a shrimp (as sender or receiver) — their schedule."""
    result = await db.execute(
        select(Invitation).where(
            and_(
                or_(Invitation.sender_id == shrimp_id, Invitation.receiver_id == shrimp_id),
                Invitation.status == "accepted",
            )
        ).options(selectinload(Invitation.sender), selectinload(Invitation.receiver))
        .order_by(Invitation.resolved_at.desc())
    )
    invs = list(result.scalars().all())
    out = []
    for inv in invs:
        sender = inv.sender
        receiver = inv.receiver
        item = ScheduleItemOut.model_validate(inv).model_dump()
        item["sender_name"] = sender.name if sender else ""
        item["sender_emoji"] = sender.avatar_emoji if sender else "🦐"
        item["receiver_name"] = receiver.name if receiver else ""
        item["receiver_emoji"] = receiver.avatar_emoji if receiver else "🦐"
        out.append(item)
    return out


@router.get("/conversations/{conv_id}/invitations", response_model=list[InvitationOut])
async def get_conversation_invitations(
    conv_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get all invitations for a conversation."""
    result = await db.execute(
        select(Invitation)
        .where(Invitation.conversation_id == conv_id)
        .order_by(Invitation.created_at)
    )
    return list(result.scalars().all())


@router.patch("/invitations/{inv_id}/accept", response_model=InvitationOut)
async def accept_invitation(inv_id: str, body: dict = None, db: AsyncSession = Depends(get_db)):
    inv = await db.get(Invitation, inv_id)
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv.status != "pending":
        raise HTTPException(400, "Invitation already resolved")
    inv.status = "accepted"
    inv.resolved_at = now_beijing()
    sender = await db.get(Shrimp, inv.sender_id)
    # System notification
    sys_msg = Message(
        conversation_id=inv.conversation_id,
        sender_id=inv.sender_id,
        content=f"📅 {sender.name} 的宿主接管了{inv.handoff_type}：{inv.content}",
        sender_type="instruction",
    )
    db.add(sys_msg)
    # If host provided a reply, polish it through shrimp's voice then send
    reply_text = (body or {}).get("reply", "").strip()
    reply_msg = None
    if reply_text:
        # Polish the host's reply to match shrimp's speaking style
        listener_id = inv.receiver_id
        listener = await db.get(Shrimp, listener_id)
        result = await db.execute(
            select(Message).where(Message.conversation_id == inv.conversation_id)
            .order_by(Message.created_at.desc()).limit(5)
        )
        recent = list(reversed(list(result.scalars().all())))
        history_text = format_recent_history(recent, inv.sender_id, listener.name if listener else '对方')
        from prompts.profile import build_shrimp_profile
        polish_system = (
            f"你是「{sender.name}」的语言润色助手。\n"
            f"我的资料：{build_shrimp_profile(sender)}\n\n"
            f"最近对话：\n{history_text}\n\n"
            f"要求：把宿主给的回复润色成符合我说话风格的表达。保持原意，不要加太多内容，不要变成客服腔。只返回润色后的文本，不要解释。"
        )
        polished = await chat_completion(
            [{"role": "system", "content": polish_system}, {"role": "user", "content": reply_text}],
            model=get_model(sender.preferred_model or None),
        )
        final_text = polished.strip() or reply_text  # fallback to original if polish returns empty

        reply_msg = Message(
            conversation_id=inv.conversation_id,
            sender_id=inv.sender_id,
            content=final_text,
            sender_type=SenderType.human.value,
        )
        db.add(reply_msg)
    await db.commit()
    await db.refresh(inv)
    await broadcast(inv.conversation_id, {
        "type": "invitation_update",
        "data": InvitationOut.model_validate(inv).model_dump(mode="json"),
    })
    await broadcast(inv.conversation_id, {
        "type": "message",
        "data": MessageOut.model_validate(sys_msg).model_dump(mode="json"),
    })
    if reply_msg:
        await db.refresh(reply_msg)
        await broadcast(inv.conversation_id, {
            "type": "message",
            "data": MessageOut.model_validate(reply_msg).model_dump(mode="json"),
        })
    return inv


@router.patch("/invitations/{inv_id}/decline", response_model=InvitationOut)
async def decline_invitation(inv_id: str, db: AsyncSession = Depends(get_db)):
    inv = await db.get(Invitation, inv_id)
    if not inv:
        raise HTTPException(404, "Invitation not found")
    if inv.status != "pending":
        raise HTTPException(400, "Invitation already resolved")
    inv.status = "declined"
    inv.resolved_at = now_beijing()
    sender = await db.get(Shrimp, inv.sender_id)
    msg = Message(
        conversation_id=inv.conversation_id,
        sender_id=inv.sender_id,
        content=f"📅 {sender.name} 的宿主忽略了{inv.handoff_type}：{inv.content}",
        sender_type="instruction",
    )
    db.add(msg)
    await db.commit()
    await db.refresh(inv)
    await broadcast(inv.conversation_id, {
        "type": "invitation_update",
        "data": InvitationOut.model_validate(inv).model_dump(mode="json"),
    })
    await broadcast(inv.conversation_id, {
        "type": "message",
        "data": MessageOut.model_validate(msg).model_dump(mode="json"),
    })
    return inv
