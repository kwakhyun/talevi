import asyncio
import time
import uuid

from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from yeoun.db import SessionLocal
from yeoun.engine import extract_memories, relationship_next
from yeoun.main import app, cfg
from yeoun.models import Conversation, Turn, User
from yeoun.worker import finish, process_turn, recover


async def start(client, character="seah"):
    r = await client.post("/v1/auth/guest", json={})
    assert r.status_code == 200, r.text
    u = r.json()["user"]
    r = await client.post("/v1/conversations", json={"character_id": character})
    assert r.status_code == 200, r.text
    return u, r.json()["id"]


async def submit(client, cid, content="내 이름은 민지야.", **kw):
    body = {"client_id": str(uuid.uuid4()), "content": content, "mode": "quick", **kw}
    return await client.post(f"/v1/conversations/{cid}/turns", json=body), body


async def run(tid):
    async with SessionLocal() as db:
        await db.execute(
            update(Turn)
            .where(Turn.id == tid)
            .values(status="generating", started=time.time())
        )
        await db.commit()
    await process_turn(tid)


async def test_catalog_hides_secret(client):
    data = (await client.get("/v1/characters")).json()
    assert len(data) == 30
    assert all("secret" not in c and "voice" not in c for c in data)
    assert len(set(c["appearance"]["face"] for c in data)) == 30
    assert sum(c["gender"] == "여성" for c in data) == 15
    assert sum(c["gender"] == "남성" for c in data) == 15
    assert sum(c["art_style"] == "반실사" for c in data) == 15
    assert sum(c["art_style"] == "애니메이션" for c in data) == 15
    assert all(c["age"] >= 19 for c in data)
    assert len({c["image"] for c in data}) == 30
    new_ids = {
        "arin",
        "nari",
        "rina",
        "jiwoo",
        "soyul",
        "elise",
        "chaerin",
        "rumi",
        "daeun",
        "serena",
    }
    additions = [c for c in data if c["id"] in new_ids]
    assert len(additions) == 10
    assert all(c["gender"] == "여성" and 19 <= c["age"] <= 25 for c in additions)
    male_ids = {
        "taeo",
        "eunho",
        "doyun",
        "yujun",
        "sihyeok",
        "igyeol",
        "rohan",
        "siu",
        "yuchan",
        "astel",
    }
    male_additions = [c for c in data if c["id"] in male_ids]
    assert len(male_additions) == 10
    assert all(c["gender"] == "남성" and 19 <= c["age"] <= 25 for c in male_additions)
    assert sum(c["art_style"] == "반실사" for c in male_additions) == 5
    assert sum(c["art_style"] == "애니메이션" for c in male_additions) == 5


async def test_stream_memory_and_persistence(client):
    u, cid = await start(client)
    r, body = await submit(client, cid)
    assert r.status_code == 202
    tid = r.json()["id"]
    await run(tid)
    events = (await client.get(f"/v1/turns/{tid}/events")).text
    assert "event: delta" in events and "event: done" in events
    c = (await client.get("/v1/conversations/" + cid)).json()
    assert c["memories"][0]["value"] == "민지"
    assert len(c["messages"]) == 3 and c["active_turn"] is None
    assert (await client.get("/v1/me")).json()["credits"] == 29


async def test_same_request_is_not_billed_twice(client):
    u, cid = await start(client)
    r, body = await submit(client, cid)
    repeated = await client.post(f"/v1/conversations/{cid}/turns", json=body)
    assert repeated.json()["id"] == r.json()["id"]
    assert (await client.get("/v1/me")).json()["credits"] == 29


async def test_concurrent_duplicate_request(client):
    u, cid = await start(client)
    body = {"client_id": str(uuid.uuid4()), "content": "안녕하세요", "mode": "story"}
    a, b = await asyncio.gather(
        *(client.post(f"/v1/conversations/{cid}/turns", json=body) for _ in range(2))
    )
    assert a.status_code == b.status_code == 202
    assert a.json()["id"] == b.json()["id"]
    assert (await client.get("/v1/me")).json()["credits"] == 27


async def test_idempotency_rejects_changed_body(client):
    u, cid = await start(client)
    r, body = await submit(client, cid)
    body["content"] = "다른 메시지"
    assert (
        await client.post(f"/v1/conversations/{cid}/turns", json=body)
    ).status_code == 409


async def test_active_turn_serializes_conversation(client):
    u, cid = await start(client)
    await submit(client, cid)
    r, _ = await submit(client, cid, "동시에 또 보내기")
    assert r.status_code == 409


async def test_concurrent_wallet_cannot_go_negative(client):
    u, cid = await start(client)
    c2 = (
        await client.post("/v1/conversations", json={"character_id": "dogeon"})
    ).json()["id"]
    async with SessionLocal() as db:
        await db.execute(update(User).where(User.id == u["id"]).values(credits=1))
        await db.commit()
    responses = await asyncio.gather(submit(client, cid), submit(client, c2))
    assert sorted(r[0].status_code for r in responses) == [202, 402]
    assert (await client.get("/v1/me")).json()["credits"] == 0


