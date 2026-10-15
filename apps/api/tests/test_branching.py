"""Branching integration tests never call a model or an external HTTP provider."""

import asyncio
import copy
import json
import time
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select, update
from yeoun import worker
from yeoun.branching import capture_state, remap_snapshot
from yeoun.db import SessionLocal
from yeoun.main import app
from yeoun.models import (
    BranchRequest,
    Conversation,
    ConversationCheckpoint,
    Ledger,
    Memory,
    Message,
    Turn,
    User,
)
from yeoun.worker import finish


async def start(client):
    user = (await client.post("/v1/auth/guest", json={})).json()["user"]
    cid = (
        await client.post("/v1/conversations", json={"character_id": "haru"})
    ).json()["id"]
    return user, cid


async def read(client, cid):
    response = await client.get(f"/v1/conversations/{cid}")
    assert response.status_code == 200, response.text
    return response.json()


async def completed(client, cid, content="첫 번째 입력", mode="quick", event=None):
    response = await client.post(
        f"/v1/conversations/{cid}/turns",
        json={
            "client_id": str(uuid.uuid4()),
            "content": content,
            "mode": mode,
            "story_event": event,
        },
    )
    assert response.status_code == 202, response.text
    tid = response.json()["id"]
    await finish(tid, "직접 작성한 테스트 답변: " + content, reply_state={})
    return (await read(client, cid))["messages"][-1]


async def branch(client, cid, message_id, action="branch", **extra):
    body = {
        "client_id": str(uuid.uuid4()),
        "message_id": message_id,
        "action": action,
        **extra,
    }
    response = await client.post(f"/v1/conversations/{cid}/branches", json=body)
    return response, body


