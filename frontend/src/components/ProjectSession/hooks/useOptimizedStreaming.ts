import { useState, useRef, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ContentBlock, StreamEvent } from "@/types";

// Industry standard: 30ms interval = 33 updates/second (ChatGPT-like speed)
const FLUSH_INTERVAL_MS = 30;

interface UseOptimizedStreamingProps {
  sessionId: string;
  initialBlocks?: ContentBlock[];
  onWorkspaceFilesChanged?: () => void;
}

interface UseOptimizedStreamingReturn {
  blocks: ContentBlock[];
  streamEvents: StreamEvent[];
  isStreaming: boolean;
  error: string | null;
  sendMessage: (content: string) => boolean;
  cancelStream: () => void;
  clearError: () => void;
  isWebSocketReady: boolean;
}

// Per-block streaming state
interface BlockStreamState {
  blockId: string;
  bufferedContent: string;
  streaming: boolean;
}

export const useOptimizedStreaming = ({
  sessionId,
  initialBlocks = [],
  onWorkspaceFilesChanged,
}: UseOptimizedStreamingProps): UseOptimizedStreamingReturn => {
  const [blocks, setBlocks] = useState<ContentBlock[]>(initialBlocks);
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();

  // NEW: Per-block stream state map (replaces single ref)
  const streamStatesRef = useRef<Map<string, BlockStreamState>>(new Map());

  // Track active streaming block (for events without block_id - legacy fallback)
  const activeBlockIdRef = useRef<string | null>(null);

  // Buffer for stream events (tool calls, etc.)
  const eventBufferRef = useRef<StreamEvent[]>([]);

  // Optimized: 30ms interval for ChatGPT-like streaming speed
  // Now flushes per-block instead of global buffer
  useEffect(() => {
    if (!isStreaming) return;

    const flushInterval = setInterval(() => {
      // Flush each block's buffered content
      streamStatesRef.current.forEach((state, blockId) => {
        if (state.bufferedContent) {
          setBlocks(prev => {
            const updated = [...prev];
            const targetIndex = updated.findIndex(b => b.id === blockId);

            if (targetIndex !== -1) {
              const currentText = updated[targetIndex].content?.text || '';
              updated[targetIndex] = {
                ...updated[targetIndex],
                content: { text: currentText + state.bufferedContent }
              };
            }

            return updated;
          });

          // Clear this block's buffer after flushing
          state.bufferedContent = '';
        }
      });

      // Flush stream events
      if (eventBufferRef.current.length > 0) {
        const eventsToFlush = [...eventBufferRef.current];
        setStreamEvents(prev => [...prev, ...eventsToFlush]);
        eventBufferRef.current = [];
      }
    }, FLUSH_INTERVAL_MS);

    return () => clearInterval(flushInterval);
  }, [isStreaming]);

  // WebSocket message handler
  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'stream_sync':
        // Server sends full stream state for reconnection
        // Initialize stream state for this block
        streamStatesRef.current.set(data.block_id, {
          blockId: data.block_id,
          bufferedContent: '',
          streaming: true
        });
        activeBlockIdRef.current = data.block_id;

        // IMPORTANT: Set streaming state FIRST so merge logic works correctly
        setIsStreaming(true);
        setError(null);

        // If there's an active tool call, add it to stream events so it displays immediately
        if (data.active_tool_call) {
          const toolCall = data.active_tool_call;

          // Create a synthetic event for the active tool call
          if (toolCall.status === 'streaming') {
            // Tool is still streaming arguments
            setStreamEvents([{
              type: 'action_args_chunk',
              tool: toolCall.tool_name,
              partial_args: toolCall.partial_args,
              step: toolCall.step
            }]);
          } else if (toolCall.status === 'running') {
            // Tool is executing (arguments complete)
            setStreamEvents([{
              type: 'action',
              tool: toolCall.tool_name,
              args: toolCall.partial_args ? JSON.parse(toolCall.partial_args) : {},
              step: toolCall.step
            }]);
          }
        } else {
          // Clear any stale events from previous session
          setStreamEvents([]);
        }
        eventBufferRef.current = [];

        // Update or create the block with synced content (server is source of truth)
        setBlocks(prev => {
          const existingIndex = prev.findIndex(b => b.id === data.block_id);

          if (existingIndex !== -1) {
            // Replace existing block's content with server state
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              content: { text: data.accumulated_content || '' },
              block_metadata: { streaming: true }
            };
            return updated;
          } else {
            // Create new block with synced content
            return [
              ...prev,
              {
                id: data.block_id,
                chat_session_id: sessionId,
                sequence_number: data.sequence_number || 0,
                block_type: 'assistant_text',
                author: 'assistant',
                content: { text: data.accumulated_content || '' },
                block_metadata: { streaming: true },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              } as ContentBlock
            ];
          }
        });

        // Refetch all blocks from API to get tool_call and tool_result blocks
        queryClient.refetchQueries({
          queryKey: ['contentBlocks', sessionId],
          exact: true
        });
        break;

      case 'user_text_block':
        // User message received confirmation from server
        if (data.block) {
          setBlocks(prev => {
            // Find the LATEST temp user block (most recently added)
            const tempBlocks = prev.filter(b => b.id.startsWith('temp-user-'));

            if (tempBlocks.length > 0) {
              // Replace the first temp block (oldest one) since server processes in order
              const tempIndex = prev.findIndex(b => b.id.startsWith('temp-user-'));
              const updated = [...prev];
              updated[tempIndex] = data.block;
              return updated;
            }

            // No temp block found - check if server block already exists
            const existingIndex = prev.findIndex(b => b.id === data.block.id);
            if (existingIndex !== -1) {
              return prev;
            }

            return [...prev, data.block];
          });
        }
        break;

      case 'assistant_text_start':
        // Assistant started streaming
        setIsStreaming(true);
        setError(null);
        setStreamEvents([]);
        eventBufferRef.current = [];

        // Initialize stream state for this block
        streamStatesRef.current.set(data.block_id, {
          blockId: data.block_id,
          bufferedContent: '',
          streaming: true
        });
        activeBlockIdRef.current = data.block_id;

        // Add new assistant_text block
        setBlocks(prev => [
          ...prev,
          {
            id: data.block_id,
            chat_session_id: sessionId,
            sequence_number: data.sequence_number || 0,
            block_type: 'assistant_text',
            author: 'assistant',
            content: { text: '' },
            block_metadata: { streaming: true },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as ContentBlock
        ]);
        break;

      case 'chunk':
        // Text chunk from assistant - NOW WITH BLOCK_ID
        const chunkBlockId = data.block_id || activeBlockIdRef.current;

        if (chunkBlockId) {
          // Get or create stream state for this block
          let state = streamStatesRef.current.get(chunkBlockId);
          if (!state) {
            state = {
              blockId: chunkBlockId,
              bufferedContent: '',
              streaming: true
            };
            streamStatesRef.current.set(chunkBlockId, state);
          }

          // Append to this block's buffer
          state.bufferedContent += data.content || '';
        }
        break;

      case 'action_streaming':
        // Real-time feedback when tool name is first received
        eventBufferRef.current.push({
          type: 'action_streaming',
          content: `Preparing ${data.tool}...`,
          tool: data.tool,
          status: data.status,
          step: data.step,
        });
        break;

      case 'action_args_chunk':
        // Streaming tool arguments
        eventBufferRef.current.push({
          type: 'action_args_chunk',
          content: data.partial_args || '',
          tool: data.tool,
          partial_args: data.partial_args,
          step: data.step,
        });
        break;

      case 'action':
        // Complete tool call
        setStreamEvents(prev =>
          prev.filter(e => !(e.type === 'action_args_chunk' && e.tool === data.tool))
        );
        eventBufferRef.current.push({
          type: 'action',
          content: `Using tool: ${data.tool}`,
          tool: data.tool,
          args: data.args,
          step: data.step,
        });
        break;

      case 'tool_call_block':
        // Tool call block received
        if (data.block) {
          setBlocks(prev => [...prev, data.block]);
          eventBufferRef.current.push({
            type: 'tool_call_block',
            block: data.block,
          });
        }
        break;

      case 'tool_result_block':
        // Tool result block received
        if (data.block) {
          setBlocks(prev => [...prev, data.block]);
          eventBufferRef.current.push({
            type: 'tool_result_block',
            block: data.block,
          });
        }
        break;

      case 'tool_completed':
        // Tool completed - refetch blocks to get the new tool_call and tool_result blocks
        queryClient.refetchQueries({
          queryKey: ['contentBlocks', sessionId],
          exact: true
        });
        break;

      case 'assistant_text_end':
        // Assistant finished streaming
        const endBlockId = data.block_id;

        // Final flush of any remaining content for this block
        if (endBlockId) {
          const state = streamStatesRef.current.get(endBlockId);
          if (state && state.bufferedContent) {
            setBlocks(prev => {
              const updated = [...prev];
              const targetIndex = updated.findIndex(b => b.id === endBlockId);

              if (targetIndex !== -1) {
                const currentText = updated[targetIndex].content?.text || '';
                updated[targetIndex] = {
                  ...updated[targetIndex],
                  content: { text: currentText + state.bufferedContent },
                  block_metadata: { streaming: false }
                };
              }

              return updated;
            });
          }

          // Clear stream state for this block
          streamStatesRef.current.delete(endBlockId);

          // If this was the active block, clear it
          if (activeBlockIdRef.current === endBlockId) {
            activeBlockIdRef.current = null;
          }
        }

        // Flush remaining events
        if (eventBufferRef.current.length > 0) {
          setStreamEvents(prev => [...prev, ...eventBufferRef.current]);
          eventBufferRef.current = [];
        }

        // Check if any blocks are still streaming
        const stillStreaming = Array.from(streamStatesRef.current.values())
          .some(s => s.streaming);

        if (!stillStreaming) {
          // Clear streaming state and events
          setStreamEvents([]);

          // Refetch blocks from API to get persisted version
          // Use a small delay to ensure backend has persisted the final content
          setTimeout(async () => {
            try {
              await queryClient.refetchQueries({
                queryKey: ['contentBlocks', sessionId],
                exact: true
              });
            } catch (err) {
              console.error('[WS] assistant_text_end - Refetch failed:', err);
            }
            // Only clear isStreaming after refetch completes
            setIsStreaming(false);
          }, 100); // 100ms delay to let backend persist
        } else {
          // Other blocks still streaming, just refetch to get updated tool blocks
          queryClient.refetchQueries({
            queryKey: ['contentBlocks', sessionId],
            exact: true
          });
        }
        break;

      case 'end':
        // Legacy end event
        streamStatesRef.current.clear();
        activeBlockIdRef.current = null;
        eventBufferRef.current = [];
        setIsStreaming(false);
        setStreamEvents([]);
        queryClient.invalidateQueries({ queryKey: ['contentBlocks', sessionId] });
        break;

      case 'cancel_acknowledged':
        // Server acknowledged the cancel request - no action needed
        break;

      case 'cancelled':
        // Flush remaining content for all streaming blocks
        streamStatesRef.current.forEach((state, blockId) => {
          if (state.bufferedContent) {
            setBlocks(prev => {
              const updated = [...prev];
              const targetIndex = updated.findIndex(b => b.id === blockId);

              if (targetIndex !== -1) {
                const currentText = updated[targetIndex].content?.text || '';
                updated[targetIndex] = {
                  ...updated[targetIndex],
                  content: { text: currentText + state.bufferedContent },
                  block_metadata: { streaming: false, cancelled: true }
                };
              }

              return updated;
            });
          }
        });

        streamStatesRef.current.clear();
        activeBlockIdRef.current = null;
        eventBufferRef.current = [];
        setIsStreaming(false);
        break;

      case 'error':
        console.error('WebSocket error:', data.content || data.message);
        const errorMessage = data.content || data.message || 'An error occurred';

        if (!errorMessage.includes('No active task found')) {
          setError(errorMessage);
        }

        // Flush any remaining content
        streamStatesRef.current.forEach((state, blockId) => {
          if (state.bufferedContent) {
            setBlocks(prev => {
              const updated = [...prev];
              const targetIndex = updated.findIndex(b => b.id === blockId);

              if (targetIndex !== -1) {
                const currentText = updated[targetIndex].content?.text || '';
                updated[targetIndex] = {
                  ...updated[targetIndex],
                  content: { text: currentText + state.bufferedContent }
                };
              }

              return updated;
            });
          }
        });

        streamStatesRef.current.clear();
        activeBlockIdRef.current = null;
        eventBufferRef.current = [];
        setIsStreaming(false);
        break;

      case 'title_updated':
        queryClient.invalidateQueries({ queryKey: ['chatSessions'] });
        queryClient.invalidateQueries({ queryKey: ['chatSession', sessionId] });
        break;

      case 'heartbeat':
        // Heartbeat message to keep connection alive
        break;

      case 'workspace_files_changed':
        // Workspace files have been modified by a tool
        if (onWorkspaceFilesChanged) {
          onWorkspaceFilesChanged();
        }
        break;

      case 'resuming_stream':
        // Legacy reconnection event (fallback when stream_sync not available)
        setError(null);
        setStreamEvents([]);
        eventBufferRef.current = [];

        const resumedBlockId = data.message_id || 'temp-resumed-' + Date.now();

        // Initialize stream state
        streamStatesRef.current.set(resumedBlockId, {
          blockId: resumedBlockId,
          bufferedContent: '',
          streaming: true
        });
        activeBlockIdRef.current = resumedBlockId;

        setBlocks(prev => {
          const existingBlock = prev.find(b => b.id === data.message_id);
          if (existingBlock) {
            // Mark existing block as streaming again
            return prev.map(b =>
              b.id === data.message_id
                ? { ...b, block_metadata: { ...b.block_metadata, streaming: true } }
                : b
            );
          }

          // Create new block if not found
          return [
            ...prev,
            {
              id: resumedBlockId,
              chat_session_id: sessionId,
              sequence_number: 0,
              block_type: 'assistant_text',
              author: 'assistant',
              content: { text: '' },
              block_metadata: { streaming: true },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as ContentBlock
          ];
        });

        setIsStreaming(true);
        break;

      case 'start':
        // Legacy start event
        setIsStreaming(true);
        setError(null);
        setStreamEvents([]);
        eventBufferRef.current = [];

        const messageId = data.message_id || 'temp-' + Date.now();
        streamStatesRef.current.set(messageId, {
          blockId: messageId,
          bufferedContent: '',
          streaming: true
        });
        activeBlockIdRef.current = messageId;

        setBlocks(prev => [
          ...prev,
          {
            id: messageId,
            chat_session_id: sessionId,
            sequence_number: prev.length,
            block_type: 'assistant_text',
            author: 'assistant',
            content: { text: '' },
            block_metadata: { streaming: true },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          } as ContentBlock
        ]);
        break;

      case 'observation':
        // Legacy observation event
        eventBufferRef.current.push({
          type: 'tool_result_block',
          content: data.content,
          success: data.success,
          metadata: data.metadata,
          step: data.step,
        });
        break;

      default:
        // Unknown message type - silently ignore
        break;
    }
  }, [sessionId, queryClient, onWorkspaceFilesChanged]);

  // WebSocket connection setup
  useEffect(() => {
    if (!sessionId) return;

    const ws = new WebSocket(`ws://127.0.0.1:8000/api/v1/chats/${sessionId}/stream`);
    wsRef.current = ws;

    ws.onopen = () => {
      // WebSocket connected
    };

    ws.onmessage = handleWebSocketMessage;

    ws.onerror = () => {
      setIsStreaming(false);
      setError('Connection error occurred');
    };

    ws.onclose = () => {
      setIsStreaming(false);
    };

    return () => {
      ws.close();
    };
  }, [sessionId, handleWebSocketMessage]);

  // Update blocks when external data changes
  // Smart merge: preserve streaming blocks' content while adding new blocks (like tool blocks)
  useEffect(() => {
    if (initialBlocks && initialBlocks.length > 0) {
      setBlocks(prev => {
        // Check for temp user blocks that haven't been confirmed by server yet
        const tempUserBlocks = prev.filter(b => b.id.startsWith('temp-user-'));

        // If not streaming, use initialBlocks but preserve any temp user blocks
        if (!isStreaming) {
          if (tempUserBlocks.length > 0) {
            // Merge: initialBlocks + temp user blocks (sorted by sequence)
            const merged = [...initialBlocks, ...tempUserBlocks];
            merged.sort((a, b) => a.sequence_number - b.sequence_number);
            return merged;
          }
          return initialBlocks;
        }

        // During streaming, merge intelligently:
        // - Keep streaming blocks' content if it has MORE content than API (more up-to-date)
        // - If streaming block is empty or has less content, prefer API content but mark as streaming
        // - Add any blocks from initialBlocks we don't have (like tool_call, tool_result)
        const streamingBlockIds = new Set(
          Array.from(streamStatesRef.current.keys())
        );

        const mergedBlocks: ContentBlock[] = [];
        const seenIds = new Set<string>();

        // Build a map of API content for comparison
        const apiBlockMap = new Map(initialBlocks.map(b => [b.id, b]));

        // First pass: handle streaming blocks - compare with API content
        for (const block of prev) {
          if (streamingBlockIds.has(block.id)) {
            const streamingContent = block.content?.text || '';
            const apiBlock = apiBlockMap.get(block.id);
            const apiContent = apiBlock?.content?.text || '';

            // Use streaming content only if it has MORE content than API (fresher data)
            if (streamingContent.length > apiContent.length) {
              mergedBlocks.push(block);
              seenIds.add(block.id);
            }
            // Otherwise, don't add to seenIds so API content will be used
          }
        }

        // Second pass: add all blocks from initialBlocks that we don't have
        for (const block of initialBlocks) {
          if (!seenIds.has(block.id)) {
            // If this is the streaming block (using API content case), mark it as streaming
            if (streamingBlockIds.has(block.id)) {
              mergedBlocks.push({
                ...block,
                block_metadata: { ...block.block_metadata, streaming: true }
              });
            } else {
              mergedBlocks.push(block);
            }
            seenIds.add(block.id);
          }
        }

        // Third pass: preserve ALL local blocks that aren't in initialBlocks
        for (const block of prev) {
          if (!seenIds.has(block.id) && !apiBlockMap.has(block.id)) {
            mergedBlocks.push(block);
            seenIds.add(block.id);
          }
        }

        // Sort by sequence_number
        mergedBlocks.sort((a, b) => a.sequence_number - b.sequence_number);

        return mergedBlocks;
      });
    }
  }, [initialBlocks, isStreaming]);

  // Send message via WebSocket
  const sendMessage = useCallback((content: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return false;
    }

    if (!content.trim()) {
      return false;
    }

    const tempId = 'temp-user-' + Date.now();

    // Add temp user block to local state immediately
    setBlocks(prev => {
      // Compute max sequence number from current blocks
      const maxSeq = prev.reduce((max, b) => Math.max(max, b.sequence_number), -1);
      const newSeqNum = maxSeq + 1;

      const tempUserBlock: ContentBlock = {
        id: tempId,
        chat_session_id: sessionId,
        sequence_number: newSeqNum,
        block_type: 'user_text',
        author: 'user',
        content: { text: content },
        block_metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return [...prev, tempUserBlock];
    });

    // Send via WebSocket
    wsRef.current.send(JSON.stringify({
      type: 'message',
      content,
    }));

    return true;
  }, [sessionId]);

  // Cancel streaming
  const cancelStream = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel' }));
    }
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    blocks,
    streamEvents,
    isStreaming,
    error,
    sendMessage,
    cancelStream,
    clearError,
    isWebSocketReady: wsRef.current?.readyState === WebSocket.OPEN,
  };
};
