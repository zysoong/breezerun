# Assistant-UI Integration Plan for OpenCodex Chat Session

## Executive Summary

This document provides a comprehensive review of OpenCodex's current chat session UX features and a detailed plan to integrate assistant-ui (YC W25), a production-ready React component library for AI chat interfaces. The integration will modernize the chat experience while maintaining all existing functionality and improving performance.

---

## Part 1: Current UX Features Review

### Core Strengths of Current Implementation

#### 1. **High-Performance Streaming (⭐ Keep Enhanced)**
- **Current**: Custom 30ms batching with 33 updates/second
- **Strength**: Achieves ChatGPT-like streaming speed
- **Performance**: 30x faster tab switching, 80% memory reduction

#### 2. **Virtual Scrolling (⭐ Keep Optimized)**
- **Current**: React-Virtuoso with MemoizedMessage
- **Strength**: Handles thousands of messages at 60 FPS
- **Optimization**: Custom comparison prevents re-renders

#### 3. **Rich Agent Actions Visualization (⭐ Unique Feature)**
- **Current**: Detailed tool execution display with real-time args streaming
- **Strength**: Shows tool preparation, arguments building, and results
- **Special**: File write previews with syntax highlighting

#### 4. **Sandbox Controls (⭐ Unique Feature)**
- **Current**: Integrated Docker container management
- **Strength**: Start/stop/reset controls with live status
- **Command Execution**: Direct command input with result display

#### 5. **Project-Based Architecture (⭐ Keep Structure)**
- **Current**: Multi-session management per project
- **Strength**: Organized workflow with file management
- **Navigation**: Tab-based session switching

### Areas for Enhancement

#### 1. **Message Editing & Branching (🔄 Upgrade Needed)**
- **Current**: No edit capability after sending
- **Opportunity**: Add branching conversations

#### 2. **Attachment Handling (🔄 Basic Implementation)**
- **Current**: File upload exists but not inline with messages
- **Opportunity**: Inline image/file attachments in composer

#### 3. **UI Consistency (🔄 Custom Components)**
- **Current**: Custom-built components with varying styles
- **Opportunity**: Unified component library with shadcn/ui

#### 4. **Mobile Responsiveness (🔄 Limited)**
- **Current**: Basic responsive design
- **Opportunity**: Mobile-first approach with touch optimization

---

## Part 2: Assistant-UI Capabilities Analysis

### Core Components to Leverage

#### 1. **Thread Component**
- Main conversation container with viewport
- Built-in auto-scroll and accessibility
- Supports message history and threading

#### 2. **Composer Component**
- Advanced input with attachment support
- Keyboard shortcuts built-in
- Multi-line support with proper handling

#### 3. **MessagePrimitive**
- Flexible message rendering
- Built-in markdown and code highlighting
- Support for editing and branching

#### 4. **ActionBar**
- Copy, edit, regenerate controls
- Customizable per message type

#### 5. **Tool Fallback UI**
- Automatic rendering of function calls
- Collapsible tool results
- JSON visualization

### Integration Benefits

1. **Reduced Maintenance**: 400k+ monthly downloads, battle-tested
2. **Better Accessibility**: Built-in a11y support
3. **Consistent UX**: ChatGPT-style interface familiar to users
4. **Future-Proof**: Active development with YC backing
5. **Provider Flexibility**: Works with any LLM backend

---

## Part 3: Detailed Integration Plan

### Phase 1: Foundation Setup (Week 1)

#### 1.1 Install Assistant-UI Dependencies
```bash
cd frontend
npx assistant-ui@latest init
npm install @assistant-ui/react @assistant-ui/react-ai-sdk
```

#### 1.2 Setup Tailwind & shadcn/ui
```bash
# Configure Tailwind if not present
npx tailwindcss init -p
# Install shadcn/ui components
npx shadcn-ui@latest init
```

#### 1.3 Create Integration Layer
```typescript
// src/lib/assistant-ui/runtime.ts
import { createCustomRuntime } from '@assistant-ui/react';

export const runtime = createCustomRuntime({
  // Map OpenCodex WebSocket to assistant-ui protocol
  streamAdapter: new OpenCodexStreamAdapter(),
  // Handle tool execution
  toolExecutor: new OpenCodexToolExecutor()
});
```

