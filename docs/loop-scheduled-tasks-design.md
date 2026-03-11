# Loop (Scheduled Tasks) Design Document

**Status:** Draft v1
**Date:** 2026-03-10
**Author:** Claude (with Kailun)

## 1. Overview

Add a **Loop** feature to AgentLink that lets users create scheduled tasks (cron-based) from the web UI. Tasks are defined as prompts sent to Claude on a recurring schedule (hourly / daily / weekly / custom cron). The agent daemon executes them in the background, persists both results and process output, and streams real-time progress to the web UI when connected.

Loop joins Chat and Team as the third top-level view in the web UI, accessible via the right-hand mode toggle: `Chat | Team | Loop`.

### Design Principles

- **Loop = a scheduled, unattended Chat** — reuse `claude.ts`'s multi-conversation infrastructure to spawn and manage Loop executions. Each execution is one Claude conversation turn.
- **Agent-side scheduling** — the cron scheduler runs in the agent daemon, independent of web UI or server. Tasks execute even when no browser is connected.
- **Full persistence** — both Loop definitions and execution output are persisted to disk. Users can review past executions at any time.
- **Independent quota** — Loop executions use a separate conversation quota from interactive Chat sessions to prevent scheduled tasks from starving foreground work.

## 2. Scope

### In Scope
- Loop CRUD: create, update, enable/disable, delete scheduled tasks from web UI
- Schedule presets: hourly, daily (at specific time), weekly (day + time), advanced cron
- Loop templates: predefined sample cases ("Try it") for common tasks (competitive intelligence monitoring, knowledge base maintenance, etc.) plus Custom
- Manual trigger: "Run Now" to execute a Loop immediately
- Execution history: list past executions with status, duration, and timestamp
- Execution detail: view full Claude conversation output for any past execution
- Real-time streaming: when web UI is connected, see Loop execution output live
- Sidebar integration: Loop history section in the new "History" tab
- Independent conversation quota for Loop executions

### Out of Scope
- Event-driven triggers (file watcher, git hook) — future enhancement
- Task chains / pipelines (Loop A triggers Loop B) — future enhancement
- External notifications (email, webhook, Slack) — future enhancement
- Token budget or timeout per Loop — not planned
- Loop execution inside Team mode (Loop only runs single-agent Chat)

## 3. User Experience

### 3.1 Top-Level Navigation

The existing `Chat | Team` toggle becomes `Chat | Team | Loop`:

```
┌─────────────────────────────────────────────────────────────┐
│  AgentLink                              [Chat] [Team] [Loop] │
└─────────────────────────────────────────────────────────────┘
```

Clicking Loop switches the main area to the Loop view. The state variable `teamMode` is renamed to `viewMode` with values `'chat' | 'team' | 'loop'`.

### 3.2 Loop Creation Panel

When `viewMode === 'loop'` and no Loop is selected for detail view, the main area shows the creation panel with templates and existing Loops:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  ┌────────────┐ ┌────────────┐ ┌──────────┐                      │
│  │ Competitive│ │ Knowledge  │ │ Custom   │                      │
│  │ Intel      │ │ Base       │ │          │                      │
│  │ Monitor    │ │ Maintain   │ │          │                      │
│  └────────────┘ └────────────┘ └──────────┘                      │
│                                                                  │
│  Name:  [Competitive Intelligence Monitor_______________]            │
│                                                                  │
│  Prompt:                                                        │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ Monitor competitor and industry developments:          │     │
│  │ 1. Scan specified directories for competitor intel     │     │
│  │ 2. Summarize key product launches, pricing changes     │     │
│  │ 3. Highlight strategic threats and opportunities       │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│  Schedule:                                                      │
│  ┌────────────────────────────────────────────────────────┐     │
│  │  ○ Every hour                                          │     │
│  │  ● Every day at [09:00]                                │     │
│  │  ○ Every week on [Monday ▼] at [09:00]                 │     │
│  │  ○ Advanced:  [0 9 * * *___________]                   │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
│                                           [Create Loop]         │
│                                                                  │
│  ──── Active Loops ─────────────────────────────────────────    │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ Competitive Intel Monitor   Every day 08:00           │     │
│  │ Last: 2h ago ✓                   [Edit] [▶ Run] [⏸]   │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │ Knowledge Base Maintenance  Every Fri 20:00           │     │
│  │ Last: 3d ago ✓                   [Edit] [▶ Run] [⏸]   │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Template cards (Try it):** Clicking a sample case pre-fills Name, Prompt, and Schedule. User can modify before creating. Same UX pattern as Team templates.

**Schedule selector:** Radio buttons for common presets. "Advanced" reveals a cron expression input. The UI converts between presets and cron internally:
- Every hour → `0 * * * *`
- Every day at HH:MM → `MM HH * * *`
- Every week on DAY at HH:MM → `MM HH * * DOW`
- Advanced → raw cron string (validated before submit)

**Active Loops list:** Shows all created Loops with status, last run info, and action buttons:
- `[Edit]` — populates the form above for editing (changes button to "Save Changes")
- `[▶ Run]` — triggers immediate execution
- `[⏸]` / `[▶]` — toggle enable/disable
- `[🗑]` — delete (only shown when paused/disabled)

### 3.3 Loop Execution Detail View

