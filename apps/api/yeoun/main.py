import asyncio
import base64
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select, text, update
from sqlalchemy.exc import IntegrityError

from .billing import adjust_credits
from .billing import router as billing_router
from .branching import (
    action_metadata,
    branch_result,
    checkpoints_for,
    clone_checkpoint,
    existing_branch,
    queue_turn,
    save_checkpoint,
)
from .catalog import CHARACTERS, RETIRED_IDS
from .config import settings
from .db import SessionLocal, database, engine
from .memory_context import invalidate_fact
from .models import (
    AuthSession,
    Base,
    BranchRequest,
    Character,
    Conversation,
    Feedback,
    Ledger,
    Memory,
    Message,
    Payment,
    StreamEvent,
    Turn,
    User,
)
from .schemas import (
    AccountIn,
    BranchIn,
    CharacterIn,
    ConfirmIn,
    ConversationIn,
    FeedbackIn,
    GuestIn,
    MemoryEdit,
    MemoryIn,
    OrderIn,
    SettingsIn,
    TurnIn,
)
from .security import (
    digest,
    get_user,
    hash_password,
    issue_session,
    rate_limit,
    verify_password,
)
from .worker import OnDemandWorker

cfg = settings()
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app):
    cfg.validate_runtime()
    if cfg.auto_create_schema:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        # Keep historical messages exportable while removing the old cast from the service.
        await db.execute(
            update(Character)
            .where(Character.id.in_(RETIRED_IDS), Character.owner_id.is_(None))
            .values(published=False)
        )
        for data in CHARACTERS:
            existing = await db.get(Character, data["id"])
            if existing is None:
                db.add(Character(id=data["id"], payload=data, published=True))
            elif existing.owner_id is None:
                existing.payload = data
                existing.published = True
        await db.commit()
    app.state.worker = OnDemandWorker() if cfg.run_worker else None
    try:
        if app.state.worker:
            await app.state.worker.start()
        yield
    finally:
        if app.state.worker:
            await app.state.worker.stop()
        app.state.worker = None
        await engine.dispose()


app = FastAPI(title="Talevi API", version="0.2.0", lifespan=lifespan)
app.include_router(billing_router)
origins = [cfg.web_origin] + [
    x.strip() for x in cfg.extra_origins.split(",") if x.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-Yeoun-Client", "Last-Event-ID"],
)


@app.middleware("http")
async def guards(request, call_next):
    if request.method in ("POST", "PATCH", "DELETE", "PUT"):
        if request.headers.get("origin") and request.headers["origin"] not in origins:
            return Response(status_code=403)
        if (
            request.url.path != "/v1/webhooks/revenuecat"
            and request.headers.get("x-yeoun-client") != "1"
        ):
            return Response(status_code=403)
        try:
            if int(request.headers.get("content-length", "0") or 0) > 24000:
                return Response(status_code=413)
        except ValueError:
            return Response(status_code=400)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


async def owned_conversation(db, user, cid, lock=False):
    q = select(Conversation).where(
        Conversation.id == cid, Conversation.user_id == user.id
    )
    if lock:
        q = q.with_for_update()
    c = (await db.execute(q)).scalar_one_or_none()
    if not c or c.character_id in RETIRED_IDS:
        raise HTTPException(404, "대화를 찾을 수 없어요.")
    return c


def public_character(c):
    return {k: v for k, v in c.payload.items() if k not in ("secret", "voice", "world")}


def user_json(u):
    return {
        "id": u.id,
        "nickname": u.nickname,
        "email": u.email,
        "credits": u.credits,
        "locale": u.locale,
    }


def message_json(m, capabilities=None):
    return {
        "id": m.id,
        "role": m.role,
        "content": m.content,
        "status": m.status,
        "created": m.created,
        "turn_id": m.turn_id,
        **(
            capabilities
            or {
                "actions": {"branch": False, "regenerate": False, "edit": False},
                "action_cost": 0,
            }
        ),
    }


def memory_json(m):
    return {
        "id": m.id,
        "key": m.key,
        "value": m.value,
        "source_id": m.source_id,
        "locked": m.locked,
        "updated": m.updated,
    }


@app.get("/health")
async def health():
    # Hosting liveness probes must not prevent Neon from scaling to zero.
    return {
        "ok": True,
        "mode": "demo" if cfg.demo_mode else "live",
        "ai_configured": bool(cfg.openai_api_key),
        "payments_configured": bool(cfg.toss_secret_key and cfg.toss_client_key),
    }


