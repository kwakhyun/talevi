"""Validated, source-backed state shared by the worker and live evaluation.

Models propose observations. Only exact quotes from the current successful turn
may change state; relationship scores and progression are computed here.
"""

import hashlib
import re
from typing import Literal

from pydantic import BaseModel, Field

from .personas import persona_for

FACT_KEYS = {
    "name": "이름",
    "likes": "좋아하는 것",
    "promise_time": "약속 시간",
    "promise_place": "약속 장소",
    "promise_item": "약속 준비물",
    "promise_status": "약속 상태",
}
PREFERENCE_KEYS = {
    "drink": "좋아하는 음료",
    "food": "좋아하는 음식",
    "music": "좋아하는 음악",
    "activity": "좋아하는 활동",
    "relationship": "관계에서 중요하게 여기는 것",
    "general": "좋아하는 것",
}


class UserFact(BaseModel):
    key: Literal[
        "name",
        "likes",
        "promise_time",
        "promise_place",
        "promise_item",
        "promise_status",
    ]
    value: str
    evidence: str
    category: Literal[
        "general", "drink", "food", "music", "activity", "relationship"
    ] = Field(
        description="For likes only, distinguish drink, food, music, activity and relationship values. All other keys use general.",
    )


class StoryUpdate(BaseModel):
    key: str = Field(
        description="Stable slot: scene.place, scene.goal, scene.conflict, choice, consequence, thread.<name>, or past.<name>. Reuse existing keys for updates."
    )
    value: str = Field(
        description="A concise exact substring of evidence, not a summary or instruction."
    )
    evidence: str
    source: Literal["user", "reply"]
    status: Literal["active", "resolved"]


class RelationObservation(BaseModel):
    signal: Literal[
        "none", "cooperation", "disclosure", "repair", "conflict", "boundary"
    ]
    evidence: str


class ReplyEnvelope(BaseModel):
    reply: str
    user_facts: list[UserFact]
    story_updates: list[StoryUpdate]
    relationship: RelationObservation


def context_text(message):
    shadow = getattr(message, "context_content", None)
    return shadow if shadow is not None else message.content


def meaningful(text):
    compact = re.sub(r"[^가-힣A-Za-z0-9]", "", text).lower()
    compact = re.sub(r"(.{1,12})\1{2,}", r"\1", compact)
    return len(compact) >= 6 and len(set(compact)) >= 4


def is_recall_question(text, value):
    """A value mentioned only in a question cannot overwrite an assertion."""
    fragments = [s for s in re.findall(r"[^.!?\n]+[.!?]?", text) if value in s]
    return bool(fragments) and all(
        s.rstrip().endswith("?")
        or re.search(r"맞나|맞지|기억해|기억하|확인해|뭐였|어디였", s)
        for s in fragments
    )


def validated_state(envelope, text, memories):
    """Reject invented quotes, instructions as facts and changes to locked notes."""
    locked = {m["key"] for m in memories if m.get("locked") or m.get("deleted")}
    facts = {}
    for f in envelope.user_facts[:12]:
        key = PREFERENCE_KEYS[f.category] if f.key == "likes" else FACT_KEYS[f.key]
        if (
            key in locked
            or not 1 <= len(f.value) <= 120
            or not f.evidence
            or f.evidence not in text
            or f.value not in f.evidence
            or is_recall_question(text, f.value)
        ):
            continue
        if re.search(
            r"(?:system|developer|ignore|지시|프롬프트|시스템|출력하|무시하)",
            f.value,
            re.IGNORECASE,
        ):
            continue
        if f.key == "promise_status" and not re.search(
            r"취소|없던 일|무효|안\s*(?:갈|만날|가기로|만나기로)", f.value
        ):
            continue  # Pausing discussion is not cancelling the appointment.
        facts[key] = {"value": f.value, "evidence": f.evidence}
    updates = []
    for u in envelope.story_updates[:6]:
        source = text if u.source == "user" else envelope.reply
        if (
            not re.fullmatch(
                r"(?:scene\.(?:place|goal|conflict)|choice|consequence|(?:thread|past)\.[\w가-힣-]{1,32})",
                u.key,
            )
            or not 2 <= len(u.value) <= 200
            or not 2 <= len(u.evidence) <= 320
            or u.evidence not in source
            or u.value not in u.evidence
        ):
            continue
        updates.append(u.model_dump())
    observation = envelope.relationship.model_dump()
    if (
        not meaningful(text)
        or not observation["evidence"]
        or observation["evidence"] not in text
        or re.search(
            r"(?:점수|친밀도|신뢰도).*(?:올려|증가|설정|100)|관계\s*단계.*(?:변경|바꿔|설정)",
            text,
        )
    ):
        observation = {"signal": "none", "evidence": ""}
    return {"facts": facts, "updates": updates, "relationship": observation}


