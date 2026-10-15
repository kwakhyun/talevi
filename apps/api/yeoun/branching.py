"""Exact, non-destructive historical branches. No model calls happen here.

New checkpoints retain an immutable insertion boundary and sparse model-context
masks, never a growing transcript ID array or another copy of transcript text. Restoring a historical point intentionally restores
its facts too, including facts changed or forgotten later in the original branch.
Legacy history without a checkpoint is never reconstructed from current state.
"""

from copy import deepcopy

from fastapi import HTTPException
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import load_only

from .models import (
    BranchRequest,
    Conversation,
    ConversationCheckpoint,
    Ledger,
    Memory,
    Message,
    Turn,
    User,
    uid,
)


async def capture_state(db, conversation):
    await db.flush()
    boundary, count = (
        await db.execute(
            select(
                func.coalesce(func.max(Message.ordinal), 0), func.count(Message.id)
            ).where(Message.conversation_id == conversation.id)
        )
    ).one()
    messages = list(
        (
            await db.scalars(
                select(Message).where(
                    Message.conversation_id == conversation.id,
                    Message.ordinal <= boundary,
                    or_(
                        Message.context_content.is_not(None),
                        Message.memory_redacted.is_(True),
                        Message.status != "complete",
                    ),
                )
            )
        ).all()
    )
    memories = list(
        (
            await db.scalars(
                select(Memory)
                .where(Memory.conversation_id == conversation.id)
                .order_by(Memory.key)
            )
        ).all()
    )
    return deepcopy(
        {
            "version": 2,
            "message_boundary": boundary,
            "message_count": count,
            "settings": conversation.settings,
            "relationship": conversation.relationship,
            "narrative": conversation.narrative,
            "memories": [
                {
                    key: getattr(memory, key)
                    for key in (
                        "key",
                        "value",
                        "source_id",
                        "locked",
                        "deleted",
                        "updated",
                    )
                }
                for memory in memories
            ],
            "message_context": {
                message.id: {
                    "context_content": message.context_content,
                    "memory_redacted": message.memory_redacted,
                    "status": message.status,
                }
                for message in messages
                if message.context_content is not None
                or message.memory_redacted
                or message.status != "complete"
            },
        }
    )


async def save_checkpoint(
    db, conversation, message, phase, *, snapshot=None, replay=None
):
    checkpoint = ConversationCheckpoint(
        conversation_id=conversation.id,
        message_id=message.id,
        phase=phase,
        snapshot=snapshot
        if snapshot is not None
        else await capture_state(db, conversation),
        replay=deepcopy(replay),
    )
    db.add(checkpoint)
    return checkpoint


async def queue_turn(db, user, conversation, body, fingerprint):
    """Caller holds conversation and user locks; charging/checkpoint/enqueue commit together."""
    cost = 3 if body.mode == "story" else 1
    changed = await db.execute(
        update(User)
        .where(User.id == user.id, User.credits >= cost, User.credit_debt == 0)
        .values(credits=User.credits - cost)
        .returning(User.id)
    )
    if not changed.scalar_one_or_none():
        raise HTTPException(402, "빛이 부족해요. 충전 후 이 대화를 이어갈 수 있어요.")
    snapshot = await capture_state(db, conversation)
    turn = Turn(
        conversation_id=conversation.id,
        user_id=user.id,
        client_id=body.client_id,
        fingerprint=fingerprint,
        content=body.content,
        mode=body.mode,
        story_event=body.story_event,
        cost=cost,
    )
    db.add(turn)
    await db.flush()
    message = Message(
        conversation_id=conversation.id,
        turn_id=turn.id,
        role="user",
        content=body.content,
    )
    db.add(message)
    await db.flush()
    replay = {
        "content": body.content,
        "mode": body.mode,
        "story_event": body.story_event,
        "cost": cost,
        "user_message_id": message.id,
    }
    await save_checkpoint(
        db, conversation, message, "before", snapshot=snapshot, replay=replay
    )
    conversation.active_turn = turn.id
    db.add(
        Ledger(
            user_id=user.id,
            reference="turn:" + turn.id,
            delta=-cost,
            reason="이야기 대화" if cost == 3 else "짧은 대화",
        )
    )
    return turn


async def checkpoints_for(db, cid, *, with_state=True):
    query = select(ConversationCheckpoint).where(
        ConversationCheckpoint.conversation_id == cid
    )
    if not with_state:
        query = query.options(
            load_only(
                ConversationCheckpoint.message_id,
                ConversationCheckpoint.phase,
                ConversationCheckpoint.replay,
            )
        )
    return list((await db.scalars(query)).all())


def action_metadata(message, checkpoints, active=False):
    by_anchor = (
        checkpoints
        if isinstance(checkpoints, dict)
        else {
            (checkpoint.message_id, checkpoint.phase): checkpoint
            for checkpoint in checkpoints
        }
    )
    before = by_anchor.get((message.id, "before"))
    after = by_anchor.get((message.id, "after"))
    replay = (after.replay if after else None) or (before.replay if before else None)
    regenerable = bool(
        after and replay and (replay.get("user_message_id"), "before") in by_anchor
    )
    actions = {
        "branch": bool(message.role == "assistant" and after and not active),
        "regenerate": bool(message.role == "assistant" and regenerable and not active),
        "edit": bool(message.role == "user" and before and replay and not active),
    }
    return {"actions": actions, "action_cost": replay.get("cost", 0) if replay else 0}


