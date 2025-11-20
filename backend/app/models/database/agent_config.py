"""Agent configuration database model."""

import uuid
import json
from sqlalchemy import Column, String, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship

from app.core.storage.database import Base


class AgentConfiguration(Base):
    """Agent configuration model."""

    __tablename__ = "agent_configurations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id = Column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True)

    # Agent settings
    agent_type = Column(String(50), default="code_agent", nullable=False)
    system_instructions = Column(Text, nullable=True)

    # Tool settings
    enabled_tools = Column(JSON, default=list, nullable=False)  # list of tool names

    # LLM settings
    llm_provider = Column(String(50), default="openai", nullable=False)
    llm_model = Column(String(100), default="gpt-4", nullable=False)
    llm_config = Column(JSON, default=dict, nullable=False)  # temperature, max_tokens, etc.

    # Relationships
    project = relationship("Project", back_populates="agent_config")