### Phase 2: Core Chat Interface (Week 2)

#### 2.1 Replace ChatSessionPage Components

**Before (Current Implementation):**
```typescript
// ChatSessionPage.tsx
<VirtualizedChatList messages={messages} />
<MessageInput onSend={handleSend} />
```

**After (Assistant-UI Integration):**
```typescript
// ChatSessionPage.tsx
import { Thread } from '@assistant-ui/react';

<Thread
  runtime={runtime}
  onNewMessage={handleNewMessage}
  tools={openCodexTools}
>
  <Thread.Viewport>
    <Thread.Messages />
    <Thread.ScrollToBottom />
  </Thread.Viewport>

  <Composer>
    <Composer.Input />
    <Composer.Attachments />
    <Composer.Send />
  </Composer>
</Thread>
```

#### 2.2 Message Component Mapping

Create custom message renderer that preserves OpenCodex features:

```typescript
// components/OpenCodexMessage.tsx
export const OpenCodexMessage = ({ message }) => {
  return (
    <MessagePrimitive.Root>
      {/* User/Assistant Avatar */}
      <MessagePrimitive.Avatar>
        <OpenCodexAvatar role={message.role} />
      </MessagePrimitive.Avatar>

      {/* Message Content */}
      <MessagePrimitive.Content>
        {message.role === 'assistant' && message.agentActions && (
          <AgentActionDisplay actions={message.agentActions} />
        )}
        <MessagePrimitive.Text />
      </MessagePrimitive.Content>

      {/* Action Bar */}
      <ActionBar>
        <ActionBar.Copy />
        <ActionBar.Edit />
        <ActionBar.Regenerate />
      </ActionBar>
    </MessagePrimitive.Root>
  );
};
```

### Phase 3: Stream Adapter Implementation (Week 2-3)

#### 3.1 WebSocket to Assistant-UI Protocol

```typescript
// adapters/OpenCodexStreamAdapter.ts
export class OpenCodexStreamAdapter {
  async *streamResponse(ws: WebSocket) {
    const events = [];

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch(data.type) {
        case 'chunk':
          yield { type: 'text-delta', delta: data.content };
          break;

        case 'action':
          yield {
            type: 'tool-call',
            toolName: data.action,
            args: data.input
          };
          break;

        case 'observation':
          yield {
            type: 'tool-result',
            result: data.output
          };
          break;
      }
    };
  }
}
```

#### 3.2 Preserve Streaming Performance

Keep the 30ms batching optimization:

```typescript
// hooks/useOptimizedAssistantUI.ts
export const useOptimizedAssistantUI = () => {
  const BATCH_INTERVAL = 30; // Keep OpenCodex optimization

  const batchProcessor = useMemo(() =>
    new BatchProcessor(BATCH_INTERVAL), []
  );

  // Connect to assistant-ui runtime with batching
  const runtime = useAssistantRuntime({
    streamProcessor: batchProcessor
  });

  return runtime;
};
```

### Phase 4: Tool & Action Integration (Week 3)

#### 4.1 Tool Execution Mapping

Map OpenCodex tools to assistant-ui tool format:

```typescript
// tools/OpenCodexToolExecutor.ts
const toolMappings = {
  'file_read': {
    name: 'read_file',
    description: 'Read a file from the project',
    execute: async (args) => {
      // Call existing OpenCodex API
      const result = await api.sandbox.readFile(args.path);
      return {
        content: result.content,
        display: <FileReadDisplay {...result} />
      };
    }
  },
  'file_write': {
    name: 'write_file',
    description: 'Write content to a file',
    execute: async (args) => {
      const result = await api.sandbox.writeFile(args);
      return {
        success: true,
        display: <FileWritePreview {...args} />
      };
    }
  },
  // ... other tools
};
```

#### 4.2 Custom Tool UI Components

Preserve OpenCodex's rich tool visualization:

```typescript
// components/tools/ToolDisplay.tsx
export const ToolDisplay = ({ tool, args, result }) => {
  return (
    <ToolPrimitive.Root>
      <ToolPrimitive.Header>
        <ToolIcon name={tool} />
        Using {tool}
      </ToolPrimitive.Header>

      <ToolPrimitive.Args>
        <SyntaxHighlighter language="json">
          {JSON.stringify(args, null, 2)}
        </SyntaxHighlighter>
      </ToolPrimitive.Args>

      <ToolPrimitive.Result>
        {tool === 'file_write' && (
          <FileWritePreview content={result} />
        )}
        {/* Other custom displays */}
      </ToolPrimitive.Result>
    </ToolPrimitive.Root>
  );
};
```

### Phase 5: Advanced Features (Week 4)

#### 5.1 Sandbox Controls Integration

Keep sandbox controls as custom overlay:

```typescript
// components/SandboxOverlay.tsx
export const SandboxOverlay = () => {
  return (
    <Thread.Extension position="top-right">
      <SandboxControls
        sessionId={sessionId}
        onExecute={(cmd) => runtime.executeTool('bash', { command: cmd })}
      />
    </Thread.Extension>
  );
};
```

#### 5.2 File Management Panel

Integrate file panel with attachment system:

```typescript
// components/FilePanel.tsx
export const EnhancedFilePanel = () => {
  const { attachments, addAttachment } = useAttachments();

  return (
    <Thread.Extension position="sidebar">
      <FileList
        files={projectFiles}
        onSelect={(file) => addAttachment(file)}
      />
      <UploadButton onUpload={handleUpload} />
    </Thread.Extension>
  );
};
```

#### 5.3 Agent Configuration

Maintain agent config as modal:

```typescript
// Keep existing AgentConfigPanel
<Thread.Extension position="modal">
  <AgentConfigPanel
    config={agentConfig}
    onSave={(config) => runtime.updateConfig(config)}
  />
</Thread.Extension>
```

### Phase 6: Migration & Testing (Week 5)

#### 6.1 Gradual Migration Strategy

1. **Create Feature Flag**:
```typescript
const ENABLE_ASSISTANT_UI = process.env.VITE_ENABLE_ASSISTANT_UI === 'true';

export const ChatSession = () => {
  if (ENABLE_ASSISTANT_UI) {
    return <AssistantUIChatSession />;
  }
  return <LegacyChatSession />;
};
```

2. **A/B Testing Setup**:
```typescript
// Track performance metrics
const metrics = {
  renderTime: measureRenderTime(),
  streamingFPS: measureStreamingPerformance(),
  memoryUsage: measureMemoryUsage()
};
```

3. **Progressive Rollout**:
- Week 1: Internal testing
- Week 2: 10% of users
- Week 3: 50% of users
- Week 4: 100% deployment

#### 6.2 Testing Checklist

- [ ] **Performance Tests**
  - Streaming at 33 updates/second maintained
  - Virtual scrolling with 1000+ messages
  - Memory usage under 50MB
  - 60 FPS during streaming

- [ ] **Feature Parity Tests**
  - All 180+ UX features preserved
  - Tool execution and visualization
  - Sandbox controls working
  - File management integrated
  - Agent configuration functional

- [ ] **Regression Tests**
  - Existing Playwright tests pass
  - New assistant-ui specific tests
  - Cross-browser compatibility
  - Mobile responsiveness

### Phase 7: Optimization & Polish (Week 6)

#### 7.1 Performance Optimization

```typescript
// Optimize bundle size
// vite.config.ts
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'assistant-ui': ['@assistant-ui/react'],
          'vendor': ['react', 'react-dom'],
        }
      }
    }
  }
};
```

#### 7.2 Custom Theming

```css
/* styles/assistant-ui-overrides.css */
.aui-thread-root {
  --aui-primary: var(--opencodex-primary);
  --aui-background: var(--opencodex-background);
}

/* Preserve OpenCodex visual identity */
.aui-message-user {
  background: var(--opencodex-user-bg);
}

.aui-message-assistant {
  background: var(--opencodex-assistant-bg);
}
```

---

## Part 4: Feature Preservation Mapping

