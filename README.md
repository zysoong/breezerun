# Open Codex GUI

A local LLM agent development environment with project-based workflow, similar to Claude.ai but with full control over LLM providers and execution environments.

## Project Status

**Phase 1 (Foundation) - COMPLETED** ✅
**Phase 2 (Chat Infrastructure) - COMPLETED** ✅
**Phase 3 (Sandbox System) - COMPLETED** ✅
**Phase 4 (ReAct Agent System) - COMPLETED** ✅

### What's Been Implemented

#### Backend (Python/FastAPI)
- ✅ Complete project structure
- ✅ SQLAlchemy database models (Projects, AgentConfiguration, ChatSession, Message, File, AgentAction)
- ✅ FastAPI REST API with CRUD endpoints for projects
- ✅ Chat session and message API endpoints
- ✅ WebSocket streaming for real-time chat
- ✅ LiteLLM integration for unified LLM API access
- ✅ Docker sandbox system with container pooling
- ✅ Multiple environment templates (Python 3.11/3.12, Node.js 20)
- ✅ Container lifecycle management
- ✅ File upload/download system
- ✅ Command execution in sandbox
- ✅ Security controls and resource limits
- ✅ Agent configuration management
- ✅ SQLite database with async support
- ✅ CORS configuration for local development
- ✅ **ReAct agent system with reasoning loop**
- ✅ **Tool system (BashTool, FileReadTool, FileWriteTool, FileEditTool)**
- ✅ **LLM function calling integration**
- ✅ **Agent action tracking and persistence**
- ✅ **Dual mode operation (Simple chat / Agent mode)**

#### Frontend (Electron + React + TypeScript)
- ✅ Complete project structure with Vite
- ✅ Electron main process and preload setup
- ✅ React + TypeScript application
- ✅ React Router for navigation
- ✅ Zustand for state management
- ✅ TanStack Query for data fetching
- ✅ API client with Axios
- ✅ WebSocket client for streaming
- ✅ Project List UI with search
- ✅ Project Card component
- ✅ New Project Modal
- ✅ Project Session page
- ✅ Chat session management UI
- ✅ Message list with streaming support
- ✅ Message input with auto-resize
- ✅ File upload panel with drag-and-drop ready
- ✅ Sandbox controls (start/stop/reset)
- ✅ Command execution interface
- ✅ File browser with download/delete
- ✅ Full CRUD operations for projects, chat sessions, and files
- ✅ **Agent action visualization (thoughts, tool calls, observations)**
- ✅ **Real-time agent workflow display**
- ✅ **Tool execution results with success/error indicators**
- ✅ **Formatted code blocks and JSON in agent actions**

## Prerequisites

### Backend
- Python 3.11 or higher
- Docker (for future sandbox execution)

### Frontend
- Node.js 18+ and npm
- Install from: https://nodejs.org/

## Setup Instructions

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env

# Edit .env and add your LLM API keys if needed
# (Optional for Phase 1 testing)

# Start the server
python -m app.main
```

The backend will be available at `http://127.0.0.1:8000`
- API docs: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/health`

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev

# In a separate terminal, start Electron (optional)
npm run electron:dev
```

The web interface will be available at `http://localhost:5173`

## Testing Phase 1

### Backend Testing

1. Start the backend server (see Backend Setup above)

2. Test the API endpoints:

```bash
# Health check
curl http://127.0.0.1:8000/health

# List projects
curl http://127.0.0.1:8000/api/v1/projects

# Create a project
curl -X POST http://127.0.0.1:8000/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "My First Project", "description": "A test project"}'

# Get project by ID (use ID from create response)
curl http://127.0.0.1:8000/api/v1/projects/{project_id}

# Update project
curl -X PUT http://127.0.0.1:8000/api/v1/projects/{project_id} \
  -H "Content-Type: application/json" \
  -d '{"name": "Updated Project Name"}'

# Delete project
curl -X DELETE http://127.0.0.1:8000/api/v1/projects/{project_id}
```

### Frontend Testing

1. Ensure the backend is running
2. Start the frontend (see Frontend Setup above)
3. Open http://localhost:5173 in your browser

