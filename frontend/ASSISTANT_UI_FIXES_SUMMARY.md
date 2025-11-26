# Assistant-UI Integration - Critical Fixes Applied

## Date: 2025-11-26

## Issues Fixed

### 1. Message History Not Loading ✅
**Problem:** When navigating from project page back to chat session, messages disappeared and only showed "Start a conversation"

**Root Cause:** In `AssistantUIChatPage.tsx`, the `useOptimizedStreaming` hook was being called with hardcoded empty array:
```typescript
// OLD - Bug
initialMessages: []
```

**Solution:** Added proper message fetching from backend API:
```typescript
// NEW - Fixed
const { data: messagesData } = useQuery({
  queryKey: ['messages', sessionId],
  queryFn: () => messagesAPI.list(sessionId!),
  enabled: !!sessionId,
  staleTime: 5 * 60 * 1000,
  cacheTime: 10 * 60 * 1000,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
});

// Pass loaded messages to streaming hook
useOptimizedStreaming({
  sessionId,
  initialMessages: messagesData?.messages || [],
})
```

### 2. Custom Auto-scroll Button Removed ✅
**Request:** "forget about the button based auto scrolling, we use the auto-scrolling of assistant-ui completely"

**Changes in `VirtualizedChatList.tsx`:**
- Removed `autoScrollEnabled` state variable
- Removed the floating auto-scroll toggle button
- Removed `useState` import (no longer needed)
- Auto-scrolling is now always enabled

**Before:**
- Had a floating blue/white toggle button in bottom-right corner
- User could disable auto-scrolling
- State managed with `useState`

**After:**
- No toggle button
- Auto-scrolling always active (as per assistant-ui design philosophy)
- Cleaner UI with less visual clutter

## Files Modified

1. **src/components/assistant-ui/AssistantUIChatPage.tsx**
   - Added message fetching with React Query
   - Fixed initialMessages to use fetched data

2. **src/components/ProjectSession/components/VirtualizedChatList.tsx**
   - Removed auto-scroll toggle button
   - Removed autoScrollEnabled state
   - Simplified auto-scroll logic

## Test Results

✅ All 15 Playwright tests passing across all browsers:
- Chromium
- Firefox
- WebKit
- Mobile Chrome
- Mobile Safari

Both legacy and assistant-ui versions working correctly with:
- Proper message history loading
- Automatic scrolling behavior
- 100% feature parity maintained

## Current State

- **assistant-ui is enabled by default** (featureFlags.ts)
- Message history persists correctly across navigation
- Auto-scrolling works seamlessly without manual toggle
- Both versions stable and tested

## Next Steps

The foundation is solid for gradual enhancement with assistant-ui features:
- Phase 1: Replace MessageInput with ComposerPrimitive
- Phase 2: Replace Message Display with MessagePrimitive
- Phase 3: Add ThreadPrimitive for message threading
- Phase 4: Add ToolCallPrimitive for agent actions

Each enhancement can be done incrementally with the legacy version as fallback.