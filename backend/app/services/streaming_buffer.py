"""
Streaming Buffer - manages in-memory content during streaming.
This service handles chunk accumulation without any database operations.
"""

from collections import defaultdict
from typing import Dict, List, Optional, Any
import time
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class StreamMetadata:
    """Metadata for a streaming session."""
    chunk_count: int = 0
    total_bytes: int = 0
    is_streaming: bool = True
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    error: Optional[str] = None


class StreamingBuffer:
    """
    Manages in-memory streaming content.
    No database operations - pure memory management.
    """

    def __init__(self, max_buffer_size: int = 10000):
        """
        Initialize the streaming buffer.

        Args:
            max_buffer_size: Maximum number of chunks to keep per message
        """
        self._buffers: Dict[str, List[str]] = defaultdict(list)
        self._metadata: Dict[str, StreamMetadata] = {}
        self.max_buffer_size = max_buffer_size

        logger.info(f"StreamingBuffer initialized with max_buffer_size={max_buffer_size}")

    def start_streaming(self, message_id: str) -> None:
        """
        Initialize buffer for a new streaming message.

        Args:
            message_id: Unique identifier for the message
        """
        self._buffers[message_id] = []
        self._metadata[message_id] = StreamMetadata()

        logger.info(f"Started streaming buffer for message {message_id}")

    def add_chunk(self, message_id: str, chunk: str) -> None:
        """
        Add a chunk to the buffer.

        Args:
            message_id: Message identifier
            chunk: Content chunk to add

        Raises:
            ValueError: If no active stream for the message
        """
        if message_id not in self._buffers:
            raise ValueError(f"No active stream for message {message_id}")

        # Prevent memory overflow
        if len(self._buffers[message_id]) >= self.max_buffer_size:
            # Keep last N chunks for recovery
            logger.warning(f"Buffer overflow for message {message_id}, truncating to last 1000 chunks")
            self._buffers[message_id] = self._buffers[message_id][-1000:]

        self._buffers[message_id].append(chunk)

        # Update metadata
        metadata = self._metadata[message_id]
        metadata.chunk_count += 1
        metadata.total_bytes += len(chunk)

        logger.debug(f"Added chunk #{metadata.chunk_count} ({len(chunk)} bytes) to message {message_id}")

    def get_complete_content(self, message_id: str) -> str:
        """
        Get the complete accumulated content.

        Args:
            message_id: Message identifier

        Returns:
            Complete content as a single string
        """
        if message_id not in self._buffers:
            logger.warning(f"No buffer found for message {message_id}")
            return ""

        content = "".join(self._buffers[message_id])
        logger.debug(f"Retrieved complete content for message {message_id}: {len(content)} characters")
        return content

    def get_chunks_since(self, message_id: str, chunk_index: int) -> List[str]:
        """
        Get chunks since a specific index (for reconnection).

        Args:
            message_id: Message identifier
            chunk_index: Starting chunk index

        Returns:
            List of chunks from the specified index
        """
        if message_id not in self._buffers:
            logger.warning(f"No buffer found for message {message_id}")
            return []

        chunks = self._buffers[message_id][chunk_index:]
        logger.info(f"Retrieved {len(chunks)} chunks for message {message_id} starting from index {chunk_index}")
        return chunks

    def get_metadata(self, message_id: str) -> Optional[StreamMetadata]:
        """
        Get streaming metadata for a message.

        Args:
            message_id: Message identifier

        Returns:
            StreamMetadata object or None if not found
        """
        return self._metadata.get(message_id)

    def end_streaming(self, message_id: str, error: Optional[str] = None) -> dict:
        """
        Mark streaming as complete and return metadata.

        Args:
            message_id: Message identifier
            error: Optional error message if streaming failed

        Returns:
            Dictionary containing streaming metadata
        """
        if message_id not in self._metadata:
            logger.warning(f"No metadata found for message {message_id}")
            return {}

        metadata = self._metadata[message_id]
        metadata.is_streaming = False
        metadata.end_time = time.time()
        metadata.error = error

        duration = metadata.end_time - metadata.start_time

        result = {
            "chunk_count": metadata.chunk_count,
            "total_bytes": metadata.total_bytes,
            "duration": duration,
            "is_streaming": metadata.is_streaming,
            "error": metadata.error
        }

        logger.info(
            f"Ended streaming for message {message_id}: "
            f"{metadata.chunk_count} chunks, {metadata.total_bytes} bytes, "
            f"{duration:.2f} seconds"
        )

        return result

    def cleanup(self, message_id: str) -> None:
        """
        Remove buffer after successful persistence.

        Args:
            message_id: Message identifier
        """
        content_length = len(self.get_complete_content(message_id))

        self._buffers.pop(message_id, None)
        self._metadata.pop(message_id, None)

        logger.info(f"Cleaned up buffer for message {message_id} ({content_length} characters)")

    def get_active_streams(self) -> List[str]:
        """
        Get list of currently active streaming message IDs.

        Returns:
            List of message IDs that are currently streaming
        """
        active = [
            msg_id for msg_id, metadata in self._metadata.items()
            if metadata.is_streaming
        ]
        logger.debug(f"Found {len(active)} active streams")
        return active

    def get_memory_usage(self) -> dict:
        """
        Get current memory usage statistics.

        Returns:
            Dictionary with memory usage information
        """
        total_chunks = sum(len(chunks) for chunks in self._buffers.values())
        total_bytes = sum(
            sum(len(chunk) for chunk in chunks)
            for chunks in self._buffers.values()
        )

        return {
            "buffer_count": len(self._buffers),
            "total_chunks": total_chunks,
            "total_bytes": total_bytes,
            "active_streams": len(self.get_active_streams())
        }

    def has_buffer(self, message_id: str) -> bool:
        """
        Check if a buffer exists for a message.

        Args:
            message_id: Message identifier

        Returns:
            True if buffer exists, False otherwise
        """
        return message_id in self._buffers

    def reset_buffer(self, message_id: str) -> None:
        """
        Reset a buffer (clear content but keep metadata).

        Args:
            message_id: Message identifier
        """
        if message_id in self._buffers:
            self._buffers[message_id] = []
            if message_id in self._metadata:
                self._metadata[message_id].chunk_count = 0
                self._metadata[message_id].total_bytes = 0

            logger.info(f"Reset buffer for message {message_id}")