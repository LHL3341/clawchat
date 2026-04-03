"""Admin monitoring dashboard API."""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from models import User, Shrimp, Conversation, Message, HeartbeatLog, DriftBottle, Invitation

router = APIRouter(prefix="/api/admin", tags=["admin"])

_BJT = timezone(timedelta(hours=8))


def _now():
    return datetime.now(_BJT).replace(tzinfo=None)


@router.get("/dashboard")
async def dashboard(db: AsyncSession = Depends(get_db)):
    now = _now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # --- Overview ---
    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    total_shrimps = (await db.execute(select(func.count(Shrimp.id)))).scalar() or 0
    bot_shrimps = (await db.execute(select(func.count(Shrimp.id)).where(Shrimp.is_bot == True))).scalar() or 0
    total_convs = (await db.execute(select(func.count(Conversation.id)))).scalar() or 0
    active_convs = (await db.execute(select(func.count(Conversation.id)).where(Conversation.status == "active"))).scalar() or 0
    total_msgs = (await db.execute(select(func.count(Message.id)))).scalar() or 0
    today_msgs = (await db.execute(select(func.count(Message.id)).where(Message.created_at >= today_start))).scalar() or 0
    total_bottles = (await db.execute(select(func.count(DriftBottle.id)))).scalar() or 0
    floating_bottles = (await db.execute(select(func.count(DriftBottle.id)).where(DriftBottle.status == "floating"))).scalar() or 0
    total_invitations = (await db.execute(select(func.count(Invitation.id)))).scalar() or 0
    pending_invitations = (await db.execute(select(func.count(Invitation.id)).where(Invitation.status == "pending"))).scalar() or 0

    # --- Message stats by type ---
    type_rows = (await db.execute(
        select(Message.sender_type, func.count(Message.id)).group_by(Message.sender_type)
    )).all()
    by_type = {r[0]: r[1] for r in type_rows}

    # --- Message stats by model ---
    model_rows = (await db.execute(
        select(Message.model_used, func.count(Message.id))
        .where(Message.model_used != "")
        .group_by(Message.model_used)
    )).all()
    by_model = {r[0]: r[1] for r in model_rows}

    # --- Hourly message counts (last 24h) ---
    h24_ago = now - timedelta(hours=24)
    hourly_msgs = (await db.execute(
        select(Message.created_at).where(Message.created_at >= h24_ago).order_by(Message.created_at)
    )).scalars().all()
    hourly = {}
    for ts in hourly_msgs:
        h = ts.strftime("%m-%d %H:00")
        hourly[h] = hourly.get(h, 0) + 1

    # --- Recent messages (last 50) ---
    recent_q = (await db.execute(
        select(Message).order_by(Message.created_at.desc()).limit(50)
    )).scalars().all()
    # Collect sender/conv info
    shrimp_cache = {}
    conv_cache = {}
    recent_messages = []
    for m in recent_q:
        if m.sender_id not in shrimp_cache:
            s = await db.get(Shrimp, m.sender_id)
            shrimp_cache[m.sender_id] = s
        sender = shrimp_cache[m.sender_id]
        if m.conversation_id not in conv_cache:
            c = await db.get(Conversation, m.conversation_id)
            conv_cache[m.conversation_id] = c
        conv = conv_cache[m.conversation_id]
        other_id = conv.shrimp_b_id if m.sender_id == conv.shrimp_a_id else conv.shrimp_a_id
        if other_id not in shrimp_cache:
            o = await db.get(Shrimp, other_id)
            shrimp_cache[other_id] = o
        other = shrimp_cache[other_id]
        recent_messages.append({
            "id": m.id,
            "conversation_id": m.conversation_id,
            "sender_name": sender.name if sender else "?",
            "sender_emoji": sender.avatar_emoji if sender else "",
            "other_name": other.name if other else "?",
            "other_emoji": other.avatar_emoji if other else "",
            "content": m.content[:200],
            "sender_type": m.sender_type,
            "model_used": m.model_used,
            "created_at": m.created_at.isoformat() if m.created_at else "",
        })

    # --- Conversations list ---
    convs_q = (await db.execute(
        select(Conversation).order_by(Conversation.created_at.desc())
    )).scalars().all()
    conversations = []
    for c in convs_q:
        if c.shrimp_a_id not in shrimp_cache:
            shrimp_cache[c.shrimp_a_id] = await db.get(Shrimp, c.shrimp_a_id)
        if c.shrimp_b_id not in shrimp_cache:
            shrimp_cache[c.shrimp_b_id] = await db.get(Shrimp, c.shrimp_b_id)
        sa = shrimp_cache[c.shrimp_a_id]
        sb = shrimp_cache[c.shrimp_b_id]
        msg_count = (await db.execute(
            select(func.count(Message.id)).where(Message.conversation_id == c.id)
        )).scalar() or 0
        last_msg = (await db.execute(
            select(Message.created_at).where(Message.conversation_id == c.id)
            .order_by(Message.created_at.desc()).limit(1)
        )).scalar()
        conversations.append({
            "id": c.id,
            "shrimp_a_name": f"{sa.avatar_emoji} {sa.name}" if sa else "?",
            "shrimp_b_name": f"{sb.avatar_emoji} {sb.name}" if sb else "?",
            "status": c.status,
            "message_count": msg_count,
            "affinity_a": round(c.affinity_a, 1),
            "affinity_b": round(c.affinity_b, 1),
            "last_message_at": last_msg.isoformat() if last_msg else "",
            "created_at": c.created_at.isoformat() if c.created_at else "",
        })

    # --- Shrimps list ---
    all_shrimps = (await db.execute(select(Shrimp).order_by(Shrimp.created_at))).scalars().all()
    shrimps = []
    for s in all_shrimps:
        s_msg_count = (await db.execute(
            select(func.count(Message.id)).where(Message.sender_id == s.id)
        )).scalar() or 0
        s_conv_count = (await db.execute(
            select(func.count(Conversation.id)).where(
                (Conversation.shrimp_a_id == s.id) | (Conversation.shrimp_b_id == s.id)
            )
        )).scalar() or 0
        shrimps.append({
            "id": s.id,
            "name": s.name,
            "emoji": s.avatar_emoji,
            "is_bot": s.is_bot,
            "auto_chat": s.auto_chat,
            "preferred_model": s.preferred_model,
            "message_count": s_msg_count,
            "conversation_count": s_conv_count,
            "created_at": s.created_at.isoformat() if s.created_at else "",
        })

    # --- Recent heartbeat logs (last 30) ---
    hb_q = (await db.execute(
        select(HeartbeatLog).order_by(HeartbeatLog.created_at.desc()).limit(30)
    )).scalars().all()
    heartbeat_logs = []
    for h in hb_q:
        if h.shrimp_id not in shrimp_cache:
            shrimp_cache[h.shrimp_id] = await db.get(Shrimp, h.shrimp_id)
        hs = shrimp_cache[h.shrimp_id]
        heartbeat_logs.append({
            "id": h.id,
            "shrimp_name": f"{hs.avatar_emoji} {hs.name}" if hs else "?",
            "log_type": h.log_type,
            "summary": h.summary[:150],
            "created_at": h.created_at.isoformat() if h.created_at else "",
        })

    return {
        "overview": {
            "total_users": total_users,
            "total_shrimps": total_shrimps,
            "bot_shrimps": bot_shrimps,
            "real_shrimps": total_shrimps - bot_shrimps,
            "total_conversations": total_convs,
            "active_conversations": active_convs,
            "total_messages": total_msgs,
            "today_messages": today_msgs,
            "total_bottles": total_bottles,
            "floating_bottles": floating_bottles,
            "total_invitations": total_invitations,
            "pending_invitations": pending_invitations,
        },
        "message_stats": {
            "by_type": by_type,
            "by_model": by_model,
            "hourly": [{"hour": k, "count": v} for k, v in sorted(hourly.items())],
        },
        "recent_messages": recent_messages,
        "conversations": conversations,
        "shrimps": shrimps,
        "heartbeat_logs": heartbeat_logs,
        "server_time": now.isoformat(),
    }
