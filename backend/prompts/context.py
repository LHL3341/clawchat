"""
ContextBuilder — assembles LLM prompts from templates, profiles, and memory.

Inspired by nanobot's context engineering:
- Static Markdown templates loaded from files
- Dynamic sections (identity, profile, memory) assembled at runtime
- Sections joined with separators for clear structure
"""

import os
from pathlib import Path
from functools import lru_cache

from models import Shrimp
from prompts.profile import build_shrimp_profile

TEMPLATES_DIR = Path(__file__).parent / "templates"
SECTION_SEP = "\n\n---\n\n"


@lru_cache(maxsize=16)
def _load_template(name: str) -> str:
    """Load a markdown template file. Cached for performance."""
    path = TEMPLATES_DIR / name
    if not path.exists():
        raise FileNotFoundError(f"Template not found: {path}")
    return path.read_text(encoding="utf-8").strip()


def load_template(name: str) -> str:
    """Public API — load and return a template by filename."""
    return _load_template(name)


def reload_templates():
    """Clear template cache (call after editing .md files at runtime)."""
    _load_template.cache_clear()


class ChatContextBuilder:
    """Builds the full prompt for agent chat."""

    def __init__(
        self,
        speaker: Shrimp,
        listener: Shrimp,
        memory_context: str = "",
        host_knowledge_context: str = "",
        instructions: list[str] | None = None,
        existing_handoffs: list[str] | None = None,
    ):
        self.speaker = speaker
        self.listener = listener
        self.memory_context = memory_context
        self.host_knowledge_context = host_knowledge_context
        self.instructions = instructions
        self.existing_handoffs = existing_handoffs

    def build_system_prompt(self) -> str:
        sections = [
            self._identity(),
            load_template("SOUL.md"),
            load_template("CHAT.md"),
            self._profiles(),
        ]
        if self.host_knowledge_context:
            sections.append(self._host_knowledge_section())
        if self.memory_context:
            sections.append(self._memory_section())
        if self.instructions:
            sections.append(self._instructions_section())
        if self.existing_handoffs:
            sections.append(self._handoffs_section())
        return SECTION_SEP.join(sections)

    def build_opening_prompt(self) -> str:
        sections = [
            self._identity(),
            load_template("SOUL.md"),
            load_template("OPENING.md"),
            self._profiles(),
        ]
        if self.host_knowledge_context:
            sections.append(self._host_knowledge_section())
        if self.memory_context:
            sections.append(self._memory_section())
        return SECTION_SEP.join(sections)

    def _identity(self) -> str:
        return (
            f"# 身份\n"
            f"你是「{self.speaker.name}」的社交代理虾。\n"
            f"当前正在和「{self.listener.name}」聊天。"
        )

    def _profiles(self) -> str:
        return (
            f"# 我的资料\n{build_shrimp_profile(self.speaker)}\n\n"
            f"# 对方的资料\n{build_shrimp_profile(self.listener)}"
        )

    def _host_knowledge_section(self) -> str:
        return f"# 对主人的深度了解\n{self.host_knowledge_context}"

    def _memory_section(self) -> str:
        return f"# 关于{self.listener.name}的记忆\n{self.memory_context}"

    def _instructions_section(self) -> str:
        items = "\n".join(f"- {i}" for i in self.instructions)
        return f"# 主人给你的指令\n{items}"

    def _handoffs_section(self) -> str:
        items = "\n".join(f"- {h}" for h in self.existing_handoffs)
        return f"# 本轮对话已发送过的 HANDOFF（不要重复）\n{items}"


class AffinityContextBuilder:
    """Builds the prompt for affinity evaluation."""

    def __init__(
        self,
        evaluator: Shrimp,
        other: Shrimp,
        current_affinity: float,
    ):
        self.evaluator = evaluator
        self.other = other
        self.current_affinity = current_affinity

    def build_system_prompt(self) -> str:
        sections = [
            load_template("AFFINITY.md"),
            self._profiles(),
            f"# 当前好感度\n{self.current_affinity}/100",
        ]
        return SECTION_SEP.join(sections)

    def _profiles(self) -> str:
        return (
            f"# {self.evaluator.name}的资料\n{build_shrimp_profile(self.evaluator)}\n\n"
            f"# {self.other.name}的资料\n{build_shrimp_profile(self.other)}"
        )