async def test_branch_restores_full_historical_state_and_nested_anchors(client):
    user, cid = await start(client)
    opening = (await read(client, cid))["messages"][0]
    async with SessionLocal() as db:
        c = await db.get(Conversation, cid)
        c.settings = {
            "memory_enabled": True,
            "pace": "natural",
            "length": "long",
            "context_reset_at": 0.5,
        }
        c.relationship = {
            "trust": 17,
            "shared": 2,
            "stage": "가까운 사이",
            "changes": [{"source_id": opening["id"], "reason": "과거 근거"}],
        }
        c.narrative = {
            "chapter": 3,
            "beat": 4,
            "last_event": "quiet",
            "episode_cutoff": 0.5,
            "episode_notes": [
                {
                    "source_id": opening["id"],
                    "quote": "과거 장면",
                    "role": "assistant",
                    "created": 0.1,
                }
            ],
            "story_slots": {
                "promise": {
                    "source_id": opening["id"],
                    "value": "과거 약속",
                    "status": "active",
                }
            },
        }
        db.add(
            Memory(
                conversation_id=cid,
                key="locked",
                value="과거 값",
                locked=True,
                source_id=opening["id"],
            )
        )
        db.add(
            Memory(
                conversation_id=cid, key="deleted", value="", locked=True, deleted=True
            )
        )
        original = await db.get(Message, opening["id"])
        original.context_content = "과거의 선택적 문맥"
        original.memory_redacted = True
        await db.commit()
    assistant = await completed(client, cid, mode="story", event="quiet")
    async with SessionLocal() as db:
        expected = copy.deepcopy(
            (
                await db.scalars(
                    select(ConversationCheckpoint).where(
                        ConversationCheckpoint.message_id == assistant["id"],
                        ConversationCheckpoint.phase == "after",
                    )
                )
            )
            .one()
            .snapshot
        )
        c = await db.get(Conversation, cid)
        c.settings = {**c.settings, "context_reset_at": time.time(), "length": "short"}
        c.narrative = {"chapter": 99, "beat": 999, "last_event": "discovery"}
        c.relationship = {"trust": 99, "stage": "미래 관계", "shared": 999}
        for memory in (
            await db.scalars(select(Memory).where(Memory.conversation_id == cid))
        ).all():
            memory.value = "미래에 고친 값"
            memory.deleted = False
            memory.locked = False
            memory.source_id = None
        original = await db.get(Message, opening["id"])
        original.context_content = "미래의 마스크"
        await db.commit()
    await completed(client, cid, "미래 메시지")
    before_original = await read(client, cid)
    credits = (await client.get("/v1/me")).json()["credits"]
    response, body = await branch(client, cid, assistant["id"])
    assert response.status_code == 202, response.text
    assert response.json()["cost"] == 0 and response.json()["turn_id"] is None
    clone = await read(client, response.json()["conversation_id"])
    assert len(clone["messages"]) == 3
    mapping = dict(
        zip(
            [message["id"] for message in before_original["messages"][:3]],
            [message["id"] for message in clone["messages"]],
            strict=True,
        )
    )
    assert not set(mapping) & set(mapping.values())
    async with SessionLocal() as db:
        restored = await capture_state(db, await db.get(Conversation, clone["id"]))
        source_rows = {
            m.id: m
            for m in (
                await db.scalars(select(Message).where(Message.id.in_(mapping)))
            ).all()
        }
        clone_rows = {
            m.id: m
            for m in (
                await db.scalars(
                    select(Message).where(Message.id.in_(mapping.values()))
                )
            ).all()
        }
        ordinal_mapping = {
            source_rows[source_id].ordinal: clone_rows[target_id].ordinal
            for source_id, target_id in mapping.items()
        }
        assert restored == remap_snapshot(expected, mapping, ordinal_mapping)
    assert clone["branch"] == {
        "parent_id": cid,
        "message_id": assistant["id"],
        "action": "branch",
    }
    assert clone["messages"][0]["actions"] == {
        "branch": True,
        "regenerate": False,
        "edit": False,
    }
    assert clone["messages"][1]["actions"]["edit"]
    assert clone["messages"][2]["actions"]["regenerate"]
    assert clone["messages"][2]["action_cost"] == 3
    repeated = await client.post(f"/v1/conversations/{cid}/branches", json=body)
    assert repeated.json() == response.json()
    assert (await client.get("/v1/me")).json()["credits"] == credits
    assert await read(client, cid) == before_original
    nested, _ = await branch(
        client, clone["id"], clone["messages"][2]["id"], "regenerate"
    )
    assert nested.status_code == 202, nested.text
    nested_c = await read(client, nested.json()["conversation_id"])
    assert [m["role"] for m in nested_c["messages"]] == ["assistant", "user"]
    assert nested_c["messages"][-1]["content"] == "첫 번째 입력"
    async with SessionLocal() as db:
        turn = await db.get(Turn, nested.json()["turn_id"])
        assert (turn.mode, turn.story_event, turn.cost) == ("story", "quiet", 3)


async def test_edit_restores_before_turn_and_preserves_original(client):
    _, cid = await start(client)
    assistant = await completed(client, cid)
    original = await read(client, cid)
    user_message = original["messages"][1]
    async with SessionLocal() as db:
        expected = copy.deepcopy(
            (
                await db.scalars(
                    select(ConversationCheckpoint).where(
                        ConversationCheckpoint.message_id == user_message["id"],
                        ConversationCheckpoint.phase == "before",
                    )
                )
            )
            .one()
            .snapshot
        )
    response, _ = await branch(
        client, cid, user_message["id"], "edit", content="수정한 선택"
    )
    assert response.status_code == 202, response.text
    clone = await read(client, response.json()["conversation_id"])
    assert [m["content"] for m in clone["messages"]][1:] == ["수정한 선택"]
    assert clone["relationship"] == expected["relationship"]
    assert clone["narrative"] == expected["narrative"]
    assert clone["memories"] == []
    assert await read(client, cid) == original
    await finish(response.json()["turn_id"], "수정 뒤의 테스트 답변", reply_state={})
    clone = await read(client, clone["id"])
    assert clone["messages"][-1]["actions"]["regenerate"]
    nested, _ = await branch(
        client, clone["id"], clone["messages"][1]["id"], "edit", content="다시 수정"
    )
    assert nested.status_code == 202, nested.text
    assert assistant["id"] not in [m["id"] for m in clone["messages"]]


