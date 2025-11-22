# Stop Button Test Specification

## Overview
Test the stop button functionality that allows users to cancel LLM streaming at any time.

## Test Cases

### TC1: Button Changes to Stop Icon When Streaming
**Given:** User is on chat page with an active session
**When:** User sends a message and LLM starts streaming
**Then:**
- Send button should change to stop button
- Stop button should show stop icon (square ⏹ or X ✕)
- Button should remain clickable
- Button color should indicate it's a stop action (e.g., red tint)

### TC2: Clicking Stop Sends Cancel Message
**Given:** LLM is currently streaming a response
**When:** User clicks the stop button
**Then:**
- WebSocket should send `{"type": "cancel"}` message
- Button should become disabled temporarily
- Streaming should stop within 1 second

### TC3: Stop Button Reverts to Send After Cancel
**Given:** User cancelled an ongoing LLM response
**When:** Cancellation completes
**Then:**
- Stop button should change back to send button
- Send icon should be displayed
- Input field should be enabled
- User can send a new message

### TC4: Stop Button Works During Tool Execution
**Given:** Agent is executing a tool (bash, file operations, etc.)
**When:** User clicks stop button
**Then:**
- Tool execution should be interrupted
- Agent should emit cancelled event
- UI should show "Response cancelled by user" message
- Button should revert to send state

### TC5: Multiple Stop Clicks Handled Gracefully
**Given:** LLM is streaming
**When:** User rapidly clicks stop button multiple times
**Then:**
- Only one cancel message should be sent
- Button should be disabled after first click
- No errors should occur
- UI should not become unresponsive

### TC6: Stop Button Disabled When Not Streaming
**Given:** User is on chat page with no active streaming
**When:** No message is being generated
**Then:**
- Only send button should be visible
- Stop button should not be visible
- Send button should be enabled/disabled based on input

### TC7: Cancel Message Appears in Chat
**Given:** User cancelled an LLM response mid-generation
**When:** Cancellation completes
**Then:**
- Partial response should remain visible in chat
- A system message should appear: "Response cancelled" or similar
- Message should be clearly distinguishable from normal messages
- Cancelled message should be saved in history (optional)

### TC8: Stop Works With and Without Agent Actions
**Given:** LLM is generating response
**When:** User clicks stop during:
  - Simple text streaming (no tools)
  - Tool execution (with agent actions visible)
**Then:**
- Both scenarios should cancel successfully
- Partial content should be visible
- No orphaned UI elements

## UI/UX Requirements

### Send Button (Normal State)
```
- Icon: ➤ (send/arrow icon)
- Color: Primary blue (#2563eb)
- State: Enabled when input has text
```

### Stop Button (Streaming State)
```
- Icon: ⏹ (stop square) or ✕ (X)
- Color: Red tint (#dc2626) or gray
- State: Always enabled during streaming
- Hover: Darken slightly
- Tooltip: "Stop generating"
```

### CSS Animation
- Smooth transition between send ↔ stop states (200ms)
- No jarring color changes
- Icon should swap smoothly

## WebSocket Protocol

### Cancel Message Format
```json
{
  "type": "cancel"
}
```

### Expected Response Events
```json
{
  "type": "cancelled",
  "content": "Response cancelled by user",
  "partial_content": "...text generated so far..."
}
```

```json
{
  "type": "end",
  "cancelled": true
}
```

## Error Handling

### EC1: WebSocket Disconnected During Cancel
**When:** WebSocket connection is lost while cancelling
**Then:**
- Show error: "Connection lost. Please refresh."
- Button should revert to send state
- User can retry sending message

### EC2: Backend Doesn't Respond to Cancel
**When:** Cancel message sent but no response within 3 seconds
**Then:**
- Force stop streaming on frontend
- Show warning: "Cancellation timed out"
- Reset UI to normal state

## Manual Testing Checklist

- [ ] Stop button appears when streaming starts
- [ ] Stop button changes color/icon correctly
- [ ] Clicking stop cancels the response
- [ ] Partial response remains visible
- [ ] Button reverts to send after cancel
- [ ] Multiple clicks don't cause errors
- [ ] Works with simple chat (no tools)
- [ ] Works with agent mode (with tools)
- [ ] Works on both ChatView and ChatSessionPage
- [ ] Keyboard shortcut (Esc) to stop (optional)
- [ ] Mobile responsive (button size/touch target)