Clicking a Loop in the Active Loops list or sidebar opens its execution history:

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Loops                                                │
│                                                                  │
│  Competitive Intelligence Monitor                                  │
│  Every day at 08:00  |  Enabled  ●                [Edit] [▶ Run] │
│                                                                  │
│  ──── Execution History ────────────────────────────────────    │
│                                                                  │
│  ⟳ Mar 10, 09:00   Running...                       [Cancel]   │
│  ✓  Mar 9,  09:00   1m 58s                           [View]    │
│  ✗  Mar 8,  09:00   0m 12s  Error: process exited    [View]    │
│  ✓  Mar 7,  09:00   3m 01s                           [View]    │
│  ✓  Mar 6,  09:00   2m 15s                           [View]    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Clicking `[View]` loads the full Claude conversation for that execution into the main area, reusing the existing message rendering (markdown, tool calls, streaming animation):

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Competitive Intelligence Monitor                        │
│                                                                  │
│  Execution: Mar 9, 09:00  |  ✓ Completed in 1m 58s             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐     │
│  │ User:                                                  │     │
│  │ Monitor competitor and industry developments...       │     │
│  ├────────────────────────────────────────────────────────┤     │
│  │ Assistant:                                             │     │
│  │ I'll scan the tracked competitor data. Let me start... │     │
│  │                                                        │     │
│  │ [Tool: Bash] git log --since="24 hours ago"            │     │
│  │ ▸ Output: 3 commits found...                           │     │
│  │                                                        │     │
│  │ [Tool: Read] agent/src/claude.ts                       │     │
│  │                                                        │     │
│  │ ## Review Summary                                      │     │
│  │ ### Commit eff03e6 — Agent naming change               │     │
│  │ - No security issues                                   │     │
│  │ - Clean rename, no side effects                        │     │
│  │ ...                                                    │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Live execution:** If a Loop is currently running and the user clicks into it, they see the output streaming in real-time (using existing `streaming.js` progressive text reveal). A running execution shows a pulsing indicator and `[Cancel]` button.

### 3.4 Sidebar: History Tab with Three Sections

The sidebar already has `History | Files` tabs with Chat History and Teams History as collapsible sections. Loop adds a third section:

```
┌─────────────────────────────┐
│  [History]  [Files]         │
├─────────────────────────────┤
│                             │
│  ▼ CHAT HISTORY             │
│    Fix login bug      2h ago│
│    Add dark mode      1d ago│
│    Refactor API       3d ago│
│                             │
│  ▼ TEAMS HISTORY            │
│    Code Review Team   2h ago│
│    Full-Stack Build   1d ago│
│                             │
│  ▼ LOOP HISTORY             │
│    🟢 Competitive Intel    │
│       Last: 2h ago ✓        │
│    🟢 Knowledge Base       │
│       Next: Fri 20:00       │
│                             │
└─────────────────────────────┘
```

**Behavior:**

- **CHAT HISTORY** — existing session list (from `historySessions`). Clicking → switches to Chat view + resumes session.
- **TEAMS HISTORY** — existing team history list (from `team.teamsList`). Clicking → switches to Team view + loads historical team.
- **LOOP HISTORY** — Loop task list (from `loop.loopsList`). Shows enabled/paused status + last run info. Clicking → switches to Loop view + shows execution history for that Loop.
- Each section is independently collapsible. Collapse state persisted to `localStorage`.
- Default: all three sections expanded.
- On mobile, the sidebar `sidebarView` logic remains — History and Files are still separate sidebar modes.

### 3.5 Running Loop Notification

When a Loop is executing and the user is in Chat or Team view, a non-intrusive banner appears at the top of the main area:

```
┌─────────────────────────────────────────────────────────────┐
│ ⟳ Loop "Competitive Intelligence Monitor" is running...     [View] │
└─────────────────────────────────────────────────────────────┘
```

Clicking `[View]` switches to Loop view and opens the running execution's live output.

## 4. Technical Design

### 4.1 Rename: `teamMode` → `viewMode`

The existing `teamMode` ref (`'chat' | 'team'`) is renamed to `viewMode` with values `'chat' | 'team' | 'loop'`.

**Files affected:**
- `server/web/app.js` — ref declaration, template `v-if` conditions, return statement
- `server/web/modules/team.js` — `teamMode` ref (keep the ref inside team.js but rename to `viewMode` or have app.js own it and pass down)
- `server/web/modules/sidebar.js` — `_onSwitchToChat` callback

**Approach:** `viewMode` is owned by `app.js` and passed into `team.js` and `loop.js` as a dep. Both modules read it and can set it. This avoids the current pattern where `teamMode` lives inside `team.js` but is also referenced by `app.js`.

```javascript
// app.js
const viewMode = ref('chat');  // replaces teamMode

const team = createTeam({ wsSend, scrollToBottom, viewMode });
const loop = createLoop({ wsSend, scrollToBottom, viewMode });
```

**Template change:**

```html
<!-- Top-right toggle -->
<div class="view-mode-toggle">
  <button :class="['view-mode-btn', { active: viewMode === 'chat' }]"
          @click="viewMode = 'chat'">Chat</button>
  <button :class="['view-mode-btn', { active: viewMode === 'team' }]"
          @click="viewMode = 'team'; team.requestTeamsList()">Team</button>
  <button :class="['view-mode-btn', { active: viewMode === 'loop' }]"
          @click="viewMode = 'loop'; loop.requestLoopsList()">Loop</button>
</div>

<!-- Main area -->
<template v-if="viewMode === 'team'">
  <!-- existing team dashboard -->
</template>
<template v-else-if="viewMode === 'loop'">
  <!-- loop creation panel or execution detail -->
</template>
<template v-else>
  <!-- existing chat message list -->
</template>

<!-- Input area: hidden in team and loop modes -->
<div class="input-area" v-if="viewMode === 'chat'">
```

### 4.2 Sidebar Restructure

**Current state:** Sidebar has `History | Files` tabs. History tab shows Chat History (collapsible, above) and Teams History (collapsible, below). Chat sessions are grouped by Today/Yesterday/This week/Earlier.

**New state:** History tab contains three collapsible sections: Chat History, Teams History, and Loop History (in that order). Only the Loop History section is new.

#### State Changes in `sidebar.js`

```javascript
// New refs
const sidebarTab = ref('history');             // 'history' | 'files' (replaces implicit sessions-vs-files logic)
const teamsCollapsed = ref(false);             // persisted to localStorage
const chatsCollapsed = ref(false);
const loopsCollapsed = ref(false);

// On init, restore from localStorage
teamsCollapsed.value = localStorage.getItem('sidebar-teams-collapsed') === 'true';
chatsCollapsed.value = localStorage.getItem('sidebar-chats-collapsed') === 'true';
loopsCollapsed.value = localStorage.getItem('sidebar-loops-collapsed') === 'true';

// Toggle functions
function toggleTeamsCollapsed() {
  teamsCollapsed.value = !teamsCollapsed.value;
  localStorage.setItem('sidebar-teams-collapsed', teamsCollapsed.value);
}
// ... same for chats, loops
```

