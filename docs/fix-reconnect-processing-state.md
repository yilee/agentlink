# Fix: Processing State Lost After Reconnection

## Bug Description

When the web UI reconnects (WebSocket drop or agent restart) while Claude is actively
processing a turn, two symptoms appear:

1. **Send button** — shows light-blue "send" instead of red "stop".
2. **Sidebar session list** — the spinning/processing indicator on the active session
   disappears.

Both are caused by the same root issue: processing state is cleared on disconnect and
never restored on reconnect.

## Root Cause

### 1. `ws.onclose` unconditionally clears `isProcessing`

`server/web/modules/connection.js:757`:

```javascript
ws.onclose = () => {
  isProcessing.value = false;      // ← always cleared
  isCompacting.value = false;
  // ...
};
```

### 2. `agent_disconnected` clears all conversation processing state

`server/web/modules/connection.js:509-518`:

```javascript
for (const [convId, cached] of Object.entries(conversationCache.value)) {
  cached.isProcessing = false;
  cached.isCompacting = false;
  processingConversations.value[convId] = false;
}
processingConversations.value[currentConversationId.value] = false;
```

### 3. Reconnection handlers don't restore processing state

- `connected` handler (`:465`) — restores agent info, requests session list. Does **not**
  query processing state.
- `agent_reconnected` handler (`:520`) — same: restores agent name/workDir/version, does
  **not** query processing state.
- No `resume_conversation` is sent automatically on reconnect, so no
  `conversation_resumed` (which carries `isProcessing`) ever arrives.

### 4. Incoming `claude_output` doesn't re-set `isProcessing`

`handleClaudeOutput()` (`:346`) processes streaming deltas and tool blocks but never
touches `isProcessing`. So even when the agent's Claude turn is still active and output
resumes flowing after reconnect, the button stays blue.

## Affected UI

- **Send/stop button** — condition at `app.js:943`:
  `v-if="isProcessing && !hasInput"` → evaluates to `false` when `isProcessing` is
  wrongly `false`.
- **Sidebar indicator** — `sidebar.js:328` `isSessionProcessing()` checks both
  `cached.isProcessing` and foreground `isProcessing.value`, both of which were cleared.

## Fix Plan

### Change 1: Add `query_active_conversations` message type (agent)

**File:** `agent/src/connection.ts`

Add a new case in `handleServerMessage()`:

```
case 'query_active_conversations'
```

This handler iterates `getConversations()`, collects every conversation where
`turnActive === true`, and responds with:

```json
{
  "type": "active_conversations",
  "conversations": [
    {
      "conversationId": "...",
      "claudeSessionId": "...",
      "isProcessing": true,
      "isCompacting": false
    }
  ]
}
```

Use `getIsCompacting(convId)` for the compacting state of each conversation.

### Change 2: Query active conversations on reconnect (web)

**File:** `server/web/modules/connection.js`

In both the `connected` handler (when `msg.agent` is present, i.e. agent is online) and
the `agent_reconnected` handler, send:

```javascript
wsSend({ type: 'query_active_conversations' });
```

### Change 3: Handle `active_conversations` response (web)

**File:** `server/web/modules/connection.js`

Add a new handler for `msg.type === 'active_conversations'`. For each entry in
`msg.conversations`:

- If `conversationId` matches `currentConversationId.value` (foreground):
  - Set `isProcessing.value = entry.isProcessing`
  - Set `isCompacting.value = entry.isCompacting`
  - Set `processingConversations.value[convId] = entry.isProcessing`
- Else if the conversation exists in `conversationCache`:
  - Set `cached.isProcessing = entry.isProcessing`
  - Set `cached.isCompacting = entry.isCompacting`
  - Set `processingConversations.value[convId] = entry.isProcessing`

### Change 4: Safety net in `handleClaudeOutput` (web)

**File:** `server/web/modules/connection.js`

At the top of `handleClaudeOutput()`, add a guard:

```javascript
if (!isProcessing.value) {
  isProcessing.value = true;
  if (currentConversationId && currentConversationId.value) {
    processingConversations.value[currentConversationId.value] = true;
  }
}
```

This ensures that if streaming output arrives while `isProcessing` is incorrectly
`false` (e.g. due to a race condition or edge case not covered by the
`query_active_conversations` round-trip), the state self-corrects immediately.

### Change 5: Relay the new message type through the server

**File:** `server/src/ws-client.ts`

The server is a transparent relay — it forwards all encrypted messages from web clients
to agents and vice versa. Verify that `query_active_conversations` (web → agent) and
`active_conversations` (agent → web) pass through without special handling. They should
work automatically since the server forwards unknown message types, but confirm this.

## Message Flow After Fix

```
[WebSocket reconnects]
  Web → Server:  connect (WebSocket handshake)
  Server → Web:  { type: 'connected', agent: {...} }
  Web → Agent:   { type: 'query_active_conversations' }
  Agent → Web:   { type: 'active_conversations', conversations: [...] }
  Web:           restores isProcessing / processingConversations for each active conv

[Agent reconnects]
  Server → Web:  { type: 'agent_reconnected', agent: {...} }
  Web → Agent:   { type: 'query_active_conversations' }
  Agent → Web:   { type: 'active_conversations', conversations: [...] }
  Web:           restores state (same as above)
```

## Testing

1. Start a long Claude turn (e.g. ask it to write a long program).
2. While output is streaming, disconnect the WebSocket (e.g. toggle network, or kill
   and restart the relay server in ephemeral mode).
3. Wait for auto-reconnect.
4. Verify the button shows red "stop" and sidebar shows the processing indicator.
5. Repeat with multiple parallel conversations — ensure all active ones show the
   correct state.
6. Verify that conversations that are NOT processing remain with the blue "send" button
   and no sidebar indicator.
