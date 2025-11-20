// Project types
export interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectCreate {
  name: string;
  description?: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
}

export interface ProjectListResponse {
  projects: Project[];
  total: number;
}

// Agent Configuration types
export interface AgentConfiguration {
  id: string;
  project_id: string;
  agent_type: string;
  system_instructions: string | null;
  enabled_tools: string[];
  llm_provider: string;
  llm_model: string;
  llm_config: Record<string, any>;
}

export interface AgentConfigurationUpdate {
  agent_type?: string;
  system_instructions?: string | null;
  enabled_tools?: string[];
  llm_provider?: string;
  llm_model?: string;
  llm_config?: Record<string, any>;
}

// Chat Session types
export interface ChatSession {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  container_id: string | null;
  status: 'active' | 'archived';
  environment_type?: string | null; // Set by agent when environment is configured
}

export interface ChatSessionCreate {
  name: string;
}

export interface ChatSessionListResponse {
  chat_sessions: ChatSession[];
  total: number;
}

// Message types
export interface Message {
  id: string;
  chat_session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  message_metadata: Record<string, any>;
}

export interface MessageCreate {
  content: string;
  role?: 'user' | 'assistant' | 'system';
  message_metadata?: Record<string, any>;
}

export interface MessageListResponse {
  messages: Message[];
  total: number;
}
