# Unified Message Model Refactoring Plan

## Problem Statement

The current implementation has a fundamental architectural issue: **text messages and tool calls are stored/displayed separately**, causing tool call blocks to disappear after page refresh.

### Current Architecture Issues

1. **Dual Data Models**:
   - `Message` table: stores text content, has `created_at`
   - `AgentAction` table: stores tool calls, has `created_at`, linked via `message_id` FK
   - During streaming: tool calls are ephemeral `streamEvents` in frontend memory
   - After streaming: tool calls become `agent_actions` in database

2. **Broken Memoization** (`AssistantUIChatList.tsx:40-47`):
   ```typescript
   // BUG: agent_actions is NOT checked!
   const MemoizedAssistantUIMessage = memo(AssistantUIMessage, (prevProps, nextProps) => {
     return (
       prevProps.message.id === nextProps.message.id &&
       prevProps.message.content === nextProps.message.content &&
       prevProps.isStreaming === nextProps.isStreaming &&
       prevProps.streamEvents?.length === nextProps.streamEvents?.length
       // MISSING: agent_actions comparison!
     );
   });
   ```

3. **Ephemeral vs Persistent Disconnect**:
   - `streamEvents` (ephemeral) → cleared on `'end'` event
   - `agent_actions` (persistent) → loaded from API
   - No unified handling of both

4. **Data Flow Issues**:
   ```
   During Streaming:
   WebSocket → streamEvents → render tool calls ✓

   After Refresh:
   API → messages.agent_actions → should render tool calls ✗ (memoization bug)
   ```

---

## Proposed Solution: Unified Content Block Model

### Core Concept

Replace the current dual model with a **unified content block model** where every item in a conversation is a `ContentBlock` with:
- Unique ID
- Type (text, tool_call, tool_result, image, etc.)
- Content payload
- `created_at` timestamp
- Display order

### New Data Model

```
ChatSession
├── id, name, project_id, etc.
└── content_blocks: ContentBlock[]

ContentBlock (unified entity)
├── id: UUID
├── chat_session_id: FK
├── sequence_number: int (ordering)
├── created_at: timestamp
├── block_type: enum (user_text, assistant_text, tool_call, tool_result, system)
├── author: enum (user, assistant, system, tool)
├── content: JSON
│   ├── For text: { text: string }
│   ├── For tool_call: { tool_name, arguments, status }
│   └── For tool_result: { tool_name, result, success, metadata }
├── parent_block_id: FK (optional, for threading tool_call → tool_result)
└── metadata: JSON (streaming state, etc.)
```

---

## Implementation Phases

### Phase 1: Quick Fix (Immediate)
**Goal**: Fix the memoization bug to restore tool call display after refresh

**Files to change**:
- `frontend/src/components/assistant-ui/AssistantUIChatList.tsx`

**Change**:
```typescript
const MemoizedAssistantUIMessage = memo(AssistantUIMessage, (prevProps, nextProps) => {
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.isStreaming === nextProps.isStreaming &&
    prevProps.streamEvents?.length === nextProps.streamEvents?.length &&
    // ADD: Check agent_actions length and last action ID
    prevProps.message.agent_actions?.length === nextProps.message.agent_actions?.length &&
    prevProps.message.agent_actions?.[0]?.id === nextProps.message.agent_actions?.[0]?.id
  );
});
```

---

### Phase 2: Backend - Unified ContentBlock Model

#### 2.1 Create New Database Model

**New file**: `backend/app/models/database/content_block.py`

```python
class ContentBlockType(str, enum.Enum):
    USER_TEXT = "user_text"
    ASSISTANT_TEXT = "assistant_text"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    SYSTEM = "system"
    IMAGE = "image"  # For future multi-modal support

class ContentBlockAuthor(str, enum.Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"

class ContentBlock(Base):
    __tablename__ = "content_blocks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    chat_session_id = Column(String(36), ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    sequence_number = Column(Integer, nullable=False)  # For ordering
    block_type = Column(Enum(ContentBlockType), nullable=False)
    author = Column(Enum(ContentBlockAuthor), nullable=False)
    content = Column(JSON, nullable=False)
    parent_block_id = Column(String(36), ForeignKey("content_blocks.id"), nullable=True)
    metadata = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    chat_session = relationship("ChatSession", back_populates="content_blocks")
    children = relationship("ContentBlock", backref=backref("parent", remote_side=[id]))
```

