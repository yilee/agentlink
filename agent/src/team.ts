/**
 * Agent Team module — manages team state, output stream parsing,
 * and team lifecycle for multi-agent team mode.
 *
 * team.ts is an observer, not an orchestrator: it intercepts the Lead's
 * output stream to extract UI state (agent list, task board, activity feed)
 * while the Lead Claude process drives all planning/execution autonomously.
 */

import { randomUUID } from 'crypto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TeamConfig {
  instruction: string;           // high-level task description from user
  template?: string;             // 'code-review' | 'full-stack' | 'debug' | 'custom'
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
  type: 'task_started' | 'task_completed' | 'task_failed' | 'tool_call' | 'status_change';
  content: string;               // human-readable summary
}

// ── Serialization types (for persistence — Map → array) ────────────────

export interface TeamStateSerialized {
  teamId: string;
  title: string;
  config: TeamConfig;
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
  }>;
  tasks: TaskItem[];
  feed: TeamFeedEntry[];
  status: string;
  summary: string | null;
  totalCost: number;
  durationMs: number;
  createdAt: number;
}

// ── Color palette for auto-assigning agent colors ──────────────────────

const AGENT_COLORS = [
  '#EF4444', // red (Lead)
  '#EAB308', // yellow
  '#3B82F6', // blue
  '#10B981', // emerald
  '#8B5CF6', // violet
  '#F97316', // orange
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
  '#6366F1', // indigo
];

// ── Module state ───────────────────────────────────────────────────────

type SendFn = (msg: Record<string, unknown>) => void;

let activeTeam: TeamState | null = null;
let sendFn: SendFn = () => {};
let agentMessageIdCounter = 0;

// ── Public API ─────────────────────────────────────────────────────────

export function setTeamSendFn(fn: SendFn): void {
  sendFn = fn;
}

export function getActiveTeam(): TeamState | null {
  return activeTeam;
}

/**
 * Create a new team. Returns the TeamState.
 * Does NOT start the Lead process — the caller (team lifecycle functions) does that.
 */
export function createTeamState(config: TeamConfig, conversationId: string): TeamState {
  if (activeTeam) {
    throw new Error('A team is already active. Dissolve it before creating a new one.');
  }

  const teamId = randomUUID();
  const title = config.instruction.length > 60
    ? config.instruction.slice(0, 57) + '...'
    : config.instruction;

  const team: TeamState = {
    teamId,
    title,
    config,
    conversationId,
    claudeSessionId: null,
    agents: new Map(),
    tasks: [],
    feed: [],
    status: 'planning',
    summary: null,
    totalCost: 0,
    durationMs: 0,
    createdAt: Date.now(),
  };

  // Register Lead as the first agent
  team.agents.set('lead', {
    role: { id: 'lead', name: 'Lead', color: AGENT_COLORS[0] },
    toolUseId: null,
    agentTaskId: null,
    status: 'working',
    currentTaskId: null,
    messages: [],
  });

  activeTeam = team;
  agentMessageIdCounter = 0;

  return team;
}

/**
 * Clear the active team (used on dissolve/complete).
 */
export function clearActiveTeam(): void {
  activeTeam = null;
}

/**
 * Get the next color for an agent (based on current count).
 */
export function getNextAgentColor(team: TeamState): string {
  const idx = team.agents.size % AGENT_COLORS.length;
  return AGENT_COLORS[idx];
}

/**
 * Register a subagent when Lead calls the Agent tool.
 */
