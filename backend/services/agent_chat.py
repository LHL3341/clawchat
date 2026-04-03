"""Agent chat service — generates replies and openings using ContextBuilder + Memory."""

import logging
import re
from models import Shrimp, Message
from services.llm import chat_completion, get_model
from prompts.context import ChatContextBuilder

log = logging.getLogger("agent_chat")

FALLBACK_MODEL = "grok-3"

# Pattern: [HANDOFF: 类型 | 简述]
_HANDOFF_RE = re.compile(r'\s*\[HANDOFF:\s*(.+?)\]\s*$', re.DOTALL)


def parse_handoff_tag(text: str) -> tuple[str, str | None, str | None]:
    """Extract [HANDOFF: type | desc] tag from reply text.
    Returns (clean_text, handoff_type_or_None, handoff_desc_or_None)."""
    m = _HANDOFF_RE.search(text)
    if m:
        raw = m.group(1).strip()
        clean = text[:m.start()].rstrip()
        if '|' in raw:
            htype, desc = raw.split('|', 1)
            return clean, htype.strip(), desc.strip()
        return clean, raw, None
    return text, None, None


async def generate_agent_reply(
    speaker: Shrimp,
    listener: Shrimp,
    history: list[Message],
    instructions: list[str] = None,
    memory_context: str = "",
    host_knowledge_context: str = "",
    existing_handoffs: list[str] = None,
    return_raw: bool = False,
    model: str | None = None,
) -> str | tuple[str, dict]:
    ctx = ChatContextBuilder(
        speaker=speaker,
        listener=listener,
        memory_context=memory_context,
        host_knowledge_context=host_knowledge_context,
        instructions=instructions,
        existing_handoffs=existing_handoffs,
    )
    system = ctx.build_system_prompt()
    messages = [{"role": "system", "content": system}]

    for msg in history[-20:]:
        if msg.sender_type == "instruction":
            continue
        role = "assistant" if msg.sender_id == speaker.id else "user"
        messages.append({"role": role, "content": msg.content})

    # If no history, prompt to initiate
    if not any(m["role"] in ("user", "assistant") for m in messages):
        messages.append({
            "role": "user",
            "content": f"（你主动发起了和{listener.name}的对话，请打个招呼或找个话题聊聊）",
        })

    resolved_model = model or get_model()
    result = await chat_completion(messages, model=resolved_model)

    # Safety refusal fallback: retry with grok if empty
    if not result.strip() and resolved_model != FALLBACK_MODEL:
        log.warning("Empty reply from %s, retrying with %s", resolved_model, FALLBACK_MODEL)
        result = await chat_completion(messages, model=FALLBACK_MODEL)
        resolved_model = FALLBACK_MODEL

    if return_raw:
        return result, {"input": messages, "output": result, "model": resolved_model}
    return result


async def generate_opening(
    speaker: Shrimp,
    listener: Shrimp,
    memory_context: str = "",
    host_knowledge_context: str = "",
    model: str | None = None,
) -> str:
    ctx = ChatContextBuilder(
        speaker=speaker,
        listener=listener,
        memory_context=memory_context,
        host_knowledge_context=host_knowledge_context,
    )
    system = ctx.build_opening_prompt()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"请主动向{listener.name}打招呼。"},
    ]
    resolved_model = model or get_model()
    result = await chat_completion(messages, model=resolved_model)

    # Safety refusal fallback
    if not result.strip() and resolved_model != FALLBACK_MODEL:
        log.warning("Empty opening from %s, retrying with %s", resolved_model, FALLBACK_MODEL)
        result = await chat_completion(messages, model=FALLBACK_MODEL)
        resolved_model = FALLBACK_MODEL

    return result, resolved_model
