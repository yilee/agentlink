# E2E Test Plan — Multi-Session Parallel

This document defines the full manual E2E test suite for the multi-session parallel feature. It covers core messaging, conversation switching, background processing, cancel/resume, working directory changes, and page refresh recovery.

## Prerequisites

1. Build the project: `npm run build`
2. Start ephemeral server and agent, using `test/e2e-workdir` as working directory to isolate test sessions from real history:
   ```bash
   node server/dist/cli.js start --ephemeral --port <PORT>
   node agent/dist/cli.js start --server ws://localhost:<PORT> --ephemeral --dir test/e2e-workdir
   ```
   > **Important:** Always use `test/e2e-workdir` as `--dir` so test session history (stored under `~/.claude/projects/`) is kept separate from real project sessions. Do NOT use the project root as the working directory for E2E tests.
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

### Test 19: Delete Session After Switching Conversations

**Steps:**
1. Create at least 3 conversations (e.g., send simple math questions in each).
2. Switch between them several times by clicking different sessions in the sidebar.
3. Hover over a session that is **not** the current foreground conversation and **not** currently processing.
4. Click the delete (trash) button.

**Expected:**
- A confirmation dialog appears: "Are you sure you want to delete this session?"
- Click "Delete" → the session is removed from the sidebar.
- Click "Cancel" → the dialog closes and the session remains.
- Repeat for another session to confirm delete continues to work after multiple switches.

**Key knowledge:**
- `deleteSession()` in `sidebar.js` guards against deleting sessions that are actively processing in the background (`cached.isProcessing === true`).
- The guard must NOT block deletion of idle cached sessions — only sessions with `isProcessing === true` should be protected.
- `conversationCache` accumulates entries as the user switches conversations; the delete guard must tolerate cached-but-idle entries.

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
| 11 | Cancel before session_started, then resume with new message (5+5=10) | FAILED |
| 12 | Rapid switching between 5 conversations — all state correct | PASSED |
| 13 | Page refresh → sessions reload from JSONL history | PASSED |
| 14 | Change workdir while idle — new conversation, session list refreshes | PASSED |
| 15 | Change workdir while processing — background conversation keeps running | PASSED |
| 16 | Switch back after workdir change — messages preserved | PASSED |
| 17 | New message in changed workdir — confirms new cwd | PASSED |
| 18 | Change workdir back to original — session list shows original sessions | PASSED |

17 of 18 tests passed. TC-11 FAILED — cancel before session_started breaks conversation permanently (known edge case, pre-existing). (2026-03-08)

---

## Team Feature E2E Tests

Tests for the agent team mode feature: creation, dashboard, agent detail view, completion, dissolution, history, and page refresh recovery.

### Prerequisites

Same as above (ephemeral server + agent running, browser open to session URL), plus:
- Working directory must contain some code files (e.g., `test/e2e-workdir/`) so agents have something to work on
- Claude CLI must support `--agents` flag (native subagent feature)

### TC-19: Team mode toggle and creation panel

**Steps:**
1. Open the web UI in chat mode (default)
2. Click the "Team" toggle button in the input area
3. Observe the creation panel

**Expected:**
- Mode toggle shows two buttons: "Chat" and "Team"
- Clicking "Team" switches to team creation panel
- Creation panel shows:
  - Instruction textarea with placeholder text
  - Three example cards (clickable)
  - Template selector buttons: Code Review, Full-Stack, Debug, Custom
  - "Launch Team" button (disabled when instruction is empty)
- Clicking "Chat" switches back to normal chat input

### TC-20: Example cards populate instruction

**Steps:**
1. Switch to Team mode
2. Click the first example card
3. Observe the instruction textarea
4. Click the third example card

**Expected:**
- First card populates the instruction textarea with code review text
- Third card populates with the Markdown preview tool text (includes Doc + Dev + Test workflow description)
- Template selector auto-selects appropriate template for each card
- Launch button becomes enabled after clicking a card

### TC-21: Launch team with custom instruction