@app.get("/ready")
async def ready(db=Depends(database)):
    # Explicit deployment diagnostics only; never configure as a periodic probe.
    await db.execute(text("SELECT 1"))
    return {"ok": True}


def wake_worker(request):
    worker = getattr(request.app.state, "worker", None)
    if worker:
        worker.wake()


@app.post("/v1/auth/guest")
async def guest(
    body: GuestIn, request: Request, response: Response, db=Depends(database)
):
    try:
        u = await get_user(request, db)
        token = await issue_session(db, u, response, True) if body.native else None
        await db.commit()
        return {"user": user_json(u), "token": token}
    except HTTPException:
        pass
    await rate_limit(db, "guest:" + request.client.host, 10, 3600)
    u = User()
    db.add(u)
    await db.flush()
    db.add(
        Ledger(
            user_id=u.id, reference="welcome:" + u.id, delta=30, reason="첫 만남 선물"
        )
    )
    token = await issue_session(db, u, response, body.native)
    await db.commit()
    return {"user": user_json(u), "token": token}


@app.post("/v1/auth/register")
async def register(
    body: AccountIn, request: Request, response: Response, db=Depends(database)
):
    await rate_limit(db, "register:" + request.client.host, 5, 3600)
    try:
        u = await get_user(request, db)
    except HTTPException:
        u = User(credits=30)
        db.add(u)
        await db.flush()
        db.add(
            Ledger(
                user_id=u.id,
                reference="welcome:" + u.id,
                delta=30,
                reason="첫 만남 선물",
            )
        )
    if u.email:
        raise HTTPException(409, "이미 저장된 계정이에요.")
    u.email = body.email
    u.nickname = body.nickname
    u.password_hash = await hash_password(body.password)
    token = await issue_session(db, u, response, body.native)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "가입할 수 없는 이메일이에요. 로그인해 주세요.")
    return {"user": user_json(u), "token": token}


@app.post("/v1/auth/login")
async def login(
    body: AccountIn, request: Request, response: Response, db=Depends(database)
):
    await rate_limit(db, "login:" + request.client.host, 20, 600)
    u = (
        await db.execute(select(User).where(User.email == body.email))
    ).scalar_one_or_none()
    # Fixed dummy hash work for unknown accounts prevents fast user enumeration.
    if not u or not u.password_hash:
        await hash_password(body.password)
        raise HTTPException(401, "이메일 또는 비밀번호를 확인해 주세요.")
    if not await verify_password(u.password_hash, body.password):
        raise HTTPException(401, "이메일 또는 비밀번호를 확인해 주세요.")
    token = await issue_session(db, u, response, body.native)
    await db.commit()
    return {"user": user_json(u), "token": token}


@app.post("/v1/auth/logout")
async def logout(request: Request, response: Response, db=Depends(database)):
    header = request.headers.get("authorization", "")
    token = (
        header[7:]
        if header.startswith("Bearer ")
        else request.cookies.get("yeoun_session", "")
    )
    auth = await db.get(AuthSession, digest(token))
    if auth:
        await db.delete(auth)
        await db.commit()
    response.delete_cookie("yeoun_session", path="/")
    return {"ok": True}


@app.get("/v1/me")
async def me(request: Request, db=Depends(database)):
    return user_json(await get_user(request, db))


@app.get("/v1/characters")
async def characters(request: Request, db=Depends(database)):
    owner = None
    try:
        owner = (await get_user(request, db)).id
    except HTTPException:
        pass
    rows = (
        await db.scalars(
            select(Character).where(
                or_(Character.published == True, Character.owner_id == owner)
                if owner
                else Character.published == True
            )
        )
    ).all()
    order = {c["id"]: i for i, c in enumerate(CHARACTERS)}
    return [
        public_character(c)
        for c in sorted(rows, key=lambda c: (order.get(c.id, len(order)), c.id))
    ]


