# Loop (Scheduled Tasks) E2E Test Plan

This document defines the full manual E2E test suite for the Loop (Scheduled Tasks) feature. It covers Loop CRUD, manual and scheduled execution, execution history, sidebar integration, view mode navigation, and a real end-to-end functional test where a Loop executes a Claude prompt on a cron schedule.

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
5. The `claude` CLI must be installed and authenticated on the machine for tests that involve real Claude execution (TC-L06 through TC-L13, TC-L19).

## Test Cases

### TC-L01: Create a Loop from Template Card

**Steps:**
1. Click the "Loop" button in the top-right view mode toggle (`Chat | Team | Loop`).
2. Observe the Loop creation panel. Three template cards should be visible: "Competitive Intel Monitor", "Knowledge Base Maintenance", and "Custom".
3. Click the "Competitive Intel Monitor" template card.
4. Observe that the Name, Prompt, and Schedule fields are pre-filled with the template values.
5. Verify the schedule selector shows "Every day at 08:00" selected.
6. Click "Create Loop".

**Expected:**
- Clicking "Loop" switches the main area to the Loop view with the creation panel.
- Clicking the template card pre-fills: Name = "Competitive Intelligence Monitor", Prompt = multi-line competitive analysis prompt, Schedule = daily at 08:00.
- After clicking "Create Loop", a success confirmation appears (e.g., `loop_created` response).
- The new Loop appears in the "Active Loops" list below the creation form, showing the name, schedule, and action buttons (Edit, Run, Pause/Enable).
- The Loop also appears in the sidebar under the "LOOP HISTORY" section with a green status dot (enabled).

---

### TC-L02: Edit an Existing Loop

**Steps:**
1. In the Active Loops list, find the "Competitive Intelligence Monitor" Loop created in TC-L01.
2. Click the "Edit" button on that Loop.
3. Observe that the creation form above populates with the Loop's current values.
4. Change the name to "Daily Competitor Scan".
5. Change the schedule from "Every day at 08:00" to "Every hour" (select the hourly radio button).
6. Click "Save Changes" (the "Create Loop" button should now read "Save Changes" during edit mode).

**Expected:**
- Clicking "Edit" populates the form with the existing Loop's name, prompt, and schedule.
- The button text changes from "Create Loop" to "Save Changes".
- After saving, the Active Loops list shows the updated name "Daily Competitor Scan" and schedule "Every hour".
- The sidebar LOOP HISTORY section reflects the updated name.
- The Loop's `updatedAt` timestamp is refreshed.

---

### TC-L03: Enable/Disable a Loop

**Steps:**
1. In the Active Loops list, find the "Daily Competitor Scan" Loop.
2. Click the Pause button (toggle to disable).
3. Observe the Loop's status changes.
4. Click the Enable button (toggle back to enabled).

**Expected:**
- After disabling: the Loop row shows a "Paused" or disabled state. The sidebar LOOP HISTORY section shows a gray dot instead of green. The cron job is unscheduled (no scheduled executions will trigger).
- After re-enabling: the Loop returns to active state. The sidebar shows a green dot. The cron job is re-registered.
- The delete button (trash icon) should only appear when the Loop is disabled/paused.

---

### TC-L04: Delete a Loop

**Steps:**
1. Create a new Loop using the "Custom" template with name "Temporary Test Loop", prompt "Say hello", schedule "Every hour".
2. Disable the Loop (click the Pause button).
3. Click the delete (trash) button on the disabled Loop.
4. If a confirmation dialog appears, click "Delete".

**Expected:**
- The Loop is removed from the Active Loops list.
- The Loop is removed from the sidebar LOOP HISTORY section.
- No error messages appear.
- The Loop's cron job is stopped and removed.
- The previously created Loops (from TC-L01/L02) are unaffected.

---

### TC-L05: Create Loop with Invalid Cron Expression

**Steps:**
1. Switch to Loop view if not already there.
2. Click the "Custom" template card.
3. Enter name: "Bad Cron Test".
4. Enter prompt: "Test prompt".
5. Select the "Advanced" schedule option to reveal the raw cron expression input.
6. Enter an invalid cron expression: `* * * *` (only 4 fields instead of 5).
7. Click "Create Loop".

