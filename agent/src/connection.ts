import WebSocket from 'ws';
import os from 'os';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { resolve, isAbsolute, join } from 'path';
import type { AgentConfig } from './config.js';
import { handleChat as claudeHandleChat, setSendFn, abort as abortClaude, cancelExecution as claudeCancelExecution, handleUserAnswer, type ChatFile } from './claude.js';
import { listSessions, readSessionMessages } from './history.js';

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;

interface ConnectionState {
  ws: WebSocket | null;
  sessionId: string | null;
  reconnectAttempts: number;
  shouldReconnect: boolean;
  workDir: string;
}

const state: ConnectionState = {
  ws: null,
  sessionId: null,
  reconnectAttempts: 0,
  shouldReconnect: true,
  workDir: process.cwd(),
};

export function connect(config: AgentConfig): Promise<string> {
  state.workDir = config.dir;

  // Wire up the Claude module to send messages through our WebSocket
  setSendFn(send);

  return new Promise((resolve, reject) => {
    const wsUrl = buildWsUrl(config);
    console.log(`[AgentLink] Connecting to ${config.server}...`);

    const ws = new WebSocket(wsUrl);
    state.ws = ws;

    ws.on('open', () => {
      state.reconnectAttempts = 0;
      console.log('[AgentLink] Connected to server');
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'registered') {
        state.sessionId = msg.sessionId;
        resolve(msg.sessionId);
      } else {
        handleServerMessage(msg);
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
      // 'close' event will fire after this, triggering reconnect
      if (!state.sessionId) {
        reject(err);
      }
    });
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
    state.ws.send(JSON.stringify(msg));
  }
}

function buildWsUrl(config: AgentConfig): string {
  const base = config.server.replace(/\/$/, '');
  const params = new URLSearchParams({
    type: 'agent',
    id: config.name,
    name: config.name,
    workDir: config.dir,
    hostname: os.hostname(),
  });
  return `${base}/?${params}`;
}

function scheduleReconnect(config: AgentConfig): void {
  if (state.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error('[AgentLink] Max reconnect attempts reached. Giving up.');
    process.exit(1);
  }

  const delay = Math.min(
    RECONNECT_BASE_DELAY * Math.pow(2, state.reconnectAttempts),
    RECONNECT_MAX_DELAY
  );
  state.reconnectAttempts++;

  console.log(`[AgentLink] Reconnecting in ${delay / 1000}s (attempt ${state.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

  setTimeout(async () => {
    try {
      await connect(config);
      console.log('[AgentLink] Reconnected successfully');
    } catch {
      // close handler will trigger another reconnect
    }
  }, delay);
}

function handleServerMessage(msg: { type: string; [key: string]: unknown }): void {
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
      // Kill existing Claude process and start fresh with resume
      abortClaude();
      const m = msg as unknown as { claudeSessionId: string };
      const history = readSessionMessages(state.workDir, m.claudeSessionId);
      send({ type: 'conversation_resumed', claudeSessionId: m.claudeSessionId, history });
      break;
    }
    case 'ask_user_answer': {
      const m = msg as unknown as { requestId: string; answers: Record<string, unknown> };
      handleUserAnswer(m.requestId, m.answers);
      break;
    }
    default:
      console.log(`[AgentLink] Unhandled server message: ${msg.type}`);
  }
}

function handleListSessions(): void {
  const sessions = listSessions(state.workDir);
  send({ type: 'sessions_list', sessions, workDir: state.workDir });
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

  // Kill any existing Claude process
  abortClaude();

  // Update agent-side workDir
  state.workDir = newDir;
  console.log(`[AgentLink] Working directory changed to: ${newDir}`);

  // Notify web client (server intercepts to update its state)
  send({ type: 'workdir_changed', workDir: newDir });

  // Auto-refresh session list for new directory
  handleListSessions();
}
