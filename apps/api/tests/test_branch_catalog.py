"""All 30 characters use the same historical context path; no provider calls."""

import copy
import uuid

import httpx
import pytest
from test_flow import run, start, submit
from yeoun.catalog import CHARACTERS
from yeoun.story_state import context_text


@pytest.mark.parametrize("character_id", [c["id"] for c in CHARACTERS])
async def test_every_character_restores_context_before_regeneration_and_edit(
    client, monkeypatch, character_id
):
    observed = []

    async def reply(character, conversation, history, memories, turn):
        observed.append(
            {
                "character": character["id"],
                "input": turn.content,
                "history": [context_text(m) for m in history],
                "memories": copy.deepcopy(memories),
                "relationship": copy.deepcopy(conversation.relationship),
                "narrative": copy.deepcopy(conversation.narrative),
            }
        )
        name, place = (
            ("새봄", "정원")
            if "새봄" in turn.content
            else ("다온", "항구")
            if "다온" in turn.content
            else ("가온", "도서관")
        )
        yield (
            "state",
            {
                "facts": {"이름": {"value": name, "evidence": turn.content}},
                "updates": [
                    {
                        "key": "scene.place",
                        "value": place,
                        "evidence": turn.content,
                        "source": "user",
                        "status": "active",
                    }
                ],
                "relationship": {"signal": "cooperation", "evidence": turn.content},
            },
        )
        yield "delta", {"text": f"{name}, {place}에서 이야기를 이어가요."}

    monkeypatch.setattr("yeoun.worker.stream_reply", reply)
    user, cid = await start(client, character_id)
    first_text = "내 이름은 가온이야. 함께 도서관에서 단서를 찾아보자."
    response, _ = await submit(client, cid, first_text)
    await run(response.json()["id"])
    before = (await client.get(f"/v1/conversations/{cid}")).json()
    first_user, first_reply = before["messages"][-2:]
    assert first_user["actions"]["edit"]
    assert first_reply["actions"]["regenerate"] and first_reply["actions"]["branch"]

    future_text = "내 이름은 다온이야. 약속을 취소하고 항구로 떠나자."
    response, _ = await submit(client, cid, future_text)
    await run(response.json()["id"])
    original = (await client.get(f"/v1/conversations/{cid}")).json()

    async def action(message_id, kind, **extra):
        result = await client.post(
            f"/v1/conversations/{cid}/branches",
            json={
                "client_id": str(uuid.uuid4()),
                "message_id": message_id,
                "action": kind,
                **extra,
            },
        )
        assert result.status_code in (200, 201, 202), result.text
        return result.json()

    branched = await action(first_reply["id"], "branch")
    assert branched["cost"] == 0 and branched["turn_id"] is None
    branch = (
        await client.get(f"/v1/conversations/{branched['conversation_id']}")
    ).json()
    assert branch["character_id"] == character_id
    assert branch["relationship"] == before["relationship"]
    assert branch["settings"] == before["settings"]
    assert [m["content"] for m in branch["messages"]] == [
        m["content"] for m in before["messages"]
    ]
    assert [(m["key"], m["value"], m["locked"]) for m in branch["memories"]] == [
        (m["key"], m["value"], m["locked"]) for m in before["memories"]
    ]
    copied_ids = {m["id"] for m in branch["messages"]}
    assert copied_ids.isdisjoint(m["id"] for m in before["messages"])
    assert branch["memories"][0]["source_id"] in copied_ids
    slot = branch["narrative"]["story_slots"]["scene.place"]
    assert slot["value"] == "도서관" and slot["source_id"] in copied_ids

    regenerated = await action(first_reply["id"], "regenerate")
    assert regenerated["cost"] == 1
    await run(regenerated["turn_id"])
    replay = observed[-1]
    assert replay["character"] == character_id and replay["input"] == first_text
    assert replay["history"] == observed[0]["history"]
    assert replay["memories"] == observed[0]["memories"] == []
    assert replay["relationship"] == observed[0]["relationship"]
    assert replay["narrative"] == observed[0]["narrative"]

    edited_text = "내 이름은 새봄이야. 내일 정원에서 함께 단서를 찾자."
    edited = await action(first_user["id"], "edit", content=edited_text)
    assert edited["cost"] == 1
    await run(edited["turn_id"])
    replay = observed[-1]
    assert replay["input"] == edited_text
    assert replay["history"] == observed[0]["history"]
    assert replay["memories"] == []
    assert replay["relationship"] == observed[0]["relationship"]
    assert replay["narrative"] == observed[0]["narrative"]
    final = (await client.get(f"/v1/conversations/{edited['conversation_id']}")).json()
    assert final["memories"][0]["value"] == "새봄"
    assert final["narrative"]["story_slots"]["scene.place"]["value"] == "정원"
    assert (await client.get(f"/v1/conversations/{cid}")).json() == original
    assert (await client.get("/v1/me")).json()["credits"] == user["credits"] - 4


async def test_test_suite_blocks_external_http():
    # Prove the guard intercepts the default transport before any outbound request.
    async with httpx.AsyncClient() as external:
        with pytest.raises(pytest.fail.Exception, match="External HTTP is disabled"):
            await external.get("https://network-disabled.invalid/")
    with httpx.Client() as external:
        with pytest.raises(pytest.fail.Exception, match="External HTTP is disabled"):
            external.get("https://network-disabled.invalid/")