#### Template Structure

```html
<!-- Sidebar tabs -->
<div class="sidebar-tabs">
  <button :class="{ active: sidebarTab === 'history' }" @click="sidebarTab = 'history'">History</button>
  <button :class="{ active: sidebarTab === 'files' }" @click="sidebarTab = 'files'">Files</button>
</div>

<!-- History tab content -->
<div v-if="sidebarTab === 'history'" class="sidebar-history">

  <!-- Chat History -->
  <div class="history-section">
    <div class="history-section-header" @click="toggleChatsCollapsed()">
      <span class="collapse-icon">{{ chatsCollapsed ? '▶' : '▼' }}</span>
      CHAT HISTORY
    </div>
    <div v-if="!chatsCollapsed" class="history-section-body">
      <div v-for="group in groupedSessions" :key="group.label">
        <div class="history-group-label">{{ group.label }}</div>
        <div v-for="s in group.sessions" :key="s.sessionId"
             class="history-item" @click="onChatClick(s)">
          <div class="history-item-title">{{ s.title }}</div>
          <div class="history-item-meta">{{ formatRelativeTime(s.lastModified) }}</div>
        </div>
      </div>
      <div v-if="historySessions.length === 0" class="history-empty">No conversations yet</div>
    </div>
  </div>

  <!-- Teams History -->
  <div class="history-section">
    <div class="history-section-header" @click="toggleTeamsCollapsed()">
      <span class="collapse-icon">{{ teamsCollapsed ? '▶' : '▼' }}</span>
      TEAMS HISTORY
    </div>
    <div v-if="!teamsCollapsed" class="history-section-body">
      <div v-for="t in teamsList" :key="t.teamId"
           class="history-item" @click="onTeamClick(t)">
        <div class="history-item-title">{{ t.title }}</div>
        <div class="history-item-meta">{{ formatRelativeTime(t.createdAt) }}</div>
      </div>
      <div v-if="teamsList.length === 0" class="history-empty">No teams yet</div>
    </div>
  </div>

  <!-- Loop History -->
  <div class="history-section">
    <div class="history-section-header" @click="toggleLoopsCollapsed()">
      <span class="collapse-icon">{{ loopsCollapsed ? '▶' : '▼' }}</span>
      LOOP HISTORY
    </div>
    <div v-if="!loopsCollapsed" class="history-section-body">
      <div v-for="l in loopsList" :key="l.id"
           class="history-item" @click="onLoopClick(l)">
        <div class="history-item-title">
          <span :class="l.enabled ? 'status-dot-green' : 'status-dot-gray'"></span>
          {{ l.name }}
        </div>
        <div class="history-item-meta">
          <template v-if="l.enabled && l.lastExecution">
            Last: {{ formatRelativeTime(l.lastExecution.startedAt) }}
            <span :class="l.lastExecution.status === 'success' ? 'status-ok' : 'status-err'">
              {{ l.lastExecution.status === 'success' ? '✓' : '✗' }}
            </span>
          </template>
          <template v-else-if="!l.enabled">Paused</template>
          <template v-else>No runs yet</template>
        </div>
      </div>
      <div v-if="loopsList.length === 0" class="history-empty">No loops yet</div>
    </div>
  </div>

</div>

<!-- Files tab content (unchanged) -->
<div v-if="sidebarTab === 'files'" class="sidebar-files">
  <!-- existing file browser -->
</div>
```

#### Click Handlers

```javascript
function onTeamClick(team) {
  closeSidebarOnMobile();
  viewMode.value = 'team';
  teamModule.viewHistoricalTeam(team.teamId);
}

function onChatClick(session) {
  closeSidebarOnMobile();
  viewMode.value = 'chat';
  resumeSession(session);  // existing logic
}

function onLoopClick(loop) {
  closeSidebarOnMobile();
  viewMode.value = 'loop';
  loopModule.viewLoopDetail(loop.id);
}
```

### 4.3 Agent-Side: `agent/src/scheduler.ts`

New module responsible for Loop lifecycle.

#### Data Types

```typescript
export interface Loop {
  id: string;                                  // UUID
  name: string;                                // user-visible name
  prompt: string;                              // prompt sent to Claude
  schedule: string;                            // cron expression
  scheduleType: 'hourly' | 'daily' | 'weekly' | 'cron';
  scheduleConfig: {                            // for UI-friendly reconstruction
    hour?: number;                             // 0-23
    minute?: number;                           // 0-59
    dayOfWeek?: number;                        // 0-6 (Sunday=0)
  };
  workDir: string;
  enabled: boolean;
  createdAt: string;                           // ISO timestamp
  updatedAt: string;                           // ISO timestamp
  lastExecution?: LoopExecutionSummary;        // denormalized for quick sidebar display
}

export interface LoopExecution {
  id: string;                                  // UUID
  loopId: string;
  status: 'running' | 'success' | 'error' | 'cancelled';
  trigger: 'scheduled' | 'manual';             // how it was triggered
  startedAt: string;                           // ISO timestamp
  completedAt?: string;                        // ISO timestamp
  durationMs?: number;
  claudeSessionId?: string;                    // links to Claude JSONL for full history
  conversationId?: string;                     // multi-session conversation ID
  summary?: string;                            // extracted from Claude result
  error?: string;                              // error message if status='error'
}

export type LoopExecutionSummary = Pick<LoopExecution,
  'id' | 'status' | 'startedAt' | 'durationMs' | 'trigger'>;
```

#### Persistence

```
~/.agentlink/
├── loops.json                          # Array of Loop definitions
└── loop-executions/
    ├── <loopId-1>/
    │   ├── index.jsonl                 # One line per execution (LoopExecution metadata)
    │   ├── <executionId-a>.jsonl       # Full Claude output (message-by-message)
    │   └── <executionId-b>.jsonl
    └── <loopId-2>/
        └── ...
```

**`loops.json`** — Array of `Loop` objects. Written atomically (write `.tmp`, rename). Loaded on daemon startup.

