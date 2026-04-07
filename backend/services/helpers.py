"""Shared helper functions extracted from routers and services to reduce duplication."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from models import User, Invitation, Message, SenderType


async def is_bot(db: AsyncSession, shrimp_id: str) -> bool:
    """Check if a shrimp is a bot (no associated User record)."""
    result = await db.execute(select(User).where(User.shrimp_id == shrimp_id))
    return result.scalar_one_or_none() is None


async def get_existing_handoffs(db: AsyncSession, conv_id: str) -> list[str] | None:
    """Load existing handoff descriptions for a conversation.

    Returns a list of "[type] content" strings, or None if no handoffs exist.
    """
    inv_result = await db.execute(
        select(Invitation).where(Invitation.conversation_id == conv_id)
    )
    existing_handoffs = [
        f"[{inv.handoff_type}] {inv.content}" for inv in inv_result.scalars().all()
    ] or None
    return existing_handoffs


def format_recent_history(messages, speaker_id: str, listener_name: str) -> str:
    """Format recent messages as history text, skipping instructions.

    Uses '我' for the speaker and the listener's name for the other party.
    """
    return "\n".join(
        f"{'我' if m.sender_id == speaker_id else listener_name}: {m.content}"
        for m in messages if m.sender_type != "instruction"
    )


async def handle_reply_with_handoff(
    db: AsyncSession,
    conv_id: str,
    speaker_id: str,
    listener_id: str,
    reply_text: str,
    model_used: str,
    websocket_connections=None,
) -> Message | None:
    """Parse handoff tag from reply → create Message or Invitation → broadcast.

    If a handoff is detected and the sender is a real user (not a bot),
    blocks the reply and creates an Invitation with draft_reply for host review.
    Otherwise, creates and broadcasts a normal Message.

    Returns the created Message if sent normally, or None if a handoff
    invitation was created instead (message blocked as draft).
    """
    from services.agent_chat import parse_handoff_tag

    reply_text, handoff_type, handoff_desc = parse_handoff_tag(reply_text)

    if handoff_type and not await is_bot(db, speaker_id):
        # Real user's shrimp triggered HANDOFF — block reply, store as draft for host
        inv = Invitation(
            sender_id=speaker_id,
            receiver_id=listener_id,
            conversation_id=conv_id,
            content=handoff_desc or handoff_type,
            handoff_type=handoff_type,
            draft_reply=reply_text,
        )
        db.add(inv)
        await db.commit()
        await db.refresh(inv)
        # Lazy imports to avoid circular dependency
        from routers.chat import broadcast
        from schemas import InvitationOut
        await broadcast(conv_id, {
            "type": "invitation",
            "data": InvitationOut.model_validate(inv).model_dump(mode="json"),
        })
        return None
    else:
        # No handoff or bot sender — send reply normally
        reply = Message(
            conversation_id=conv_id,
            sender_id=speaker_id,
            content=reply_text,
            sender_type=SenderType.agent.value,
            model_used=model_used,
        )
        db.add(reply)
        await db.commit()
        await db.refresh(reply)
        from routers.chat import broadcast
        from schemas import MessageOut
        await broadcast(conv_id, {
            "type": "message",
            "data": MessageOut.model_validate(reply).model_dump(mode="json"),
        })
        return reply
