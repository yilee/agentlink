/**
 * Agent Team module — manages team state, output stream parsing,
 * and team lifecycle for multi-agent team mode.
 *
 * team.ts is an observer, not an orchestrator: it intercepts the Lead's
 * output stream to extract UI state (agent list, task board, activity feed)
 * while the Lead Claude process drives all planning/execution autonomously.
 */

import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';

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

const TEAMS_DIR = join(CONFIG_DIR, 'teams');

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

// ── Persistence ──────────────────────────────────────────────────────────

function ensureTeamsDir(): void {
  if (!existsSync(TEAMS_DIR)) {
    mkdirSync(TEAMS_DIR, { recursive: true });
  }
}

/**
 * Deserialize a TeamStateSerialized back into a live TeamState.
 */
function deserializeTeam(data: TeamStateSerialized): TeamState {
  const agents = new Map<string, AgentTeammate>();
  for (const a of data.agents) {
    agents.set(a.id, {
      role: { id: a.id, name: a.name, color: a.color },
      toolUseId: a.toolUseId,
      agentTaskId: a.agentTaskId,
      status: a.status as AgentTeammate['status'],
      currentTaskId: a.currentTaskId,
      messages: [], // messages are not persisted (too large)
    });
  }

  return {
    teamId: data.teamId,
    title: data.title,
    config: data.config,
    conversationId: data.conversationId,
    claudeSessionId: data.claudeSessionId,
    agents,
    tasks: data.tasks,
    feed: data.feed,
    status: data.status as TeamState['status'],
    summary: data.summary,
    totalCost: data.totalCost,
    durationMs: data.durationMs,
    createdAt: data.createdAt,
  };
}

/**
 * Persist team state to disk (atomic write: tmp → rename).
 */
export function persistTeam(team: TeamState): void {
  ensureTeamsDir();
  const serialized = serializeTeam(team);
  const filePath = join(TEAMS_DIR, `${team.teamId}.json`);
  const tmpPath = filePath + '.tmp';

  writeFileSync(tmpPath, JSON.stringify(serialized, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

// Debounce timers for persist calls per team
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounced persist — coalesces rapid state changes into a single write.
 * Flushes after 500ms of quiet.
 */
export function persistTeamDebounced(team: TeamState): void {
  const existing = persistTimers.get(team.teamId);
  if (existing) clearTimeout(existing);

  persistTimers.set(team.teamId, setTimeout(() => {
    persistTimers.delete(team.teamId);
    persistTeam(team);
  }, 500));
}

/**
 * Flush all pending debounced persists immediately.
 */
export function flushPendingPersists(): void {
  for (const [teamId, timer] of persistTimers.entries()) {
    clearTimeout(timer);
    persistTimers.delete(teamId);
    if (activeTeam?.teamId === teamId) {
      persistTeam(activeTeam);
    }
  }
}

/**
 * Load a team from disk by teamId.
 */
export function loadTeam(teamId: string): TeamState | null {
  const filePath = join(TEAMS_DIR, `${teamId}.json`);
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as TeamStateSerialized;
    return deserializeTeam(data);
  } catch {
    return null;
  }
}

/**
 * Summary info for listing teams.
 */
export interface TeamSummaryInfo {
  teamId: string;
  title: string;
  status: string;
  template: string | undefined;
  agentCount: number;
  totalCost: number;
  createdAt: number;
}

/**
 * List all persisted teams, sorted by createdAt descending (newest first).
 */
export function listTeams(): TeamSummaryInfo[] {
  ensureTeamsDir();

  const files = readdirSync(TEAMS_DIR).filter(f => f.endsWith('.json'));
  const teams: TeamSummaryInfo[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(TEAMS_DIR, file), 'utf-8');
      const data = JSON.parse(raw) as TeamStateSerialized;
      teams.push({
        teamId: data.teamId,
        title: data.title,
        status: data.status,
        template: data.config.template,
        agentCount: data.agents.length,
        totalCost: data.totalCost,
        createdAt: data.createdAt,
      });
    } catch {
      // Skip corrupted files
    }
  }

  teams.sort((a, b) => b.createdAt - a.createdAt);
  return teams;
}

/**
 * Delete a persisted team file.
 */
