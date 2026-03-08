# Agent Team — Implementation Plan

**Branch:** `feature/agent-team`
**Design doc:** `docs/agent-team-design.md`

---

## Phase 1: Agent-Side Foundation — `claude.ts` Hooks

Minimal, backward-compatible changes to `claude.ts` to support team mode.
No functional change to existing solo chat.

### 1.1 `handleChat()` accepts `extraArgs`

- Change `handleChat()` signature: add optional `options` object with `extraArgs?: string[]` and `resumeSessionId?: string`
- In `startQuery()`, append `options.extraArgs` to the claude spawn args array
- Migrate existing `resumeSessionId` parameter into the options object
- Update all callers in `connection.ts` to use the new signature

**Verify:** `npm test` passes. Existing solo chat works unchanged.

### 1.2 Output observer hook

- Add module-level `outputObserver` callback slot
- Export `setOutputObserver(fn)` / `clearOutputObserver()`
- In `processOutput()`, call `outputObserver(conversationId, rawMsg)` for every parsed JSON line (before any filtering/transformation)
- Observer is called for ALL message types including `system`, `assistant`, `user`, `result`

**Verify:** `npm test` passes. Add unit test: set observer, simulate messages, assert observer receives them.

---

## Phase 2: Agent-Side — `team.ts` Core Module

### 2.1 Data types and TeamState management

- Create `agent/src/team.ts`
- Define all interfaces: `TeamConfig`, `AgentRole`, `TaskItem`, `TeamState`, `AgentTeammate`, `TeamAgentMessage`, `TeamFeedEntry`
- Implement `createTeam(config, workDir, sendFn)` → initializes TeamState, status=`planning`
- Implement `getActiveTeam()`, `getTeam(teamId)`
- Color palette constant for auto-assigning agent colors

**Verify:** Unit test: create team, verify initial state.

### 2.2 Lead prompt construction

- Implement `buildLeadPrompt(config)` → constructs the system prompt for the Lead
- Implement `buildAgentsDef(template?)` → constructs the `--agents` JSON
- Templates: `code-review`, `full-stack`, `debug`, `custom` (custom = no predefined agents, Lead decides)
- For `custom` template, agents JSON is a generic set of utility agents

**Verify:** Unit test: each template produces valid agents JSON + lead prompt.

### 2.3 Output stream parser — core routing logic

- Implement `onLeadOutput(conversationId, rawMsg)` — the output observer callback
- Detection logic:
  1. `assistant` msg with `tool_use.name === 'Agent'` → `registerSubagent(block.id, block.input)`
  2. `system.subtype === 'task_started'` → `linkSubagentTaskId(tool_use_id, task_id)`
  3. Any msg with `parent_tool_use_id` → `routeToAgent(agent, rawMsg)`
  4. `tool_use_result.status === 'completed'` → mark agent done
  5. Lead's own text (no `parent_tool_use_id`, after subagents) → capture as summary
  6. `result` msg → team completed
- Each detection step emits the appropriate WebSocket message (`team_agent_status`, `team_task_update`, `team_feed`, `team_completed`)
- Suppress subagent messages from normal `claude_output` forwarding (return a flag or use observer return value)

**Verify:** Unit test: feed mock stream-json sequences, assert correct state transitions and emitted messages.

### 2.4 Team persistence

- Implement `persistTeam(teamState)` → write to `~/.agentlink/teams/<teamId>.json`
- Implement `loadTeam(teamId)` → read from disk
- Implement `listTeams()` → scan directory, return summaries sorted by time
- Atomic write (write to `.tmp`, rename)
- Called on every state change (debounced)

**Verify:** Unit test: persist → load round-trip. List returns correct entries.

### 2.5 Team lifecycle: create, dissolve, complete

- `createTeam()`: creates TeamState, calls `handleChat()` with `extraArgs: ['--agents', JSON]`, registers output observer
- `dissolveTeam(teamId)`: calls `cancelExecution(conversationId)`, sets status=`failed`, persists, sends `team_completed` with status=failed
- On `result` message: set status=`completed`, capture summary, persist, send `team_completed`
- Enforce one active team at a time

**Verify:** Integration-style test: mock `handleChat`, verify full lifecycle from create → complete.

### 2.6 Wire into `connection.ts`

- Add message handlers: `create_team`, `dissolve_team`, `list_teams`, `get_team`, `get_team_agent_history`
- `create_team` → `team.createTeam()`
- `dissolve_team` → `team.dissolveTeam()`
- `list_teams` → `team.listTeams()` → send `teams_list`
- `get_team` → `team.loadTeam()` → send `team_detail`
- `get_team_agent_history` → read subagent JSONL → send parsed messages

**Verify:** `npm run build` succeeds. `npm test` passes. Existing message handlers unchanged.

---

## Phase 3: Web UI — Team State Module + Connection Routing

### 3.1 Create `modules/team.js`

- `createTeam(deps)` factory function
- Reactive state: `teamState`, `activeAgentView`, `teamMode`, `historicalTeam`
- Methods: `launchTeam(config)`, `dissolveTeam()`, `viewAgent(agentId)`, `viewDashboard()`, `viewHistoricalTeam(teamId)`, `handleTeamMessage(msg)`, `getAgentColor(agentId)`
- `handleTeamMessage()` routes incoming `team_created`, `team_agent_status`, `team_task_update`, `team_feed`, `team_completed`, `teams_list`, `team_detail`

**Verify:** Module loads without errors. Unit-testable logic (state transitions).

### 3.2 Create `modules/taskBoard.js`

