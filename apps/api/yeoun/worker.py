import asyncio
import logging
import time

from sqlalchemy import delete, or_, select, update

from .billing import adjust_credits
from .db import SessionLocal
from .engine import UnsafeContent, extract_memories, relationship_next, stream_reply
from .episodes import compact_episodes
from .memory_context import invalidate_fact
from .models import (
    Character,
    Conversation,
    Memory,
    Message,
    RateBucket,
    StreamEvent,
    Turn,
)
from .story_state import advance_narrative

log = logging.getLogger("yeoun.worker")


async def emit(turn_id, event, data):
    async with SessionLocal() as db:
        t = (
            await db.execute(select(Turn).where(Turn.id == turn_id).with_for_update())
        ).scalar_one_or_none()
        if not t or t.status != "generating":
            raise RuntimeError("turn_no_longer_active")
        db.add(StreamEvent(turn_id=turn_id, event=event, data=data))
        t.started = time.time()
        if event == "model":
            t.model = data["name"]
        await db.commit()


async def finish(
    turn_id, text="", error=None, stale_only=False, episode_state=None, reply_state=None
):
    async with SessionLocal() as db:
        turn = (
            await db.execute(select(Turn).where(Turn.id == turn_id).with_for_update())
        ).scalar_one_or_none()
        if not turn or turn.status in ("completed", "failed"):
            return
        if stale_only:
            cutoff = time.time()
            if turn.status == "generating" and (turn.started or cutoff) >= cutoff - 180:
                return
            if turn.status == "pending" and turn.created >= cutoff - 600:
                return
        conv = await db.get(Conversation, turn.conversation_id)
        if error:
            turn.status = "failed"
            turn.error = error
            # Lock and unique reference make refunds exactly once, including recovery races.
            await adjust_credits(
                db, turn.user_id, turn.cost, f"refund:{turn.id}", "답변 실패 환급"
            )
            await db.execute(
                update(Message)
                .where(Message.turn_id == turn.id, Message.role == "user")
                .values(status="failed")
            )
            data = {
                "code": error,
                "message": "답변을 완성하지 못했어요. 사용한 빛은 돌려드렸어요.",
                "refunded": turn.cost,
            }
            db.add(StreamEvent(turn_id=turn.id, event="failed", data=data))
        else:
            turn.status = "completed"
            msg = Message(
                conversation_id=conv.id, turn_id=turn.id, role="assistant", content=text
            )
            db.add(msg)
            await db.flush()
            state = reply_state or {}
            character = await db.get(Character, conv.character_id)
            conv.relationship = relationship_next(
                conv.relationship,
                turn.content,
                turn.story_event,
                conv.settings.get("pace", "slow"),
                state.get("relationship"),
                character.payload,
            )
            source = (
                await db.execute(
                    select(Message).where(
                        Message.turn_id == turn.id, Message.role == "user"
                    )
                )
            ).scalar_one()
            if conv.settings.get("memory_enabled", True):
                conv.narrative = advance_narrative(
                    {**conv.narrative, **(episode_state or {})},
                    state,
                    turn.story_event,
                    source.id,
                    msg.id,
                )
            else:
                conv.narrative = {
                    **conv.narrative,
                    "beat": conv.narrative.get("beat", 0) + 1,
                }
            if conv.settings.get("memory_enabled", True):
                facts = (
                    {k: v["value"] for k, v in state.get("facts", {}).items()}
                    if reply_state is not None
                    else dict(extract_memories(turn.content))
                )
                for key, value in facts.items():
                    memory = (
                        await db.execute(
                            select(Memory).where(
                                Memory.conversation_id == conv.id, Memory.key == key
                            )
                        )
                    ).scalar_one_or_none()
                    if memory and (memory.locked or memory.deleted):
                        continue
                    if memory:
                        if memory.value != value:
                            await invalidate_fact(db, conv, memory.value)
                        memory.value = value
                        memory.source_id = source.id
                        memory.updated = time.time()
                    else:
                        db.add(
                            Memory(
                                conversation_id=conv.id,
                                key=key,
                                value=value,
                                source_id=source.id,
                            )
                        )
            await db.flush()
            db.add(
                StreamEvent(
                    turn_id=turn.id,
                    event="done",
                    data={
                        "message_id": msg.id,
                        "relationship": conv.relationship,
                        "narrative": conv.narrative,
                    },
                )
            )
        turn.completed = time.time()
        conv.active_turn = None
        conv.updated = time.time()
        await db.commit()


