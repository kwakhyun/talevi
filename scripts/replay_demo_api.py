#!/usr/bin/env python3
"""Local capture adapter: replay archived model output through the real API.

Run from the repository root with `.venv/bin/python scripts/replay_demo_api.py`.
The already-migrated `yeoun_video_20261015` DB and port 8003 are fixed on purpose.
`--check` validates source integrity, exact output and the network guard without DB I/O.

This is recorded-response playback, NOT live inference or a latency benchmark.
Only worker.stream_reply is replaced; API, queue, SSE, transactions and checkpoints
run the application's implementation. No production source file is modified.
"""

import argparse
import asyncio
import copy
import hashlib
import json
import os
import socket
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/evidence/cast-v11-2026-10-10/extended.jsonl"
SOURCE_SHA256 = "643127becfe3646212542ea23eebc55d1dc52bb58fb0f160646c8eb0c6cedf9d"
CASE_IDS = tuple(f"haru:long_{number:02d}" for number in range(1, 5))
AUDIT = ROOT / ".local/video-capture/replay-audit.jsonl"
DATABASE_NAME = "yeoun_video_20261015"
DATABASE_URL = f"postgresql+psycopg://yeoun:yeoun@127.0.0.1:54329/{DATABASE_NAME}"
PORT = 8003
CHUNK_CHARACTERS = 4
CHUNK_DELAY_SECONDS = 0.03


class ReplayOnlyError(RuntimeError):
    """A capture must never silently fall back to a live provider."""


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def audit(event, **fields):
    AUDIT.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "source": str(SOURCE.relative_to(ROOT)),
        "source_sha256": SOURCE_SHA256,
        "recorded_date": "2026-10-10",
        "capture_type": "archived_response_replay",
        **fields,
    }
    with AUDIT.open("a", encoding="utf-8") as output:
        output.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_cases():
    raw = SOURCE.read_bytes()
    if digest(raw) != SOURCE_SHA256:
        raise ReplayOnlyError("Archived evidence hash differs; refusing replay.")
    selected = {}
    for number, line in enumerate(raw.splitlines(), 1):
        item = json.loads(line)
        if item.get("id") in CASE_IDS:
            if item["id"] in selected:
                raise ReplayOnlyError("Duplicate archived case.")
            if item.get("error") or not item.get("text") or not isinstance(item.get("reply_state"), dict):
                raise ReplayOnlyError("Archived case is not a completed response.")
            selected[item["id"]] = {
                "record": item,
                "line": number,
                "line_sha256": digest(line),
                "text_sha256": digest(item["text"].encode("utf-8")),
                "state_sha256": digest(item["reply_state"]),
            }
    if set(selected) != set(CASE_IDS):
        raise ReplayOnlyError("The four required cases are not present.")
    return selected


def lock_environment():
    # Environment values override .env.local, so a real configured key cannot leak in.
    os.environ.update({
        "DATABASE_URL": DATABASE_URL,
        "ENVIRONMENT": "development",
        "DEMO_MODE": "true",
        "RUN_WORKER": "true",
        "AUTO_CREATE_SCHEMA": "false",
        "OPENAI_API_KEY": "",
        "OPENAI_ADMIN_KEY": "",
        "TOSS_SECRET_KEY": "",
        "TOSS_CLIENT_KEY": "",
        "REVENUECAT_WEBHOOK_SECRET": "",
        "REVENUECAT_SIGNING_SECRET": "",
        "REVENUECAT_APP_IDS": "",
        "WEB_ORIGIN": "http://127.0.0.1:3002",
        "EXTRA_ORIGINS": "http://localhost:3002",
    })


def block_external_calls():
    import httpx
    import openai

    def blocked(*_args, **_kwargs):
        raise ReplayOnlyError("External HTTP/provider calls are disabled during recorded playback.")

    async def async_blocked(*args, **kwargs):
        blocked(*args, **kwargs)

    class BlockedOpenAI:
        def __init__(self, *_args, **_kwargs):
            blocked()

    # Transport guard includes moderation, payment and any accidental REST request.
    httpx.HTTPTransport.handle_request = blocked
    httpx.AsyncHTTPTransport.handle_async_request = async_blocked
    openai.OpenAI = openai.AsyncOpenAI = BlockedOpenAI
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def allow_address(address):
        if isinstance(address, tuple):
            host, port = address[:2]
            if host not in ("127.0.0.1", "localhost", "::1") or port != 54329:
                blocked()
        elif not isinstance(address, (str, bytes)):
            blocked()

    def connect(sock, address):
        allow_address(address)
        return original_connect(sock, address)

    def connect_ex(sock, address):
        allow_address(address)
        return original_connect_ex(sock, address)

    # Extra guard for Python clients that do not use HTTPX; only local DB egress.
    socket.socket.connect = connect
    socket.socket.connect_ex = connect_ex