export function registerSubagent(
  team: TeamState,
  toolUseId: string,
  input: { name?: string; description?: string; prompt?: string },
): AgentTeammate {
  const agentId = (input.name || `agent-${team.agents.size}`).toLowerCase().replace(/\s+/g, '-');
  const displayName = input.name || `Agent ${team.agents.size}`;
  const color = getNextAgentColor(team);

  const teammate: AgentTeammate = {
    role: { id: agentId, name: displayName, color },
    toolUseId,
    agentTaskId: null,
    status: 'starting',
    currentTaskId: null,
    messages: [],
  };

  team.agents.set(agentId, teammate);

  // Auto-create a task for this agent
  const task: TaskItem = {
    id: `task-${randomUUID().slice(0, 8)}`,
    title: displayName,
    description: input.prompt || input.description || '',
    status: 'pending',
    assignee: agentId,
    toolUseId,
    agentTaskId: null,
    dependencies: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  team.tasks.push(task);
  teammate.currentTaskId = task.id;

  // Update team status
  if (team.status === 'planning') {
    team.status = 'running';
  }

  return teammate;
}

/**
 * Link a subagent's task_started system message to its tool_use_id.
 */
export function linkSubagentTaskId(team: TeamState, toolUseId: string, taskId: string): AgentTeammate | null {
  for (const agent of team.agents.values()) {
    if (agent.toolUseId === toolUseId) {
      agent.agentTaskId = taskId;
      agent.status = 'working';
      // Also update the task
      const task = team.tasks.find(t => t.toolUseId === toolUseId);
      if (task) {
        task.agentTaskId = taskId;
        task.status = 'active';
        task.updatedAt = Date.now();
      }
      return agent;
    }
  }
  return null;
}

/**
 * Find agent by toolUseId (parent_tool_use_id).
 */
export function findAgentByToolUseId(team: TeamState, toolUseId: string): AgentTeammate | null {
  for (const agent of team.agents.values()) {
    if (agent.toolUseId === toolUseId) return agent;
  }
  return null;
}

/**
 * Find agent by agentTaskId (task_id from system.task_started).
 */
export function findAgentByTaskId(team: TeamState, agentTaskId: string): AgentTeammate | null {
  for (const agent of team.agents.values()) {
    if (agent.agentTaskId === agentTaskId) return agent;
  }
  return null;
}

/**
 * Add a message to an agent's message list.
 */
export function addAgentMessage(
  agent: AgentTeammate,
  role: 'assistant' | 'tool' | 'user',
  fields: Partial<Omit<TeamAgentMessage, 'id' | 'role' | 'timestamp'>>,
): TeamAgentMessage {
  const msg: TeamAgentMessage = {
    id: ++agentMessageIdCounter,
    role,
    ...fields,
    timestamp: Date.now(),
  };
  agent.messages.push(msg);
  return msg;
}

/**
 * Add an entry to the team's activity feed.
 */
export function addFeedEntry(
  team: TeamState,
  agentId: string,
  type: TeamFeedEntry['type'],
  content: string,
): TeamFeedEntry {
  const entry: TeamFeedEntry = {
    timestamp: Date.now(),
    agentId,
    type,
    content,
  };
  team.feed.push(entry);
  // Cap feed at 200 entries
  if (team.feed.length > 200) {
    team.feed = team.feed.slice(-200);
  }
  return entry;
}

/**
 * Mark a task as done/failed.
 */
export function updateTaskStatus(team: TeamState, taskId: string, status: 'done' | 'failed'): TaskItem | null {
  const task = team.tasks.find(t => t.id === taskId);
  if (task) {
    task.status = status;
    task.updatedAt = Date.now();
  }
  return task ?? null;
}

/**
 * Check if all subagent tasks are completed.
 */
export function allSubagentsDone(team: TeamState): boolean {
  const subagents = [...team.agents.values()].filter(a => a.role.id !== 'lead');
  if (subagents.length === 0) return false;
  return subagents.every(a => a.status === 'done' || a.status === 'error');
}

/**
 * Serialize TeamState for persistence/transmission (Map → array).
 */
export function serializeTeam(team: TeamState): TeamStateSerialized {
  return {
    teamId: team.teamId,
    title: team.title,
    config: team.config,
    conversationId: team.conversationId,
    claudeSessionId: team.claudeSessionId,
    agents: [...team.agents.entries()].map(([, agent]) => ({
      id: agent.role.id,
      name: agent.role.name,
      color: agent.role.color,
      toolUseId: agent.toolUseId,
      agentTaskId: agent.agentTaskId,
      status: agent.status,
      currentTaskId: agent.currentTaskId,
    })),
    tasks: team.tasks,
    feed: team.feed,
    status: team.status,
    summary: team.summary,
    totalCost: team.totalCost,
    durationMs: team.durationMs,
    createdAt: team.createdAt,
  };
}