async def process_turn(turn_id):
    try:
        async with SessionLocal() as db:
            t = await db.get(Turn, turn_id)
            c = await db.get(Conversation, t.conversation_id)
            char = await db.get(Character, c.character_id)
            history = list(
                (
                    await db.scalars(
                        select(Message)
                        .where(
                            Message.conversation_id == c.id,
                            or_(Message.turn_id != t.id, Message.turn_id.is_(None)),
                            Message.created
                            > max(
                                c.settings.get("context_reset_at", 0),
                                c.narrative.get("episode_cutoff", 0),
                            ),
                        )
                        .order_by(Message.created.desc())
                        .limit(100)
                    )
                ).all()
            )
            history.reverse()
            memories = [
                {
                    "key": m.key,
                    "value": m.value,
                    "locked": m.locked,
                    "deleted": m.deleted,
                    "origin": "사용자가 삭제한 기억"
                    if m.deleted
                    else (
                        "사용자가 기억 노트에서 직접 저장한 최신 값. 노트에서 다시 수정 가능"
                        if m.locked
                        else "사용자가 대화에서 직접 말한 사실"
                    ),
                }
                for m in (
                    await db.scalars(
                        select(Memory)
                        .where(Memory.conversation_id == c.id)
                        .order_by(Memory.locked.desc(), Memory.updated.desc())
                        .limit(30)
                    )
                ).all()
            ]
            if not c.settings.get("memory_enabled", True):
                memories = []
        await emit(turn_id, "phase", {"name": "thinking"})
        episode_state = None
        if c.settings.get("memory_enabled", True):
            try:
                async with asyncio.timeout(25):
                    narrative, history = await compact_episodes(c.narrative, history)
                if narrative != c.narrative:
                    episode_state = {
                        k: narrative[k] for k in ("episode_notes", "episode_cutoff")
                    }
                    c.narrative = narrative
            except Exception as exc:
                log.warning("episode_compaction_failed type=%s", type(exc).__name__)
                history = history[-40:]
        else:
            c.narrative = {
                k: v
                for k, v in c.narrative.items()
                if k not in ("episode_notes", "episode_cutoff")
                and k not in ("story_slots", "developments")
            }
            c.relationship = {
                k: v
                for k, v in c.relationship.items()
                if k not in ("changes", "last_change")
            }
            history = history[-40:]
        await emit(
            turn_id,
            "context",
            {
                "memory_count": sum(not m.get("deleted") for m in memories),
                "history_count": len(history),
                "episode_count": len(c.narrative.get("episode_notes", [])),
            },
        )
        parts = []
        reply_state = None
        async with asyncio.timeout(150):
            async for event, data in stream_reply(
                char.payload, c, history, memories, t
            ):
                if event == "state":
                    reply_state = data
                    continue  # Internal proposals are committed with the finished message.
                await emit(turn_id, event, data)
                if event == "delta":
                    parts.append(data["text"])
        await finish(
            turn_id,
            "".join(parts),
            episode_state=episode_state,
            reply_state=reply_state,
        )
    except asyncio.CancelledError:
        raise  # Durable claim is recovered after lease expiry on restart.
    except Exception as exc:
        log.warning("turn_failed id=%s type=%s", turn_id, type(exc).__name__)
        await finish(
            turn_id,
            error="content_policy"
            if isinstance(exc, UnsafeContent)
            else "generation_failed",
        )


async def recover():
    async with SessionLocal() as db:
        stale = list(
            (
                await db.scalars(
                    select(Turn.id).where(
                        (
                            (Turn.status == "generating")
                            & (Turn.started < time.time() - 180)
                        )
                        | (
                            (Turn.status == "pending")
                            & (Turn.created < time.time() - 600)
                        )
                    )
                )
            ).all()
        )
        await db.execute(delete(RateBucket).where(RateBucket.expires < time.time()))
        await db.commit()
    for turn_id in stale:
        await finish(turn_id, error="interrupted", stale_only=True)


async def worker_loop():
    while True:
        try:
            await recover()
            async with SessionLocal() as db:
                row = (
                    await db.execute(
                        select(Turn)
                        .where(Turn.status == "pending")
                        .order_by(Turn.created)
                        .limit(1)
                        .with_for_update(skip_locked=True)
                    )
                ).scalar_one_or_none()
                turn_id = None
                if row:
                    result = await db.execute(
                        update(Turn)
                        .where(Turn.id == row.id, Turn.status == "pending")
                        .values(status="generating", started=time.time())
                        .returning(Turn.id)
                    )
                    turn_id = result.scalar_one_or_none()
                await db.commit()
            if turn_id:
                await process_turn(turn_id)
            else:
                await asyncio.sleep(0.25)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("worker_iteration_failed type=%s", type(exc).__name__)
            await asyncio.sleep(2)


if __name__ == "__main__":

    async def main():
        from .config import settings

        settings().validate_runtime()
        await asyncio.gather(*(worker_loop() for _ in range(4)))

    asyncio.run(main())
