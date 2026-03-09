/**
 * Agent Team module — manages team state, output stream parsing,
 * and team lifecycle for multi-agent team mode.
 *
 * team.ts is an observer, not an orchestrator: it intercepts the Lead's
 * output stream to extract UI state (agent list, task board, activity feed)
 * while the Lead Claude process drives all planning/execution autonomously.
 */

import { randomUUID } from 'crypto';

// Re-export types from sub-modules so existing imports continue to work
export type {
  TeamConfig,
  AgentRole,
  TaskItem,
  TeamState,
  AgentTeammate,
  TeamAgentMessage,
  TeamFeedEntry,
  TeamStateSerialized,
  TeamSummaryInfo,
  AgentDef,
  AgentsDefMap,
} from './team-types.js';

export { buildAgentsDef, buildLeadPrompt } from './team-templates.js';
export { getNextAgentColor, classifyRole, pickCharacter, deriveAgentDisplayName, deriveTaskTitle } from './team-naming.js';
export {
  serializeTeam,
  deserializeTeam,
  persistTeam,
  persistTeamDebounced,
  loadTeam,
  listTeams,
  deleteTeam,
  renameTeam,
} from './team-persistence.js';

import type {
  TeamConfig,
  TeamState,
  AgentTeammate,
  TeamAgentMessage,
  TeamFeedEntry,
  SendFn,
  HandleChatFn,
  CancelExecutionFn,
  SetOutputObserverFn,
  ClearOutputObserverFn,
  SetCloseObserverFn,
  ClearCloseObserverFn,
} from './team-types.js';

import { getNextAgentColor, deriveAgentDisplayName, deriveTaskTitle } from './team-naming.js';
import { buildAgentsDef, buildLeadPrompt } from './team-templates.js';
import {
  serializeTeam,
  persistTeam,
  flushPendingPersists as _flushPendingPersists,
} from './team-persistence.js';

// ── Module state ───────────────────────────────────────────────────────

let activeTeam: TeamState | null = null;
let sendFn: SendFn = () => {};
let handleChatFn: HandleChatFn | null = null;
let cancelExecutionFn: CancelExecutionFn | null = null;
let setOutputObserverFn: SetOutputObserverFn | null = null;
let clearOutputObserverFn: ClearOutputObserverFn | null = null;
let setCloseObserverFn: SetCloseObserverFn | null = null;
let clearCloseObserverFn: ClearCloseObserverFn | null = null;
let agentMessageIdCounter = 0;

// ── Public API ─────────────────────────────────────────────────────────

export function setTeamSendFn(fn: SendFn): void {
  sendFn = fn;
}

/**
 * Inject claude.ts dependencies to avoid circular imports.
 * Called once during agent startup from connection.ts.
 */
export function setTeamClaudeFns(fns: {
  handleChat: HandleChatFn;
  cancelExecution: CancelExecutionFn;
  setOutputObserver: SetOutputObserverFn;
  clearOutputObserver: ClearOutputObserverFn;
  setCloseObserver: SetCloseObserverFn;
  clearCloseObserver: ClearCloseObserverFn;
}): void {
  handleChatFn = fns.handleChat;
  cancelExecutionFn = fns.cancelExecution;
  setOutputObserverFn = fns.setOutputObserver;
  clearOutputObserverFn = fns.clearOutputObserver;
  setCloseObserverFn = fns.setCloseObserver;
  clearCloseObserverFn = fns.clearCloseObserver;
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
    leadStatus: 'Reading the codebase and crafting a plan...',
    summary: null,
    totalCost: 0,
    durationMs: 0,
    createdAt: Date.now(),
  };

  // Register Lead as the first agent
  team.agents.set('lead', {
    role: { id: 'lead', name: 'Lead', color: getNextAgentColor(team) },
    toolUseId: null,
    agentTaskId: null,
    status: 'working',
    currentTaskId: null,
    messages: [],
  });

  activeTeam = team;
  agentMessageIdCounter = 0;

  addFeedEntry(team, 'lead', 'lead_activity', 'Lead is reading the codebase and crafting a plan...');

  return team;
}

/**
 * Clear the active team (used on dissolve/complete).
 */
