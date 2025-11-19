import { create } from 'zustand';
import type { ChatSession, Message } from '@/types';

export interface AgentAction {
  type: 'thought' | 'action' | 'observation';
  content: string;
  tool?: string;
  args?: any;
  success?: boolean;
  step?: number;
}

interface ChatState {
  activeSessionId: string | null;
  streamingMessage: string;
  isStreaming: boolean;
  agentActions: AgentAction[];
  setActiveSession: (sessionId: string | null) => void;
  appendStreamingMessage: (chunk: string) => void;
  setStreaming: (isStreaming: boolean) => void;
  clearStreamingMessage: () => void;
  addAgentAction: (action: AgentAction) => void;
  clearAgentActions: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeSessionId: null,
  streamingMessage: '',
  isStreaming: false,
  agentActions: [],

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  appendStreamingMessage: (chunk) =>
    set((state) => ({ streamingMessage: state.streamingMessage + chunk })),

  setStreaming: (isStreaming) => set({ isStreaming }),

  clearStreamingMessage: () => set({ streamingMessage: '' }),

  addAgentAction: (action) =>
    set((state) => ({ agentActions: [...state.agentActions, action] })),

  clearAgentActions: () => set({ agentActions: [] }),
}));
