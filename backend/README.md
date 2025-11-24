# 🚀 OpenCodex Backend

FastAPI-powered backend for OpenCodex - An autonomous AI coding assistant platform.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [Agent System](#agent-system)
- [Development](#development)
- [Testing](#testing)
- [Deployment](#deployment)

## Overview

The OpenCodex backend is a high-performance, asynchronous API server built with FastAPI that provides:

- **ReAct Agent System**: Autonomous agents with reasoning and acting capabilities
- **Multi-LLM Support**: Integration with OpenAI, Anthropic, Google, and 100+ providers via LiteLLM
- **Sandboxed Execution**: Secure Docker container management for code execution
- **Real-time Streaming**: WebSocket support for live agent responses
- **Project Management**: Complete CRUD operations for projects, sessions, and files

## Features

### 🤖 Autonomous Agent System
- **ReAct Pattern Implementation**: Reasoning → Acting → Observation loop
- **Tool System**: Extensible tool framework with validation
- **Agent Templates**: 8 pre-configured agents (Python, Node.js, Data Analysis, etc.)
- **Function Calling**: Native LLM function calling support
- **Action Persistence**: Full audit trail of agent actions
- **Error Recovery**: Smart retry logic and error handling

### 🔧 Available Tools
- **`file_read`**: Read and visualize files (text, images, PDFs, etc.)
- **`file_write`**: Create new files in sandbox
- **`file_edit`**: Precise file modifications with validation
- **`bash`**: Execute shell commands safely
- **`search`**: Regex-based code search
- **`environment_setup`**: Configure Python/Node environments

### 🐳 Docker Sandbox
- **Container Pooling**: Pre-warmed containers for instant startup
- **Multiple Environments**: Python 3.11/3.12, Node.js 20
- **Resource Limits**: CPU, memory, and disk quotas
- **Volume Management**: Persistent and temporary storage
- **Security**: Network isolation and capability restrictions

### 💾 Storage System
- **Modular Storage**: Support for local, S3, and Docker volumes
- **File Management**: Upload, download, list, delete operations
- **Workspace Isolation**: Separate storage per project/session
- **Binary Support**: Handle images, PDFs, and other binary files

### 🔐 Security
- **API Key Encryption**: AES-256 encryption for stored credentials
- **Path Validation**: Prevent directory traversal attacks
- **Container Isolation**: Sandbox all code execution
- **CORS Configuration**: Configurable origin validation
- **Rate Limiting**: Built-in rate limiting support

### 📊 Database
- **Async SQLAlchemy**: Non-blocking database operations
- **SQLite with WAL**: High-performance local database
- **Migration Support**: Alembic for schema migrations
- **Models**: Projects, ChatSessions, Messages, AgentActions, Files

## Architecture

```
backend/
├── app/
│   ├── api/
│   │   ├── routes/          # REST API endpoints
│   │   │   ├── projects.py  # Project CRUD
│   │   │   ├── chat.py      # Chat session management
│   │   │   ├── sandbox.py   # Container operations
│   │   │   ├── files.py     # File management
│   │   │   └── settings.py  # API key management
│   │   └── websocket/
│   │       ├── chat_handler.py  # WebSocket chat handling
│   │       └── task_registry.py # Background task tracking
│   │
│   ├── core/
│   │   ├── agent/           # Agent system
│   │   │   ├── executor.py  # ReAct agent implementation
│   │   │   ├── templates.py # Agent configurations
│   │   │   └── tools/       # Agent tools
│   │   │       ├── base.py  # Tool base classes
│   │   │       ├── file_tools.py
│   │   │       ├── bash_tool.py
│   │   │       └── search_tool.py
│   │   │
│   │   ├── llm/             # LLM integration
│   │   │   └── provider.py  # LiteLLM wrapper
│   │   │
│   │   ├── sandbox/         # Container management
│   │   │   ├── container.py # Docker operations
│   │   │   ├── manager.py   # Pool management
│   │   │   └── security.py  # Validation
│   │   │
│   │   ├── storage/         # File storage
│   │   │   ├── storage_factory.py
│   │   │   ├── local_storage.py
│   │   │   ├── s3_storage.py
│   │   │   └── volume_storage.py
│   │   │
│   │   └── config.py        # Application config
│   │
│   ├── models/
│   │   ├── database/        # SQLAlchemy models
│   │   └── schemas/         # Pydantic schemas
│   │
│   └── main.py              # FastAPI application
│
├── tests/
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── fixtures/            # Test fixtures
│
├── migrations/              # Database migrations
├── requirements.txt         # Python dependencies
└── .env.example            # Environment template
```

## Installation

### Prerequisites

- Python 3.11 or higher
- Docker 20.10+
- Git

### Setup Steps

1. **Clone the repository**:
```bash
git clone https://github.com/yourusername/open-codex-gui.git
cd open-codex-gui/backend
```

2. **Create virtual environment**:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

3. **Install dependencies**:
```bash
pip install -r requirements.txt
```

4. **Configure environment**:
```bash
cp .env.example .env
# Edit .env with your configuration
```

5. **Initialize database**:
```bash
alembic upgrade head  # If using migrations
# Or let the app create it automatically
```

6. **Start the server**:
```bash
python -m app.main
```

### Using Poetry

```bash
poetry install
poetry run python -m app.main
```

### Using Docker

```bash
docker build -t opencodex-backend .
docker run -p 8000:8000 --env-file .env opencodex-backend
```

## Configuration

### Environment Variables

```bash
# === LLM Configuration ===
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
GROQ_API_KEY=...

# === Database ===
DATABASE_URL=sqlite+aiosqlite:///./data/open_codex.db
# For PostgreSQL: postgresql+asyncpg://user:pass@localhost/dbname

# === Security ===
SECRET_KEY=<generate-with-openssl-rand-hex-32>
ENCRYPTION_KEY=<32-byte-key-for-aes-encryption>

# === Server ===
HOST=127.0.0.1
PORT=8000
RELOAD=true  # Development only
CORS_ORIGINS=["http://localhost:5173","http://localhost:3000"]

# === Docker ===
DOCKER_HOST=unix:///var/run/docker.sock
CONTAINER_PREFIX=opencodex
CONTAINER_NETWORK=opencodex-network
CONTAINER_POOL_SIZE=3
CONTAINER_MAX_POOL_SIZE=10

# === Storage ===
STORAGE_TYPE=local  # Options: local, s3, volume
STORAGE_PATH=./data/storage
# For S3:
# AWS_ACCESS_KEY_ID=...
# AWS_SECRET_ACCESS_KEY=...
# S3_BUCKET=opencodex-storage
# S3_REGION=us-east-1

# === Agent Configuration ===
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4o-mini
DEFAULT_MAX_TOKENS=16384
DEFAULT_TEMPERATURE=0.7
AGENT_MAX_ITERATIONS=30
AGENT_TIMEOUT_SECONDS=300

# === Logging ===
LOG_LEVEL=INFO
LOG_FORMAT=json  # Options: json, text
```

### Docker Network Setup

```bash
# Create network for container communication
docker network create opencodex-network

# Pull required images
docker pull python:3.11-slim
docker pull python:3.12-slim
docker pull node:20-slim
```

## API Documentation

### Interactive Documentation

Once the server is running:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc
- **OpenAPI Schema**: http://localhost:8000/openapi.json

### Core Endpoints

#### Projects
```
GET    /api/v1/projects              # List all projects
POST   /api/v1/projects              # Create project
GET    /api/v1/projects/{id}         # Get project
PUT    /api/v1/projects/{id}         # Update project
DELETE /api/v1/projects/{id}         # Delete project
```

#### Chat Sessions
```
GET    /api/v1/projects/{id}/chat-sessions  # List sessions
POST   /api/v1/projects/{id}/chat-sessions  # Create session
GET    /api/v1/chats/{id}                   # Get session
PUT    /api/v1/chats/{id}                   # Update session
DELETE /api/v1/chats/{id}                   # Delete session
```

#### Messages & Streaming
```
GET    /api/v1/chats/{id}/messages          # List messages
POST   /api/v1/chats/{id}/messages          # Send message
WS     /api/v1/chats/{id}/stream            # WebSocket stream
```

#### Agent Actions
```
GET    /api/v1/chats/{id}/agent-actions     # List actions
GET    /api/v1/agent-actions/{id}           # Get action
```

#### Sandbox Operations
```
POST   /api/v1/sandbox/{session_id}/start   # Start container
POST   /api/v1/sandbox/{session_id}/stop    # Stop container
POST   /api/v1/sandbox/{session_id}/reset   # Reset container
POST   /api/v1/sandbox/{session_id}/execute # Execute command
GET    /api/v1/sandbox/{session_id}/status  # Get status
```

#### File Management
```
POST   /api/v1/files/upload/{project_id}    # Upload files
GET    /api/v1/files/project/{project_id}   # List files
GET    /api/v1/files/{id}/download          # Download file
DELETE /api/v1/files/{id}                   # Delete file
```

### WebSocket Protocol

```python
# Connect
ws = websocket.create_connection("ws://localhost:8000/api/v1/chats/{session_id}/stream")

# Send message
ws.send(json.dumps({
    "type": "message",
    "content": "Create a Flask API"
}))

# Receive events
while True:
    result = ws.recv()
    data = json.loads(result)
    # Event types: start, chunk, action, observation, end, error
```

## Agent System

### ReAct Agent Flow

```mermaid
graph TD
    A[User Message] --> B[Agent Reasoning]
    B --> C{Need Tool?}
    C -->|Yes| D[Select Tool]
    D --> E[Execute Tool]
    E --> F[Observe Result]
    F --> B
    C -->|No| G[Generate Response]
    G --> H[Stream to User]
```

### Creating Custom Tools

```python
from app.core.agent.tools.base import Tool, ToolResult, ToolParameter
from typing import List

class CustomTool(Tool):
    @property
    def name(self) -> str:
        return "custom_tool"

    @property
    def description(self) -> str:
        return "Description for LLM to understand when to use this tool"

    @property
    def parameters(self) -> List[ToolParameter]:
        return [
            ToolParameter(
                name="param1",
                type="string",
                description="Parameter description",
                required=True
            )
        ]

    async def execute(self, param1: str, **kwargs) -> ToolResult:
        try:
            # Tool logic here
            result = await some_operation(param1)
            return ToolResult(
                success=True,
                output=result,
                metadata={"key": "value"}
            )
        except Exception as e:
            return ToolResult(
                success=False,
                error=str(e)
            )
```

### Agent Templates

Available templates in `app/core/agent/templates.py`:

- **`python_dev`**: Python development with testing focus
- **`node_dev`**: Node.js/TypeScript development
- **`data_analyst`**: Data analysis and visualization
- **`script_writer`**: Automation and scripting
- **`code_reviewer`**: Code review and quality analysis
- **`test_writer`**: Test generation specialist
- **`minimal`**: Lightweight for simple tasks
- **`default`**: General-purpose development

## Development

### Code Style

```bash
# Format code
black app tests
ruff check app tests

# Type checking
mypy app

# Import sorting
isort app tests
```

### Running Tests

```bash
# All tests
pytest

# With coverage
pytest --cov=app --cov-report=html

# Specific test file
pytest tests/test_agent.py

# Integration tests only
pytest tests/integration/

# Unit tests only
pytest tests/unit/

# With markers
pytest -m "not slow"
pytest -m "not container"
```

### Database Migrations

```bash
# Create migration
alembic revision --autogenerate -m "Description"

# Apply migrations
alembic upgrade head

# Rollback
alembic downgrade -1
```

### Debugging

```bash
# Enable debug logging
LOG_LEVEL=DEBUG python -m app.main

# Use debugger
python -m pdb app.main

# Profile performance
python -m cProfile -o profile.stats app.main
```

## Testing

### Test Structure

```
tests/
├── unit/
│   ├── test_tools.py
│   ├── test_agent.py
│   └── test_storage.py
├── integration/
│   ├── test_api.py
│   ├── test_websocket.py
│   └── test_sandbox.py
├── fixtures/
│   └── sample_files/
└── conftest.py
```

### Running Specific Test Categories

```bash
# Fast tests only
pytest -m "not slow"

# Skip container tests
pytest -m "not container"

# WebSocket tests
pytest -m websocket

# Database tests
pytest tests/integration/test_database.py
```

### Performance Testing

```bash
# Load testing with locust
locust -f tests/load/locustfile.py --host http://localhost:8000

# Stress testing
python tests/stress/stress_test.py

# Memory profiling
mprof run python -m app.main
mprof plot
```

## Deployment

### Production Configuration

1. **Use PostgreSQL**:
```bash
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/opencodex
```

2. **Enable production settings**:
```bash
RELOAD=false
LOG_LEVEL=WARNING
DEBUG=false
```

3. **Use Gunicorn with Uvicorn workers**:
```bash
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

### Docker Deployment

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Health Checks

```bash
# Basic health check
curl http://localhost:8000/health

# Detailed health check
curl http://localhost:8000/health/detailed
```

### Monitoring

- **Prometheus metrics**: `/metrics` endpoint
- **Application logs**: JSON structured logging
- **Error tracking**: Sentry integration ready
- **Performance**: OpenTelemetry support

## Troubleshooting

### Common Issues

#### Database Locked
```bash
# Solution: Use WAL mode
sqlite3 data/open_codex.db "PRAGMA journal_mode=WAL;"
```

#### Docker Permission Denied
```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

#### Port Already in Use
```bash
# Find and kill process
lsof -i :8000
kill -9 <PID>
```

#### LLM Rate Limits
- Implement exponential backoff
- Use multiple API keys
- Consider caching responses

## Contributing

See the main [Contributing Guide](../CONTRIBUTING.md) for details on:
- Code style and standards
- Testing requirements
- Pull request process
- Development workflow

## License

MIT License - see [LICENSE](../LICENSE) file for details.

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/open-codex-gui/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/open-codex-gui/discussions)
- **Documentation**: [API Docs](http://localhost:8000/docs)