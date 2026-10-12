"""Opt-in controlled stage comparison, not a naturally earned relationship study."""

import asyncio
import hashlib
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

from .audit_cast import fresh
from .catalog import CHARACTERS
from .config import settings
from .engine import PROMPT_VERSION, stream_reply

QUESTION = "넌 요즘 뭐가 마음에 걸려? 괜찮다고만 하지 말고 네 생각도 듣고 싶어. 부담되면 지금 말하지 않아도 돼."


async def main():
    cfg = settings()
    if cfg.demo_mode or not cfg.openai_api_key:
        raise SystemExit("Existing live credentials required.")
    out = Path(os.environ["CAST_AUDIT_OUTPUT"])
    target = out / "relationship-stage.jsonl"
    identity = {
        "prompt_version": PROMPT_VERSION,
        "engine_sha256": hashlib.sha256(
            Path(__file__).with_name("engine.py").read_bytes()
        ).hexdigest(),
        "model": cfg.model_quick,
        "scope": "30 characters x first/deep controlled states; state injected, not 90 naturally generated turns; identical opening and question; no invented shared events supplied",
        "question": QUESTION,
        "human_reviewers": 0,
    }
    manifest = out / "relationship-stage-manifest.json"
    if manifest.exists() and json.loads(manifest.read_text()) != identity:
        raise SystemExit("Changed settings; use a new evidence directory.")
    manifest.write_text(json.dumps(identity, ensure_ascii=False, indent=2))
    cached = (
        {json.loads(line)["id"] for line in target.read_text().splitlines()}
        if target.exists()
        else set()
    )
    semaphore = asyncio.Semaphore(4)

    async def generate(character, stage):
        case_id = f"{character['id']}:{stage}"
        if case_id in cached:
            return
        conversation, history, memories = fresh(character)
        if stage == "deep":
            conversation.relationship = {
                "trust": 85,
                "warmth": 60,
                "tension": 0,
                "shared": 18,
                "meaningful_turns": 90,
                "stage": "깊은 신뢰",
                "version": 2,
            }
        async with semaphore:
            started = time.monotonic()
            text = ""
            model_meta = None
            error = None
            first = None
            try:
                async with asyncio.timeout(150):
                    async for kind, data in stream_reply(
                        character,
                        conversation,
                        history,
                        memories,
                        SimpleNamespace(
                            content=QUESTION, mode="quick", story_event=None
                        ),
                    ):
                        if kind == "delta":
                            first = first or time.monotonic()
                            text += data["text"]
                        elif kind == "model":
                            model_meta = data
            except Exception as exc:  # noqa: BLE001 — retain failures in the corpus
                error = type(exc).__name__
            result = {
                "id": case_id,
                "name": character["name"],
                "input": QUESTION,
                "relationship": conversation.relationship,
                "text": text,
                "model_meta": model_meta,
                "error": error,
                "first_visible_seconds": round(first - started, 3) if first else None,
                "total_seconds": round(time.monotonic() - started, 3),
            }
            with target.open("a") as file:
                file.write(json.dumps(result, ensure_ascii=False) + "\n")
            print(case_id, error or "complete", flush=True)

    await asyncio.gather(
        *(generate(c, s) for c in CHARACTERS for s in ("first", "deep"))
    )


if __name__ == "__main__":
    asyncio.run(main())
