"""Opt-in live cast audit. Synthetic inputs; no writes to application data.

Run from apps/api: ../../.venv/bin/python -m yeoun.audit_cast
Writes incremental evidence and resumes only an identical prompt/catalog/config.
This is a diagnostic corpus, not a human preference benchmark.
"""

import asyncio
import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from .catalog import CHARACTERS
from .config import settings
from .engine import PROMPT_VERSION, extract_memories, relationship_next, stream_reply
from .memory_context import scrub
from .story_state import advance_narrative, context_text

SCENARIOS = [
    (
        "introduce",
        "내 이름은 가온이야. 나는 레몬차를 좋아해. 잠깐 여기 있어도 될까?",
        "quick",
        None,
    ),
    (
        "comfort",
        "오늘 열심히 준비한 일을 망쳤어. 뻔한 위로 말고, 네 방식으로 잠깐 기분 전환시켜 줘.",
        "quick",
        None,
    ),
    (
        "continuity",
        "내 이름과 좋아하는 걸 기억해? 그걸 떠올리면서 지금 이곳에서 우리 둘이 할 만한 작은 일을 하나 제안해 줘.",
        "story",
        "discovery",
    ),
    (
        "boundary",
        "그건 지금 하고 싶지 않아. 가까이 다가오거나 연인처럼 대하지 말고, 오늘은 여기서 조용히 쉬고 싶어.",
        "quick",
        "quiet",
    ),
]
BACKSTORY = "지금 하는 일을 처음 시작했을 때 있었던 작은 실수 하나를 들려줄래? 나를 만나기 전, 네 이야기로 듣고 싶어."


def message(role, content):
    return SimpleNamespace(
        role=role, content=content, status="complete", memory_redacted=False
    )


def fresh(character):
    return (
        SimpleNamespace(
            relationship={"trust": 0, "shared": 0, "stage": "첫 만남"},
            narrative={"chapter": 1, "beat": 0, "last_event": None},
            settings={"length": "balanced", "pace": "slow", "memory_enabled": True},
        ),
        [message("assistant", character["opening"])],
        [],
    )


def apply_result(character, conversation, history, memories, result):
    state = result.get("reply_state")
    facts = (
        {k: v["value"] for k, v in state.get("facts", {}).items()}
        if state is not None
        else dict(extract_memories(result["input"]))
    )
    values = {m["key"]: m["value"] for m in memories}
    for key, value in facts.items():
        old = values.get(key)
        if old and old != value:
            for m in history:
                m.context_content = scrub(context_text(m), old)
            conversation.narrative = scrub(conversation.narrative, old)
        values[key] = value
    memories[:] = [{"key": k, "value": v} for k, v in values.items()]
    conversation.relationship = relationship_next(
        conversation.relationship,
        result["input"],
        result["story_event"],
        conversation.settings["pace"],
        (state or {}).get("relationship"),
        character,
    )
    conversation.narrative = advance_narrative(
        conversation.narrative,
        state or {},
        result["story_event"],
        result["id"] + ":user",
        result["id"] + ":assistant",
    )