def make_replay(cases, *, delay=CHUNK_DELAY_SECONDS):
    by_input = {
        (entry["record"]["character"], entry["record"]["input"],
         entry["record"]["mode"], entry["record"].get("story_event")): entry
        for entry in cases.values()
    }

    async def replay(character, conversation, history, memories, turn):
        entry = by_input.get((character["id"], turn.content, turn.mode, turn.story_event))
        if entry is None:
            audit("unregistered_input_rejected", turn_id=turn.id,
                  character_id=character["id"], input_sha256=digest(turn.content.encode("utf-8")))
            raise ReplayOnlyError("Only exact archived haru long_01 through long_04 inputs are allowed.")
        record = entry["record"]
        metadata = {
            **copy.deepcopy(record.get("model_meta", {})),
            "name": "replay:" + record["model"],
            "recorded_model": record["model"],
            "delivery": "archived_response_replay",
            "source_case": record["id"],
            "recorded_date": "2026-10-10",
            "simulated_chunk_delay_ms": int(delay * 1000),
            "is_live_inference": False,
        }
        audit("replay_started", turn_id=turn.id, conversation_id=conversation.id,
              case_id=record["id"], source_line=entry["line"],
              source_line_sha256=entry["line_sha256"], text_sha256=entry["text_sha256"],
              reply_state_sha256=entry["state_sha256"],
              input_sha256=digest(record["input"].encode("utf-8")),
              history_count=len(history), memory_count=len(memories),
              model_metadata=metadata, paid_provider_calls=0)
        # Same event contract as the real generator; state is committed by the real worker.
        yield "state", copy.deepcopy(record["reply_state"])
        yield "phase", {"name": "writing"}
        for offset in range(0, len(record["text"]), CHUNK_CHARACTERS):
            if delay:
                await asyncio.sleep(delay)
            yield "delta", {"text": record["text"][offset:offset + CHUNK_CHARACTERS]}
        yield "model", metadata
        # Delivery completion does not assert the following worker DB commit succeeded.
        audit("replay_delivered", turn_id=turn.id, case_id=record["id"],
              text_sha256=entry["text_sha256"], reply_state_sha256=entry["state_sha256"])

    return replay


async def self_check(cases):
    import httpx
    from openai import AsyncOpenAI

    replay = make_replay(cases, delay=0)
    for case_id in CASE_IDS:
        source = cases[case_id]["record"]
        turn = SimpleNamespace(id="self-check:" + case_id, content=source["input"],
                               mode=source["mode"], story_event=source["story_event"])
        events = [event async for event in replay({"id": "haru"}, SimpleNamespace(id="self-check"), [], [], turn)]
        assert "".join(data["text"] for event, data in events if event == "delta") == source["text"]
        assert next(data for event, data in events if event == "state") == source["reply_state"]
        assert next(data for event, data in events if event == "model")["is_live_inference"] is False
    unknown = SimpleNamespace(id="self-check:unknown", content="not in the archive", mode="quick", story_event=None)
    try:
        _ = [event async for event in replay({"id": "haru"}, SimpleNamespace(id="self-check"), [], [], unknown)]
    except ReplayOnlyError:
        pass
    else:
        raise AssertionError("Unregistered input was accepted")
    for operation in (lambda: AsyncOpenAI(api_key="test-placeholder"),
                      lambda: httpx.get("https://network-disabled.invalid/")):
        try:
            operation()
        except ReplayOnlyError:
            pass
        else:
            raise AssertionError("Provider/HTTP guard did not block")
    try:
        async with httpx.AsyncClient() as client:
            await client.get("https://network-disabled.invalid/")
    except ReplayOnlyError:
        pass
    else:
        raise AssertionError("Async HTTP guard did not block")
    print("PASS: four exact archived outputs/states, unknown-input rejection, provider and HTTP guards; no DB or provider calls.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check replay integrity without starting the API")
    args = parser.parse_args()
    cases = load_cases()
    lock_environment()
    block_external_calls()
    if args.check:
        asyncio.run(self_check(cases))
        return
    sys.path.insert(0, str(ROOT / "apps/api"))
    import uvicorn
    from yeoun import worker
    from yeoun.main import app, cfg

    assert cfg.database_url == DATABASE_URL and cfg.demo_mode and cfg.run_worker
    assert not cfg.openai_api_key and not cfg.auto_create_schema
    worker.stream_reply = make_replay(cases)

    @app.get("/replay-info")
    async def replay_info():
        return {"mode": "archived_response_replay", "recorded_date": "2026-10-10",
                "source_sha256": SOURCE_SHA256, "cases": list(CASE_IDS),
                "is_live_inference": False, "paid_provider_calls": 0,
                "simulated_chunk_delay_ms": int(CHUNK_DELAY_SECONDS * 1000)}

    audit("server_start", cases=list(CASE_IDS), database=DATABASE_NAME,
          host="127.0.0.1", port=PORT, paid_provider_calls=0,
          note="Recorded response playback; display timing is simulated, not model latency.")
    print(f"RECORDED RESPONSE PLAYBACK — API 127.0.0.1:{PORT}; dedicated DB {DATABASE_NAME}; no live model calls.", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, access_log=False)


if __name__ == "__main__":
    main()
