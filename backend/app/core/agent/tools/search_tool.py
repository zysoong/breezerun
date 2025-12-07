"""Search tool for finding files and content in the sandbox environment."""

from typing import List
import os
import fnmatch
from pathlib import Path
from app.core.agent.tools.base import Tool, ToolParameter, ToolResult
from app.core.sandbox.container import SandboxContainer


class SearchTool(Tool):
    """Tool for searching files and content in the sandbox environment."""

    def __init__(self, container: SandboxContainer):
        """Initialize SearchTool with a sandbox container.

        Args:
            container: SandboxContainer instance for file operations
        """
        self._container = container

    @property
    def name(self) -> str:
        return "search"

    @property
    def description(self) -> str:
        return (
            "Text-based search for files and content. Best for:\n"
            "- Finding files by name pattern (e.g., '*.py', 'config.json')\n"
            "- Searching for specific text/strings in files (grep-style)\n"
            "- Quick exploration of the codebase\n"
            "- Finding error messages, log strings, or literal text\n\n"
            "USE ast_search INSTEAD when you need to find code structures like "
            "'all function definitions' or 'all class declarations' - ast_search "
            "understands code syntax and won't match text in comments/strings."
        )

    @property
    def parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="mode",
                type="string",
                description=(
                    "Search mode: 'filename' to search by file name pattern, "
                    "'content' to search for text within files. Default: 'filename'"
                ),
                required=False,
                default="filename",
            ),
            ToolParameter(
                name="pattern",
                type="string",
                description=(
                    "Search pattern. For filename mode: glob pattern like '*.py', '**/*.js', 'config.*'. "
                    "For content mode: text/regex to search for in file contents."
                ),
                required=True,
            ),
            ToolParameter(
                name="path",
                type="string",
                description="Directory to search in (default: /workspace/out)",
                required=False,
                default="/workspace/out",
            ),
            ToolParameter(
                name="max_results",
                type="number",
                description="Maximum number of results to return (default: 50)",
                required=False,
                default=50,
            ),
            ToolParameter(
                name="file_pattern",
                type="string",
                description=(
                    "For content mode: limit search to files matching this pattern "
                    "(e.g., '*.py' to search only Python files)"
                ),
                required=False,
                default="*",
            ),
        ]

    async def execute(
        self,
        pattern: str,
        mode: str = "filename",
        path: str = "/workspace/out",
        max_results: int = 50,
        file_pattern: str = "*",
        **kwargs
    ) -> ToolResult:
        """Search for files or content in the sandbox.

        Args:
            pattern: Search pattern (filename pattern or text to search)
            mode: Search mode ('filename' or 'content')
            path: Directory to search in
            max_results: Maximum number of results
            file_pattern: File pattern filter for content search

        Returns:
            ToolResult with search results
        """
        try:
            # Resolve the search path
            search_path = Path(path)
            if not search_path.is_absolute():
                search_path = Path("/workspace") / path

            # Validate that path exists (via container)
            try:
                # Try to list the directory to validate it exists
                await self._container.execute(
                    f"test -d {search_path} && echo 'exists'",
                    workdir="/workspace",
                    timeout=5
                )
            except Exception:
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Directory not found: {search_path}",
                    metadata={"path": str(search_path)},
                )

            if mode == "filename":
                return await self._search_by_filename(search_path, pattern, max_results)
            elif mode == "content":
                return await self._search_by_content(
                    search_path, pattern, file_pattern, max_results
                )
            else:
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Invalid search mode: {mode}. Use 'filename' or 'content'.",
                    metadata={"mode": mode},
                )

        except Exception as e:
            return ToolResult(
                success=False,
                output="",
                error=f"Search failed: {str(e)}",
                metadata={
                    "pattern": pattern,
                    "mode": mode,
                    "path": path,
                },
            )

    async def _search_by_filename(
        self, search_path: Path, pattern: str, max_results: int
    ) -> ToolResult:
        """Search for files by filename pattern."""
        try:
            # Use find command to search for files
            # Escape special characters in pattern for shell
            safe_pattern = pattern.replace("'", "'\\''")

            # Build find command
            if "**" in pattern:
                # Recursive search
                parts = pattern.split("**")
                base_pattern = parts[-1].lstrip("/")
                find_cmd = f"find {search_path} -type f -name '{base_pattern}' 2>/dev/null | head -n {max_results}"
            else:
                # Non-recursive search
                find_cmd = f"find {search_path} -maxdepth 1 -type f -name '{safe_pattern}' 2>/dev/null | head -n {max_results}"

            exit_code, stdout, stderr = await self._container.execute(
                find_cmd,
                workdir="/workspace",
                timeout=30,
            )

            if exit_code != 0 and exit_code != 1:  # 1 means no matches found
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Find command failed: {stderr}",
                    metadata={"pattern": pattern},
                )

            # Parse results
            results = [line.strip() for line in stdout.strip().split("\n") if line.strip()]

            if not results:
                return ToolResult(
                    success=True,
                    output=f"No files found matching pattern: {pattern}",
                    metadata={
                        "pattern": pattern,
                        "matches": 0,
                    },
                )

            # Format output
            output = f"Found {len(results)} file(s) matching '{pattern}':\n"
            for result in results[:max_results]:
                output += f"  - {result}\n"

            if len(results) > max_results:
                output += f"\n... and {len(results) - max_results} more results (use max_results to see more)"

            return ToolResult(
                success=True,
                output=output.strip(),
                metadata={
                    "pattern": pattern,
                    "matches": len(results),
                    "results": results[:max_results],
                },
            )

        except Exception as e:
            return ToolResult(
                success=False,
                output="",
                error=f"Filename search failed: {str(e)}",
                metadata={"pattern": pattern},
            )

    async def _search_by_content(
        self,
        search_path: Path,
        pattern: str,
        file_pattern: str,
        max_results: int,
    ) -> ToolResult:
        """Search for text content within files."""
        try:
            # Use grep to search file contents
            # Escape pattern for shell
            safe_pattern = pattern.replace("'", "'\\''")
            safe_file_pattern = file_pattern.replace("'", "'\\''")

            # Build grep command with file pattern filter
            grep_cmd = (
                f"find {search_path} -type f -name '{safe_file_pattern}' "
                f"-exec grep -l '{safe_pattern}' {{}} \\; 2>/dev/null | head -n {max_results}"
            )

            exit_code, stdout, stderr = await self._container.execute(
                grep_cmd,
                workdir="/workspace",
                timeout=30,
            )

            if exit_code != 0 and exit_code != 1:  # 1 means no matches found
                return ToolResult(
                    success=False,
                    output="",
                    error=f"Grep command failed: {stderr}",
                    metadata={"pattern": pattern},
                )

            # Parse results
            results = [line.strip() for line in stdout.strip().split("\n") if line.strip()]

            if not results:
                return ToolResult(
                    success=True,
                    output=f"No files found containing: {pattern}",
                    metadata={
                        "pattern": pattern,
                        "matches": 0,
                    },
                )

            # Get context for each match (first few lines containing the pattern)
            detailed_results = []
            for file_path in results[:max_results]:
                # Get matching lines with context
                context_cmd = f"grep -n '{safe_pattern}' {file_path} 2>/dev/null | head -n 3"
                _, context_stdout, _ = await self._container.execute(
                    context_cmd,
                    workdir="/workspace",
                    timeout=10,
                )

                context_lines = context_stdout.strip().split("\n")[:3]
                detailed_results.append({
                    "file": file_path,
                    "matches": context_lines,
                })

            # Format output
            output = f"Found '{pattern}' in {len(results)} file(s):\n\n"
            for result in detailed_results:
                output += f"📄 {result['file']}\n"
                for match_line in result['matches']:
                    output += f"   {match_line}\n"
                output += "\n"

            if len(results) > max_results:
                output += f"... and {len(results) - max_results} more files (use max_results to see more)"

            return ToolResult(
                success=True,
                output=output.strip(),
                metadata={
                    "pattern": pattern,
                    "matches": len(results),
                    "files": [r["file"] for r in detailed_results],
                },
            )

        except Exception as e:
            return ToolResult(
                success=False,
                output="",
                error=f"Content search failed: {str(e)}",
                metadata={"pattern": pattern},
            )
