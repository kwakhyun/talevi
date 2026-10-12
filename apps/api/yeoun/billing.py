"""Server-authoritative credit movements and authenticated native store events."""

import hashlib
import hmac
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from .config import settings
from .db import database
from .models import Ledger, StorePurchase, User

router = APIRouter()
PRODUCTS = {"yeoun.light.500": 500, "yeoun.light.1200": 1200}


async def adjust_credits(db, user_id, delta, reference, reason):
    user = (
        await db.execute(select(User).where(User.id == user_id).with_for_update())
    ).scalar_one()
    if await db.scalar(select(Ledger.id).where(Ledger.reference == reference)):
        return False
    net = user.credits - user.credit_debt + delta
    user.credits = max(0, net)
    user.credit_debt = max(0, -net)
    db.add(Ledger(user_id=user_id, reference=reference, delta=delta, reason=reason))
    return True


@router.post("/v1/webhooks/revenuecat")
async def revenuecat(request: Request, db=Depends(database)):
    cfg = settings()
    if (
        not cfg.revenuecat_webhook_secret
        or not cfg.revenuecat_signing_secret
        or not cfg.revenuecat_app_ids
    ):
        raise HTTPException(503, "Native billing is not configured")
    if not hmac.compare_digest(
        request.headers.get("authorization", ""),
        "Bearer " + cfg.revenuecat_webhook_secret,
    ):
        raise HTTPException(401, "Invalid authorization")
    raw = await request.body()
    try:
        parts = dict(
            part.strip().split("=", 1)
            for part in request.headers.get("x-revenuecat-webhook-signature", "").split(
                ","
            )
        )
        timestamp = parts["t"]
        expected = hmac.new(
            cfg.revenuecat_signing_secret.encode(),
            timestamp.encode() + b"." + raw,
            hashlib.sha256,
        ).hexdigest()
        if abs(time.time() - int(timestamp)) > 300 or not hmac.compare_digest(
            expected, parts["v1"]
        ):
            raise ValueError()
    except (KeyError, ValueError):
        raise HTTPException(401, "Invalid signature")
    try:
        event = json.loads(raw)["event"]
        if event["type"] not in (
            "NON_RENEWING_PURCHASE",
            "CANCELLATION",
            "REFUND_REVERSED",
        ):
            return {"ok": True, "ignored": True}
        if event.get("app_id") not in cfg.revenuecat_app_ids.split(","):
            raise HTTPException(400, "Unknown app")
        environment = "PRODUCTION" if cfg.production else "SANDBOX"
        if event.get("environment") != environment:
            raise HTTPException(400, "Wrong store environment")
        if event.get("store") not in ("APP_STORE", "PLAY_STORE"):
            raise HTTPException(400, "Unsupported store")
        product = event["product_id"]
        credits = PRODUCTS.get(product)
        if not credits:
            raise HTTPException(400, "Unknown product")
        event_ms = float(event["event_timestamp_ms"])
        event_ref = hashlib.sha256(str(event["id"]).encode()).hexdigest()
        transaction = event["transaction_id"]
        if not isinstance(transaction, str) or not transaction:
            raise ValueError()
        reference = hashlib.sha256(
            (event["store"] + ":" + transaction).encode()
        ).hexdigest()
        user = (
            await db.execute(
                select(User).where(User.id == event["app_user_id"]).with_for_update()
            )
        ).scalar_one_or_none()
        if not user:
            raise HTTPException(404, "Unknown customer")
    except (KeyError, TypeError, ValueError):
        raise HTTPException(400, "Malformed event")
    purchase = await db.get(StorePurchase, reference)
    if purchase and (purchase.user_id != user.id or purchase.product_id != product):
        raise HTTPException(409, "Transaction ownership mismatch")
    if not purchase:
        purchase = StorePurchase(
            reference=reference,
            user_id=user.id,
            product_id=product,
            credits=credits,
            status="pending",
        )
        db.add(purchase)
        await db.flush()
    if purchase.last_event_ms and event_ms < purchase.last_event_ms:
        return {"ok": True, "stale": True}
    action = event["type"]
    if action == "NON_RENEWING_PURCHASE" and purchase.status == "pending":
        await adjust_credits(
            db, user.id, credits, "store:" + reference, "앱 스토어 빛 충전"
        )
        purchase.status = "paid"
    elif action == "CANCELLATION" and purchase.status != "refunded":
        if purchase.status == "paid":
            await adjust_credits(
                db,
                user.id,
                -credits,
                "store-refund:" + event_ref,
                "앱 스토어 결제 취소",
            )
        purchase.status = "refunded"
    elif action == "REFUND_REVERSED" and purchase.status == "refunded":
        # A canceled event can precede its purchase notification.
        await adjust_credits(
            db, user.id, credits, "store-restored:" + event_ref, "앱 스토어 취소 철회"
        )
        purchase.status = "paid"
    purchase.last_event_ms = event_ms
    purchase.updated = time.time()
    await db.commit()
    return {"ok": True}
