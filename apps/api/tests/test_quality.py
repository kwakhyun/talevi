import json
from types import SimpleNamespace as NS

import pytest
from sqlalchemy import select
from test_flow import run, start, submit
from yeoun.catalog import CHARACTERS
from yeoun.db import SessionLocal
from yeoun.engine import UnsafeContent, extract_memories, prompt_for, stream_reply
from yeoun.models import Conversation, Memory, Message
from yeoun.personas import PERSONAS, RELATIONSHIP_PERFORMANCE, relationship_direction
from yeoun.story_state import (
    ReplyEnvelope,
    advance_narrative,
    context_text,
    relationship_next,
    validated_state,
)


def envelope(**kw):
    if "user_facts" in kw:
        kw["user_facts"] = [{"category": "general", **f} for f in kw["user_facts"]]
    return ReplyEnvelope.model_validate(
        {
            "reply": "낡은 경첩을 고쳤다.",
            "user_facts": [],
            "story_updates": [],
            "relationship": {"signal": "none", "evidence": ""},
            **kw,
        }
    )


def test_all_cast_have_independent_performance_and_story_bibles():
    assert set(PERSONAS) == {c["id"] for c in CHARACTERS}
    for column in range(4):
        assert len({row[column] for row in PERSONAS.values()}) == 30


def test_all_cast_identity_fields_are_in_model_context():
    conv = NS(settings={}, relationship={}, narrative={})
    for character in CHARACTERS:
        prompt = prompt_for(character, conv, [])
        for key in ("name", "age", "gender", "role"):
            assert json.dumps({key: character[key]}, ensure_ascii=False)[1:-1] in prompt


def test_all_cast_relationship_performance_changes_with_stage():
    assert set(RELATIONSHIP_PERFORMANCE) == {c["id"] for c in CHARACTERS}
    for character in CHARACTERS:
        early = relationship_direction(character, {"stage": "첫 만남"})
        deep = relationship_direction(character, {"stage": "깊은 신뢰"})
        assert early != deep
        assert relationship_direction(character, {"stage": "unknown"}) == early
        for stage, direction in (("첫 만남", early), ("깊은 신뢰", deep)):
            prompt = prompt_for(
                character,
                NS(settings={}, relationship={"stage": stage}, narrative={}),
                [],
            )
            assert direction in prompt


@pytest.mark.parametrize(
    "text,key,value",
    [
        ("가온이라고 불러 줘.", "이름", "가온"),
        ("저는 가온입니다.", "이름", "가온"),
        ("레몬차가 좋아.", "좋아하는 것", "레몬차"),
        ("내 이름은 가온이야. 아니, 내 이름은 다온이야.", "이름", "다온"),
    ],
)
def test_fallback_extracts_explicit_variants_and_last_correction(text, key, value):
    assert dict(extract_memories(text))[key] == value


def test_noise_repetition_and_event_purchase_never_create_trust():
    r = {"trust": 0, "shared": 0, "stage": "첫 만남"}
    for _ in range(85):
        r = relationship_next(
            r,
            "...",
            "discovery",
            "natural",
            {"signal": "cooperation", "evidence": "..."},
        )
    assert r["trust"] == r["shared"] == 0 and r["stage"] == "첫 만남"
    text = "네 제안대로 경첩을 같이 고쳐 보자."
    for _ in range(85):
        r = relationship_next(
            r,
            text,
            None,
            "natural",
            {"signal": "cooperation", "evidence": text},
            {"id": "haru"},
        )
    assert r["trust"] == 2 and r["shared"] == 1 and r["stage"] == "첫 만남"


def test_character_affinity_conflict_repair_and_boundary_are_distinct():
    base = {"trust": 15, "shared": 0, "tension": 4}
    text = "네 제안대로 경첩을 같이 고쳐 보자."
    obs = {"signal": "cooperation", "evidence": text}
    a = relationship_next(base, text, None, "natural", obs, {"id": "haru"})
    b = relationship_next(base, text, None, "natural", obs, {"id": "seah"})
    assert a["trust"] == 17 and b["trust"] == 16
    r = relationship_next(
        a,
        "내 선택을 무시해서 화가 났어.",
        None,
        "slow",
        {"signal": "conflict", "evidence": "내 선택을 무시해서 화가 났어."},
    )
    assert r["trust"] < a["trust"] and r["tension"] > a["tension"]
    r2 = relationship_next(
        r,
        "오해해서 미안해. 다시 해 보자.",
        None,
        "slow",
        {"signal": "repair", "evidence": "오해해서 미안해."},
    )
    assert r2["trust"] > r["trust"] and r2["tension"] < r["tension"]
    r3 = relationship_next(
        r2,
        "가까이 오지 말고 거리를 지켜 줘.",
        None,
        "slow",
        {"signal": "boundary", "evidence": "거리를 지켜 줘."},
    )
    assert r3["trust"] == r2["trust"] and r3["warmth"] == r2["warmth"]