**`loop-executions/<loopId>/index.jsonl`** — Append-only JSONL, one `LoopExecution` metadata record per line. Used for listing execution history without reading individual execution files.

**`loop-executions/<loopId>/<executionId>.jsonl`** — Append-only JSONL, each line is a Claude output message (same format as what `processOutput()` emits). Written in real-time during execution. Used for replaying execution detail ("View" button).

#### Scheduler Core

```typescript
import cron from 'node-cron';

const MAX_CONCURRENT_LOOPS = 3;

let loops: Loop[] = [];
const cronJobs = new Map<string, cron.ScheduledTask>();
const runningExecutions = new Map<string, LoopExecution>();  // executionId → execution

let sendFn: ((msg: Record<string, unknown>) => void) | null = null;
let handleChatFn: typeof handleChat | null = null;

export function initScheduler(deps: {
  send: typeof sendFn;
  handleChat: typeof handleChatFn;
}): void {
  sendFn = deps.send;
  handleChatFn = deps.handleChat;
  loops = loadLoopsFromDisk();
  for (const loop of loops) {
    if (loop.enabled) scheduleLoop(loop);
  }
}

export function shutdownScheduler(): void {
  for (const [, job] of cronJobs) {
    job.stop();
  }
  cronJobs.clear();
  // Note: running executions are NOT cancelled on shutdown.
  // They complete naturally via the Claude process.
  // Execution metadata will show status='running' until agent restarts
  // and reconciles (marks orphaned running executions as 'error').
}
```

#### Scheduling and Execution

```typescript
function scheduleLoop(loop: Loop): void {
  if (cronJobs.has(loop.id)) {
    cronJobs.get(loop.id)!.stop();
  }
  const job = cron.schedule(loop.schedule, () => {
    executeLoop(loop.id, 'scheduled');
  });
  cronJobs.set(loop.id, job);
}

function unscheduleLoop(loopId: string): void {
  const job = cronJobs.get(loopId);
  if (job) {
    job.stop();
    cronJobs.delete(loopId);
  }
}

async function executeLoop(loopId: string, trigger: 'scheduled' | 'manual'): Promise<void> {
  const loop = loops.find(l => l.id === loopId);
  if (!loop || !loop.enabled) return;

  // Check concurrent Loop quota
  if (runningExecutions.size >= MAX_CONCURRENT_LOOPS) {
    // Skip this scheduled run; log warning
    return;
  }

  // Check if this specific Loop already has a running execution (prevent overlap)
  for (const exec of runningExecutions.values()) {
    if (exec.loopId === loopId) return;
  }

  const executionId = randomUUID();
  const conversationId = `loop-${executionId.slice(0, 8)}`;

  const execution: LoopExecution = {
    id: executionId,
    loopId,
    status: 'running',
    trigger,
    startedAt: new Date().toISOString(),
    conversationId,
  };

  runningExecutions.set(executionId, execution);
  appendExecutionIndex(loopId, execution);

  // Notify web UI
  sendFn?.({
    type: 'loop_execution_started',
    loopId,
    execution: { ...execution },
  });

  // Set up output observer to capture messages to JSONL
  const outputFile = getExecutionOutputPath(loopId, executionId);
  setLoopOutputObserver(conversationId, outputFile);

  // Execute via existing claude.ts handleChat
  try {
    await handleChatFn!(conversationId, loop.prompt, loop.workDir, {});
    // Note: handleChat returns immediately after enqueuing.
    // Execution completion is detected via the turn_completed/result message
    // in the output observer.
  } catch (err) {
    completeExecution(executionId, 'error', String(err));
  }
}
```

#### Output Capture

The scheduler registers an output observer for Loop conversations, similar to how `team.ts` registers `onLeadOutput`:

```typescript
function onLoopOutput(
  conversationId: string,
  msg: Record<string, unknown>
): boolean {
  const execution = findExecutionByConversationId(conversationId);
  if (!execution) return false;

  // 1. Append raw message to execution JSONL file
  appendToExecutionLog(execution.loopId, execution.id, msg);

  // 2. Forward to web UI with loop context
  sendFn?.({
    type: 'loop_execution_output',
    loopId: execution.loopId,
    executionId: execution.id,
    data: msg,
  });

  // 3. Capture session ID
  if (msg.type === 'system' && msg.session_id) {
    execution.claudeSessionId = msg.session_id as string;
  }

  // 4. Detect completion
  if (msg.type === 'result') {
    const summary = extractSummary(msg);
    const isError = (msg as any).is_error || (msg as any).subtype === 'error_response';
    completeExecution(execution.id, isError ? 'error' : 'success', undefined, summary);
  }

  return false;  // don't suppress — let normal forwarding happen too
}

function completeExecution(
  executionId: string,
  status: 'success' | 'error' | 'cancelled',
  error?: string,
  summary?: string,
): void {
  const execution = runningExecutions.get(executionId);
  if (!execution) return;

  execution.status = status;
  execution.completedAt = new Date().toISOString();
  execution.durationMs = Date.now() - new Date(execution.startedAt).getTime();
  execution.summary = summary;
  execution.error = error;

  runningExecutions.delete(executionId);

  // Update execution index on disk
  updateExecutionIndex(execution.loopId, execution);

  // Update Loop's lastExecution
  const loop = loops.find(l => l.id === execution.loopId);
  if (loop) {
    loop.lastExecution = {
      id: execution.id,
      status: execution.status,
      startedAt: execution.startedAt,
      durationMs: execution.durationMs,
      trigger: execution.trigger,
    };
    saveLoopsToDisk();
  }

  // Notify web UI
  sendFn?.({
    type: 'loop_execution_completed',
    loopId: execution.loopId,
    execution: { ...execution },
  });
}
```

#### Integration with `claude.ts`

Loop needs two integration points with `claude.ts`:

**1. Output observer for Loop conversations.**

`claude.ts` already has `setOutputObserverFn()` used by Team. This needs to become multi-observer or per-conversation:

