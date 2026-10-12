"""Live synthetic long-context probe; no user data and no DB mutations."""

import asyncio
import json
import time
from pathlib import Path
from types import SimpleNamespace

from .catalog import CHARACTERS
from .config import settings
from .engine import PROMPT_VERSION, stream_reply
from .episodes import compact_episodes


async def main():
    if settings().demo_mode or not settings().openai_api_key:
        raise SystemExit("Live model configuration required")
    messages = [
        SimpleNamespace(
            id=str(i),
            role="user" if i % 2 else "assistant",
            content=f"따뜻한 차를 마시며 온실의 잎을 살핀다. 장면 {i}.",
            status="complete",
            memory_redacted=False,
            created=float(i + 1),
        )
        for i in range(100)
    ]
    messages[
        3
    ].content = (
        "다음 주 수요일 오후 세 시에 동쪽 온실에서 푸른 씨앗을 함께 심기로 약속했어."
    )
    messages[4].content = "좋아요. 수요일 오후 세 시, 동쪽 온실에서 기다릴게요."
    started = time.monotonic()
    narrative, recent = await compact_episodes({"chapter": 1, "beat": 50}, messages)
    compaction_seconds = round(time.monotonic() - started, 3)
    assert len(recent) == 40
    notes = narrative.get("episode_notes", [])
    assert all(
        n["quote"] in next(m.content for m in messages if m.id == n["source_id"])
        for n in notes
    )
    conv = SimpleNamespace(
        narrative=narrative,
        relationship={"stage": "익숙한 사이", "trust": 30},
        settings={"pace": "slow", "length": "short", "memory_enabled": True},
    )
    turn = SimpleNamespace(
        content="다음 주에 어디에서 언제 만나기로 했지? 무엇을 하기로 했어?",
        mode="quick",
        story_event=None,
    )
    text = ""
    async for event, data in stream_reply(CHARACTERS[0], conv, recent, [], turn):
        if event == "delta":
            text += data["text"]
    result = {
        "prompt_version": PROMPT_VERSION,
        "synthetic_messages": 100,
        "recent_messages": len(recent),
        "memory_model": settings().model_memory,
        "reply_model": settings().model_quick,
        "compaction_seconds": compaction_seconds,
        "notes": notes,
        "reply": text,
        "literal_checks_pass": all(
            s in text for s in ["수요일", "세 시", "동쪽 온실", "씨앗"]
        ),
        "human_score": None,
    }
    Path("../../docs/evidence/live-episode-eval.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2)
    )
    print(
        json.dumps(
            {
                "compaction_seconds": compaction_seconds,
                "notes": len(notes),
                "literal_checks_pass": result["literal_checks_pass"],
                "reply": text,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
