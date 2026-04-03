from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from database import get_db
from models import Conversation
from schemas import ConversationOut
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/api/affinity", tags=["affinity"])


@router.get("/ranking/{shrimp_id}", response_model=list[ConversationOut])
async def affinity_ranking(shrimp_id: str, db: AsyncSession = Depends(get_db)):
    """Get all conversations sorted by affinity (from this shrimp's perspective)."""
    result = await db.execute(
        select(Conversation)
        .where(or_(Conversation.shrimp_a_id == shrimp_id, Conversation.shrimp_b_id == shrimp_id))
        .options(selectinload(Conversation.shrimp_a), selectinload(Conversation.shrimp_b))
    )
    convs = result.scalars().all()

    def sort_key(c):
        return c.affinity_a if c.shrimp_a_id == shrimp_id else c.affinity_b

    convs_sorted = sorted(convs, key=sort_key, reverse=True)
    return convs_sorted
