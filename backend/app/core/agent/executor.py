"""ReAct agent executor for autonomous task completion."""

import json
import re
from typing import Dict, List, Any, AsyncIterator
from pydantic import BaseModel

from app.core.agent.tools.base import ToolRegistry, ToolResult
from app.core.llm.provider import LLMProvider


class AgentStep(BaseModel):
    """A single step in the agent's reasoning process."""
    thought: str | None = None
    action: str | None = None
    action_input: Dict[str, Any | None] = None
    observation: str | None = None
    step_number: int


class AgentResponse(BaseModel):
    """Response from the agent."""
    final_answer: str | None = None
    steps: List[AgentStep] = []
    error: str | None = None
    completed: bool = False


class ReActAgent:
    """ReAct (Reasoning + Acting) agent for autonomous task completion.

    The agent follows a loop:
    1. Thought: Reason about what to do next
    2. Action: Choose a tool to use
    3. Observation: Observe the result of the tool
    4. Repeat until task is complete
    """

    def __init__(
        self,
        llm_provider: LLMProvider,
        tool_registry: ToolRegistry,
        max_iterations: int = 10,
        system_instructions: str | None = None,
    ):
        """Initialize the ReAct agent.

        Args:
            llm_provider: LLM provider for generating responses
            tool_registry: Registry of available tools
            max_iterations: Maximum number of reasoning iterations
            system_instructions: Custom system instructions for the agent
        """
        self.llm = llm_provider
        self.tools = tool_registry
        self.max_iterations = max_iterations
        self.system_instructions = system_instructions or self._default_system_instructions()

    def _default_system_instructions(self) -> str:
        """Get default system instructions for the agent."""
        return """You are an autonomous coding agent with access to a sandbox environment.

Your task is to help users write, test, and debug code by using the available tools.

You have access to the following tools:
{tools}

When solving a task, follow the ReAct pattern:
1. Think about what needs to be done
2. Choose an action (tool) to use
3. Observe the result
4. Repeat until the task is complete

IMPORTANT: You MUST use function calls to invoke tools. Do not describe what tools you would use - actually use them!

When you have completed the task, provide a final answer summarizing what you did.

Available tools will be provided as function calling options. Use them to accomplish the user's request.
"""

    def _build_system_message(self) -> str:
        """Build the system message with tool descriptions."""
        tool_descriptions = "\n".join(
            [f"- {tool.name}: {tool.description}" for tool in self.tools.list_tools()]
        )
        return self.system_instructions.format(tools=tool_descriptions)

    async def run(
        self,
        user_message: str,
        conversation_history: List[Dict[str, str | None]] = None,
        cancel_event: Any = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Run the agent on a user message.

        Args:
            user_message: The user's request
            conversation_history: Previous conversation messages
            cancel_event: Optional asyncio.Event for cancelling execution

        Yields:
            Agent steps and final response
        """
        print(f"\n[REACT AGENT] Starting run()")
        print(f"  User message: {user_message[:100]}...")
        print(f"  Max iterations: {self.max_iterations}")
        print(f"  Available tools: {[t.name for t in self.tools.list_tools()]}")

        # Build messages
        messages = [{"role": "system", "content": self._build_system_message()}]

        if conversation_history:
            messages.extend(conversation_history)
            print(f"  Conversation history: {len(conversation_history)} messages")

        messages.append({"role": "user", "content": user_message})

        # Agent loop
        steps: List[AgentStep] = []

        for iteration in range(self.max_iterations):
            print(f"\n[REACT AGENT] Iteration {iteration + 1}/{self.max_iterations}")

            # Check for cancellation
            if cancel_event and cancel_event.is_set():
                print(f"[REACT AGENT] Cancellation requested")
                yield {
                    "type": "cancelled",
                    "content": "Response cancelled by user",
                    "step": iteration + 1,
                }
                return

            try:
                # Get LLM response with function calling
                llm_messages = messages.copy()
                tools_for_llm = self.tools.get_tools_for_llm()
                print(f"[REACT AGENT] Tools for LLM: {len(tools_for_llm) if tools_for_llm else 0}")

                # Stream response from LLM
                full_response = ""
                function_call = None
                function_name = None
                function_args = ""

                print(f"[REACT AGENT] Calling LLM generate_stream...")
                chunk_count = 0
                async for chunk in self.llm.generate_stream(
                    messages=llm_messages,
                    tools=tools_for_llm if tools_for_llm else None,
                ):
                    # Check for cancellation during streaming
                    if cancel_event and cancel_event.is_set():
                        print(f"[REACT AGENT] Cancellation during streaming")
                        yield {
                            "type": "cancelled",
                            "content": "Response cancelled by user",
                            "partial_content": full_response,
                            "step": iteration + 1,
                        }
                        return

                    chunk_count += 1
                    # Handle regular content
                    if isinstance(chunk, str):
                        full_response += chunk
                        if chunk_count <= 3:  # Only print first few chunks
                            print(f"[REACT AGENT] Text chunk #{chunk_count}: {chunk[:50]}...")
                        # Emit chunks immediately for better UX and cancellation support
                        yield {
                            "type": "chunk",
                            "content": chunk,
                            "step": iteration + 1,
                        }
                    # Handle function call (if LLM returns structured data)
                    elif isinstance(chunk, dict) and "function_call" in chunk:
                        print(f"[REACT AGENT] Function call chunk: {chunk}")
                        function_call = chunk["function_call"]
                        # IMPORTANT: Only set function_name if it's not None (preserve from first chunk)
                        if function_call.get("name") is not None:
                            function_name = function_call.get("name")
                        # Accumulate arguments from all chunks
                        if function_call.get("arguments"):
                            function_args += function_call.get("arguments", "")

                print(f"[REACT AGENT] Stream complete. Total chunks: {chunk_count}")
                print(f"[REACT AGENT] Full response length: {len(full_response)}")
                print(f"[REACT AGENT] Function name: {function_name}")

                # Check if LLM wants to call a function
                if function_name and self.tools.has_tool(function_name):
                    print(f"[REACT AGENT] Executing function: {function_name}")

                    # Note: reasoning text before function call was already emitted as chunks during streaming

                    # Parse function arguments
                    try:
                        args = json.loads(function_args) if isinstance(function_args, str) else function_args
                    except json.JSONDecodeError:
                        args = {}

                    # Execute tool
                    tool = self.tools.get(function_name)
                    if tool:
                        yield {
                            "type": "action",
                            "content": f"Using tool: {function_name}",
                            "tool": function_name,
                            "args": args,
                            "step": iteration + 1,
                        }

                        result = await tool.execute(**args)

                        # Create observation
                        observation = result.output if result.success else f"Error: {result.error}"

                        yield {
                            "type": "observation",
                            "content": observation,
                            "success": result.success,
                            "step": iteration + 1,
                        }

                        # Add tool result to conversation as user message
                        # (GPT-5 doesn't support 'function' role)
                        messages.append({
                            "role": "user",
                            "content": f"Tool '{function_name}' returned: {observation}",
                        })

                        # Record step
                        steps.append(AgentStep(
                            thought=full_response if full_response else None,
                            action=function_name,
                            action_input=args,
                            observation=observation,
                            step_number=iteration + 1,
                        ))

                        # Continue loop
                        continue

                # No function call - agent is providing final answer
                if full_response:
                    print(f"[REACT AGENT] No function call - providing final answer")
                    print(f"[REACT AGENT] Final answer: {full_response[:100]}...")

                    # Chunks were already emitted during streaming above
                    return

                # If we get here with no response, something went wrong
                print(f"[REACT AGENT] ERROR: No response from LLM")
                yield {
                    "type": "error",
                    "content": "Agent did not provide a response",
                    "step": iteration + 1,
                }
                return

            except Exception as e:
                print(f"[REACT AGENT] EXCEPTION: {str(e)}")
                import traceback
                traceback.print_exc()
                yield {
                    "type": "error",
                    "content": f"Agent error: {str(e)}",
                    "step": iteration + 1,
                }
                return

        # Max iterations reached
        yield {
            "type": "final_answer",
            "content": "Task incomplete: reached maximum iterations. Please try breaking down the task into smaller steps.",
            "step": self.max_iterations,
        }
