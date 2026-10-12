"""Forget a fact in model context without deleting unrelated conversation."""

from sqlalchemy import select

from .models import Message
from .story_state import context_text


def scrub(value, needle):
    if isinstance(value, str):
        return value.replace(needle, "[수정되거나 지운 기억]") if needle else value
    if isinstance(value, list):
        return [scrub(v, needle) for v in value]
    if isinstance(value, dict):
        return {k: scrub(v, needle) for k, v in value.items()}
    return value


async def invalidate_fact(db, conversation, old_value):
    if not old_value:
        return
    messages = (
        await db.scalars(
            select(Message).where(Message.conversation_id == conversation.id)
        )
    ).all()
    for message in messages:
        current = context_text(message)
        if old_value in current:
            message.context_content = scrub(current, old_value)
    conversation.narrative = scrub(conversation.narrative, old_value)
    conversation.relationship = scrub(conversation.relationship, old_value)
