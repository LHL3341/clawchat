import string
import random
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import User, InviteCode, Shrimp, now_beijing
from schemas import RegisterRequest, LoginRequest, TokenResponse, InviteCodeOut, ShrimpOut
from services.auth import hash_password, verify_password, create_token, require_admin, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _gen_invite_code(length: int = 8) -> str:
    chars = string.ascii_uppercase + string.digits
    return ''.join(random.choices(chars, k=length))


@router.post("/register", response_model=TokenResponse)
async def register(data: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Check username
    result = await db.execute(select(User).where(User.username == data.username))
    if result.scalar_one_or_none():
        raise HTTPException(400, "用户名已存在")

    # Check invite code (optional — skip if empty)
    if data.invite_code:
        result = await db.execute(select(InviteCode).where(InviteCode.code == data.invite_code))
        invite = result.scalar_one_or_none()
        if not invite:
            raise HTTPException(400, "邀请码无效")
        if invite.used_by:
            raise HTTPException(400, "邀请码已被使用")
    else:
        invite = None

    # Create shrimp
    shrimp = Shrimp(
        name=data.shrimp_name,
        avatar_emoji=data.avatar_emoji or "🦐",
        gender=data.gender or "未知",
    )
    db.add(shrimp)
    await db.flush()

    # Create user
    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        shrimp_id=shrimp.id,
    )
    db.add(user)
    await db.flush()

    # Mark invite code used (if provided)
    if invite:
        invite.used_by = user.id
        invite.used_at = now_beijing()

    await db.commit()

    token = create_token(user.id, shrimp.id)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        shrimp_id=shrimp.id,
        username=user.username,
    )


@router.post("/login", response_model=TokenResponse)
async def login(data: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == data.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")

    token = create_token(user.id, user.shrimp_id)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        shrimp_id=user.shrimp_id,
        username=user.username,
    )


@router.get("/me")
async def get_me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    shrimp = await db.get(Shrimp, user.shrimp_id)
    return {
        "user_id": user.id,
        "username": user.username,
        "shrimp_id": user.shrimp_id,
        "is_admin": user.is_admin,
        "shrimp": ShrimpOut.model_validate(shrimp).model_dump(mode="json") if shrimp else None,
    }


@router.post("/invite-codes", response_model=list[InviteCodeOut])
async def create_invite_codes(
    count: int = Query(1, ge=1, le=50),
    x_admin_token: str = Header(..., alias="X-Admin-Token"),
    db: AsyncSession = Depends(get_db),
):
    require_admin(x_admin_token)
    codes = []
    for _ in range(count):
        code = InviteCode(code=_gen_invite_code())
        db.add(code)
        codes.append(code)
    await db.commit()
    for c in codes:
        await db.refresh(c)
    return codes


@router.get("/invite-codes", response_model=list[InviteCodeOut])
async def list_invite_codes(
    x_admin_token: str = Header(..., alias="X-Admin-Token"),
    db: AsyncSession = Depends(get_db),
):
    require_admin(x_admin_token)
    result = await db.execute(select(InviteCode).order_by(InviteCode.created_at.desc()))
    return result.scalars().all()
