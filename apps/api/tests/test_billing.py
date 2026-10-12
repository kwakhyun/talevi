import asyncio
import hashlib
import hmac
import json
import time

from sqlalchemy import update
from test_flow import start, submit
from yeoun.db import SessionLocal
from yeoun.main import cfg
from yeoun.models import User


async def hook(
    client, uid, kind="NON_RENEWING_PURCHASE", event_id="e1", stamp=None, **override
):
    event = {
        "id": event_id,
        "type": kind,
        "app_user_id": uid,
        "app_id": "app-test",
        "product_id": "yeoun.light.500",
        "transaction_id": "transaction-1",
        "store": "APP_STORE",
        "environment": "SANDBOX",
        "event_timestamp_ms": stamp or time.time() * 1000,
        **override,
    }
    raw = json.dumps({"event": event}).encode()
    t = str(int(time.time()))
    signature = hmac.new(
        b"signing-test", t.encode() + b"." + raw, hashlib.sha256
    ).hexdigest()
    return await client.post(
        "/v1/webhooks/revenuecat",
        content=raw,
        headers={
            "authorization": "Bearer webhook-test",
            "x-revenuecat-webhook-signature": f"t={t},v1={signature}",
            "content-type": "application/json",
        },
    )


def configured(monkeypatch):
    monkeypatch.setattr(cfg, "revenuecat_webhook_secret", "webhook-test")
    monkeypatch.setattr(cfg, "revenuecat_signing_secret", "signing-test")
    monkeypatch.setattr(cfg, "revenuecat_app_ids", "app-test")


async def test_native_credit_is_exactly_once(client, monkeypatch):
    configured(monkeypatch)
    u, cid = await start(client)
    a, b = await asyncio.gather(hook(client, u["id"]), hook(client, u["id"]))
    assert a.status_code == b.status_code == 200
    assert (await client.get("/v1/me")).json()["credits"] == 530


async def test_native_refund_debt_blocks_spend_and_offsets_next_purchase(
    client, monkeypatch
):
    configured(monkeypatch)
    u, cid = await start(client)
    await hook(client, u["id"])
    async with SessionLocal() as db:
        await db.execute(update(User).where(User.id == u["id"]).values(credits=10))
        await db.commit()
    assert (await hook(client, u["id"], "CANCELLATION", "e2")).status_code == 200
    assert (await submit(client, cid))[0].status_code == 402
    async with SessionLocal() as db:
        user = await db.get(User, u["id"])
        assert user.credits == 0 and user.credit_debt == 490
    await hook(client, u["id"], event_id="e3", transaction_id="transaction-2")
    assert (await client.get("/v1/me")).json()["credits"] == 10


async def test_out_of_order_refund_never_grants_canceled_purchase(client, monkeypatch):
    configured(monkeypatch)
    u, cid = await start(client)
    now = time.time() * 1000
    await hook(client, u["id"], "CANCELLATION", "e2", stamp=now)
    await hook(client, u["id"], stamp=now - 10000)
    assert (await client.get("/v1/me")).json()["credits"] == 30


async def test_native_webhook_rejects_forgery_and_wrong_environment(
    client, monkeypatch
):
    configured(monkeypatch)
    u, cid = await start(client)
    assert (
        await client.post("/v1/webhooks/revenuecat", json={"event": {}})
    ).status_code == 401
    assert (await hook(client, u["id"], environment="PRODUCTION")).status_code == 400
    assert (
        await hook(client, u["id"], product_id="untrusted-product")
    ).status_code == 400
    assert (await client.get("/v1/me")).json()["credits"] == 30


async def test_cross_conversation_idempotency_conflict_rolls_back_charge(client):
    u, cid = await start(client)
    c2 = (
        await client.post("/v1/conversations", json={"character_id": "dogeon"})
    ).json()["id"]
    a, b = await asyncio.gather(
        submit(client, cid, client_id="repeated-id-12345"),
        submit(client, c2, client_id="repeated-id-12345"),
    )
    assert sorted([a[0].status_code, b[0].status_code]) == [202, 409]
    assert (await client.get("/v1/me")).json()["credits"] == 29
