"""
Event Bus - provides decoupled communication between services.
This enables WebSocket handlers to be notified of streaming events
without tight coupling to the business logic.
"""

from enum import Enum
from typing import Dict, List, Callable, Any, Optional
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime

logger = logging.getLogger(__name__)


class StreamingEvent(Enum):
    """Enumeration of all streaming-related events."""
    # Core streaming events
    START = "streaming.start"
    CHUNK = "streaming.chunk"
    END = "streaming.end"
    ERROR = "streaming.error"

    # Connection events
    RESUME = "streaming.resume"
    RECONNECT = "streaming.reconnect"
    DISCONNECT = "streaming.disconnect"

    # Persistence events
    PERSIST_START = "persist.start"
    PERSIST_SUCCESS = "persist.success"
    PERSIST_FAILURE = "persist.failure"

    # Action events (for tools/functions)
    ACTION_START = "action.start"
    ACTION_STREAMING = "action.streaming"
    ACTION_ARGS_CHUNK = "action.args_chunk"
    ACTION_COMPLETE = "action.complete"
    OBSERVATION = "action.observation"


@dataclass
class EventData:
    """Container for event data."""
    event_type: StreamingEvent
    payload: Dict[str, Any]
    timestamp: datetime = None
    source: Optional[str] = None

    def __post_init__(self):
        if self.timestamp is None:
            self.timestamp = datetime.utcnow()


class EventBus:
    """
    Decouples WebSocket communication from business logic.
    Implements a publish-subscribe pattern for event-driven architecture.
    """

    def __init__(self):
        """Initialize the event bus."""
        self._subscribers: Dict[StreamingEvent, List[Callable]] = {}
        self._event_queue: asyncio.Queue = asyncio.Queue()
        self._processing = False
        self._event_history: List[EventData] = []
        self._max_history_size = 1000

        logger.info("EventBus initialized")

    def subscribe(
        self,
        event: StreamingEvent,
        handler: Callable,
        priority: int = 0
    ) -> None:
        """
        Subscribe to an event.

        Args:
            event: The event type to subscribe to
            handler: The callback function to execute
            priority: Handler priority (higher executes first)
        """
        if event not in self._subscribers:
            self._subscribers[event] = []

        # Insert handler based on priority
        self._subscribers[event].append((priority, handler))
        self._subscribers[event].sort(key=lambda x: x[0], reverse=True)

        logger.debug(f"Subscribed handler {handler.__name__} to event {event.value}")

    def unsubscribe(
        self,
        event: StreamingEvent,
        handler: Callable
    ) -> None:
        """
        Unsubscribe from an event.

        Args:
            event: The event type to unsubscribe from
            handler: The callback function to remove
        """
        if event in self._subscribers:
            self._subscribers[event] = [
                (p, h) for p, h in self._subscribers[event]
                if h != handler
            ]
            logger.debug(f"Unsubscribed handler {handler.__name__} from event {event.value}")

    async def emit(
        self,
        event: StreamingEvent,
        data: Any,
        source: Optional[str] = None
    ) -> None:
        """
        Emit an event to all subscribers.

        Args:
            event: The event type to emit
            data: The event data/payload
            source: Optional source identifier
        """
        event_data = EventData(
            event_type=event,
            payload=data if isinstance(data, dict) else {"data": data},
            source=source
        )

        # Add to history
        self._add_to_history(event_data)

        # Add to queue
        await self._event_queue.put(event_data)

        logger.debug(f"Emitted event {event.value} with payload size {len(str(data))}")

        # Start processing if not already running
        if not self._processing:
            asyncio.create_task(self._process_events())

    async def _process_events(self):
        """Process queued events asynchronously."""
        self._processing = True

        try:
            while not self._event_queue.empty():
                event_data = await self._event_queue.get()
                event = event_data.event_type

                if event in self._subscribers:
                    for priority, handler in self._subscribers[event]:
                        try:
                            logger.debug(f"Executing handler {handler.__name__} for event {event.value}")

                            if asyncio.iscoroutinefunction(handler):
                                await handler(event_data.payload)
                            else:
                                handler(event_data.payload)

                        except Exception as e:
                            logger.error(
                                f"Error in event handler {handler.__name__} "
                                f"for event {event.value}: {e}",
                                exc_info=True
                            )

        finally:
            self._processing = False

    def _add_to_history(self, event_data: EventData) -> None:
        """
        Add event to history for debugging/replay.

        Args:
            event_data: The event data to store
        """
        self._event_history.append(event_data)

        # Trim history if it exceeds max size
        if len(self._event_history) > self._max_history_size:
            self._event_history = self._event_history[-self._max_history_size:]

    def get_history(
        self,
        event_type: Optional[StreamingEvent] = None,
        limit: int = 100
    ) -> List[EventData]:
        """
        Get event history for debugging.

        Args:
            event_type: Optional filter by event type
            limit: Maximum number of events to return

        Returns:
            List of historical events
        """
        history = self._event_history

        if event_type:
            history = [e for e in history if e.event_type == event_type]

        return history[-limit:]

    def clear_history(self) -> None:
        """Clear the event history."""
        self._event_history.clear()
        logger.info("Event history cleared")

    def get_subscriber_count(self, event: Optional[StreamingEvent] = None) -> int:
        """
        Get the number of subscribers for an event.

        Args:
            event: Optional specific event, or None for total count

        Returns:
            Number of subscribers
        """
        if event:
            return len(self._subscribers.get(event, []))
        else:
            return sum(len(handlers) for handlers in self._subscribers.values())

    async def wait_for_event(
        self,
        event: StreamingEvent,
        timeout: Optional[float] = None
    ) -> Optional[EventData]:
        """
        Wait for a specific event to occur.

        Args:
            event: The event type to wait for
            timeout: Optional timeout in seconds

        Returns:
            The event data if received, None if timeout
        """
        future = asyncio.Future()

        def handler(data):
            if not future.done():
                future.set_result(EventData(event_type=event, payload=data))

        self.subscribe(event, handler)

        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            logger.warning(f"Timeout waiting for event {event.value}")
            return None
        finally:
            self.unsubscribe(event, handler)

    def reset(self) -> None:
        """Reset the event bus to initial state."""
        self._subscribers.clear()
        self._event_history.clear()
        self._processing = False

        # Clear the queue
        while not self._event_queue.empty():
            try:
                self._event_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        logger.info("EventBus reset to initial state")