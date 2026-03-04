# E2E Test Plan — Multi-Session Parallel

This document defines the full manual E2E test suite for the multi-session parallel feature. It covers core messaging, conversation switching, background processing, cancel/resume, working directory changes, and page refresh recovery.

## Prerequisites

1. Build the project: `npm run build`
2. Start ephemeral server and agent:
   ```bash
   node server/dist/cli.js start --ephemeral
   node agent/dist/cli.js start --server ws://localhost:3456 --ephemeral
   ```
3. Open the session URL in a browser (shown in agent startup output).
4. Verify status bar shows "Connected" and the agent name.

## Test Cases

### Test 1: Basic Send and Response

**Steps:**
1. On the welcome screen, type `What is 1+1? Reply with just the number, do not use any tools.` and press Enter.
2. Wait for Claude's response.

**Expected:**
- User message appears in chat.
- Claude responds with `2`.
- "Stop generation" button appears during processing, then disappears.
- Session appears in sidebar history.

---

### Test 2: New Conversation

**Steps:**
1. Click "New conversation" in the sidebar.
2. Send `What is 2+2? Reply with just the number, do not use any tools.`

**Expected:**
- Chat area clears to a blank conversation.
- Claude responds with `4`.
- New session appears in sidebar.
- The previous 1+1 session is still listed in sidebar.

---

### Test 3: Switch Back to First Conversation

**Steps:**
1. Click the 1+1 session in the sidebar.

**Expected:**
- Chat shows the original 1+1 conversation messages (user: "What is 1+1?", Claude: "2").
- "Session restored" message may appear.
- Messages are loaded from conversation cache (instant, no loading spinner).

---

### Test 4: Switch to Second Conversation

**Steps:**
1. Click the 2+2 session in the sidebar.

**Expected:**
- Chat shows the 2+2 conversation (user: "What is 2+2?", Claude: "4").
- Cache-based restore (instant switch).

---

### Test 5: Background Processing (Long Task)

**Steps:**
1. Create a new conversation.
2. Send `Count from 1 to 20, one number per line. Do not use any tools.`
3. While counting is streaming, click on the 1+1 session in the sidebar to switch away.
4. Wait ~15-30 seconds for counting to complete in background.
5. Switch back to the counting conversation.

**Expected:**
- Switching away from the counting conversation is allowed mid-stream.
- The 1+1 conversation loads correctly when switched to.
- A pulsing dot indicator appears next to the counting session in sidebar while it's processing.
- When switching back to the counting conversation, all numbers 1-20 are present (background routing accumulated the output).

**Key knowledge:**
- `routeToBackgroundConversation()` in `connection.js` handles output for non-foreground conversations.
- It appends text deltas to the cached messages array directly (no streaming animation).
- `processingConversations` reactive object tracks which conversations are still processing.

---

### Test 6: Session Resume with Context (Follow-up)

**Steps:**
1. In the counting 1-20 conversation (after it completed), send a follow-up: `Now count backwards from 5 to 1, one number per line. Do not use any tools.`

**Expected:**
- Claude counts backwards: 5, 4, 3, 2, 1.
- This proves the Claude session was correctly resumed (`--resume sessionId`), maintaining context from the previous turn.
- The conversation retains both the forward count and backward count.

**Key knowledge:**
- When a conversation already has a `claudeSessionId`, subsequent messages resume that session.
- The agent uses `resumeSessionId || conversation?.claudeSessionId || lastClaudeSessionId` for auto-resume.

---

### Test 7: Simultaneous Parallel Processing

**Steps:**
1. Create a new conversation and send `List the first 10 prime numbers, one per line. Do not use any tools.`
2. Immediately switch to the 1+1 conversation.
3. Send `What is 3+3? Reply with just the number, do not use any tools.`
4. Wait for both to complete.
5. Check both conversations.

**Expected:**
- Both conversations process simultaneously on the agent side.
- The 1+1 conversation gets the 3+3 response appended (or a new conversation if 1+1 was resumed).
- The primes conversation has all 10 primes (2, 3, 5, 7, 11, 13, 17, 19, 23, 29) when switched to.
- Sidebar shows pulsing dots next to both processing sessions.

**Key knowledge:**
- Agent maintains `Map<string, ConversationState>` — multiple Claude processes run concurrently.
- Each conversation has its own `ChildProcess`, `inputStream`, and `AbortController`.
- `MAX_CONVERSATIONS = 5` — exceeding this evicts the oldest idle conversation.

---

### Test 8: Cancel Execution

**Steps:**
1. Create a new conversation.
2. Send `Write a detailed explanation of quantum computing in 1000 words. Do not use any tools.`
3. Wait for streaming to start (some text appears).
4. Click "Stop generation".

**Expected:**
- "Generation stopped." system message appears.
- Partial content from the essay is visible.
- The conversation is no longer in processing state.
- Other conversations are not affected.