| Current Feature | Assistant-UI Component | Customization Needed |
|----------------|----------------------|---------------------|
| Virtual Scrolling | Thread.Viewport | Integrate Virtuoso if needed |
| 30ms Streaming | Built-in streaming | Add batch processor |
| Agent Actions | Tool UI | Custom tool displays |
| Sandbox Controls | Extension | Full custom component |
| File Management | Attachments + Extension | Hybrid approach |
| Session Tabs | ThreadList | Custom tab UI |
| Agent Config | Modal Extension | Keep existing |
| Auto-scroll Toggle | Thread.ScrollToBottom | Style customization |
| Error Banner | Built-in error handling | Custom error display |
| Quick Start | Thread with initial message | Custom landing |

---

## Part 5: Risk Mitigation

### Technical Risks

1. **Bundle Size Increase**
   - **Risk**: Assistant-UI adds ~50-100KB
   - **Mitigation**: Code splitting, tree shaking

2. **Breaking Changes**
   - **Risk**: Existing integrations break
   - **Mitigation**: Feature flag, gradual rollout

3. **Performance Regression**
   - **Risk**: Slower than current implementation
   - **Mitigation**: Keep optimizations, benchmark continuously

### User Experience Risks

1. **Feature Loss**
   - **Risk**: Some features don't map perfectly
   - **Mitigation**: Custom extensions for unique features

2. **Visual Changes**
   - **Risk**: Users confused by new UI
   - **Mitigation**: Maintain similar visual design, user testing

---

## Part 6: Success Metrics

### Performance KPIs
- ✅ Maintain 33 updates/second streaming
- ✅ Keep memory usage under 50MB
- ✅ 60 FPS during all interactions
- ✅ < 100ms tab switching

### User Experience KPIs
- ✅ All 180+ features preserved or enhanced
- ✅ New features: message editing, branching
- ✅ Improved mobile experience
- ✅ Better accessibility score

### Development KPIs
- ✅ 50% reduction in chat UI code
- ✅ Improved maintainability
- ✅ Faster feature development
- ✅ Community support access

---

## Part 7: Timeline & Resources

### 6-Week Implementation Timeline

**Week 1**: Foundation & Setup
- Install dependencies
- Configure Tailwind/shadcn
- Create integration layer

**Week 2**: Core Chat UI
- Replace message components
- Implement Thread/Composer
- Basic streaming integration

**Week 3**: Tools & Actions
- Map OpenCodex tools
- Custom tool displays
- Preserve visualizations

**Week 4**: Advanced Features
- Sandbox controls
- File management
- Agent configuration

**Week 5**: Testing & Migration
- Feature flag setup
- A/B testing
- Performance validation

**Week 6**: Optimization & Launch
- Performance tuning
- Custom theming
- Documentation

### Required Resources

- **Development**: 1-2 frontend engineers
- **Testing**: QA engineer for regression testing
- **Design**: UI/UX review for consistency
- **DevOps**: Deployment and monitoring setup

---

## Part 8: Post-Integration Roadmap

### Immediate Benefits (Month 1)
- Message editing and regeneration
- Conversation branching
- Better attachment handling
- Improved accessibility

### Short-term Enhancements (Month 2-3)
- Voice input/output
- Multimodal interactions
- Advanced tool UIs
- Persistence with Assistant Cloud

### Long-term Vision (Month 4-6)
- Collaborative sessions
- Advanced analytics
- Custom AI behaviors
- Enterprise features

---

## Conclusion

The integration of assistant-ui into OpenCodex represents a strategic modernization that will:

1. **Preserve all 180+ existing UX features** while adding new capabilities
2. **Reduce maintenance burden** by leveraging a community-supported library
3. **Improve user experience** with professional ChatGPT-style interface
4. **Enable faster feature development** with composable primitives
5. **Future-proof the application** with active YC-backed development

The phased approach ensures minimal disruption while maximizing benefits. With careful implementation and testing, OpenCodex will have a world-class chat interface that matches or exceeds current performance while providing a foundation for future innovation.

---

## Appendix A: Code Examples

### Example 1: Complete Chat Page Integration

