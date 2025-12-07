"""
Message Persistence Service - handles all database operations for messages.
This service ensures atomic persistence of complete message content.
"""

from typing import Optional, Dict, Any
from dataclasses import dataclass
from datetime import datetime
import logging
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.database import Message

logger = logging.getLogger(__name__)


class PersistenceError(Exception):
    """Custom exception for persistence failures."""
    pass


@dataclass
class MessageData:
    """Immutable message data structure."""
    session_id: str
    role: str
    content: str
    metadata: dict
    created_at: datetime


class MessagePersistenceService:
    """
    Responsible ONLY for database operations.
    No knowledge of WebSockets or streaming.
    """

    def __init__(self, db_session: AsyncSession):
        self.db = db_session
        self._pending_saves: Dict[str, MessageData] = {}

    async def create_message(
        self,
        session_id: str,
        role: str,
        initial_content: str = "",
        metadata: Optional[dict] = None
    ) -> str:
        """
        Create a new message and return its ID.
        This creates the message record but doesn't commit it yet.
        """
        try:
            message = Message(
                id=str(uuid4()),
                chat_session_id=session_id,
                role=role,
                content=initial_content,
                created_at=datetime.utcnow(),
                message_metadata=metadata or {},
                is_complete=False  # Mark as incomplete initially
            )

            self.db.add(message)
            await self.db.flush()  # Get ID without committing

            logger.info(f"Created message {message.id} for session {session_id}")
            return message.id

        except IntegrityError as e:
            logger.error(f"Failed to create message: {e}")
            raise PersistenceError(f"Failed to create message: {e}")

    async def save_complete_message(
        self,
        message_id: str,
        final_content: str,
        metadata: Optional[dict] = None
    ) -> bool:
        """
        Atomically save the complete message content.
        Returns True if successful, False otherwise.
        """
        try:
            # Get the message from database
            result = await self.db.execute(
                select(Message).where(Message.id == message_id)
            )
            message = result.scalar_one_or_none()

            if not message:
                raise ValueError(f"Message {message_id} not found")

            # Log before saving
            logger.info(f"Saving complete content for message {message_id}: {len(final_content)} characters")

            # Save complete content
            message.content = final_content
            if metadata:
                message.message_metadata.update(metadata)
            message.is_complete = True  # Mark as complete
            message.updated_at = datetime.utcnow()

            # Atomic commit
            await self.db.commit()

            # Verify persistence by refreshing from DB
            await self.db.refresh(message)

            # Verification check
            if len(message.content) != len(final_content):
                raise PersistenceError(
                    f"Content mismatch after save: expected {len(final_content)}, "
                    f"got {len(message.content)}"
                )

            logger.info(f"Successfully persisted message {message_id} with {len(message.content)} characters")
            return True

        except Exception as e:
            logger.error(f"Failed to persist message {message_id}: {e}")
            await self.db.rollback()
            raise PersistenceError(f"Failed to persist message: {e}")

    async def update_message_content(
        self,
        message_id: str,
        content: str,
        is_partial: bool = True
    ) -> bool:
        """
        Update message content (used during streaming for partial updates).
        """
        try:
            result = await self.db.execute(
                select(Message).where(Message.id == message_id)
            )
            message = result.scalar_one_or_none()

            if not message:
                logger.error(f"Message {message_id} not found for update")
                return False

            message.content = content
            message.is_complete = not is_partial
            message.updated_at = datetime.utcnow()

            # Don't commit here - let the caller decide when to commit
            await self.db.flush()

            logger.debug(f"Updated message {message_id} with {len(content)} characters (partial={is_partial})")
            return True

        except Exception as e:
            logger.error(f"Failed to update message {message_id}: {e}")
            return False

    async def mark_message_incomplete(self, message_id: str):
        """Mark a message as incomplete (for error cases)."""
        try:
            result = await self.db.execute(
                select(Message).where(Message.id == message_id)
            )
            message = result.scalar_one_or_none()

            if message:
                message.is_complete = False
                if not message.message_metadata:
                    message.message_metadata = {}
                message.message_metadata["error"] = "Streaming interrupted"
                message.updated_at = datetime.utcnow()

                await self.db.commit()
                logger.warning(f"Marked message {message_id} as incomplete")

        except Exception as e:
            logger.error(f"Failed to mark message {message_id} as incomplete: {e}")
            await self.db.rollback()

    async def get_message(self, message_id: str) -> Optional[Message]:
        """Retrieve a message by ID."""
        try:
            result = await self.db.execute(
                select(Message).where(Message.id == message_id)
            )
            return result.scalar_one_or_none()
        except Exception as e:
            logger.error(f"Failed to get message {message_id}: {e}")
            return None

    async def get_session_messages(
        self,
        session_id: str,
        limit: Optional[int] = None
    ) -> list[Message]:
        """Get all messages for a session."""
        try:
            query = select(Message).where(
                Message.chat_session_id == session_id
            ).order_by(Message.created_at)

            if limit:
                query = query.limit(limit)

            result = await self.db.execute(query)
            return result.scalars().all()

        except Exception as e:
            logger.error(f"Failed to get messages for session {session_id}: {e}")
            return []

    async def delete_incomplete_messages(self, session_id: str) -> int:
        """
        Delete incomplete messages for a session (cleanup operation).
        Returns the number of messages deleted.
        """
        try:
            result = await self.db.execute(
                select(Message).where(
                    Message.chat_session_id == session_id,
                    Message.is_complete == False
                )
            )
            incomplete_messages = result.scalars().all()

            count = len(incomplete_messages)
            for msg in incomplete_messages:
                await self.db.delete(msg)

            await self.db.commit()

            if count > 0:
                logger.info(f"Deleted {count} incomplete messages from session {session_id}")

            return count

        except Exception as e:
            logger.error(f"Failed to delete incomplete messages: {e}")
            await self.db.rollback()
            return 0