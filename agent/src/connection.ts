import WebSocket from 'ws';
import os from 'os';
import { existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { resolve, isAbsolute, join, basename } from 'path';
import { createRequire } from 'module';
import type { AgentConfig } from './config.js';
import { loadRuntimeState, saveRuntimeState } from './config.js';
import { readFileForPreview } from './file-readers.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
import { handleChat as claudeHandleChat, setSendFn, abort as abortClaude, abortAll as abortAllClaude, cancelExecution as claudeCancelExecution, handleUserAnswer, getConversation, getConversations, getIsCompacting, clearSessionId, evictByClaudeSessionId, rebindConversation, setOutputObserver, clearOutputObserver, setCloseObserver, clearCloseObserver, type ChatFile } from './claude.js';
import { listSessions, readSessionMessages, deleteSession, renameSession } from './history.js';
import { decodeKey, parseMessage, encryptAndSend } from './encryption.js';
import { setTeamSendFn, setTeamClaudeFns, createTeam, dissolveTeam, getActiveTeam, loadTeam, listTeams, deleteTeam, renameTeam, serializeTeam, type TeamConfig } from './team.js';

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;

interface ConnectionState {
  ws: WebSocket | null;
  sessionId: string | null;
  sessionKey: Uint8Array | null;
  reconnectAttempts: number;
  shouldReconnect: boolean;
  workDir: string;
  config: AgentConfig | null;
}

const state: ConnectionState = {
  ws: null,
  sessionId: null,
  sessionKey: null,
  reconnectAttempts: 0,
  shouldReconnect: true,
  workDir: process.cwd(),
  config: null,
};

/**
 * Connect to the relay server. Returns the sessionId on first successful registration.
 * Reconnects are handled internally — this Promise only covers the initial connect.
 */
export function connect(config: AgentConfig): Promise<string> {
  state.workDir = config.dir;
  state.config = config;
  state.shouldReconnect = true;

  // Restore previous sessionId so the session URL survives agent restarts (e.g. upgrade)
  const prev = loadRuntimeState();
  if (prev?.sessionId && prev.server === config.server) {
    state.sessionId = prev.sessionId;
    console.log(`[AgentLink] Restoring session: ${prev.sessionId}`);
  }

  // Wire up the Claude module to send messages through our WebSocket
  setSendFn(send);

  // Wire up the Team module with send and claude dependencies
  setTeamSendFn(send);
  setTeamClaudeFns({
    handleChat: claudeHandleChat,
    cancelExecution: claudeCancelExecution,
    setOutputObserver,
    clearOutputObserver,
    setCloseObserver,
    clearCloseObserver,
  });

  return new Promise((resolve, reject) => {
    doConnect(config, (sessionId) => resolve(sessionId), (err) => reject(err));
  });
}

/**
 * Internal connect. Calls onRegistered on success, onError on failure.
 * For reconnects, both callbacks are no-ops.
 */
function doConnect(
  config: AgentConfig,
  onRegistered: (sessionId: string) => void,
  onError: (err: Error) => void,
): void {
  const wsUrl = buildWsUrl(config);
  console.log(`[AgentLink] Connecting to ${config.server}...${state.sessionId ? ` (session: ${state.sessionId})` : ''}`);

  const ws = new WebSocket(wsUrl);
  state.ws = ws;
  let settled = false;

  ws.on('open', () => {
    state.reconnectAttempts = 0;
    console.log('[AgentLink] Connected to server');
  });

  ws.on('message', async (data) => {
    const raw = data.toString();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('[AgentLink] Failed to parse message');
      return;
    }

    if (parsed.type === 'registered') {
      const newSessionId = parsed.sessionId as string;
      const previousSessionId = state.sessionId;
      state.sessionId = newSessionId;
      if (typeof parsed.sessionKey === 'string') {
        state.sessionKey = decodeKey(parsed.sessionKey);
      }
      if (!settled) {
        settled = true;
        onRegistered(state.sessionId);
      }
      // Always check for session ID changes and update runtime state
      if (previousSessionId && previousSessionId !== newSessionId) {
        console.warn(`[AgentLink] Session ID changed: ${previousSessionId} → ${newSessionId}`);
        const prev = loadRuntimeState();
        if (prev) {
          const httpBase = (state.config?.server || '')
            .replace(/^wss:/, 'https:')
            .replace(/^ws:/, 'http:');
          saveRuntimeState({
            ...prev,
            sessionId: newSessionId,
            sessionUrl: `${httpBase}/s/${newSessionId}`,
          });
        }
      }
      console.log(`[AgentLink] Registered, session: ${state.sessionId}`);
    } else {
      const msg = await parseMessage(raw, state.sessionKey);
      if (msg) {
        handleServerMessage(msg as { type: string; [key: string]: unknown });
      } else {
        console.error(`[AgentLink] Failed to decrypt message (key=${state.sessionKey ? 'set' : 'null'}, raw=${raw.slice(0, 120)})`);
      }
    }
  });

  ws.on('close', () => {
    console.log('[AgentLink] Disconnected from server');
    if (state.shouldReconnect) {
      scheduleReconnect(config);
    }
  });

  ws.on('error', (err) => {
    console.error(`[AgentLink] WebSocket error: ${err.message}`);
    // On first connect, reject the promise so index.ts can handle the error.
    // On reconnect, do nothing — close handler will schedule another attempt.
    if (!settled && !state.sessionId) {
      settled = true;
      onError(err);
    }
  });
}

