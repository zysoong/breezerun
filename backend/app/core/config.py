"""Application configuration."""

from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Database
    database_url: str = "sqlite+aiosqlite:///./data/open_codex.db"

    # Server
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # Docker
    docker_container_pool_size: int = 5

    # LLM Defaults
    default_llm_provider: str = "openai"
    default_llm_model: str = "gpt-5-2025-08-07"  # Latest OpenAI model (GPT-5)

    # API Key Encryption
    master_encryption_key: str | None = None

    @property
    def cors_origins_list(self) -> List[str]:
        """Parse CORS origins as list."""
        return [origin.strip() for origin in self.cors_origins.split(",")]


# Global settings instance
settings = Settings()
