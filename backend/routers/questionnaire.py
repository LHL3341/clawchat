"""Questionnaire router — LLM-generated personalized questionnaires."""

import json
import logging
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Shrimp, AgentMemory
from services.auth import get_current_user
from services.llm import chat_completion_json
from services.host_knowledge import (
    get_host_knowledge, save_host_knowledge,
    merge_host_knowledge, format_host_knowledge_context,
    check_questionnaire_needed,
)
from prompts.context import load_template
from prompts.profile import build_shrimp_profile

logger = logging.getLogger("questionnaire")

router = APIRouter(prefix="/api/questionnaire", tags=["questionnaire"])


@router.get("/status")
async def questionnaire_status(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    needed, last_at = await check_questionnaire_needed(db, user.shrimp_id)
    return {
        "needed": needed,
        "last_filled_at": last_at.isoformat() if last_at else None,
    }


@router.post("/generate")
async def questionnaire_generate(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    shrimp = await db.get(Shrimp, user.shrimp_id)
    existing = await get_host_knowledge(db, user.shrimp_id)

    profile_text = build_shrimp_profile(shrimp)
    existing_text = format_host_knowledge_context(existing)

    template = load_template("QUESTIONNAIRE_GENERATE.md")
    user_msg = f"主人的资料：\n{profile_text}"
    if existing_text:
        user_msg += f"\n\n已知的主人信息：\n{existing_text}"
    else:
        user_msg += "\n\n目前还不太了解主人，请全面提问。"

    messages = [
        {"role": "system", "content": template},
        {"role": "user", "content": user_msg},
    ]

    result = await chat_completion_json(messages)
    questions = result.get("questions", [])
    # Ensure IDs
    for i, q in enumerate(questions):
        if "id" not in q:
            q["id"] = f"q{i+1}"
        if "category" not in q:
            q["category"] = "general"

    return {"questions": questions}


@router.post("/submit")
async def questionnaire_submit(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    answers = body.get("answers", [])
    if not answers:
        return {"ok": False, "summary": "没有收到回答"}

    # Format Q&A for LLM
    qa_text = "\n".join(
        f"问：{a.get('question', '')}\n答：{a.get('answer', '')}"
        for a in answers
        if a.get("answer", "").strip()
    )
    if not qa_text.strip():
        return {"ok": False, "summary": "所有问题都跳过了"}

    template = load_template("QUESTIONNAIRE_PROCESS.md")
    existing = await get_host_knowledge(db, user.shrimp_id)
    existing_text = format_host_knowledge_context(existing)

    user_content = qa_text
    if existing_text:
        user_content += f"\n\n【已知信息，不要重复提取】：\n{existing_text}"

    messages = [
        {"role": "system", "content": template},
        {"role": "user", "content": user_content},
    ]

    extracted = await chat_completion_json(messages)
    if not extracted:
        return {"ok": False, "summary": "提取信息失败"}

    merged = merge_host_knowledge(existing, extracted)
    await save_host_knowledge(db, user.shrimp_id, merged, update_questionnaire_time=True)

    # Build summary
    fields = [k for k, v in extracted.items() if v]
    field_names = {
        "communication_style": "沟通风格", "values": "价值观", "habits": "生活习惯",
        "preferences": "偏好", "emotional_triggers": "情绪特点",
        "life_context": "生活背景", "social_preferences": "社交偏好",
        "quirks": "小习惯", "raw_facts": "其他信息",
    }
    learned = "、".join(field_names.get(f, f) for f in fields)
    summary = f"我更了解你了！学到了你的{learned}。" if learned else "谢谢你的回答！"

    logger.info(f"Questionnaire completed for {user.shrimp_id}: {fields}")
    return {"ok": True, "summary": summary}


@router.get("/knowledge")
async def get_knowledge(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    knowledge = await get_host_knowledge(db, user.shrimp_id)
    return {"content": knowledge}


@router.get("/friend-memories")
async def get_friend_memories(
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    """Get all agent memories about conversation partners."""
    result = await db.execute(
        select(AgentMemory).where(AgentMemory.shrimp_id == user.shrimp_id)
    )
    memories = result.scalars().all()
    items = []
    for mem in memories:
        target = await db.get(Shrimp, mem.target_id)
        content = json.loads(mem.content) if isinstance(mem.content, str) else mem.content
        if not content:
            continue
        items.append({
            "target_id": mem.target_id,
            "target_name": target.name if target else "未知",
            "target_emoji": target.avatar_emoji if target else "🦐",
            "content": content,
            "updated_at": mem.updated_at.isoformat() if mem.updated_at else None,
        })
    return {"memories": items}
