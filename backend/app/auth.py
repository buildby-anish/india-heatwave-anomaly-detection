"""Tiny signed-token auth for the demo (HMAC-SHA256, no external deps)."""
import base64
import hashlib
import hmac
import json
import time
from typing import Optional

from .config import AUTH_SECRET, DEMO_USERS

TTL_SECONDS = 12 * 3600


def _sign(payload: bytes) -> str:
    return base64.urlsafe_b64encode(hmac.new(AUTH_SECRET.encode(), payload, hashlib.sha256).digest()).decode().rstrip("=")


def authenticate(username: str, password: str) -> Optional[dict]:
    u = DEMO_USERS.get(username.strip().lower())
    if u and hmac.compare_digest(u["password"], password):
        return {"username": username.strip().lower(), "role": u["role"], "name": u["name"]}
    return None


def make_token(user: dict) -> str:
    body = json.dumps({"u": user["username"], "r": user["role"], "n": user["name"], "exp": int(time.time()) + TTL_SECONDS}).encode()
    return base64.urlsafe_b64encode(body).decode().rstrip("=") + "." + _sign(body)


def read_token(token: Optional[str]) -> Optional[dict]:
    if not token or "." not in token:
        return None
    b64, sig = token.rsplit(".", 1)
    try:
        body = base64.urlsafe_b64decode(b64 + "=" * (-len(b64) % 4))
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        d = json.loads(body)
    except Exception:
        return None
    if d.get("exp", 0) < time.time():
        return None
    return {"username": d["u"], "role": d["r"], "name": d["n"]}