#### 2.2 Create Migration Script

**New file**: `backend/migrations/migrate_to_content_blocks.py`

```python
"""
Migration script to convert existing Message + AgentAction data to unified ContentBlock model.

Steps:
1. Create content_blocks table
2. For each Message:
   a. Create USER_TEXT or ASSISTANT_TEXT block
   b. For each AgentAction:
      - Create TOOL_CALL block
      - Create TOOL_RESULT block
3. Maintain correct sequence_number ordering using created_at timestamps
4. Deprecate (but keep) old tables for rollback
"""
```

#### 2.3 Update API Schemas

**File**: `backend/app/models/schemas/content_block.py`

```python
class ContentBlockResponse(BaseModel):
    id: str
    chat_session_id: str
    sequence_number: int
    block_type: ContentBlockType
    author: ContentBlockAuthor
    content: Dict[str, Any]
    parent_block_id: Optional[str] = None
    metadata: Dict[str, Any] = {}
    created_at: datetime

class ContentBlockListResponse(BaseModel):
    blocks: List[ContentBlockResponse]
    total: int
```

#### 2.4 Update Chat API Routes

**File**: `backend/app/api/routes/chat.py`

Add new endpoint:
```python
@router.get("/{session_id}/blocks", response_model=ContentBlockListResponse)
async def list_content_blocks(
    session_id: str,
    skip: int = 0,
    limit: int = 500,
    db: AsyncSession = Depends(get_db),
):
    """List content blocks in a chat session, ordered by sequence_number."""
    query = (
        select(ContentBlock)
        .where(ContentBlock.chat_session_id == session_id)
        .order_by(ContentBlock.sequence_number.asc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(query)
    blocks = result.scalars().all()

    return ContentBlockListResponse(
        blocks=[ContentBlockResponse.model_validate(b) for b in blocks],
        total=len(blocks)
    )
```

#### 2.5 Update WebSocket Handler

**File**: `backend/app/api/websocket/chat_handler.py`

Changes needed:
1. Create `ASSISTANT_TEXT` block on stream start
2. Create `TOOL_CALL` block when tool is invoked (not just tracking ephemeral state)
3. Create `TOOL_RESULT` block when observation received
4. Update `ASSISTANT_TEXT` block incrementally during streaming
5. Use `sequence_number` for proper ordering

Key change - replace ephemeral action tracking:
```python
# OLD: Ephemeral tracking
async def _handle_action(self, event):
    await self._send_event("action", {...})

# NEW: Persistent block creation
async def _handle_action(self, event):
    # Create TOOL_CALL block in database
    tool_call_block = ContentBlock(
        chat_session_id=self.session_id,
        sequence_number=self._get_next_sequence(),
        block_type=ContentBlockType.TOOL_CALL,
        author=ContentBlockAuthor.ASSISTANT,
        content={
            "tool_name": event["tool"],
            "arguments": event["args"],
            "status": "pending"
        },
        metadata={"step": event.get("step")}
    )
    self.db.add(tool_call_block)
    await self.db.commit()

    # Send to WebSocket with block ID
    await self._send_event("tool_call", {
        "block_id": tool_call_block.id,
        "tool": event["tool"],
        "args": event["args"],
    })
```

---

### Phase 3: Frontend - Unified Content Block Handling

#### 3.1 Update TypeScript Types

**File**: `frontend/src/types/index.ts`

```typescript
export type ContentBlockType =
  | 'user_text'
  | 'assistant_text'
  | 'tool_call'
  | 'tool_result'
  | 'system';

export type ContentBlockAuthor = 'user' | 'assistant' | 'system' | 'tool';

export interface ContentBlock {
  id: string;
  chat_session_id: string;
  sequence_number: number;
  block_type: ContentBlockType;
  author: ContentBlockAuthor;
  content: Record<string, any>;
  parent_block_id?: string;
  metadata: Record<string, any>;
  created_at: string;
}

// For streaming, blocks can be partial
export interface StreamingContentBlock extends Partial<ContentBlock> {
  id: string;
  block_type: ContentBlockType;
  isStreaming?: boolean;
}
```

#### 3.2 Update API Service

**File**: `frontend/src/services/api.ts`