**Key knowledge:**
- Cancel sends `{ type: 'cancel_execution', conversationId }` to agent.
- Agent calls `cancelExecution(conversationId)` which only aborts that specific conversation.
- The cancelled conversation's Claude process is killed, but other processes continue.

---

### Test 9: Cancel Does Not Affect Other Conversations

**Steps:**
1. After Test 8, switch to each other conversation (1+1, 2+2, counting, primes).

**Expected:**
- All previously completed conversations retain their full messages.
- No data loss from the cancel operation.

---

### Test 10: Follow-up in Completed Conversation

**Steps:**
1. Switch to the quantum computing conversation (from Test 8, which was cancelled).
2. Send `Summarize the previous essay in exactly 3 bullet points.`

**Expected:**
- Claude generates 3 bullet points summarizing whatever partial content was generated before cancel.
- This proves the session resumed correctly even after cancellation.
- A new Claude process is spawned for this conversation (since the previous one was killed).

---

### Test 11: Cancel Mid-Stream Then Resume

**Steps:**
1. Create a new conversation.
2. Send `Write a very long story about a robot learning to paint. Make it at least 2000 words.`
3. Click "Stop generation" before much content appears (or before session_started is received).
4. Send `What is 5+5? Reply with just the number, do not use any tools.`

**Expected:**
- The cancel works immediately.
- The follow-up message creates a new Claude session.
- Claude responds with `10`.
- The session title in sidebar becomes the follow-up message title (since the story was cancelled before getting a session ID).

**Key knowledge:**
- If cancel happens before `session_started`, there's no `claudeSessionId` to resume, so the next message starts a fresh session.
- If cancel happens after `session_started`, the next message resumes that session.

---

### Test 12: Rapid Switching Between Multiple Conversations

**Steps:**
1. Rapidly click through 5 different conversations in the sidebar, switching between them quickly.

**Expected:**
- Each conversation loads its correct messages instantly from cache.
- No message mixing between conversations.
- No errors or visual glitches.
- Processing indicators correctly show which conversations are still running (if any).

**Key knowledge:**
- `switchConversation()` saves current state to `conversationCache[oldConvId]` and restores from `conversationCache[newConvId]`.
- Messages are stored by reference (no deep clone) for performance.
- Streaming state is saved/restored via `streaming.saveState()` / `streaming.restoreState()`.

---

### Test 13: Page Refresh Recovery

**Steps:**
1. Note which conversations exist and their content.
2. Refresh the page (F5 or navigate to the same URL).
3. Wait for sessions to load in sidebar.
4. Click on a previous session (e.g., 1+1).

**Expected:**
- Page shows welcome screen after refresh (in-memory cache is cleared).
- "Loading sessions..." appears briefly, then sessions load from server.
- Clicking a session restores it from JSONL history (not cache — cache was cleared on refresh).
- All messages are present and correctly rendered.

**Key knowledge:**
- On page refresh, `conversationCache` is empty — all state is lost.
- Sessions are listed via `list_sessions` → agent scans JSONL files in `~/.claude/projects/<folder>/`.
- Clicking a session sends `resume_conversation` → agent reads JSONL and returns `conversation_resumed` with full history.

---

### Test 14: Change Working Directory While Idle

**Steps:**
1. Have an idle conversation in the current workdir (e.g., `Q:\src\agentlink`).
2. Change working directory to a different path (e.g., `Q:\src`).

**Expected:**
- Working directory in sidebar updates to the new path.
- A new blank conversation appears with system message: "Working directory changed to: Q:\src".
- Session list refreshes to show sessions for the new directory.
- The previous conversation is saved to cache (not visible but preserved).
- "Recent Directories" section shows the previous workdir for quick switching.

**Key knowledge:**
- `confirmFolderPicker()` sends `{ type: 'change_workdir', workDir: path }`.
- Agent updates `state.workDir` but does NOT terminate existing conversations.
- Web UI calls `switchConversation(newConvId)` to create a fresh foreground conversation.
- `sidebar.requestSessionList()` triggers a new `list_sessions` scan for the new directory.

---

### Test 15: Change Working Directory While Processing

**Steps:**
1. Start a long-running conversation (e.g., `Count from 1 to 50`).
2. While it's streaming, change the working directory.

**Expected:**
- The foreground switches to a new blank conversation for the new workdir.
- The counting conversation continues processing in the background.
- `processingConversations` still shows the counting conversation as active.
- No errors or interruptions.

**Key knowledge:**
- Each `ConversationState` has its own `workDir`, captured at spawn time via `cwd: workDir`.
- Changing `state.workDir` on the agent only affects future new conversations.
- Existing Claude processes continue running in their original directory.
- `routeToBackgroundConversation()` continues accumulating output for the background conversation.

---

### Test 16: Switch Back After Working Directory Change

**Steps:**
1. After Test 15, change workdir back to the original directory.
2. Click on the counting conversation in the sidebar.

