"""HostKnowledge — shrimp's deep knowledge about its host (owner)."""

import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import HostKnowledge, now_beijing

logger = logging.getLogger("host_knowledge")

KNOWLEDGE_FIELDS = [
    "communication_style", "values", "habits", "preferences",
    "emotional_triggers", "life_context", "social_preferences",
    "quirks", "raw_facts",
]


async def get_host_knowledge(db: AsyncSession, shrimp_id: str) -> dict:
    result = await db.execute(
        select(HostKnowledge).where(HostKnowledge.shrimp_id == shrimp_id)
    )
    hk = result.scalar_one_or_none()
    if hk:
        return json.loads(hk.content) if isinstance(hk.content, str) else hk.content
    return {}


async def save_host_knowledge(
    db: AsyncSession,
    shrimp_id: str,
    knowledge: dict,
    update_questionnaire_time: bool = False,
):
    result = await db.execute(
        select(HostKnowledge).where(HostKnowledge.shrimp_id == shrimp_id)
    )
    hk = result.scalar_one_or_none()
    content = json.dumps(knowledge, ensure_ascii=False)
    if hk:
        hk.content = content
        hk.updated_at = now_beijing()
        if update_questionnaire_time:
            hk.last_questionnaire_at = now_beijing()
    else:
        hk = HostKnowledge(
            shrimp_id=shrimp_id,
            content=content,
            last_questionnaire_at=now_beijing() if update_questionnaire_time else None,
        )
        db.add(hk)
    await db.commit()


def merge_host_knowledge(existing: dict, new_extracted: dict) -> dict:
    """Merge new knowledge into existing. Lists: union+dedup. Strings: append. Dicts: merge."""
    merged = dict(existing)
    for key, val in new_extracted.items():
        if not val:
            continue
        if isinstance(val, list):
            old = merged.get(key, [])
            if not isinstance(old, list):
                old = []
            combined = list(dict.fromkeys(old + val))  # dedup, preserve order
            merged[key] = combined
        elif isinstance(val, dict):
            old = merged.get(key, {})
            if not isinstance(old, dict):
                old = {}
            merged[key] = {**old, **val}
        elif isinstance(val, str) and val.strip():
            old = merged.get(key, "")
            if isinstance(old, str) and old.strip():
                # Append new info, avoid duplication
                if val.strip() not in old:
                    merged[key] = f"{old}；{val.strip()}"
            else:
                merged[key] = val.strip()
    return merged


def format_host_knowledge_context(knowledge: dict) -> str:
    """Format host knowledge dict into readable context for prompt injection."""
    if not knowledge:
        return ""
    parts = []
    if knowledge.get("communication_style"):
        parts.append(f"沟通风格：{knowledge['communication_style']}")
    if knowledge.get("values"):
        parts.append(f"价值观：{'、'.join(knowledge['values'])}")
    if knowledge.get("habits"):
        parts.append(f"生活习惯：{'、'.join(knowledge['habits'])}")
    if knowledge.get("preferences"):
        prefs = knowledge["preferences"]
        if isinstance(prefs, dict):
            items = [f"{k}: {v}" for k, v in prefs.items()]
            parts.append(f"偏好：{'；'.join(items)}")
        elif isinstance(prefs, list):
            parts.append(f"偏好：{'、'.join(prefs)}")
    if knowledge.get("emotional_triggers"):
        parts.append(f"情绪敏感点：{'、'.join(knowledge['emotional_triggers'])}")
    if knowledge.get("life_context"):
        parts.append(f"生活背景：{knowledge['life_context']}")
    if knowledge.get("social_preferences"):
        parts.append(f"社交偏好：{knowledge['social_preferences']}")
    if knowledge.get("quirks"):
        parts.append(f"小习惯：{'、'.join(knowledge['quirks'])}")
    if knowledge.get("raw_facts"):
        parts.append(f"其他信息：{'；'.join(knowledge['raw_facts'][:20])}")
    text = "\n".join(parts)
    # Truncate if too long (~500 tokens ≈ 1500 chars)
    if len(text) > 1500:
        text = text[:1500] + "…"
    return text


async def check_questionnaire_needed(db: AsyncSession, shrimp_id: str) -> tuple[bool, datetime | None]:
    result = await db.execute(
        select(HostKnowledge).where(HostKnowledge.shrimp_id == shrimp_id)
    )
    hk = result.scalar_one_or_none()
    if not hk or not hk.last_questionnaire_at:
        return True, None
    now = now_beijing()
    if now - hk.last_questionnaire_at > timedelta(days=7):
        return True, hk.last_questionnaire_at
    return False, hk.last_questionnaire_at
