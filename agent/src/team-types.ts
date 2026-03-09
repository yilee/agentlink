// ── Team types & interfaces ─────────────────────────────────────────────

export interface TeamConfig {
  instruction: string;           // high-level task description from user
  template?: string;             // 'code-review' | 'full-stack' | 'debug' | 'custom' (kept for backward compat in persisted data)
  leadPrompt?: string;           // full lead prompt (sent from web UI)
  agents?: AgentsDefMap;         // agent definitions (sent from web UI)
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
  workDir: string;               // working directory when the team was created
  conversationId: string;        // single conversation in claude.ts (Lead process)
  claudeSessionId: string | null;// Lead's session ID (for history + subagent JSONL)
  agents: Map<string, AgentTeammate>;
  tasks: TaskItem[];
  feed: TeamFeedEntry[];
  status: 'planning' | 'running' | 'summarizing' | 'completed' | 'failed';
  leadStatus: string;            // human-readable lead activity description
  summary: string | null;        // Lead's final summary
  totalCost: number;
  durationMs: number;
  createdAt: number;
}

export interface AgentTeammate {
  role: AgentRole;
  toolUseId: string | null;      // the Agent tool_use_id that spawned this subagent
  agentTaskId: string | null;    // task_id from system.task_started
  status: 'starting' | 'working' | 'done' | 'error';
  currentTaskId: string | null;  // which TaskItem this agent is working on
  messages: TeamAgentMessage[];  // accumulated messages for agent detail view
}

export interface TeamAgentMessage {
  id: number;
  role: 'assistant' | 'tool' | 'user';
  content?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
  hasResult?: boolean;
  timestamp: number;
}

export interface TeamFeedEntry {
  timestamp: number;
  agentId: string;
  type: 'task_started' | 'task_completed' | 'task_failed' | 'tool_call' | 'status_change' | 'lead_activity';
  content: string;               // human-readable summary
}

// ── Serialization types (for persistence — Map → array) ────────────────

export interface TeamStateSerialized {
  teamId: string;
  title: string;
  config: TeamConfig;
  workDir?: string;              // working directory (optional for backward compat with old files)
  conversationId: string;
  claudeSessionId: string | null;
  agents: Array<{
    id: string;
    name: string;
    color: string;
    toolUseId: string | null;
    agentTaskId: string | null;
    status: string;
    currentTaskId: string | null;
    messages?: TeamAgentMessage[];
  }>;
  tasks: TaskItem[];
  feed: TeamFeedEntry[];
  status: string;
  leadStatus: string;
  summary: string | null;
  totalCost: number;
  durationMs: number;
  createdAt: number;
}

// ── Summary info for listing teams ─────────────────────────────────────

export interface TeamSummaryInfo {
  teamId: string;
  title: string;
  status: string;
  template: string | undefined;
  agentCount: number;
  taskCount: number;
  totalCost: number;
  workDir?: string;
  createdAt: number;
}

// ── Callback function types ────────────────────────────────────────────

export type SendFn = (msg: Record<string, unknown>) => void;
export type HandleChatFn = (
  conversationId: string | undefined,
  prompt: string,
  workDir: string,
  options?: { resumeSessionId?: string; extraArgs?: string[] },
) => void;
export type CancelExecutionFn = (conversationId?: string) => void;
export type SetOutputObserverFn = (fn: (conversationId: string, msg: Record<string, unknown>) => boolean | void) => void;
export type ClearOutputObserverFn = () => void;
export type SetCloseObserverFn = (fn: (conversationId: string, exitCode: number | null, resultReceived: boolean) => void) => void;
export type ClearCloseObserverFn = () => void;

// ── Template-related types ─────────────────────────────────────────────

export interface AgentDef {
  description: string;
  prompt: string;
  tools: string[];
}

export type AgentsDefMap = Record<string, AgentDef>;
