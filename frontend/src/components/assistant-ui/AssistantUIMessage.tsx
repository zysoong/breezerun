/**
 * AssistantUIMessage - Message component with ContentBlock support
 *
 * This component renders ContentBlocks with proper streaming and tool call handling.
 * Uses sequence_number from blocks for ordering, overlays streaming state on top.
 *
 * Performance optimizations:
 * - React.memo with custom comparison to prevent unnecessary re-renders
 * - Memoized markdown components to avoid recreating on each render
 * - Lazy syntax highlighting for large code blocks (>500 lines)
 * - Separate useMemo for streaming vs non-streaming content
 */

import React, { useMemo, useState, useEffect, useCallback, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { DefaultToolFallback } from './DefaultToolFallback';
import { ToolStepGroup } from './ToolStepGroup';
import { ContentBlock, StreamEvent } from '@/types';

import type { ToolCallMessagePartStatus } from '@assistant-ui/react';

// Threshold for lazy-loading syntax highlighting (in lines)
const LAZY_HIGHLIGHT_THRESHOLD = 100;

// Threshold for grouping tools into steps (if more than this many tool calls, group them)
const STEP_GROUPING_THRESHOLD = 3;

// Simple streaming text component
const StreamingText: React.FC<{ content: string }> = ({ content }) => {
  const renderContent = () => {
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part, index) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const codeContent = part.slice(3, -3);
        const firstNewline = codeContent.indexOf('\n');
        const language = firstNewline > 0 ? codeContent.slice(0, firstNewline) : '';
        const code = firstNewline > 0 ? codeContent.slice(firstNewline + 1) : codeContent;

        return (
          <pre key={index} style={{
            backgroundColor: '#f6f8fa',
            padding: '12px',
            borderRadius: '6px',
            overflowX: 'auto',
            margin: '12px 0',
            fontSize: '13px',
            fontFamily: 'Monaco, Consolas, monospace'
          }}>
            <code>{code || language}</code>
          </pre>
        );
      } else {
        const formatted = part
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/`([^`]+)`/g, '<code style="background: #f6f8fa; padding: 2px 4px; border-radius: 3px;">$1</code>')
          .replace(/\n/g, '<br />');

        return (
          <span
            key={index}
            dangerouslySetInnerHTML={{ __html: formatted }}
          />
        );
      }
    });
  };

  return (
    <div style={{ position: 'relative' }}>
      {renderContent()}
      <span style={{
        display: 'inline-block',
        width: '8px',
        height: '20px',
        backgroundColor: '#111827',
        marginLeft: '2px',
        animation: 'blink 1s infinite',
      }} />
    </div>
  );
};

/**
 * LazyCodeBlock - Defers syntax highlighting for large code blocks
 * Shows plain code immediately, applies highlighting after a delay
 */
const LazyCodeBlock: React.FC<{
  code: string;
  language: string;
}> = memo(({ code, language }) => {
  const lineCount = code.split('\n').length;
  const isLargeBlock = lineCount > LAZY_HIGHLIGHT_THRESHOLD;
  const [isHighlighted, setIsHighlighted] = useState(!isLargeBlock);

  useEffect(() => {
    if (isLargeBlock && !isHighlighted) {
      // Defer highlighting to next idle period
      const hasIdleCallback = typeof window !== 'undefined' && 'requestIdleCallback' in window;

      if (hasIdleCallback) {
        const idleId = window.requestIdleCallback(() => setIsHighlighted(true), { timeout: 1000 });
        return () => window.cancelIdleCallback(idleId);
      } else {
        const timeoutId = setTimeout(() => setIsHighlighted(true), 100);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [isLargeBlock, isHighlighted]);

  // For very large blocks (>1000 lines), never highlight - too expensive
  if (lineCount > 1000) {
    return (
      <pre style={{
        backgroundColor: '#fafafa',
        padding: '12px',
        borderRadius: '6px',
        border: '1px solid #e5e7eb',
        margin: '12px 0',
        fontSize: '13px',
        fontFamily: 'Monaco, Consolas, "Courier New", monospace',
        overflowX: 'auto',
        whiteSpace: 'pre',
        lineHeight: '1.5',
      }}>
        <code>{code}</code>
      </pre>
    );
  }

  if (!isHighlighted) {
    // Show plain code while waiting for highlighting
    return (
      <pre style={{
        backgroundColor: '#fafafa',
        padding: '12px',
        borderRadius: '6px',
        border: '1px solid #e5e7eb',
        margin: '12px 0',
        fontSize: '13px',
        fontFamily: 'Monaco, Consolas, "Courier New", monospace',
        overflowX: 'auto',
        whiteSpace: 'pre',
        lineHeight: '1.5',
      }}>
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <SyntaxHighlighter
      style={oneLight as any}
      language={language}
      PreTag="div"
      customStyle={{
        margin: '12px 0',
        borderRadius: '6px',
        border: '1px solid #e5e7eb',
        fontSize: '13px',
      }}
    >
      {code}
    </SyntaxHighlighter>
  );
});
LazyCodeBlock.displayName = 'LazyCodeBlock';

/**
 * Memoized markdown components - prevents recreation on each render
 */
const createMarkdownComponents = () => ({
  img({ src, alt, ...props }: any) {
    return (
      <img
        src={src}
        alt={alt || 'Image'}
        style={{
          maxWidth: '100%',
          height: 'auto',
          borderRadius: '8px',
          display: 'block',
          margin: '12px 0',
        }}
        {...props}
      />
    );
  },
  code({ className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const isInline = !props.node || props.node.position?.start.line === props.node.position?.end.line;
    const code = String(children).replace(/\n$/, '');

    return !isInline && language ? (
      <LazyCodeBlock code={code} language={language} />
    ) : (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }
});

// Create once at module level - never recreated
const markdownComponents = createMarkdownComponents();

interface AssistantUIMessageProps {
  block: ContentBlock;
  textBlocks?: ContentBlock[];  // All text blocks in this response (for multi-block support)
  toolBlocks?: ContentBlock[];
  isStreaming?: boolean;
  streamEvents?: StreamEvent[];
}

/**
 * Custom comparison function for React.memo
 * Only memoize NON-streaming messages. Streaming messages always re-render.
 * This prevents expensive re-renders of completed messages with large code blocks.
 */
const arePropsEqual = (
  prevProps: AssistantUIMessageProps,
  nextProps: AssistantUIMessageProps
): boolean => {
  // ALWAYS re-render streaming messages - they need live updates
  if (nextProps.isStreaming || prevProps.isStreaming) {
    return false;
  }

  // For non-streaming messages, compare block IDs and content
  // Compare main block
  if (prevProps.block.id !== nextProps.block.id) return false;
  if (prevProps.block.content?.text !== nextProps.block.content?.text) return false;

  // Compare text blocks count
  if (prevProps.textBlocks?.length !== nextProps.textBlocks?.length) return false;

  // Compare tool blocks count
  if (prevProps.toolBlocks?.length !== nextProps.toolBlocks?.length) return false;

  // Check if any tool results changed (new results added)
  const prevToolResults = prevProps.toolBlocks?.filter(b => b.block_type === 'tool_result').length || 0;
  const nextToolResults = nextProps.toolBlocks?.filter(b => b.block_type === 'tool_result').length || 0;
  if (prevToolResults !== nextToolResults) return false;

  return true;
};

const AssistantUIMessageInner: React.FC<AssistantUIMessageProps> = ({
  block,
  textBlocks = [],
  toolBlocks = [],
  isStreaming = false,
  streamEvents = [],
}) => {
  const role = block.block_type === 'user_text' ? 'user' : 'assistant';

  // Use textBlocks if provided, otherwise fall back to single block
  const allTextBlocks = textBlocks.length > 0 ? textBlocks : [block];

  // For user messages, just use the block content directly
  const userTextContent = role === 'user' ? (block.content?.text || '') : '';

  // Build message parts with proper interleaving based on sequence_number
  const { messageParts } = useMemo(() => {
    const parts: any[] = [];

    // For user messages, just return a single text part
    if (role === 'user') {
      if (userTextContent) {
        parts.push({
          type: 'text',
          content: userTextContent,
          isStreaming: false,
          sequenceNumber: block.sequence_number,
        });
      }
      return { messageParts: parts, streamingToolParts: [] };
    }

    // Step 1: Build streaming state from events
    const streamingToolState = new Map<string, {
      toolName: string;
      argsText: string;
      args: any;
      status: string;
      result?: any;
      isError?: boolean;
      step: number;
    }>();

    let streamingText = '';

    if (streamEvents.length > 0) {
      for (const event of streamEvents) {
        if (event.type === 'chunk') {
          streamingText += event.content || '';
        } else if (event.type === 'action_streaming') {
          const key = `${event.tool}-${event.step || 0}`;
          streamingToolState.set(key, {
            toolName: event.tool || 'unknown',
            argsText: '',
            args: {},
            status: 'streaming',
            step: event.step || 0,
          });
        } else if (event.type === 'action_args_chunk') {
          const key = `${event.tool}-${event.step || 0}`;
          const argsString = event.partial_args || event.content || '';
          let parsedArgs = {};
          try {
            if (argsString) parsedArgs = JSON.parse(argsString);
          } catch { /* Incomplete JSON */ }

          streamingToolState.set(key, {
            toolName: event.tool || 'unknown',
            argsText: argsString,
            args: parsedArgs,
            status: 'streaming',
            step: event.step || 0,
          });
        } else if (event.type === 'action') {
          const key = `${event.tool}-${event.step || 0}`;
          streamingToolState.set(key, {
            toolName: event.tool || 'unknown',
            argsText: JSON.stringify(event.args || {}, null, 2),
            args: event.args || {},
            status: 'running',
            step: event.step || 0,
          });
        } else if (event.type === 'tool_call_block' && event.block) {
          const blockContent = event.block.content as any;
          const toolName = blockContent.tool_name || 'unknown';
          const toolNameLower = toolName.toLowerCase();
          for (const [k] of streamingToolState) {
            if (k.toLowerCase().startsWith(toolNameLower + '-')) {
              streamingToolState.delete(k);
              break;
            }
          }
        }
      }
    }

    // Step 2: Build tool results map
    const toolResultsById = new Map<string, ContentBlock>();
    for (const b of toolBlocks) {
      if (b.block_type === 'tool_result' && b.parent_block_id) {
        toolResultsById.set(b.parent_block_id, b);
      }
    }

    // Step 3: Create a unified list of all parts with sequence numbers
    interface SequencedPart {
      type: 'text' | 'tool-call';
      sequenceNumber: number;
      data: any;
    }
    const sequencedParts: SequencedPart[] = [];

    // Add text blocks as parts
    const assistantTextBlocks = allTextBlocks.filter(
      b => b.block_type === 'assistant_text' || b.block_type === 'system'
    );

    for (const textBlock of assistantTextBlocks) {
      const text = textBlock.content?.text || '';
      // Always add text blocks - even if empty during streaming, the streaming text will be appended
      sequencedParts.push({
        type: 'text',
        sequenceNumber: textBlock.sequence_number,
        data: {
          blockId: textBlock.id,
          content: text,
          isStreaming: false, // Will be updated for the last block if streaming
        },
      });
    }

    // Add tool calls as parts
    for (const b of toolBlocks) {
      if (b.block_type === 'tool_call') {
        const callContent = b.content as any;
        const result = toolResultsById.get(b.id);
        const resultContent = result?.content as any;
        const resultMetadata = result?.block_metadata as any;

        let resultValue: any = resultContent?.result || resultContent?.error;
        const isBinary = resultContent?.is_binary || resultMetadata?.is_binary;
        const binaryData = resultContent?.binary_data || resultMetadata?.image_data;
        const binaryType = resultContent?.binary_type || resultMetadata?.type;

        if (isBinary && binaryData) {
          resultValue = {
            is_binary: true,
            type: 'image',
            image_data: binaryData,
            binary_type: binaryType,
            text: resultContent?.result || '',
          };
        }

        // Check for streaming version
        const toolNameLower = (callContent.tool_name || '').toLowerCase();
        let streamingVersion = null;
        let streamingKey = null;
        for (const [key, state] of streamingToolState) {
          if (key.toLowerCase().startsWith(toolNameLower + '-')) {
            streamingVersion = state;
            streamingKey = key;
            break;
          }
        }

        if (streamingVersion && !result) {
          sequencedParts.push({
            type: 'tool-call',
            sequenceNumber: b.sequence_number,
            data: {
              toolCallId: b.id,
              toolName: callContent.tool_name || 'unknown',
              args: streamingVersion.args,
              argsText: streamingVersion.argsText,
              status: { type: 'running' } as ToolCallMessagePartStatus,
              addResult: () => {},
              resume: () => {},
            },
          });
          if (streamingKey) streamingToolState.delete(streamingKey);
        } else {
          sequencedParts.push({
            type: 'tool-call',
            sequenceNumber: b.sequence_number,
            data: {
              toolCallId: b.id,
              toolName: callContent.tool_name || 'unknown',
              args: callContent.arguments || {},
              argsText: JSON.stringify(callContent.arguments || {}, null, 2),
              result: resultValue,
              isError: resultContent ? !resultContent.success : false,
              status: { type: result ? 'complete' : 'running' } as ToolCallMessagePartStatus,
              addResult: () => {},
              resume: () => {},
            },
          });
        }
      }
    }

    // Step 4: Sort all parts by sequence_number
    sequencedParts.sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    // Step 5: Handle streaming text - append to the last text block or create new
    if (isStreaming && streamingText) {
      // Find the last text part and append streaming text to it
      const lastTextPartIndex = sequencedParts.map(p => p.type).lastIndexOf('text');
      if (lastTextPartIndex >= 0) {
        sequencedParts[lastTextPartIndex].data.content += streamingText;
        sequencedParts[lastTextPartIndex].data.isStreaming = true;
      } else if (sequencedParts.length === 0) {
        // No parts yet, create a streaming text part
        sequencedParts.push({
          type: 'text',
          sequenceNumber: 0,
          data: {
            blockId: 'streaming',
            content: streamingText,
            isStreaming: true,
          },
        });
      }
    } else if (isStreaming && sequencedParts.length === 0) {
      // Streaming but no content yet - show empty streaming indicator
      sequencedParts.push({
        type: 'text',
        sequenceNumber: 0,
        data: {
          blockId: 'streaming',
          content: '',
          isStreaming: true,
        },
      });
    }

    // Mark the last text block as streaming if we're still streaming
    if (isStreaming && streamEvents.length > 0) {
      const lastTextPartIndex = sequencedParts.map(p => p.type).lastIndexOf('text');
      if (lastTextPartIndex >= 0) {
        sequencedParts[lastTextPartIndex].data.isStreaming = true;
      }
    }

    // Step 6: Add any remaining streaming-only tools (not yet persisted)
    const maxSeq = sequencedParts.length > 0
      ? Math.max(...sequencedParts.map(p => p.sequenceNumber))
      : 0;

    let streamingSeq = maxSeq + 1;
    for (const [key, state] of streamingToolState) {
      sequencedParts.push({
        type: 'tool-call',
        sequenceNumber: streamingSeq++,
        data: {
          toolCallId: `streaming-${key}`,
          toolName: state.toolName,
          args: state.args,
          argsText: state.argsText,
          result: state.result,
          isError: state.isError,
          status: { type: state.status === 'complete' ? 'complete' : 'running' } as ToolCallMessagePartStatus,
          addResult: () => {},
          resume: () => {},
        },
      });
    }

    // Step 7: Convert to final parts format (preserving sequenceNumber for ordering)
    for (const sp of sequencedParts) {
      if (sp.type === 'text') {
        parts.push({
          type: 'text',
          content: sp.data.content,
          isStreaming: sp.data.isStreaming,
          sequenceNumber: sp.sequenceNumber,
        });
      } else {
        parts.push({
          type: 'tool-call',
          ...sp.data,
          sequenceNumber: sp.sequenceNumber,
        });
      }
    }

    // Extract streaming-only tool parts for step grouping
    const streamingToolParts = parts.filter(p =>
      p.type === 'tool-call' && p.toolCallId?.startsWith('streaming-')
    );

    return { messageParts: parts, streamingToolParts };
  }, [block.id, block.sequence_number, allTextBlocks, toolBlocks, isStreaming, streamEvents, role, userTextContent]);

  // Count tool call parts for determining if we should use step grouping
  const toolCallCount = useMemo(() => {
    return toolBlocks.filter(b => b.block_type === 'tool_call').length;
  }, [toolBlocks]);

  // Use step grouping if we have many tool calls
  const useStepGrouping = toolCallCount > STEP_GROUPING_THRESHOLD;

  const renderPart = useCallback((part: any, index: number) => {
    if (part.type === 'text') {
      if (part.isStreaming) {
        return <StreamingText key={index} content={part.content} />;
      } else {
        return (
          <ReactMarkdown
            key={index}
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {part.content}
          </ReactMarkdown>
        );
      }
    } else if (part.type === 'tool-call') {
      // If using step grouping, tools are rendered separately
      if (useStepGrouping) return null;
      return <DefaultToolFallback key={part.toolCallId || index} {...part} />;
    }
    return null;
  }, [useStepGrouping]);

  // For step grouping, we need to group consecutive tool calls into ToolStepGroup components
  // while preserving text block positions in the sequence
  const renderPartsWithStepGrouping = () => {
    const result: React.ReactNode[] = [];
    let currentToolGroup: any[] = [];
    let toolGroupStartIndex = 0;

    const flushToolGroup = () => {
      if (currentToolGroup.length > 0) {
        // Only use ToolStepGroup if we have enough tools to warrant it
        if (currentToolGroup.length > 2) {
          // Get the tool blocks for this group (both tool_call and their tool_result blocks)
          const toolCallIds = new Set(currentToolGroup.map(p => p.toolCallId));
          const groupToolBlocks = toolBlocks.filter(b =>
            toolCallIds.has(b.id) ||  // Include tool_call blocks
            (b.block_type === 'tool_result' && b.parent_block_id && toolCallIds.has(b.parent_block_id))  // Include tool_result blocks
          );
          result.push(
            <ToolStepGroup
              key={`tool-group-${toolGroupStartIndex}`}
              toolBlocks={groupToolBlocks}
              streamingTools={currentToolGroup.filter(p => p.toolCallId?.startsWith('streaming-'))}
              isStreaming={isStreaming}
            />
          );
        } else {
          // Render individual tools
          currentToolGroup.forEach((part, i) => {
            result.push(
              <DefaultToolFallback key={part.toolCallId || `tool-${toolGroupStartIndex}-${i}`} {...part} />
            );
          });
        }
        currentToolGroup = [];
      }
    };

    messageParts.forEach((part, index) => {
      if (part.type === 'text') {
        // Flush any pending tool group before rendering text
        flushToolGroup();
        result.push(renderPart(part, index));
      } else if (part.type === 'tool-call') {
        if (currentToolGroup.length === 0) {
          toolGroupStartIndex = index;
        }
        currentToolGroup.push(part);
      }
    });

    // Flush any remaining tool group
    flushToolGroup();

    return result;
  };

  return (
    <div className={`message-wrapper ${role}`}>
      <div className="message-content">
        <div className="message-role">
          {role === 'user' ? (
            <div className="avatar user-avatar">You</div>
          ) : (
            <div className="avatar assistant-avatar">AI</div>
          )}
        </div>
        <div className="message-text">
          <div className="message-body">
            {useStepGrouping ? (
              /* Render parts in sequence, grouping consecutive tools */
              renderPartsWithStepGrouping()
            ) : (
              /* Render all parts inline in sequence order (text + individual tools) */
              messageParts.map((part, index) => renderPart(part, index))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Export memoized version with custom comparison
export const AssistantUIMessage = memo(AssistantUIMessageInner, arePropsEqual);
