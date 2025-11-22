"""WebSocket handler for chat streaming with agent support."""

import json
import asyncio
from typing import Dict, Any
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.database import ChatSession, Message, MessageRole, AgentConfiguration, AgentAction
from app.core.llm import create_llm_provider_with_db
from app.core.agent.executor import ReActAgent
from app.core.agent.tools import ToolRegistry, BashTool, FileReadTool, FileWriteTool, FileEditTool, SearchTool, SetupEnvironmentTool
from app.core.sandbox.manager import get_container_manager


class ChatWebSocketHandler:
    """Handle WebSocket connections for chat streaming."""

    def __init__(self, websocket: WebSocket, db: AsyncSession):
        self.websocket = websocket
        self.db = db
        self.current_agent_task = None
        self.cancel_event = None

    async def handle_connection(self, session_id: str):
        """Handle WebSocket connection for a chat session."""
        await self.websocket.accept()

        try:
            # Verify session exists and get project config
            session_query = select(ChatSession).where(ChatSession.id == session_id)
            session_result = await self.db.execute(session_query)
            session = session_result.scalar_one_or_none()

            if not session:
                await self.websocket.send_json({
                    "type": "error",
                    "content": f"Chat session {session_id} not found"
                })
                await self.websocket.close()
                return

            # Get agent configuration
            config_query = select(AgentConfiguration).where(
                AgentConfiguration.project_id == session.project_id
            )
            config_result = await self.db.execute(config_query)
            agent_config = config_result.scalar_one_or_none()

            if not agent_config:
                await self.websocket.send_json({
                    "type": "error",
                    "content": "Agent configuration not found"
                })
                await self.websocket.close()
                return

            # Main message loop
            while True:
                # Receive message from client
                data = await self.websocket.receive_text()
                message_data = json.loads(data)

                if message_data.get("type") == "message":
                    await self._handle_user_message(
                        session_id,
                        message_data.get("content", ""),
                        agent_config
                    )
                elif message_data.get("type") == "cancel":
                    # User wants to cancel the current agent execution
                    print(f"[CHAT HANDLER] Cancel request received")
                    if self.cancel_event:
                        self.cancel_event.set()
                        print(f"[CHAT HANDLER] Cancel event set")
                    if self.current_agent_task:
                        self.current_agent_task.cancel()
                        print(f"[CHAT HANDLER] Agent task cancelled")
                    await self.websocket.send_json({
                        "type": "cancel_acknowledged"
                    })

        except WebSocketDisconnect:
            print(f"WebSocket disconnected for session {session_id}")
        except Exception as e:
            print(f"WebSocket error: {str(e)}")
            await self.websocket.send_json({
                "type": "error",
                "content": f"Error: {str(e)}"
            })
        finally:
            try:
                await self.websocket.close()
            except:
                pass

    async def _handle_user_message(
        self,
        session_id: str,
        content: str,
        agent_config: AgentConfiguration
    ):
        """Handle incoming user message and stream agent response."""
        print(f"\n{'='*80}")
        print(f"[CHAT HANDLER] Handling user message")
        print(f"  Session ID: {session_id}")
        print(f"  User Message: {content[:100]}...")
        print(f"  LLM Provider: {agent_config.llm_provider}")
        print(f"  LLM Model: {agent_config.llm_model}")
        print(f"  Enabled Tools: {agent_config.enabled_tools}")
        print(f"{'='*80}\n")

        # Save user message
        user_message = Message(
            chat_session_id=session_id,
            role=MessageRole.USER,
            content=content,
            message_metadata={},
        )
        self.db.add(user_message)
        await self.db.commit()

        # Send confirmation
        await self.websocket.send_json({
            "type": "user_message_saved",
            "message_id": user_message.id
        })

        # Get conversation history
        history = await self._get_conversation_history(session_id)
        print(f"[CHAT HANDLER] Conversation history length: {len(history)}")

        # Create LLM provider (with database API key lookup)
        try:
            print(f"[CHAT HANDLER] Creating LLM provider...")
            llm_provider = await create_llm_provider_with_db(
                provider=agent_config.llm_provider,
                model=agent_config.llm_model,
                llm_config=agent_config.llm_config,
                db=self.db,
            )
            print(f"[CHAT HANDLER] LLM provider created successfully")

            # Check if agent mode is enabled (has tools)
            use_agent = agent_config.enabled_tools and len(agent_config.enabled_tools) > 0
            print(f"[CHAT HANDLER] Use agent mode: {use_agent}")

            if use_agent:
                # Agent mode - use ReAct agent with tools
                print(f"[CHAT HANDLER] Starting agent response...")
                await self._handle_agent_response(
                    session_id,
                    content,
                    history,
                    llm_provider,
                    agent_config
                )
            else:
                # Simple chat mode - direct LLM response
                print(f"[CHAT HANDLER] Starting simple response...")
                await self._handle_simple_response(
                    session_id,
                    history,
                    llm_provider,
                    agent_config
                )

        except Exception as e:
            print(f"[CHAT HANDLER] ERROR: {str(e)}")
            import traceback
            traceback.print_exc()
            await self.websocket.send_json({
                "type": "error",
                "content": f"Error: {str(e)}"
            })

    async def _handle_simple_response(
        self,
        session_id: str,
        history: list[Dict[str, str]],
        llm_provider,
        agent_config: AgentConfiguration
    ):
        """Handle simple LLM response without agent."""
        # Add system instructions if present
        messages = []
        if agent_config.system_instructions:
            messages.append({
                "role": "system",
                "content": agent_config.system_instructions
            })

        # Add conversation history
        messages.extend(history)

        # Create cancel event
        self.cancel_event = asyncio.Event()

        # Stream response
        assistant_content = ""
        await self.websocket.send_json({"type": "start"})

        try:
            async for chunk in llm_provider.generate_stream(messages):
                # Check for cancellation
                if self.cancel_event.is_set():
                    print(f"[SIMPLE RESPONSE] Cancellation detected")
                    await self.websocket.send_json({
                        "type": "cancelled",
                        "content": "Response cancelled by user"
                    })
                    return

                if isinstance(chunk, str):
                    assistant_content += chunk
                    await self.websocket.send_json({
                        "type": "chunk",
                        "content": chunk
                    })
        except asyncio.CancelledError:
            print(f"[SIMPLE RESPONSE] Task cancelled")
            await self.websocket.send_json({
                "type": "cancelled",
                "content": "Response cancelled by user"
            })
            return
        finally:
            self.cancel_event = None

        # Save assistant message
        assistant_message = Message(
            chat_session_id=session_id,
            role=MessageRole.ASSISTANT,
            content=assistant_content,
            message_metadata={},
        )
        self.db.add(assistant_message)
        await self.db.commit()

        # Send completion
        await self.websocket.send_json({
            "type": "end",
            "message_id": assistant_message.id
        })

    async def _handle_agent_response(
        self,
        session_id: str,
        user_message: str,
        history: list[Dict[str, str]],
        llm_provider,
        agent_config: AgentConfiguration
    ):
        """Handle agent response with tool execution."""
        try:
            await self._handle_agent_response_impl(
                session_id, user_message, history, llm_provider, agent_config
            )
        except Exception as e:
            # Catch any exception and send error to frontend
            error_msg = str(e)
            print(f"[AGENT HANDLER] EXCEPTION: {error_msg}")
            import traceback
            traceback.print_exc()

            await self.websocket.send_json({
                "type": "error",
                "content": f"Error: {error_msg}"
            })
            await self.websocket.send_json({
                "type": "end",
                "error": True
            })

    async def _handle_agent_response_impl(
        self,
        session_id: str,
        user_message: str,
        history: list[Dict[str, str]],
        llm_provider,
        agent_config: AgentConfiguration
    ):
        """Implementation of agent response handling."""
        # Get container manager
        container_manager = get_container_manager()

        # Check if environment is already set up for this session
        session_query = select(ChatSession).where(ChatSession.id == session_id)
        session_result = await self.db.execute(session_query)
        session = session_result.scalar_one_or_none()

        # Initialize tool registry
        tool_registry = ToolRegistry()

        # Register tools based on environment setup status
        if session and session.environment_type:
            # Environment is set up - get container and register all sandbox tools
            container = await container_manager.get_container(session_id)
            if not container:
                # Container not running, recreate it
                container = await container_manager.create_container(
                    session_id,
                    session.environment_type,
                    session.environment_config or {}
                )

            # Register enabled sandbox tools
            if "bash" in agent_config.enabled_tools:
                tool_registry.register(BashTool(container))
            if "file_read" in agent_config.enabled_tools:
                tool_registry.register(FileReadTool(container))
            if "file_write" in agent_config.enabled_tools:
                tool_registry.register(FileWriteTool(container))
            if "file_edit" in agent_config.enabled_tools:
                tool_registry.register(FileEditTool(container))
            if "search" in agent_config.enabled_tools:
                tool_registry.register(SearchTool(container))
        else:
            # Environment not set up - only register setup_environment tool
            tool_registry.register(SetupEnvironmentTool(self.db, session_id, container_manager))

        # Create ReAct agent
        agent = ReActAgent(
            llm_provider=llm_provider,
            tool_registry=tool_registry,
            system_instructions=agent_config.system_instructions,
        )

        # Create cancel event
        self.cancel_event = asyncio.Event()

        # Stream agent execution
        assistant_content = ""
        agent_actions = []
        has_error = False
        error_message = None
        cancelled = False

        await self.websocket.send_json({"type": "start"})
        print(f"[AGENT] Starting agent execution loop...")

        event_count = 0
        try:
            async for event in agent.run(user_message, history, cancel_event=self.cancel_event):
                event_count += 1
                event_type = event.get("type")
                print(f"[AGENT] Event #{event_count}: {event_type}")
                print(f"  Full event: {event}")

                if event_type == "cancelled":
                    # Agent was cancelled
                    cancelled = True
                    print(f"[AGENT] Agent cancelled: {event.get('content')}")
                    await self.websocket.send_json({
                        "type": "cancelled",
                        "content": event.get("content", "Response cancelled by user"),
                        "partial_content": event.get("partial_content")
                    })
                    break

                elif event_type == "thought":
                    # Agent is thinking
                    chunk = event.get("content", "")
                    assistant_content += chunk
                    print(f"[AGENT] Thought: {chunk[:100]}...")
                    await self.websocket.send_json({
                        "type": "thought",
                        "content": chunk,
                        "step": event.get("step", 0)
                    })

                elif event_type == "action":
                    # Agent is using a tool
                    tool_name = event.get("tool")
                    tool_args = event.get("args", {})
                    print(f"[AGENT] Action: {tool_name}")
                    print(f"  Args: {tool_args}")
                    await self.websocket.send_json({
                        "type": "action",
                        "tool": tool_name,
                        "args": tool_args,
                        "step": event.get("step", 0)
                    })

                    # Save agent action to database (will set message_id after creating assistant message)
                    action = {
                        "action_type": tool_name,
                        "action_input": tool_args,
                        "action_output": None,
                        "status": "pending"
                    }
                    agent_actions.append(action)

                elif event_type == "observation":
                    # Tool execution result
                    observation = event.get("content", "")
                    success = event.get("success", True)
                    print(f"[AGENT] Observation (success={success}): {observation[:100]}...")
                    await self.websocket.send_json({
                        "type": "observation",
                        "content": observation,
                        "success": success,
                        "step": event.get("step", 0)
                    })

                    # Update last action with result
                    if agent_actions:
                        agent_actions[-1]["action_output"] = {
                            "result": observation,
                            "success": success
                        }
                        agent_actions[-1]["status"] = "success" if success else "error"

                elif event_type == "chunk":
                    # Agent is streaming final answer chunks
                    chunk = event.get("content", "")
                    assistant_content += chunk
                    # Forward chunk to frontend
                    await self.websocket.send_json({
                        "type": "chunk",
                        "content": chunk
                    })

                elif event_type == "final_answer":
                    # Agent has completed the task (legacy - now using chunks)
                    answer = event.get("content", "")
                    assistant_content += answer
                    print(f"[AGENT] Final Answer: {answer[:100]}...")
                    await self.websocket.send_json({
                        "type": "chunk",
                        "content": answer
                    })

                elif event_type == "error":
                    # Error occurred
                    error_message = event.get("content", "Unknown error")
                    has_error = True
                    print(f"[AGENT] ERROR: {error_message}")
                    await self.websocket.send_json({
                        "type": "error",
                        "content": error_message
                    })
                    # Break out of the loop - don't save message for errors
                    break

        except asyncio.CancelledError:
            # Task was cancelled
            cancelled = True
            print(f"[AGENT] Task cancelled via CancelledError")
            await self.websocket.send_json({
                "type": "cancelled",
                "content": "Response cancelled by user"
            })
        finally:
            self.cancel_event = None

        print(f"[AGENT] Agent execution completed. Total events: {event_count}")
        print(f"[AGENT] Assistant content length: {len(assistant_content)}")
        print(f"[AGENT] Total actions: {len(agent_actions)}")
        print(f"[AGENT] Has error: {has_error}")
        print(f"[AGENT] Cancelled: {cancelled}")

        # Only save assistant message if there was no error and not cancelled
        if not has_error and not cancelled:
            # Save assistant message with agent actions
            assistant_message = Message(
                chat_session_id=session_id,
                role=MessageRole.ASSISTANT,
                content=assistant_content if assistant_content else "Task completed.",
                message_metadata={
                    "agent_mode": True,
                    "tools_used": [a["action_type"] for a in agent_actions]
                },
            )
            self.db.add(assistant_message)
            await self.db.flush()  # Get the message ID

            # Save all agent actions linked to the message
            for action_data in agent_actions:
                action = AgentAction(
                    message_id=assistant_message.id,
                    action_type=action_data["action_type"],
                    action_input=action_data["action_input"],
                    action_output=action_data.get("action_output"),
                    status=action_data.get("status", "pending")
                )
                self.db.add(action)

            await self.db.commit()

            # Send completion with message ID
            await self.websocket.send_json({
                "type": "end",
                "message_id": assistant_message.id
            })
        else:
            # Send completion without message ID (error or cancel case)
            if cancelled:
                print(f"[AGENT] Skipping message save due to cancellation")
                await self.websocket.send_json({
                    "type": "end",
                    "cancelled": True
                })
            else:
                print(f"[AGENT] Skipping message save due to error")
                await self.websocket.send_json({
                    "type": "end",
                    "error": True
                })

    async def _get_conversation_history(self, session_id: str) -> list[Dict[str, str]]:
        """Get conversation history for a session."""
        query = (
            select(Message)
            .where(Message.chat_session_id == session_id)
            .order_by(Message.created_at.asc())
        )
        result = await self.db.execute(query)
        messages = result.scalars().all()

        history = []
        for msg in messages:
            history.append({
                "role": msg.role.value,
                "content": msg.content
            })

        return history
