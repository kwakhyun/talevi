import time
from types import SimpleNamespace

from test_flow import run, start, submit
from yeoun.db import SessionLocal
from yeoun.episodes import Excerpt, compact_episodes, validated_excerpts
from yeoun.models import Conversation, Message


def history(size):
    return [
        SimpleNamespace(
            id=str(i),
            role="user" if i % 2 else "assistant",
            content=f"기억할 장면 {i}",
            created=float(i + 1),
            status="complete",
            memory_redacted=False,
        )
        for i in range(size)
    ]


def test_excerpts_reject_invented_and_misattributed_quotes():
    sources = [{"source_id": "1", "quote": "내일 등대에서 만나자.", "role": "user"}]
    selected = [
        Excerpt(source_id="2", quote="내일 등대에서"),
        Excerpt(source_id="1", quote="내일 항구에서"),
        Excerpt(source_id="1", quote="등대에서 만나자."),
        Excerpt(source_id="1", quote="등대에서 만나자."),
    ]
    notes = validated_excerpts(selected, sources)
    assert len(notes) == 1 and notes[0]["quote"] == "등대에서 만나자."
    assert notes[0]["role"] == "user"


async def test_compaction_preserves_recent_and_excludes_deleted_or_failed():
    messages = history(60)
    messages[19].memory_redacted = True
    messages[18].status = "failed"
    state, recent = await compact_episodes({"chapter": 2}, messages)
    assert recent == messages[-40:]
    assert state["chapter"] == 2 and state["episode_cutoff"] == 20
    assert len(state["episode_notes"]) == 8
    assert all(n["source_id"] not in ("18", "19") for n in state["episode_notes"])


async def seed_messages(cid, count=54):
    async with SessionLocal() as db:
        for i in range(count):
            db.add(
                Message(
                    conversation_id=cid,
                    role="user" if i % 2 else "assistant",
                    content=f"대화 원문 {i}",
                    created=time.time() - count + i - 1,
                )
            )
        await db.commit()


async def test_episode_persistence_and_user_erasure(client):
    _, cid = await start(client)
    await seed_messages(cid)
    r, _ = await submit(client, cid, "계속 이야기해 줘.")
    await run(r.json()["id"])
    conv = (await client.get("/v1/conversations/" + cid)).json()
    assert len(conv["narrative"]["episode_notes"]) == 8
    assert (await client.delete(f"/v1/conversations/{cid}/episodes")).status_code == 200
    conv = (await client.get("/v1/conversations/" + cid)).json()
    assert "episode_notes" not in conv["narrative"]
    async with SessionLocal() as db:
        c = await db.get(Conversation, cid)
        assert c.settings["context_reset_at"] > 0
    r, _ = await submit(client, cid, "새로 시작하자.")
    await run(r.json()["id"])
    assert (
        "episode_notes"
        not in (await client.get("/v1/conversations/" + cid)).json()["narrative"]
    )


async def test_failed_compaction_keeps_latest_context(client, monkeypatch):
    _, cid = await start(client)
    await seed_messages(cid, 120)
    captured = []

    async def broken(*args):
        raise RuntimeError("provider down")

    async def reply(character, conversation, messages, memories, turn):
        captured.extend(messages)
        yield ("delta", {"text": "대화는 계속할 수 있어요."})

    monkeypatch.setattr("yeoun.worker.compact_episodes", broken)
    monkeypatch.setattr("yeoun.worker.stream_reply", reply)
    r, _ = await submit(client, cid)
    await run(r.json()["id"])
    assert len(captured) == 40
    assert "대화 원문 119" in [m.content for m in captured]
    conv = (await client.get("/v1/conversations/" + cid)).json()
    assert conv["messages"][-1]["content"] == "대화는 계속할 수 있어요."
    assert conv["active_turn"] is None


async def test_disabled_memory_excludes_episodes_and_new_fact_preserves_other_history(
    client, monkeypatch
):
    _, cid = await start(client)
    async with SessionLocal() as db:
        c = await db.get(Conversation, cid)
        c.narrative = {
            **c.narrative,
            "episode_notes": [
                {
                    "source_id": "past",
                    "quote": "오래된 약속",
                    "role": "user",
                    "created": 1,
                }
            ],
            "episode_cutoff": 1,
        }
        await db.commit()
    await client.patch(
        f"/v1/conversations/{cid}/settings",
        json={"memory_enabled": False, "pace": "slow", "length": "short"},
    )
    captured = []

    async def reply(character, conversation, messages, memories, turn):
        captured.append(conversation.narrative)
        assert not memories
        yield ("delta", {"text": "지금 이야기만 이어갈게요."})

    monkeypatch.setattr("yeoun.worker.stream_reply", reply)
    r, _ = await submit(client, cid)
    await run(r.json()["id"])
    assert "episode_notes" not in captured[0]
    await client.post(
        f"/v1/conversations/{cid}/memories", json={"key": "약속", "value": "새 약속"}
    )
    saved = (await client.get("/v1/conversations/" + cid)).json()
    assert saved["narrative"]["episode_notes"][0]["quote"] == "오래된 약속"


async def test_worker_passes_saved_memory_to_model(client, monkeypatch):
    _, cid = await start(client)
    await client.post(
        f"/v1/conversations/{cid}/memories", json={"key": "이름", "value": "민"}
    )
    await client.post(
        f"/v1/conversations/{cid}/memories",
        json={"key": "좋아하는 것", "value": "재즈"},
    )
    captured = []

    async def reply(character, conversation, messages, memories, turn):
        captured.extend(memories)
        yield ("delta", {"text": "민 님, 재즈를 좋아하시죠."})

    monkeypatch.setattr("yeoun.worker.stream_reply", reply)
    r, _ = await submit(client, cid, "내 이름과 좋아하는 음악은?")
    await run(r.json()["id"])
    assert {m["key"]: m["value"] for m in captured} == {
        "이름": "민",
        "좋아하는 것": "재즈",
    }
