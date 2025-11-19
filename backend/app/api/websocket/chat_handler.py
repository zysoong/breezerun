"""WebSocket handler for chat streaming with agent support."""

import json
from typing import Dict, Any
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.database import ChatSession, Message, MessageRole, AgentConfiguration, AgentAction
from app.core.llm import create_llm_provider
from app.core.agent.executor import ReActAgent
from app.core.agent.tools import ToolRegistry, BashTool, FileReadTool, FileWriteTool, FileEditTool
from app.core.sandbox.manager import ContainerPoolManager


class ChatWebSocketHandler:
    """Handle WebSocket connections for chat streaming."""

    def __init__(self, websocket: WebSocket, db: AsyncSession):
        self.websocket = websocket
        self.db = db

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

        # Create LLM provider
        try:
            llm_provider = create_llm_provider(
                provider=agent_config.llm_provider,
                model=agent_config.llm_model,
                llm_config=agent_config.llm_config,
            )

            # Check if agent mode is enabled (has tools)
            use_agent = agent_config.enabled_tools and len(agent_config.enabled_tools) > 0

            if use_agent:
                # Agent mode - use ReAct agent with tools
                await self._handle_agent_response(
                    session_id,
                    content,
                    history,
                    llm_provider,
                    agent_config
                )
            else:
                # Simple chat mode - direct LLM response
                await self._handle_simple_response(
                    session_id,
                    history,
                    llm_provider,
                    agent_config
                )

        except Exception as e:
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

        # Stream response
        assistant_content = ""
        await self.websocket.send_json({"type": "start"})

        async for chunk in llm_provider.generate_stream(messages):
            if isinstance(chunk, str):
                assistant_content += chunk
                await self.websocket.send_json({
                    "type": "chunk",
                    "content": chunk
                })

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
        # Get or create sandbox container
        container_manager = ContainerPoolManager()
        container = await container_manager.create_container(
            session_id,
            agent_config.environment_type,
            agent_config.environment_config
        )

        # Initialize tool registry
        tool_registry = ToolRegistry()

        # Register enabled tools
        if "bash" in agent_config.enabled_tools:
            tool_registry.register(BashTool(container))
        if "file_read" in agent_config.enabled_tools:
            tool_registry.register(FileReadTool(container))
        if "file_write" in agent_config.enabled_tools:
            tool_registry.register(FileWriteTool(container))
        if "file_edit" in agent_config.enabled_tools:
            tool_registry.register(FileEditTool(container))

        # Create ReAct agent
        agent = ReActAgent(
            llm_provider=llm_provider,
            tool_registry=tool_registry,
            system_instructions=agent_config.system_instructions,
        )

        # Stream agent execution
        assistant_content = ""
        agent_actions = []

        await self.websocket.send_json({"type": "start"})

        async for event in agent.run(user_message, history):
            event_type = event.get("type")

            if event_type == "thought":
                # Agent is thinking
                chunk = event.get("content", "")
                assistant_content += chunk
                await self.websocket.send_json({
                    "type": "thought",
                    "content": chunk,
                    "step": event.get("step", 0)
                })

            elif event_type == "action":
                # Agent is using a tool
                tool_name = event.get("tool")
                tool_args = event.get("args", {})
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

            elif event_type == "final_answer":
                # Agent has completed the task
                answer = event.get("content", "")
                assistant_content += answer
                await self.websocket.send_json({
                    "type": "chunk",
                    "content": answer
                })

            elif event_type == "error":
                # Error occurred
                error = event.get("content", "Unknown error")
                await self.websocket.send_json({
                    "type": "error",
                    "content": error
                })

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

        # Send completion
        await self.websocket.send_json({
            "type": "end",
            "message_id": assistant_message.id
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
