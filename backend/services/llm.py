from openai import AsyncOpenAI
import os
import json
import logging

logger = logging.getLogger(__name__)

client = AsyncOpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
    base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
)

DEFAULT_MODEL = os.getenv("LLM_MODEL", "gemini-3-flash-preview")

# Runtime-mutable model override (set via API, takes priority over DEFAULT_MODEL)
_current_model: str | None = None


def get_model(preferred: str | None = None) -> str:
    """Return model in priority: per-shrimp preferred > runtime override > env default."""
    if preferred:
        return preferred
    return _current_model or DEFAULT_MODEL


def set_model(model: str):
    global _current_model
    _current_model = model if model else None


async def chat_completion(messages: list[dict], model: str | None = None) -> str:
    model = model or get_model()
    # GPT-5 reasoning models: merge system into first user message
    # to avoid reasoning consuming all max_tokens and leaving content empty
    merged = []
    system_parts = []
    for m in messages:
        if m["role"] == "system":
            system_parts.append(m["content"])
        else:
            if system_parts and m["role"] == "user":
                m = {**m, "content": "\n\n".join(system_parts) + "\n\n" + m["content"]}
                system_parts = []
            merged.append(m)
    if system_parts and not merged:
        merged.append({"role": "user", "content": "\n\n".join(system_parts)})

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=merged,
            temperature=1.0,
            max_completion_tokens=4096,
        )
    except Exception as e:
        logger.error(f"LLM API call failed: {e}")
        raise
    return resp.choices[0].message.content or ""


async def chat_completion_json(messages: list[dict], model: str | None = None, return_raw: bool = False) -> dict | tuple[dict, str]:
    model = model or get_model()
    # Merge system into user for GPT-5 reasoning models
    merged = []
    system_parts = []
    for m in messages:
        if m["role"] == "system":
            system_parts.append(m["content"])
        else:
            if system_parts and m["role"] == "user":
                m = {**m, "content": "\n\n".join(system_parts) + "\n\n" + m["content"]}
                system_parts = []
            merged.append(m)
    if system_parts and not merged:
        merged.append({"role": "user", "content": "\n\n".join(system_parts)})

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=merged,
            temperature=1.0,
            max_completion_tokens=4096,
        )
    except Exception as e:
        logger.error(f"LLM API call failed: {e}")
        raise
    text = resp.choices[0].message.content or "{}"
    result = _extract_json(text)
    if return_raw:
        return result, text
    return result


def _extract_json(text: str) -> dict:
    """Extract JSON from model output that may contain reasoning text + JSON block."""
    import re
    # 1) Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # 2) Try ```json code block (last one wins)
    json_blocks = re.findall(r'```json\s*(.*?)```', text, re.DOTALL)
    if json_blocks:
        try:
            return json.loads(json_blocks[-1].strip())
        except json.JSONDecodeError:
            pass
    # 3) Try to find last { ... } pair
    start = text.rfind("{")
    if start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == '{': depth += 1
            elif text[i] == '}': depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i+1])
                except json.JSONDecodeError:
                    break
    return {}