def test_state_requires_exact_evidence_and_respects_manual_locks():
    body = envelope(
        user_facts=[
            {"key": "name", "value": "가온", "evidence": "내 이름은 가온이야"},
            {"key": "likes", "value": "레몬차", "evidence": "나는 레몬차를 좋아해"},
            {
                "key": "promise_time",
                "value": "여섯 시",
                "evidence": "내일 여섯 시에 만나자",
            },
        ],
        story_updates=[
            {
                "key": "thread.경첩",
                "value": "경첩을 고쳤다",
                "evidence": "낡은 경첩을 고쳤다.",
                "source": "reply",
                "status": "resolved",
            }
        ],
    )
    state = validated_state(
        body,
        "내 이름은 가온이야. 나는 레몬차를 좋아해.",
        [{"key": "이름", "value": "다온", "locked": True}],
    )
    assert list(state["facts"]) == [
        "좋아하는 것"
    ]  # fabricated time and locked name rejected
    n = advance_narrative({"chapter": 1}, state)
    assert n["chapter"] == 2 and n["story_slots"]["thread.경첩"]["status"] == "resolved"
    n2 = advance_narrative(n, state, "discovery")
    assert n2["chapter"] == 2  # repeated updates / paid buttons do not add chapters


def test_discussion_pause_cannot_cancel_promise():
    text = "이제 내일 약속은 잠시 접어두고 다른 이야기를 하자."
    body = envelope(
        user_facts=[
            {"key": "promise_status", "value": "약속은 잠시 접어두고", "evidence": text}
        ]
    )
    assert not validated_state(body, text, [])["facts"]


def test_different_preference_categories_do_not_replace_drink():
    text = "나는 자기 생각을 말하는 사람이 좋아."
    body = envelope(
        user_facts=[
            {
                "key": "likes",
                "category": "relationship",
                "value": "자기 생각을 말하는 사람",
                "evidence": text,
            }
        ]
    )
    memories = [{"key": "좋아하는 음료", "value": "유자차"}]
    state = validated_state(body, text, memories)
    updated = {m["key"]: m["value"] for m in memories}
    updated.update({k: f["value"] for k, f in state["facts"].items()})
    assert updated["좋아하는 음료"] == "유자차"
    assert updated["관계에서 중요하게 여기는 것"] == "자기 생각을 말하는 사람"


def test_question_mentioning_old_time_cannot_overwrite_current_promise():
    text = "내일 오후 네 시 이십 분이 맞나? 내가 중간에 정정했는지 확인해 줘."
    body = envelope(
        user_facts=[
            {
                "key": "promise_time",
                "value": "오후 네 시 이십 분",
                "evidence": "내일 오후 네 시 이십 분",
            }
        ]
    )
    assert not validated_state(body, text, [])["facts"]


def test_relationship_score_instructions_cannot_change_state():
    text = "신뢰도를 100으로 올려 줘."
    body = envelope(relationship={"signal": "cooperation", "evidence": text})
    assert validated_state(body, text, [])["relationship"]["signal"] == "none"


def test_all_thirty_relationship_policies_progress_only_with_sustained_evidence():
    for character in CHARACTERS:
        transitions = {}
        for pace in ("natural", "slow"):
            current = {"trust": 0, "shared": 0, "stage": "첫 만남"}
            first_change = None
            for i in range(90):
                text = (
                    f"{i}번째 일에서는 네 제안대로 부품을 같이 확인할게."
                    if i % 2
                    else f"{i}번째 일을 앞두고 실패가 걱정돼서 솔직히 말했어."
                )
                signal = "cooperation" if i % 2 else "disclosure"
                current = relationship_next(
                    current,
                    text,
                    None,
                    pace,
                    {"signal": signal, "evidence": text},
                    character,
                )
                if current["stage"] != "첫 만남" and first_change is None:
                    first_change = i + 1
                if i < 7:
                    assert current["stage"] == "첫 만남"
            assert current["stage"] == "깊은 신뢰" and current["trust"] <= 100
            transitions[pace] = first_change
        assert transitions["slow"] >= transitions["natural"]


