/**
 * Team persistence — disk I/O, serialization, and team listing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';
import type {
  TeamState,
  TeamStateSerialized,
  AgentTeammate,
  TeamSummaryInfo,
} from './team-types.js';

const TEAMS_DIR = join(CONFIG_DIR, 'teams');

/**
 * Serialize TeamState for persistence/transmission (Map → array).
 */
export function serializeTeam(team: TeamState, includeMessages = false): TeamStateSerialized {
  return {
    teamId: team.teamId,
    title: team.title,
    config: team.config,
    workDir: team.workDir,
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
      ...(includeMessages ? { messages: agent.messages } : {}),
    })),
    tasks: team.tasks,
    feed: team.feed,
    status: team.status,
    leadStatus: team.leadStatus,
    summary: team.summary,
    totalCost: team.totalCost,
    durationMs: team.durationMs,
    createdAt: team.createdAt,
  };
}

function ensureTeamsDir(): void {
  if (!existsSync(TEAMS_DIR)) {
    mkdirSync(TEAMS_DIR, { recursive: true });
  }
}

/**
 * Deserialize a TeamStateSerialized back into a live TeamState.
 */
export function deserializeTeam(data: TeamStateSerialized): TeamState {
  const agents = new Map<string, AgentTeammate>();
  for (const a of data.agents) {
    agents.set(a.id, {
      role: { id: a.id, name: a.name, color: a.color },
      toolUseId: a.toolUseId,
      agentTaskId: a.agentTaskId,
      status: a.status as AgentTeammate['status'],
      currentTaskId: a.currentTaskId,
      messages: a.messages || [],
    });
  }

  return {
    teamId: data.teamId,
    title: data.title,
    config: data.config,
    workDir: data.workDir || '',
    conversationId: data.conversationId,
    claudeSessionId: data.claudeSessionId,
    agents,
    tasks: data.tasks,
    feed: data.feed,
    status: data.status as TeamState['status'],
    leadStatus: data.leadStatus || '',
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
  const serialized = serializeTeam(team, true);
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
 * Needs the activeTeam reference to resolve teams by ID.
 */
export function flushPendingPersists(activeTeam: TeamState | null): void {
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
 * List all persisted teams, sorted by createdAt descending (newest first).
 */
export function listTeams(workDir?: string): TeamSummaryInfo[] {
  ensureTeamsDir();

  const files = readdirSync(TEAMS_DIR).filter(f => f.endsWith('.json'));
  const teams: TeamSummaryInfo[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(TEAMS_DIR, file), 'utf-8');
      const data = JSON.parse(raw) as TeamStateSerialized;
      // Filter by workDir if specified; old teams without workDir always show
      if (workDir && data.workDir && data.workDir !== workDir) continue;
      teams.push({
        teamId: data.teamId,
        title: data.title,
        status: data.status,
        template: data.config.template,
        agentCount: data.agents.length,
        taskCount: data.tasks.length,
        totalCost: data.totalCost,
        workDir: data.workDir,
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

export function renameTeam(teamId: string, newTitle: string): boolean {
  const filePath = join(TEAMS_DIR, `${teamId}.json`);
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as TeamStateSerialized;
    data.title = newTitle;
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
    return true;
  } catch {
    return false;
  }
}