```typescript
export const contentBlocksAPI = {
  list: async (sessionId: string): Promise<{ blocks: ContentBlock[]; total: number }> => {
    const response = await api.get(`/chats/${sessionId}/blocks`);
    return response.data;
  },
};
```

#### 3.3 Refactor useOptimizedStreaming Hook

**File**: `frontend/src/components/ProjectSession/hooks/useOptimizedStreaming.ts`

Key changes:
1. Manage `ContentBlock[]` instead of `Message[]` + `StreamEvent[]`
2. WebSocket events create/update blocks instead of ephemeral events
3. Unified state for both streaming and persisted content

```typescript
interface UseOptimizedStreamingProps {
  sessionId: string;
  initialBlocks?: ContentBlock[];
}

export const useOptimizedStreaming = ({ sessionId, initialBlocks = [] }: UseOptimizedStreamingProps) => {
  const [blocks, setBlocks] = useState<ContentBlock[]>(initialBlocks);
  const [streamingBlockId, setStreamingBlockId] = useState<string | null>(null);

  // Buffer for text chunks (still needed for batching)
  const chunkBufferRef = useRef<string>('');

  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
      case 'user_text_block':
        // User message created on server
        setBlocks(prev => [...prev, data.block]);
        break;

      case 'assistant_text_start':
        // New assistant text block started
        setStreamingBlockId(data.block_id);
        setBlocks(prev => [...prev, {
          id: data.block_id,
          chat_session_id: sessionId,
          sequence_number: data.sequence_number,
          block_type: 'assistant_text',
          author: 'assistant',
          content: { text: '' },
          metadata: { streaming: true },
          created_at: new Date().toISOString(),
        }]);
        break;

      case 'chunk':
        // Buffer chunks as before
        chunkBufferRef.current += data.content || '';
        break;

      case 'tool_call_block':
        // Tool call block created - immediately add to blocks
        setBlocks(prev => [...prev, data.block]);
        break;

      case 'tool_result_block':
        // Tool result block created - immediately add to blocks
        setBlocks(prev => [...prev, data.block]);
        break;

      case 'end':
        // Finalize streaming
        setStreamingBlockId(null);
        // Refetch to get final state
        queryClient.invalidateQueries({ queryKey: ['contentBlocks', sessionId] });
        break;
    }
  }, [sessionId, queryClient]);

  // ... rest of hook
};
```

#### 3.4 Refactor Chat List Component

**File**: `frontend/src/components/assistant-ui/AssistantUIChatList.tsx`

```typescript
interface AssistantUIChatListProps {
  blocks: ContentBlock[];
  streamingBlockId?: string | null;
}

export const AssistantUIChatList: React.FC<AssistantUIChatListProps> = ({
  blocks,
  streamingBlockId,
}) => {
  return (
    <Virtuoso
      data={blocks}
      itemContent={(index, block) => (
        <ContentBlockRenderer
          key={block.id}
          block={block}
          isStreaming={block.id === streamingBlockId}
        />
      )}
    />
  );
};
```

#### 3.5 Create ContentBlockRenderer Component

**New file**: `frontend/src/components/assistant-ui/ContentBlockRenderer.tsx`

```typescript
interface ContentBlockRendererProps {
  block: ContentBlock;
  isStreaming?: boolean;
}

export const ContentBlockRenderer: React.FC<ContentBlockRendererProps> = ({
  block,
  isStreaming,
}) => {
  switch (block.block_type) {
    case 'user_text':
      return <UserTextBlock block={block} />;

    case 'assistant_text':
      return <AssistantTextBlock block={block} isStreaming={isStreaming} />;

    case 'tool_call':
      return <ToolCallBlock block={block} />;

    case 'tool_result':
      return <ToolResultBlock block={block} />;

    case 'system':
      return <SystemBlock block={block} />;

    default:
      return null;
  }
};
```

---

### Phase 4: Streaming Events Refactoring

#### 4.1 New WebSocket Event Schema