export function deleteTeam(teamId: string): boolean {
  const filePath = join(TEAMS_DIR, `${teamId}.json`);
  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ── Template definitions ────────────────────────────────────────────────

interface AgentDef {
  description: string;
  prompt: string;
  tools: string[];
}

type AgentsDefMap = Record<string, AgentDef>;

const TEMPLATE_AGENTS: Record<string, AgentsDefMap> = {
  'code-review': {
    'security-reviewer': {
      description: 'Security expert focused on cryptographic, auth, and injection vulnerabilities',
      prompt: 'You are a security reviewer. Analyze code for vulnerabilities including injection attacks, authentication/authorization flaws, cryptographic issues, and data exposure risks. Provide specific file/line references and severity ratings.',
      tools: ['Read', 'Grep', 'Glob'],
    },
    'quality-reviewer': {
      description: 'Code quality expert focused on maintainability, patterns, and best practices',
      prompt: 'You are a code quality reviewer. Analyze code structure, naming conventions, error handling, test coverage, and adherence to best practices. Identify code smells, unnecessary complexity, and improvement opportunities.',
      tools: ['Read', 'Grep', 'Glob'],
    },
    'performance-reviewer': {
      description: 'Performance expert focused on efficiency, resource usage, and scalability',
      prompt: 'You are a performance reviewer. Identify performance bottlenecks, memory leaks, inefficient algorithms, unnecessary allocations, and scalability concerns. Suggest concrete optimizations with benchmarks where possible.',
      tools: ['Read', 'Grep', 'Glob'],
    },
  },
  'full-stack': {
    'backend-dev': {
      description: 'Backend developer for API endpoints, database, and server-side logic',
      prompt: 'You are a backend developer. Implement server-side features including API endpoints, data models, business logic, and integrations. Write clean, tested, production-ready code.',
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    },
    'frontend-dev': {
      description: 'Frontend developer for UI components, styling, and client-side logic',
      prompt: 'You are a frontend developer. Build user interface components, handle state management, implement responsive layouts, and ensure good UX. Follow the project\'s existing patterns and framework conventions.',
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    },
    'test-engineer': {
      description: 'Test engineer for unit tests, integration tests, and quality assurance',
      prompt: 'You are a test engineer. Write comprehensive tests (unit, integration, E2E) for new and existing code. Ensure edge cases are covered, mocks are appropriate, and tests are maintainable.',
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    },
  },
  'debug': {
    'hypothesis-a': {
      description: 'Debug investigator exploring the first hypothesis',
      prompt: 'You are a debugging specialist. Investigate the bug by exploring one specific hypothesis. Read relevant code, trace execution paths, check logs, and report your findings with evidence.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
    },
    'hypothesis-b': {
      description: 'Debug investigator exploring an alternative hypothesis',
      prompt: 'You are a debugging specialist. Investigate the bug by exploring an alternative hypothesis different from other investigators. Read relevant code, trace execution paths, check logs, and report your findings with evidence.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
    },
    'hypothesis-c': {
      description: 'Debug investigator exploring a third hypothesis',
      prompt: 'You are a debugging specialist. Investigate the bug by exploring yet another hypothesis different from the other investigators. Think creatively about less obvious causes. Report findings with evidence.',
      tools: ['Read', 'Grep', 'Glob', 'Bash'],
    },
  },
  'custom': {
    'worker-1': {
      description: 'General-purpose development agent',
      prompt: 'You are a skilled software engineer. Complete the assigned task thoroughly and report your results.',
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    },
    'worker-2': {
      description: 'General-purpose development agent',
      prompt: 'You are a skilled software engineer. Complete the assigned task thoroughly and report your results.',
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    },
    'worker-3': {
      description: 'General-purpose development agent',
      prompt: 'You are a skilled software engineer. Complete the assigned task thoroughly and report your results.',
      tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
    },
  },
};

const TEMPLATE_LEAD_INSTRUCTIONS: Record<string, string> = {
  'code-review': `You are a team lead coordinating a code review.

Instructions:
1. First, analyze the codebase to understand its structure and what needs reviewing
2. Use the Agent tool to spawn each reviewer IN PARALLEL (multiple Agent calls simultaneously)
3. Give each reviewer specific, detailed instructions referencing exact files and directories to review
4. After all reviewers complete, synthesize their findings into a unified summary with prioritized action items

Important: Spawn agents in parallel for efficiency. Each agent should focus on their specialty area.`,

  'full-stack': `You are a team lead coordinating full-stack development.

Instructions:
1. First, analyze the codebase to understand the architecture, existing patterns, and what needs building
2. Break the task into backend, frontend, and test subtasks
3. Use the Agent tool to assign each subtask to the appropriate specialist IN PARALLEL
4. Provide each agent with specific, detailed instructions including file paths, API contracts, and data schemas
5. After all agents complete, review their work and provide a summary of what was built

Important: Define clear interfaces between frontend and backend before spawning agents. Coordinate shared data types.`,

  'debug': `You are a team lead coordinating a debugging investigation.

Instructions:
1. First, analyze the bug report and relevant code to understand the problem space
2. Formulate 3 distinct hypotheses about the root cause
3. Use the Agent tool to assign each hypothesis to a different investigator IN PARALLEL
4. Give each investigator specific areas of code to examine and tests to run
5. After all investigators complete, compare their findings and synthesize a diagnosis with a recommended fix

Important: Each investigator should explore a DIFFERENT hypothesis. Avoid overlap.`,

  'custom': `You are a team lead coordinating a development task.

Instructions:
1. First, analyze the codebase and the user's request to understand what needs to be done
2. Break the task into independent subtasks that can be worked on in parallel
3. Use the Agent tool to assign subtasks to workers IN PARALLEL
4. Give each worker specific, detailed instructions
5. After all workers complete, review their work and provide a summary

Important: Maximize parallelism. Each agent should work on an independent piece.`,
};

/**
 * Build the agents definition JSON for the --agents CLI flag.
 */
export function buildAgentsDef(template?: string): AgentsDefMap {
  const key = template && TEMPLATE_AGENTS[template] ? template : 'custom';
  return { ...TEMPLATE_AGENTS[key] };
}

/**
 * Build the lead prompt that instructs the Lead to use Agent tool.
 */
export function buildLeadPrompt(config: TeamConfig, agentsDef: AgentsDefMap): string {
  const template = config.template || 'custom';
  const instructions = TEMPLATE_LEAD_INSTRUCTIONS[template] || TEMPLATE_LEAD_INSTRUCTIONS['custom'];

  const agentList = Object.entries(agentsDef)
    .map(([id, def]) => `- ${id}: ${def.description}`)
    .join('\n');

  return `${instructions}

Available agents (use the Agent tool to delegate to them):
${agentList}

User's request: "${config.instruction}"`;
}

// ── Output stream parser (observer callback) ────────────────────────────

/**
 * Output observer callback for the Lead's stdout stream.
 * Registered via setOutputObserver() when a team is active.
 * Returns true to suppress the message from normal web client forwarding.
 */
export function onLeadOutput(conversationId: string, msg: Record<string, unknown>): boolean {
  if (!activeTeam || conversationId !== activeTeam.conversationId) {
    return false; // not our team's conversation
  }

  const team = activeTeam;

  // Capture session ID from system init
  if (msg.type === 'system' && msg.session_id) {
    team.claudeSessionId = msg.session_id as string;
  }

  // 1. assistant message → check for Agent tool calls
  if (msg.type === 'assistant' && msg.message) {
    const message = msg.message as { content?: Array<Record<string, unknown>> };
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'tool_use' && block.name === 'Agent') {
          const input = (block.input || {}) as { name?: string; description?: string; prompt?: string };
          const toolUseId = block.id as string;
          const agent = registerSubagent(team, toolUseId, input);

          // Emit agent status + task update to web
          sendFn({
            type: 'team_agent_status',
            teamId: team.teamId,
            agent: {
              id: agent.role.id,
              name: agent.role.name,
              color: agent.role.color,
              status: agent.status,
              taskId: agent.currentTaskId,
            },
          });

          const task = team.tasks.find(t => t.assignee === agent.role.id);
          if (task) {
            sendFn({
              type: 'team_task_update',
              teamId: team.teamId,
              task,
            });
          }

          addFeedEntry(team, agent.role.id, 'status_change', `${agent.role.name} joined the team`);
          sendFn({
            type: 'team_feed',
            teamId: team.teamId,
            entry: team.feed[team.feed.length - 1],
          });
        }
      }
    }
    // Don't suppress Lead's assistant messages — they need to be forwarded
    // with team context for the Lead planning view
    if (!msg.parent_tool_use_id) {
      return false; // let normal forwarding handle Lead's own messages
    }
  }

  // 2. system.task_started → subagent began executing
  if (msg.type === 'system' && msg.subtype === 'task_started') {
    const toolUseId = msg.tool_use_id as string;
    const taskId = msg.task_id as string;
    const agent = linkSubagentTaskId(team, toolUseId, taskId);

    if (agent) {
      addFeedEntry(team, agent.role.id, 'task_started', `${agent.role.name} started working`);
      sendFn({
        type: 'team_agent_status',
        teamId: team.teamId,
        agent: {
          id: agent.role.id,
          name: agent.role.name,
          color: agent.role.color,
          status: agent.status,
          taskId: agent.currentTaskId,
        },
      });
      sendFn({
        type: 'team_feed',
        teamId: team.teamId,
        entry: team.feed[team.feed.length - 1],
      });

      const task = team.tasks.find(t => t.assignee === agent.role.id);
      if (task) {
        sendFn({
          type: 'team_task_update',
          teamId: team.teamId,
          task,
        });
      }
    }
    return true; // suppress system.task_started from normal forwarding
  }

  // 3. Messages with parent_tool_use_id → route to specific subagent
  if (msg.parent_tool_use_id) {
    const agent = findAgentByToolUseId(team, msg.parent_tool_use_id as string);
    if (agent) {
      routeMessageToAgent(team, agent, msg);
      return true; // suppress from normal forwarding
    }
  }

  // 4. user message with tool_use_result → check for subagent completion
  if (msg.type === 'user' && msg.message) {
    const message = msg.message as { content?: Array<Record<string, unknown>> };
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          // Check if this is a result for an Agent tool call
          const agent = findAgentByToolUseId(team, block.tool_use_id as string);
          if (agent) {
            agent.status = 'done';
            if (agent.currentTaskId) {
              updateTaskStatus(team, agent.currentTaskId, 'done');
            }
            addFeedEntry(team, agent.role.id, 'task_completed', `${agent.role.name} completed work`);

            sendFn({
              type: 'team_agent_status',
              teamId: team.teamId,
              agent: {
                id: agent.role.id,
                name: agent.role.name,
                color: agent.role.color,
                status: agent.status,
                taskId: agent.currentTaskId,
              },
            });

            const task = team.tasks.find(t => t.assignee === agent.role.id);
            if (task) {
              sendFn({
                type: 'team_task_update',
                teamId: team.teamId,
                task,
              });
            }

            sendFn({
              type: 'team_feed',
              teamId: team.teamId,
              entry: team.feed[team.feed.length - 1],
            });

            // Check if all subagents are done → transition to summarizing
            if (allSubagentsDone(team) && team.status === 'running') {
              team.status = 'summarizing';
            }

            return true; // suppress from normal forwarding
          }
        }
      }
    }
  }

  // 5. result message → team completed
  if (msg.type === 'result') {
    team.totalCost = (msg.total_cost_usd as number) || 0;
    team.durationMs = (msg.duration_ms as number) || 0;
    return false; // let normal forwarding handle result (turn_completed)
  }

  // Default: don't suppress (Lead's own messages flow through normally)
  return false;
}

