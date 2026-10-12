"""Produce mechanical evidence, never a fabricated human/commercial quality score."""

import json
import os
import re
import statistics
from pathlib import Path

from .catalog import CHARACTERS
from .engine import PROMPT_VERSION


def read_lines(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def distribution(values):
    values = sorted(values)
    return (
        {
            "p50": round(statistics.median(values), 3),
            "p95": round(values[min(len(values) - 1, int(len(values) * 0.95))], 3),
        }
        if values
        else None
    )


def main():
    out = Path(os.environ["CAST_AUDIT_OUTPUT"])
    basic = read_lines(out / "responses.jsonl")
    extended = read_lines(out / "extended.jsonl")
    assert len(basic) == 240 and len(extended) == 916, (
        "Incomplete run; do not publish a full-cast pass."
    )
    assert (
        len({r["id"] for r in basic}) == 240 and len({r["id"] for r in extended}) == 916
    )
    all_rows = basic + extended
    assert all(
        r.get("error") or r["model_meta"]["prompt_version"] == PROMPT_VERSION
        for r in all_rows
    )
    per_cast = []
    for c in CHARACTERS:
        rows = [r for r in basic if r["character"] == c["id"]]
        long = [
            r
            for r in extended
            if r["character"] == c["id"] and r["case"].startswith("long_")
        ]
        assert len(rows) == 8 and len(long) == 30
        final = next(r for r in long if r["case"] == "long_30")
        text = re.sub(r"\s", "", final["text"])
        recalled = {
            "name": "하람" in text,
            "drink": "유자차" in text,
            "time": any(
                v in text
                for v in ("여섯시십분", "6시10분", "18시10분", "18:10", "6:10")
            ),
            "place": "중앙역" in text and "시계탑" in text,
            "item": "파란" in text and "수첩" in text,
        }
        values = {m["key"]: m["value"] for m in final["memories"]}
        per_cast.append(
            {
                "id": c["id"],
                "name": c["name"],
                "basic_completed": sum(not r["error"] for r in rows),
                "long_completed": sum(not r["error"] for r in long),
                "compacted": bool(final["narrative"].get("episode_cutoff")),
                "literal_recall": recalled,
                "all_five_recalled": all(recalled.values()),
                "drink_note": values.get("좋아하는 음료"),
                "drink_note_exact_value": values.get("좋아하는 음료") == "유자차",
                "drink_survived_other_preference": "유자차"
                in values.get("좋아하는 음료", ""),
                "other_preference_note": values.get("관계에서 중요하게 여기는 것"),
                "trust": final["relationship"].get("trust", 0),
                "stage": final["relationship"].get("stage"),
                "shared": final["relationship"].get("shared", 0),
                "story_slots": len(final["narrative"].get("story_slots", {})),
                "episode_notes": len(final["narrative"].get("episode_notes", [])),
            }
        )
    paired = []
    for cid in ("astel", "seah", "yura", "sion", "nari", "dogeon"):
        quick = next(r for r in extended if r["id"] == cid + ":paired_quick")
        story = next(r for r in extended if r["id"] == cid + ":paired_story")
        paired.append(
            {
                "id": cid,
                "quick_chars": len(quick["text"]),
                "story_chars": len(story["text"]),
                "ratio": round(len(story["text"]) / max(len(quick["text"]), 1), 3),
            }
        )
    summary = {
        "prompt_version": PROMPT_VERSION,
        "basic_count": len(basic),
        "extended_count": len(extended),
        "errors": [
            {"id": r["id"], "error": r["error"], "visible_chars": len(r["text"])}
            for r in all_rows
            if r["error"]
        ],
        "basic_latency": distribution(
            [r["first_visible_seconds"] for r in basic if not r["error"]]
        ),
        "basic_quick_latency": distribution(
            [
                r["first_visible_seconds"]
                for r in basic
                if not r["error"] and r["mode"] == "quick"
            ]
        ),
        "basic_story_latency": distribution(
            [
                r["first_visible_seconds"]
                for r in basic
                if not r["error"] and r["mode"] == "story"
            ]
        ),
        "basic_story_chars_median": statistics.median(
            len(r["text"]) for r in basic if r["mode"] == "story"
        ),
        "basic_short_recall_count": sum(
            "가온" in r["text"] and "레몬차" in r["text"]
            for r in basic
            if r["case"] == "continuity"
        ),
        "intro_exact_echo_count": sum(
            "좋아하시는군요" in r["text"] for r in basic if r["case"] == "introduce"
        ),
        "repair_counts": sum(
            r.get("model_meta", {}).get("repair_count", 0)
            for r in all_rows
            if r.get("model_meta")
        ),
        "long_five_fact_recall_count": sum(r["all_five_recalled"] for r in per_cast),
        "paired_modes": paired,
        "per_cast": per_cast,
        "human_reviewers": 0,
        "limitations": "Literal recall checks are diagnostic, not a human preference score. No matched competitor conversations or production load test.",
    }
    (out / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    transcript = [
        "# " + PROMPT_VERSION + " 합성 대화 원문",
        "",
        "실제 모델이 생성한 결과다. 기본 240회와 30명 각각 30턴 등 후속 916회를 구분한다.",
        "",
    ]
    for c in CHARACTERS:
        transcript += ["## " + c["name"], ""]
        for r in [x for x in all_rows if x["character"] == c["id"]]:
            transcript += [
                "### " + r["id"],
                "",
                "사용자: " + r["input"],
                "",
                r["text"] or "(출력 없음)",
                "",
                "오류: " + str(r["error"]),
                "",
            ]
    (out / "TRANSCRIPTS.md").write_text("\n".join(transcript))
    print(
        json.dumps(
            {k: v for k, v in summary.items() if k not in ("per_cast", "paired_modes")},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