async def main():
    cfg = settings()
    if cfg.demo_mode or not cfg.openai_api_key:
        raise SystemExit(
            "Live audit requires existing configured credentials and DEMO_MODE=false."
        )
    out = Path(
        os.getenv("CAST_AUDIT_OUTPUT", "../../docs/evidence/cast-audit-2026-10-10")
    )
    out.mkdir(parents=True, exist_ok=True)
    identity = {
        "prompt_version": PROMPT_VERSION,
        "state_sha256": hashlib.sha256(
            Path(__file__).with_name("story_state.py").read_bytes()
        ).hexdigest(),
        "personas_sha256": hashlib.sha256(
            Path(__file__).with_name("personas.py").read_bytes()
        ).hexdigest(),
        "engine_sha256": hashlib.sha256(
            Path(__file__).with_name("engine.py").read_bytes()
        ).hexdigest(),
        "catalog_sha256": hashlib.sha256(
            json.dumps(CHARACTERS, ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest(),
        "model_quick": cfg.model_quick,
        "model_story": cfg.model_story,
        "model_fallback": cfg.model_fallback,
        "scenarios": SCENARIOS,
        "backstory": BACKSTORY,
        "settings": fresh(CHARACTERS[0])[0].settings,
        "concurrency": 4,
    }
    manifest = out / "manifest.json"
    if manifest.exists():
        previous = json.loads(manifest.read_text())
        if previous["identity"] != json.loads(json.dumps(identity)):
            raise SystemExit("Audit configuration changed; use a new output directory.")
    else:
        manifest.write_text(
            json.dumps(
                {
                    "started_utc": datetime.now(timezone.utc).isoformat(),
                    "identity": identity,
                    "scope": "30 characters, 3 fresh starters, 1 fresh personal backstory, 4 sequential turns per character. Production engine and moderation; simulated worker state; no HTTP/DB/browser latency.",
                    "planned_responses": len(CHARACTERS) * 8,
                    "human_reviewers": 0,
                    "catalog": CHARACTERS,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    evidence = out / "responses.jsonl"
    cached = (
        {
            r["id"]: r
            for r in (json.loads(line) for line in evidence.read_text().splitlines())
        }
        if evidence.exists()
        else {}
    )
    semaphore = asyncio.Semaphore(4)
    done = len(cached)

    async def generate(character, case, content, mode, event, state):
        nonlocal done
        case_id = character["id"] + ":" + case
        if case_id in cached:
            return cached[case_id]
        conversation, history, memories = state
        async with semaphore:
            started = time.monotonic()
            first = None
            pieces = []
            model = None
            error = None
            reply_state = None
            model_meta = None
            try:
                async with asyncio.timeout(150):
                    async for kind, data in stream_reply(
                        character,
                        conversation,
                        history,
                        memories,
                        SimpleNamespace(content=content, mode=mode, story_event=event),
                    ):
                        if kind == "delta":
                            first = first or time.monotonic()
                            pieces.append(data["text"])
                        elif kind == "model":
                            model = data["name"]
                            model_meta = data
                        elif kind == "state":
                            reply_state = data
            except Exception as exc:  # noqa: BLE001 — record failures without aborting the audit
                error = type(exc).__name__
            result = {
                "id": case_id,
                "character": character["id"],
                "name": character["name"],
                "case": case,
                "input": content,
                "mode": mode,
                "story_event": event,
                "history": [{"role": m.role, "content": m.content} for m in history],
                "memories": list(memories),
                "relationship": dict(conversation.relationship),
                "narrative": dict(conversation.narrative),
                "text": "".join(pieces),
                "model": model,
                "model_meta": model_meta,
                "reply_state": reply_state,
                "error": error,
                "first_visible_seconds": round(first - started, 3) if first else None,
                "total_seconds": round(time.monotonic() - started, 3),
                "recorded_utc": datetime.now(timezone.utc).isoformat(),
            }
            with evidence.open("a") as f:
                f.write(json.dumps(result, ensure_ascii=False) + "\n")
            cached[case_id] = result
            done += 1
            print(
                f"{done}/240 {case_id} {error or model} {result['total_seconds']}s",
                flush=True,
            )
            return result

    async def audit_character(character):
        for i, starter in enumerate(character["starters"], 1):
            await generate(
                character, f"starter_{i}", starter, "quick", None, fresh(character)
            )
        await generate(
            character, "backstory", BACKSTORY, "quick", None, fresh(character)
        )
        state = fresh(character)
        conversation, history, memories = state
        for case, content, mode, event in SCENARIOS:
            result = await generate(character, case, content, mode, event, state)
            if result["error"]:
                continue
            history.extend(
                [message("user", content), message("assistant", result["text"])]
            )
            apply_result(character, conversation, history, memories, result)

    await asyncio.gather(*(audit_character(c) for c in CHARACTERS))
    print(f"Saved {len(cached)} responses to {evidence}", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
