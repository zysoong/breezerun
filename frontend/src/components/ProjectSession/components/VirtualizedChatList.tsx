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

export const VirtualizedChatList = ({ messages, isStreaming, streamEvents = [] }: VirtualizedChatListProps) => {
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  // Auto-scroll to bottom when new message arrives or during streaming
  useEffect(() => {
    if (messages.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: messages.length - 1,
        behavior: isStreaming ? 'auto' : 'smooth',
        align: 'end',
      });
    }
  }, [messages.length, isStreaming]);

  return (
    <Virtuoso
      ref={virtuosoRef}
      data={messages}
      initialTopMostItemIndex={messages.length > 0 ? messages.length - 1 : 0}
      followOutput="auto"
      itemContent={(index, message) => {
        const isLastMessage = index === messages.length - 1;
        const isCurrentlyStreaming = isStreaming && isLastMessage;

        return (
          <MemoizedMessage
            key={message.id}
            message={message}
            isStreaming={isCurrentlyStreaming}
            streamEvents={isCurrentlyStreaming ? streamEvents : []}
          />
        );
      }}
      components={{
        Scroller: CustomScroller,
        EmptyPlaceholder: () => (
          <div className="empty-chat">
            <h3>Start a conversation</h3>
            <p>Ask me anything, and I'll help you with code, data analysis, and more.</p>
          </div>
        ),
      }}
      style={{ height: '100%', width: '100%' }}
    />
  );
};
