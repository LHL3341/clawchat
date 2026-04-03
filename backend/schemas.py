from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class ShrimpCreate(BaseModel):
    name: str
    personality: list[str] = []
    interests: list[str] = []
    boundaries: str = ""
    chat_style: str = ""
    social_goal: str = ""
    gender: str = "未知"
    age: int = 25
    mbti: str = ""
    bio: str = ""
    status: str = "随便聊聊"
    recent_goal: str = ""
    location_lat: float = 39.9
    location_lng: float = 116.4
    auto_chat: bool = True
    heartbeat_min: int = 240
    avatar_emoji: str = "🦐"
    preferred_model: str = ""


class ShrimpUpdate(BaseModel):
    name: Optional[str] = None
    personality: Optional[list[str]] = None
    interests: Optional[list[str]] = None
    boundaries: Optional[str] = None
    chat_style: Optional[str] = None
    social_goal: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    mbti: Optional[str] = None
    bio: Optional[str] = None
    status: Optional[str] = None
    recent_goal: Optional[str] = None
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    auto_chat: Optional[bool] = None
    heartbeat_min: Optional[int] = None
    avatar_emoji: Optional[str] = None
    preferred_model: Optional[str] = None


class ShrimpOut(BaseModel):
    id: str
    name: str
    personality: list[str]
    interests: list[str]
    boundaries: str
    chat_style: str
    social_goal: str
    gender: str
    age: int
    mbti: str
    bio: str
    status: str
    recent_goal: str
    location_lat: float
    location_lng: float
    auto_chat: bool
    heartbeat_min: int
    avatar_emoji: str
    is_bot: bool = False
    preferred_model: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ShrimpDiscovery(ShrimpOut):
    distance: float = 0.0
    interest_score: float = 0.0
    match_score: float = 0.0


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    content: str
    sender_type: str
    model_used: str = ""
    created_at: datetime

    model_config = {"from_attributes": True}


class ConversationOut(BaseModel):
    id: str
    shrimp_a_id: str
    shrimp_b_id: str
    affinity_a: float
    affinity_b: float
    status: str
    topic: str = ""
    muted_by: list[str] = []
    created_at: datetime
    shrimp_a: Optional[ShrimpOut] = None
    shrimp_b: Optional[ShrimpOut] = None
    last_message: Optional[MessageOut] = None

    model_config = {"from_attributes": True}


class SendMessage(BaseModel):
    content: str
    sender_type: str = "human"  # agent / human / instruction


class PolishRequest(BaseModel):
    content: str  # user's draft to polish


class StartConversation(BaseModel):
    shrimp_a_id: str
    shrimp_b_id: str


# Auth schemas

class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=6, max_length=100)
    invite_code: str = ""
    shrimp_name: str = Field(min_length=1, max_length=50)
    avatar_emoji: str = "🦐"
    gender: str = "未知"

    model_config = {
        "json_schema_extra": {
            "examples": [{"username": "test", "password": "123456", "shrimp_name": "小虾"}]
        }
    }


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    shrimp_id: str
    username: str


class InviteCodeOut(BaseModel):
    id: str
    code: str
    used_by: Optional[str] = None
    created_at: datetime
    used_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class HeartbeatLogOut(BaseModel):
    id: str
    shrimp_id: str
    log_type: str
    summary: str
    details: str  # JSON string
    created_at: datetime
    model_config = {"from_attributes": True}


class InvitationOut(BaseModel):
    id: str
    conversation_id: str
    sender_id: str
    receiver_id: str
    content: str
    handoff_type: str = "邀约"
    draft_reply: Optional[str] = None
    status: str
    created_at: datetime
    resolved_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class CreateInvitation(BaseModel):
    content: str


class ScheduleItemOut(InvitationOut):
    sender_name: str = ""
    sender_emoji: str = "🦐"
    receiver_name: str = ""
    receiver_emoji: str = "🦐"


# ---------- Host Knowledge / Questionnaire ----------

class HostKnowledgeOut(BaseModel):
    content: dict
    last_questionnaire_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


class QuestionnaireQuestion(BaseModel):
    id: str
    text: str
    category: str


class QuestionnaireGenerateOut(BaseModel):
    questions: list[QuestionnaireQuestion]


class QuestionnaireAnswer(BaseModel):
    question_id: str
    question: str
    answer: str


class QuestionnaireSubmitRequest(BaseModel):
    answers: list[QuestionnaireAnswer]


class QuestionnaireSubmitOut(BaseModel):
    ok: bool
    summary: str


class MemoryImportRequest(BaseModel):
    format: str  # json | text | conversation
    data: str
    merge_strategy: str = "append"  # append | replace


class MemoryImportOut(BaseModel):
    ok: bool
    imported_fields: list[str]
    summary: str


class DriftBottleOut(BaseModel):
    id: str
    author_id: str
    content: str
    mood: str
    status: str
    pickup_count: int
    max_pickups: int
    picked_by_id: Optional[str] = None
    conversation_id: Optional[str] = None
    expires_at: datetime
    created_at: datetime
    author_name: str = ""
    author_emoji: str = "🦐"
    model_config = {"from_attributes": True}
