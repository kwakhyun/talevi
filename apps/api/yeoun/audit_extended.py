"""Live follow-up diagnostics; paired modes, failed-input reruns, configurable full-cast 30-turn stories."""

import asyncio
import copy
import json
import os
import time
from pathlib import Path
from types import SimpleNamespace

from .audit_cast import apply_result, fresh, message
from .catalog import CHARACTERS
from .config import settings
from .engine import stream_reply
from .episodes import compact_episodes


async def main():
    cfg = settings()
    if cfg.demo_mode or not cfg.openai_api_key:
        raise SystemExit("Existing live credentials required.")
    out = (
        Path(
            os.getenv("CAST_AUDIT_OUTPUT", "../../docs/evidence/cast-audit-2026-10-10")
        )
        / "extended.jsonl"
    )
    cached = (
        {
            r["id"]: r
            for r in (json.loads(line) for line in out.read_text().splitlines())
        }
        if out.exists()
        else {}
    )
    baseline = [
        json.loads(line)
        for line in out.with_name("responses.jsonl").read_text().splitlines()
    ]
    cast = {c["id"]: c for c in CHARACTERS}
    concurrency = int(os.getenv("AUDIT_CONCURRENCY", "4"))
    selected_cast = os.getenv("LONG_CAST", "haru,nari").split(",")
    metadata = {
        "characters": selected_cast,
        "turns_each": 30,
        "concurrency": concurrency,
        "paired_modes": 12,
        "regression_reruns": 4,
    }
    meta_file = out.with_name("extended-manifest.json")
    if meta_file.exists() and json.loads(meta_file.read_text()) != metadata:
        raise SystemExit("Extended audit scope changed; use a new output directory.")
    meta_file.write_text(json.dumps(metadata, ensure_ascii=False, indent=2))
    sem = asyncio.Semaphore(concurrency)

    async def generate(cid, case, content, mode, event, state):
        conv, history, memories = state
        case_id = f"{cid}:{case}"
        if case_id in cached:
            return cached[case_id]
        async with sem:
            start = time.monotonic()
            first = None
            parts = []
            model = None
            error = None
            reply_state = None
            model_meta = None
            try:
                async with asyncio.timeout(150):
                    async for kind, data in stream_reply(
                        cast[cid],
                        conv,
                        history,
                        memories,
                        SimpleNamespace(content=content, mode=mode, story_event=event),
                    ):
                        if kind == "delta":
                            first = first or time.monotonic()
                            parts.append(data["text"])
                        if kind == "model":
                            model = data["name"]
                            model_meta = data
                        if kind == "state":
                            reply_state = data
            except Exception as exc:  # noqa: BLE001 — record failures without aborting the audit
                error = type(exc).__name__
            r = {
                "id": f"{cid}:{case}",
                "character": cid,
                "case": case,
                "input": content,
                "mode": mode,
                "story_event": event,
                "text": "".join(parts),
                "model": model,
                "model_meta": model_meta,
                "reply_state": reply_state,
                "relationship": dict(conv.relationship),
                "error": error,
                "history_count": len(history),
                "narrative": dict(conv.narrative),
                "memories": list(memories),
                "first_visible_seconds": round(first - start, 3) if first else None,
                "total_seconds": round(time.monotonic() - start, 3),
            }
            with out.open("a") as file:
                file.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(r["id"], error or "complete", flush=True)
            return r

    async def paired(cid):
        for mode in ("quick", "story"):
            await generate(
                cid,
                "paired_" + mode,
                "좋아요. 지금 이 장면에서 다음에 무슨 일이 일어나는지 이어가 주세요. 제 행동은 제가 고를게요.",
                mode,
                "discovery",
                fresh(cast[cid]),
            )

    async def retry(row):
        for attempt in range(1, 3):
            conv, _, _ = fresh(cast[row["character"]])
            conv.relationship = row["relationship"]
            conv.narrative = row["narrative"]
            state = (
                conv,
                [message(m["role"], m["content"]) for m in row["history"]],
                row["memories"],
            )
            await generate(
                row["character"],
                f"rerun_{row['case']}_{attempt}",
                row["input"],
                row["mode"],
                row["story_event"],
                state,
            )

    async def long_story(cid):
        conv, history, memories = fresh(cast[cid])
        history[0].id = f"{cid}:opening"
        history[0].created = 1.0
        prompts = [
            "내 이름은 하람이야. 나는 유자차를 좋아해. 여기서 잠깐 이야기를 나누자.",
            "내일 오후 네 시 이십 분에 중앙역 시계탑 앞에서 만나자. 가져올 물건은 파란 수첩이야.",
            "시간만 바꾸자. 내일 오후 여섯 시 십 분으로 정정할게. 장소와 가져올 물건은 그대로야.",
            "이제 내일 약속은 잠시 접어두고, 여기서 네가 하던 일을 같이 살펴보고 싶어.",
            "여기서 눈에 띄는 작은 문제 하나를 네 방식으로 찾아봐. 내가 도울지는 듣고 결정할게.",
            "방금 발견한 문제는 왜 생겼을까? 확실한 것과 네 추측을 구분해 줘.",
            "너라면 어떤 방법을 먼저 시도하겠어? 그렇게 고른 이유가 궁금해.",
            "네가 제안한 방법을 시도해 봐. 나는 옆에서 결과를 지켜볼게.",
            "일이 잘 안 풀려도 괜찮아. 지금 확인할 수 있는 변화부터 알려 줘.",
            "막 발견한 사실을 바탕으로 다음 장면을 이어 줘. 같은 설명은 반복하지 말아 줘.",
            "그 일에 대해 우리는 조금 다르게 생각할 수도 있겠네. 네 의견을 더 듣고 싶어.",
            "그 부분은 동의해. 다만 서두르지 않고 차근차근 하고 싶어.",
            "아직 해결하지 못한 건 뭐가 남았지? 지금 할 수 있는 하나만 골라 보자.",
            "그걸 네가 한번 해 봐. 나는 결과를 보고 다음 선택을 할게.",
            "일을 하는 네 모습에서 평소 성격이 보여. 지금 기분은 어때?",
            "잠깐 쉬자. 네가 좋아하는 사소한 것 하나를 들려줘.",
            "그 취향은 좀 의외네. 남들은 잘 모르는 너만의 습관도 있을까?",
            "그렇구나. 나는 무조건 괜찮다고만 하는 사람보다는 자기 생각을 말하는 사람이 좋아.",
            "이제 쉬던 걸 마치고 아까 하던 일로 돌아가자. 어디까지 했지?",
            "남은 일을 하나 마무리하면서 장면을 이어 줘. 내가 하지 않은 행동은 만들지 말아 줘.",
            "방금 선택으로 주변에서 달라진 건 뭐야? 눈에 보이는 것만 말해 줘.",
            "네가 가장 중요하게 생각한 건 뭐였어? 결과 말고 선택한 이유가 궁금해.",
            "그 선택에 대가도 있을까? 앞으로 신경 써야 할 점을 하나만 알려줘.",
            "지금은 새 일을 더 벌이지 말고, 진행한 일을 정리하자.",
            "네가 먼저 정리해 줘. 내가 놓친 게 있으면 듣고 싶어.",
            "잠깐 말없이 쉴게. 너도 지금 이 자리에서 하고 싶은 일을 해.",
            "우리 처음 만났을 때와 지금을 비교하면 뭐가 달라졌어? 없던 추억은 만들지 말아 줘.",
            "오늘은 이쯤에서 마무리하자. 다음에 이어갈 일을 하나 남겨두면 좋겠어.",
            "내일 만나는 시간은 처음 말한 오후 네 시 이십 분이 맞나? 내가 중간에 정정했는지 확인해 줘.",
            "마지막으로 내 이름, 좋아하는 음료, 내일 약속의 최종 시간과 장소, 가져오기로 한 물건을 모두 알려 줘.",
        ]
        for index, content in enumerate(prompts):
            case_id = f"{cid}:long_{index + 1:02}"
            if case_id in cached:
                # Replay the recorded pre-turn snapshot, including the exact
                # excerpts already selected, without paying for selection again.
                previous = cached[case_id]
                conv.narrative = copy.deepcopy(previous["narrative"])
                conv.relationship = copy.deepcopy(previous["relationship"])
                memories[:] = copy.deepcopy(previous["memories"])
                cutoff = conv.narrative.get("episode_cutoff", 0)
                history = [m for m in history if m.created > cutoff]
                generation_history = history
            else:
                try:
                    async with asyncio.timeout(25):
                        conv.narrative, history = await compact_episodes(
                            conv.narrative, history
                        )
                    generation_history = history
                except Exception as exc:  # noqa: BLE001 — match the production worker fallback
                    warning = {
                        "id": case_id,
                        "stage": "compaction",
                        "error": type(exc).__name__,
                    }
                    with out.with_name("compaction-warnings.jsonl").open("a") as file:
                        file.write(json.dumps(warning) + "\n")
                    print("compaction_fallback", case_id, warning["error"], flush=True)
                    # Keep the archive for the next turn, just as the worker
                    # reloads it from PostgreSQL when no cutoff was committed.
                    generation_history = history[-40:]
            mode = "story" if index % 5 == 4 else "quick"
            event = "discovery" if index in (4, 9) else None
            r = await generate(
                cid,
                f"long_{index + 1:02}",
                content,
                mode,
                event,
                (conv, generation_history, memories),
            )
            if r["error"]:
                continue
            for offset, (role, text) in enumerate(
                (("user", content), ("assistant", r["text"])), 1
            ):
                m = message(role, text)
                m.id = f"{cid}:{index}:{role}"
                m.created = float(index * 2 + offset + 1)
                history.append(m)
            apply_result(cast[cid], conv, history, memories, r)

    await asyncio.gather(
        *(paired(cid) for cid in ("astel", "seah", "yura", "sion", "nari", "dogeon")),
        *(
            retry(row)
            for row in baseline
            if row["id"] in ("igyeol:starter_2", "sihyeok:comfort")
        ),
        *(long_story(cid) for cid in selected_cast),
    )


if __name__ == "__main__":
    asyncio.run(main())
