# Agent Team Feature Design Document

**Status:** Draft v3
**Date:** 2026-03-07
**Author:** Claude (with Kailun)

## 1. Overview

Integrate multi-agent team capabilities into AgentLink's web interface, allowing users to launch a coordinated team of Claude agents that work in parallel on complex tasks.

### Architecture Decision: Single Lead Process with Native Subagents

One Claude CLI process acts as the Lead. It uses Claude's native `Agent` tool (via the `--agents` CLI flag) to spawn subagent teammates. All output — Lead's own and every subagent's — flows through a single stdout stream. `team.ts` intercepts this stream and routes messages by `parent_tool_use_id` to identify which subagent produced them.

**Why:**
- Uses Claude's **native subagent feature** — not a simulation
- Single Claude process, single stdout stream — no multi-process orchestration needed
- `parent_tool_use_id` on every subagent message provides reliable routing
- `system.subtype=task_started` and `tool_use_result.status=completed` provide native lifecycle signals
- Lead autonomously decides how to spawn subagents, manage rounds, and synthesize results
- Subagent conversation history persisted automatically to `~/.claude/projects/{project}/{sessionId}/subagents/`
- Server relay unchanged (still sees one agent, one conversation)

### What Claude Provides vs What We Build

**Native (from Claude's `--agents` + `Agent` tool):**
- Subagent spawn with isolated context window
- Per-subagent tool restrictions and system prompts
- `parent_tool_use_id` on all subagent messages (routing discriminator)
- `system.subtype=task_started` with `task_id` + `tool_use_id` (subagent lifecycle start)
- `tool_use_result.status=completed` with `agentId` + final content (subagent lifecycle end)
- Automatic subagent history persistence (`subagents/agent-{id}.jsonl`)
- Success/failure, cost, duration, token usage in `result` message

**We build (`team.ts` + Web UI):**
- Task board (kanban) derived from Lead's output
- Output stream routing by `parent_tool_use_id` → per-agent message lists
- Agent status cards, progress tracking, activity feed
- Team creation UX (templates, one-click launch)
- Team persistence (`~/.agentlink/teams/`) and history browsing
- Team completion summary view

## 2. Scope

### In Scope
- Team creation: user inputs task description + optional template
- Lead agent analyzes codebase and plans tasks automatically
- Teammates execute tasks in parallel as subagents
- Task board (kanban: pending/active/done) with dependency tracking
- Per-agent chat view (drill down into any teammate's conversation)
- Team dashboard: agent status cards + unified activity feed
- User can message any individual teammate (queued if agent is busy)
- Inter-agent coordination via Lead multi-round relay
- Team history: browse past teams in sidebar, view read-only dashboard
- Team metadata persistence (`~/.agentlink/teams/<id>.json`)

### Out of Scope
- Resuming/continuing historical teams (view-only)
- Custom agent definitions (`.claude/agents/` YAML) — use built-in agents first
- Git worktree isolation per teammate
- Drag-and-drop task reassignment
- Real-time peer-to-peer agent messaging (use Lead relay instead)
- Plan-approval gates

## 3. User Scenarios

### Scenario 1: Parallel Code Review
User asks to review a large PR. Lead splits the review into security, performance, and test coverage. Three teammates work in parallel, each producing a focused review report. Lead synthesizes a final summary.

### Scenario 2: Full-Stack Feature Development
User describes a feature. Lead creates tasks: "Build API endpoint," "Create Vue component," "Write tests." Backend, Frontend, and Test agents each claim a task and work independently. Lead coordinates interface contracts.

### Scenario 3: Competing Hypothesis Debugging
User reports a bug. Lead spawns 3 agents, each investigating a different theory (race condition, data corruption, config issue). After all complete, Lead compares findings and synthesizes a diagnosis.

### Scenario 4: Large Codebase Migration
User wants to migrate from CommonJS to ESM. Lead creates per-module tasks with dependency ordering. Agents work through them in parallel, respecting dependency DAG.

## 4. User Experience

### 4.1 Team Creation

User sees a mode toggle in the input area:

```
[💬 Chat]  [👥 Team]
```

Clicking Team replaces the input area with a creation panel:

```
┌─────────────────────────────────────────────────┐
│  你想让团队做什么？                                │
│  ┌─────────────────────────────────────────────┐ │
│  │ 审查 agent/src/ 下所有文件的安全性和代码质量    │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  团队模板：                                       │
│  [代码审查]  [全栈开发]  [调试分析]  [自定义]       │
│                                                  │
│  [🚀 启动团队]                                    │
└─────────────────────────────────────────────────┘
```

**User only inputs one thing: a task description.** Templates optionally pre-configure team composition, but the Lead agent decides the actual task breakdown. Agent names, roles, and colors are assigned automatically by `team.ts`.

### 4.2 Lead Planning Phase

After launch, the UI switches to Team Dashboard. First phase shows Lead's planning process:

```
┌──────────┬───────────────────────────────────────────────┐
│ SIDEBAR  │                                               │
│          │  👥 Team: 审查 agent/src 安全性和代码质量       │
│ Sessions │  ──────────────────────────────────────────    │
│ ──────── │                                               │
│ 👥 审查  │  🔴 Lead 正在规划...                           │
│   agent  │                                               │
│          │  ┌──────────────────────────────────────────┐  │
│ 💬 其他  │  │ 正在分析代码库结构，制定任务分配方案...     │  │
│   对话   │  │                                          │  │
│          │  │ > 读取 agent/src/encryption.ts           │  │
│          │  │ > 读取 agent/src/claude.ts               │  │
│          │  │ > 读取 agent/src/connection.ts           │  │
│          │  └──────────────────────────────────────────┘  │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

User watches Lead's streamed output (files read, analysis). No interaction needed.

### 4.3 Team Working Phase (Dashboard)

Once Lead produces a task plan and teammates are spawned, the full dashboard appears:

```
┌──────────┬───────────────────────────────────────────────┐
│          │                                               │
│ TEAM     │  📋 任务看板                                   │
│ MEMBERS  │  ┌────────────┬────────────┬────────────┐     │
│ ──────── │  │ 待处理 (1) │ 进行中 (2) │ 已完成 (0) │     │
│          │  │            │            │            │     │
│ 🔴 Lead  │  │ ┌────────┐ │ ┌────────┐ │            │     │
│   已完成  │  │ │写单元   │ │ │🟡 安全 │ │            │     │
│   规划   │  │ │测试     │ │ │审查    │ │            │     │
│          │  │ │依赖:#1,#2│ │ │agent/  │ │            │     │
│ 🟡 安全  │  │ └────────┘ │ │ │src/   │ │            │     │
│  ● 审查中 │  │            │ │ └────────┘ │            │     │
│   0/1    │  │            │ ┌────────┐ │            │     │
│          │  │            │ │🔵 代码 │ │            │     │
│ 🔵 质量  │  │            │ │质量审查 │ │            │     │
│  ● 审查中 │  │            │ │agent/  │ │            │     │
│   0/1    │  │            │ │src/   │ │            │     │
│          │  │            │ └────────┘ │            │     │
│          │  └────────────┴────────────┴────────────┘     │
│          │                                               │
│          │  📡 实时动态                                    │
│          │  ┌────────────────────────────────────────┐   │
│          │  │ 10:31 🔴 Lead 创建了 3 个任务            │   │
│          │  │ 10:31 🟡 Security 开始: 安全审查          │   │
│          │  │ 10:31 🔵 Quality 开始: 代码质量审查       │   │
│          │  │ 10:32 🟡 Security 读取 encryption.ts     │   │
│          │  │ 10:32 🔵 Quality 读取 claude.ts          │   │
│          │  └────────────────────────────────────────┘   │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

**Left sidebar** shows team member list (replaces session history):
- Color dot + name
- Current status (planning/working/idle/done) with pulsing dot when active
- Task progress as discrete count (0/1, 1/3)

**Task board** shows three columns with task cards:
- Each card: title, assignee (color coded), dependency links
- Cards move between columns as status changes

**Activity feed** shows real-time events:
- Agent started/completed task
- Tool calls (one-line summary)
- Task status changes
- Lead coordination messages (if multi-round relay happens)

### 4.4 Agent Detail View

Clicking any agent in the sidebar opens their full conversation:

```
┌──────────┬───────────────────────────────────────────────┐
│ TEAM     │  ← 返回看板          🟡 Security Reviewer     │
│ MEMBERS  │  ─────────────────────────────────────────    │
│ ──────── │                                               │
│ 🔴 Lead  │  Claude: 我来分析 encryption.ts 的安全性...    │
│ 🟡 安全 ←│                                               │
│ 🔵 质量  │  [Tool: Read agent/src/encryption.ts]         │
│          │                                               │
│          │  Claude: 发现 3 个问题：                        │
│          │  1. decrypt() 吞异常...                        │
│          │  2. sessionKey null 时静默降级明文...           │
│          │                                               │
│          │  [Tool: Read server/src/encryption.ts]         │
│          │                                               │
│          │  Claude: server 端同样存在...                   │
│          │                                               │
│          │  ┌─────────────────────────────────────────┐   │
│          │  │ 给这个 Agent 发消息...            [发送] │   │
│          │  └─────────────────────────────────────────┘   │
└──────────┴───────────────────────────────────────────────┘
```

**Reuses existing message rendering** — markdown, tool calls, code highlighting, streaming animation all work as-is.

**Message input:** user can send messages to this specific agent.
- If agent is working (turn active) → message queued, sent after current turn completes. Does not interrupt the agent.
- If agent is idle/done → message sent immediately, agent responds. This is a "side conversation" — it does not change the task's status on the board.

### 4.5 Team Completion

When all tasks are done, Lead runs a final summarization round:

```
┌──────────┬───────────────────────────────────────────────┐
│ TEAM     │  📋 任务看板                                   │
│ MEMBERS  │  ┌────────────┬────────────┬────────────┐     │
│ ──────── │  │ 待处理 (0) │ 进行中 (0) │ 已完成 (3) │     │
│          │  │            │            │ ✓ 安全审查 │     │
│ 🔴 Lead  │  │            │            │ ✓ 质量审查 │     │
│   汇总中  │  │            │            │ ✓ 单元测试 │     │
│ 🟡 完成 ✓│  └────────────┴────────────┴────────────┘     │
│ 🔵 完成 ✓│                                               │
│ 🟢 完成 ✓│  📊 团队总结 (Lead 生成)                       │
│          │  ┌────────────────────────────────────────┐   │
│          │  │ ## 审查总结                              │   │
│          │  │                                        │   │
│          │  │ ### 安全问题 (3个高危, 2个中危)          │   │
│          │  │ - HIGH: 明文降级风险 ...                │   │
│          │  │ - HIGH: catch 吞异常 ...               │   │
│          │  │                                        │   │
│          │  │ ### 代码质量 (2个建议)                   │   │
│          │  │ - 两个文件 60 行重复代码                 │   │
│          │  │                                        │   │
│          │  │ 总耗时: 85s | 总花费: $1.39            │   │
│          │  └────────────────────────────────────────┘   │
│          │                                               │
│          │  [返回 Chat 模式]  [基于此新建团队]             │
│          │                                               │
└──────────┴───────────────────────────────────────────────┘
```

Actions after completion:
- **返回 Chat 模式** → back to Solo chat
- **基于此新建团队** → pre-fill creation panel with same task description

### 4.6 Cancel / Stop

- Click [Stop] on a single agent card → cancels that agent only, task marked `failed`
- Click [解散团队] (global) → stops all agents, team status set to `failed`, returns to Solo mode
- Page refresh / disconnect during active team → team state persisted to disk, dashboard shows final frozen state on reconnect (read-only, not resumable)

### 4.7 Sidebar Integration

Team and solo sessions appear together in the session list, sorted by time:

```
Sessions
────────
👥 审查 agent/src 安全性          刚刚
   ✓ 完成 | 3 tasks | $1.39

👥 重构 config 模块               昨天
   ✗ 中断 | 2/5 tasks | $0.82

💬 Fix login bug                  昨天
💬 Refactor config                3天前
```

**Clicking a historical team** opens a read-only dashboard:
- Task board shows final state
- Lead summary displayed
- Can click into any agent to view their conversation history
- Stats shown: total cost, duration, task counts
- No input box, no resume capability
- [基于此新建团队] button available

### 4.8 Task Card Detail (Click on task in board)

```
┌──────────────────────────────┐
│ Task #1: 安全审查             │
│ 状态: ✓ 完成                  │
│ 执行者: 🟡 Security Reviewer │
│ 依赖: 无                     │
│ 创建时间: 10:31              │
│                              │
│ 描述:                        │
│ 审查 agent/src/ 下所有文件    │
│ 的加密实现，关注 nonce 复用、 │
│ 明文降级、密钥分发...         │
│                              │
│ [查看执行者对话]              │
└──────────────────────────────┘
```

## 5. Technical Design

### 5.1 Agent-Side: `agent/src/team.ts` (New Module)

#### Data Types

```typescript
export interface TeamConfig {
  instruction: string;           // high-level task description from user
  template?: string;             // optional: 'code-review' | 'full-stack' | 'debug' | 'custom'
}

export interface AgentRole {
  id: string;                    // e.g., "security", "quality", "tester"
  name: string;                  // display name
  color: string;                 // hex color for UI identification
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'active' | 'done' | 'failed';
  assignee: string | null;       // agentRole.id
  toolUseId: string | null;      // parent_tool_use_id linking to Agent tool call
  agentTaskId: string | null;    // task_id from system.task_started
  dependencies: string[];        // task IDs that must complete first
  createdAt: number;
  updatedAt: number;
}

export interface TeamState {
  teamId: string;
  title: string;                 // derived from instruction
  config: TeamConfig;
  conversationId: string;        // single conversation in claude.ts (Lead process)
  claudeSessionId: string | null;// Lead's session ID (for history + subagent JSONL)
  agents: Map<string, AgentTeammate>;
  tasks: TaskItem[];
  feed: TeamFeedEntry[];
  status: 'planning' | 'running' | 'summarizing' | 'completed' | 'failed';
  summary: string | null;        // Lead's final summary
  totalCost: number;
  createdAt: number;
}

interface AgentTeammate {
  role: AgentRole;
  toolUseId: string | null;      // the Agent tool_use_id that spawned this subagent
  agentTaskId: string | null;    // task_id from system.task_started
  status: 'starting' | 'working' | 'done' | 'error';
  currentTaskId: string | null;  // which TaskItem this agent is working on
  messages: TeamAgentMessage[];  // accumulated messages for this agent's detail view
}

interface TeamAgentMessage {
  id: number;
  role: 'assistant' | 'tool' | 'user';
  content?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  hasResult?: boolean;
  timestamp: Date;
}

interface TeamFeedEntry {
  timestamp: number;
  agentId: string;
  type: 'task_started' | 'task_completed' | 'task_failed' | 'tool_call' | 'status_change';
  content: string;               // human-readable summary
}
```

#### How It Works: Single-Process Subagent Model

One Claude CLI process runs the entire team. `team.ts` constructs the spawn arguments and intercepts the output stream.

**Spawn:** `team.ts` calls `handleChat()` with extra CLI args:
```typescript
// team.ts constructs the agents JSON based on template
const agentsDef = {
  "security-reviewer": {
    description: "Security expert focused on cryptographic and auth issues",
    prompt: "You are a security reviewer. Analyze code for vulnerabilities...",
    tools: ["Read", "Grep", "Glob"]
  },
  "quality-reviewer": {
    description: "Code quality expert focused on maintainability",
    prompt: "You are a code quality reviewer. Analyze code structure...",
    tools: ["Read", "Grep", "Glob"]
  }
};

// Lead gets a prompt that instructs it to use Agent tool
const leadPrompt = `You are a team lead coordinating a code review.

Available agents (use the Agent tool to delegate to them):
- security-reviewer: ${agentsDef["security-reviewer"].description}
- quality-reviewer: ${agentsDef["quality-reviewer"].description}

User's request: "${config.instruction}"

Instructions:
1. First, analyze the codebase to understand what needs reviewing
2. Use the Agent tool to spawn each reviewer IN PARALLEL (multiple Agent calls)
3. After all agents complete, synthesize their findings into a unified summary

Spawn agents with specific, detailed instructions referencing exact files and concerns.`;

// handleChat() spawns: claude --agents '<JSON>' -p "<leadPrompt>" ...
handleChat(teamConversationId, leadPrompt, workDir, {
  extraArgs: ['--agents', JSON.stringify(agentsDef)]
});
```

**Output stream parsing:** `team.ts` registers an output observer on the Lead's conversation. Every message from stdout is inspected:

```typescript
// Registered via setOutputObserver()
function onLeadOutput(conversationId: string, rawMsg: any, processedMsg: any): void {
  if (conversationId !== teamState.conversationId) return;

  // 1. Lead calls Agent tool → register new subagent
  if (rawMsg.type === 'assistant') {
    for (const block of rawMsg.message?.content || []) {
      if (block.type === 'tool_use' && block.name === 'Agent') {
        registerSubagent(block.id, block.input);
        // block.id becomes parent_tool_use_id for all subagent messages
      }
    }
  }

  // 2. system.task_started → subagent began executing
  if (rawMsg.type === 'system' && rawMsg.subtype === 'task_started') {
    linkSubagentTaskId(rawMsg.tool_use_id, rawMsg.task_id);
    emitFeed('task_started', rawMsg.tool_use_id);
    sendToWeb({ type: 'team_agent_status', ... });
  }

  // 3. Messages with parent_tool_use_id → route to specific subagent
  if (rawMsg.parent_tool_use_id) {
    const agent = findAgentByToolUseId(rawMsg.parent_tool_use_id);
    if (agent) {
      routeToAgent(agent, rawMsg);  // accumulate in agent.messages
      sendToWeb({
        type: 'claude_output',
        teamId: teamState.teamId,
        agentRole: agent.role.id,
        data: extractDelta(rawMsg)
      });
      return;  // suppress normal forwarding (not Lead's own output)
    }
  }

  // 4. tool_use_result with status=completed → subagent finished
  if (rawMsg.tool_use_result?.status === 'completed') {
    const agentId = rawMsg.tool_use_result.agentId;
    const agent = findAgentByTaskId(agentId);
    if (agent) {
      agent.status = 'done';
      updateTaskStatus(agent.currentTaskId, 'done');
      emitFeed('task_completed', agent.role.id);
      sendToWeb({ type: 'team_task_update', ... });
      sendToWeb({ type: 'team_agent_status', ... });
    }
  }

  // 5. Lead's own text (no parent_tool_use_id) → forward as Lead output
  sendToWeb({
    type: 'claude_output',
    teamId: teamState.teamId,
    agentRole: 'lead',
    data: extractDelta(rawMsg)
  });
}
```

#### Orchestration Flow (Lead-Driven)

Unlike previous designs where `team.ts` managed phases explicitly, the **Lead Claude process drives the entire flow autonomously**. `team.ts` is primarily an observer and router.

**What Lead does (autonomously):**
1. Reads codebase, analyzes the task
2. Calls `Agent(subagent_type, prompt)` to spawn teammates — possibly multiple in parallel
3. Receives each subagent's results as `tool_use_result`
4. Optionally spawns additional rounds if needed
5. Produces a final synthesized summary

**What `team.ts` does (intercept and route):**
1. Detects `Agent` tool calls → registers teammates, sends `team_created` to web
2. Detects `system.task_started` → updates agent status, sends `team_agent_status`
3. Routes subagent messages by `parent_tool_use_id` → per-agent message lists + `claude_output` to web
4. Detects `tool_use_result.status=completed` → marks task done, sends `team_task_update`
5. Detects Lead's final text output (no `parent_tool_use_id`, after all subagents done) → captures as summary
6. On `turn_completed` from `claude.ts` → team status = `completed`, sends `team_completed`, persists state

**Key insight:** Planning, execution ordering, cross-agent information relay, and summarization are all handled naturally by the Lead's conversation flow. `team.ts` doesn't implement any orchestration logic — it only parses the output stream to extract state for the UI.

#### Integration with `claude.ts`

Two changes to `claude.ts`:

**1. `handleChat()` accepts extra CLI args:**

```typescript
export async function handleChat(
  conversationId: string,
  prompt: string,
  workDir: string,
  options?: { extraArgs?: string[], resumeSessionId?: string }
): Promise<void> {
  // In startQuery(), append options.extraArgs to the claude spawn args
}
```

**2. Output observer hook** (raw + processed messages):

```typescript
let outputObserver: ((
  conversationId: string,
  rawMsg: unknown,       // original stream-json line (has parent_tool_use_id, etc.)
  processedMsg: unknown  // the message sent to web client
) => void) | null = null;

export function setOutputObserver(fn: typeof outputObserver): void {
  outputObserver = fn;
}

// Inside processOutput(), after processing each stream-json line:
if (outputObserver) {
  outputObserver(state.conversationId, rawStreamJsonMsg, outMsg);
}
```

**No other changes needed.** `claude.ts` manages one `ConversationState` for the team — it doesn't know or care that the Lead process spawns subagents internally. No `MAX_CONVERSATIONS` change needed since the team uses only one conversation slot.

#### Team Persistence

On every state change, `team.ts` writes to `~/.agentlink/teams/<teamId>.json`:

```json
{
  "teamId": "abc-123",
  "title": "审查 agent/src 安全性",
  "createdAt": 1709766600000,
  "status": "completed",
  "config": { "instruction": "...", "template": "code-review" },
  "conversationId": "conv-uuid",
  "claudeSessionId": "session-uuid",
  "agents": [
    { "id": "lead", "name": "Lead", "color": "#EF4444" },
    { "id": "security", "name": "Security Reviewer", "color": "#EAB308", "agentTaskId": "a36b3e1cf10e86830" },
    { "id": "quality", "name": "Quality Reviewer", "color": "#3B82F6", "agentTaskId": "b48c4f2dg21f97941" }
  ],
  "tasks": [
    { "id": "t1", "title": "安全审查", "status": "done", "assignee": "security" },
    { "id": "t2", "title": "代码质量审查", "status": "done", "assignee": "quality" }
  ],
  "feed": [ ... ],
  "summary": "## 审查总结\n\n...",
  "totalCost": 1.39,
  "totalDuration": 84800
}
```

**Historical agent conversations** are read from native subagent JSONL files:
```
~/.claude/projects/{project}/{claudeSessionId}/subagents/agent-{agentTaskId}.jsonl
```
Each subagent JSONL contains its full message history (user prompts, assistant responses, tool calls/results), tagged with `agentId` and `isSidechain: true`. Claude persists these automatically — no extra work needed.

Used by:
- `list_teams` handler → sidebar shows historical teams
- `get_team` handler → open read-only dashboard for historical team
- Agent detail view → parse subagent JSONL via `agentTaskId` to reconstruct conversation

### 5.2 WebSocket Protocol Extensions

All new messages pass through the existing server relay transparently (no server changes).

#### Web -> Agent (New Types)

| Type | Fields | Purpose |
|------|--------|---------|
| `create_team` | `instruction`, `template?` | Start a new team |
| `team_message` | `teamId`, `agentId`, `message` | Send message to specific teammate (V2) |
| `dissolve_team` | `teamId` | Cancel the Lead process, end team |
| `list_teams` | — | Request historical team list |
| `get_team` | `teamId` | Request full team state for history view |

Note: `team_message` is deferred to V2. In V1, subagents are spawned internally by the Lead and users cannot send messages to them mid-execution. Users can only observe.

#### Agent -> Web (New Types)

| Type | Fields | Purpose |
|------|--------|---------|
| `team_created` | `teamId`, `title`, `agents[]`, `tasks[]` | Team initialized, dashboard can render |
| `team_agent_status` | `teamId`, `agentId`, `status`, `currentTaskId` | Teammate state change |
| `team_task_update` | `teamId`, `taskId`, `status`, `assignee` | Task state change |
| `team_feed` | `teamId`, `entry: TeamFeedEntry` | New activity feed entry |
| `team_completed` | `teamId`, `summary`, `totalCost`, `totalDuration` | All done, summary ready |
| `teams_list` | `teams[]` | Response to `list_teams` |
| `team_detail` | full `TeamState` JSON | Response to `get_team` (historical) |

#### Existing Types (Extended)

`claude_output` gains two optional fields when inside a team:
```javascript
{
  type: 'claude_output',
  conversationId: 'uuid',
  teamId: 'team-123',        // NEW: null for non-team conversations
  agentRole: 'security',     // NEW: null for non-team conversations
  data: { ... }              // unchanged
}
```

`turn_completed` gains the same two fields. A single `turn_completed` fires when the Lead process finishes (after all subagents are done and Lead has produced its summary).

### 5.3 Web UI Module Architecture

#### New Modules

**`modules/team.js`** — Team state management and message routing
```javascript
export function createTeam(deps) {
  const teamState = ref(null);           // TeamState or null (active team)
  const activeAgentView = ref(null);     // Which agent's chat is displayed, null = dashboard
  const teamMode = ref(false);           // Team mode active
  const historicalTeam = ref(null);      // Read-only historical team data

  return {
    teamState, activeAgentView, teamMode, historicalTeam,
    launchTeam(config),                  // Send create_team
    dissolveTeam(),                      // Send dissolve_team → kills Lead process
    viewAgent(agentId),                  // Switch to agent detail
    viewDashboard(),                     // Back to kanban
    viewHistoricalTeam(teamId),          // Load read-only team
    handleTeamMessage(msg),              // Route incoming team_* messages
    getAgentColor(agentId),              // Color lookup
  };
}
```

**`modules/taskBoard.js`** — Task board computed properties
```javascript
export function createTaskBoard(deps) {
  const pendingTasks = computed(...);
  const activeTasks = computed(...);
  const doneTasks = computed(...);
  const failedTasks = computed(...);

  return { pendingTasks, activeTasks, doneTasks, failedTasks };
}
```

#### Modified Modules

**`connection.js`**: Add handlers for `team_*` message types in `ws.onmessage`. Route to `team.handleTeamMessage()`. For `claude_output` with `teamId`/`agentRole`, route to the appropriate agent's message list in team state instead of the main message list.

**`app.js`**: Add team mode toggle. When `teamMode` is true, render team dashboard or agent detail view. Wire team module creation.

**`sidebar.js`**: Mixed session list (team + solo). Team entries show icon, status, task count. `list_teams` request on connect. Click historical team → `viewHistoricalTeam()`.

### 5.4 Data Flow

#### Team Creation and Execution
```
User: enters task description, clicks Launch Team
  → wsSend({ type: 'create_team', instruction, template })
  → agent connection.ts → team.create()
  → team.ts: create TeamState (status: planning), generate agentsDef JSON
  → handleChat(convId, leadPrompt, workDir, { extraArgs: ['--agents', agentsJSON] })
  → claude.ts spawns single Lead process with --agents flag
  → team.ts output observer receives raw stream-json messages:

  Lead planning phase:
    stdout: system/init → web gets session info
    stdout: assistant (text: "analyzing codebase...") → web shows Lead planning
    stdout: assistant (tool_use: Read) → web shows Lead reading files
    ...
    team.ts: status = 'planning', forward as claude_output with agentRole='lead'

  Lead spawns subagents:
    stdout: assistant (tool_use: Agent, id=toolu_abc) → team.ts registers "security" agent
    stdout: assistant (tool_use: Agent, id=toolu_def) → team.ts registers "quality" agent
    team.ts: status = 'running', send team_created to web

  Subagent execution (parallel):
    stdout: system (task_started, tool_use_id=toolu_abc) → team.ts links security agent
    stdout: assistant (parent=toolu_abc, tool_use: Read) → team.ts routes to security
    stdout: assistant (parent=toolu_def, tool_use: Read) → team.ts routes to quality
    ...messages interleaved, routed by parent_tool_use_id...
    stdout: user (tool_use_result status=completed, agentId=xxx) → security done
    stdout: user (tool_use_result status=completed, agentId=yyy) → quality done
    team.ts: send team_task_update, team_agent_status for each

  Lead summarization:
    stdout: assistant (text: "## Summary\n\n...") → team.ts captures as summary
    stdout: result → team.ts: status = 'completed', send team_completed

  → team.ts persists to ~/.agentlink/teams/<id>.json
```

#### Team Cancellation
```
User: clicks [解散团队]
  → wsSend({ type: 'dissolve_team', teamId })
  → agent team.ts → cancelExecution(conversationId) or abort(conversationId)
  → kills the single Lead process (which kills all subagents)
  → team.ts: status = 'failed', persist, send team_completed with status=failed
```

#### Historical Team View
```
User: clicks historical team in sidebar
  → wsSend({ type: 'get_team', teamId })
  → agent team.ts: reads ~/.agentlink/teams/<id>.json
  → sends team_detail to web
  → web: team.viewHistoricalTeam() → renders read-only dashboard
  → user clicks agent →
      wsSend({ type: 'get_team_agent_history', teamId, agentTaskId })
      → agent reads ~/.claude/projects/{proj}/{sessionId}/subagents/agent-{agentTaskId}.jsonl
      → sends parsed messages to web → renders in agent detail view
```

### 5.5 Agent Progress Tracking

Based on stream-json output analysis (verified by experiment, 2026-03-07):

**Native signals from the single stdout stream:**

| Signal | Source | When |
|--------|--------|------|
| Subagent spawned | `assistant` msg with `tool_use.name=Agent` | Lead calls Agent tool |
| Subagent started | `system.subtype=task_started` + `task_id` | Claude begins executing subagent |
| Subagent working | Any msg with `parent_tool_use_id` | During subagent execution |
| Subagent tool use | `assistant` msg with `tool_use` blocks + `parent_tool_use_id` | Subagent calls Read, Grep, etc. |
| Subagent completed | `tool_use_result.status=completed` + `agentId` | Subagent returns result to Lead |
| Team completed | `result` msg (no `parent_tool_use_id`) | Lead process finishes |
| Success/failure | `result.is_error`, `result.subtype` | Team end |
| Cost | `result.total_cost_usd` | Team end (aggregate for Lead + all subagents) |
| Duration | `result.duration_ms` | Team end |

**Derived by `team.ts`:**

| Signal | Derivation |
|--------|------------|
| Per-agent status | Track `task_started` → working, `tool_use_result.completed` → done |
| Task completion % | `done_tasks / total_tasks` (discrete, not continuous) |
| Agent activity | Count `assistant` messages with matching `parent_tool_use_id` |
| Per-agent messages | Accumulate in `agent.messages[]` for detail view |

**Not available:**
- Per-subagent cost breakdown (only aggregate cost in final `result`)
- Continuous completion percentage (use discrete task count instead)

Progress display: pulsing dot when `parent_tool_use_id` messages are flowing for that agent. Task count as "1/3 done = 33%".

### 5.6 Inter-Agent Coordination

Subagents cannot communicate directly with each other. But the Lead process handles this **natively** — it's a natural part of the Lead's conversation flow:

```
Lead spawns Agent A, Agent B, Agent C (parallel)
  → A returns results to Lead (as tool_use_result)
  → B returns results to Lead
  → C returns results to Lead
Lead now has all three results in its context window
  → Lead can spawn Agent A' with "Here's what B found: ..." (if needed)
  → Lead synthesizes final summary incorporating all findings
```

This is **not something `team.ts` needs to implement**. The Lead naturally does multi-round coordination because:
- Each `Agent` call returns its result as a `tool_use_result` in the Lead's conversation
- The Lead sees all results and can decide to spawn follow-up agents
- The Lead produces the final summary text after all agents complete

`team.ts` simply observes additional `Agent` tool calls as new subagent spawns and routes their output accordingly. The web dashboard shows these as additional activity feed entries.

**V2 enhancement (future):** Local MCP server providing `SendTeamMessage(to, content)` and `CheckMessages()` tools to each subagent, enabling real-time peer messaging during execution.

## 6. Implementation Plan

### Phase 1: Agent-Side — Stream Parsing and Team State
1. Create `agent/src/team.ts` with TeamState management and output observer
2. Add `extraArgs` parameter to `handleChat()` in `claude.ts`
3. Add `setOutputObserver()` hook to `claude.ts` (raw + processed message)
4. Implement Lead prompt construction with `--agents` JSON from templates
5. Implement output stream parser:
   - Detect `Agent` tool calls → register subagents
   - Detect `system.task_started` → link agent IDs
   - Route by `parent_tool_use_id` → per-agent message accumulation
   - Detect `tool_use_result.status=completed` → mark agent done
   - Detect Lead summary text → capture
6. Add `create_team`, `dissolve_team` handlers to `connection.ts`
7. Implement team persistence (`~/.agentlink/teams/`)
8. Implement `list_teams`, `get_team`, `get_team_agent_history` handlers

### Phase 2: Web UI — Team Dashboard
1. Create `modules/team.js` with team state management
2. Create `modules/taskBoard.js` for kanban rendering
3. Add team mode toggle to `app.js`
4. Build team creation panel (textarea + template buttons)
5. Handle `team_created` → populate dashboard
6. Handle `team_agent_status` / `team_task_update` → animate kanban cards
7. Handle `claude_output` with `agentRole` → route to agent message buffers
8. Build agent status cards in sidebar
9. Build activity feed (unified timeline)
10. Build team completion view (summary + stats)

### Phase 3: Web UI — Agent Detail + History
1. Build agent detail view rendering (reuse existing message list components)
2. Build sidebar agent-list mode (click to switch between agents)
3. Handle `claude_output` with `agentRole` → render in active agent detail view
4. Add `list_teams` request on connect → populate sidebar with historical teams
5. Build read-only historical dashboard view (from `team_detail` response)
6. Build historical agent conversation viewer (from subagent JSONL)

### Phase 4: Polish
1. Error handling (Lead crash → team failed; subagent error → task failed, team continues)
2. Team dissolution (cancel Lead process → kills all subagents)
3. Page refresh recovery (load team state from persistence file)
4. Mobile responsive layout for team views
5. Task card detail popover
6. Cost display (aggregate from `result.total_cost_usd`)

## 7. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Lead doesn't call Agent tool as expected | No subagents spawned, no dashboard | Carefully engineered Lead prompt; fallback: detect if Lead produces text without Agent calls → display as single-agent mode |
| `parent_tool_use_id` format changes in future Claude versions | Stream parser breaks | Pin to tested Claude version; add defensive parsing with fallback |
| Lead spawns too many subagents | High cost, slow execution | Limit via `--max-budget-usd` flag; prompt Lead to use at most N agents |
| Single stdout stream becomes a bottleneck | Messages from parallel subagents interleave unpredictably | `parent_tool_use_id` handles routing regardless of interleaving order |
| Subagent can't communicate with peers | No real-time collaboration | Lead handles cross-agent relay natively; sufficient for V1 use cases |
| Team state file corruption | History lost | Write atomically (write to tmp, rename); in-memory state is source of truth during active team |
| Large team output floods web UI | Performance degradation | Activity feed capped at 200 entries; per-agent messages capped at 500 |
| User can't message subagents during execution | Less interactive | V1 limitation; subagents run to completion. V2: use `--input-format stream-json` for bidirectional communication |

## 8. Resolved Decisions

1. **Single Lead process with native `--agents` flag** — not multi-process orchestration. Uses Claude's built-in `Agent` tool for subagent spawn. One stdout stream, one conversation slot, zero multi-process complexity.

2. **`team.ts` is an observer, not an orchestrator** — the Lead Claude process autonomously handles planning, agent spawn, multi-round coordination, and summarization. `team.ts` only parses the output stream to extract UI state.

3. **Inter-agent coordination is native** — Lead sees all subagent results in its context window and can spawn follow-up agents with cross-referenced findings. No custom relay logic needed.

4. **Task board derived from Agent tool calls** — each `Agent` tool call = one task. No separate task planning step needed; `team.ts` infers tasks from the stream.

5. **Task board is read-only for users** — Lead generates and manages tasks autonomously. User cannot add/reassign tasks.

6. **One active team per agent session** — simplifies state management. User can start a new team after the current one completes or is dissolved.

7. **Historical teams are view-only** — no resume/continue. Subagent conversation history read from native `~/.claude/projects/{project}/{sessionId}/subagents/` JSONL files.

8. **User messages to subagents deferred to V2** — in V1, subagents run to completion. Adding user intervention requires `--input-format stream-json` on the Lead process, which is a separate enhancement.

9. **Aggregate cost only** — `result.total_cost_usd` covers Lead + all subagents combined. Per-subagent cost breakdown is not available from the stream.
