"""S3/MinIO storage backend for cloud deployment."""

import io
import asyncio
from pathlib import Path
from typing import List, Optional

try:
    import boto3
    from botocore.exceptions import ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

from app.core.storage.workspace_storage import WorkspaceStorage, FileInfo


class S3Storage(WorkspaceStorage):
    """Storage backend using S3 or MinIO for cloud deployment."""

    def __init__(
        self,
        bucket_name: str,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        region: str = "us-east-1"
    ):
        """
        Initialize S3 storage.

        Args:
            bucket_name: S3 bucket name
            access_key: AWS access key (optional, will use env/IAM if not provided)
            secret_key: AWS secret key (optional, will use env/IAM if not provided)
            endpoint_url: Custom endpoint URL (for MinIO)
            region: AWS region
        """
        if not BOTO3_AVAILABLE:
            raise ImportError("boto3 is required for S3Storage. Install with: pip install boto3")

        self.bucket_name = bucket_name
        self.endpoint_url = endpoint_url

        # Initialize S3 client
        session_kwargs = {}
        if access_key and secret_key:
            session_kwargs.update({
                "aws_access_key_id": access_key,
                "aws_secret_access_key": secret_key,
            })

        client_kwargs = {"region_name": region}
        if endpoint_url:
            client_kwargs["endpoint_url"] = endpoint_url

        self.s3_client = boto3.client("s3", **session_kwargs, **client_kwargs)

        # Ensure bucket exists
        self._ensure_bucket()

    def _ensure_bucket(self):
        """Ensure the S3 bucket exists."""
        try:
            self.s3_client.head_bucket(Bucket=self.bucket_name)
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == '404':
                # Bucket doesn't exist, create it
                self.s3_client.create_bucket(Bucket=self.bucket_name)

    def _get_s3_key(self, session_id: str, container_path: str) -> str:
        """
        Convert container path to S3 key.

        Args:
            session_id: Session ID
            container_path: Path inside container

        Returns:
            S3 object key
        """
        # Remove leading '/workspace' from container path
        if container_path.startswith('/workspace/'):
            relative_path = container_path[len('/workspace/'):]
        elif container_path.startswith('/workspace'):
            relative_path = container_path[len('/workspace'):]
        else:
            relative_path = container_path.lstrip('/')

        return f"workspaces/{session_id}/{relative_path}"

    async def write_file(self, session_id: str, container_path: str, content: bytes) -> bool:
        """Write content to S3."""
        try:
            s3_key = self._get_s3_key(session_id, container_path)

            def _upload():
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=s3_key,
                    Body=content
                )
                return True

            return await asyncio.to_thread(_upload)
        except Exception as e:
            print(f"Error writing file to S3: {e}")
            return False

    async def read_file(self, session_id: str, container_path: str) -> bytes:
        """Read a file from S3."""
        s3_key = self._get_s3_key(session_id, container_path)

        def _download():
            try:
                response = self.s3_client.get_object(
                    Bucket=self.bucket_name,
                    Key=s3_key
                )
                return response['Body'].read()
            except ClientError as e:
                if e.response['Error']['Code'] == 'NoSuchKey':
                    raise FileNotFoundError(f"File not found: {container_path}")
                raise

        return await asyncio.to_thread(_download)

    async def list_files(self, session_id: str, container_path: str = "/workspace") -> List[FileInfo]:
        """List files in S3."""
        prefix = self._get_s3_key(session_id, container_path)
        if not prefix.endswith('/'):
            prefix += '/'

        def _list():
            files = []
            paginator = self.s3_client.get_paginator('list_objects_v2')

            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
                if 'Contents' not in page:
                    break

                for obj in page['Contents']:
                    # Convert S3 key back to container path
                    key = obj['Key']
                    relative_path = key[len(f"workspaces/{session_id}/"):]
                    container_file_path = f"/workspace/{relative_path}"

                    files.append(FileInfo(
                        path=container_file_path,
                        size=obj['Size'],
                        is_dir=key.endswith('/')
                    ))

            return files

        return await asyncio.to_thread(_list)

    async def delete_file(self, session_id: str, container_path: str) -> bool:
        """Delete a file from S3."""
        try:
            s3_key = self._get_s3_key(session_id, container_path)

            def _delete():
                # Delete the object
                self.s3_client.delete_object(
                    Bucket=self.bucket_name,
                    Key=s3_key
                )

                # If it's a directory, delete all objects with this prefix
                if not s3_key.endswith('/'):
                    s3_key_prefix = s3_key + '/'
                else:
                    s3_key_prefix = s3_key

                # List and delete all objects with this prefix
                paginator = self.s3_client.get_paginator('list_objects_v2')
                for page in paginator.paginate(Bucket=self.bucket_name, Prefix=s3_key_prefix):
                    if 'Contents' in page:
                        objects = [{'Key': obj['Key']} for obj in page['Contents']]
                        if objects:
                            self.s3_client.delete_objects(
                                Bucket=self.bucket_name,
                                Delete={'Objects': objects}
                            )

                return True

            return await asyncio.to_thread(_delete)
        except Exception as e:
            print(f"Error deleting file from S3: {e}")
            return False

    async def file_exists(self, session_id: str, container_path: str) -> bool:
        """Check if a file exists in S3."""
        s3_key = self._get_s3_key(session_id, container_path)

        def _exists():
            try:
                self.s3_client.head_object(Bucket=self.bucket_name, Key=s3_key)
                return True
            except ClientError as e:
                if e.response['Error']['Code'] == '404':
                    return False
                raise

        return await asyncio.to_thread(_exists)

    async def create_workspace(self, session_id: str) -> None:
        """Create workspace structure in S3 (create placeholder objects for directories)."""
        def _create():
            # Create directory placeholders
            for subdir in ["project_files", "agent_workspace", "out"]:
                s3_key = f"workspaces/{session_id}/{subdir}/.keep"
                self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=s3_key,
                    Body=b""
                )

        await asyncio.to_thread(_create)

    async def delete_workspace(self, session_id: str) -> None:
        """Delete all objects in the workspace."""
        def _delete():
            prefix = f"workspaces/{session_id}/"

            # List and delete all objects
            paginator = self.s3_client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
                if 'Contents' in page:
                    objects = [{'Key': obj['Key']} for obj in page['Contents']]
                    if objects:
                        self.s3_client.delete_objects(
                            Bucket=self.bucket_name,
                            Delete={'Objects': objects}
                        )

        await asyncio.to_thread(_delete)

    async def copy_to_workspace(
        self,
        session_id: str,
        source_path: Path,
        dest_container_path: str
    ) -> None:
        """Copy files from host to S3."""
        def _copy():
            if source_path.is_file():
                s3_key = self._get_s3_key(session_id, dest_container_path)
                with open(source_path, 'rb') as f:
                    self.s3_client.put_object(
                        Bucket=self.bucket_name,
                        Key=s3_key,
                        Body=f.read()
                    )
            elif source_path.is_dir():
                for file in source_path.rglob("*"):
                    if file.is_file():
                        relative_path = file.relative_to(source_path)
                        container_file_path = f"{dest_container_path.rstrip('/')}/{relative_path}"
                        s3_key = self._get_s3_key(session_id, container_file_path)

                        with open(file, 'rb') as f:
                            self.s3_client.put_object(
                                Bucket=self.bucket_name,
                                Key=s3_key,
                                Body=f.read()
                            )

        await asyncio.to_thread(_copy)

    def get_volume_config(self, session_id: str) -> dict:
        """
        S3 storage doesn't use Docker volumes.
        Returns empty dict - files are accessed via S3 API.
        """
        return {}