**Steps:**
1. Switch to Team mode
2. Type a custom instruction: "Review the files in this directory and write a summary of what each file does"
3. Select "Custom" template
4. Click "Launch Team"
5. Wait for the team to be created

**Expected:**
- UI transitions to team dashboard
- Team status shows "planning" initially
- Lead status text appears (e.g., "Lead is analyzing the codebase...")
- After a few seconds, team status transitions to "running"
- At least one subagent card appears on the dashboard

### TC-22: Team dashboard — agent cards and status

**Steps:**
1. After TC-21 (team running)
2. Observe the agent cards on the dashboard

**Expected:**
- Each agent card shows:
  - Agent name (role-based, e.g., "Reviewer", "Analyst" — not generic "Agent 1")
  - Color-coded left border (distinct colors per agent)
  - Current status badge ("working", "idle", "done")
  - Assigned task (if any)
- Lead card appears separately (purple color)
- Agent statuses update in real-time as agents start and finish work

### TC-23: Team dashboard — task board (kanban)

**Steps:**
1. After TC-21 (team running)
2. Observe the task board / kanban section

**Expected:**
- Tasks organized in columns: Pending, Active, Done
- Each task card shows:
  - Task description text
  - Assigned agent name (if active/done)
  - Status badge
- Tasks move between columns as agents pick them up and complete them
- Task count updates in column headers

### TC-24: Team dashboard — activity feed with personified messages

**Steps:**
1. After TC-21 (team running)
2. Observe the activity feed section at the bottom of the dashboard

**Expected:**
- Feed shows real-time entries as agents work
- Messages use personified verb forms, e.g.:
  - "[AgentName] is reading src/file.ts" (not "Read src/file.ts")
  - "[AgentName] is creating output.md" (not "Write output.md")
  - "[AgentName] is modifying config.json" (not "Edit config.json")
  - "[AgentName] is running `npm test`" (not "Bash npm test")
  - "[AgentName] is searching for ..." (not "Grep ...")
  - "[AgentName] is looking for files matching ..." (not "Glob ...")
- Each feed entry shows a timestamp
- Feed entries are color-coded to match their agent
- Feed auto-scrolls to show newest entries

### TC-25: Agent detail view — streaming messages

**Steps:**
1. While a team is running, click on an active agent card (status: "working")
2. Observe the agent detail view

**Expected:**
- View shows the agent's conversation in real-time
- Assistant messages stream in as text blocks
- Tool use blocks appear with tool name and input
- Tool results appear below tool use blocks
- A "Back" button returns to the dashboard
- Agent name and status shown in the header

### TC-26: Agent detail view — back navigation

**Steps:**
1. In agent detail view (from TC-25)
2. Click the "Back" button

**Expected:**
- Returns to team dashboard
- Dashboard state is preserved (same agents, tasks, feed)
- Can click on a different agent to view their detail

### TC-27: Team completion

**Steps:**
1. Launch a team with a small task (e.g., "List all files in this directory and describe them")
2. Wait for the team to complete (all agents finish, Lead produces summary)

**Expected:**
- All agent cards show status "done"
- All tasks show status "done" in the kanban
- Team status shows "completed"
- Lead summary / final result appears on the dashboard
- Completion stats are visible (agent count, task count, duration)
- "New Team" and "Back to Chat" buttons appear

### TC-28: Dissolve team (cancel)

**Steps:**
1. Launch a team with a long-running task (e.g., "Do a thorough analysis of every file in the codebase")
2. While agents are actively working, click the "Dissolve" / "Cancel" button

**Expected:**
- Team stops processing
- Team status changes to "failed" or "completed" (with partial results)
- Agent statuses update to reflect termination
- User can start a new team or return to chat
- No lingering processes or stuck state

### TC-29: Team history — sidebar listing

**Steps:**
1. Complete at least one team (from TC-27 or previous runs)
2. Open the team sidebar / history panel
3. Observe the teams list

**Expected:**
- Completed teams appear in the list with:
  - Team instruction (truncated)
  - Completion status
  - Timestamp
