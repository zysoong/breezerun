"""Local filesystem storage backend using bind mounts."""

import asyncio
import shutil
from pathlib import Path
from typing import List

from app.core.storage.workspace_storage import WorkspaceStorage, FileInfo


class LocalStorage(WorkspaceStorage):
    """Storage backend using local filesystem with bind mounts."""

    def __init__(self, workspace_base: str = "./data/workspaces"):
        """
        Initialize local storage.

        Args:
            workspace_base: Base directory for workspace storage
        """
        self.workspace_base = Path(workspace_base)
        self.workspace_base.mkdir(parents=True, exist_ok=True)

    def _get_workspace_path(self, session_id: str) -> Path:
        """Get workspace path for a session."""
        return self.workspace_base / session_id

    def _get_host_path(self, session_id: str, container_path: str) -> Path:
        """
        Convert container path to host filesystem path.

        Args:
            session_id: Session ID
            container_path: Path inside container (e.g., '/workspace/out/file.py')

        Returns:
            Corresponding host filesystem path
        """
        # Remove leading '/workspace' from container path
        if container_path.startswith('/workspace/'):
            relative_path = container_path[len('/workspace/'):]
        elif container_path.startswith('/workspace'):
            relative_path = container_path[len('/workspace'):]
        else:
            relative_path = container_path.lstrip('/')

        workspace = self._get_workspace_path(session_id)
        return workspace / relative_path

    async def write_file(self, session_id: str, container_path: str, content: bytes) -> bool:
        """Write content to a file."""
        try:
            host_path = self._get_host_path(session_id, container_path)

            # Create parent directories
            await asyncio.to_thread(host_path.parent.mkdir, parents=True, exist_ok=True)

            # Write file
            await asyncio.to_thread(host_path.write_bytes, content)
            return True
        except Exception as e:
            print(f"Error writing file: {e}")
            return False

    async def read_file(self, session_id: str, container_path: str) -> bytes:
        """Read a file from the workspace."""
        host_path = self._get_host_path(session_id, container_path)

        if not await asyncio.to_thread(host_path.exists):
            raise FileNotFoundError(f"File not found: {container_path}")

        return await asyncio.to_thread(host_path.read_bytes)

    async def list_files(self, session_id: str, container_path: str = "/workspace") -> List[FileInfo]:
        """List files in a directory."""
        host_path = self._get_host_path(session_id, container_path)

        if not await asyncio.to_thread(host_path.exists):
            return []

        def _list_files():
            files = []
            for item in host_path.rglob("*"):
                relative = item.relative_to(host_path)
                container_item_path = f"{container_path.rstrip('/')}/{relative}"

                is_dir = item.is_dir()
                size = 0 if is_dir else item.stat().st_size

                files.append(FileInfo(
                    path=container_item_path,
                    size=size,
                    is_dir=is_dir
                ))
            return files

        return await asyncio.to_thread(_list_files)

    async def delete_file(self, session_id: str, container_path: str) -> bool:
        """Delete a file from the workspace."""
        try:
            host_path = self._get_host_path(session_id, container_path)

            if await asyncio.to_thread(host_path.is_dir):
                await asyncio.to_thread(shutil.rmtree, host_path)
            else:
                await asyncio.to_thread(host_path.unlink, missing_ok=True)

            return True
        except Exception as e:
            print(f"Error deleting file: {e}")
            return False

    async def file_exists(self, session_id: str, container_path: str) -> bool:
        """Check if a file exists."""
        host_path = self._get_host_path(session_id, container_path)
        return await asyncio.to_thread(host_path.exists)

    async def create_workspace(self, session_id: str) -> None:
        """Create a new workspace for a session."""
        workspace = self._get_workspace_path(session_id)

        def _create():
            workspace.mkdir(parents=True, exist_ok=True)
            (workspace / "project_files").mkdir(exist_ok=True)
            (workspace / "agent_workspace").mkdir(exist_ok=True)
            (workspace / "out").mkdir(exist_ok=True)

        await asyncio.to_thread(_create)

    async def delete_workspace(self, session_id: str) -> None:
        """Delete entire workspace for a session."""
        workspace = self._get_workspace_path(session_id)

        if await asyncio.to_thread(workspace.exists):
            await asyncio.to_thread(shutil.rmtree, workspace)

    async def copy_to_workspace(
        self,
        session_id: str,
        source_path: Path,
        dest_container_path: str
    ) -> None:
        """Copy files from host to workspace."""
        dest_host_path = self._get_host_path(session_id, dest_container_path)

        def _copy():
            if source_path.is_file():
                dest_host_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, dest_host_path)
            elif source_path.is_dir():
                for file in source_path.rglob("*"):
                    if file.is_file():
                        relative_path = file.relative_to(source_path)
                        dest_file = dest_host_path / relative_path
                        dest_file.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(file, dest_file)

        await asyncio.to_thread(_copy)

    def get_volume_config(self, session_id: str) -> dict:
        """
        Get Docker volume configuration for bind mount.

        Args:
            session_id: Session ID

        Returns:
            Docker volume configuration dict
        """
        workspace_path = self._get_workspace_path(session_id)
        return {
            str(workspace_path.absolute()): {
                "bind": "/workspace",
                "mode": "rw"
            }
        }
