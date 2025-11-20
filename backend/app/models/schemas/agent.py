"""Agent configuration schemas for API validation."""

from typing import Dict, List, Any
from pydantic import BaseModel, Field


class AgentConfigurationBase(BaseModel):
    """Base agent configuration schema."""
    agent_type: str = Field(default="code_agent", description="Type of agent template")
    system_instructions: str | None = Field(default=None, description="Custom system instructions")
    enabled_tools: List[str] = Field(default_factory=list, description="List of enabled tool names")
    llm_provider: str = Field(default="openai", description="LLM provider (openai, anthropic, azure, etc.)")
    llm_model: str = Field(default="gpt-4", description="LLM model name")
    llm_config: Dict[str, Any] = Field(default_factory=dict, description="LLM configuration (temperature, max_tokens, etc.)")


class AgentConfigurationUpdate(BaseModel):
    """Schema for updating agent configuration."""
    agent_type: str | None = None
    system_instructions: str | None = None
    enabled_tools: List[str] | None = None
    llm_provider: str | None = None
    llm_model: str | None = None
    llm_config: Dict[str, Any] | None = None


class AgentConfigurationResponse(AgentConfigurationBase):
    """Schema for agent configuration response."""
    id: str
    project_id: str

    class Config:
        from_attributes = True