- Clicking a team opens it as a read-only historical view

### TC-30: Team history — read-only dashboard

**Steps:**
1. From TC-29, click on a completed team in the history list

**Expected:**
- Historical team dashboard loads in read-only mode
- Shows all agents with their final statuses ("done")
- Shows all tasks with "done" status
- Activity feed shows all entries from the completed run
- No "Dissolve" button (team already completed)
- "New Team" and "Back to Chat" buttons are available

### TC-31: Team history — agent detail (historical)

**Steps:**
1. From TC-30 (viewing a historical team)
2. Click on an agent card

**Expected:**
- Agent detail view opens
- Shows agent's conversation history (if available from persistence)
- Or shows "Agent messages are not available for completed teams." message
- Back button returns to historical dashboard

### TC-32: Page refresh during active team

**Steps:**
1. Launch a team and wait until at least 1 subagent is working
2. Refresh the browser page (F5)

**Expected:**
- Dashboard re-enters team mode automatically
- Team status shows "running"
- All agents visible before refresh still appear with current statuses
- Activity feed preserves entries from before refresh
- Kanban shows correct task statuses
- Agents continue to update in real-time
- Clicking an agent shows "No messages yet." (streaming messages are ephemeral)

### TC-33: Page refresh after team completion

**Steps:**
1. Let a team complete fully
2. Observe completed state on dashboard
3. Refresh the browser page (F5)

**Expected:**
- Dashboard automatically loads the completed team as historical view
- Team status shows "completed"
- All agents show status "done"
- All tasks show "done" in kanban
- Activity feed contains all entries from the completed run

### TC-34: Chat ↔ Team mode isolation

**Steps:**
1. Have an ongoing chat conversation (send a message, get a response)
2. Switch to Team mode, launch a team
3. While team is running, click "Back to Chat"
4. Verify chat messages are preserved
5. Switch back to Team mode

**Expected:**
- Chat conversation messages are preserved when switching to team mode
- Team dashboard state is preserved when switching to chat
- Team continues processing in background while viewing chat
- No cross-contamination between chat and team messages

### TC-35: Multiple sequential teams

**Steps:**
1. Launch a team, wait for completion
2. Click "New Team"
3. Launch another team with a different instruction

**Expected:**
- First team is saved to history
- Second team starts fresh with clean dashboard
- New agent cards, tasks, and feed
- First team remains viewable in history
- No state leak from first team to second

## Team Test Results Log

| # | Test | Status |
|---|------|--------|
| 19 | Team mode toggle and creation panel | PASSED |
| 20 | Example cards populate instruction | PASSED |
| 21 | Launch team with custom instruction | PASSED |
| 22 | Team dashboard — agent cards and status | PASSED |
| 23 | Team dashboard — task board (kanban) | PASSED |
| 24 | Team dashboard — activity feed with personified messages | PASSED |
| 25 | Agent detail view — streaming messages | PASSED |
| 26 | Agent detail view — back navigation | PASSED |
| 27 | Team completion | PASSED |
| 28 | Dissolve team (cancel) | PASSED |
| 29 | Team history — sidebar listing | PASSED |
| 30 | Team history — read-only dashboard | PASSED |
| 31 | Team history — agent detail (historical) | PASSED |
| 32 | Page refresh during active team | PASSED |
| 33 | Page refresh after team completion | PASSED |
| 34 | Chat ↔ Team mode isolation | PASSED |
| 35 | Multiple sequential teams | PASSED |

All 17 team tests passed (2026-03-08).

---

## Plan Mode E2E Tests

Tests for the Plan Mode feature: toggle button, status banner, message badges, mode switching behavior, processing guard, conversation isolation, and page refresh reset.

### Prerequisites

Same as above (ephemeral server + agent running, browser open to session URL), plus:
- Claude CLI must support `--permission-mode plan` flag
- Start with a fresh session (no prior plan mode state)

### TC-36: Plan Mode toggle button visibility and initial state