async def test_failed_turn_refunded_once(client, monkeypatch):
    u, cid = await start(client)
    r, _ = await submit(client, cid)
    tid = r.json()["id"]

    async def broken(*args):
        yield ("delta", {"text": "부분 답변"})
        raise RuntimeError("provider failed")

    monkeypatch.setattr("yeoun.worker.stream_reply", broken)
    await run(tid)
    await finish(tid, error="generation_failed")
    assert (await client.get("/v1/me")).json()["credits"] == 30
    c = (await client.get("/v1/conversations/" + cid)).json()
    assert c["active_turn"] is None and c["memories"] == [] and len(c["messages"]) == 2
    assert c["relationship"]["trust"] == 0


async def test_stale_generation_recovers(client):
    u, cid = await start(client)
    r, _ = await submit(client, cid)
    tid = r.json()["id"]
    async with SessionLocal() as db:
        await db.execute(
            update(Turn)
            .where(Turn.id == tid)
            .values(status="generating", started=time.time() - 200)
        )
        await db.commit()
    await recover()
    await recover()
    assert (await client.get("/v1/me")).json()["credits"] == 30


async def test_cross_user_access_is_denied(client):
    u, cid = await start(client)
    r, _ = await submit(client, cid)
    tid = r.json()["id"]
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Yeoun-Client": "1"},
    ) as other:
        await other.post("/v1/auth/guest", json={})
        assert (await other.get("/v1/conversations/" + cid)).status_code == 404
        assert (await other.get("/v1/turns/" + tid + "/events")).status_code == 404
        assert (
            await other.post(
                "/v1/conversations/" + cid + "/memories",
                json={"key": "이름", "value": "다른 사람"},
            )
        ).status_code == 404


async def test_memory_edit_lock_and_delete(client):
    u, cid = await start(client)
    r, _ = await submit(client, cid)
    await run(r.json()["id"])
    m = (await client.get("/v1/conversations/" + cid)).json()["memories"][0]
    await client.patch("/v1/memories/" + m["id"], json={"value": "지우"})
    r, _ = await submit(client, cid, "내 이름은 해온이야.")
    await run(r.json()["id"])
    assert (await client.get("/v1/conversations/" + cid)).json()["memories"][0][
        "value"
    ] == "지우"
    await client.delete("/v1/memories/" + m["id"])
    r, _ = await submit(client, cid, "내 이름은 하늘이야.")
    await run(r.json()["id"])
    assert (await client.get("/v1/conversations/" + cid)).json()["memories"] == []
    async with SessionLocal() as db:
        c = await db.get(Conversation, cid)
        assert "context_reset_at" not in c.settings


async def test_disable_memory(client):
    u, cid = await start(client)
    await client.patch(
        f"/v1/conversations/{cid}/settings",
        json={"memory_enabled": False, "pace": "slow", "length": "short"},
    )
    r, _ = await submit(client, cid)
    await run(r.json()["id"])
    assert (await client.get("/v1/conversations/" + cid)).json()["memories"] == []


async def test_payment_confirm_idempotent(client):
    u, cid = await start(client)
    order = (await client.post("/v1/payments/orders", json={"sku": "light-500"})).json()
    body = {
        "order_id": order["id"],
        "payment_key": "demo:" + order["id"],
        "amount": 4900,
    }
    a, b = await asyncio.gather(
        *(client.post("/v1/payments/confirm", json=body) for _ in range(2))
    )
    assert a.status_code == b.status_code == 200
    assert (await client.get("/v1/me")).json()["credits"] == 530


async def test_payment_tampered_amount_and_owner(client):
    u, cid = await start(client)
    o = (await client.post("/v1/payments/orders", json={"sku": "light-500"})).json()
    assert (
        await client.post(
            "/v1/payments/confirm",
            json={"order_id": o["id"], "payment_key": "demo:" + o["id"], "amount": 1},
        )
    ).status_code == 400
    assert (await client.get("/v1/me")).json()["credits"] == 30


async def test_session_native_and_revocation(client):
    r = await client.post("/v1/auth/guest", json={"native": True})
    token = r.json()["token"]
    assert token
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": "Bearer " + token, "X-Yeoun-Client": "1"},
    ) as native:
        assert (await native.get("/v1/me")).status_code == 200
        await native.post("/v1/auth/logout")
        assert (await native.get("/v1/me")).status_code == 401


async def test_account_upgrade_preserves_conversation(client):
    u, cid = await start(client)
    r = await client.post(
        "/v1/auth/register",
        json={
            "email": "test@example.com",
            "password": "long-test-password",
            "nickname": "테스트",
            "native": True,
        },
    )
    assert r.status_code == 200 and r.json()["user"]["id"] == u["id"]
    await client.post("/v1/auth/logout")
    await client.post(
        "/v1/auth/login",
        json={"email": "test@example.com", "password": "long-test-password"},
    )
    assert (await client.get("/v1/conversations/" + cid)).status_code == 200


