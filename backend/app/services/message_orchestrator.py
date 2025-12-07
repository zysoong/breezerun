"""
Message Orchestrator - coordinates between streaming, persistence, and events.
This is the main controller that manages the complete message lifecycle.
"""

from typing import Optional, Dict, List, Any
import logging
import time
from datetime import datetime

from app.services.message_persistence import MessagePersistenceService, PersistenceError
from app.services.streaming_buffer import StreamingBuffer
from app.services.event_bus import EventBus, StreamingEvent

logger = logging.getLogger(__name__)


class MessageOrchestrator:
    """
    Coordinates between streaming, persistence, and WebSocket.
    This is the main controller that ensures proper separation of concerns.
    """

    def __init__(
        self,
        persistence: MessagePersistenceService,
        buffer: StreamingBuffer,
        event_bus: EventBus
    ):
        """
        Initialize the orchestrator with required services.

        Args:
            persistence: Service for database operations
            buffer: Service for in-memory content management
            event_bus: Service for event-driven communication
        """
        self.persistence = persistence
        self.buffer = buffer
        self.event_bus = event_bus
        self._active_streams: Dict[str, str] = {}  # message_id -> session_id

        logger.info("MessageOrchestrator initialized")

    async def start_streaming(
        self,
        session_id: str,
        role: str = "assistant",
        metadata: Optional[dict] = None
    ) -> str:
        """
        Start a new streaming message.

        Args:
            session_id: Chat session identifier
            role: Message role (user/assistant)
            metadata: Optional metadata for the message

        Returns:
            Message ID for the new streaming session
        """
        try:
            # 1. Create message in DB (but don't commit content yet)
            message_id = await self.persistence.create_message(
                session_id, role, "", metadata
            )

            # 2. Initialize streaming buffer
            self.buffer.start_streaming(message_id)

            # 3. Track active stream
            self._active_streams[message_id] = session_id

            # 4. Emit event for WebSocket
            await self.event_bus.emit(StreamingEvent.START, {
                "message_id": message_id,
                "session_id": session_id,
                "role": role,
                "timestamp": datetime.utcnow().isoformat()
            })

            logger.info(f"Started streaming for message {message_id} in session {session_id}")
            return message_id

        except Exception as e:
            logger.error(f"Failed to start streaming: {e}")
            raise

    async def process_chunk(
        self,
        message_id: str,
        chunk: str
    ) -> None:
        """
        Process a streaming chunk.

        Args:
            message_id: Message identifier
            chunk: Content chunk to process
        """
        try:
            # 1. Add to buffer (no DB operation)
            self.buffer.add_chunk(message_id, chunk)

            # 2. Emit event for WebSocket delivery
            await self.event_bus.emit(StreamingEvent.CHUNK, {
                "message_id": message_id,
                "content": chunk,
                "timestamp": datetime.utcnow().isoformat()
            })

            logger.debug(f"Processed chunk for message {message_id}: {len(chunk)} characters")

        except ValueError as e:
            logger.error(f"Failed to process chunk: {e}")
            await self.event_bus.emit(StreamingEvent.ERROR, {
                "message_id": message_id,
                "error": str(e)
            })

    async def process_action(
        self,
        message_id: str,
        tool: str,
        args: Optional[dict] = None,
        status: str = "start",
        step: Optional[int] = None
    ) -> None:
        """
        Process a tool/action event.

        Args:
            message_id: Message identifier
            tool: Tool/function name
            args: Tool arguments
            status: Action status
            step: Step number in the action sequence
        """
        if status == "streaming":
            await self.event_bus.emit(StreamingEvent.ACTION_STREAMING, {
                "message_id": message_id,
                "tool": tool,
                "status": status,
                "step": step,
                "timestamp": datetime.utcnow().isoformat()
            })
        elif status == "complete":
            await self.event_bus.emit(StreamingEvent.ACTION_COMPLETE, {
                "message_id": message_id,
                "tool": tool,
                "args": args,
                "step": step,
                "timestamp": datetime.utcnow().isoformat()
            })

    async def process_observation(
        self,
        message_id: str,
        content: str,
        success: bool = True,
        metadata: Optional[dict] = None,
        step: Optional[int] = None
    ) -> None:
        """
        Process an observation/result from a tool.

        Args:
            message_id: Message identifier
            content: Observation content
            success: Whether the observation indicates success
            metadata: Optional observation metadata
            step: Step number
        """
        await self.event_bus.emit(StreamingEvent.OBSERVATION, {
            "message_id": message_id,
            "content": content,
            "success": success,
            "metadata": metadata,
            "step": step,
            "timestamp": datetime.utcnow().isoformat()
        })

    async def complete_streaming(
        self,
        message_id: str,
        cancelled: bool = False
    ) -> bool:
        """
        Complete streaming and persist to database.

        Args:
            message_id: Message identifier
            cancelled: Whether streaming was cancelled

        Returns:
            True if successfully persisted, False otherwise
        """
        try:
            # 1. Get complete content from buffer
            complete_content = self.buffer.get_complete_content(message_id)

            if not complete_content and not cancelled:
                logger.warning(f"No content found for message {message_id}")

            # 2. Get streaming metadata
            metadata = self.buffer.end_streaming(message_id)
            metadata["cancelled"] = cancelled

            # 3. Emit persistence start event
            await self.event_bus.emit(StreamingEvent.PERSIST_START, {
                "message_id": message_id,
                "content_length": len(complete_content)
            })

            # 4. Persist complete message (single atomic operation)
            success = await self.persistence.save_complete_message(
                message_id,
                complete_content,
                metadata
            )

            if not success:
                raise PersistenceError("Failed to save complete message")

            # 5. Verify persistence (read back from DB)
            saved_message = await self.persistence.get_message(message_id)
            if saved_message and len(saved_message.content) != len(complete_content):
                logger.error(
                    f"Persistence verification failed for message {message_id}: "
                    f"Expected {len(complete_content)}, got {len(saved_message.content)}"
                )
                raise PersistenceError("Content length mismatch after save")

            # 6. Cleanup buffer only after successful persistence
            self.buffer.cleanup(message_id)

            # 7. Remove from active streams
            self._active_streams.pop(message_id, None)

            # 8. Emit success events
            await self.event_bus.emit(StreamingEvent.PERSIST_SUCCESS, {
                "message_id": message_id,
                "content_length": len(complete_content),
                "metadata": metadata
            })

            await self.event_bus.emit(StreamingEvent.END, {
                "message_id": message_id,
                "success": True,
                "content_length": len(complete_content),
                "timestamp": datetime.utcnow().isoformat()
            })

            logger.info(
                f"Successfully completed streaming for message {message_id}: "
                f"{len(complete_content)} characters persisted"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to complete streaming for message {message_id}: {e}")

            # Mark as incomplete in DB
            await self.persistence.mark_message_incomplete(message_id)

            # Emit failure events
            await self.event_bus.emit(StreamingEvent.PERSIST_FAILURE, {
                "message_id": message_id,
                "error": str(e)
            })

            await self.event_bus.emit(StreamingEvent.ERROR, {
                "message_id": message_id,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            })

            return False

    async def resume_streaming(
        self,
        session_id: str
    ) -> Optional[dict]:
        """
        Resume an interrupted stream.

        Args:
            session_id: Session identifier

        Returns:
            Resume information if active stream found
        """
        # Find active stream for session
        for message_id, sid in self._active_streams.items():
            if sid == session_id:
                metadata = self.buffer.get_metadata(message_id)
                if metadata and metadata.is_streaming:
                    resume_info = {
                        "message_id": message_id,
                        "chunk_count": metadata.chunk_count,
                        "total_bytes": metadata.total_bytes,
                        "is_streaming": metadata.is_streaming
                    }

                    # Emit resume event
                    await self.event_bus.emit(StreamingEvent.RESUME, resume_info)

                    logger.info(f"Resuming stream for session {session_id}: {resume_info}")
                    return resume_info

        logger.info(f"No active stream found for session {session_id}")
        return None

    async def cancel_streaming(
        self,
        message_id: str
    ) -> bool:
        """
        Cancel an active streaming session.

        Args:
            message_id: Message identifier

        Returns:
            True if cancelled successfully
        """
        if message_id not in self._active_streams:
            logger.warning(f"No active stream found for message {message_id}")
            return False

        # Complete with cancelled flag
        return await self.complete_streaming(message_id, cancelled=True)

    def get_active_streams(self) -> Dict[str, str]:
        """
        Get all active streaming sessions.

        Returns:
            Dictionary of message_id -> session_id
        """
        return self._active_streams.copy()

    def is_streaming(self, message_id: str) -> bool:
        """
        Check if a message is currently streaming.

        Args:
            message_id: Message identifier

        Returns:
            True if actively streaming
        """
        if message_id not in self._active_streams:
            return False

        metadata = self.buffer.get_metadata(message_id)
        return metadata.is_streaming if metadata else False

    async def get_streaming_status(self, message_id: str) -> Optional[dict]:
        """
        Get detailed streaming status for a message.

        Args:
            message_id: Message identifier

        Returns:
            Status information or None
        """
        if message_id not in self._active_streams:
            return None

        metadata = self.buffer.get_metadata(message_id)
        if not metadata:
            return None

        return {
            "message_id": message_id,
            "session_id": self._active_streams[message_id],
            "is_streaming": metadata.is_streaming,
            "chunk_count": metadata.chunk_count,
            "total_bytes": metadata.total_bytes,
            "duration": (
                time.time() - metadata.start_time
                if metadata.is_streaming
                else metadata.end_time - metadata.start_time
            )
        }

    async def cleanup_incomplete_streams(self, session_id: str) -> int:
        """
        Clean up any incomplete streams for a session.

        Args:
            session_id: Session identifier

        Returns:
            Number of streams cleaned up
        """
        cleaned = 0

        # Find and cancel active streams for this session
        for message_id, sid in list(self._active_streams.items()):
            if sid == session_id:
                await self.cancel_streaming(message_id)
                cleaned += 1

        # Delete incomplete messages from DB
        deleted = await self.persistence.delete_incomplete_messages(session_id)

        logger.info(
            f"Cleaned up {cleaned} active streams and "
            f"{deleted} incomplete messages for session {session_id}"
        )

        return cleaned + deleted