```typescript
// Current: single global observer
let outputObserverFn: ((convId: string, msg: any) => boolean) | null = null;

// Change to: observer chain
const outputObservers: ((convId: string, msg: any) => boolean)[] = [];

export function addOutputObserver(fn: (convId: string, msg: any) => boolean): void {
  outputObservers.push(fn);
}

export function removeOutputObserver(fn: (convId: string, msg: any) => boolean): void {
  const idx = outputObservers.indexOf(fn);
  if (idx >= 0) outputObservers.splice(idx, 1);
}

// In processOutput(), replace single observer call with chain:
for (const observer of outputObservers) {
  if (observer(state.conversationId, msg)) break;  // suppressed
}
```

**2. Independent conversation quota.**

Current: `MAX_CONVERSATIONS = 15` for all conversations.

Change: separate quota for Loop conversations.

```typescript
const MAX_CHAT_CONVERSATIONS = 15;
const MAX_LOOP_CONVERSATIONS = 3;   // exported, set by scheduler

function isLoopConversation(conversationId: string): boolean {
  return conversationId.startsWith('loop-');
}

// In evictOldestIdle() and capacity checks:
function getConversationCount(type: 'chat' | 'loop'): number {
  let count = 0;
  for (const [id] of conversations) {
    if (type === 'loop' && isLoopConversation(id)) count++;
    if (type === 'chat' && !isLoopConversation(id)) count++;
  }
  return count;
}

// In startQuery():
const isLoop = isLoopConversation(conversationId);
const max = isLoop ? MAX_LOOP_CONVERSATIONS : MAX_CHAT_CONVERSATIONS;
const current = getConversationCount(isLoop ? 'loop' : 'chat');
if (current >= max) {
  evictOldestIdle(conversationId, isLoop ? 'loop' : 'chat');
}
```

#### Loop CRUD Operations

```typescript
export function createLoop(config: {
  name: string;
  prompt: string;
  schedule: string;
  scheduleType: Loop['scheduleType'];
  scheduleConfig: Loop['scheduleConfig'];
  workDir: string;
}): Loop {
  const loop: Loop = {
    id: randomUUID(),
    ...config,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  loops.push(loop);
  saveLoopsToDisk();
  scheduleLoop(loop);
  return loop;
}

export function updateLoop(loopId: string, updates: Partial<Loop>): Loop | null {
  const loop = loops.find(l => l.id === loopId);
  if (!loop) return null;

  const scheduleChanged = updates.schedule && updates.schedule !== loop.schedule;
  const enabledChanged = updates.enabled !== undefined && updates.enabled !== loop.enabled;

  Object.assign(loop, updates, { updatedAt: new Date().toISOString() });
  saveLoopsToDisk();

  if (scheduleChanged || enabledChanged) {
    unscheduleLoop(loopId);
    if (loop.enabled) scheduleLoop(loop);
  }

  return loop;
}

export function deleteLoop(loopId: string): boolean {
  const idx = loops.findIndex(l => l.id === loopId);
  if (idx < 0) return false;

  // Cancel if running
  cancelLoopExecution(loopId);
  unscheduleLoop(loopId);
  loops.splice(idx, 1);
  saveLoopsToDisk();
  // Optionally: delete execution history files
  return true;
}

export function listLoops(): Loop[] {
  return loops.map(l => ({ ...l }));
}

export function listLoopExecutions(loopId: string, limit = 50): LoopExecution[] {
  return readExecutionIndex(loopId, limit);
}

export function getLoopExecutionMessages(loopId: string, executionId: string): any[] {
  return readExecutionLog(loopId, executionId);
}

export function runLoopNow(loopId: string): void {
  executeLoop(loopId, 'manual');
}

export function cancelLoopExecution(loopId: string): void {
  for (const [execId, exec] of runningExecutions) {
    if (exec.loopId === loopId && exec.conversationId) {
      claudeCancelExecution(exec.conversationId);
      completeExecution(execId, 'cancelled');
      break;
    }
  }
}
```

### 4.4 Agent-Side: `agent/src/connection.ts` Changes

Add Loop message handlers to `handleServerMessage()`:

```typescript
case 'create_loop': {
  const loop = createLoop({
    name: msg.name,
    prompt: msg.prompt,
    schedule: msg.schedule,
    scheduleType: msg.scheduleType,
    scheduleConfig: msg.scheduleConfig,
    workDir: state.workDir,
  });
  send({ type: 'loop_created', loop });
  break;
}

case 'update_loop': {
  const loop = updateLoop(msg.loopId, msg.updates);
  if (loop) send({ type: 'loop_updated', loop });
  else send({ type: 'error', message: `Loop ${msg.loopId} not found` });
  break;
}

case 'delete_loop': {
  const ok = deleteLoop(msg.loopId);
  if (ok) send({ type: 'loop_deleted', loopId: msg.loopId });
  else send({ type: 'error', message: `Loop ${msg.loopId} not found` });
  break;
}

case 'list_loops': {
  send({ type: 'loops_list', loops: listLoops() });
  break;
}

case 'run_loop_now': {
  runLoopNow(msg.loopId);
  break;
}

case 'list_loop_executions': {
  const executions = listLoopExecutions(msg.loopId, msg.limit);
  send({ type: 'loop_executions_list', loopId: msg.loopId, executions });
  break;
}

case 'get_loop_execution': {
  const messages = getLoopExecutionMessages(msg.loopId, msg.executionId);
  send({ type: 'loop_execution_detail', loopId: msg.loopId, executionId: msg.executionId, messages });
  break;
}

case 'cancel_loop_execution': {
  cancelLoopExecution(msg.loopId);
  break;
}
```

Also add Loop list refresh on connect and workdir change (same pattern as teams):

```typescript
// In onConnect / onReconnect handlers:
send({ type: 'loops_list', loops: listLoops() });

// In handleChangeWorkDir:
send({ type: 'loops_list', loops: listLoops() });
```

### 4.5 WebSocket Protocol

#### Web → Agent

