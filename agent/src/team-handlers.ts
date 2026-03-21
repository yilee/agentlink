// ── Team message handlers extracted from connection.ts ──
import { createTeam, dissolveTeam, getActiveTeam, loadTeam, listTeams, deleteTeam, renameTeam, serializeTeam, type TeamConfig } from './team.js';

type SendFn = (msg: Record<string, unknown>) => void;

export function handleCreateTeam(
  msg: { instruction: string; template?: string; leadPrompt?: string; agents?: Record<string, unknown> },
  workDir: string,
  send: SendFn,
): void {
  try {
    createTeam({
      instruction: msg.instruction,
      template: msg.template,
      leadPrompt: msg.leadPrompt,
      agents: msg.agents as TeamConfig['agents'],
    }, workDir);
  } catch (err) {
    send({ type: 'error', message: (err as Error).message });
  }
}

export function handleDissolveTeam(): void {
  dissolveTeam();
}

export function handleListTeams(workDir: string, send: SendFn): void {
  send({ type: 'teams_list', teams: listTeams(workDir) });
}

export function handleGetTeam(
  msg: { teamId: string },
  send: SendFn,
): void {
  const active = getActiveTeam();
  if (active && active.teamId === msg.teamId) {
    send({ type: 'team_detail', team: serializeTeam(active) });
  } else {
    const team = loadTeam(msg.teamId);
    if (team) {
      send({ type: 'team_detail', team: serializeTeam(team) });
    } else {
      send({ type: 'error', message: `Team not found: ${msg.teamId}` });
    }
  }
}

export function handleGetTeamAgentHistory(
  msg: { teamId: string; agentId: string },
  send: SendFn,
): void {
  const active = getActiveTeam();
  if (active && active.teamId === msg.teamId) {
    if (msg.agentId === 'lead') {
      send({ type: 'team_agent_history', teamId: msg.teamId, agentId: 'lead', messages: active.leadMessages || [] });
    } else {
      const agent = active.agents.get(msg.agentId);
      if (agent) {
        send({ type: 'team_agent_history', teamId: msg.teamId, agentId: msg.agentId, messages: agent.messages });
      } else {
        send({ type: 'error', message: `Agent not found: ${msg.agentId}` });
      }
    }
  } else {
    // Historical team — load from disk (messages are persisted)
    const team = loadTeam(msg.teamId);
    if (team) {
      if (msg.agentId === 'lead') {
        send({ type: 'team_agent_history', teamId: msg.teamId, agentId: 'lead', messages: team.leadMessages || [] });
      } else if (team.agents.has(msg.agentId)) {
        const agent = team.agents.get(msg.agentId)!;
        send({ type: 'team_agent_history', teamId: msg.teamId, agentId: msg.agentId, messages: agent.messages });
      } else {
        send({ type: 'error', message: `Agent not found: ${msg.agentId}` });
      }
    } else {
      send({ type: 'error', message: `Team not found: ${msg.teamId}` });
    }
  }
}

export function handleDeleteTeam(
  msg: { teamId: string },
  send: SendFn,
): void {
  const active = getActiveTeam();
  if (active && active.teamId === msg.teamId) {
    send({ type: 'error', message: 'Cannot delete an active team.' });
    return;
  }
  const deleted = deleteTeam(msg.teamId);
  if (deleted) {
    send({ type: 'team_deleted', teamId: msg.teamId });
  } else {
    send({ type: 'error', message: 'Team not found or could not be deleted.' });
  }
}

export function handleRenameTeam(
  msg: { teamId: string; newTitle: string },
  send: SendFn,
): void {
  const active = getActiveTeam();
  // If renaming the active team, update in-memory state too
  if (active && active.teamId === msg.teamId) {
    active.title = msg.newTitle;
  }
  const renamed = renameTeam(msg.teamId, msg.newTitle);
  if (renamed) {
    send({ type: 'team_renamed', teamId: msg.teamId, newTitle: msg.newTitle });
  } else {
    send({ type: 'error', message: 'Team not found or could not be renamed.' });
  }
}
