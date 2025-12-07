"""AST-aware search tool using ast-grep for structural code queries."""

from typing import List, Dict, Any, Optional
from pathlib import Path
import json
from app.core.agent.tools.base import Tool, ToolParameter, ToolResult
from app.core.sandbox.container import SandboxContainer


# Pattern shortcuts that expand to language-specific AST patterns
PATTERN_SHORTCUTS: Dict[str, Dict[str, str]] = {
    "functions": {
        "python": "def $NAME($$$)",
        "javascript": "function $NAME($$$)",
        "typescript": "function $NAME($$$)",
        "go": "func $NAME($$$)",
        "rust": "fn $NAME($$$)",
        "java": "$RET $NAME($$$) {$$$}",
        "c": "$RET $NAME($$$)",
        "cpp": "$RET $NAME($$$)",
    },
    "async_functions": {
        "python": "async def $NAME($$$)",
        "javascript": "async function $NAME($$$)",
        "typescript": "async function $NAME($$$)",
        "rust": "async fn $NAME($$$)",
    },
    "classes": {
        "python": "class $NAME",
        "javascript": "class $NAME",
        "typescript": "class $NAME",
        "go": "type $NAME struct",
        "rust": "struct $NAME",
        "java": "class $NAME",
        "c": "struct $NAME",
        "cpp": "class $NAME",
    },
    "imports": {
        "python": "import $$$",
        "javascript": "import $$$",
        "typescript": "import $$$",
        "go": "import $$$",
        "rust": "use $$$",
        "java": "import $$$",
        "c": "#include $$$",
        "cpp": "#include $$$",
    },
    "exports": {
        "javascript": "export $$$",
        "typescript": "export $$$",
        "rust": "pub $$$",
        "java": "public $$$",
    },
    "tests": {
        "python": "def test_$NAME($$$)",
        "javascript": "test($$$)",
        "typescript": "test($$$)",
        "go": "func Test$NAME($$$)",
        "rust": "#[test]",
        "java": "@Test",
    },
    "methods": {
        "python": "def $NAME(self, $$$)",
        "javascript": "$NAME($$$) {",
        "typescript": "$NAME($$$) {",
        "go": "func ($R $TYPE) $NAME($$$)",
        "rust": "fn $NAME(&self, $$$)",
        "java": "$MOD $RET $NAME($$$)",
        "cpp": "$RET $CLASS::$NAME($$$)",
    },
}

# Language aliases for ast-grep
LANGUAGE_ALIASES: Dict[str, str] = {
    "py": "python",
    "js": "javascript",
    "ts": "typescript",
    "tsx": "typescript",
    "jsx": "javascript",
    "rs": "rust",
    "c++": "cpp",
}

# Supported languages
SUPPORTED_LANGUAGES = [
    "python", "javascript", "typescript", "go", "rust", "java", "c", "cpp",
    "html", "css", "json", "yaml", "toml", "bash", "lua", "ruby", "kotlin", "swift"
]


