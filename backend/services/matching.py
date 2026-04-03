import math
import hashlib

EARTH_RADIUS_KM = 6371.0


def virtual_bot_coords(bot_id: str, user_lat: float, user_lng: float, radius_km: float = 3.0) -> tuple[float, float]:
    """Generate a stable virtual coordinate for a bot near the querying user.
    Uses hash of bot_id for deterministic but varied offsets."""
    h = hashlib.md5(bot_id.encode()).hexdigest()
    angle = (int(h[:8], 16) / 0xFFFFFFFF) * 2 * math.pi
    frac = 0.3 + (int(h[8:16], 16) / 0xFFFFFFFF) * 0.7  # 30%-100% of radius
    dist_km = radius_km * frac
    # Convert km offset to degrees
    dlat_deg = (dist_km * math.cos(angle) / EARTH_RADIUS_KM) * (180 / math.pi)
    dlng_deg = (dist_km * math.sin(angle) / EARTH_RADIUS_KM) * (180 / math.pi) / max(math.cos(math.radians(user_lat)), 0.01)
    return user_lat + dlat_deg, user_lng + dlng_deg


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return great-circle distance in kilometres between two lat/lng points."""
    lat1, lng1, lat2, lng2 = map(math.radians, (lat1, lng1, lat2, lng2))
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def jaccard_similarity(set_a: list[str], set_b: list[str]) -> float:
    a, b = set(s.lower() for s in set_a), set(s.lower() for s in set_b)
    if not a and not b:
        return 0.0
    intersection = a & b
    union = a | b
    return len(intersection) / len(union) if union else 0.0


def match_score(
    interest_a: list[str],
    interest_b: list[str],
    lat_a: float, lng_a: float,
    lat_b: float, lng_b: float,
    max_distance: float = 1.0,
) -> tuple[float, float, float]:
    """Returns (distance, interest_score, combined_score)."""
    dist = haversine_km(lat_a, lng_a, lat_b, lng_b)
    interest = jaccard_similarity(interest_a, interest_b)
    # Normalize distance to 0-1 (closer = higher score)
    dist_score = max(0.0, 1.0 - dist / max_distance) if max_distance > 0 else 0.0
    combined = 0.4 * interest + 0.6 * dist_score
    return dist, interest, combined


def _mbti_compatibility(mbti_a: str, mbti_b: str) -> float:
    """Simple MBTI compatibility: fraction of matching letters."""
    a, b = mbti_a.upper().strip(), mbti_b.upper().strip()
    if len(a) != 4 or len(b) != 4:
        return 0.0
    return sum(1 for x, y in zip(a, b) if x == y) / 4.0


def _text_keyword_overlap(text_a: str, text_b: str) -> float:
    """Simple keyword overlap between two text fields."""
    a_words = set(text_a.lower().replace("，", " ").replace(",", " ").split())
    b_words = set(text_b.lower().replace("，", " ").replace(",", " ").split())
    a_words.discard("")
    b_words.discard("")
    if not a_words or not b_words:
        return 0.0
    return len(a_words & b_words) / len(a_words | b_words)


def global_match_score(shrimp_a, shrimp_b) -> tuple[float, dict]:
    """Compute compatibility score without geographic distance."""
    interest = jaccard_similarity(shrimp_a.interests, shrimp_b.interests)
    personality = jaccard_similarity(shrimp_a.personality, shrimp_b.personality)
    mbti = _mbti_compatibility(shrimp_a.mbti, shrimp_b.mbti)
    style = _text_keyword_overlap(shrimp_a.chat_style, shrimp_b.chat_style)
    goal = _text_keyword_overlap(shrimp_a.social_goal, shrimp_b.social_goal)

    combined = 0.30 * interest + 0.20 * personality + 0.20 * mbti + 0.15 * style + 0.15 * goal
    breakdown = {"interest": interest, "personality": personality, "mbti": mbti, "style": style, "goal": goal}
    return combined, breakdown