| Type | Fields | Purpose |
|------|--------|---------|
| `create_loop` | `name`, `prompt`, `schedule`, `scheduleType`, `scheduleConfig` | Create new Loop |
| `update_loop` | `loopId`, `updates: Partial<Loop>` | Update Loop config |
| `delete_loop` | `loopId` | Delete a Loop |
| `list_loops` | — | Request all Loops |
| `run_loop_now` | `loopId` | Trigger immediate execution |
| `list_loop_executions` | `loopId`, `limit?` | List execution history |
| `get_loop_execution` | `loopId`, `executionId` | Get full execution messages |
| `cancel_loop_execution` | `loopId` | Cancel running execution |

#### Agent → Web

| Type | Fields | Purpose |
|------|--------|---------|
| `loops_list` | `loops: Loop[]` | Full Loop list (response to `list_loops` or refresh) |
| `loop_created` | `loop: Loop` | Confirm creation |
| `loop_updated` | `loop: Loop` | Confirm update |
| `loop_deleted` | `loopId` | Confirm deletion |
| `loop_execution_started` | `loopId`, `execution: LoopExecution` | Execution began |
| `loop_execution_output` | `loopId`, `executionId`, `data` | Streaming Claude output |
| `loop_execution_completed` | `loopId`, `execution: LoopExecution` | Execution finished |
| `loop_executions_list` | `loopId`, `executions: LoopExecution[]` | Execution history list |
| `loop_execution_detail` | `loopId`, `executionId`, `messages[]` | Full execution replay |

### 4.6 Web UI: `server/web/modules/loop.js`

New module following the same factory pattern as `team.js`.

```javascript
export function createLoop(deps) {
  const { wsSend, scrollToBottom, viewMode } = deps;

  // ── Reactive State ──────────────────────────────────
  const loopsList = ref([]);                   // all Loop definitions
  const selectedLoop = ref(null);              // Loop selected for detail view (Loop object)
  const selectedExecution = ref(null);         // execution selected for replay (executionId)
  const executionHistory = ref([]);            // executions for selectedLoop
  const executionMessages = ref([]);           // messages for selectedExecution replay
  const runningLoops = ref({});                // loopId → LoopExecution (currently executing)
  const loadingExecutions = ref(false);
  const loadingExecution = ref(false);

  // ── Loop CRUD ───────────────────────────────────────
  function createNewLoop(config) {
    wsSend({ type: 'create_loop', ...config });
  }

  function updateExistingLoop(loopId, updates) {
    wsSend({ type: 'update_loop', loopId, updates });
  }

  function deleteExistingLoop(loopId) {
    wsSend({ type: 'delete_loop', loopId });
  }

  function runNow(loopId) {
    wsSend({ type: 'run_loop_now', loopId });
  }

  function cancelExecution(loopId) {
    wsSend({ type: 'cancel_loop_execution', loopId });
  }

  function requestLoopsList() {
    wsSend({ type: 'list_loops' });
  }

  // ── Navigation ──────────────────────────────────────
  function viewLoopDetail(loopId) {
    const loop = loopsList.value.find(l => l.id === loopId);
    if (!loop) return;
    selectedLoop.value = loop;
    selectedExecution.value = null;
    executionMessages.value = [];
    loadingExecutions.value = true;
    wsSend({ type: 'list_loop_executions', loopId, limit: 50 });
  }

  function viewExecution(loopId, executionId) {
    selectedExecution.value = executionId;
    loadingExecution.value = true;
    wsSend({ type: 'get_loop_execution', loopId, executionId });
  }

  function backToLoopsList() {
    selectedLoop.value = null;
    selectedExecution.value = null;
    executionHistory.value = [];
    executionMessages.value = [];
  }

  function backToLoopDetail() {
    selectedExecution.value = null;
    executionMessages.value = [];
  }

  // ── Message Routing ─────────────────────────────────
  function handleLoopMessage(msg) {
    switch (msg.type) {
      case 'loops_list':
        loopsList.value = msg.loops || [];
        return true;

      case 'loop_created':
        loopsList.value.push(msg.loop);
        return true;

      case 'loop_updated': {
        const idx = loopsList.value.findIndex(l => l.id === msg.loop.id);
        if (idx >= 0) loopsList.value[idx] = msg.loop;
        if (selectedLoop.value?.id === msg.loop.id) selectedLoop.value = msg.loop;
        return true;
      }

      case 'loop_deleted':
        loopsList.value = loopsList.value.filter(l => l.id !== msg.loopId);
        if (selectedLoop.value?.id === msg.loopId) backToLoopsList();
        return true;

      case 'loop_execution_started':
        runningLoops.value[msg.loopId] = msg.execution;
        // If viewing this loop's detail, prepend to history
        if (selectedLoop.value?.id === msg.loopId) {
          executionHistory.value.unshift(msg.execution);
        }
        return true;

      case 'loop_execution_output':
        // If user is viewing this execution live, append to display
        if (selectedExecution.value === msg.executionId) {
          appendOutputToDisplay(msg.data);
        }
        return true;

      case 'loop_execution_completed': {
        delete runningLoops.value[msg.loopId];
        // Update execution in history list
        if (selectedLoop.value?.id === msg.loopId) {
          const idx = executionHistory.value.findIndex(e => e.id === msg.execution.id);
          if (idx >= 0) executionHistory.value[idx] = msg.execution;
        }
        // Update Loop's lastExecution in sidebar list
        const loop = loopsList.value.find(l => l.id === msg.loopId);
        if (loop) {
          loop.lastExecution = {
            id: msg.execution.id,
            status: msg.execution.status,
            startedAt: msg.execution.startedAt,
            durationMs: msg.execution.durationMs,
            trigger: msg.execution.trigger,
          };
        }
        return true;
      }

      case 'loop_executions_list':
        if (selectedLoop.value?.id === msg.loopId) {
          executionHistory.value = msg.executions;
          loadingExecutions.value = false;
        }
        return true;

      case 'loop_execution_detail':
        if (selectedExecution.value === msg.executionId) {
          executionMessages.value = buildHistoryBatch(msg.messages);
          loadingExecution.value = false;
        }
        return true;

      default:
        return false;
    }
  }

  return {
    // State
    loopsList, selectedLoop, selectedExecution,
    executionHistory, executionMessages, runningLoops,
    loadingExecutions, loadingExecution,
    // CRUD
    createNewLoop, updateExistingLoop, deleteExistingLoop,
    runNow, cancelExecution, requestLoopsList,
    // Navigation
    viewLoopDetail, viewExecution,
    backToLoopsList, backToLoopDetail,
    // Message routing
    handleLoopMessage,
  };
}
```

