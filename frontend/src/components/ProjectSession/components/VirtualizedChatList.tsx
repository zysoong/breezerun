import { useRef, useEffect, forwardRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { MemoizedMessage } from './MemoizedMessage';
import { Message, StreamEvent } from '../hooks/useOptimizedStreaming';

interface VirtualizedChatListProps {
  messages: Message[];
  isStreaming: boolean;
  streamEvents?: StreamEvent[];
}

// Fix: Scroller component needs forwardRef for Virtuoso compatibility
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

// Item wrapper to center and constrain message width (matching old layout concept)
const ItemWrapper = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    maxWidth: '48rem',
    margin: '0 auto',
    padding: '0 24px',
    width: '100%'
  }}>
    {children}
  </div>
);

export const VirtualizedChatList = ({ messages, isStreaming, streamEvents = [] }: VirtualizedChatListProps) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Auto-scroll to bottom when new message arrives OR during streaming (always enabled now)
  useEffect(() => {
    if (messages.length > 0) {
      // Use setTimeout to ensure DOM has updated with new streaming content
      const timeoutId = setTimeout(() => {
        if (virtuosoRef.current) {
          // Scroll to absolute bottom using large number
          virtuosoRef.current.scrollTo({
            top: 999999999,
            behavior: isStreaming ? 'auto' : 'smooth',
          });
        }
      }, isStreaming ? 0 : 10);

      return () => clearTimeout(timeoutId);
    }
  }, [messages.length, isStreaming, streamEvents]);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <Virtuoso
        ref={virtuosoRef}
        data={messages}
        initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
        itemContent={(index, message) => {
          const isLastMessage = index === messages.length - 1;
          const isCurrentlyStreaming = isStreaming && isLastMessage;

          return (
            <ItemWrapper>
              <MemoizedMessage
                key={message.id}
                message={message}
                isStreaming={isCurrentlyStreaming}
                streamEvents={isCurrentlyStreaming ? streamEvents : []}
              />
            </ItemWrapper>
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
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
};
