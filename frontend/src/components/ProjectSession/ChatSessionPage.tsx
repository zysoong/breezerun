import { useEffect, useRef, useState } from 'react';
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch session
  const { data: session } = useQuery({
    queryKey: ['chatSession', sessionId],
    queryFn: () => chatSessionsAPI.get(sessionId!),
    enabled: !!sessionId,
  });

  // Fetch messages
  const { data: messagesData } = useQuery({
    queryKey: ['messages', sessionId],
    queryFn: () => messagesAPI.list(sessionId!),
    enabled: !!sessionId,
  });

  // Load messages from API
  useEffect(() => {
    if (messagesData?.messages) {
      setMessages(messagesData.messages);
    }
  }, [messagesData]);

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
      } else if (data.type === 'thought') {
        addAgentAction({
          type: 'thought',
          content: data.content,
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
        // Refresh messages from API
        setTimeout(() => {
          messagesAPI.list(sessionId).then((data) => setMessages(data.messages));
        }, 500);
      } else if (data.type === 'error') {
        console.error('WebSocket error:', data.content);
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
      ws.close();
    };
  }, [sessionId, addAgentAction, clearAgentActions]);

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || input;
    if (!textToSend.trim() || isSending || !wsRef.current) return;

    setIsSending(true);
    setInput('');

    // Add user message to UI
    const userMsg = {
      id: 'temp-user-' + Date.now(),
      role: 'user' as const,
      content: textToSend,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Send via WebSocket
    wsRef.current.send(
      JSON.stringify({
        type: 'message',
        content: textToSend,
      })
    );
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
                    {/* Show agent actions inline for assistant messages */}
                    {message.role === 'assistant' && agentActions && agentActions.length > 0 && index === messages.length - 1 && (
                      <div className="agent-actions-inline">
                        {agentActions.map((action, idx) => (
                          <div key={idx} className={`action-block action-${action.type}`}>
                            {action.type === 'thought' && (
                              <details className="thought-details" open>
                                <summary>💭 Thinking... (Step {action.step})</summary>
                                <div className="thought-content">{action.content}</div>
                              </details>
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
          <button className="send-btn" onClick={() => handleSend()} disabled={!input.trim() || isSending}>
            {isSending ? (
              <span className="spinner">⏳</span>
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