### 4.7 Web UI: `server/web/modules/loopTemplates.js`

```javascript
export const LOOP_TEMPLATES = {
  'competitive-intel': {
    label: 'Competitive Intel Monitor',
    description: 'Track competitor products, pricing, and industry trends',
    name: 'Competitive Intelligence Monitor',
    prompt: `Monitor competitor and industry developments. Scan the working directory for any tracked competitor data, news feeds, or intelligence files.

1. Identify new product launches, feature updates, or pricing changes from competitors
2. Summarize key industry trends, regulatory changes, or market shifts
3. Highlight strategic threats (competitors gaining ground) and opportunities (gaps in market)
4. Compare against our current positioning where relevant

Provide a structured briefing with sections: Key Developments, Threats, Opportunities, Recommended Actions.`,
    scheduleType: 'daily',
    scheduleConfig: { hour: 8, minute: 0 },
  },

  'knowledge-base': {
    label: 'Knowledge Base Maintenance',
    description: 'Audit notes and docs for broken links, orphan files, and organization',
    name: 'Knowledge Base Maintenance',
    prompt: `Perform a maintenance audit on the knowledge base / notes in this directory.

1. Find broken internal links (references to files or headings that no longer exist)
2. Identify orphan files (documents with no inbound links from any other document)
3. Detect duplicate or near-duplicate content across files
4. Check for outdated information (files not modified in 90+ days that reference time-sensitive topics)
5. Suggest tag/folder reorganization for better discoverability

Provide a structured report with sections: Broken Links, Orphan Files, Duplicates, Stale Content, Reorganization Suggestions.`,
    scheduleType: 'weekly',
    scheduleConfig: { hour: 20, minute: 0, dayOfWeek: 5 },  // Friday 20:00
  },

  custom: {
    label: 'Custom',
    description: 'Create your own scheduled task with a custom prompt',
    name: '',
    prompt: '',
    scheduleType: 'daily',
    scheduleConfig: { hour: 9, minute: 0 },
  },
};

export const LOOP_TEMPLATE_KEYS = ['competitive-intel', 'knowledge-base', 'custom'];
```

### 4.8 Web UI: `server/web/modules/connection.js` Changes

Add Loop message routing in the `handleMessage` chain, between Team and background conversation routing:

```javascript
// Existing: Team message routing (line ~224)
if (team && (msg.type?.startsWith('team_') || msg.type === 'teams_list' || ...)) {
  // ... team routing
  return;
}

// NEW: Loop message routing
if (loop && (msg.type?.startsWith('loop_') || msg.type === 'loops_list')) {
  loop.handleLoopMessage(msg);
  return;
}

// Existing: background conversation routing (line ~233)
// ...
```

Also add Loop list refresh on connect/reconnect:

```javascript
// In onConnect handler:
if (loop) loop.requestLoopsList();

// In agent_reconnected handler:
if (loop) loop.requestLoopsList();

// In workdir_changed handler:
if (loop) loop.requestLoopsList();
// Also clear stale data (matches existing pattern for historySessions and team.teamsList):
// loop.loopsList.value = [];
```

### 4.9 Server-Side Changes

**None.** The server is a transparent relay. All new `loop_*` and `loops_list` message types pass through existing relay logic without modification.

### 4.10 Daemon Startup Integration