```typescript
// src/components/ProjectSession/AssistantUIChatPage.tsx
import { Thread, Composer, useAssistantRuntime } from '@assistant-ui/react';
import { OpenCodexRuntime } from '@/lib/assistant-ui/runtime';
import { SandboxControls } from './SandboxControls';
import { FilePanel } from './FilePanel';
import { AgentConfigPanel } from './AgentConfigPanel';

export const AssistantUIChatPage = ({ sessionId, projectId }) => {
  const runtime = useAssistantRuntime(OpenCodexRuntime, {
    sessionId,
    projectId,
    streamingOptions: {
      batchInterval: 30, // Preserve OpenCodex optimization
    }
  });

  return (
    <div className="flex h-full">
      {/* File Panel - Left Sidebar */}
      <div className="w-64 border-r">
        <FilePanel projectId={projectId} runtime={runtime} />
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        <Thread runtime={runtime}>
          {/* Sandbox Controls - Top Bar */}
          <div className="border-b p-4">
            <SandboxControls sessionId={sessionId} />
          </div>

          {/* Messages Area */}
          <Thread.Viewport className="flex-1">
            <Thread.Messages
              components={{
                Message: OpenCodexMessage,
                ToolCall: OpenCodexToolDisplay,
              }}
            />
            <Thread.ScrollToBottom />
          </Thread.Viewport>

          {/* Input Area */}
          <Composer className="border-t p-4">
            <Composer.Attachments />
            <div className="flex gap-2">
              <Composer.Input
                placeholder="Type your message..."
                className="flex-1"
              />
              <Composer.Send />
            </div>
          </Composer>
        </Thread>
      </div>

      {/* Agent Config - Modal */}
      <AgentConfigPanel runtime={runtime} />
    </div>
  );
};
```

### Example 2: Custom Message Component

```typescript
// src/components/OpenCodexMessage.tsx
import { MessagePrimitive, ActionBar } from '@assistant-ui/react';
import { AgentActionDisplay } from './AgentActionDisplay';
import { memo } from 'react';

export const OpenCodexMessage = memo(({ message }) => {
  const isUser = message.role === 'user';

  return (
    <MessagePrimitive.Root className="group">
      <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
        {/* Avatar */}
        <MessagePrimitive.Avatar>
          <div className={`
            w-8 h-8 rounded-full flex items-center justify-center
            ${isUser ? 'bg-blue-500' : 'bg-purple-500'}
          `}>
            {isUser ? 'U' : 'AI'}
          </div>
        </MessagePrimitive.Avatar>

        {/* Content */}
        <div className="flex-1 max-w-2xl">
          {/* Role Label */}
          <div className="text-xs text-gray-500 mb-1">
            {isUser ? 'You' : 'Assistant'}
          </div>

          {/* Message Text with Markdown */}
          <MessagePrimitive.Content className="prose">
            <MessagePrimitive.Text />
          </MessagePrimitive.Content>

          {/* Agent Actions for Assistant Messages */}
          {!isUser && message.agentActions && (
            <AgentActionDisplay
              actions={message.agentActions}
              isStreaming={message.isStreaming}
            />
          )}

          {/* Action Bar - Show on Hover */}
          <ActionBar className="opacity-0 group-hover:opacity-100 transition-opacity">
            <ActionBar.Copy />
            {!isUser && <ActionBar.Regenerate />}
            <ActionBar.Edit />
          </ActionBar>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}, (prev, next) => {
  // Custom comparison for optimization
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.isStreaming === next.message.isStreaming &&
    prev.message.agentActions?.length === next.message.agentActions?.length
  );
});
```

### Example 3: Stream Adapter