Test these features:
- ✅ View project list
- ✅ Search projects
- ✅ Create new project
- ✅ Delete project
- ✅ See project update timestamps
- ✅ Click on a project to enter project session
- ✅ Create chat sessions
- ✅ Send messages and receive streaming responses
- ✅ View message history
- ✅ Switch between chat sessions
- ✅ Delete chat sessions
- ✅ Upload files to projects
- ✅ Download/delete files
- ✅ Start/stop/reset sandbox containers
- ✅ Execute custom commands in sandbox
- ✅ View command output (stdout/stderr)
- ✅ Monitor sandbox status

## Architecture Overview

```
open-codex-gui/
├── backend/                   # FastAPI backend
│   ├── app/
│   │   ├── api/              # REST API routes
│   │   ├── core/             # Core modules (config, storage)
│   │   ├── models/           # Database & Pydantic models
│   │   └── main.py           # FastAPI app
│   ├── data/                 # SQLite database (auto-created)
│   └── requirements.txt
│
└── frontend/                  # Electron + React frontend
    ├── electron/             # Electron main & preload
    ├── src/
    │   ├── components/       # React components
    │   ├── services/         # API clients
    │   ├── stores/           # State management
    │   ├── types/            # TypeScript types
    │   └── App.tsx
    └── package.json
```

## API Endpoints

### Projects
- `GET /api/v1/projects` - List all projects
- `POST /api/v1/projects` - Create new project
- `GET /api/v1/projects/{id}` - Get project by ID
- `PUT /api/v1/projects/{id}` - Update project
- `DELETE /api/v1/projects/{id}` - Delete project

### Agent Configuration
- `GET /api/v1/projects/{id}/agent-config` - Get agent config
- `PUT /api/v1/projects/{id}/agent-config` - Update agent config

### Chat Sessions
- `GET /api/v1/chats?project_id={id}` - List chat sessions
- `POST /api/v1/chats?project_id={id}` - Create new chat session
- `GET /api/v1/chats/{id}` - Get chat session by ID
- `PUT /api/v1/chats/{id}` - Update chat session
- `DELETE /api/v1/chats/{id}` - Delete chat session

### Messages
- `GET /api/v1/chats/{id}/messages` - List messages in session
- `POST /api/v1/chats/{id}/messages` - Create new message

### WebSocket
- `WS /api/v1/chats/{id}/stream` - Stream chat responses

### Sandbox
- `POST /api/v1/sandbox/{session_id}/start` - Start sandbox container
- `POST /api/v1/sandbox/{session_id}/stop` - Stop sandbox container
- `POST /api/v1/sandbox/{session_id}/reset` - Reset sandbox
- `GET /api/v1/sandbox/{session_id}/status` - Get container status
- `POST /api/v1/sandbox/{session_id}/execute` - Execute command

### Files
- `POST /api/v1/files/upload/{project_id}` - Upload file
- `GET /api/v1/files/project/{project_id}` - List files
- `GET /api/v1/files/{id}/download` - Download file
- `DELETE /api/v1/files/{id}` - Delete file

## Next Steps

All core phases (1-4) are complete! Potential future enhancements:
- Additional tools (Git operations, API calls, database queries)
- Multi-agent collaboration
- Agent templates for specific tasks
- Human-in-the-loop approvals
- Performance metrics and cost tracking
- Advanced debugging and visualization

## Development

### Backend Development

```bash
cd backend

# Run tests
pytest

# Code formatting
black .
ruff check .
```

### Frontend Development

```bash
cd frontend

# Run dev server
npm run dev

# Build for production
npm run build

# Run Electron in development
npm run electron:dev
```

## Troubleshooting

### Backend Issues

**Import errors**: Make sure you're in the virtual environment
```bash
source venv/bin/activate
```

**Database errors**: Delete `backend/data/open_codex.db` and restart the server to recreate the database

### Frontend Issues

**Module not found**: Run `npm install` again

**API connection errors**: Ensure the backend is running on port 8000

**CORS errors**: Check that `CORS_ORIGINS` in backend/.env includes `http://localhost:5173`

## License

MIT License

## Contributing

All 4 core phases are complete! Open Codex GUI is now a fully functional autonomous coding agent platform with:
- Project-based workflow
- Real-time chat with LLM streaming
- Docker sandbox execution
- ReAct agent system with tool calling
- File management and persistence

The system is ready for production use and can be extended with additional tools, agents, and features.
