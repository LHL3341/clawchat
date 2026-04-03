from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import get_db
from models import Shrimp, HeartbeatLog, User
from schemas import ShrimpDiscovery, HeartbeatLogOut
from services.matching import match_score, virtual_bot_coords
from services.heartbeat import manual_heartbeat, discovery_heartbeat, global_match_heartbeat

router = APIRouter(prefix="/api/discovery", tags=["discovery"])


@router.get("/heartbeat-logs", response_model=list[HeartbeatLogOut])
async def get_heartbeat_logs(
    shrimp_id: str = Query(...),
    limit: int = Query(20, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Get recent heartbeat activity logs for a shrimp."""
    result = await db.execute(
        select(HeartbeatLog)
        .where(HeartbeatLog.shrimp_id == shrimp_id)
        .order_by(HeartbeatLog.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


@router.post("/trigger-heartbeat")
async def trigger_heartbeat(shrimp_id: str = Query(..., description="The user's shrimp ID")):
    """Debug: manually trigger heartbeat for a specific shrimp. Friends auto-reply."""
    result = await manual_heartbeat(shrimp_id)
    return {"ok": True, **result}


@router.post("/discover-heartbeat")
async def trigger_discover_heartbeat(
    request: Request,
    shrimp_id: str = Query(..., description="The user's shrimp ID"),
    max_distance: float = Query(50.0),
):
    """Locate user → LLM picks interesting strangers → auto-start conversations."""
    client_ip = (
        request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        or request.headers.get("X-Real-IP", "")
        or (request.client.host if request.client else "")
    )
    result = await discovery_heartbeat(shrimp_id, max_distance, client_ip=client_ip)
    return {"ok": True, **result}


@router.get("/nearby/{shrimp_id}", response_model=list[ShrimpDiscovery])
async def discover_nearby(
    shrimp_id: str,
    limit: int = Query(20, le=50),
    max_distance: float = Query(10.0),
    db: AsyncSession = Depends(get_db),
):
    me = await db.get(Shrimp, shrimp_id)
    if not me:
        return []

    result = await db.execute(select(Shrimp).where(Shrimp.id != shrimp_id))
    others = result.scalars().all()

    # Find which shrimps are bots (no User account)
    user_result = await db.execute(select(User.shrimp_id))
    real_shrimp_ids = {row[0] for row in user_result.all() if row[0]}

    scored = []
    for other in others:
        # Bots get virtual coordinates near the querying user
        is_bot = other.id not in real_shrimp_ids
        if is_bot and me.location_lat and me.location_lng:
            olat, olng = virtual_bot_coords(other.id, me.location_lat, me.location_lng)
        else:
            olat, olng = other.location_lat, other.location_lng

        dist, interest, combined = match_score(
            me.interests, other.interests,
            me.location_lat, me.location_lng,
            olat, olng,
            max_distance=max_distance,
        )
        scored.append(ShrimpDiscovery(
            **{k: getattr(other, k) for k in ShrimpDiscovery.model_fields if hasattr(other, k) and k not in ("distance", "interest_score", "match_score")},
            distance=round(dist, 4),
            interest_score=round(interest, 4),
            match_score=round(combined, 4),
        ))

    # Filter to shrimps within max_distance (km) and sort by match
    scored = [s for s in scored if s.distance <= max_distance]

    scored.sort(key=lambda x: x.match_score, reverse=True)
    return scored[:limit]


@router.post("/global-match")
async def trigger_global_match(
    shrimp_id: str = Query(..., description="The user's shrimp ID"),
):
    """Global matchmaking: find best matches across all platform users."""
    result = await global_match_heartbeat(shrimp_id)
    return {"ok": True, **result}
