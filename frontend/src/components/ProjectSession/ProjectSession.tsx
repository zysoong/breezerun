import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsAPI, chatSessionsAPI } from '@/services/api';
import { useChatStore } from '@/stores/chatStore';
import ChatSessionTabs from './ChatSessionTabs';
import FilePanel from './FilePanel';
import AgentConfigPanel from './AgentConfigPanel';
import './ProjectSession.css';

export default function ProjectSession() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { activeSessionId, setActiveSession } = useChatStore();
  const [showConfigPanel, setShowConfigPanel] = useState(false);

  // Fetch project
  const { data: project, isLoading: isLoadingProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsAPI.get(projectId!),
    enabled: !!projectId,
  });

  // Fetch chat sessions
  const { data: sessionsData } = useQuery({
    queryKey: ['chatSessions', projectId],
    queryFn: () => chatSessionsAPI.list(projectId),
    enabled: !!projectId,
  });

  // Create chat session mutation
  const createSessionMutation = useMutation({
    mutationFn: (name: string) =>
      chatSessionsAPI.create(projectId!, { name }),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions', projectId] });
      setActiveSession(newSession.id);
    },
  });

  const handleCreateSession = () => {
    const sessionCount = (sessionsData?.chat_sessions.length || 0) + 1;
    createSessionMutation.mutate(`Chat ${sessionCount}`);
  };

  const handleBackToProjects = () => {
    navigate('/');
  };

  if (isLoadingProject) {
    return <div className="loading">Loading project...</div>;
  }

  if (!project) {
    return <div className="error">Project not found</div>;
  }

  const chatSessions = sessionsData?.chat_sessions || [];

  return (
    <div className="project-session">
      <div className="project-session-header">
        <div className="header-top">
          <button className="back-btn" onClick={handleBackToProjects}>
            ← Back to Projects
          </button>
          <button
            className="settings-btn"
            onClick={() => setShowConfigPanel(true)}
            title="Agent Configuration"
          >
            ⚙️
          </button>
        </div>
        <h1>{project.name}</h1>
        {project.description && (
          <p className="project-desc">{project.description}</p>
        )}
      </div>

      <div className="project-session-content">
        <div className="chat-sessions-sidebar">
          <div className="sidebar-header">
            <h3>Chat Sessions</h3>
            <button
              className="new-session-btn"
              onClick={handleCreateSession}
              disabled={createSessionMutation.isPending}
            >
              +
            </button>
          </div>

          <ChatSessionTabs
            sessions={chatSessions}
            activeSessionId={activeSessionId}
            onSelectSession={setActiveSession}
          />
        </div>

        <FilePanel projectId={projectId!} />
      </div>

      {/* Agent Configuration Overlay */}
      {showConfigPanel && (
        <div className="config-overlay" onClick={() => setShowConfigPanel(false)}>
          <div className="config-panel-container" onClick={(e) => e.stopPropagation()}>
            <div className="config-panel-header">
              <h2>Agent Configuration</h2>
              <button
                className="close-btn"
                onClick={() => setShowConfigPanel(false)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <AgentConfigPanel projectId={projectId!} />
          </div>
        </div>
      )}
    </div>
  );
}
