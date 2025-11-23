"""Workspace storage abstraction for different storage backends."""

from abc import ABC, abstractmethod
from typing import List, Optional
from pathlib import Path


class FileInfo:
    """File metadata."""

    def __init__(self, path: str, size: int, is_dir: bool = False):
        self.path = path
        self.size = size
        self.is_dir = is_dir


class WorkspaceStorage(ABC):
    """Abstract interface for workspace storage backends."""

    @abstractmethod
    async def write_file(self, session_id: str, container_path: str, content: bytes) -> bool:
        """
        Write content to a file in the workspace.

        Args:
            session_id: Chat session ID
            container_path: Path inside container (e.g., '/workspace/out/file.py')
            content: File content as bytes

        Returns:
            True if successful, False otherwise
        """
        pass

    @abstractmethod
    async def read_file(self, session_id: str, container_path: str) -> bytes:
        """
        Read a file from the workspace.

        Args:
            session_id: Chat session ID
            container_path: Path inside container (e.g., '/workspace/out/file.py')

        Returns:
            File content as bytes

        Raises:
            FileNotFoundError: If file doesn't exist
        """
        pass

    @abstractmethod
    async def list_files(self, session_id: str, container_path: str = "/workspace") -> List[FileInfo]:
        """
        List files in a directory.

        Args:
            session_id: Chat session ID
            container_path: Directory path inside container

        Returns:
            List of FileInfo objects
        """
        pass

    @abstractmethod
    async def delete_file(self, session_id: str, container_path: str) -> bool:
        """
        Delete a file from the workspace.

        Args:
            session_id: Chat session ID
            container_path: Path inside container

        Returns:
            True if successful, False otherwise
        """
        pass

    @abstractmethod
    async def file_exists(self, session_id: str, container_path: str) -> bool:
        """
        Check if a file exists.

        Args:
            session_id: Chat session ID
            container_path: Path inside container

        Returns:
            True if file exists, False otherwise
        """
        pass

    @abstractmethod
    async def create_workspace(self, session_id: str) -> None:
        """
        Create a new workspace for a session.

        Args:
            session_id: Chat session ID
        """
        pass

    @abstractmethod
    async def delete_workspace(self, session_id: str) -> None:
        """
        Delete entire workspace for a session.

        Args:
            session_id: Chat session ID
        """
        pass

    @abstractmethod
    async def copy_to_workspace(
        self,
        session_id: str,
        source_path: Path,
        dest_container_path: str
    ) -> None:
        """
        Copy files from host to workspace (e.g., user-uploaded files).

        Args:
            session_id: Chat session ID
            source_path: Source path on host
            dest_container_path: Destination path in container
        """
        pass