@app.post("/v1/characters")
async def create_character(body: CharacterIn, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    await rate_limit(db, "create:" + u.id, 10, 3600)
    d = body.model_dump()
    appearance = {k: d.pop(k) for k in ["face", "hair", "build", "signature"]}
    d.update(
        id=str(uuid.uuid4()),
        appearance=appearance,
        tags=["내 캐릭터"],
        image="",
        color="#9e647f",
        headline=body.role,
        secret="",
        starters=["안녕, 만나서 반가워."],
    )
    c = Character(id=d["id"], owner_id=u.id, payload=d, published=False)
    db.add(c)
    await db.commit()
    return public_character(c)


@app.get("/v1/conversations")
async def conversations(request: Request, db=Depends(database)):
    u = await get_user(request, db)
    rows = (
        await db.scalars(
            select(Conversation)
            .where(
                Conversation.user_id == u.id,
                Conversation.character_id.not_in(RETIRED_IDS),
            )
            .order_by(Conversation.updated.desc())
        )
    ).all()
    return [
        {
            "id": c.id,
            "character_id": c.character_id,
            "relationship": c.relationship,
            "updated": c.updated,
            "branch": c.branch,
        }
        for c in rows
    ]


@app.post("/v1/conversations")
async def new_conversation(
    body: ConversationIn, request: Request, db=Depends(database)
):
    u = await get_user(request, db)
    await rate_limit(db, "conversation:" + u.id, 30, 60)
    char = await db.get(Character, body.character_id)
    if not char or (not char.published and char.owner_id != u.id):
        raise HTTPException(404, "캐릭터를 찾을 수 없어요.")
    c = Conversation(user_id=u.id, character_id=char.id)
    db.add(c)
    await db.flush()
    opening = Message(
        conversation_id=c.id, role="assistant", content=char.payload["opening"]
    )
    db.add(opening)
    await db.flush()
    await save_checkpoint(db, c, opening, "after")
    await db.commit()
    return {"id": c.id}


@app.get("/v1/conversations/{cid}")
async def conversation(cid: str, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    c = await owned_conversation(db, u, cid)
    msgs = (
        await db.scalars(
            select(Message)
            .where(Message.conversation_id == cid)
            .order_by(Message.created.desc(), Message.id.desc())
            .limit(1000)
        )
    ).all()
    mem = (
        await db.scalars(
            select(Memory)
            .where(Memory.conversation_id == cid, Memory.deleted == False)
            .order_by(Memory.updated.desc())
        )
    ).all()
    checkpoints = {
        (p.message_id, p.phase): p
        for p in await checkpoints_for(db, cid, with_state=False)
    }
    return {
        "id": c.id,
        "character_id": c.character_id,
        "branch": c.branch,
        "messages": [
            message_json(m, action_metadata(m, checkpoints, bool(c.active_turn)))
            for m in reversed(msgs)
        ],
        "memories": [memory_json(m) for m in mem],
        "settings": {k: v for k, v in c.settings.items() if k != "context_reset_at"},
        "relationship": c.relationship,
        "narrative": c.narrative,
        "active_turn": c.active_turn,
    }


@app.patch("/v1/conversations/{cid}/settings")
async def set_settings(
    cid: str, body: SettingsIn, request: Request, db=Depends(database)
):
    u = await get_user(request, db)
    c = await owned_conversation(db, u, cid, True)
    if c.active_turn:
        raise HTTPException(409, "답변이 끝난 뒤 설정을 바꿔 주세요.")
    c.settings = {**c.settings, **body.model_dump()}
    await db.commit()
    return body


@app.post("/v1/conversations/{cid}/turns", status_code=202)
async def submit_turn(cid: str, body: TurnIn, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    await rate_limit(db, "turn:" + u.id, 30, 60)
    if not cfg.demo_mode and not cfg.openai_api_key:
        raise HTTPException(
            503, "AI 연결을 준비하고 있어요. 잠시 후 다시 시도해 주세요."
        )
    c = await owned_conversation(db, u, cid, True)
    await db.execute(select(User.id).where(User.id == u.id).with_for_update())
    if (
        await db.scalars(
            select(BranchRequest).where(
                BranchRequest.user_id == u.id, BranchRequest.client_id == body.client_id
            )
        )
    ).first():
        raise HTTPException(409, "다른 작업에 사용한 요청 번호예요.")
    fingerprint = digest(
        json.dumps(
            {"cid": cid, **body.model_dump(exclude={"client_id"})},
            sort_keys=True,
            ensure_ascii=False,
        )
    )
    existing = (
        await db.execute(
            select(Turn).where(Turn.user_id == u.id, Turn.client_id == body.client_id)
        )
    ).scalar_one_or_none()
    if existing:
        if existing.fingerprint != fingerprint:
            raise HTTPException(409, "같은 전송 번호로 다른 내용을 보낼 수 없어요.")
        if existing.status in ("pending", "generating"):
            wake_worker(request)
        return {"id": existing.id, "status": existing.status, "cost": existing.cost}
    if c.active_turn:
        raise HTTPException(409, "이전 답변을 기다려 주세요.")
    t = await queue_turn(db, u, c, body, fingerprint)
    await db.commit()
    wake_worker(request)
    return {"id": t.id, "status": t.status, "cost": t.cost}


@app.post("/v1/conversations/{cid}/branches", status_code=202)
async def create_branch(
    cid: str, body: BranchIn, request: Request, db=Depends(database)
):
    u = await get_user(request, db)
    await rate_limit(db, "branch:" + u.id, 30, 60)
    source = await owned_conversation(db, u, cid, True)
    await db.execute(select(User.id).where(User.id == u.id).with_for_update())
    fingerprint = digest(
        json.dumps(
            {"cid": cid, **body.model_dump(exclude={"client_id"})},
            sort_keys=True,
            ensure_ascii=False,
        )
    )
    previous = await existing_branch(db, u, body, fingerprint)
    if previous:
        if previous.turn_id:
            wake_worker(request)
        return await branch_result(db, previous)
    if (
        await db.scalars(
            select(Turn).where(Turn.user_id == u.id, Turn.client_id == body.client_id)
        )
    ).first():
        raise HTTPException(409, "다른 작업에 사용한 요청 번호예요.")
    if source.active_turn:
        raise HTTPException(409, "답변이 끝난 뒤 이야기를 나눠 주세요.")
    anchor = await db.get(Message, body.message_id)
    if not anchor or anchor.conversation_id != cid:
        raise HTTPException(404, "메시지를 찾을 수 없어요.")
    checkpoints = await checkpoints_for(db, cid)
    if not action_metadata(anchor, checkpoints)["actions"][body.action]:
        raise HTTPException(
            409,
            "이 메시지는 당시 상태가 저장되지 않아 복원할 수 없어요. 새 대화부터 이용해 주세요.",
        )
    by_anchor = {(p.message_id, p.phase): p for p in checkpoints}
    selected = by_anchor[(anchor.id, "before" if body.action == "edit" else "after")]
    replay = selected.replay
    if body.action == "regenerate":
        selected = by_anchor[(replay["user_message_id"], "before")]
    if body.action != "branch" and not cfg.demo_mode and not cfg.openai_api_key:
        raise HTTPException(
            503, "AI 연결을 준비하고 있어요. 잠시 후 다시 시도해 주세요."
        )
    clone = await clone_checkpoint(
        db, u, source, anchor, selected, body.action, checkpoints
    )
    turn = None
    if body.action != "branch":
        replay_body = TurnIn(
            client_id=body.client_id,
            content=body.content if body.action == "edit" else replay["content"],
            mode=replay["mode"],
            story_event=replay["story_event"],
        )
        turn = await queue_turn(db, u, clone, replay_body, fingerprint)
    receipt = BranchRequest(
        user_id=u.id,
        client_id=body.client_id,
        fingerprint=fingerprint,
        conversation_id=clone.id,
        turn_id=turn.id if turn else None,
        cost=turn.cost if turn else 0,
    )
    db.add(receipt)
    await db.commit()
    if turn:
        wake_worker(request)
    return await branch_result(db, receipt)


@app.get("/v1/turns/{tid}/events")
async def events(
    tid: str, request: Request, after: int = Query(0, ge=0), db=Depends(database)
):
    u = await get_user(request, db)
    t = await db.get(Turn, tid)
    if not t or t.user_id != u.id:
        raise HTTPException(404, "답변을 찾을 수 없어요.")
    try:
        cursor = max(after, int(request.headers.get("last-event-id", "0")))
    except ValueError:
        raise HTTPException(400, "잘못된 이벤트 위치예요.")
    if t.status in ("pending", "generating"):
        wake_worker(request)

    async def generate():
        pos = cursor
        last_heartbeat = time.monotonic()
        while not await request.is_disconnected():
            async with SessionLocal() as session:
                rows = (
                    await session.scalars(
                        select(StreamEvent)
                        .where(StreamEvent.turn_id == tid, StreamEvent.id > pos)
                        .order_by(StreamEvent.id)
                        .limit(200)
                    )
                ).all()
                current = await session.get(Turn, tid)
            for e in rows:
                pos = e.id
                yield f"id: {e.id}\nevent: {e.event}\ndata: {json.dumps(e.data, ensure_ascii=False)}\n\n"
            if not current or (
                current.status in ("completed", "failed") and len(rows) < 200
            ):
                break
            if time.monotonic() - last_heartbeat > 10:
                yield ": heartbeat\n\n"
                last_heartbeat = time.monotonic()
            await asyncio.sleep(0.15)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache, no-transform"},
    )


@app.post("/v1/conversations/{cid}/memories")
async def add_memory(cid: str, body: MemoryIn, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    c = await owned_conversation(db, u, cid, True)
    if c.active_turn:
        raise HTTPException(409, "답변이 끝난 뒤 기억을 바꿔 주세요.")
    rows = (await db.scalars(select(Memory).where(Memory.conversation_id == cid))).all()
    memory = next((m for m in rows if m.key == body.key), None)
    if len(rows) >= 30 and not memory:
        raise HTTPException(400, "기억은 30개까지 저장할 수 있어요.")
    if memory:
        if memory.value != body.value:
            await invalidate_fact(db, c, memory.value)
        memory.value = body.value
        memory.locked = True
        memory.deleted = False
        memory.updated = time.time()
        memory.source_id = (
            None  # Manually authored value is not the old quoted message.
        )
    else:
        memory = Memory(
            conversation_id=cid, key=body.key, value=body.value, locked=True
        )
        db.add(memory)
    await db.commit()
    return memory_json(memory)


@app.patch("/v1/memories/{mid}")
async def edit_memory(
    mid: str, body: MemoryEdit, request: Request, db=Depends(database)
):
    u = await get_user(request, db)
    m = await db.get(Memory, mid)
    if not m:
        raise HTTPException(404, "기억을 찾을 수 없어요.")
    c = await owned_conversation(db, u, m.conversation_id, True)
    if c.active_turn:
        raise HTTPException(409, "답변이 끝난 뒤 기억을 바꿔 주세요.")
    if m.value != body.value:
        await invalidate_fact(db, c, m.value)
    m.value = body.value
    m.locked = True
    m.deleted = False
    m.updated = time.time()
    m.source_id = None
    await db.commit()
    return memory_json(m)


@app.delete("/v1/memories/{mid}")
async def delete_memory(mid: str, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    m = await db.get(Memory, mid)
    if not m:
        raise HTTPException(404, "기억을 찾을 수 없어요.")
    c = await owned_conversation(db, u, m.conversation_id, True)
    if c.active_turn:
        raise HTTPException(409, "답변이 끝난 뒤 기억을 바꿔 주세요.")
    await invalidate_fact(db, c, m.value)
    m.value = ""
    m.deleted = True
    m.locked = True
    m.source_id = None
    await db.commit()
    return {"ok": True}


@app.delete("/v1/conversations/{cid}/episodes")
async def delete_episodes(cid: str, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    c = await owned_conversation(db, u, cid, True)
    if c.active_turn:
        raise HTTPException(409, "답변이 끝난 뒤 기억을 바꿔 주세요.")
    c.narrative = {
        k: v
        for k, v in c.narrative.items()
        if k not in ("episode_notes", "episode_cutoff", "story_slots", "developments")
    }
    c.relationship = {
        k: v for k, v in c.relationship.items() if k not in ("changes", "last_change")
    }
    c.settings = {**c.settings, "context_reset_at": time.time()}
    await db.commit()
    return {"ok": True}


@app.post("/v1/feedback")
async def feedback(body: FeedbackIn, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    m = await db.get(Message, body.message_id)
    if not m:
        raise HTTPException(404, "메시지를 찾을 수 없어요.")
    await owned_conversation(db, u, m.conversation_id)
    db.add(Feedback(user_id=u.id, **body.model_dump()))
    await db.commit()
    return {"ok": True}


@app.get("/v1/wallet")
async def wallet(request: Request, db=Depends(database)):
    u = await get_user(request, db)
    entries = (
        await db.scalars(
            select(Ledger)
            .where(Ledger.user_id == u.id)
            .order_by(Ledger.created.desc())
            .limit(50)
        )
    ).all()
    return {
        "credits": u.credits,
        "entries": [
            {"id": e.id, "delta": e.delta, "reason": e.reason, "created": e.created}
            for e in entries
        ],
        "demo": cfg.demo_mode,
        "client_key": cfg.toss_client_key,
        "available": cfg.demo_mode or bool(cfg.toss_client_key and cfg.toss_secret_key),
    }


SKUS = {"light-500": (4900, 500), "light-1200": (9900, 1200)}


@app.post("/v1/payments/orders")
async def order(body: OrderIn, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    await rate_limit(db, "order:" + u.id, 10, 60)
    if not cfg.demo_mode and not u.email:
        raise HTTPException(403, "결제 전에 계정을 저장해 주세요.")
    if not cfg.demo_mode and not (cfg.toss_secret_key and cfg.toss_client_key):
        raise HTTPException(503, "결제 연결을 준비하고 있어요.")
    amount, credits = SKUS[body.sku]
    p = Payment(user_id=u.id, sku=body.sku, amount=amount, credits=credits)
    db.add(p)
    await db.commit()
    return {
        "id": p.id,
        "amount": amount,
        "credits": credits,
        "customer_key": u.id,
        "demo": cfg.demo_mode,
        "client_key": cfg.toss_client_key,
    }


@app.post("/v1/payments/confirm")
async def confirm(body: ConfirmIn, request: Request, db=Depends(database)):
    u = await get_user(request, db)
    await rate_limit(db, "confirm:" + u.id, 20, 60)
    p = (
        await db.execute(
            select(Payment)
            .where(Payment.id == body.order_id, Payment.user_id == u.id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "주문을 찾을 수 없어요.")
    if body.amount != p.amount:
        raise HTTPException(400, "결제 금액이 주문과 달라요.")
    if p.status == "paid":
        return {"ok": True, "credits_added": p.credits, "already_processed": True}
    if cfg.demo_mode:
        if body.payment_key != "demo:" + p.id:
            raise HTTPException(400, "테스트 결제 번호가 달라요.")
    else:
        if not cfg.toss_secret_key:
            raise HTTPException(503, "결제가 준비되지 않았어요.")
        auth = base64.b64encode((cfg.toss_secret_key + ":").encode()).decode()
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(
                    "https://api.tosspayments.com/v1/payments/confirm",
                    headers={"Authorization": "Basic " + auth, "Idempotency-Key": p.id},
                    json={
                        "paymentKey": body.payment_key,
                        "orderId": p.id,
                        "amount": p.amount,
                    },
                )
                if r.status_code >= 400:
                    # Recover uncertain approvals using the provider's authoritative record.
                    r = await client.get(
                        "https://api.tosspayments.com/v1/payments/" + body.payment_key,
                        headers={"Authorization": "Basic " + auth},
                    )
                if r.status_code != 200:
                    raise HTTPException(
                        502,
                        "결제 승인을 확인하지 못했어요. 같은 주문으로 다시 확인해 주세요.",
                    )
                data = r.json()
                if (
                    data.get("status") != "DONE"
                    or data.get("orderId") != p.id
                    or data.get("totalAmount") != p.amount
                    or data.get("currency") != "KRW"
                ):
                    raise HTTPException(400, "승인 정보가 주문과 일치하지 않아요.")
        except httpx.HTTPError:
            raise HTTPException(
                502, "결제 상태를 확인 중이에요. 잠시 후 다시 확인해 주세요."
            )
    p.status = "paid"
    p.payment_key = body.payment_key
    await adjust_credits(
        db,
        u.id,
        p.credits,
        "payment:" + p.id,
        "테스트 충전" if cfg.demo_mode else "빛 충전",
    )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "이미 처리한 결제예요.")
    return {"ok": True, "credits_added": p.credits, "already_processed": False}


@app.get("/v1/export")
async def export(request: Request, db=Depends(database)):
    u = await get_user(request, db)
    convs = (
        await db.scalars(select(Conversation).where(Conversation.user_id == u.id))
    ).all()
    records = []
    for c in convs:
        msgs = (
            await db.scalars(
                select(Message)
                .where(Message.conversation_id == c.id)
                .order_by(Message.created)
            )
        ).all()
        memories = (
            await db.scalars(
                select(Memory).where(
                    Memory.conversation_id == c.id, Memory.deleted == False
                )
            )
        ).all()
        records.append(
            {
                "id": c.id,
                "character_id": c.character_id,
                "messages": [message_json(m) for m in msgs],
                "memories": [memory_json(m) for m in memories],
                "relationship": c.relationship,
            }
        )
    return {"user": user_json(u), "conversations": records}