async def test_concurrent_branch_receipt_and_global_client_id_conflicts(client):
    _, cid = await start(client)
    assistant = await completed(client, cid)
    body = {
        "client_id": str(uuid.uuid4()),
        "message_id": assistant["id"],
        "action": "regenerate",
    }
    a, b = await asyncio.gather(
        *(client.post(f"/v1/conversations/{cid}/branches", json=body) for _ in range(2))
    )
    assert a.status_code == b.status_code == 202
    assert a.json() == b.json()
    assert (await client.get("/v1/me")).json()["credits"] == 28
    changed = await client.post(
        f"/v1/conversations/{cid}/branches", json={**body, "action": "branch"}
    )
    assert changed.status_code == 409
    regular = await client.post(
        f"/v1/conversations/{cid}/turns",
        json={"client_id": body["client_id"], "content": "다른 요청"},
    )
    assert regular.status_code == 409
    async with SessionLocal() as db:
        assert len((await db.scalars(select(BranchRequest))).all()) == 1
        assert (
            len(
                (
                    await db.scalars(select(Ledger).where(Ledger.reason == "짧은 대화"))
                ).all()
            )
            == 2
        )


async def test_branch_rejects_active_ownership_unknown_snapshot_and_no_credits(client):
    user, cid = await start(client)
    assistant = await completed(client, cid)
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Yeoun-Client": "1"},
    ) as stranger:
        await stranger.post("/v1/auth/guest", json={})
        denied, _ = await branch(stranger, cid, assistant["id"])
        assert denied.status_code == 404
    pending = await client.post(
        f"/v1/conversations/{cid}/turns",
        json={"client_id": str(uuid.uuid4()), "content": "진행 중"},
    )
    blocked, _ = await branch(client, cid, assistant["id"])
    assert blocked.status_code == 409
    await finish(pending.json()["id"], error="test_interruption")
    async with SessionLocal() as db:
        await db.execute(update(User).where(User.id == user["id"]).values(credits=0))
        await db.commit()
    low_balance, _ = await branch(client, cid, assistant["id"], "regenerate")
    assert low_balance.status_code == 402
    free, _ = await branch(client, cid, assistant["id"])
    assert free.status_code == 202
    async with SessionLocal() as db:
        # Simulate pre-feature history. Never infer an earlier state from latest data.
        await db.execute(
            delete(ConversationCheckpoint).where(
                ConversationCheckpoint.conversation_id == cid
            )
        )
        await db.commit()
    old = await read(client, cid)
    assert all(not any(message["actions"].values()) for message in old["messages"])
    unavailable, _ = await branch(client, cid, assistant["id"])
    assert unavailable.status_code == 409
    async with SessionLocal() as db:
        assert (
            len((await db.scalars(select(Conversation))).all()) == 2
        )  # failed charge cloned nothing


async def test_finish_checkpoint_failure_rolls_back_reply_and_state(
    client, monkeypatch
):
    _, cid = await start(client)
    response = await client.post(
        f"/v1/conversations/{cid}/turns",
        json={"client_id": str(uuid.uuid4()), "content": "원자적 완료"},
    )
    tid = response.json()["id"]
    before = await read(client, cid)

    async def broken(*args, **kwargs):
        raise RuntimeError("checkpoint write failed")

    monkeypatch.setattr(worker, "save_checkpoint", broken)
    with pytest.raises(RuntimeError, match="checkpoint write failed"):
        await finish(tid, "저장되어서는 안 되는 답변", reply_state={})
    after = await read(client, cid)
    assert after == before
    async with SessionLocal() as db:
        assert (await db.get(Turn, tid)).status == "pending"