**Expected:**
- Session list shows the original directory's sessions.
- Clicking the counting session shows all numbers (1-50 complete).
- Messages are fully preserved — either from cache (if conversation was still cached) or from JSONL history.
- Other conversations from the original workdir are also accessible.

---

### Test 17: New Message Uses New Working Directory

**Steps:**
1. Change working directory to `Q:\src` (or any different directory).
2. Send `What is your current working directory? Show me the output of pwd or its equivalent.`

**Expected:**
- Claude runs `pwd` and shows the new working directory (e.g., `/q/src` or `Q:\src`).
- This confirms the new conversation's Claude process was spawned with the new `cwd`.

**Key knowledge:**
- The agent passes `cwd: workDir` to `spawn()` when creating new Claude processes.
- Each conversation is isolated — changing the agent's workDir doesn't affect running processes.

---

### Test 18: Change Working Directory Back to Original

**Steps:**
1. After testing in a different workdir, change back to the original (e.g., `Q:\src\agentlink`).

**Expected:**
- Session list shows all original sessions.
- All previously created sessions are accessible and have correct content.
- "Recent Directories" shows the other workdir for quick access.

---

## Architecture Reference

### Agent Side (claude.ts)

- `conversations: Map<string, ConversationState>` — one entry per active conversation.
- Each conversation has its own `ChildProcess` (Claude subprocess), `inputStream`, `AbortController`.
- `MAX_CONVERSATIONS = 5` — oldest idle conversation is evicted when limit is exceeded.
- `session_started` message is sent when Claude's system init provides a `session_id`, enabling early sidebar refresh.

### Web Side (connection.js)

- Messages from agent include `conversationId` field.
- If `msg.conversationId !== currentConversationId.value`, the message is routed to `routeToBackgroundConversation()`.
- `routeToBackgroundConversation()` updates `conversationCache[convId]` directly (no streaming animation):
  - `content_block_delta` → appends text to last assistant message
  - `tool_use` → appends tool message
  - `turn_completed` / `execution_cancelled` → sets `isProcessing = false`, removes from `processingConversations`
  - `session_started` → captures `claudeSessionId` on the cache entry
  - `error` → appends error system message

### Web Side (app.js)

- `switchConversation(newConvId)`:
  1. Saves current state to `conversationCache[oldConvId]` (messages, isProcessing, claudeSessionId, streaming state, toolMsgMap, etc.)
  2. Restores target state from `conversationCache[newConvId]` (or initializes blank)
  3. Sets `currentConversationId = newConvId`
- Messages are stored by reference (no deep clone) for performance.

### Web Side (sidebar.js)

- `requestSessionList()` is debounced: first call fires immediately, subsequent calls within 2s are deferred.
- `resumeSession()` checks if a conversation with that `claudeSessionId` already exists in cache before creating a new one.
- `isSessionProcessing()` checks both cache and current foreground to show pulsing dot indicator.

### Working Directory Change Flow

```
User changes workdir
  → Web sends { type: 'change_workdir', workDir }
  → Server relays to agent (intercepts to update agent.workDir)
  → Agent: state.workDir = newDir (only affects future conversations)
  → Agent sends { type: 'workdir_changed', workDir }
  → Agent sends list_sessions for new directory
  → Web: switchConversation(newConvId) — blank foreground
  → Web: system message "Working directory changed to: ..."
  → Web: sidebar.requestSessionList() — shows new directory's sessions
  → Background conversations keep running, receiving output via routeToBackgroundConversation()
```

## Test Results Log

| # | Test | Status |
|---|------|--------|
| 1 | Basic send and response (1+1=2) | PASSED |
| 2 | New conversation (2+2=4) | PASSED |
| 3 | Switch back to first conversation — cache restore | PASSED |
| 4 | Switch to second conversation — cache restore | PASSED |
| 5 | Background processing (count 1-20 completes in background) | PASSED |
| 6 | Session resume follow-up (count backwards 5-1 with context) | PASSED |
| 7 | Simultaneous parallel processing (primes + 3+3 both complete) | PASSED |
| 8 | Cancel execution mid-stream (quantum computing essay) | PASSED |
| 9 | Cancel isolation — other conversations unaffected | PASSED |
| 10 | Follow-up in completed/cancelled conversation (3-bullet summary) | PASSED |
| 11 | Cancel before session_started, then resume with new message (5+5=10) | PASSED |
| 12 | Rapid switching between 5 conversations — all state correct | PASSED |
| 13 | Page refresh → sessions reload from JSONL history | PASSED |
| 14 | Change workdir while idle — new conversation, session list refreshes | PASSED |
| 15 | Change workdir while processing — background conversation keeps running | PASSED |
| 16 | Switch back after workdir change — messages preserved | PASSED |
| 17 | New message in changed workdir — confirms new cwd | PASSED |
| 18 | Change workdir back to original — session list shows original sessions | PASSED |

All 18 tests passed (2026-03-04).
