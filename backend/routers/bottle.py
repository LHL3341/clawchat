from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from database import get_db
from models import DriftBottle, BottleStatus, Shrimp, Conversation, Message, SenderType, now_beijing
from schemas import DriftBottleOut
from routers.auth import get_current_user
from models import User
from datetime import timedelta

router = APIRouter(prefix="/api/bottles", tags=["bottles"])


def _bottle_to_out(bottle: DriftBottle, author: Shrimp | None = None) -> dict:
    """Convert DriftBottle + optional author to DriftBottleOut-compatible dict."""
    d = {c.name: getattr(bottle, c.name) for c in bottle.__table__.columns}
    d["author_name"] = author.name if author else ""
    d["author_emoji"] = author.avatar_emoji if author else "🦐"
    return d


@router.get("/picked", response_model=list[DriftBottleOut])
async def get_picked_bottles(
    shrimp_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get bottles picked up by this shrimp (pending host action)."""
    result = await db.execute(
        select(DriftBottle).where(
            and_(DriftBottle.picked_by_id == shrimp_id, DriftBottle.status == BottleStatus.picked_up.value)
        ).options(selectinload(DriftBottle.author))
        .order_by(DriftBottle.created_at.desc())
    )
    bottles = list(result.scalars().all())
    return [_bottle_to_out(b, b.author) for b in bottles]


@router.get("/my-bottles", response_model=list[DriftBottleOut])
async def get_my_bottles(
    shrimp_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get bottles written by this shrimp."""
    result = await db.execute(
        select(DriftBottle).where(DriftBottle.author_id == shrimp_id)
        .order_by(DriftBottle.created_at.desc()).limit(20)
    )
    bottles = list(result.scalars().all())
    me = await db.get(Shrimp, shrimp_id)
    return [_bottle_to_out(b, me) for b in bottles]


@router.post("/reply/{bottle_id}")
async def reply_to_bottle(
    bottle_id: str,
    body: dict,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host replies to a picked bottle -> create conversation."""
    bottle = await db.get(DriftBottle, bottle_id)
    if not bottle:
        raise HTTPException(404, "Bottle not found")
    if bottle.status != BottleStatus.picked_up.value:
        raise HTTPException(400, "Bottle is not in picked_up state")
    if bottle.picked_by_id != user.shrimp_id:
        raise HTTPException(403, "Not your bottle")

    reply_text = body.get("reply", "").strip()
    if not reply_text:
        raise HTTPException(400, "Reply cannot be empty")

    # Create conversation
    conv = Conversation(shrimp_a_id=bottle.picked_by_id, shrimp_b_id=bottle.author_id)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)

    picker = await db.get(Shrimp, bottle.picked_by_id)
    picker_name = picker.name if picker else "某只虾"

    # System message about the bottle
    sys_msg = Message(
        conversation_id=conv.id, sender_id=bottle.picked_by_id,
        content=f"🍾 {picker_name} 捡到了一个漂流瓶\n\n📜 瓶中内容：{bottle.content}\n\n💬 回复：{reply_text}",
        sender_type=SenderType.human.value,
    )
    db.add(sys_msg)

    bottle.status = BottleStatus.replied.value
    bottle.conversation_id = conv.id
    await db.commit()

    return {"ok": True, "conv_id": conv.id}


@router.post("/throw-back/{bottle_id}")
async def throw_back_bottle(
    bottle_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host throws bottle back into the pool."""
    bottle = await db.get(DriftBottle, bottle_id)
    if not bottle:
        raise HTTPException(404, "Bottle not found")
    if bottle.picked_by_id != user.shrimp_id:
        raise HTTPException(403, "Not your bottle")

    if bottle.pickup_count >= bottle.max_pickups:
        bottle.status = BottleStatus.expired.value
    else:
        bottle.status = BottleStatus.floating.value
    bottle.picked_by_id = None
    await db.commit()
    return {"ok": True}


@router.post("/write")
async def manually_write_bottle(
    shrimp_id: str = Query(...),
    body: dict | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Host manually writes a bottle."""
    if body is None:
        body = {}
    content = body.get("content", "").strip()
    if not content:
        raise HTTPException(400, "Content cannot be empty")

    bottle = DriftBottle(
        author_id=shrimp_id,
        content=content,
        mood=body.get("mood", ""),
        expires_at=now_beijing() + timedelta(days=7),
    )
    db.add(bottle)
    await db.commit()
    await db.refresh(bottle)

    author = await db.get(Shrimp, shrimp_id)
    return _bottle_to_out(bottle, author)
