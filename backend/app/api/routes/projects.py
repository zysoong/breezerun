"""Project API routes."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.storage.database import get_db
from app.models.database import Project, AgentConfiguration
from app.models.schemas import (
    ProjectCreate,
    ProjectUpdate,
    ProjectResponse,
    ProjectListResponse,
    AgentConfigurationResponse,
    AgentConfigurationUpdate,
)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    """List all projects."""
    # Get total count
    count_query = select(func.count()).select_from(Project)
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Get projects
    query = select(Project).offset(skip).limit(limit).order_by(Project.updated_at.desc())
    result = await db.execute(query)
    projects = result.scalars().all()

    return ProjectListResponse(
        projects=[ProjectResponse.model_validate(p) for p in projects],
        total=total,
    )


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new project."""
    # Create project
    project = Project(
        name=project_data.name,
        description=project_data.description,
    )
    db.add(project)
    await db.flush()

    # Create default agent configuration
    agent_config = AgentConfiguration(
        project_id=project.id,
        agent_type="code_agent",
        enabled_tools=["bash", "file_read", "file_write", "file_edit", "search"],
        llm_provider="openai",
        llm_model="gpt-4",
        llm_config={"temperature": 0.7, "max_tokens": 4096},
    )
    db.add(agent_config)
    await db.commit()
    await db.refresh(project)

    return ProjectResponse.model_validate(project)


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a project by ID."""
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with id {project_id} not found",
        )

    return ProjectResponse.model_validate(project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    project_data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a project."""
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with id {project_id} not found",
        )

    # Update fields
    if project_data.name is not None:
        project.name = project_data.name
    if project_data.description is not None:
        project.description = project_data.description

    await db.commit()
    await db.refresh(project)

    return ProjectResponse.model_validate(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a project."""
    query = select(Project).where(Project.id == project_id)
    result = await db.execute(query)
    project = result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with id {project_id} not found",
        )

    await db.delete(project)
    await db.commit()


# Agent configuration endpoints
@router.get("/{project_id}/agent-config", response_model=AgentConfigurationResponse)
async def get_agent_config(
    project_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get agent configuration for a project."""
    query = select(AgentConfiguration).where(AgentConfiguration.project_id == project_id)
    result = await db.execute(query)
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent configuration for project {project_id} not found",
        )

    return AgentConfigurationResponse.model_validate(config)


@router.put("/{project_id}/agent-config", response_model=AgentConfigurationResponse)
async def update_agent_config(
    project_id: str,
    config_data: AgentConfigurationUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update agent configuration for a project."""
    query = select(AgentConfiguration).where(AgentConfiguration.project_id == project_id)
    result = await db.execute(query)
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent configuration for project {project_id} not found",
        )

    # Update fields
    update_data = config_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(config, field, value)

    await db.commit()
    await db.refresh(config)

    return AgentConfigurationResponse.model_validate(config)


# Agent template endpoints
@router.get("/templates/list", response_model=list)
async def list_agent_templates():
    """List all available agent templates."""
    from app.core.agent.templates import list_templates

    templates = list_templates()
    return [
        {
            "id": t.id,
            "name": t.name,
            "description": t.description,
            "agent_type": t.agent_type,
            "environment_type": t.environment_type,
            "enabled_tools": t.enabled_tools,
        }
        for t in templates
    ]


@router.get("/templates/{template_id}", response_model=dict)
async def get_agent_template(template_id: str):
    """Get a specific agent template configuration."""
    from app.core.agent.templates import get_template

    template = get_template(template_id)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found"
        )

    return template.model_dump()


@router.post("/{project_id}/agent-config/apply-template/{template_id}",
             response_model=AgentConfigurationResponse)
async def apply_agent_template(
    project_id: str,
    template_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Apply an agent template to a project's configuration."""
    from app.core.agent.templates import get_template_config

    # Get template config
    template_config = get_template_config(template_id)
    if not template_config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Template {template_id} not found"
        )

    # Verify project exists
    project_query = select(Project).where(Project.id == project_id)
    project_result = await db.execute(project_query)
    project = project_result.scalar_one_or_none()

    if not project:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Project with id {project_id} not found",
        )

    # Get or create agent configuration
    config_query = select(AgentConfiguration).where(
        AgentConfiguration.project_id == project_id
    )
    config_result = await db.execute(config_query)
    config = config_result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Agent configuration for project {project_id} not found"
        )

    # Apply template configuration
    for field, value in template_config.items():
        setattr(config, field, value)

    await db.commit()
    await db.refresh(config)

    return AgentConfigurationResponse.model_validate(config)
