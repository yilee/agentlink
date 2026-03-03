import WebSocket from 'ws';
import os from 'os';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { resolve, isAbsolute, join } from 'path';
import { createRequire } from 'module';
import type { AgentConfig } from './config.js';
import { loadRuntimeState, saveRuntimeState } from './config.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
import { handleChat as claudeHandleChat, setSendFn, abort as abortClaude, cancelExecution as claudeCancelExecution, handleUserAnswer, getConversation, getIsCompacting, clearSessionId, type ChatFile } from './claude.js';
import { listSessions, readSessionMessages, deleteSession } from './history.js';
import { decodeKey, parseMessage, encryptAndSend } from './encryption.js';

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
  console.log(`[AgentLink] Connecting to ${config.server}...`);

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
      } else if (previousSessionId && previousSessionId !== newSessionId) {
        // Session ID changed on reconnect — update runtime state so status/URL stay correct
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
  abortClaude();
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
}

export function send(msg: Record<string, unknown>): void {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    encryptAndSend(state.ws, msg, state.sessionKey);
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
    case 'chat':
      claudeHandleChat(
        (msg as unknown as { prompt: string }).prompt,
        state.workDir,
        (msg as unknown as { resumeSessionId?: string }).resumeSessionId,
        (msg as unknown as { files?: ChatFile[] }).files,
      );
      break;
    case 'cancel_execution':
      claudeCancelExecution();
      break;
    case 'list_sessions':
      handleListSessions();
      break;
    case 'list_directory':
      handleListDirectory(msg as unknown as { dirPath: string });
      break;
    case 'change_workdir':
      handleChangeWorkDir(msg as unknown as { workDir: string });
      break;
    case 'resume_conversation': {
      const m = msg as unknown as { claudeSessionId: string };
      const conv = getConversation();
      // Only kill Claude if switching to a different session
      if (!conv || conv.claudeSessionId !== m.claudeSessionId) {
        abortClaude();
      }
      const history = readSessionMessages(state.workDir, m.claudeSessionId);
      console.log(`[AgentLink] → conversation_resumed (${history.length} messages, session ${m.claudeSessionId.slice(0, 8)})`);
      // Include live status so the web client can restore compacting/processing state
      const currentConv = getConversation();
      const isSameSession = currentConv?.claudeSessionId === m.claudeSessionId;
      send({
        type: 'conversation_resumed',
        claudeSessionId: m.claudeSessionId,
        history,
        isCompacting: isSameSession && getIsCompacting(),
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
  const conv = getConversation();
  if (conv && conv.claudeSessionId === sessionId) {
    send({ type: 'error', message: 'Cannot delete the active session.' });
    return;
  }
  const deleted = deleteSession(state.workDir, sessionId);
  if (deleted) {
    send({ type: 'session_deleted', sessionId });
  } else {
    send({ type: 'error', message: 'Session not found or could not be deleted.' });
  }
}

async function handleListDirectory(msg: { dirPath: string }): Promise<void> {
  const dirPath = msg.dirPath || '';

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
        send({ type: 'directory_listing', dirPath: '', entries: drives });
        return;
      }
      // Unix: list root
      const entries = await listDirectoryEntries('/');
      send({ type: 'directory_listing', dirPath: '/', entries });
      return;
    }

    const resolved = isAbsolute(dirPath) ? resolve(dirPath) : resolve(state.workDir, dirPath);
    const entries = await listDirectoryEntries(resolved);
    send({ type: 'directory_listing', dirPath: resolved, entries });
  } catch (err) {
    const error = err as Error;
    send({ type: 'directory_listing', dirPath, entries: [], error: error.message });
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

function handleChangeWorkDir(msg: { workDir: string }): void {
  const newDir = msg.workDir;

  if (!existsSync(newDir)) {
    send({ type: 'error', message: `Directory does not exist: ${newDir}` });
    return;
  }

  // Kill any existing Claude process and clear session
  abortClaude();
  clearSessionId();

  // Update agent-side workDir
  state.workDir = newDir;
  console.log(`[AgentLink] Working directory changed to: ${newDir}`);

  // Notify web client (server intercepts to update its state)
  send({ type: 'workdir_changed', workDir: newDir });

  // Auto-refresh session list for new directory
  handleListSessions();
}