```typescript
// Server → Client events
type WebSocketEvent =
  | { type: 'user_text_block'; block: ContentBlock }
  | { type: 'assistant_text_start'; block_id: string; sequence_number: number }
  | { type: 'chunk'; content: string }
  | { type: 'assistant_text_end'; block_id: string }
  | { type: 'tool_call_block'; block: ContentBlock }
  | { type: 'tool_call_args_chunk'; block_id: string; partial_args: string }
  | { type: 'tool_result_block'; block: ContentBlock }
  | { type: 'end'; session_id: string }
  | { type: 'error'; message: string }
  | { type: 'heartbeat' };

// Client → Server events
type ClientEvent =
  | { type: 'message'; content: string }
  | { type: 'cancel' };
```

#### 4.2 Real-time Streaming of Tool Args

For streaming tool arguments (like file paths being typed):

```typescript
case 'tool_call_args_chunk':
  // Update existing tool_call block with partial args
  setBlocks(prev => prev.map(block => {
    if (block.id === data.block_id) {
      return {
        ...block,
        content: {
          ...block.content,
          arguments_preview: data.partial_args,
        },
        metadata: {
          ...block.metadata,
          streaming_args: true,
        }
      };
    }
    return block;
  }));
  break;
```

---

### Phase 5: Backward Compatibility & Migration

#### 5.1 Dual API Support

During migration, support both APIs:
- `/chats/{id}/messages` → Legacy API (deprecated)
- `/chats/{id}/blocks` → New unified API

```python
# Add deprecation warning
@router.get("/{session_id}/messages", response_model=MessageListResponse, deprecated=True)
async def list_messages_legacy(...):
    """Legacy endpoint - use /blocks instead."""
    # Convert ContentBlocks back to Message format for compatibility
```

#### 5.2 Feature Flag

```typescript
// frontend/src/config.ts
export const FEATURES = {
  USE_CONTENT_BLOCKS: import.meta.env.VITE_USE_CONTENT_BLOCKS === 'true',
};

// Usage
const { blocks } = FEATURES.USE_CONTENT_BLOCKS
  ? useContentBlocksStreaming({ sessionId })
  : useLegacyStreaming({ sessionId });
```

---

## File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `backend/app/models/database/content_block.py` | New unified model |
| `backend/app/models/schemas/content_block.py` | API schemas |
| `backend/migrations/migrate_to_content_blocks.py` | Data migration |
| `frontend/src/components/assistant-ui/ContentBlockRenderer.tsx` | Block renderer |
| `frontend/src/components/assistant-ui/blocks/*.tsx` | Individual block components |

### Modified Files
| File | Changes |
|------|---------|
| `backend/app/api/routes/chat.py` | Add `/blocks` endpoint |
| `backend/app/api/websocket/chat_handler.py` | Create blocks instead of tracking ephemeral state |
| `backend/app/models/database/__init__.py` | Export ContentBlock |
| `frontend/src/types/index.ts` | Add ContentBlock types |
| `frontend/src/services/api.ts` | Add contentBlocksAPI |
| `frontend/src/components/ProjectSession/hooks/useOptimizedStreaming.ts` | Work with blocks |
| `frontend/src/components/assistant-ui/AssistantUIChatList.tsx` | Render blocks |
| `frontend/src/components/assistant-ui/AssistantUIChatPage.tsx` | Fetch blocks |

---

## Benefits of Unified Model

1. **Single Source of Truth**: All content in one table, properly ordered
2. **Consistent Sorting**: `sequence_number` guarantees display order
3. **No Memoization Bugs**: Block changes trigger re-renders naturally
4. **Simpler State Management**: One array instead of messages + events
5. **Easier Streaming Resumption**: Blocks persist immediately, no ephemeral state to lose
6. **Future-Proof**: Easy to add new block types (images, files, diagrams)
7. **Threading Support**: `parent_block_id` enables conversation branching
8. **Better Debugging**: Every action is persisted with timestamps

---

## Implementation Priority

1. **Immediate**: Phase 1 (memoization fix) - 1-2 hours
2. **Short-term**: Phase 2 (backend model) - 2-3 days
3. **Medium-term**: Phase 3-4 (frontend refactor) - 3-5 days
4. **Completion**: Phase 5 (migration, cleanup) - 1-2 days

**Total estimated effort**: 1-2 weeks for complete refactoring

---

## Risks & Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Keep old tables, run migration in transaction |
| Performance regression | Use sequence_number index, batch block creation |
| Breaking changes for frontend | Feature flag for gradual rollout |
| WebSocket protocol changes | Version the protocol, support both during transition |