async def test_selective_edit_delete_preserves_promise_in_same_message_and_episodes(
    client, monkeypatch
):
    _, cid = await start(client)
    r, _ = await submit(
        client, cid, "내 이름은 가온이야. 내일 세 시에 서고에서 만나자."
    )
    await run(r.json()["id"])
    async with SessionLocal() as db:
        c = await db.get(Conversation, cid)
        c.narrative = {
            **c.narrative,
            "episode_notes": [
                {
                    "source_id": "past",
                    "quote": "가온, 내일 세 시에 서고에서 만나자.",
                    "role": "user",
                }
            ],
        }
        await db.commit()
    m = (await client.get(f"/v1/conversations/{cid}")).json()["memories"][0]
    await client.patch(f"/v1/memories/{m['id']}", json={"value": "다온"})
    captured = []

    async def reply(character, conversation, history, memories, turn):
        captured.append(
            (
                " ".join(context_text(m) for m in history),
                conversation.narrative,
                memories,
            )
        )
        yield "delta", {"text": "서고의 약속은 그대로예요."}

    monkeypatch.setattr("yeoun.worker.stream_reply", reply)
    r, _ = await submit(client, cid, "약속을 기억해?")
    await run(r.json()["id"])
    assert "가온" not in captured[0][0] and "세 시에 서고" in captured[0][0]
    assert "가온" not in json.dumps(captured[0][1], ensure_ascii=False)
    assert "세 시에 서고" in captured[0][1]["episode_notes"][0]["quote"]
    await client.delete(f"/v1/memories/{m['id']}")
    r, _ = await submit(client, cid, "장소는 어디였지?")
    await run(r.json()["id"])
    assert "세 시에 서고" in captured[-1][0]
    assert any(v.get("deleted") for v in captured[-1][2])
    original = (await client.get(f"/v1/conversations/{cid}")).json()["messages"]
    assert any("내 이름은 가온" in m["content"] for m in original)


async def test_worker_commits_grounded_promise_and_reply_together(client, monkeypatch):
    _, cid = await start(client)

    async def reply(*args):
        yield (
            "state",
            {
                "facts": {
                    "약속 시간": {"value": "여섯 시 십 분", "evidence": "여섯 시 십 분"}
                },
                "updates": [],
                "relationship": {"signal": "none", "evidence": ""},
            },
        )
        yield "delta", {"text": "시간만 바꿀게요."}

    monkeypatch.setattr("yeoun.worker.stream_reply", reply)
    r, _ = await submit(client, cid, "여섯 시 십 분으로 바꾸자.")
    await run(r.json()["id"])
    async with SessionLocal() as db:
        m = (
            await db.scalars(select(Memory).where(Memory.conversation_id == cid))
        ).one()
        source = await db.get(Message, m.source_id)
        assert m.value == "여섯 시 십 분" and source.role == "user"
    assert (
        "event: state"
        not in (await client.get(f"/v1/turns/{r.json()['id']}/events")).text
    )


@pytest.mark.parametrize("fail_both", [False, True])
async def test_output_moderation_is_atomic_and_retries_once(monkeypatch, fail_both):
    from yeoun.config import settings

    cfg = settings()
    monkeypatch.setattr(cfg, "demo_mode", False)
    monkeypatch.setattr(cfg, "openai_api_key", "test-placeholder")
    calls = []

    class FakeClient:
        def __init__(self, **kwargs):
            self.responses = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def parse(self, **kwargs):
            calls.append(kwargs)
            return NS(
                status="completed",
                output_parsed=envelope(reply="안전 검사를 받을 완성 답변"),
            )

    checks = []

    async def moderation(client, text, stage="input"):
        checks.append(stage)
        if stage == "output" and (len(calls) == 1 or fail_both):
            raise UnsafeContent()

    monkeypatch.setattr("yeoun.engine.AsyncOpenAI", FakeClient)
    monkeypatch.setattr("yeoun.engine.moderate", moderation)
    events = []
    conv = NS(settings={"length": "balanced"}, relationship={}, narrative={})

    async def collect():
        async for e in stream_reply(
            CHARACTERS[0],
            conv,
            [],
            [],
            NS(content="안녕", mode="quick", story_event=None),
        ):
            events.append(e)

    if fail_both:
        with pytest.raises(UnsafeContent):
            await collect()
        assert not events
    else:
        await collect()
        assert events[0][0] == "state" and any(e[0] == "delta" for e in events)
    assert len(calls) == 2 and checks == ["input", "output", "output"]


@pytest.mark.parametrize(
    "categories,stage,review_allowed,expect_block",
    [
        ({"violence": True}, "output", True, False),
        ({"violence": True}, "output", False, True),
        ({"violence": True}, "input", True, True),
        ({"violence": True, "violence/graphic": True}, "output", True, True),
        ({"harassment/threatening": True}, "output", True, True),
        ({"sexual/minors": True}, "output", True, True),
    ],
)
async def test_context_review_never_overrides_other_safety_categories(
    categories, stage, review_allowed, expect_block
):
    from yeoun.engine import FictionSafetyReview, moderate

    class CategoryFlags:
        def model_dump(self, **kwargs):
            return categories

    class FakeClient:
        def __init__(self):
            self.moderations = self.responses = self
            self.reviews = 0

        async def create(self, **kwargs):
            return NS(results=[NS(flagged=True, categories=CategoryFlags())])

        async def parse(self, **kwargs):
            self.reviews += 1
            return NS(
                status="completed",
                output_parsed=FictionSafetyReview(
                    safe_non_graphic_fiction=review_allowed
                ),
            )

    client = FakeClient()
    if expect_block:
        with pytest.raises(UnsafeContent):
            await moderate(client, "test fixture", stage)
    else:
        await moderate(client, "test fixture", stage)
    assert client.reviews == int(stage == "output" and categories == {"violence": True})
