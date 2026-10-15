import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class GuestIn(BaseModel):
    native: bool = False


class AccountIn(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=12, max_length=128)
    nickname: str = Field(default="여행자", min_length=1, max_length=30)
    native: bool = False

    @field_validator("email")
    @classmethod
    def email_valid(cls, v):
        v = v.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", v):
            raise ValueError("올바른 이메일을 입력해 주세요.")
        return v


class ConversationIn(BaseModel):
    character_id: str = Field(max_length=36)


class TurnIn(BaseModel):
    client_id: str = Field(min_length=16, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    content: str = Field(min_length=1, max_length=3000)
    mode: Literal["quick", "story"] = "quick"
    story_event: Literal["discovery", "change_scene", "quiet"] | None = None

    @field_validator("content")
    @classmethod
    def nonblank(cls, v):
        if not v.strip():
            raise ValueError("메시지를 입력해 주세요.")
        return v.strip()


class MemoryIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    value: str = Field(min_length=1, max_length=500)


class MemoryEdit(BaseModel):
    value: str = Field(min_length=1, max_length=500)


class SettingsIn(BaseModel):
    memory_enabled: bool
    pace: Literal["slow", "natural"] = "slow"
    length: Literal["short", "balanced", "long"] = "balanced"


class OrderIn(BaseModel):
    sku: Literal["light-500", "light-1200"]


class ConfirmIn(BaseModel):
    order_id: str = Field(max_length=36)
    payment_key: str = Field(min_length=1, max_length=200)
    amount: int = Field(gt=0)


class FeedbackIn(BaseModel):
    message_id: str = Field(max_length=36)
    reason: Literal[
        "좋아요", "기억 오류", "반복되는 답변", "캐릭터 불일치", "부적절한 내용"
    ]


class CharacterIn(BaseModel):
    art_style: Literal["반실사", "애니메이션"] = "애니메이션"
    name: str = Field(min_length=1, max_length=30)
    age: int = Field(ge=20, le=1000)
    gender: Literal["남성", "여성", "기타"]
    genre: Literal["힐링", "일상", "로맨스", "판타지", "미스터리"]
    role: str = Field(min_length=2, max_length=60)
    description: str = Field(min_length=10, max_length=600)
    opening: str = Field(min_length=10, max_length=1200)
    voice: str = Field(min_length=10, max_length=600)
    world: str = Field(min_length=10, max_length=1200)
    face: str = Field(min_length=3, max_length=200)
    hair: str = Field(min_length=3, max_length=200)
    build: str = Field(min_length=3, max_length=200)
    signature: str = Field(min_length=3, max_length=200)


class BranchIn(BaseModel):
    client_id: str = Field(min_length=16, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    message_id: str = Field(min_length=1, max_length=36)
    action: Literal["branch", "regenerate", "edit"]
    content: str | None = Field(default=None, min_length=1, max_length=3000)

    @model_validator(mode="after")
    def action_content(self):
        if self.action == "edit":
            if not self.content or not self.content.strip():
                raise ValueError("수정할 메시지를 입력해 주세요.")
            self.content = self.content.strip()
        elif self.content is not None:
            raise ValueError("메시지 수정에서만 새 내용을 입력할 수 있어요.")
        return self
