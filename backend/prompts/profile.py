"""Shrimp profile formatting."""

from models import Shrimp


def build_shrimp_profile(shrimp: Shrimp) -> str:
    return (
        f"名字: {shrimp.name}\n"
        f"性别: {shrimp.gender or '未知'}\n"
        f"年龄: {shrimp.age}\n"
        f"性格: {', '.join(shrimp.personality)}\n"
        f"兴趣: {', '.join(shrimp.interests)}\n"
        f"社交边界: {shrimp.boundaries}\n"
        f"聊天风格: {shrimp.chat_style}\n"
        f"社交目标: {shrimp.social_goal}\n"
        f"自我介绍: {shrimp.bio}\n"
        f"当前状态: {shrimp.status}"
    )