```typescript
// src/lib/assistant-ui/OpenCodexStreamAdapter.ts
export class OpenCodexStreamAdapter {
  private ws: WebSocket | null = null;
  private batchBuffer: any[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_INTERVAL = 30;

  async *stream(sessionId: string, message: string) {
    // Initialize WebSocket
    this.ws = new WebSocket(
      `ws://127.0.0.1:8000/api/v1/chats/${sessionId}/stream`
    );

    // Send initial message
    this.ws.onopen = () => {
      this.ws?.send(JSON.stringify({
        type: 'message',
        content: message
      }));
    };

    // Process incoming events
    const eventQueue: any[] = [];
    let resolver: (() => void) | null = null;

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.batchBuffer.push(data);

      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => {
          this.processBatch(eventQueue);
          if (resolver) {
            resolver();
            resolver = null;
          }
        }, this.BATCH_INTERVAL);
      }
    };

    // Yield events
    while (true) {
      if (eventQueue.length > 0) {
        const event = eventQueue.shift();
        yield this.transformEvent(event);
      } else {
        await new Promise<void>(resolve => {
          resolver = resolve;
        });
      }

      // Check for end condition
      if (this.ws.readyState === WebSocket.CLOSED) {
        break;
      }
    }
  }

  private processBatch(eventQueue: any[]) {
    const batch = [...this.batchBuffer];
    this.batchBuffer = [];
    this.batchTimer = null;

    for (const event of batch) {
      eventQueue.push(event);
    }
  }

  private transformEvent(event: any) {
    switch (event.type) {
      case 'chunk':
        return { type: 'text-delta', delta: event.content };

      case 'action':
        return {
          type: 'tool-call-start',
          toolName: event.action,
          toolCallId: event.id
        };

      case 'action_args_chunk':
        return {
          type: 'tool-call-args-delta',
          toolCallId: event.action_id,
          delta: event.chunk
        };

      case 'observation':
        return {
          type: 'tool-call-result',
          toolCallId: event.action_id,
          result: event.output
        };

      case 'end':
        return { type: 'finish' };

      case 'error':
        return { type: 'error', error: event.message };

      default:
        return event;
    }
  }

  close() {
    this.ws?.close();
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
  }
}
```

---

## Appendix B: Testing Strategy

### Unit Tests
```typescript
// __tests__/AssistantUIIntegration.test.tsx
describe('Assistant-UI Integration', () => {
  it('maintains 30ms batching performance', async () => {
    const { runtime } = renderChatSession();
    const startTime = Date.now();

    // Send rapid messages
    for (let i = 0; i < 100; i++) {
      runtime.appendChunk(`chunk ${i}`);
    }

    // Verify batching
    const updates = runtime.getUpdateCount();
    expect(updates).toBeLessThan(10); // Should batch into ~3-4 updates
  });

  it('preserves all OpenCodex tool visualizations', async () => {
    const { getByText } = renderChatSession();

    runtime.executeTool('file_write', {
      path: 'test.py',
      content: 'print("hello")'
    });

    await waitFor(() => {
      expect(getByText('Using file_write')).toBeInTheDocument();
      expect(getByText('test.py')).toBeInTheDocument();
      // Verify syntax highlighting
      expect(document.querySelector('.language-python')).toBeInTheDocument();
    });
  });
});
```

### E2E Tests
```typescript
// e2e/assistant-ui-chat.spec.ts
test.describe('Assistant-UI Chat Features', () => {
  test('message editing works', async ({ page }) => {
    await page.goto('/project/123/chat/456');

    // Send a message
    await page.fill('[data-testid="composer-input"]', 'Hello');
    await page.keyboard.press('Enter');

    // Edit the message
    await page.hover('[data-testid="message-0"]');
    await page.click('[data-testid="edit-button"]');
    await page.fill('[data-testid="edit-input"]', 'Hello, updated');
    await page.keyboard.press('Enter');

    // Verify edit
    expect(await page.textContent('[data-testid="message-0"]'))
      .toContain('Hello, updated');
  });
});
```

---

## Appendix C: Rollback Plan

If issues arise during deployment:

1. **Immediate Rollback** (< 5 minutes)
   ```bash
   # Toggle feature flag
   VITE_ENABLE_ASSISTANT_UI=false npm run deploy
   ```

2. **Data Preservation**
   - All messages stored in same format
   - No data migration required
   - Sessions remain compatible

3. **Gradual Rollback**
   - Reduce percentage of users
   - Investigate issues
   - Fix and redeploy

4. **Communication**
   - Status page update
   - User notification
   - Support team briefing

---

*End of Integration Plan Document*