In `agent/src/index.ts` (or wherever the agent's `start()` function initializes):

```typescript
import { initScheduler, shutdownScheduler } from './scheduler.js';

// After WebSocket connection established and send function available:
initScheduler({
  send: sendToWeb,
  handleChat: claudeHandleChat,
});

// On shutdown:
process.on('SIGTERM', () => {
  shutdownScheduler();
  // ... existing cleanup
});
```

#### Orphaned Execution Recovery

On startup, the scheduler checks for executions left in `'running'` state (from a previous crash/restart):

```typescript
function reconcileOrphanedExecutions(): void {
  for (const loop of loops) {
    const executions = readExecutionIndex(loop.id, 10);
    for (const exec of executions) {
      if (exec.status === 'running') {
        exec.status = 'error';
        exec.error = 'Agent restarted during execution';
        exec.completedAt = new Date().toISOString();
        updateExecutionIndex(loop.id, exec);
      }
    }
  }
}
```

## 5. Data Flow

### 5.1 Loop Creation

```
User clicks sample case card (Try it) → form pre-filled
User edits name/prompt/schedule → clicks [Create Loop]
  → wsSend({ type: 'create_loop', name, prompt, schedule, scheduleType, scheduleConfig })
  → server relay → agent connection.ts
  → scheduler.createLoop() → saves to loops.json, registers cron job
  → send({ type: 'loop_created', loop })
  → server relay → web
  → loop.handleLoopMessage() → pushes to loopsList
  → sidebar Loop History section updates
```

### 5.2 Scheduled Execution

```
cron fires → scheduler.executeLoop(loopId, 'scheduled')
  → quota check (< MAX_CONCURRENT_LOOPS) + overlap check
  → create LoopExecution record, append to index.jsonl
  → send loop_execution_started to web
  → register output observer for this conversationId
  → handleChat(conversationId='loop-xxxx', prompt, workDir)
    → claude.ts spawns Claude process (or reuses idle)
    → Claude executes prompt, stdout flows through processOutput()

For each stdout message:
  → output observer fires
  → append message to <executionId>.jsonl (persistence)
  → send loop_execution_output to web (if connected)
  → web appends to live display (if user is viewing this execution)

On result message:
  → observer detects msg.type === 'result'
  → completeExecution(id, 'success', summary)
  → update execution index, update loop.lastExecution
  → send loop_execution_completed to web
  → sidebar updates last run status
```

### 5.3 Viewing Execution History

```
User clicks Loop in sidebar or Active Loops list
  → loop.viewLoopDetail(loopId)
  → wsSend({ type: 'list_loop_executions', loopId, limit: 50 })
  → agent reads index.jsonl → sends loop_executions_list
  → web renders execution list

User clicks [View] on a past execution
  → loop.viewExecution(loopId, executionId)
  → wsSend({ type: 'get_loop_execution', loopId, executionId })
  → agent reads <executionId>.jsonl → sends loop_execution_detail
  → web calls buildHistoryBatch() to reconstruct messages
  → renders using existing message list components

User clicks [View] on a RUNNING execution
  → loop.viewExecution(loopId, executionId)
  → web loads existing messages from get_loop_execution
  → subsequent loop_execution_output messages stream in live
  → streaming.js handles progressive text reveal
```

### 5.4 Manual Trigger

```
User clicks [▶ Run] on a Loop
  → wsSend({ type: 'run_loop_now', loopId })
  → agent scheduler.runLoopNow(loopId)
  → executeLoop(loopId, 'manual')
  → same flow as scheduled execution (5.2)
```

## 6. Implementation Plan

### Phase 1: Agent Infrastructure
1. Create `agent/src/scheduler.ts` — Loop CRUD, persistence (`loops.json` read/write), cron scheduling using `node-cron`
2. Add execution persistence — `loop-executions/` directory, `index.jsonl` and per-execution JSONL files
3. Implement `executeLoop()` — integrate with `claude.ts` `handleChat()`, output capture
4. Modify `claude.ts` — change `setOutputObserverFn` to multi-observer chain (`addOutputObserver` / `removeOutputObserver`), add separate quota for `loop-` prefixed conversationIds
5. Add Loop message handlers to `agent/src/connection.ts` — all 8 message types
6. Initialize scheduler on daemon startup, add shutdown cleanup
7. Add orphaned execution recovery on startup

### Phase 2: Web UI Rename & Sidebar Restructure
8. Rename `teamMode` → `viewMode` across `app.js`, `team.js`, `sidebar.js` (pure rename, no logic change)
9. Restructure sidebar: `Sessions | Files` tabs → `History | Files` tabs
10. Implement three collapsible sections in History tab (Teams / Chat / Loops) with localStorage persistence
11. Move Team history from Team creation panel to sidebar TEAMS HISTORY section
12. Wire sidebar click handlers to switch `viewMode` + load relevant data

### Phase 3: Loop Web Module
13. Create `server/web/modules/loopTemplates.js` — sample case definitions (Try it)
14. Create `server/web/modules/loop.js` — factory module with state, CRUD methods, message routing
15. Wire `loop.js` into `app.js` — `createLoop(deps)`, expose state to template
16. Add Loop message routing to `connection.js` — `loop_*` and `loops_list` interception
17. Add Loop list refresh on connect/reconnect/workdir change

### Phase 4: Loop Creation Panel UI
18. Add `Loop` button to top-right `viewMode` toggle
19. Build Loop creation panel template — sample case cards (Try it), name/prompt form, schedule selector
20. Implement schedule radio buttons with cron conversion logic
21. Wire [Create Loop] button → `loop.createNewLoop()`
22. Build Active Loops list below creation form — enable/disable, edit, run, delete

### Phase 5: Execution History & Detail UI
23. Build Loop detail view — header with Loop info + execution history list
24. Build execution detail view — reuse existing message list rendering via `buildHistoryBatch()`
25. Implement live execution streaming — connect `loop_execution_output` to streaming display
26. Add running Loop notification banner (shown in Chat/Team views)
27. Add [Cancel] button for running executions

### Phase 6: Polish
28. Mobile responsive layout for Loop views
29. Error states — failed execution display, cron validation error feedback
30. Execution history pagination (load more)
31. Tests — unit tests for scheduler, cron conversion, CRUD operations

## 7. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `node-cron` accuracy in long-running daemon | Missed or drifted schedules | `node-cron` uses `setInterval` with minute granularity — sufficient for our use case. Agent auto-update restarts the daemon periodically, resetting any drift. |
| Agent process crash during execution | Execution stuck in 'running' | Orphaned execution recovery on startup marks them as 'error'. |
| JSONL execution files grow unbounded | Disk usage | Cap execution history (e.g., keep last 100 per Loop). Add cleanup on Loop deletion. |
| Loop executions overlap (slow execution + fast schedule) | Resource exhaustion | Per-Loop overlap prevention (skip if already running). Clear UX indicator when a scheduled run was skipped. |
| Claude process spawned when no one is watching | Surprise token costs | Loops are explicitly created by the user with full prompt visibility. No implicit execution. |
| Multiple agents on same machine with conflicting schedules | Resource contention | Loops are scoped to the running agent's `workDir`. Independent agents have independent `~/.agentlink/loops.json`. |
| Web UI disconnected during execution | User misses results | Full execution persistence to JSONL. On reconnect, user can view completed execution history. |
| Cron expression validation | Invalid cron crashes scheduler | Validate cron expression using `node-cron`'s `validate()` before saving. Reject invalid expressions with error message. |

## 8. Dependencies

- **`node-cron`** — Lightweight cron scheduler for Node.js. No external dependencies. Validates cron expressions, supports standard 5-field cron syntax.
- No server-side changes required.
- No new infrastructure or databases.

## 9. Open Questions

1. **Execution retention policy:** How many past executions to keep per Loop? Suggested: keep last 100, auto-delete older ones. Configurable?
2. **Timezone:** Should schedule times use the agent machine's local timezone or UTC? Suggested: local timezone (matches user expectation for "every day at 9am").
3. **Loop scoping:** Should Loops be scoped to a specific `workDir`? If agent's workDir changes, should Loops created for the old workDir still execute? Suggested: yes, each Loop stores its own `workDir` at creation time and always executes in that directory regardless of the agent's current workDir.
4. **Multiple agents:** If two agent processes run on the same machine (different workDirs), they share `~/.agentlink/loops.json`. Should Loops be namespaced per agent session? Suggested: no — `loops.json` is global, each Loop has its own `workDir`.
