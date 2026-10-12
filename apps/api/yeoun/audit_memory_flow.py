"""Opt-in HTTP/DB/SSE audit using one new synthetic guest, never existing users."""

import asyncio
import json
import os
import time
import uuid
from pathlib import Path

import httpx


async def main():
    target = (
        Path(
            os.getenv("CAST_AUDIT_OUTPUT", "../../docs/evidence/cast-audit-2026-10-10")
        )
        / "memory-http.json"
    )
    if target.exists():
        raise SystemExit("Evidence exists; not repeating paid requests.")
    evidence = {
        "scope": "isolated synthetic guest; actual local HTTP, PostgreSQL, worker, SSE and LLM",
        "results": [],
    }
    async with httpx.AsyncClient(
        base_url="http://127.0.0.1:8000",
        timeout=160,
        headers={"X-Yeoun-Client": "1", "Origin": "http://localhost:3000"},
    ) as client:

        async def request(method, path, body=None):
            response = await client.request(method, path, json=body)
            response.raise_for_status()
            return response.json()

        evidence["health"] = await request("GET", "/health")
        assert evidence["health"]["mode"] == "live"
        guest = await request("POST", "/v1/auth/guest", {"native": False})
        evidence["synthetic_user_id"] = guest["user"]["id"]
        cid = (await request("POST", "/v1/conversations", {"character_id": "jihan"}))[
            "id"
        ]

        async def turn(case, text, conversation_id=cid):
            started = time.monotonic()
            submitted = await request(
                "POST",
                f"/v1/conversations/{conversation_id}/turns",
                {"client_id": uuid.uuid4().hex, "content": text, "mode": "quick"},
            )
            events = []
            kind = ""
            first = None
            async with client.stream(
                "GET", f"/v1/turns/{submitted['id']}/events"
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("event: "):
                        kind = line[7:]
                    elif line.startswith("data: "):
                        data = json.loads(line[6:])
                        events.append({"event": kind, "data": data})
                        if kind == "delta" and first is None:
                            first = time.monotonic() - started
            state = await request("GET", f"/v1/conversations/{conversation_id}")
            record = {
                "case": case,
                "input": text,
                "events": events,
                "text": "".join(
                    e["data"]["text"] for e in events if e["event"] == "delta"
                ),
                "first_visible_seconds": round(first, 3) if first else None,
                "total_seconds": round(time.monotonic() - started, 3),
                "memories_after": state["memories"],
                "relationship_after": state["relationship"],
                "narrative_after": state["narrative"],
                "complete": any(e["event"] == "done" for e in events),
            }
            evidence["results"].append(record)
            target.write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
            print(case, record["complete"], record["text"], flush=True)
            return state

        state = await turn(
            "store_and_agree",
            "내 이름은 가온이야. 나는 레몬차를 좋아해. 내일 오후 세 시에 서고의 붉은 우편함 앞에서 만나자.",
        )
        await turn(
            "recall_before_edit",
            "내 이름과 좋아하는 음료, 방금 약속한 시간과 장소를 알려 줘.",
        )
        for memory in [
            m
            for m in state["memories"]
            if m["key"] in ("이름", "좋아하는 것", "좋아하는 음료")
        ]:
            await request(
                "PATCH",
                f"/v1/memories/{memory['id']}",
                {"value": "다온" if memory["key"] == "이름" else "복숭아차"},
            )
        await turn(
            "recall_after_edit",
            "바뀐 내 이름과 좋아하는 음료, 방금 정한 내일 약속의 시간과 장소를 알려 줘.",
        )
        await turn(
            "locked_memory_conflict", "내 이름은 가온이야. 나는 레몬차를 좋아해."
        )
        await turn(
            "locked_memory_recall",
            "현재 기억 노트에 적힌 내 이름과 좋아하는 음료를 말해 줘.",
        )
        for memory in [
            m
            for m in state["memories"]
            if m["key"] in ("이름", "좋아하는 것", "좋아하는 음료")
        ]:
            await request("DELETE", f"/v1/memories/{memory['id']}")
        await turn(
            "recall_after_delete",
            "내 이름과 좋아하는 음료를 기억해? 모르면 모른다고 해 줘.",
        )
        other = (
            await request("POST", "/v1/conversations", {"character_id": "kairen"})
        )["id"]
        await turn(
            "cross_character_isolation", "내 이름과 좋아하는 음료가 뭐야?", other
        )
        await turn(
            "unknown_shared_past",
            "지난주 우리 둘이 만나기로 했던 카페 이름이 뭐였지?",
            other,
        )
        evidence["wallet_after"] = await request("GET", "/v1/wallet")
        target.write_text(json.dumps(evidence, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
