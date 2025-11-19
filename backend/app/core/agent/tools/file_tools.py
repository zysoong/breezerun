"""File operation tools for agent."""

from typing import List
from app.core.agent.tools.base import Tool, ToolParameter, ToolResult
from app.core.sandbox.container import SandboxContainer
from app.core.sandbox.security import validate_file_path


class FileReadTool(Tool):
    """Tool for reading files from the sandbox environment."""

    def __init__(self, container: SandboxContainer):
        """Initialize FileReadTool with a sandbox container.

        Args:
            container: SandboxContainer instance for file operations
        """
        self._container = container

    @property
    def name(self) -> str:
        return "file_read"

    @property
    def description(self) -> str:
        return (
            "Read the contents of a file from the sandbox environment. "
            "Use this to view file contents before editing or to understand existing code. "
            "Returns the full file content as a string."
        )

    @property
    def parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="path",
                type="string",
                description="Path to the file to read (relative to /workspace or absolute path)",
                required=True,
            ),
        ]

    async def execute(self, path: str, **kwargs) -> ToolResult:
        """Read a file from the sandbox.

        Args:
            path: Path to the file to read

        Returns:
            ToolResult with file content
        """
        try:
            # Validate file path for security
            if not validate_file_path(path):
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Invalid file path: {path}",
                    metadata={"path": path},
                )

            # Read file from container
            content = await self._container.read_file(path)

            return ToolResult(
                success=True,
                output=content,
                metadata={
                    "path": path,
                    "size": len(content),
                },
            )

        except FileNotFoundError:
            return ToolResult(
                success=False,
                output="",
                error=f"File not found: {path}",
                metadata={"path": path},
            )
        except Exception as e:
            return ToolResult(
                success=False,
                output="",
                error=f"Failed to read file: {str(e)}",
                metadata={"path": path},
            )


class FileWriteTool(Tool):
    """Tool for writing/creating files in the sandbox environment."""

    def __init__(self, container: SandboxContainer):
        """Initialize FileWriteTool with a sandbox container.

        Args:
            container: SandboxContainer instance for file operations
        """
        self._container = container

    @property
    def name(self) -> str:
        return "file_write"

    @property
    def description(self) -> str:
        return (
            "Write content to a file in the sandbox environment. "
            "Creates a new file or overwrites an existing file. "
            "Use this to create new files or completely replace file contents."
        )

    @property
    def parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="path",
                type="string",
                description="Path where the file should be written (relative to /workspace or absolute path)",
                required=True,
            ),
            ToolParameter(
                name="content",
                type="string",
                description="Content to write to the file",
                required=True,
            ),
        ]

    async def execute(self, path: str, content: str, **kwargs) -> ToolResult:
        """Write content to a file in the sandbox.

        Args:
            path: Path to the file to write
            content: Content to write

        Returns:
            ToolResult with operation status
        """
        try:
            # Validate file path for security
            if not validate_file_path(path):
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Invalid file path: {path}",
                    metadata={"path": path},
                )

            # Write file to container
            await self._container.write_file(path, content)

            return ToolResult(
                success=True,
                output=f"Successfully wrote {len(content)} bytes to {path}",
                metadata={
                    "path": path,
                    "size": len(content),
                },
            )

        except Exception as e:
            return ToolResult(
                success=False,
                output="",
                error=f"Failed to write file: {str(e)}",
                metadata={"path": path},
            )


class FileEditTool(Tool):
    """Tool for editing existing files in the sandbox environment."""

    def __init__(self, container: SandboxContainer):
        """Initialize FileEditTool with a sandbox container.

        Args:
            container: SandboxContainer instance for file operations
        """
        self._container = container

    @property
    def name(self) -> str:
        return "file_edit"

    @property
    def description(self) -> str:
        return (
            "Edit an existing file by replacing specific content. "
            "Searches for 'old_content' in the file and replaces it with 'new_content'. "
            "This is safer than file_write for making targeted changes. "
            "Returns an error if old_content is not found or appears multiple times."
        )

    @property
    def parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="path",
                type="string",
                description="Path to the file to edit",
                required=True,
            ),
            ToolParameter(
                name="old_content",
                type="string",
                description="Content to search for and replace (must match exactly)",
                required=True,
            ),
            ToolParameter(
                name="new_content",
                type="string",
                description="New content to replace the old content with",
                required=True,
            ),
        ]

    async def execute(
        self,
        path: str,
        old_content: str,
        new_content: str,
        **kwargs
    ) -> ToolResult:
        """Edit a file by replacing specific content.

        Args:
            path: Path to the file to edit
            old_content: Content to find and replace
            new_content: New content to insert

        Returns:
            ToolResult with operation status
        """
        try:
            # Validate file path for security
            if not validate_file_path(path):
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Invalid file path: {path}",
                    metadata={"path": path},
                )

            # Read current file content
            current_content = await self._container.read_file(path)

            # Check if old_content exists in the file
            if old_content not in current_content:
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Content to replace not found in file: {path}",
                    metadata={"path": path},
                )

            # Check if old_content appears multiple times
            count = current_content.count(old_content)
            if count > 1:
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Content appears {count} times in file. Please make old_content more specific.",
                    metadata={"path": path, "occurrences": count},
                )

            # Perform replacement
            new_file_content = current_content.replace(old_content, new_content, 1)

            # Write back to file
            await self._container.write_file(path, new_file_content)

            return ToolResult(
                success=True,
                output=f"Successfully edited {path}",
                metadata={
                    "path": path,
                    "old_size": len(current_content),
                    "new_size": len(new_file_content),
                },
            )

        except FileNotFoundError:
            return ToolResult(
                success=False,
                output="",
                error=f"File not found: {path}",
                metadata={"path": path},
            )
        except Exception as e:
            return ToolResult(
                success=False,
                output="",
                error=f"Failed to edit file: {str(e)}",
                metadata={"path": path},
            )