- `createTaskBoard(deps)` factory
- Computed properties: `pendingTasks`, `activeTasks`, `doneTasks`, `failedTasks`
- Derived from `teamState.tasks`

**Verify:** Computed properties react to task status changes.

### 3.3 Extend `connection.js` for team messages

- In `ws.onmessage`: detect `team_*` message types → route to `team.handleTeamMessage()`
- For `claude_output` with `teamId` + `agentRole`: route to team module's per-agent message accumulator instead of main message list
- For `turn_completed` with `teamId`: route to team module
- Background conversation routing: skip team messages (they use a different state path)

**Verify:** Solo chat still works. Team messages are routed correctly (manual test with mock messages).

---

## Phase 4: Web UI — Team Dashboard Rendering

### 4.1 Team mode toggle in `app.js`

- Add team mode toggle UI: `[Chat] [Team]` in input area
- When Team mode active: show team creation panel instead of normal chat input
- Wire `team.js` module into app setup
- Expose team state + methods to template

### 4.2 Team creation panel

- Textarea for task description
- Template buttons: Code Review, Full-stack Dev, Debug Analysis, Custom
- "Launch Team" button → calls `team.launchTeam()`
- After launch: UI switches to team dashboard

### 4.3 Team dashboard — Lead planning view

- Show when `teamState.status === 'planning'`
- Display Lead's streamed output (reuse message rendering)
- Pulsing status indicator

### 4.4 Team dashboard — Kanban board

- Three columns: Pending, Active, Done
- Task cards with: title, assignee (color dot + name), dependency links
- Cards animate between columns on status change

### 4.5 Team dashboard — Activity feed

- Scrollable timeline of `TeamFeedEntry` items
- Color-coded by agent
- Capped at 200 entries

### 4.6 Team sidebar — Agent list

- Left sidebar shows team members when in team mode
- Color dot + name + status + task progress
- Click agent → switch to agent detail view

**Verify:** Full visual test: launch a team (mock data), see dashboard render with kanban + feed + sidebar.

---

## Phase 5: Web UI — Agent Detail View

### 5.1 Agent detail view

- Displays when `activeAgentView !== null`
- "Back to dashboard" button
- Agent name + color header
- Message list: reuse existing message rendering (markdown, tool calls, code highlighting)
- Messages sourced from `teamState.agents[agentId].messages`

### 5.2 Agent message routing from stream

- `claude_output` with `agentRole` → append to correct agent's message list
- If agent detail view is active for that agent → live streaming animation
- If agent detail view is not active → silent accumulation (no animation)

**Verify:** Click agent → see their conversation. Switch between agents. Messages appear in correct agent.

---

## Phase 6: Web UI — Team Completion + History

### 6.1 Team completion view

- Show when `teamState.status === 'completed'`
- All tasks in "Done" column
- Lead's summary rendered as markdown
- Stats: total cost, duration, task counts
- Buttons: "Back to Chat", "New team with same task"

### 6.2 Sidebar — Mixed session list (team + solo)

- `list_teams` request on connect
- Team entries in sidebar: icon, title, status, task count, cost
- Sorted by time alongside solo sessions
- Click historical team → `team.viewHistoricalTeam()` → read-only dashboard

### 6.3 Historical team dashboard

- Read-only: no input box, no cancel button
- Task board shows final state
- Click agent → view their conversation history (from subagent JSONL)
- "New team with same task" button

**Verify:** Complete flow: create team → complete → see in sidebar → click → read-only view.

---

## Phase 7: Polish + Error Handling

### 7.1 Error handling

- Lead crash → team status = `failed`, all tasks = `failed`
- Single subagent error → task = `failed`, team continues
- Network disconnect during team → state persisted, reconnect shows frozen state

### 7.2 Cancel / dissolve

- Single agent card stop button (V2 — skip for now, needs `team_message`)
- Global "Dissolve Team" button → kills Lead process → team failed

### 7.3 Page refresh recovery

- On reconnect: if active team exists, send current `teamState` to web
- Web restores dashboard from received state
- `query_active_conversations` extended to report team info

### 7.4 CSS + responsive layout

- Team dashboard responsive for mobile
- Task card detail popover on click
- Agent status pulsing animation
- Dark/light theme support for all team UI

### 7.5 Cost display

- Aggregate cost from `result.total_cost_usd`
- Display in completion view and sidebar team entry

**Verify:** Full E2E test with real Claude process (manual). Error scenarios tested.

---

## Execution Order

| Step | Task | Dependencies |
|------|------|-------------|
| 1 | Phase 1.1: `handleChat()` extraArgs | — |
| 2 | Phase 1.2: Output observer hook | 1 |
| 3 | Phase 2.1: Data types + TeamState | — |
| 4 | Phase 2.2: Lead prompt construction | 3 |
| 5 | Phase 2.3: Output stream parser | 2, 3 |
| 6 | Phase 2.4: Team persistence | 3 |
| 7 | Phase 2.5: Team lifecycle | 1, 4, 5, 6 |
| 8 | Phase 2.6: Wire into connection.ts | 7 |
| 9 | Phase 3.1: team.js module | — |
| 10 | Phase 3.2: taskBoard.js module | 9 |
| 11 | Phase 3.3: connection.js routing | 9 |
| 12 | Phase 4.1-4.6: Dashboard rendering | 9, 10, 11 |
| 13 | Phase 5.1-5.2: Agent detail view | 12 |
| 14 | Phase 6.1-6.3: Completion + history | 12, 13 |
| 15 | Phase 7.1-7.5: Polish | 14 |

Steps 1-2 and 3-4 can be done in parallel. Steps 9-11 can start before 8 is done.
