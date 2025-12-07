"""Global registry for managing agent execution tasks independently of WebSocket connections."""

import asyncio
from typing import Dict, Optional
from dataclasses import dataclass
from datetime import datetime


@dataclass
class AgentTask:
    """Represents a running agent task."""
    task: asyncio.Task
    session_id: str
    message_id: str
    cancel_event: asyncio.Event
    created_at: datetime
    status: str  # 'running', 'completed', 'error', 'cancelled'


class AgentTaskRegistry:
    """
    Global registry to manage agent execution tasks.

    This allows agent tasks to continue running even when WebSocket disconnects,
    and allows WebSocket reconnection to resume streaming from running tasks.
    """

    def __init__(self):
        self._tasks: Dict[str, AgentTask] = {}
        self._lock = asyncio.Lock()

    async def register_task(
        self,
        session_id: str,
        message_id: str,
        task: asyncio.Task,
        cancel_event: asyncio.Event
    ) -> None:
        """Register a new agent task."""
        async with self._lock:
            # Cancel any existing task for this session
            if session_id in self._tasks:
                old_task = self._tasks[session_id]
                if not old_task.task.done():
                    old_task.cancel_event.set()
                    old_task.task.cancel()

            self._tasks[session_id] = AgentTask(
                task=task,
                session_id=session_id,
                message_id=message_id,
                cancel_event=cancel_event,
                created_at=datetime.utcnow(),
                status='running'
            )

    async def get_task(self, session_id: str) -> Optional[AgentTask]:
        """Get the running task for a session."""
        async with self._lock:
            return self._tasks.get(session_id)

    async def cancel_task(self, session_id: str) -> bool:
        """Cancel a running task."""
        async with self._lock:
            if session_id in self._tasks:
                agent_task = self._tasks[session_id]
                if not agent_task.task.done():
                    agent_task.cancel_event.set()
                    agent_task.task.cancel()
                    agent_task.status = 'cancelled'
                    return True
            return False

    async def mark_completed(self, session_id: str, status: str = 'completed') -> None:
        """Mark a task as completed."""
        async with self._lock:
            if session_id in self._tasks:
                self._tasks[session_id].status = status

    async def cleanup_task(self, session_id: str) -> None:
        """Remove a task from registry."""
        async with self._lock:
            if session_id in self._tasks:
                del self._tasks[session_id]

    async def cleanup_old_tasks(self, max_age_seconds: int = 3600) -> int:
        """Clean up tasks older than max_age_seconds. Returns count of cleaned tasks."""
        async with self._lock:
            now = datetime.utcnow()
            to_remove = []

            for session_id, agent_task in self._tasks.items():
                age = (now - agent_task.created_at).total_seconds()
                if age > max_age_seconds and agent_task.task.done():
                    to_remove.append(session_id)

            for session_id in to_remove:
                del self._tasks[session_id]

            return len(to_remove)


# Global singleton instance
_agent_task_registry: Optional[AgentTaskRegistry] = None


def get_agent_task_registry() -> AgentTaskRegistry:
    """Get the global agent task registry singleton."""
    global _agent_task_registry
    if _agent_task_registry is None:
        _agent_task_registry = AgentTaskRegistry()
    return _agent_task_registry