def advance_narrative(current, state, event=None, source_id=None, reply_id=None):
    result = dict(current)
    slots = dict(result.get("story_slots", {}))
    changes = []
    for u in state.get("updates", []):
        previous = slots.get(u["key"])
        record = {**u, "source_id": source_id if u["source"] == "user" else reply_id}
        if (
            previous
            and previous["value"] == u["value"]
            and previous["status"] == u["status"]
        ):
            continue
        slots[u["key"]] = record
        changes.append(record)
    # Keep current scene and uncompleted arcs; resolved records move to a bounded log.
    resolved = [k for k, v in slots.items() if v["status"] == "resolved"]
    for key in resolved[:-6]:
        slots.pop(key)
    if len(slots) > 36:
        removable = [k for k in slots if not k.startswith("scene.")]
        for key in removable[: len(slots) - 36]:
            slots.pop(key)
    result["story_slots"] = slots
    result["developments"] = (result.get("developments", []) + changes)[-10:]
    result["beat"] = result.get("beat", 0) + 1
    # Chapters mark completed conflicts, never an event-button purchase.
    resolved_now = sum(
        u["status"] == "resolved" and u["key"].startswith("thread.") for u in changes
    )
    result["chapter"] = result.get("chapter", 1) + min(resolved_now, 1)
    if event:
        result["last_event"] = event
    return result


def relationship_next(current, text, event, pace, observation=None, character=None):
    result = dict(current)
    observation = observation or {"signal": "none", "evidence": ""}
    signal, quote = observation.get("signal", "none"), observation.get("evidence", "")
    fingerprint = hashlib.sha256(re.sub(r"\W", "", text).lower().encode()).hexdigest()[
        :20
    ]
    recent = list(result.get("recent_inputs", []))
    repeats = fingerprint in recent
    result["recent_inputs"] = (recent + [fingerprint])[-128:]
    result.setdefault("warmth", 0)
    result.setdefault("tension", 0)
    result.setdefault("meaningful_turns", 0)
    result.setdefault("shared", 0)
    result.setdefault("trust", 0)
    labels = {
        "cooperation": "함께 선택하고 행동했어요",
        "disclosure": "자신의 이야기를 들려줬어요",
        "repair": "엇갈린 마음을 다시 풀었어요",
        "conflict": "풀어야 할 갈등이 남았어요",
        "boundary": "편안한 거리를 알려줬어요",
    }
    qualifies = (
        meaningful(text)
        and not repeats
        and quote
        and quote in text
        and signal in labels
    )
    if qualifies:
        previous = result.get("last_signal")
        streak = result.get("signal_streak", 0) + 1 if previous == signal else 1
        result.update(last_signal=signal, signal_streak=streak)
        profile = persona_for(character) if character else {"reserve": 1}
        delta = 0
        if signal == "boundary":
            result["tension"] = max(0, result["tension"] - 1)
        elif signal == "conflict":
            delta = -2
            result["tension"] = min(100, result["tension"] + 4)
        elif streak <= 3:
            result["meaningful_turns"] += 1
            delta = 1 + int(profile.get("affinity") == signal and pace == "natural")
            result["warmth"] = min(
                100, result["warmth"] + int(signal in ("disclosure", "repair"))
            )
            result["tension"] = max(0, result["tension"] - int(signal == "repair") * 3)
            result["shared"] += int(signal == "cooperation")
        result["trust"] = max(0, min(100, result["trust"] + delta))
        result["last_change"] = {
            "reason": labels[signal],
            "evidence": quote[:200],
            "delta": delta,
        }
        result["changes"] = (result.get("changes", []) + [result["last_change"]])[-6:]
    reserve = persona_for(character).get("reserve", 1) if character else 1
    thresholds = [12, 32, 60] if pace == "natural" else [20, 45, 75]
    turns = result["meaningful_turns"]
    level = sum(
        result["trust"] >= t + reserve * 3 and turns >= n
        for t, n in zip(thresholds, [8, 22, 45])
    )
    result["stage"] = ("첫 만남", "익숙한 사이", "마음을 나누는 사이", "깊은 신뢰")[
        level
    ]
    result["version"] = 2
    return result