**Expected:**
- A validation error message appears indicating the cron expression is invalid.
- The Loop is NOT created.
- The Active Loops list does not change.
- The form remains populated so the user can correct the expression.
- Entering a valid expression (e.g., `*/5 * * * *`) and clicking "Create Loop" again should succeed.

---

### TC-L06: Run a Loop Manually via "Run Now"

**Steps:**
1. Ensure there is at least one enabled Loop in the Active Loops list (e.g., the "Daily Competitor Scan" from TC-L02, or create a new one with a simple prompt like "List the files in the current directory using ls").
2. Click the "Run" button on the Loop.
3. Wait for the execution to start and complete.

**Expected:**
- A `loop_execution_started` event fires, and the Loop shows a running indicator (spinning icon, pulsing dot, or "Running..." text).
- If the user is viewing the Loop's execution detail, the Claude output streams in real-time.
- After completion, a `loop_execution_completed` event fires.
- The Loop's "Last run" info updates in both the Active Loops list and the sidebar (e.g., "Last: just now" with a checkmark for success).
- The execution appears in the Loop's execution history (accessible by clicking the Loop).

**Key knowledge:**
- Manual trigger calls `runLoopNow(loopId)` on the agent, which invokes `executeLoop(loopId, 'manual')`.
- Execution uses the same `handleChat()` path as regular Chat, but with a `loop-` prefixed `conversationId`.
- Output is captured to `<executionId>.jsonl` and forwarded as `loop_execution_output` messages.

---

### TC-L07: Cancel a Running Loop Execution

**Steps:**
1. Create a Loop with a prompt that will produce a long response, e.g.: "Write a detailed 2000-word essay about the history of computing. Do not use any tools."
2. Click "Run" to start a manual execution.
3. Wait for streaming output to begin (some text appears in the execution detail view).
4. Click the "Cancel" button on the running execution.

**Expected:**
- The execution stops streaming output.
- The execution status changes to "cancelled" in the execution history.
- A `loop_execution_completed` event fires with `status: 'cancelled'`.
- Partial output is preserved and viewable in the execution detail.
- The Loop itself remains enabled and can be run again.
- No other Loops or Chat conversations are affected by the cancellation.

**Key knowledge:**
- Cancel calls `cancelLoopExecution(loopId)` which finds the running execution's `conversationId` and calls `claudeCancelExecution()` to kill the Claude process.
- `completeExecution(execId, 'cancelled')` marks the execution as cancelled in the index.

---

### TC-L08: View Execution Detail After Completion

**Steps:**
1. After TC-L06 (a completed manual execution), click the Loop in the Active Loops list to open its execution history.
2. Observe the execution history list.
3. Click "View" on the completed execution.

**Expected:**
- The execution history list shows at least one entry with:
  - Timestamp (e.g., "Mar 10, 14:32")
  - Duration (e.g., "0m 45s")
  - Status icon (checkmark for success, X for error, spinner for running)
  - Trigger type (manual vs. scheduled)
  - A "View" button
