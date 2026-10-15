import time
import uuid

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid():
    return str(uuid.uuid4())


def now():
    return time.time()


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    nickname: Mapped[str] = mapped_column(String(40), default="여행자")
    email: Mapped[str | None] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str | None] = mapped_column(Text)
    credits: Mapped[int] = mapped_column(Integer, default=30)
    credit_debt: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locale: Mapped[str] = mapped_column(String(12), default="ko-KR")
    created: Mapped[float] = mapped_column(Float, default=now)
    __table_args__ = (
        CheckConstraint("credits >= 0"),
        CheckConstraint("credit_debt >= 0", name="ck_users_credit_debt_nonnegative"),
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    expires: Mapped[float] = mapped_column(Float, index=True)


class Character(Base):
    __tablename__ = "characters"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    locale: Mapped[str] = mapped_column(String(12), default="ko-KR")
    payload: Mapped[dict] = mapped_column(JSON)
    published: Mapped[bool] = mapped_column(Boolean, default=False)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    character_id: Mapped[str] = mapped_column(
        ForeignKey("characters.id", ondelete="CASCADE")
    )
    settings: Mapped[dict] = mapped_column(
        JSON,
        default=lambda: {"memory_enabled": True, "pace": "slow", "length": "balanced"},
    )
    relationship: Mapped[dict] = mapped_column(
        JSON, default=lambda: {"trust": 0, "shared": 0, "stage": "첫 만남"}
    )
    narrative: Mapped[dict] = mapped_column(
        JSON, default=lambda: {"chapter": 1, "beat": 0, "last_event": None}
    )
    branch: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    active_turn: Mapped[str | None] = mapped_column(String(36))
    updated: Mapped[float] = mapped_column(Float, default=now, index=True)


class Turn(Base):
    __tablename__ = "turns"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    client_id: Mapped[str] = mapped_column(String(64))
    fingerprint: Mapped[str] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(String(12))
    story_event: Mapped[str | None] = mapped_column(String(20))
    cost: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    model: Mapped[str | None] = mapped_column(String(80))
    error: Mapped[str | None] = mapped_column(String(80))
    created: Mapped[float] = mapped_column(Float, default=now)
    started: Mapped[float | None] = mapped_column(Float)
    completed: Mapped[float | None] = mapped_column(Float)
    __table_args__ = (UniqueConstraint("user_id", "client_id"),)


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    # Immutable insertion boundary; timestamps may be preserved or backdated in clones.
    ordinal: Mapped[int] = mapped_column(
        BigInteger, Identity(), unique=True, index=True
    )
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    turn_id: Mapped[str | None] = mapped_column(
        ForeignKey("turns.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(12))
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="complete")
    # Model-only copy after selective forgetting; original transcript stays readable.
    context_content: Mapped[str | None] = mapped_column(Text)
    memory_redacted: Mapped[bool] = mapped_column(Boolean, default=False)
    created: Mapped[float] = mapped_column(Float, default=now, index=True)


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(40))
    value: Mapped[str] = mapped_column(String(500))
    source_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL")
    )
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    updated: Mapped[float] = mapped_column(Float, default=now)
    __table_args__ = (UniqueConstraint("conversation_id", "key"),)


class StreamEvent(Base):
    __tablename__ = "stream_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    turn_id: Mapped[str] = mapped_column(
        ForeignKey("turns.id", ondelete="CASCADE"), index=True
    )
    event: Mapped[str] = mapped_column(String(20))
    data: Mapped[dict] = mapped_column(JSON)


class Ledger(Base):
    __tablename__ = "ledger"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    reference: Mapped[str] = mapped_column(String(100), unique=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(40))
    created: Mapped[float] = mapped_column(Float, default=now)


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    sku: Mapped[str] = mapped_column(String(30))
    amount: Mapped[int] = mapped_column(Integer)
    credits: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    payment_key: Mapped[str | None] = mapped_column(String(200), unique=True)
    created: Mapped[float] = mapped_column(Float, default=now)


class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE")
    )
    reason: Mapped[str] = mapped_column(String(40))
    created: Mapped[float] = mapped_column(Float, default=now)


class RateBucket(Base):
    __tablename__ = "rate_buckets"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=1)
    expires: Mapped[float] = mapped_column(Float, index=True)


class StorePurchase(Base):
    __tablename__ = "store_purchases"
    reference: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    last_event_ms: Mapped[float] = mapped_column(Float, default=0, server_default="0")
    product_id: Mapped[str] = mapped_column(String(100))
    credits: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))
    updated: Mapped[float] = mapped_column(Float, default=now)


class ConversationCheckpoint(Base):
    __tablename__ = "conversation_checkpoints"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    phase: Mapped[str] = mapped_column(String(8))
    snapshot: Mapped[dict] = mapped_column(JSON)
    replay: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    __table_args__ = (UniqueConstraint("message_id", "phase"),)


class BranchRequest(Base):
    __tablename__ = "branch_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    client_id: Mapped[str] = mapped_column(String(64))
    fingerprint: Mapped[str] = mapped_column(String(64))
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE")
    )
    turn_id: Mapped[str | None] = mapped_column(
        ForeignKey("turns.id", ondelete="CASCADE"), nullable=True
    )
    cost: Mapped[int] = mapped_column(Integer)
    __table_args__ = (UniqueConstraint("user_id", "client_id"),)