export function disconnect(): void {
  state.shouldReconnect = false;
  abortAllClaude();
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
}

let sendQueue = Promise.resolve();

export function send(msg: Record<string, unknown>): void {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    sendQueue = sendQueue.then(() =>
      encryptAndSend(state.ws!, msg, state.sessionKey));
  } else {
    console.warn(`[AgentLink] Cannot send ${msg.type}: WebSocket not open (readyState=${state.ws?.readyState})`);
  }
}

function buildWsUrl(config: AgentConfig): string {
  const base = config.server.replace(/\/$/, '');
  const params = new URLSearchParams({
    type: 'agent',
    id: config.name,
    name: config.name,
    workDir: state.workDir,
    hostname: os.hostname(),
    version: pkg.version,
  });
  // On reconnect, send previous sessionId so the URL stays valid
  if (state.sessionId) {
    params.set('sessionId', state.sessionId);
  } else {
    console.warn('[AgentLink] No sessionId to send on reconnect — server will assign a new one');
  }
  // Send password if configured (server will hash it)
  if (config.password) {
    params.set('password', config.password);
  }
  return `${base}/?${params}`;
}

function scheduleReconnect(config: AgentConfig): void {
  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[AgentLink] Max reconnect attempts reached. Server may be down.');
    console.error('[AgentLink] Check server status or restart the agent.');
    process.exit(1);
  }

  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(1.5, state.reconnectAttempts),
    RECONNECT_MAX_DELAY
  );
  state.reconnectAttempts++;

  console.log(`[AgentLink] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

  setTimeout(() => {
    state.sessionKey = null; // Reset key; new one will come from server
    // On reconnect, callbacks are no-ops — we don't need to resolve/reject anything
    doConnect(config, () => {
      console.log('[AgentLink] Reconnected successfully');
    }, () => {
      // Connection failed, close handler will schedule next attempt
    });
  }, delay);
}

function handleServerMessage(msg: { type: string; [key: string]: unknown }): void {
  console.log(`[AgentLink] ← ${msg.type}`);
  switch (msg.type) {
    case 'chat': {
      const chatConvId = (msg as unknown as { conversationId?: string }).conversationId;
      const existingConv = chatConvId ? getConversation(chatConvId) : getConversation();
      claudeHandleChat(
        chatConvId,
        (msg as unknown as { prompt: string }).prompt,
        existingConv?.workDir || state.workDir,
        { resumeSessionId: (msg as unknown as { resumeSessionId?: string }).resumeSessionId },
        (msg as unknown as { files?: ChatFile[] }).files,
      );
      break;
    }
    case 'cancel_execution':
      claudeCancelExecution((msg as unknown as { conversationId?: string }).conversationId);
      break;
    case 'list_sessions':
      handleListSessions();
      break;
    case 'list_directory':
      handleListDirectory(msg as unknown as { dirPath: string; source?: string });
      break;
    case 'read_file':
      handleReadFile(msg as unknown as { filePath: string });
      break;
    case 'change_workdir':
      handleChangeWorkDir(msg as unknown as { workDir: string });
      break;
    case 'new_conversation':
      // Backward compat: old web client sends this to reset the single conversation
      abortClaude();
      clearSessionId('default');
      console.log('[AgentLink] New conversation — session cleared');
      break;
    case 'resume_conversation': {
      const m = msg as unknown as { claudeSessionId: string; conversationId?: string };
      const convId = m.conversationId;

      if (!convId) {
        // Backward compat: single-session mode
        const conv = getConversation();
        if (!conv || conv.claudeSessionId !== m.claudeSessionId) {
          abortClaude();
        }
      } else {
        // Multi-session: rebind running conversation to new conversationId
        // (handles page refresh where web client generates a new UUID)
        rebindConversation(m.claudeSessionId, convId);
      }

      const history = readSessionMessages(state.workDir, m.claudeSessionId);
      console.log(`[AgentLink] → conversation_resumed (${history.length} messages, session ${m.claudeSessionId.slice(0, 8)})`);

      // Include live status so the web client can restore compacting/processing state
      // In multi-session mode, look up by conversationId; in single-session mode, use default
      const currentConv = convId ? getConversation(convId) : getConversation();
      const isSameSession = currentConv?.claudeSessionId === m.claudeSessionId;
      send({
        type: 'conversation_resumed',
        conversationId: convId,
        claudeSessionId: m.claudeSessionId,
        history,
        isCompacting: isSameSession && (convId ? getIsCompacting(convId) : getIsCompacting()),
        isProcessing: isSameSession && currentConv?.turnActive === true,
      });
      break;
    }
    case 'ask_user_answer': {
      const m = msg as unknown as { requestId: string; answers: Record<string, unknown> };
      handleUserAnswer(m.requestId, m.answers);
      break;
    }
    case 'delete_session': {
      const m = msg as unknown as { sessionId: string };
      handleDeleteSession(m.sessionId);
      break;
    }
    case 'rename_session': {
      const m = msg as unknown as { sessionId: string; newTitle: string };
      handleRenameSession(m.sessionId, m.newTitle);
      break;
    }
    case 'query_active_conversations': {
      const active: Array<{ conversationId: string; claudeSessionId: string | null; isProcessing: boolean; isCompacting: boolean }> = [];
      for (const [convId, conv] of getConversations()) {
        if (conv.turnActive) {
          active.push({
            conversationId: convId,
            claudeSessionId: conv.claudeSessionId,
            isProcessing: true,
            isCompacting: getIsCompacting(convId),
          });
        }
      }
      const activeTeamState = getActiveTeam();
      console.log(`[AgentLink] → active_conversations (${active.length} active)`);
      send({
        type: 'active_conversations',
        conversations: active,
        activeTeam: activeTeamState ? serializeTeam(activeTeamState) : null,
      });
      break;
    }
    case 'create_team': {
      const m = msg as unknown as { instruction: string; template?: string };
      try {
        createTeam({ instruction: m.instruction, template: m.template }, state.workDir);
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      }
      break;
    }
    case 'dissolve_team':
      dissolveTeam();
      break;
    case 'list_teams':
      send({ type: 'teams_list', teams: listTeams() });
      break;
    case 'get_team': {
      const m = msg as unknown as { teamId: string };
      const active = getActiveTeam();
      if (active && active.teamId === m.teamId) {
        send({ type: 'team_detail', team: serializeTeam(active) });
      } else {
        const team = loadTeam(m.teamId);
        if (team) {
          send({ type: 'team_detail', team: serializeTeam(team) });
        } else {
          send({ type: 'error', message: `Team not found: ${m.teamId}` });
        }
      }
      break;
    }
    case 'get_team_agent_history': {
      const m = msg as unknown as { teamId: string; agentId: string };
      const active = getActiveTeam();
      if (active && active.teamId === m.teamId) {
        const agent = active.agents.get(m.agentId);
        if (agent) {
          send({ type: 'team_agent_history', teamId: m.teamId, agentId: m.agentId, messages: agent.messages });
        } else {
          send({ type: 'error', message: `Agent not found: ${m.agentId}` });
        }
      } else {
        // Historical team — load from disk (messages are persisted)
        const team = loadTeam(m.teamId);
        if (team && team.agents.has(m.agentId)) {
          const agent = team.agents.get(m.agentId)!;
          send({ type: 'team_agent_history', teamId: m.teamId, agentId: m.agentId, messages: agent.messages });
        } else {
          send({ type: 'error', message: `Agent not found: ${m.agentId}` });
        }
      }
      break;
    }
    case 'delete_team': {
      const m = msg as unknown as { teamId: string };
      const active = getActiveTeam();
      if (active && active.teamId === m.teamId) {
        send({ type: 'error', message: 'Cannot delete an active team.' });
        break;
      }
      const deleted = deleteTeam(m.teamId);
      if (deleted) {
        send({ type: 'team_deleted', teamId: m.teamId });
      } else {
        send({ type: 'error', message: 'Team not found or could not be deleted.' });
      }
      break;
    }
    case 'rename_team': {
      const m = msg as unknown as { teamId: string; newTitle: string };
      const active = getActiveTeam();
      // If renaming the active team, update in-memory state too
      if (active && active.teamId === m.teamId) {
        active.title = m.newTitle;
      }
      const renamed = renameTeam(m.teamId, m.newTitle);
      if (renamed) {
        send({ type: 'team_renamed', teamId: m.teamId, newTitle: m.newTitle });
      } else {
        send({ type: 'error', message: 'Team not found or could not be renamed.' });
      }
      break;
    }
    case 'ping':
      send({ type: 'pong', ts: (msg as unknown as { ts: number }).ts });
      break;
    default:
      console.log(`[AgentLink] Unhandled server message: ${msg.type}`);
  }
}

function handleListSessions(): void {
  try {
    const sessions = listSessions(state.workDir);
    console.log(`[AgentLink] → sessions_list (${sessions.length} sessions for ${state.workDir})`);
    send({ type: 'sessions_list', sessions, workDir: state.workDir });
  } catch (err) {
    console.error(`[AgentLink] listSessions failed:`, err);
    send({ type: 'sessions_list', sessions: [], workDir: state.workDir });
  }
}

function handleDeleteSession(sessionId: string): void {
  // Evict any idle conversation holding this session; block if busy
  if (evictByClaudeSessionId(sessionId)) {
    send({ type: 'error', message: 'Cannot delete a session while it is processing.' });
    return;
  }
  const deleted = deleteSession(state.workDir, sessionId);
  if (deleted) {
    send({ type: 'session_deleted', sessionId });
  } else {
    send({ type: 'error', message: 'Session not found or could not be deleted.' });
  }
}

function handleRenameSession(sessionId: string, newTitle: string): void {
  const renamed = renameSession(state.workDir, sessionId, newTitle);
  if (renamed) {
    send({ type: 'session_renamed', sessionId, newTitle });
  } else {
    send({ type: 'error', message: 'Session not found or could not be renamed.' });
  }
}

async function handleListDirectory(msg: { dirPath: string; source?: string }): Promise<void> {
  const dirPath = msg.dirPath || '';
  const source = msg.source;

  try {
    // Empty path: list drives (Windows) or root (Unix)
    if (!dirPath) {
      if (os.platform() === 'win32') {
        const drives: { name: string; type: string }[] = [];
        for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
          const drivePath = letter + ':\\';
          if (existsSync(drivePath)) {
            drives.push({ name: letter + ':', type: 'directory' });
          }
        }
        send({ type: 'directory_listing', dirPath: '', entries: drives, source });
        return;
      }
      // Unix: list root
      const entries = await listDirectoryEntries('/');
      send({ type: 'directory_listing', dirPath: '/', entries, source });
      return;
    }

    const resolved = isAbsolute(dirPath) ? resolve(dirPath) : resolve(state.workDir, dirPath);
    const entries = await listDirectoryEntries(resolved);
    send({ type: 'directory_listing', dirPath: resolved, entries, source });
  } catch (err) {
    const error = err as Error;
    send({ type: 'directory_listing', dirPath, entries: [], error: error.message, source });
  }
}

async function listDirectoryEntries(dirPath: string): Promise<{ name: string; type: string }[]> {
  const items = await readdir(dirPath, { withFileTypes: true });
  const entries: { name: string; type: string }[] = [];

  for (const item of items) {
    if (item.name.startsWith('.')) continue;
    if (item.name === 'node_modules') continue;
    entries.push({
      name: item.name,
      type: item.isDirectory() ? 'directory' : 'file',
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

async function handleReadFile(msg: { filePath: string }): Promise<void> {
  const filePath = msg.filePath;
  try {
    const resolved = isAbsolute(filePath) ? resolve(filePath) : resolve(state.workDir, filePath);
    const stats = await stat(resolved);
    const result = await readFileForPreview(resolved, stats.size);

    send({
      type: 'file_content',
      filePath: resolved,
      fileName: result.fileName,
      content: result.content,
      encoding: result.encoding,
      mimeType: result.mimeType,
      truncated: result.truncated,
      totalSize: stats.size,
    });
  } catch (err) {
    send({
      type: 'file_content',
      filePath,
      fileName: basename(filePath),
      content: null,
      encoding: 'utf8',
      mimeType: 'application/octet-stream',
      truncated: false,
      totalSize: 0,
      error: (err as Error).message,
    });
  }
}

function handleChangeWorkDir(msg: { workDir: string }): void {
  const newDir = msg.workDir;

  if (!existsSync(newDir)) {
    send({ type: 'error', message: `Directory does not exist: ${newDir}` });
    return;
  }

  // Only update agent-side workDir — existing conversations keep running in their own workDir
  state.workDir = newDir;
  console.log(`[AgentLink] Working directory changed to: ${newDir}`);

  // Notify web client (server intercepts to update its state)
  send({ type: 'workdir_changed', workDir: newDir });

  // Auto-refresh session list for new directory
  handleListSessions();
}
