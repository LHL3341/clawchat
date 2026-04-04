import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import String, Integer, Float, Boolean, Text, JSON, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base
import enum

_BJT = timezone(timedelta(hours=8))


def gen_uuid():
    return str(uuid.uuid4())


def now_beijing():
    return datetime.now(_BJT).replace(tzinfo=None)


class ConversationStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    ended = "ended"


class SenderType(str, enum.Enum):
    agent = "agent"
    human = "human"
    instruction = "instruction"


class Shrimp(Base):
    __tablename__ = "shrimps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    name: Mapped[str] = mapped_column(String(50))
    personality: Mapped[list] = mapped_column(JSON, default=list)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    boundaries: Mapped[str] = mapped_column(Text, default="")
    chat_style: Mapped[str] = mapped_column(Text, default="")
    social_goal: Mapped[str] = mapped_column(Text, default="")
    gender: Mapped[str] = mapped_column(String(10), default="未知")  # 男/女/未知
    age: Mapped[int] = mapped_column(Integer, default=25)
    mbti: Mapped[str] = mapped_column(String(10), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(Text, default="随便聊聊")
    recent_goal: Mapped[str] = mapped_column(Text, default="")
    location_lat: Mapped[float] = mapped_column(Float, default=39.9)
    location_lng: Mapped[float] = mapped_column(Float, default=116.4)
    auto_chat: Mapped[bool] = mapped_column(Boolean, default=True)
    heartbeat_min: Mapped[int] = mapped_column(Integer, default=240)
    avatar_emoji: Mapped[str] = mapped_column(String(10), default="🦐")
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False)
    preferred_model: Mapped[str] = mapped_column(String(100), default="")  # empty = use global default
    created_at: Mapped[datetime] = mapped_column(default=now_beijing)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    shrimp_a_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    shrimp_b_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    affinity_a: Mapped[float] = mapped_column(Float, default=50.0)
    affinity_b: Mapped[float] = mapped_column(Float, default=50.0)
    status: Mapped[str] = mapped_column(String(20), default=ConversationStatus.active.value)
    topic: Mapped[str] = mapped_column(Text, default="")  # LLM-generated common ground
    muted_by: Mapped[list] = mapped_column(JSON, default=list)  # shrimp_ids that muted this conv
    created_at: Mapped[datetime] = mapped_column(default=now_beijing)

    shrimp_a: Mapped["Shrimp"] = relationship("Shrimp", foreign_keys=[shrimp_a_id])
    shrimp_b: Mapped["Shrimp"] = relationship("Shrimp", foreign_keys=[shrimp_b_id])
    messages: Mapped[list["Message"]] = relationship("Message", back_populates="conversation", order_by="Message.created_at")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    sender_type: Mapped[str] = mapped_column(String(20), default=SenderType.agent.value)
    model_used: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(default=now_beijing, index=True)

    conversation: Mapped["Conversation"] = relationship("Conversation", back_populates="messages")
    sender: Mapped["Shrimp"] = relationship("Shrimp")


class ReadPointer(Base):
    """Tracks the last read message for each user in each conversation."""
    __tablename__ = "read_pointers"
    __table_args__ = (UniqueConstraint('shrimp_id', 'conversation_id', name='uq_read_pointer'),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    shrimp_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"))
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"))
    last_read_msg_id: Mapped[str] = mapped_column(String(36), default="")
    updated_at: Mapped[datetime] = mapped_column(default=now_beijing)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    shrimp_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=now_beijing)

    shrimp: Mapped["Shrimp"] = relationship("Shrimp")


class InviteCode(Base):
    __tablename__ = "invite_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    used_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=now_beijing)
    used_at: Mapped[datetime | None] = mapped_column(nullable=True)


class AgentMemory(Base):
    """Per-shrimp memory about each conversation partner."""
    __tablename__ = "agent_memories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    shrimp_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    target_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    content: Mapped[str] = mapped_column(Text, default="{}")  # JSON
    updated_at: Mapped[datetime] = mapped_column(default=now_beijing)

    shrimp: Mapped["Shrimp"] = relationship("Shrimp", foreign_keys=[shrimp_id])
    target: Mapped["Shrimp"] = relationship("Shrimp", foreign_keys=[target_id])


class HeartbeatLog(Base):
    """Log of each heartbeat event (chat or discovery)."""
    __tablename__ = "heartbeat_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    shrimp_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    log_type: Mapped[str] = mapped_column(String(20))  # "chat" | "discovery"
    summary: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[str] = mapped_column(Text, default="[]")  # JSON
    created_at: Mapped[datetime] = mapped_column(default=now_beijing)


class Invitation(Base):
    """Handoff event requiring host confirmation (invite, privacy, emotion, etc.)."""
    __tablename__ = "invitations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    sender_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    receiver_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    handoff_type: Mapped[str] = mapped_column(String(50), default="邀约")
    draft_reply: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending/accepted/declined
    created_at: Mapped[datetime] = mapped_column(default=now_beijing)
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)

    conversation: Mapped["Conversation"] = relationship("Conversation")
    sender: Mapped["Shrimp"] = relationship("Shrimp", foreign_keys=[sender_id])
    receiver: Mapped["Shrimp"] = relationship("Shrimp", foreign_keys=[receiver_id])


class HostKnowledge(Base):
    """Shrimp's deep knowledge about its host (owner)."""
    __tablename__ = "host_knowledge"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    shrimp_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), unique=True, index=True)
    content: Mapped[str] = mapped_column(Text, default="{}")
    last_questionnaire_at: Mapped[datetime | None] = mapped_column(nullable=True)
    updated_at: Mapped[datetime] = mapped_column(default=now_beijing)

    shrimp: Mapped["Shrimp"] = relationship("Shrimp")


class BottleStatus(str, enum.Enum):
    floating = "floating"
    picked_up = "picked_up"
    replied = "replied"
    expired = "expired"


class DriftBottle(Base):
    """Anonymous drift bottle thrown into the global pool."""
    __tablename__ = "drift_bottles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_uuid)
    author_id: Mapped[str] = mapped_column(ForeignKey("shrimps.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    mood: Mapped[str] = mapped_column(String(50), default="")
    status: Mapped[str] = mapped_column(String(20), default=BottleStatus.floating.value)
    pickup_count: Mapped[int] = mapped_column(Integer, default=0)
    max_pickups: Mapped[int] = mapped_column(Integer, default=3)
    picked_by_id: Mapped[str | None] = mapped_column(ForeignKey("shrimps.id"), nullable=True, index=True)
    conversation_id: Mapped[str | None] = mapped_column(ForeignKey("conversations.id"), nullable=True, index=True)
    expires_at: Mapped[datetime] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(default=now_beijing)

    author: Mapped["Shrimp"] = relationship("Shrimp", foreign_keys=[author_id])