def remap_refs(value, mapping):
    if isinstance(value, list):
        return [remap_refs(item, mapping) for item in value]
    if isinstance(value, dict):
        return {
            key: mapping.get(item)
            if key in ("source_id", "user_message_id") and isinstance(item, str)
            else remap_refs(item, mapping)
            for key, item in value.items()
        }
    return value


def remap_snapshot(snapshot, mapping, ordinal_mapping=None):
    state = remap_refs(deepcopy(snapshot), mapping)
    if snapshot.get("version") == 1:
        state["message_ids"] = [
            mapping[message_id] for message_id in snapshot["message_ids"]
        ]
    elif snapshot.get("version") == 2:
        boundary = snapshot["message_boundary"]
        if boundary and (ordinal_mapping is None or boundary not in ordinal_mapping):
            raise HTTPException(409, "이전 장면의 복원 경계가 일치하지 않아요.")
        state["message_boundary"] = ordinal_mapping[boundary] if boundary else 0
    else:
        raise HTTPException(409, "이 시점의 상태를 복원할 수 없어요.")
    if not set(snapshot.get("message_context", {})).issubset(mapping):
        raise HTTPException(409, "이전 장면의 문맥 정보가 일치하지 않아요.")
    state["message_context"] = {
        mapping[message_id]: deepcopy(mask)
        for message_id, mask in snapshot.get("message_context", {}).items()
    }
    return state


async def clone_checkpoint(db, user, source, anchor, checkpoint, action, checkpoints):
    state = checkpoint.snapshot
    query = select(Message).where(Message.conversation_id == source.id)
    if state.get("version") == 1:
        query = query.where(Message.id.in_(state["message_ids"]))
        expected_count = len(state["message_ids"])
    elif state.get("version") == 2:
        query = query.where(Message.ordinal <= state["message_boundary"])
        expected_count = state["message_count"]
    else:
        raise HTTPException(409, "이 시점의 상태를 복원할 수 없어요.")
    source_messages = list((await db.scalars(query.order_by(Message.ordinal))).all())
    if len(source_messages) != expected_count:
        raise HTTPException(409, "이 시점의 대화 기록을 온전히 복원할 수 없어요.")
    # Timestamp ties retain their display order, while inserts retain original ordinal order.
    ordered_ids = [
        message.id
        for message in sorted(source_messages, key=lambda m: (m.created, m.id))
    ]
    mapping = dict(zip(ordered_ids, sorted(uid() for _ in ordered_ids), strict=True))
    restored = remap_refs(deepcopy(state), mapping)
    conversation = Conversation(
        user_id=user.id,
        character_id=source.character_id,
        settings=restored["settings"],
        relationship=restored["relationship"],
        narrative=restored["narrative"],
        branch={"parent_id": source.id, "message_id": anchor.id, "action": action},
    )
    db.add(conversation)
    await db.flush()
    clones = []
    for original in source_messages:
        mask = state.get("message_context", {}).get(original.id, {})
        clone = Message(
            id=mapping[original.id],
            conversation_id=conversation.id,
            role=original.role,
            content=original.content,
            created=original.created,
            turn_id=None,
            context_content=mask.get("context_content"),
            memory_redacted=mask.get("memory_redacted", False),
            status=mask.get("status", "complete"),
        )
        db.add(clone)
        clones.append(clone)
    await db.flush()
    if [clone.ordinal for clone in clones] != sorted(clone.ordinal for clone in clones):
        raise HTTPException(409, "이전 장면의 저장 순서를 복원하지 못했어요.")
    ordinal_mapping = {
        original.ordinal: clone.ordinal
        for original, clone in zip(source_messages, clones, strict=True)
    }
    for memory in restored["memories"]:
        db.add(Memory(conversation_id=conversation.id, **memory))
    for historical in checkpoints:
        if historical.message_id not in mapping:
            continue
        historical_state = historical.snapshot
        if historical_state.get("version") == 1 and not all(
            message_id in mapping for message_id in historical_state["message_ids"]
        ):
            raise HTTPException(409, "이전 장면의 복원 정보가 일치하지 않아요.")
        db.add(
            ConversationCheckpoint(
                conversation_id=conversation.id,
                message_id=mapping[historical.message_id],
                phase=historical.phase,
                snapshot=remap_snapshot(historical_state, mapping, ordinal_mapping),
                replay=remap_refs(deepcopy(historical.replay), mapping),
            )
        )
    await db.flush()
    return conversation


async def branch_result(db, request):
    turn = await db.get(Turn, request.turn_id) if request.turn_id else None
    return {
        "conversation_id": request.conversation_id,
        "turn_id": request.turn_id,
        "status": turn.status if turn else "completed",
        "cost": request.cost,
    }


async def existing_branch(db, user, body, fingerprint):
    existing = (
        await db.scalars(
            select(BranchRequest).where(
                BranchRequest.user_id == user.id,
                BranchRequest.client_id == body.client_id,
            )
        )
    ).one_or_none()
    if existing and existing.fingerprint != fingerprint:
        raise HTTPException(409, "같은 요청 번호로 다른 작업을 할 수 없어요.")
    return existing