async def test_same_timestamp_history_order_survives_nested_cloning(client):
    _, cid = await start(client)
    # Force a timestamp tie before the next pre/post snapshot is captured.
    first = await completed(client, cid, "첫 메시지")
    async with SessionLocal() as db:
        messages = (
            await db.scalars(select(Message).where(Message.conversation_id == cid))
        ).all()
        for message in messages:
            message.created = 123.0
        await db.commit()
    second = await completed(client, cid, "두 번째 메시지")
    source = await read(client, cid)
    response, _ = await branch(client, cid, second["id"])
    assert response.status_code == 202
    cloned = await read(client, response.json()["conversation_id"])
    assert [m["content"] for m in cloned["messages"]] == [
        m["content"] for m in source["messages"]
    ]
    again, _ = await branch(client, cloned["id"], cloned["messages"][-1]["id"])
    assert again.status_code == 202
    nested = await read(client, again.json()["conversation_id"])
    assert [m["content"] for m in nested["messages"]] == [
        m["content"] for m in source["messages"]
    ]
    assert first["content"] in [m["content"] for m in nested["messages"]]


async def test_v2_boundary_excludes_future_backdated_rows_after_nested_branch(client):
    _, cid = await start(client)
    assistant = await completed(client, cid)
    original_messages = (await read(client, cid))["messages"]
    async with SessionLocal() as db:
        db.add(
            Message(
                conversation_id=cid,
                role="assistant",
                content="나중에 추가한 과거 날짜",
                created=0.01,
            )
        )
        await db.commit()
    response, _ = await branch(client, cid, assistant["id"])
    assert response.status_code == 202, response.text
    clone = await read(client, response.json()["conversation_id"])
    assert [m["content"] for m in clone["messages"]] == [
        m["content"] for m in original_messages
    ]
    async with SessionLocal() as db:
        db.add(
            Message(
                conversation_id=clone["id"],
                role="assistant",
                content="분기 뒤 역순 날짜",
                created=0.0,
            )
        )
        await db.commit()
    nested, _ = await branch(client, clone["id"], clone["messages"][-1]["id"])
    assert nested.status_code == 202, nested.text
    nested_messages = (await read(client, nested.json()["conversation_id"]))["messages"]
    assert [m["content"] for m in nested_messages] == [
        m["content"] for m in original_messages
    ]


async def test_v2_snapshot_prefix_size_does_not_grow_with_message_count(client):
    _, cid = await start(client)
    async with SessionLocal() as db:
        conversation = await db.get(Conversation, cid)
        small = await capture_state(db, conversation)
        db.add_all(
            [
                Message(
                    conversation_id=cid, role="assistant", content=f"메시지 {index}"
                )
                for index in range(2000)
            ]
        )
        large = await capture_state(db, conversation)
        assert large["version"] == 2
        assert "message_ids" not in large
        assert large["message_count"] == 2001
        assert large["message_context"] == {}
        # Only decimal boundary/count digit lengths change, not a 2,001-ID array.
        assert len(json.dumps(large)) - len(json.dumps(small)) < 32


async def test_v1_snapshots_remain_restorable_without_reconstructing_past(client):
    _, cid = await start(client)
    assistant = await completed(client, cid)
    async with SessionLocal() as db:
        for checkpoint in (
            await db.scalars(
                select(ConversationCheckpoint).where(
                    ConversationCheckpoint.conversation_id == cid
                )
            )
        ).all():
            saved = copy.deepcopy(checkpoint.snapshot)
            saved["message_ids"] = list(
                (
                    await db.scalars(
                        select(Message.id)
                        .where(
                            Message.conversation_id == cid,
                            Message.ordinal <= saved["message_boundary"],
                        )
                        .order_by(Message.created, Message.id)
                    )
                ).all()
            )
            saved["version"] = 1
            del saved["message_boundary"]
            del saved["message_count"]
            checkpoint.snapshot = saved
        await db.commit()
    response, _ = await branch(client, cid, assistant["id"])
    assert response.status_code == 202, response.text
    clone = await read(client, response.json()["conversation_id"])
    assert len(clone["messages"]) == 3
    regenerated, _ = await branch(
        client, clone["id"], clone["messages"][-1]["id"], "regenerate"
    )
    assert regenerated.status_code == 202, regenerated.text
    assert (
        len((await read(client, regenerated.json()["conversation_id"]))["messages"])
        == 2
    )