- Clicking "View" opens the execution detail, which shows:
  - A header with the execution timestamp, status, and duration
  - The user prompt (the Loop's prompt text)
  - Claude's assistant response rendered with full markdown formatting
  - Any tool use blocks (with tool name and input/output)
- A "Back" link returns to the Loop's execution history list.
- Another "Back" link from the execution history returns to the Loop creation panel.

---

### TC-L09: Scheduled Execution Triggers Automatically

**Steps:**
1. Create a new Loop with:
   - Name: "Every Minute Test"
   - Prompt: "What time is it right now? Reply with just the current time, nothing else. Do not use any tools."
   - Schedule: Advanced cron `* * * * *` (every minute)
2. Note the current time.
3. Wait approximately 65-75 seconds (past the next minute boundary).
4. Observe the Loop's execution history.

**Expected:**
- Within ~65 seconds, a scheduled execution automatically starts.
- A `loop_execution_started` event fires with `trigger: 'scheduled'`.
- The execution completes and appears in the Loop's execution history.
- The sidebar LOOP HISTORY section updates with the last run status.
- If a running Loop notification banner is implemented, it appears at the top of the Chat/Team view during execution.

**Key knowledge:**
- The `node-cron` scheduler fires at the start of each minute for `* * * * *`.
- The agent-side scheduler runs independently of the web UI -- executions happen even if no browser is connected.
- Overlap prevention ensures that if the execution is still running when the next minute fires, the duplicate is skipped.

---

### TC-L10: Overlap Prevention -- Running Execution Blocks Next Trigger

**Steps:**
1. Create a Loop with:
   - Name: "Slow Task"
   - Prompt: "Write a detailed explanation of the history of programming languages, covering at least 20 languages in depth. Do not use any tools."
   - Schedule: Advanced cron `* * * * *` (every minute)
2. Click "Run" to start a manual execution (or wait for the first scheduled trigger).
3. While the execution is still running (should take > 1 minute given the long prompt), wait for the next cron trigger (~60 seconds after the execution started).
4. Observe whether a second execution starts.

**Expected:**
- Only one execution should be running for this Loop at any time.
- The scheduler's overlap check (`for (const exec of runningExecutions.values()) { if (exec.loopId === loopId) return; }`) prevents a second execution from starting.
- No duplicate entries appear in the execution history while the first is still running.
- After the first execution completes, the next cron trigger will start a new execution normally.

**Cleanup:** Disable or delete the "Slow Task" Loop after this test to prevent further triggers.

---

### TC-L11: Execution History List -- Timestamps, Status, Duration

**Steps:**
1. Ensure a Loop has at least 2-3 completed executions (from previous tests, or run the "Every Minute Test" Loop for a few minutes to accumulate executions).
2. Click the Loop to open its execution history.
3. Observe the execution list entries.

**Expected:**
- Executions are listed in reverse chronological order (newest first).
- Each entry shows:
  - A status icon: checkmark for success, X for error, rotating icon for running, dash for cancelled
  - Timestamp in a readable format (e.g., "Mar 10, 14:32")
  - Duration (e.g., "1m 23s")
  - Trigger label ("scheduled" or "manual")
  - A "View" button (for completed) or "Cancel" button (for running)
- If more than 50 executions exist, pagination or "load more" may be available.

---

### TC-L12: Execution Detail -- Claude Conversation Output Rendering

**Steps:**
1. Create a Loop with a prompt that will invoke tools, e.g.: "List all JavaScript files in the current directory using the find command, then read the first 5 lines of each file."
2. Run the Loop manually and wait for completion.
3. Open the execution detail by clicking "View" on the completed execution.

**Expected:**
- The execution detail view renders a full Claude conversation:
  - **User message:** Shows the Loop's prompt text.
  - **Assistant text blocks:** Rendered with markdown formatting (headers, bold, lists, code blocks).
  - **Tool use blocks:** Show tool name (e.g., "Bash", "Read") and the tool input.
  - **Tool result blocks:** Show the output returned by the tool.
- The rendering reuses the existing message list components (`buildHistoryBatch()` and the same markdown rendering pipeline as Chat).
- Code blocks have syntax highlighting where applicable.

---

### TC-L13: Live Streaming -- View Output While Execution is Running

**Steps:**
1. Create a Loop with a moderately long prompt: "Count from 1 to 30, one number per line. After each number, write a one-sentence fun fact about that number. Do not use any tools."
2. Click "Run" to start a manual execution.
3. Immediately click into the Loop's execution history and then click the running execution to view its detail.

**Expected:**
- The execution detail view opens and shows output streaming in real-time.
- Text appears progressively (using the existing streaming animation from `streaming.js`).
- New text deltas arrive via `loop_execution_output` messages and are appended to the display.
- The view shows a running indicator (pulsing dot or spinner) while the execution is in progress.
- A "Cancel" button is available during the live stream.
- When the execution completes, the running indicator disappears and the final status (success/error) is shown.

**Key knowledge:**
- Live streaming works because `handleLoopMessage` for `loop_execution_output` calls `appendOutputToDisplay(msg.data)` when the user is viewing the matching `selectedExecution`.
- This uses the same progressive text reveal mechanism as Chat streaming.

---

### TC-L14: Sidebar -- Loop History Section Appears

**Steps:**
1. Switch to Chat view (click "Chat" in the view mode toggle).
2. Open the sidebar (if collapsed).
3. Click the "History" tab in the sidebar.
4. Scroll down past "CHAT HISTORY" and "TEAMS HISTORY" sections.

**Expected:**
- A "LOOP HISTORY" section appears as the third collapsible section in the History tab.
- The section header shows "LOOP HISTORY" with a collapse/expand arrow.
- All created Loops are listed, each showing:
  - A colored status dot: green for enabled, gray for disabled
  - The Loop name
  - Last run info: relative time + status icon (e.g., "Last: 2m ago" with a checkmark), or "Paused" if disabled, or "No runs yet" if never executed.
- If no Loops exist, the section shows "No loops yet".

---

### TC-L15: Sidebar -- Click Loop Switches to Loop View

**Steps:**
1. Be in Chat view with an active chat conversation.
2. In the sidebar LOOP HISTORY section, click on a Loop entry (e.g., "Daily Competitor Scan").

**Expected:**
- The main view switches from Chat to Loop view (`viewMode` changes to `'loop'`).
- The Loop's execution history detail view loads (not the creation panel).
- A `list_loop_executions` request is sent to fetch the execution history.
- The execution history list populates with past executions for this Loop.
- A "Back to Loops" link returns to the Loop creation panel.
- Chat state is preserved -- switching back to Chat view shows the previous conversation.

---

### TC-L16: Sidebar -- Loop Status Indicators Update

**Steps:**
1. Observe a Loop in the sidebar LOOP HISTORY section that is enabled and has recent executions.
2. Trigger a manual execution of that Loop (via "Run" button in the Active Loops list).
3. Observe the sidebar entry during execution.
4. Wait for the execution to complete.
5. Disable the Loop.

**Expected:**
- Before execution: green dot, "Last: Xm ago" with a checkmark (or cross for failed).
- During execution: the sidebar entry may show a running indicator (pulsing dot or spinner).
- After execution completes: the "Last run" info updates to "Last: just now" with a fresh status icon.
- After disabling: the dot changes from green to gray, and the meta text changes to "Paused".

---

### TC-L17: View Mode Navigation -- Switch Between Chat/Team/Loop

**Steps:**
1. Start in Chat view. Send a simple message: "Say hello. Do not use any tools."
2. Click "Team" in the view mode toggle.
3. Observe the Team creation panel.
4. Click "Loop" in the view mode toggle.
5. Observe the Loop creation panel or Loop detail view.
6. Click "Chat" in the view mode toggle.
7. Observe the Chat view.

**Expected:**
- Switching from Chat to Team: the main area shows the Team creation panel. Chat messages are not visible but are preserved in memory.
- Switching from Team to Loop: the main area shows the Loop creation panel (with template cards, form, and Active Loops list). Team state is preserved.
- Switching from Loop to Chat: the Chat view restores with the previous conversation messages visible (including the "Say hello" exchange).
- The view mode toggle visually highlights the active mode button.
- The input area (text box + send button) is only visible in Chat mode. Team and Loop modes have their own input areas or no free-form input.

---

### TC-L18: Loop View Persists Across Page Refresh

**Steps:**
1. Switch to Loop view.
2. Click on a Loop to open its execution history.
3. Refresh the browser page (F5).
4. Observe the state after refresh.

**Expected:**
- After refresh, the page reloads and reconnects to the agent.
- One of two behaviors is acceptable:
  - **Preserved state:** The view restores to Loop mode with the same Loop's execution history (if `viewMode` is persisted in `localStorage` or URL hash).
  - **Reset to Chat:** The view resets to the default Chat welcome screen (if view mode is ephemeral). This is also acceptable as long as:
    - The sidebar LOOP HISTORY section still shows all Loops (refreshed via `list_loops` on reconnect).
    - Clicking a Loop in the sidebar correctly navigates back to the Loop execution history.
- In either case, no Loops or execution history data is lost -- the agent persists everything to `loops.json` and `loop-executions/`.

---

### TC-L19: End-to-End Loop Execution Test (Full Functional)

This is the main integration test that exercises the entire Loop pipeline from creation through scheduled execution, output verification, and cleanup.

**Steps:**
1. Ensure the ephemeral server and agent are running with `--dir test/e2e-workdir`.
2. Open the web UI and switch to Loop view.
3. Click the "Custom" template card.
4. Fill in the form:
   - Name: "Git Status Report"
   - Prompt: "Run `git log --oneline -5` in the current directory and summarize the recent commits in 2-3 sentences. Keep your answer brief."
   - Schedule: select "Advanced" and enter `* * * * *` (every minute)
5. Click "Create Loop".
6. Verify the Loop appears in the Active Loops list with status enabled and schedule "every minute".
7. Note the current clock time. Wait up to 90 seconds for the first scheduled execution to trigger.
8. Observe the Loop: a `loop_execution_started` event should fire, and the Loop shows a running indicator.
9. Wait for the execution to complete (should take 15-60 seconds for a simple git log + summary).
10. Once completed, verify:
    - The execution appears in the Loop's execution history with status "success".
    - The Loop's "Last run" info updates in the Active Loops list and sidebar.
11. Click "View" on the completed execution.
12. In the execution detail view, verify:
    - The user prompt shows the git log summarization request.
    - Claude's response includes output from `git log --oneline -5` (showing actual commit hashes and messages from the `test/e2e-workdir` git history, or the parent agentlink repo).
    - The response includes a 2-3 sentence summary.
    - Tool use blocks are rendered (e.g., a "Bash" tool call for `git log`).
13. Navigate back to the Loop's execution history.
14. Disable the Loop by clicking the Pause button.
15. Note the number of executions in the history.
16. Wait 90 seconds.
17. Verify no new executions have been added to the history (the disabled Loop should not trigger).
18. Delete the Loop to clean up.

**Expected:**
- The Loop is created successfully and the cron job is registered.
- Within ~65 seconds (at the next minute boundary), the scheduler triggers `executeLoop('...', 'scheduled')`.
- The execution spawns a Claude process via `handleChat()` with the `loop-` prefixed conversationId.
- Claude executes `git log --oneline -5` using the Bash tool and produces a summary.
- The full Claude output is persisted to `<executionId>.jsonl`.
- After disabling the Loop, no further executions trigger -- confirming that `unscheduleLoop()` stopped the cron job.
- After deletion, the Loop is fully removed.

**Key knowledge:**
- The cron job fires at second 0 of each minute. If the Loop is created at 14:32:45, the first trigger is at 14:33:00 (15 seconds later). If created at 14:32:05, the first trigger is at 14:33:00 (55 seconds later). Hence the 90-second maximum wait.
- The execution uses the `workDir` stored in the Loop definition (which is `test/e2e-workdir` or whatever the agent's workDir was at creation time).
- The independent conversation quota (`MAX_LOOP_CONVERSATIONS = 3`) ensures this Loop execution does not count against the Chat conversation limit.

---

## Architecture Reference

### Agent Side (scheduler.ts)

- `loops: Loop[]` -- all Loop definitions, loaded from `~/.agentlink/loops.json` on startup.
- `cronJobs: Map<string, ScheduledTask>` -- active cron jobs keyed by Loop ID.
- `runningExecutions: Map<string, LoopExecution>` -- currently executing Loops keyed by execution ID.
- `MAX_CONCURRENT_LOOPS = 3` -- maximum number of Loop executions running simultaneously.
- Per-Loop overlap prevention: a Loop cannot have two executions running at the same time.
- Orphaned execution recovery: on startup, any execution left in `'running'` state is marked as `'error'`.

### Agent Side (claude.ts Integration)

- Loop executions use `handleChat()` with `conversationId` prefixed `loop-` (e.g., `loop-a1b2c3d4`).
- Output observer chain (`addOutputObserver` / `removeOutputObserver`) captures Loop output for persistence and forwarding.
- Separate quota: `MAX_LOOP_CONVERSATIONS = 3` vs `MAX_CHAT_CONVERSATIONS = 15`.

### Agent Side (connection.ts)

- 8 new message handlers: `create_loop`, `update_loop`, `delete_loop`, `list_loops`, `run_loop_now`, `list_loop_executions`, `get_loop_execution`, `cancel_loop_execution`.
- Loops list refreshed on connect, reconnect, and workdir change.

### Web Side (loop.js)

- Factory pattern: `createLoop(deps)` returns reactive state + methods.
- `loopsList` -- all Loop definitions (refreshed from agent).
- `selectedLoop` -- Loop selected for detail view.
- `selectedExecution` -- execution selected for replay.
- `runningLoops` -- `loopId -> LoopExecution` for currently running executions.
- `handleLoopMessage(msg)` routes all `loop_*` and `loops_list` messages.

### Web Side (connection.js)

- Loop messages (`loop_*`, `loops_list`) are intercepted and routed to `loop.handleLoopMessage()` before falling through to background conversation routing.
- Loop list refresh added to `onConnect`, `agent_reconnected`, and `workdir_changed` handlers.

### Web Side (sidebar.js)

- History tab has three collapsible sections: CHAT HISTORY, TEAMS HISTORY, LOOP HISTORY.
- Collapse state persisted to `localStorage`.
- `onLoopClick(loop)` sets `viewMode = 'loop'` and calls `loopModule.viewLoopDetail(loop.id)`.

### Persistence

```
~/.agentlink/
  loops.json                            # Array of Loop definitions
  loop-executions/
    <loopId>/
      index.jsonl                       # One LoopExecution metadata record per line
      <executionId>.jsonl               # Full Claude output messages (append-only)
```

### WebSocket Message Flow

```
Create Loop:
  Web -> create_loop -> Agent scheduler.createLoop() -> loops.json + cron job
  Agent -> loop_created -> Web loopsList.push()

Scheduled Execution:
  cron fires -> executeLoop(loopId, 'scheduled')
    -> overlap + quota check
    -> create LoopExecution, append to index.jsonl
    -> send loop_execution_started
    -> register output observer
    -> handleChat(conversationId='loop-xxxx', prompt, workDir)
       -> Claude process stdout -> observer
          -> append to <executionId>.jsonl
          -> send loop_execution_output (if web connected)
       -> on result -> completeExecution()
          -> update index.jsonl, loops.json lastExecution
          -> send loop_execution_completed

View History:
  Web clicks Loop -> list_loop_executions -> Agent reads index.jsonl -> loop_executions_list
  Web clicks View -> get_loop_execution -> Agent reads <executionId>.jsonl -> loop_execution_detail
```

## Test Results Log

| # | Test | Status |
|---|------|--------|
| L01 | Create a Loop from template card | |
| L02 | Edit an existing Loop | |
| L03 | Enable/Disable a Loop | |
| L04 | Delete a Loop | |
| L05 | Create Loop with invalid cron expression | |
| L06 | Run a Loop manually via "Run Now" | |
| L07 | Cancel a running Loop execution | |
| L08 | View execution detail after completion | |
| L09 | Scheduled execution triggers automatically | |
| L10 | Overlap prevention -- running execution blocks next trigger | |
| L11 | Execution history list -- timestamps, status, duration | |
| L12 | Execution detail -- Claude conversation output rendering | |
| L13 | Live streaming -- view output while execution is running | |
| L14 | Sidebar -- Loop History section appears | |
| L15 | Sidebar -- click Loop switches to Loop view | |
| L16 | Sidebar -- Loop status indicators update | |
| L17 | View mode navigation -- switch between Chat/Team/Loop | |
| L18 | Loop view persists across page refresh | |
| L19 | End-to-end Loop execution test (full functional) | |
