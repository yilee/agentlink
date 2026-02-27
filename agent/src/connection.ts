import WebSocket from 'ws';
import type { AgentConfig } from './config.js';

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30_000;
const MAX_RECONNECT_ATTEMPTS = 20;

interface ConnectionState {
  ws: WebSocket | null;
  sessionId: string | null;
  reconnectAttempts: number;
  shouldReconnect: boolean;
}

const state: ConnectionState = {
  ws: null,
  sessionId: null,
  reconnectAttempts: 0,
  shouldReconnect: true,
};

export function connect(config: AgentConfig): Promise<string> {
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
      handleChat(msg as { type: string; prompt: string });
      break;
    default:
      console.log(`[AgentLink] Unhandled server message: ${msg.type}`);
  }
}

function handleChat(msg: { prompt: string }): void {
  console.log(`[AgentLink] Chat: ${msg.prompt}`);

  // Placeholder: echo reply. Will be replaced by Claude SDK integration.
  send({
    type: 'claude_output',
    data: {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: `Echo: ${msg.prompt}` },
        ],
      },
    },
  });

  send({ type: 'turn_completed' });
}
