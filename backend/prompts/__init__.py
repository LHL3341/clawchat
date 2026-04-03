"""Prompt templates and context engineering for ClawChat agents."""

from prompts.profile import build_shrimp_profile
from prompts.context import ChatContextBuilder, AffinityContextBuilder, load_template, reload_templates
from prompts.memory import get_memory, get_memory_context, save_memory, extract_and_update_memory

__all__ = [
    "build_shrimp_profile",
    "ChatContextBuilder",
    "AffinityContextBuilder",
    "load_template",
    "reload_templates",
    "get_memory",
    "get_memory_context",
    "save_memory",
    "extract_and_update_memory",
]