export function clearActiveTeam(): void {
  activeTeam = null;
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
  const displayName = deriveAgentDisplayName(team, input);
  const taskTitle = deriveTaskTitle(input);
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
  const task = {
    id: `task-${randomUUID().slice(0, 8)}`,
    title: taskTitle,
    description: input.prompt || input.description || '',
    status: 'pending' as const,
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
export function updateTaskStatus(team: TeamState, taskId: string, status: 'done' | 'failed'): import('./team-types.js').TaskItem | null {
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
 * Wrapper for flushPendingPersists that passes activeTeam.
 */
export function flushPendingPersists(): void {
  _flushPendingPersists(activeTeam);
}

// ── Shared helpers (deduplicated) ────────────────────────────────────────

/**
 * Emit agent status + task update + feed entry to web client.
 * Consolidates the 3-message broadcast pattern used in multiple places.
 */
function emitAgentUpdate(
  team: TeamState,
  agent: AgentTeammate,
  feedType: TeamFeedEntry['type'],
  feedMessage: string,
): void {
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

  addFeedEntry(team, agent.role.id, feedType, feedMessage);
  sendFn({
    type: 'team_feed',
    teamId: team.teamId,
    entry: team.feed[team.feed.length - 1],
  });
}

/**
 * Mark all active agents and tasks to a final status.
 * Used by both dissolveTeam and completeTeam.
 */
function finalizeAgentsAndTasks(
  team: TeamState,
  agentStatus: 'done' | 'error',
  taskStatus: 'done' | 'failed',
): void {
  for (const agent of team.agents.values()) {
    if (agentStatus === 'done') {
      if (agent.status !== 'error') agent.status = 'done';
    } else {
      if (agent.status === 'starting' || agent.status === 'working') agent.status = 'error';
    }
  }

  for (const task of team.tasks) {
    if (task.status === 'pending' || task.status === 'active') {
      task.status = taskStatus;
      task.updatedAt = Date.now();
    }
  }
}

/**
 * Remove output and close observers.
 */
function cleanupObservers(): void {
  if (clearOutputObserverFn) clearOutputObserverFn();
  if (clearCloseObserverFn) clearCloseObserverFn();
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

  // 1. assistant message → check for Agent tool calls + track lead activity
  if (msg.type === 'assistant' && msg.message) {
    const message = msg.message as { content?: Array<Record<string, unknown>> };
    const content = message.content;
    if (Array.isArray(content)) {
      // Track lead's text as activity (only for Lead's own messages, not subagent)
      if (!msg.parent_tool_use_id) {
        const textBlocks = content.filter(b => b.type === 'text');
        const leadText = textBlocks.map(b => (b.text as string) || '').join('');
        if (leadText.trim()) {
          // Extract a short summary for lead status
          const firstLine = leadText.trim().split('\n')[0].slice(0, 80);
          team.leadStatus = firstLine + (leadText.trim().length > 80 ? '...' : '');
          sendFn({ type: 'team_lead_status', teamId: team.teamId, leadStatus: team.leadStatus });
        }
        // Check if Lead is dispatching Agent tools
        const agentCalls = content.filter(b => b.type === 'tool_use' && b.name === 'Agent');
        if (agentCalls.length > 0) {
          team.leadStatus = `Assigning work to ${agentCalls.length} agent${agentCalls.length > 1 ? 's' : ''}...`;
          sendFn({ type: 'team_lead_status', teamId: team.teamId, leadStatus: team.leadStatus });
        }

        // Forward lead's own messages with team context for lead detail view
        if (leadText) {
          sendFn({
            type: 'claude_output',
            teamId: team.teamId,
            agentRole: 'lead',
            data: { type: 'content_block_delta', delta: leadText },
          });
        }
        const toolBlocks = content.filter(b => b.type === 'tool_use');
        if (toolBlocks.length > 0) {
          sendFn({
            type: 'claude_output',
            teamId: team.teamId,
            agentRole: 'lead',
            data: { type: 'tool_use', tools: toolBlocks },
          });
        }
      }

      for (const block of content) {
        if (block.type === 'tool_use' && block.name === 'Agent') {
          const input = (block.input || {}) as { name?: string; description?: string; prompt?: string };
          const toolUseId = block.id as string;
          const agent = registerSubagent(team, toolUseId, input);

          emitAgentUpdate(team, agent, 'status_change', `${agent.role.name} has joined and is getting ready`);
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
      emitAgentUpdate(team, agent, 'task_started', `${agent.role.name} started working on the task`);
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
            const isError = !!block.is_error;
            agent.status = isError ? 'error' : 'done';
            if (agent.currentTaskId) {
              updateTaskStatus(team, agent.currentTaskId, isError ? 'failed' : 'done');
            }

            emitAgentUpdate(
              team,
              agent,
              isError ? 'task_failed' : 'task_completed',
              isError ? `${agent.role.name} ran into an issue and stopped` : `${agent.role.name} finished the task successfully`,
            );

            // Check if all subagents are done → transition to summarizing
            if (allSubagentsDone(team) && team.status === 'running') {
              team.status = 'summarizing';
              team.leadStatus = 'Reviewing results and writing summary...';
              sendFn({ type: 'team_lead_status', teamId: team.teamId, leadStatus: team.leadStatus });
              addFeedEntry(team, 'lead', 'lead_activity', 'Lead is reviewing everyone\'s work and writing a summary');
              sendFn({ type: 'team_feed', teamId: team.teamId, entry: team.feed[team.feed.length - 1] });
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

    // Extract summary from result if available
    const resultText = (msg.result as string) || undefined;
    completeTeam(resultText);

    return false; // let normal forwarding handle result (turn_completed)
  }

  // Default: don't suppress (Lead's own messages flow through normally)
  return false;
}

/**
 * Close observer callback for the Lead's process exit.
 * Detects Lead crash (process exited without a result message) and dissolves the team.
 */
export function onLeadClose(conversationId: string, _exitCode: number | null, resultReceived: boolean): void {
  if (!activeTeam || conversationId !== activeTeam.conversationId) return;

  // If result was received, completeTeam() was already called from onLeadOutput
  if (resultReceived) return;

  // Lead process crashed without producing a result — dissolve the team
  console.log(`[Team] Lead process exited without result — marking team as failed`);
  const team = activeTeam;

  finalizeAgentsAndTasks(team, 'error', 'failed');

  team.status = 'failed';
  team.durationMs = Date.now() - team.createdAt;
  persistTeam(team);

  cleanupObservers();

  // Notify clients
  sendFn({
    type: 'team_completed',
    teamId: team.teamId,
    status: 'failed',
    team: serializeTeam(team),
  });

  clearActiveTeam();
}

/**
 * Generate a human-readable description for a tool call feed entry.
 */
function describeToolCall(agentName: string, block: Record<string, unknown>): string {
  const name = block.name as string;
  const input = (block.input || {}) as Record<string, unknown>;
  const shortPath = (p: string) => {
    const parts = p.replace(/\\/g, '/').split('/');
    return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : p;
  };

  switch (name) {
    case 'Read':
      return `${agentName} is reading ${shortPath(String(input.file_path || input.path || ''))}`;
    case 'Write':
      return `${agentName} is creating ${shortPath(String(input.file_path || input.path || ''))}`;
    case 'Edit':
      return `${agentName} is modifying ${shortPath(String(input.file_path || input.path || ''))}`;
    case 'Bash': {
      const cmd = String(input.command || '').slice(0, 60);
      return `${agentName} is running \`${cmd}${String(input.command || '').length > 60 ? '...' : ''}\``;
    }
    case 'Grep': {
      const pat = String(input.pattern || '').slice(0, 40);
      return `${agentName} is searching for "${pat}"`;
    }
    case 'Glob': {
      const pat = String(input.pattern || '').slice(0, 40);
      return `${agentName} is looking for files matching "${pat}"`;
    }
    case 'Agent': {
      const desc = String(input.description || input.prompt || '').slice(0, 60);
      return `${agentName} is delegating: ${desc}`;
    }
    default:
      return `${agentName} is using ${name}`;
  }
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

        addFeedEntry(team, agent.role.id, 'tool_call', describeToolCall(agent.role.name, block));
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

// ── Team lifecycle ──────────────────────────────────────────────────────

/**
 * Create and launch a team. Returns the TeamState.
 * Spawns the Lead Claude process with --agents flag and attaches the output observer.
 */
export function createTeam(config: TeamConfig, workDir: string): TeamState {
  if (!handleChatFn || !setOutputObserverFn) {
    throw new Error('Team claude functions not initialized. Call setTeamClaudeFns() first.');
  }

  const conversationId = `team-${randomUUID().slice(0, 8)}`;
  const team = createTeamState(config, conversationId);

  // Build agents definition for --agents flag
  const agentsDef = buildAgentsDef(config.template);
  const agentsJson = JSON.stringify(agentsDef);

  // Build the lead prompt
  const leadPrompt = buildLeadPrompt(config, agentsDef);

  // Attach output observer before spawning
  setOutputObserverFn(onLeadOutput);

  // Attach close observer to detect Lead crash
  if (setCloseObserverFn) {
    setCloseObserverFn(onLeadClose);
  }

  // Spawn the Lead process with --agents flag
  handleChatFn(conversationId, leadPrompt, workDir, {
    extraArgs: ['--agents', agentsJson],
  });

  // Persist initial state
  persistTeam(team);

  // Notify clients
  sendFn({
    type: 'team_created',
    team: serializeTeam(team),
  });

  return team;
}

/**
 * Dissolve (cancel) the active team.
 */
export function dissolveTeam(): void {
  if (!activeTeam) return;

  const team = activeTeam;

  // Cancel the Lead process
  if (cancelExecutionFn) {
    cancelExecutionFn(team.conversationId);
  }

  finalizeAgentsAndTasks(team, 'error', 'failed');

  team.status = 'failed';
  persistTeam(team);

  cleanupObservers();

  // Notify clients
  sendFn({
    type: 'team_completed',
    teamId: team.teamId,
    status: 'failed',
    team: serializeTeam(team),
  });

  clearActiveTeam();
}

/**
 * Called when the Lead's result message arrives (from onLeadOutput).
 * Marks the team as completed, persists state, and notifies clients.
 */
export function completeTeam(summary?: string): void {
  if (!activeTeam) return;

  const team = activeTeam;
  team.status = 'completed';
  if (summary) {
    team.summary = summary;
  }

  finalizeAgentsAndTasks(team, 'done', 'done');

  persistTeam(team);

  cleanupObservers();

  // Notify clients
  sendFn({
    type: 'team_completed',
    teamId: team.teamId,
    status: 'completed',
    team: serializeTeam(team),
  });

  clearActiveTeam();
}