/**
 * Route a subagent message to the agent's message list and forward to web.
 */
function routeMessageToAgent(
  team: TeamState,
  agent: AgentTeammate,
  msg: Record<string, unknown>,
): void {
  // Extract useful content from the message for agent detail view
  if (msg.type === 'assistant' && msg.message) {
    const message = msg.message as { content?: Array<Record<string, unknown>> };
    if (Array.isArray(message.content)) {
      // Text content
      const textBlocks = message.content.filter(b => b.type === 'text');
      for (const block of textBlocks) {
        if (block.text) {
          addAgentMessage(agent, 'assistant', { content: block.text as string });
        }
      }
      // Tool use blocks
      const toolBlocks = message.content.filter(b => b.type === 'tool_use');
      for (const block of toolBlocks) {
        addAgentMessage(agent, 'tool', {
          toolName: block.name as string,
          toolInput: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
        });

        addFeedEntry(team, agent.role.id, 'tool_call', `${agent.role.name} → ${block.name}`);
      }
    }
  }

  // Tool results (user messages within subagent context)
  if (msg.type === 'user' && msg.message) {
    const message = msg.message as { content?: Array<Record<string, unknown>> };
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'tool_result') {
          const content = typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? (block.content as Array<{ text?: string }>).map(b => b.text || '').join('')
              : '';
          addAgentMessage(agent, 'tool', {
            toolOutput: content.slice(0, 2000), // cap for memory
            hasResult: true,
          });
        }
      }
    }
  }

  // Forward to web with team + agent context — extract delta like claude.ts does
  const data = extractOutputData(msg);
  if (data) {
    sendFn({
      type: 'claude_output',
      teamId: team.teamId,
      agentRole: agent.role.id,
      data,
    });
  }
}

/**
 * Extract the output data payload from a raw message (similar to claude.ts processing).
 */
function extractOutputData(msg: Record<string, unknown>): Record<string, unknown> | null {
  if (msg.type === 'assistant' && msg.message) {
    const message = msg.message as { content?: Array<Record<string, unknown>> };
    if (Array.isArray(message.content)) {
      const textBlocks = message.content.filter(b => b.type === 'text');
      const fullText = textBlocks.map(b => (b.text as string) || '').join('');
      const toolBlocks = message.content.filter(b => b.type === 'tool_use');

      const result: Record<string, unknown> = {};
      if (fullText) {
        result.type = 'content_block_delta';
        result.delta = fullText;
      }
      if (toolBlocks.length > 0) {
        return { type: 'tool_use', tools: toolBlocks };
      }
      if (fullText) return result;
    }
  }

  if (msg.type === 'user') {
    return msg as Record<string, unknown>;
  }

  return null;
}
