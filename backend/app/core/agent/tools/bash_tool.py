"""Bash command execution tool for agent."""

from typing import List
from app.core.agent.tools.base import Tool, ToolParameter, ToolResult
from app.core.sandbox.container import SandboxContainer
from app.core.sandbox.security import sanitize_command


class BashTool(Tool):
    """Tool for executing bash commands in the sandbox environment."""

    def __init__(self, container: SandboxContainer):
        """Initialize BashTool with a sandbox container.

        Args:
            container: SandboxContainer instance for command execution
        """
        self._container = container

    @property
    def name(self) -> str:
        return "bash"

    @property
    def description(self) -> str:
        return (
            "Execute bash commands in a secure sandbox environment. "
            "Use this tool to: run shell commands, execute scripts, install packages with pip/npm, "
            "compile code, run tests, manage files and directories, check system info, etc. "
            "Commands run in /workspace/out by default. "
            "Examples: 'ls -la', 'python script.py', 'pip install requests', "
            "'cat file.txt', 'mkdir new_dir', 'git status', 'node app.js', 'pytest tests/'. "
            "Supports pipes, redirects, and multi-line commands. Timeout default: 30s."
        )

    @property
    def parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="command",
                type="string",
                description="The bash command to execute (e.g., 'ls -la', 'python script.py', 'npm install')",
                required=True,
            ),
            ToolParameter(
                name="workdir",
                type="string",
                description="Working directory for command execution (default: /workspace/out)",
                required=False,
                default="/workspace/out",
            ),
            ToolParameter(
                name="timeout",
                type="number",
                description="Command timeout in seconds (default: 30)",
                required=False,
                default=30,
            ),
        ]

    async def execute(
        self,
        command: str,
        workdir: str = "/workspace/out",
        timeout: int = 30,
        **kwargs
    ) -> ToolResult:
        """Execute a bash command in the sandbox.

        Args:
            command: The bash command to execute
            workdir: Working directory for execution
            timeout: Command timeout in seconds

        Returns:
            ToolResult with command output
        """
        try:
            # Sanitize command for security
            safe_command = sanitize_command(command)

            # Execute command in container
            exit_code, stdout, stderr = await self._container.execute(
                command=safe_command,
                workdir=workdir,
                timeout=timeout,
            )

            # Prepare output
            output_parts = []
            if stdout:
                output_parts.append(f"[stdout]\n{stdout}")
            if stderr:
                output_parts.append(f"[stderr]\n{stderr}")

            output = "\n".join(output_parts) if output_parts else "(no output)"

            # Determine success based on exit code
            success = exit_code == 0

            return ToolResult(
                success=success,
                output=output,
                error=f"Command exited with code {exit_code}" if exit_code != 0 else None,
                metadata={
                    "exit_code": exit_code,
                    "command": command,
                    "workdir": workdir,
                },
            )

        except Exception as e:
            return ToolResult(
                success=False,
                output="",
                error=f"Failed to execute command: {str(e)}",
                metadata={
                    "command": command,
                    "workdir": workdir,
                },
            )