class AstGrepTool(Tool):
    """Tool for AST-aware code search using ast-grep."""

    def __init__(self, container: SandboxContainer):
        """Initialize AstGrepTool with a sandbox container.

        Args:
            container: SandboxContainer instance for command execution
        """
        self._container = container

    @property
    def name(self) -> str:
        return "ast_search"

    @property
    def description(self) -> str:
        shortcuts = ", ".join(PATTERN_SHORTCUTS.keys())
        return (
            "AST-aware code search for finding code STRUCTURES. Best for:\n"
            "- Finding all function/method definitions\n"
            "- Finding all class declarations\n"
            "- Finding all imports/exports\n"
            "- Finding specific code patterns regardless of formatting\n"
            "- Precise matching that ignores comments and strings\n\n"
            "USE 'search' tool INSTEAD for simple text/string searches, finding files by name, "
            "or searching for error messages and literal text.\n\n"
            f"Shortcuts: {shortcuts}\n"
            "Pattern syntax: $NAME for identifier, $$$ for multiple items\n"
            "Examples: 'def $NAME($$$)' finds Python functions, 'class $NAME' finds classes\n"
            "Languages: python, javascript, typescript, go, rust, java, c, cpp"
        )

    @property
    def parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="pattern",
                type="string",
                description=(
                    "AST pattern to search for OR a shortcut name. "
                    "Shortcuts: functions, async_functions, classes, imports, exports, tests, methods. "
                    "Pattern examples: 'def $NAME($$$)' (Python functions), 'class $NAME' (classes), "
                    "'import { $$$ } from $MODULE' (JS imports). Use $NAME for identifiers, $$$ for multiple items."
                ),
                required=True,
            ),
            ToolParameter(
                name="language",
                type="string",
                description=(
                    "Programming language to search in. If not specified, ast-grep will auto-detect. "
                    "Options: python, javascript, typescript, go, rust, java, c, cpp, etc."
                ),
                required=False,
                default=None,
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
        ]

    def _resolve_pattern(self, pattern: str, language: Optional[str]) -> str:
        """Resolve pattern shortcut to actual AST pattern.

        Args:
            pattern: Raw pattern or shortcut name
            language: Target language (used for shortcut expansion)

        Returns:
            Resolved AST pattern
        """
        # Check if pattern is a shortcut
        if pattern.lower() in PATTERN_SHORTCUTS:
            shortcut = pattern.lower()
            shortcuts = PATTERN_SHORTCUTS[shortcut]

            # If language specified, use language-specific pattern
            if language:
                lang = LANGUAGE_ALIASES.get(language.lower(), language.lower())
                if lang in shortcuts:
                    return shortcuts[lang]
                # Fallback to a common pattern if language not in shortcuts
                return list(shortcuts.values())[0]

            # Without language, return Python pattern as default (most common)
            return shortcuts.get("python", list(shortcuts.values())[0])

        return pattern

    def _normalize_language(self, language: Optional[str]) -> Optional[str]:
        """Normalize language name for ast-grep.

        Args:
            language: Input language name

        Returns:
            Normalized language name or None
        """
        if not language:
            return None
        lang = language.lower()
        return LANGUAGE_ALIASES.get(lang, lang)

    async def execute(
        self,
        pattern: str,
        language: Optional[str] = None,
        path: str = "/workspace/out",
        max_results: int = 50,
        **kwargs
    ) -> ToolResult:
        """Execute AST search using ast-grep.

        Args:
            pattern: AST pattern or shortcut to search for
            language: Programming language to search in
            path: Directory to search in
            max_results: Maximum number of results

        Returns:
            ToolResult with search results
        """
        try:
            # Resolve path
            search_path = Path(path)
            if not search_path.is_absolute():
                search_path = Path("/workspace") / path

            # Validate directory exists
            try:
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

            # Check if ast-grep is available
            exit_code, _, stderr = await self._container.execute(
                "which ast-grep || which sg",
                workdir="/workspace",
                timeout=5
            )
            if exit_code != 0:
                return ToolResult(
                    success=False,
                    output="",
                    error="ast-grep is not installed in this environment. Use text-based 'search' tool instead.",
                    metadata={"pattern": pattern},
                )

            # Normalize language
            norm_language = self._normalize_language(language)

            # Resolve pattern (handle shortcuts)
            resolved_pattern = self._resolve_pattern(pattern, norm_language)

            # Build ast-grep command
            # Use 'sg' (ast-grep CLI) with JSON output for structured results
            cmd_parts = ["sg", "--pattern", f"'{resolved_pattern}'"]

            if norm_language:
                cmd_parts.extend(["--lang", norm_language])

            # Request JSON output for structured parsing
            cmd_parts.append("--json")

            # Add search path
            cmd_parts.append(str(search_path))

            cmd = " ".join(cmd_parts)

            # Execute search
            exit_code, stdout, stderr = await self._container.execute(
                cmd,
                workdir="/workspace",
                timeout=60
            )

            # Parse results
            if exit_code != 0 and not stdout:
                # Check if it's just "no matches"
                if "no matches" in stderr.lower() or exit_code == 1:
                    return ToolResult(
                        success=True,
                        output=f"No matches found for pattern: {resolved_pattern}",
                        metadata={
                            "pattern": resolved_pattern,
                            "original_pattern": pattern,
                            "language": norm_language,
                            "matches": 0,
                        },
                    )
                return ToolResult(
                    success=False,
                    output="",
                    error=f"ast-grep search failed: {stderr}",
                    metadata={"pattern": resolved_pattern, "command": cmd},
                )

            # Parse JSON output
            matches = self._parse_results(stdout, max_results)

            if not matches:
                return ToolResult(
                    success=True,
                    output=f"No matches found for pattern: {resolved_pattern}",
                    metadata={
                        "pattern": resolved_pattern,
                        "original_pattern": pattern,
                        "language": norm_language,
                        "matches": 0,
                    },
                )

            # Format output for display
            output = self._format_output(matches, resolved_pattern, pattern, len(matches), max_results)

            return ToolResult(
                success=True,
                output=output,
                metadata={
                    "pattern": resolved_pattern,
                    "original_pattern": pattern,
                    "language": norm_language,
                    "matches": len(matches),
                    "results": matches[:max_results],
                },
            )

        except Exception as e:
            return ToolResult(
                success=False,
                output="",
                error=f"AST search failed: {str(e)}",
                metadata={"pattern": pattern, "language": language, "path": path},
            )

    def _parse_results(self, stdout: str, max_results: int) -> List[Dict[str, Any]]:
        """Parse ast-grep JSON output into structured results.

        Args:
            stdout: Raw stdout from ast-grep
            max_results: Maximum number of results to return

        Returns:
            List of match dictionaries
        """
        matches = []

        if not stdout.strip():
            return matches

        try:
            # ast-grep outputs one JSON object per line (JSONL format)
            for line in stdout.strip().split("\n"):
                if not line.strip():
                    continue
                try:
                    result = json.loads(line)
                    match = {
                        "file": result.get("file", ""),
                        "line": result.get("range", {}).get("start", {}).get("line", 0),
                        "column": result.get("range", {}).get("start", {}).get("column", 0),
                        "end_line": result.get("range", {}).get("end", {}).get("line", 0),
                        "match": result.get("text", ""),
                        "rule": result.get("ruleId", ""),
                    }
                    matches.append(match)

                    if len(matches) >= max_results:
                        break
                except json.JSONDecodeError:
                    continue

        except Exception:
            # Fallback: try to parse as single JSON array
            try:
                results = json.loads(stdout)
                if isinstance(results, list):
                    for result in results[:max_results]:
                        match = {
                            "file": result.get("file", ""),
                            "line": result.get("range", {}).get("start", {}).get("line", 0),
                            "column": result.get("range", {}).get("start", {}).get("column", 0),
                            "end_line": result.get("range", {}).get("end", {}).get("line", 0),
                            "match": result.get("text", ""),
                        }
                        matches.append(match)
            except json.JSONDecodeError:
                pass

        return matches

    def _format_output(
        self,
        matches: List[Dict[str, Any]],
        resolved_pattern: str,
        original_pattern: str,
        total_matches: int,
        max_results: int
    ) -> str:
        """Format matches for human-readable output.

        Args:
            matches: List of match dictionaries
            resolved_pattern: The resolved AST pattern
            original_pattern: Original input (pattern or shortcut)
            total_matches: Total number of matches found
            max_results: Maximum results limit

        Returns:
            Formatted output string
        """
        # Header
        if original_pattern.lower() in PATTERN_SHORTCUTS:
            output = f"Found {total_matches} match(es) for '{original_pattern}' (pattern: {resolved_pattern}):\n\n"
        else:
            output = f"Found {total_matches} match(es) for pattern '{resolved_pattern}':\n\n"

        # Group by file for cleaner output
        by_file: Dict[str, List[Dict[str, Any]]] = {}
        for match in matches[:max_results]:
            file_path = match.get("file", "unknown")
            if file_path not in by_file:
                by_file[file_path] = []
            by_file[file_path].append(match)

        for file_path, file_matches in by_file.items():
            output += f"📄 {file_path}\n"
            for m in file_matches:
                line = m.get("line", "?")
                match_text = m.get("match", "").strip()
                # Truncate long matches
                if len(match_text) > 100:
                    match_text = match_text[:100] + "..."
                # Show single line for brevity
                first_line = match_text.split("\n")[0]
                output += f"   Line {line}: {first_line}\n"
            output += "\n"

        if total_matches > max_results:
            output += f"... and {total_matches - max_results} more matches (increase max_results to see more)\n"

        return output.strip()