**Steps:**
1. Open the web UI in chat mode (default).
2. Observe the input area bottom-left (alongside attach and slash buttons).
3. Locate the Plan Mode toggle button.

**Expected:**
- Plan Mode toggle button is visible in the input area bottom-left.
- Button is in its default (non-active) state: subtle/gray, low visual weight.
- No status banner is visible above the input card.
- Input card does not have an amber/accent top border.

---

### TC-37: Toggle Plan Mode on

**Steps:**
1. Click the Plan Mode toggle button.
2. Observe the button, status banner, and input card.

**Expected:**
- Button becomes active/highlighted with plan mode accent color (amber).
- Status banner appears above the input card with text: "Plan Mode -- read-only, no file changes" and an "Exit" button.
- Input card gets a plan-mode accent border (amber top border).
- A `set_plan_mode` WebSocket message is sent to the agent with `enabled: true`.
- Agent responds with `plan_mode_changed` confirmation.

**Key knowledge:**
- `togglePlanMode()` in `app.js` guards against toggling while `isProcessing === true`.
- Web sends `{ type: 'set_plan_mode', enabled: true, conversationId }` to agent.
- Agent calls `setPermissionMode(conversationId, 'plan')` which kills the current claude process and updates the conversation's `permissionMode`.

---

### TC-38: Toggle Plan Mode off

**Steps:**
1. Ensure Plan Mode is currently on (button highlighted, banner visible).
2. Click the Plan Mode toggle button again.
3. Observe the button, banner, and input card.

**Expected:**
- Button returns to its default (non-active) state: subtle/gray.
- Status banner disappears.
- Input card border returns to normal (no amber accent).
- A `set_plan_mode` message is sent with `enabled: false`.
- Agent responds with `plan_mode_changed` confirmation.

---

### TC-39: Plan Mode disabled during processing

**Steps:**
1. Ensure Plan Mode is off (Normal Mode).
2. Send a message that triggers a long response: `Count from 1 to 30, one number per line. Do not use any tools.`
3. While Claude is streaming the response (numbers appearing), attempt to click the Plan Mode toggle button.
4. Wait for the response to complete.
5. Observe the Plan Mode toggle button again.

**Expected:**
- While processing, the Plan Mode toggle button is disabled (grayed out, `cursor: not-allowed`).
- Clicking the disabled button has no effect (mode does not change, no WebSocket message sent).
- After `turn_completed` is received and processing ends, the toggle button becomes enabled again.
- The toggle button can now be clicked normally.

**Key knowledge:**
- `togglePlanMode()` returns early if `isProcessing.value === true`.
- Button is disabled via the `isProcessing` reactive state.

---

### TC-40: Send message in Plan Mode

**Steps:**
1. Toggle Plan Mode on (click the Plan Mode button, verify banner appears).
2. Type `List the files in the current directory. Do not modify anything.` and press Enter.
3. Wait for Claude's response.

**Expected:**
- The user message displays a `(Plan)` badge after the role label (e.g., "You (Plan)").
- Claude's response displays a `(Plan)` badge after the role label (e.g., "Claude (Plan)").
- Claude responds with a list of files (proving it can still read/analyze in plan mode).
- The response does not contain errors about permission denial for read operations.

**Key knowledge:**
- Messages are tagged with `planMode: true` when sent during Plan Mode.
- The `(Plan)` badge uses the plan mode accent color.
- Claude runs with `--permission-mode plan` which allows read operations but blocks writes.

---

### TC-41: Plan Mode prevents file modifications

**Steps:**
1. Ensure Plan Mode is on (banner visible, button highlighted).
2. Send `Create a file called test-plan-mode.txt with the content 'hello'`.
3. Wait for Claude's response.
4. Check whether the file `test-plan-mode.txt` was created in the working directory.

**Expected:**
- Claude attempts to create the file but is blocked by plan mode permissions.
- Claude's response indicates it cannot create/write files in Plan Mode (permission denied or similar message).
- No file named `test-plan-mode.txt` exists in the working directory (`test/e2e-workdir/`).
- Both user and assistant messages show `(Plan)` badges.

