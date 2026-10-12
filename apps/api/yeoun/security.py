import asyncio
import hashlib
import secrets
import time

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException, Request
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sq_insert

from .config import settings
from .models import AuthSession, RateBucket, User

ph = PasswordHasher()


def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()


async def get_user(request: Request, db):
    header = request.headers.get("authorization", "")
    token = (
        header[7:]
        if header.startswith("Bearer ")
        else request.cookies.get("yeoun_session", "")
    )
    auth = await db.get(AuthSession, digest(token)) if token else None
    if not auth or auth.expires < time.time():
        raise HTTPException(401, "다시 로그인해 주세요.")
    user = await db.get(User, auth.user_id)
    if not user:
        raise HTTPException(401, "계정을 찾을 수 없어요.")
    return user


async def issue_session(db, user, response, native=False):
    token = secrets.token_urlsafe(48)
    db.add(
        AuthSession(
            token_hash=digest(token),
            user_id=user.id,
            expires=time.time() + 86400 * settings().session_days,
        )
    )
    response.set_cookie(
        "yeoun_session",
        token,
        httponly=True,
        secure=settings().production,
        samesite="strict",
        max_age=86400 * settings().session_days,
        path="/",
    )
    return token if native else None


async def rate_limit(db, key, limit=20, seconds=60):
    bucket = f"{digest(key)}:{int(time.time()) // seconds}"
    ins = pg_insert if db.bind.dialect.name == "postgresql" else sq_insert
    q = ins(RateBucket).values(key=bucket, count=1, expires=time.time() + seconds * 2)
    q = q.on_conflict_do_update(
        index_elements=["key"], set_={"count": RateBucket.count + 1}
    ).returning(RateBucket.count)
    count = (await db.execute(q)).scalar_one()
    await db.commit()
    if count > limit:
        raise HTTPException(
            429,
            "잠시 쉬었다가 다시 시도해 주세요.",
            headers={"Retry-After": str(seconds)},
        )


async def hash_password(password):
    return await asyncio.to_thread(ph.hash, password)


async def verify_password(encoded, password):
    try:
        return await asyncio.to_thread(ph.verify, encoded, password)
    except (VerificationError, InvalidHashError):
        return False
