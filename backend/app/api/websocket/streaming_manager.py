"""
Streaming Manager for handling message persistence independently of WebSocket connections.
Ensures messages are properly finalized even when WebSocket disconnects during streaming.
"""

import asyncio
from typing import Dict, Optional, Callable, Any
from datetime import datetime, timedelta

class StreamingManager:
    """Manages streaming tasks independently of WebSocket connections"""

    def __init__(self):
        self.active_streams: Dict[str, Dict[str, Any]] = {}
        self.cleanup_callbacks: Dict[str, Callable] = {}
        self._cleanup_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    async def start(self):
        """Start the background cleanup task"""
        if not self._cleanup_task or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_worker())
            print("[StreamingManager] Background cleanup worker started")

    async def stop(self):
        """Stop the background cleanup task"""
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            print("[StreamingManager] Background cleanup worker stopped")

    async def register_stream(
        self,
        session_id: str,
        message_id: str,
        cleanup_callback: Callable
    ):
        """Register a new streaming session with cleanup callback"""
        async with self._lock:
            self.active_streams[session_id] = {
                'message_id': message_id,
                'started_at': datetime.now(),
                'last_activity': datetime.now(),
                'finalized': False,
                'content_length': 0
            }
            self.cleanup_callbacks[session_id] = cleanup_callback
            print(f"[StreamingManager] Registered stream for session {session_id}, message {message_id}")

    async def update_activity(self, session_id: str, content_length: int = 0):
        """Update last activity timestamp and content length for a stream"""
        async with self._lock:
            if session_id in self.active_streams:
                self.active_streams[session_id]['last_activity'] = datetime.now()
                if content_length > 0:
                    self.active_streams[session_id]['content_length'] = content_length

    async def mark_finalized(self, session_id: str):
        """Mark stream as successfully finalized"""
        async with self._lock:
            if session_id in self.active_streams:
                self.active_streams[session_id]['finalized'] = True
                print(f"[StreamingManager] Stream marked as finalized for session {session_id}")

    async def handle_disconnect(self, session_id: str):
        """Handle WebSocket disconnect - ensure stream is finalized"""
        print(f"[StreamingManager] Handling disconnect for session {session_id}")

        stream_info = None
        async with self._lock:
            stream_info = self.active_streams.get(session_id)

        if not stream_info:
            print(f"[StreamingManager] No active stream found for session {session_id}")
            return

        if stream_info['finalized']:
            print(f"[StreamingManager] Stream already finalized for session {session_id}")
            # Clean up since it's already finalized
            async with self._lock:
                if session_id in self.active_streams:
                    del self.active_streams[session_id]
                if session_id in self.cleanup_callbacks:
                    del self.cleanup_callbacks[session_id]
            return

        # Wait up to 10 seconds for natural completion
        print(f"[StreamingManager] Waiting for natural completion of session {session_id}")
        for i in range(10):
            await asyncio.sleep(1)
            async with self._lock:
                if session_id in self.active_streams and self.active_streams[session_id]['finalized']:
                    print(f"[StreamingManager] Stream naturally completed for session {session_id}")
                    # Clean up
                    del self.active_streams[session_id]
                    if session_id in self.cleanup_callbacks:
                        del self.cleanup_callbacks[session_id]
                    return

        # If still not finalized, run cleanup
        print(f"[StreamingManager] Running forced cleanup for session {session_id}")
        await self._run_cleanup(session_id)

    async def _run_cleanup(self, session_id: str):
        """Execute cleanup callback for a session"""
        callback = None
        async with self._lock:
            callback = self.cleanup_callbacks.get(session_id)

        if callback:
            try:
                print(f"[StreamingManager] Executing cleanup callback for session {session_id}")
                await callback()
                print(f"[StreamingManager] Cleanup completed successfully for session {session_id}")
            except Exception as e:
                print(f"[StreamingManager] Cleanup failed for session {session_id}: {e}")
                import traceback
                traceback.print_exc()
            finally:
                # Remove from tracking
                async with self._lock:
                    if session_id in self.cleanup_callbacks:
                        del self.cleanup_callbacks[session_id]
                    if session_id in self.active_streams:
                        del self.active_streams[session_id]
        else:
            print(f"[StreamingManager] No cleanup callback found for session {session_id}")

    async def _cleanup_worker(self):
        """Background task to cleanup stuck streams"""
        print("[StreamingManager] Cleanup worker started")

        while True:
            try:
                await asyncio.sleep(30)  # Check every 30 seconds

                now = datetime.now()
                stuck_sessions = []

                # Find stuck sessions
                async with self._lock:
                    for session_id, info in self.active_streams.items():
                        # If no activity for 60 seconds and not finalized
                        if not info['finalized']:
                            time_since_activity = now - info['last_activity']
                            if time_since_activity > timedelta(seconds=60):
                                stuck_sessions.append(session_id)
                                print(f"[StreamingManager] Found stuck session: {session_id} " +
                                      f"(inactive for {time_since_activity.total_seconds():.0f} seconds)")

                # Cleanup stuck sessions (outside of lock to avoid deadlock)
                for session_id in stuck_sessions:
                    print(f"[StreamingManager] Cleaning up stuck session: {session_id}")
                    await self._run_cleanup(session_id)

                # Log active streams status
                async with self._lock:
                    if self.active_streams:
                        print(f"[StreamingManager] Active streams: {len(self.active_streams)}")
                        for sid, info in self.active_streams.items():
                            age = (now - info['started_at']).total_seconds()
                            print(f"  - {sid}: age={age:.0f}s, finalized={info['finalized']}, " +
                                  f"content_length={info['content_length']}")

            except asyncio.CancelledError:
                print("[StreamingManager] Cleanup worker cancelled")
                break
            except Exception as e:
                print(f"[StreamingManager] Cleanup worker error: {e}")
                import traceback
                traceback.print_exc()

        print("[StreamingManager] Cleanup worker stopped")

# Global instance
streaming_manager = StreamingManager()