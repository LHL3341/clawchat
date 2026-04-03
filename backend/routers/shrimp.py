from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Shrimp, User
from schemas import ShrimpCreate, ShrimpUpdate, ShrimpOut
from services.auth import get_current_user, get_optional_user
import httpx
import logging
import os

logger = logging.getLogger(__name__)

# Proxy for outbound requests to external APIs (IP geolocation etc.)
_OUTBOUND_PROXY = os.environ.get("OUTBOUND_PROXY", "")

router = APIRouter(prefix="/api/shrimps", tags=["shrimps"])


@router.post("/", response_model=ShrimpOut)
async def create_shrimp(
    data: ShrimpCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create shrimp (admin only, normal users get shrimp at registration)."""
    if not user.is_admin:
        raise HTTPException(403, "Only admins can create shrimps directly")
    shrimp = Shrimp(**data.model_dump())
    db.add(shrimp)
    await db.commit()
    await db.refresh(shrimp)
    return shrimp


@router.get("/", response_model=list[ShrimpOut])
async def list_shrimps(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Shrimp).order_by(Shrimp.created_at.desc()))
    return result.scalars().all()


@router.get("/{shrimp_id}", response_model=ShrimpOut)
async def get_shrimp(shrimp_id: str, db: AsyncSession = Depends(get_db)):
    shrimp = await db.get(Shrimp, shrimp_id)
    if not shrimp:
        raise HTTPException(404, "Shrimp not found")
    return shrimp


@router.patch("/{shrimp_id}", response_model=ShrimpOut)
async def update_shrimp(
    shrimp_id: str,
    data: ShrimpUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.shrimp_id != shrimp_id and not user.is_admin:
        raise HTTPException(403, "只能修改自己的虾")
    shrimp = await db.get(Shrimp, shrimp_id)
    if not shrimp:
        raise HTTPException(404, "Shrimp not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(shrimp, k, v)
    await db.commit()
    await db.refresh(shrimp)
    return shrimp


@router.delete("/{shrimp_id}")
async def delete_shrimp(
    shrimp_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not user.is_admin:
        raise HTTPException(403, "Only admins can delete shrimps")
    shrimp = await db.get(Shrimp, shrimp_id)
    if not shrimp:
        raise HTTPException(404, "Shrimp not found")
    await db.delete(shrimp)
    await db.commit()
    return {"ok": True}


@router.post("/{shrimp_id}/auto-locate", response_model=ShrimpOut)
async def auto_locate_shrimp(
    shrimp_id: str,
    request: Request,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Auto-detect location from client IP and update shrimp coordinates."""
    if user.shrimp_id != shrimp_id and not user.is_admin:
        raise HTTPException(403, "只能定位自己的虾")
    shrimp = await db.get(Shrimp, shrimp_id)
    if not shrimp:
        raise HTTPException(404, "Shrimp not found")

    # Get real client IP (behind proxy: X-Forwarded-For, X-Real-IP)
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or (request.client.host if request.client else "")
    )
    logger.info(f"Auto-locate for {shrimp.name}: client_ip={client_ip}")

    if not client_ip or client_ip in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(400, "无法获取客户端 IP")

    # Try multiple free IP geolocation APIs
    lat, lng = None, None
    proxy = _OUTBOUND_PROXY or None

    # 1. ip-api.com (free, no key, 45 req/min) — HTTP only, no proxy needed
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"http://ip-api.com/json/{client_ip}?fields=status,lat,lon,city")
            data = resp.json()
            if data.get("status") == "success":
                lat, lng = data["lat"], data["lon"]
                logger.info(f"ip-api.com: {client_ip} -> {lat},{lng} ({data.get('city','')})")
    except Exception as e:
        logger.warning(f"ip-api.com failed: {e}")

    # 2. Fallback: ipapi.co
    if lat is None:
        try:
            async with httpx.AsyncClient(timeout=5, proxy=proxy) as client:
                resp = await client.get(f"https://ipapi.co/{client_ip}/json/")
                data = resp.json()
                if data.get("latitude"):
                    lat, lng = data["latitude"], data["longitude"]
                    logger.info(f"ipapi.co: {client_ip} -> {lat},{lng}")
        except Exception as e:
            logger.warning(f"ipapi.co failed: {e}")

    if lat is None or lng is None:
        raise HTTPException(502, "IP 定位失败，请稍后重试")

    shrimp.location_lat = float(lat)
    shrimp.location_lng = float(lng)
    await db.commit()
    await db.refresh(shrimp)
    return shrimp
