"""Opt-in live evaluation with synthetic inputs. Never runs in regular CI."""

import asyncio
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

from .catalog import CHARACTERS
from .config import settings
from .engine import PROMPT_VERSION, stream_reply


async def main():
    cfg = settings()
    if cfg.demo_mode or not cfg.openai_api_key:
        raise SystemExit(
            "Live evaluation requires DEMO_MODE=false and a configured key; no requests sent."
        )
    cases = json.loads(Path("evals/ko_cases.json").read_text())
    selected = os.getenv("EVAL_CASES", "").split(",")
    if selected != [""]:
        cases = [c for c in cases if c["id"] in selected]
    results = []
    for case in cases:
        character = next(c for c in CHARACTERS if c["id"] == case["character"])
        conversation = SimpleNamespace(
            relationship={"trust": 0, "shared": 0, "stage": "첫 만남"},
            narrative={"chapter": 1, "beat": 0},
            settings={"length": "balanced", "pace": "slow"},
        )
        turn = SimpleNamespace(
            content=case["input"],
            mode=os.getenv("EVAL_MODE", "quick"),
            story_event=case.get("event"),
        )
        started = time.monotonic()
        first = None
        text = ""
        model = None
        error = None
        try:
            async for event, data in stream_reply(
                character,
                conversation,
                [
                    SimpleNamespace(**m, status="complete", memory_redacted=False)
                    for m in case.get("history", [])
                ],
                case["memories"],
                turn,
            ):
                if event == "delta":
                    first = first or time.monotonic()
                    text += data["text"]
                elif event == "model":
                    model = data["name"]
        except Exception as exc:
            error = type(exc).__name__
        checks = all(s in text for s in case.get("must_include", [])) and not any(
            s in text for s in case.get("must_not_include", [])
        )
        results.append(
            {
                "case": case["id"],
                "input": case["input"],
                "text": text,
                "model": model,
                "first_visible_seconds": None
                if first is None
                else round(first - started, 3),
                "total_seconds": round(time.monotonic() - started, 3),
                "literal_checks_pass": (checks and not error)
                if case.get("must_include") or case.get("must_not_include")
                else None,
                "question_count": text.count("?"),
                "error": error,
                "human_review": case["review"],
                "human_score": None,
            }
        )
        print(case["id"], "recorded" if not error else error, flush=True)
    path = Path(os.getenv("EVAL_OUTPUT", "../../docs/evidence/live-eval.json"))
    path.write_text(
        json.dumps(
            {"prompt_version": PROMPT_VERSION, "results": results},
            ensure_ascii=False,
            indent=2,
        )
    )
    print("Saved synthetic evaluation; human review remains required.")


if __name__ == "__main__":
    asyncio.run(main())
