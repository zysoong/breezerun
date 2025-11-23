import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { chatSessionsAPI, messagesAPI } from '@/services/api';
import { useChatStore } from '@/stores/chatStore';
import './ChatSessionPage.css';

export default function ChatSessionPage() {
  const { projectId, sessionId } = useParams<{ projectId: string; sessionId: string }>();
  const navigate = useNavigate();
  const { agentActions, addAgentAction, clearAgentActions } = useChatStore();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch session
  const { data: session } = useQuery({
    queryKey: ['chatSession', sessionId],
    queryFn: () => chatSessionsAPI.get(sessionId!),
    enabled: !!sessionId,
  });

  // Fetch messages
  const { data: messagesData, refetch: refetchMessages } = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => messagesAPI.list(sessionId!),
    enabled: !!sessionId,
    staleTime: 0, // Always refetch on mount
    cacheTime: 0, // Don't cache
  });

  // Load messages from API
  useEffect(() => {
    console.log('[ChatSessionPage] useEffect triggered. sessionId:', sessionId);
    console.log('[ChatSessionPage] messagesData:', messagesData);
    if (messagesData?.messages) {
      console.log('[ChatSessionPage] Loading messages from API:', messagesData.messages.length);
      console.log('[ChatSessionPage] Total from API:', messagesData.total);
      console.log('[ChatSessionPage] Full messagesData:', JSON.stringify(messagesData, null, 2));
      // Log agent actions for debugging
      messagesData.messages.forEach((msg: any, idx: number) => {
        console.log(`[ChatSessionPage] Message ${idx}: role=${msg.role}, has_actions=${msg.agent_actions?.length || 0}`);
        if (msg.agent_actions && msg.agent_actions.length > 0) {
          console.log(`[ChatSessionPage] Message ${msg.id.substring(0, 8)} has ${msg.agent_actions.length} agent actions:`, msg.agent_actions);
        }
      });
      setMessages(messagesData.messages);
    }
  }, [messagesData, sessionId]);

  // Check for pending message from quick start
  useEffect(() => {
    const pendingMessage = sessionStorage.getItem('pendingMessage');
    if (pendingMessage && sessionId && wsRef.current) {
      sessionStorage.removeItem('pendingMessage');
      // Send it automatically after WebSocket is ready
      setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          setIsSending(true);

          const userMsg = {
            id: 'temp-user-' + Date.now(),
            role: 'user' as const,
            content: pendingMessage,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, userMsg]);

          wsRef.current.send(
            JSON.stringify({
              type: 'message',
              content: pendingMessage,
            })
          );
        }
      }, 500);
    }
  }, [sessionId, wsRef.current]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentActions]);

  // WebSocket connection
  useEffect(() => {
    if (!sessionId) return;

    const ws = new WebSocket(`ws://127.0.0.1:8000/api/v1/chats/${sessionId}/stream`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'start') {
        console.log('[ChatSessionPage] START event - setting isSending to TRUE');
        setIsSending(true); // Enable stop button
        clearAgentActions();
        setMessages((prev) => [
          ...prev,
          {
            id: 'temp-' + Date.now(),
            role: 'assistant',
            content: '',
            created_at: new Date().toISOString(),
          },
        ]);
      } else if (data.type === 'cancelled') {
        console.log('[ChatSessionPage] Response cancelled');
        setIsSending(false);
      } else if (data.type === 'thought') {
        addAgentAction({
          type: 'thought',
          content: data.content,
          step: data.step,
        });
      } else if (data.type === 'action_streaming') {
        console.log('[ChatSessionPage] ACTION_STREAMING received:', data);
        addAgentAction({
          type: 'action_streaming',
          content: `Preparing ${data.tool}...`,
          tool: data.tool,
          status: data.status,
          step: data.step,
        });
      } else if (data.type === 'action_args_chunk') {
        console.log('[ChatSessionPage] ACTION_ARGS_CHUNK received:', data);
        // Add the chunk as an action so it triggers re-render
        addAgentAction({
          type: 'action_args_chunk',
          content: data.partial_args || '',
          tool: data.tool,
          partial_args: data.partial_args,
          step: data.step,
        });
      } else if (data.type === 'action') {
        addAgentAction({
          type: 'action',
          content: `Using tool: ${data.tool}`,
          tool: data.tool,
          args: data.args,
          step: data.step,
        });
      } else if (data.type === 'observation') {
        addAgentAction({
          type: 'observation',
          content: data.content,
          success: data.success,
          step: data.step,
        });
      } else if (data.type === 'chunk') {
        // Update the last message with new content
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastMsg = newMessages[newMessages.length - 1];
          if (lastMsg && lastMsg.role === 'assistant') {
            lastMsg.content += data.content;
          }
          return newMessages;
        });
      } else if (data.type === 'end') {
        setIsSending(false);
        // Refresh messages from API using React Query
        setTimeout(() => {
          refetchMessages();
        }, 500);
      } else if (data.type === 'error') {
        console.error('WebSocket error:', data.content);
        setError(data.content || 'An error occurred');
        setIsSending(false);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsSending(false);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      setIsSending(false);
    };

    return () => {
      console.log('[ChatSessionPage] Cleaning up WebSocket');
      ws.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]); // Only sessionId - store functions are stable

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || input;
    if (!textToSend.trim() || isSending || !wsRef.current) return;

    setError(null); // Clear any previous errors
    setInput('');

    // Add user message to UI
    const userMsg = {
      id: 'temp-user-' + Date.now(),
      role: 'user' as const,
      content: textToSend,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Send via WebSocket (isSending will be set to true when 'start' event is received)
    wsRef.current.send(
      JSON.stringify({
        type: 'message',
        content: textToSend,
      })
    );
  };

  const handleCancel = () => {
    console.log('[ChatSessionPage] Cancel button clicked');
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel' }));
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-session-page">
      {/* Header */}
      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate(`/projects/${projectId}`)}>
          ← Back to Project
        </button>
        <h2 className="session-title">
          {session?.name || 'Chat Session'}
          {session?.environment_type && (
            <span className="environment-badge" title="Sandbox environment">
              {session.environment_type}
            </span>
          )}
        </h2>
        <div className="header-spacer"></div>
      </div>

      {/* Messages */}
      <div className="chat-messages-container">
        <div className="chat-messages">
          {!messages || messages.length === 0 ? (
            <div className="empty-chat">
              <h3>Start a conversation</h3>
              <p>Ask me anything, and I'll help you with code, data analysis, and more.</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div key={message.id || index} className={`message-wrapper ${message.role}`}>
                <div className="message-content">
                  <div className="message-role">
                    {message.role === 'user' ? (
                      <div className="avatar user-avatar">You</div>
                    ) : (
                      <div className="avatar assistant-avatar">AI</div>
                    )}
                  </div>
                  <div className="message-text">
                    {/* Show persisted agent actions from database for all assistant messages */}
                    {(() => {
                      const hasPersistedActions = message.role === 'assistant' &&
                                                  message.agent_actions &&
                                                  Array.isArray(message.agent_actions) &&
                                                  message.agent_actions.length > 0;

                      if (hasPersistedActions) {
                        console.log(`[ChatSessionPage] Rendering ${message.agent_actions.length} persisted actions for message ${message.id?.substring(0, 8)}`);
                      }

                      return hasPersistedActions ? (
                        <div className="agent-actions-inline">
                          {message.agent_actions.map((action: any, idx: number) => (
                            <div key={idx} className="action-block action-action">
                              <div className="action-usage">
                                <div className="action-header">
                                  <span className="action-icon">🔧</span>
                                  <strong>Used {action.action_type}</strong>
                                </div>
                                {action.action_input && (
                                  <pre className="action-args">{JSON.stringify(action.action_input, null, 2)}</pre>
                                )}
                                {action.action_output && (
                                  <div className={`observation ${action.status === 'success' ? 'success' : 'error'}`}>
                                    <div className="observation-header">
                                      <span className="observation-icon">
                                        {action.status === 'success' ? '✅' : '❌'}
                                      </span>
                                      <strong>Result</strong>
                                    </div>
                                    <pre className="observation-content">{JSON.stringify(action.action_output, null, 2)}</pre>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null;
                    })()}

                    {/* Show real-time agent actions for the last streaming message */}
                    {message.role === 'assistant' && agentActions && agentActions.length > 0 && index === messages.length - 1 && (
                      <div className="agent-actions-inline">
                        {agentActions
                          // Filter to show clean streaming experience
                          .filter((action, idx, arr) => {
                            // Hide action_streaming if we have action for the same tool
                            if (action.type === 'action_streaming') {
                              const hasAction = arr.find(
                                a => a.type === 'action' && a.tool === action.tool
                              );
                              return !hasAction; // Hide streaming indicator once action arrives
                            }

                            // Hide action_args_chunk if we have action for the same tool
                            if (action.type === 'action_args_chunk') {
                              const hasAction = arr.find(
                                a => a.type === 'action' && a.tool === action.tool
                              );
                              if (hasAction) return false; // Hide chunk once action arrives

                              // Otherwise show only the LAST chunk for this tool
                              const laterChunk = arr.slice(idx + 1).find(
                                a => a.type === 'action_args_chunk' && a.tool === action.tool
                              );
                              return !laterChunk;
                            }

                            return true; // Keep all other action types
                          })
                          .map((action, idx) => (
                          <div key={idx} className={`action-block action-${action.type}`}>
                            {action.type === 'thought' && (
                              <details className="thought-details" open>
                                <summary>💭 Thinking... (Step {action.step})</summary>
                                <div className="thought-content">{action.content}</div>
                              </details>
                            )}
                            {action.type === 'action_streaming' && (
                              <div className="action-usage streaming">
                                <div className="action-header">
                                  <span className="action-icon">⏳</span>
                                  <strong>Preparing {action.tool}...</strong>
                                  <span className="status-badge">{action.status}</span>
                                </div>
                              </div>
                            )}
                            {action.type === 'action_args_chunk' && (
                              <div className="action-usage args-streaming">
                                <div className="action-header">
                                  <span className="action-icon">📝</span>
                                  <strong>{action.tool}</strong>
                                </div>
                                <pre className="action-args partial">{action.partial_args || action.content}</pre>
                              </div>
                            )}
                            {action.type === 'action' && (
                              <div className="action-usage">
                                <div className="action-header">
                                  <span className="action-icon">🔧</span>
                                  <strong>Using {action.tool}</strong>
                                </div>
                                {action.args && (
                                  <pre className="action-args">{JSON.stringify(action.args, null, 2)}</pre>
                                )}
                              </div>
                            )}
                            {action.type === 'observation' && (
                              <div className={`observation ${action.success ? 'success' : 'error'}`}>
                                <div className="observation-header">
                                  <span className="observation-icon">
                                    {action.success ? '✅' : '❌'}
                                  </span>
                                  <strong>Result</strong>
                                </div>
                                <pre className="observation-content">{action.content}</pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Message content */}
                    {message.content && (
                      <div className="message-body">
                        {message.content.split('\n').map((line, i) => (
                          <p key={i}>{line || '\u00A0'}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="chat-error-banner">
          <div className="error-content">
            <span className="error-icon">⚠️</span>
            <div className="error-message">{error}</div>
            <button
              className="error-close-btn"
              onClick={() => setError(null)}
              aria-label="Close error"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <textarea
            className="chat-input"
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            rows={1}
            disabled={isSending}
          />
          <button
            className={`send-btn ${isSending ? 'stop-btn' : ''}`}
            onClick={isSending ? handleCancel : () => handleSend()}
            disabled={isSending ? false : !input.trim()}
            title={isSending ? 'Stop generating' : 'Send message'}
          >
            {isSending ? (
              'Stop'
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
