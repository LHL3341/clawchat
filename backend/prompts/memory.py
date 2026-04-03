"""
MemoryStore — per-shrimp memory for conversations.

Each shrimp maintains memory about each conversation partner:
- Stored in DB as JSON (AgentMemory model)
- Loaded into context at chat time
- Updated periodically via LLM extraction

Inspired by nanobot's two-layer memory:
- Layer 1: Structured facts (always in context)
- Layer 2: Conversation history summaries (searchable, not in context)
"""

import json
import logging
from datetime import datetime

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models import AgentMemory, now_beijing
from services.llm import chat_completion_json
from prompts.context import load_template

logger = logging.getLogger("memory")


def format_memory_context(memory: dict) -> str:
    """Format a memory dict into readable context string."""
    parts = []
    if memory.get("facts"):
        parts.append("已知信息：" + "；".join(memory["facts"]))
    if memory.get("topics_liked"):
        parts.append("感兴趣的话题：" + "、".join(memory["topics_liked"]))
    if memory.get("topics_disliked"):
        parts.append("不感兴趣的话题：" + "、".join(memory["topics_disliked"]))
    if memory.get("appointments"):
        parts.append("约定：" + "；".join(memory["appointments"]))
    if memory.get("impression"):
        parts.append("印象：" + memory["impression"])
    return "\n".join(parts) if parts else ""


async def get_memory(db: AsyncSession, shrimp_id: str, target_id: str) -> dict:
    """Get shrimp's memory about a specific target."""
    result = await db.execute(
        select(AgentMemory).where(
            and_(
                AgentMemory.shrimp_id == shrimp_id,
                AgentMemory.target_id == target_id,
            )
        )
    )
    mem = result.scalar_one_or_none()
    if mem:
        return json.loads(mem.content) if isinstance(mem.content, str) else mem.content
    return {}


async def get_memory_context(db: AsyncSession, shrimp_id: str, target_id: str) -> str:
    """Get formatted memory string for context injection."""
    memory = await get_memory(db, shrimp_id, target_id)
    return format_memory_context(memory)


async def save_memory(db: AsyncSession, shrimp_id: str, target_id: str, memory: dict):
    """Save or update memory."""
    result = await db.execute(
        select(AgentMemory).where(
            and_(
                AgentMemory.shrimp_id == shrimp_id,
                AgentMemory.target_id == target_id,
            )
        )
    )
    mem = result.scalar_one_or_none()
    content = json.dumps(memory, ensure_ascii=False)
    if mem:
        mem.content = content
        mem.updated_at = now_beijing()
    else:
        mem = AgentMemory(
            shrimp_id=shrimp_id,
            target_id=target_id,
            content=content,
        )
        db.add(mem)
    await db.commit()


def _merge_memory(existing: dict, extracted: dict) -> dict:
    """Merge newly extracted memory into existing, deduplicating."""
    merged = {}
    for key in ("facts", "topics_liked", "topics_disliked", "appointments"):
        old = set(existing.get(key, []))
        new = set(extracted.get(key, []))
        combined = list(old | new)
        if combined:
            merged[key] = combined
    # impression: prefer newer
    if extracted.get("impression"):
        merged["impression"] = extracted["impression"]
    elif existing.get("impression"):
        merged["impression"] = existing["impression"]
    return merged


async def extract_and_update_memory(
    db: AsyncSession,
    shrimp_id: str,
    target_id: str,
    target_name: str,
    recent_messages: list,
):
    """Use LLM to extract memory from recent messages and merge into stored memory."""
    msg_text = "\n".join(
        f"{'我' if m.sender_id == shrimp_id else target_name}: {m.content}"
        for m in recent_messages
        if m.sender_type != "instruction" and m.content.strip()
    )
    if not msg_text.strip():
        return

    template = load_template("MEMORY_EXTRACT.md")
    messages = [
        {"role": "system", "content": template},
        {"role": "user", "content": f"对方是「{target_name}」。\n\n最近的对话:\n{msg_text}"},
    ]

    try:
        extracted = await chat_completion_json(messages)
        if not extracted:
            return
        existing = await get_memory(db, shrimp_id, target_id)
        merged = _merge_memory(existing, extracted)
        if merged:
            await save_memory(db, shrimp_id, target_id, merged)
            logger.info(f"Memory updated for {shrimp_id} about {target_name}: {list(merged.keys())}")
    except Exception as e:
        logger.error(f"Memory extraction failed: {e}")
