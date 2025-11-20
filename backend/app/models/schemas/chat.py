"""Chat session schemas for API validation."""

from datetime import datetime
from pydantic import BaseModel, Field

from app.models.database.chat_session import ChatSessionStatus


class ChatSessionBase(BaseModel):
    """Base chat session schema."""
    name: str = Field(..., min_length=1, max_length=255)


class ChatSessionCreate(ChatSessionBase):
    """Schema for creating a chat session."""
    pass


class ChatSessionUpdate(BaseModel):
    """Schema for updating a chat session."""
    name: str | None = Field(None, min_length=1, max_length=255)
    status: ChatSessionStatus | None = None


class ChatSessionResponse(ChatSessionBase):
    """Schema for chat session response."""
    id: str
    project_id: str
    created_at: datetime
    container_id: str | None
    status: ChatSessionStatus
    environment_type: str | None = Field(None, description="Environment type if set up (python3.11, nodejs, etc.)")

    class Config:
        from_attributes = True


class ChatSessionListResponse(BaseModel):
    """Schema for chat session list response."""
    chat_sessions: list[ChatSessionResponse]
    total: int