**Key knowledge:**
- `--permission-mode plan` blocks write operations at the Claude CLI level.
- Claude may report the restriction explicitly or attempt the tool call and receive a denial.

---

### TC-42: Switch back to Normal Mode and execute

**Steps:**
1. After TC-41, toggle Plan Mode off (click the toggle button or click "Exit" in the banner).
2. Verify the banner disappears and button returns to default state.
3. Send `What is 1+1? Reply with just the number, do not use any tools.`
4. Wait for Claude's response.

**Expected:**
- The user message does NOT show a `(Plan)` badge.
- Claude's response does NOT show a `(Plan)` badge.
- Claude responds normally with `2`.
- The conversation context is preserved (prior plan mode messages from TC-40 and TC-41 are still visible above).
- This proves the session was correctly resumed via `--resume` after switching back to `bypassPermissions` mode.

**Key knowledge:**
- Mode switch kills the current claude process and respawns with `--permission-mode bypassPermissions`.
- Session continuity is preserved via `--resume sessionId` using the stored `claudeSessionId`.

---

### TC-43: Plan Mode state preserved across conversation switch

**Steps:**
1. In the current conversation (conversation A), toggle Plan Mode on.
2. Verify the banner is visible and button is highlighted.
3. Click "New conversation" in the sidebar to create conversation B.
4. Observe the Plan Mode state in conversation B.
5. Switch back to conversation A by clicking its entry in the sidebar.
6. Observe the Plan Mode state.

**Expected:**
- Conversation A: Plan Mode is on (banner visible, button highlighted) before switching away.
- Conversation B: Plan Mode resets to off (no banner, button in default state) -- new conversations start in Normal Mode.
- Switching back to conversation A: Plan Mode is restored to on (banner visible, button highlighted).
- The toggle button and banner correctly reflect the per-conversation plan mode state after each switch.

**Key knowledge:**
- `permissionMode` is per-conversation in `ConversationState` on the agent side.
- The web UI saves/restores `planMode` state as part of `switchConversation()` cache operations.

---

### TC-44: Plan Mode resets on page refresh

**Steps:**
1. Toggle Plan Mode on (verify banner visible, button highlighted).
2. Refresh the browser page (F5 or navigate to the same URL).
3. Wait for the page to load and connect.
4. Observe the Plan Mode state.

**Expected:**
- After page refresh, Plan Mode is off (Normal Mode).
- No status banner is visible.
- Toggle button is in its default (non-active) state.
- Input card has no amber accent border.
- This is the intended safe default -- `planMode` UI state is not persisted across page refreshes.

**Key knowledge:**
- `planMode` is a `ref(false)` in `app.js` -- it reinitializes to `false` on page load.
- The claude process is killed on WebSocket disconnect (page refresh), so the next spawn will use whatever mode the UI specifies.

---

### TC-45: Exit button in banner

**Steps:**
1. Toggle Plan Mode on (verify banner appears with "Exit" button).
2. Click the "Exit" button/link in the status banner.
3. Observe the Plan Mode state.

**Expected:**
- Plan Mode turns off (same behavior as clicking the toggle button).
- Status banner disappears.
- Toggle button returns to default (non-active) state.
- Input card border returns to normal.
- A `set_plan_mode` message is sent with `enabled: false`.

---

## Plan Mode Test Results Log

| # | Test | Status |
|---|------|--------|
| 36 | Plan Mode toggle button visibility and initial state | |
| 37 | Toggle Plan Mode on | |
| 38 | Toggle Plan Mode off | |
| 39 | Plan Mode disabled during processing | |
| 40 | Send message in Plan Mode | |
| 41 | Plan Mode prevents file modifications | |
| 42 | Switch back to Normal Mode and execute | |
| 43 | Plan Mode state preserved across conversation switch | |
| 44 | Plan Mode resets on page refresh | |
| 45 | Exit button in banner | |
