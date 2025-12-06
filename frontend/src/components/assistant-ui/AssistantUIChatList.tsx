/**
 * AssistantUIChatList - Virtualized chat list using assistant-ui components
 *
 * This component provides virtualized rendering with assistant-ui message components
 * for optimal performance with large message histories.
 *
 * Uses Virtuoso's built-in followOutput behavior for smooth auto-scrolling:
 * - followOutput="smooth" handles new content scrolling automatically
 * - atBottomStateChange tracks when user scrolls away from bottom
 * - No manual scroll effects needed - let Virtuoso handle it
 */

import { useRef, forwardRef, memo, useCallback } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { AssistantUIMessage } from './AssistantUIMessage';
import './AssistantUIChat.css';
import {Message, StreamEvent} from "@/types";

interface AssistantUIChatListProps {
  messages: Message[];
  isStreaming: boolean;
  streamEvents?: StreamEvent[];
}

// Custom scroller with thin scrollbar
const CustomScroller = forwardRef<HTMLDivElement, any>(({ style, ...props }, ref) => (
  <div
    ref={ref}
    {...props}
    style={{
      ...style,
      scrollbarWidth: 'thin',
      scrollbarColor: '#cbd5e0 transparent',
    }}
  />
));
CustomScroller.displayName = 'CustomScroller';

// Memoized message component for performance
const MemoizedAssistantUIMessage = memo(AssistantUIMessage, (prevProps, nextProps) => {
  // Only re-render if essential properties change
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.streamEvents?.length === nextProps.streamEvents?.length
  );
});

export const AssistantUIChatList: React.FC<AssistantUIChatListProps> = ({
  messages,
  isStreaming,
  streamEvents = [],
}) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // followOutput as a function - Virtuoso calls this when new items are added
  // Returns 'smooth' to auto-scroll, or false to stay in place
  // This is Virtuoso's recommended approach for auto-scroll behavior
  const handleFollowOutput = useCallback((isAtBottom: boolean) => {
    // During streaming, use 'auto' for instant scroll (no animation delay)
    // Otherwise use 'smooth' for nice animation when new messages arrive
    if (isAtBottom) {
      return isStreaming ? 'auto' : 'smooth';
    }
    return false;
  }, [isStreaming]);

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
        followOutput={handleFollowOutput}
        atBottomThreshold={100}
        itemContent={(index, message) => {
          const isLastMessage = index === messages.length - 1;
          const isCurrentlyStreaming = isStreaming && isLastMessage;

          return (
            <MemoizedAssistantUIMessage
              key={message.id}
              message={message}
              isStreaming={isCurrentlyStreaming}
              streamEvents={isCurrentlyStreaming ? streamEvents : []}
            />
          );
        }}
        components={{
          Scroller: CustomScroller,
          Footer: () => <div style={{ height: '80px' }} />,
          EmptyPlaceholder: () => (
            <div className="empty-chat">
              <h3>Start a conversation</h3>
              <p>Ask me anything, and I'll help you with code, data analysis, and more.</p>
            </div>
          ),
        }}
        style={{ height: '100%' }}
      />
    </div>
  );
};