async def test_csrf_and_input_validation(client):
    u, cid = await start(client)
    bad = await client.post(
        "/v1/conversations",
        json={"character_id": "seah"},
        headers={"Origin": "https://evil.example"},
    )
    assert bad.status_code == 403
    r, _ = await submit(client, cid, "   ")
    assert r.status_code == 422
    r, _ = await submit(client, cid, "a" * 3001)
    assert r.status_code == 422


async def test_event_resume_and_feedback(client):
    u, cid = await start(client)
    r, _ = await submit(client, cid)
    tid = r.json()["id"]
    await run(tid)
    all_events = (await client.get(f"/v1/turns/{tid}/events")).text
    ids = [int(x[4:]) for x in all_events.splitlines() if x.startswith("id: ")]
    remainder = (await client.get(f"/v1/turns/{tid}/events?after={ids[-2]}")).text
    assert "event: done" in remainder and "event: delta" not in remainder
    c = (await client.get("/v1/conversations/" + cid)).json()
    assert (
        await client.post(
            "/v1/feedback",
            json={"message_id": c["messages"][-1]["id"], "reason": "좋아요"},
        )
    ).status_code == 200


async def test_user_export(client):
    u, cid = await start(client)
    result = (await client.get("/v1/export")).json()
    assert (
        result["conversations"][0]["id"] == cid
        and "password_hash" not in result["user"]
    )


async def test_live_missing_key_does_not_charge(client, monkeypatch):
    u, cid = await start(client)
    monkeypatch.setattr(cfg, "demo_mode", False)
    monkeypatch.setattr(cfg, "openai_api_key", "")
    r, _ = await submit(client, cid)
    assert r.status_code == 503
    assert (await client.get("/v1/me")).json()["credits"] == 30


def test_precise_name_extraction():
    assert extract_memories("내 이름은 해온이야.") == [("이름", "해온")]
    assert extract_memories("친구 이름은 민지야") == []
    assert extract_memories("나는 재즈를 좋아해.") == [("좋아하는 것", "재즈")]


def test_relationship_respects_boundaries_without_billing():
    current = {"trust": 20, "shared": 0, "stage": "첫 만남"}
    r = relationship_next(current, "천천히 알아가고 싶어", None, "slow")
    assert r["trust"] == 20 and r["stage"] == "첫 만남" and current["trust"] == 20


async def test_recovery_rechecks_fresh_lease_before_refund(client):
    u, cid = await start(client)
    response, _ = await submit(client, cid)
    tid = response.json()["id"]
    async with SessionLocal() as db:
        await db.execute(
            update(Turn)
            .where(Turn.id == tid)
            .values(status="generating", started=time.time())
        )
        await db.commit()
    await finish(tid, error="interrupted", stale_only=True)
    assert (await client.get("/v1/me")).json()["credits"] == 29
    assert (await client.get("/v1/conversations/" + cid)).json()["active_turn"] == tid


async def test_opening_message_is_in_model_context(client, monkeypatch):
    captured = []

    async def fake(character, conversation, history, memories, turn):
        captured.extend(m.content for m in history)
        yield "delta", {"text": "답변입니다."}

    monkeypatch.setattr("yeoun.worker.stream_reply", fake)
    u, cid = await start(client)
    response, _ = await submit(client, cid)
    await run(response.json()["id"])
    assert captured and "막차 놓치셨어요?" in captured[0]


async def test_retired_cast_is_unavailable_but_messages_are_preserved(client):
    from yeoun.models import Character, Message

    u, _ = await start(client)
    async with SessionLocal() as db:
        db.add(Character(id="haeon", payload={"name": "retired"}, published=False))
        await db.flush()
        old = Conversation(user_id=u["id"], character_id="haeon")
        db.add(old)
        await db.flush()
        old_id = old.id
        message = Message(
            conversation_id=old_id, role="user", content="보존할 과거 기록"
        )
        db.add(message)
        await db.commit()
    catalog = (await client.get("/v1/characters")).json()
    assert "haeon" not in {c["id"] for c in catalog}
    listed = (await client.get("/v1/conversations")).json()
    assert old_id not in {c["id"] for c in listed}
    assert (await client.get(f"/v1/conversations/{old_id}")).status_code == 404
    assert (
        await client.post("/v1/conversations", json={"character_id": "haeon"})
    ).status_code == 404
    assert (
        await client.post(
            f"/v1/conversations/{old_id}/turns",
            json={"client_id": str(uuid.uuid4()), "content": "안녕"},
        )
    ).status_code == 404
    async with SessionLocal() as db:
        assert await db.get(Conversation, old_id) is not None
