import { useEffect, useRef } from 'react';
import type { Message } from '@/types';
import type { AgentAction } from '@/stores/chatStore';
import './MessageList.css';

interface MessageListProps {
  messages: Message[];
  streamingMessage: string;
  isStreaming: boolean;
  agentActions: AgentAction[];
}

export default function MessageList({
  messages,
  streamingMessage,
  isStreaming,
  agentActions,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingMessage]);

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="message-list">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`message message-${message.role}`}
        >
          <div className="message-header">
            <span className="message-role">
              {message.role === 'user' ? 'You' : 'Assistant'}
            </span>
            <span className="message-time">
              {formatTime(message.created_at)}
            </span>
          </div>
          <div className="message-content">
            {message.content}
          </div>
        </div>
      ))}

      {isStreaming && (
        <div className="message message-assistant streaming">
          <div className="message-header">
            <span className="message-role">Assistant</span>
            <span className="message-time">Now</span>
          </div>

          {/* Display agent actions */}
          {agentActions.length > 0 && (
            <div className="agent-actions">
              {agentActions.map((action, idx) => (
                <div key={idx} className={`agent-action agent-action-${action.type}`}>
                  {action.type === 'action' && (
                    <div className="action-tool">
                      <span className="action-icon">🔧</span>
                      <strong>{action.tool}</strong>
                      {action.args && (
                        <pre className="action-args">{JSON.stringify(action.args, null, 2)}</pre>
                      )}
                    </div>
                  )}
                  {action.type === 'observation' && (
                    <div className={`observation ${action.success ? 'success' : 'error'}`}>
                      <span className="observation-icon">{action.success ? '✓' : '✗'}</span>
                      <pre className="observation-content">{action.content}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Display streaming message */}
          {streamingMessage && (
            <div className="message-content">
              {streamingMessage}
              <span className="streaming-cursor">▋</span>
            </div>
          )}
        </div>
      )}

      {messages.length === 0 && !isStreaming && (
        <div className="empty-messages">
          <p>No messages yet. Start a conversation!</p>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
