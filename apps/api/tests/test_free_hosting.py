"""Free-host queue/restart regressions; external HTTP is blocked by conftest."""

import asyncio
import time
from contextlib import asynccontextmanager

from sqlalchemy import event, update
from test_flow import start, submit
from yeoun import worker
from yeoun.db import SessionLocal, database, engine
from yeoun.main import app
from yeoun.models import Turn


async def eventually(check, timeout=5):
    async with asyncio.timeout(timeout):
        while not await check():
            await asyncio.sleep(0.02)


async def status_is(tid, status):
    async with SessionLocal() as db:
        return (await db.get(Turn, tid)).status == status


@asynccontextmanager
async def running_worker():
    queue = worker.OnDemandWorker()
    app.state.worker = queue
    try:
        await queue.start()
        yield queue
    finally:
        await queue.stop()
        app.state.worker = None


async def test_health_does_not_open_database(client):
    async def unavailable():
        raise AssertionError("liveness must never query or connect to Neon")
        yield

    app.dependency_overrides[database] = unavailable
    try:
        for _ in range(3):
            r = await client.get("/health")
            assert r.status_code == 200 and r.json()["ok"]
    finally:
        app.dependency_overrides.clear()


async def test_idle_worker_stops_all_database_queries_then_wakes(client, monkeypatch):
    _, cid = await start(client)
    calls = []

    async def reply(*args):
        calls.append(args[-1].id)
        yield "delta", {"text": "다시 만나서 반가워요."}

    monkeypatch.setattr(worker, "stream_reply", reply)
    statements = []

    def record(*args):
        statements.append(args[2])

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        async with running_worker():
            await asyncio.sleep(0.2)
            idle_count = len(statements)
            await asyncio.sleep(0.4)
            assert len(statements) == idle_count
            result, body = await submit(client, cid)
            tid = result.json()["id"]
            # Repeated notifications and a durable retry cannot duplicate generation.
            app.state.worker.wake()
            retry = await client.post(f"/v1/conversations/{cid}/turns", json=body)
            assert retry.json()["id"] == tid
            await eventually(lambda: status_is(tid, "completed"))
            assert calls == [tid]
            await asyncio.sleep(0.2)
            idle_count = len(statements)
            await asyncio.sleep(0.4)
            assert len(statements) == idle_count
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)


async def test_startup_drains_durable_pending_turn_without_client_retry(
    client, monkeypatch
):
    _, cid = await start(client)
    result, _ = await submit(client, cid)
    tid = result.json()["id"]
    calls = []

    async def reply(*args):
        calls.append(args[-1].id)
        yield "delta", {"text": "기다려 줘서 고마워요."}

    monkeypatch.setattr(worker, "stream_reply", reply)
    async with running_worker():
        await eventually(lambda: status_is(tid, "completed"))
    assert calls == [tid]
    assert (await client.get("/v1/me")).json()["credits"] == 29


async def test_restart_schedules_orphan_lease_refund_without_regenerating(
    client, monkeypatch
):
    _, cid = await start(client)
    result, _ = await submit(client, cid)
    tid = result.json()["id"]
    async with SessionLocal() as db:
        await db.execute(
            update(Turn)
            .where(Turn.id == tid)
            .values(status="generating", started=time.time() - 179.7)
        )
        await db.commit()

    async def forbidden(*args):
        raise AssertionError("a claimed turn must not incur a second model call")

    monkeypatch.setattr(worker, "process_turn", forbidden)
    async with running_worker():
        await eventually(lambda: status_is(tid, "failed"))
        app.state.worker.wake()
        await asyncio.sleep(0.1)
    assert (await client.get("/v1/me")).json()["credits"] == 30
    assert (await client.get(f"/v1/conversations/{cid}")).json()["active_turn"] is None


async def test_enqueue_signal_during_empty_claim_is_not_lost(monkeypatch):
    checked = asyncio.Event()
    release = asyncio.Event()
    processed = asyncio.Event()
    pending = []
    first = True

    async def claim():
        nonlocal first
        if first:
            first = False
            checked.set()
            await release.wait()
            return None
        return pending.pop(0) if pending else None

    async def process(tid):
        assert tid == "new-durable-turn"
        processed.set()

    monkeypatch.setattr(worker, "claim_turn", claim)
    monkeypatch.setattr(worker, "process_turn", process)
    queue = worker.OnDemandWorker(concurrency=1)
    consumer = asyncio.create_task(queue.consume(queue.signals[0]))
    try:
        queue.wake()
        await asyncio.wait_for(checked.wait(), 2)
        pending.append("new-durable-turn")
        queue.wake()
        release.set()
        await asyncio.wait_for(processed.wait(), 2)
    finally:
        consumer.cancel()
        await asyncio.gather(consumer, return_exceptions=True)


async def test_branch_regeneration_wakes_worker_after_commit(client, monkeypatch):
    _, cid = await start(client)
    result, _ = await submit(client, cid)
    calls = []

    async def reply(*args):
        calls.append(args[-1].id)
        yield "delta", {"text": "새로운 이야기를 들려줄게요."}

    monkeypatch.setattr(worker, "stream_reply", reply)
    async with running_worker():
        await eventually(lambda: status_is(result.json()["id"], "completed"))
        c = (await client.get(f"/v1/conversations/{cid}")).json()
        import uuid

        response = await client.post(
            f"/v1/conversations/{cid}/branches",
            json={
                "client_id": str(uuid.uuid4()),
                "message_id": c["messages"][-1]["id"],
                "action": "regenerate",
            },
        )
        assert response.status_code == 202, response.text
        data = response.json()
        await eventually(lambda: status_is(data["turn_id"], "completed"))
        assert len(calls) == 2 and len(set(calls)) == 2
