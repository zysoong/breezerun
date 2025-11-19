"""ReAct agent executor for autonomous task completion."""

import json
import re
from typing import Dict, List, Any, Optional, AsyncIterator
from pydantic import BaseModel

from app.core.agent.tools.base import ToolRegistry, ToolResult
from app.core.llm.provider import LLMProvider


class AgentStep(BaseModel):
    """A single step in the agent's reasoning process."""
    thought: Optional[str] = None
    action: Optional[str] = None
    action_input: Optional[Dict[str, Any]] = None
    observation: Optional[str] = None
    step_number: int


class AgentResponse(BaseModel):
    """Response from the agent."""
    final_answer: Optional[str] = None
    steps: List[AgentStep] = []
    error: Optional[str] = None
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
        system_instructions: Optional[str] = None,
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
        conversation_history: Optional[List[Dict[str, str]]] = None,
    ) -> AsyncIterator[Dict[str, Any]]:
        """Run the agent on a user message.

        Args:
            user_message: The user's request
            conversation_history: Previous conversation messages

        Yields:
            Agent steps and final response
        """
        # Build messages
        messages = [{"role": "system", "content": self._build_system_message()}]

        if conversation_history:
            messages.extend(conversation_history)

        messages.append({"role": "user", "content": user_message})

        # Agent loop
        steps: List[AgentStep] = []

        for iteration in range(self.max_iterations):
            try:
                # Get LLM response with function calling
                llm_messages = messages.copy()
                tools_for_llm = self.tools.get_tools_for_llm()

                # Stream response from LLM
                full_response = ""
                function_call = None
                function_name = None
                function_args = ""

                async for chunk in self.llm.generate_stream(
                    messages=llm_messages,
                    tools=tools_for_llm if tools_for_llm else None,
                ):
                    # Handle regular content
                    if isinstance(chunk, str):
                        full_response += chunk
                        yield {
                            "type": "thought",
                            "content": chunk,
                            "step": iteration + 1,
                        }
                    # Handle function call (if LLM returns structured data)
                    elif isinstance(chunk, dict) and "function_call" in chunk:
                        function_call = chunk["function_call"]
                        function_name = function_call.get("name")
                        function_args = function_call.get("arguments", "{}")

                # Check if LLM wants to call a function
                if function_name and self.tools.has_tool(function_name):
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

                        # Add to conversation
                        messages.append({
                            "role": "assistant",
                            "content": None,
                            "function_call": {"name": function_name, "arguments": json.dumps(args)},
                        })
                        messages.append({
                            "role": "function",
                            "name": function_name,
                            "content": observation,
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
                    yield {
                        "type": "final_answer",
                        "content": full_response,
                        "step": iteration + 1,
                    }

                    return

                # If we get here with no response, something went wrong
                yield {
                    "type": "error",
                    "content": "Agent did not provide a response",
                    "step": iteration + 1,
                }
                return

            except Exception as e:
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
