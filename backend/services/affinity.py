"""Affinity evaluation service — uses AffinityContextBuilder."""

from services.llm import chat_completion_json
from models import Shrimp, Message
from prompts.context import AffinityContextBuilder


async def evaluate_affinity(
    evaluator: Shrimp,
    other: Shrimp,
    recent_messages: list[Message],
    current_affinity: float,
) -> float:
    """Let LLM evaluate affinity change based on recent conversation."""
    ctx = AffinityContextBuilder(
        evaluator=evaluator,
        other=other,
        current_affinity=current_affinity,
    )

    msg_text = "\n".join(
        f"{'我' if m.sender_id == evaluator.id else other.name}: {m.content}"
        for m in recent_messages[-10:]
        if m.sender_type != "instruction"
    )

    messages = [
        {"role": "system", "content": ctx.build_system_prompt()},
        {"role": "user", "content": f"最近的对话:\n{msg_text}"},
    ]

    result = await chat_completion_json(messages)
    delta = result.get("delta", 0)
    delta = max(-10, min(10, int(delta)))
    new_affinity = max(0, min(100, current_affinity + delta))
    return new_affinity
