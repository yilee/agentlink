import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import {
  agents,
  sessionToAgent,
  webClients,
  pendingAuth,
  sessionAuth,
  type AgentSession,
  type WebClient,
} from './context.js';
import { generateSessionKey, encodeKey, parseMessage, encryptAndSend } from './encryption.js';
import {
  isSessionLocked,
  recordFailure,
  clearFailures,
  verifyPassword,
  generateAuthToken,
  verifyAuthToken,
} from './auth.js';

const require = createRequire(import.meta.url);
const serverPkg = require('../package.json');

export function handleWebConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  const authToken = url.searchParams.get('authToken');
  const clientId = randomUUID();

  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing sessionId' }));
    ws.close();
    return;
  }

  // Check if agent exists for this session
  const agentId = sessionToAgent.get(sessionId);
  const agent = agentId ? agents.get(agentId) : undefined;

  // Password-protected session? Check persistent sessionAuth (survives agent disconnects)
  const auth = sessionAuth.get(sessionId);
  const requiresAuth = !!(auth?.passwordHash && auth?.passwordSalt);

  if (requiresAuth) {
    // Check saved auth token first
    if (authToken && verifyAuthToken(authToken, sessionId)) {
      // Refresh the token so it doesn't expire during long sessions
      const refreshedToken = generateAuthToken(sessionId);
      completeConnection(ws, clientId, sessionId, agent, refreshedToken);
      return;
    }

    // Check lockout
    if (isSessionLocked(sessionId)) {
      ws.send(JSON.stringify({
        type: 'auth_locked',
        message: 'Too many failed attempts. Try again in 15 minutes.',
      }));
      ws.close();
      return;
    }

    // Require authentication
    pendingAuth.set(clientId, sessionId);

    ws.send(JSON.stringify({ type: 'auth_required', sessionId }));

    ws.on('message', (data) => {
      handlePendingAuthMessage(clientId, ws, data.toString());
    });

    ws.on('close', () => {
      pendingAuth.delete(clientId);
    });

    return;
  }

  // No auth required — proceed directly
  completeConnection(ws, clientId, sessionId, agent);
}

function handlePendingAuthMessage(clientId: string, ws: WebSocket, raw: string): void {
  const sessionId = pendingAuth.get(clientId);
  if (!sessionId) return;

  let msg: { type: string; password?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type !== 'authenticate' || typeof msg.password !== 'string') return;

  const agentId = sessionToAgent.get(sessionId);
  const agent = agentId ? agents.get(agentId) : undefined;
  const auth = sessionAuth.get(sessionId);

  if (!auth?.passwordHash || !auth?.passwordSalt) {
    // Password removed while authenticating
    ws.send(JSON.stringify({ type: 'error', message: 'Session no longer available.' }));
    pendingAuth.delete(clientId);
    ws.close();
    return;
  }

  // Check lockout (may have been triggered by another client)
  if (isSessionLocked(sessionId)) {
    ws.send(JSON.stringify({
      type: 'auth_locked',
      message: 'Too many failed attempts. Try again in 15 minutes.',
    }));
    pendingAuth.delete(clientId);
    ws.close();
    return;
  }

  const valid = verifyPassword(msg.password, auth.passwordHash, auth.passwordSalt);

  if (!valid) {
    const { locked, remaining } = recordFailure(sessionId);
    if (locked) {
      ws.send(JSON.stringify({
        type: 'auth_locked',
        message: 'Too many failed attempts. Try again in 15 minutes.',
      }));
      pendingAuth.delete(clientId);
      ws.close();
    } else {
      ws.send(JSON.stringify({
        type: 'auth_failed',
        message: 'Incorrect password.',
        attemptsRemaining: remaining,
      }));
    }
    return;
  }

  // Success
  clearFailures(sessionId);
  pendingAuth.delete(clientId);

  const token = generateAuthToken(sessionId);

  // Replace pending auth message handler with normal encrypted handler
  ws.removeAllListeners('message');
  ws.removeAllListeners('close');

  completeConnection(ws, clientId, sessionId, agent, token);
}

function completeConnection(
  ws: WebSocket,
  clientId: string,
  sessionId: string,
  agent: AgentSession | undefined,
  authToken?: string,
): void {
  const sessionKey = generateSessionKey();

  const client: WebClient = {
    ws,
    clientId,
    sessionId,
    sessionKey,
    connectedAt: new Date(),
    isAlive: true,
  };

  webClients.set(clientId, client);

  // Build connected payload
  const payload: Record<string, unknown> = {
    type: 'connected',
    clientId,
    sessionKey: encodeKey(sessionKey),
    serverVersion: serverPkg.version,
    agent: agent ? {
      agentId: agent.agentId,
      name: agent.name,
      hostname: agent.hostname,
      workDir: agent.workDir,
      version: agent.version,
    } : null,
  };
  if (authToken) {
    payload.authToken = authToken;
  }

  ws.send(JSON.stringify(payload));

  console.log(`[Web] Client ${clientId.slice(0, 8)} connected to session ${sessionId}, agent: ${agent ? agent.name : 'none'}${authToken ? ' (authenticated)' : ''}`);

  ws.on('message', (data) => {
    handleWebMessage(clientId, data.toString());
  });

  ws.on('close', () => {
    console.log(`[Web] Client ${clientId.slice(0, 8)} disconnected`);
    webClients.delete(clientId);
  });

  ws.on('pong', () => {
    client.isAlive = true;
  });
}

async function handleWebMessage(clientId: string, raw: string): Promise<void> {
  const client = webClients.get(clientId);
  if (!client) return;

  const msg = await parseMessage(raw, client.sessionKey);
  if (!msg) {
    console.error(`[Web] Failed to parse/decrypt message from ${clientId.slice(0, 8)} (key=${client.sessionKey ? 'set' : 'null'})`);
    return;
  }

  if (msg.type !== 'ping') {
    console.log(`[Web] ${clientId.slice(0, 8)} → ${msg.type}`);
  }

  // Find the agent for this session and forward
  const agentId = sessionToAgent.get(client.sessionId);
  const agent = agentId ? agents.get(agentId) : undefined;

  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    encryptAndSend(client.ws, { type: 'error', message: 'Agent not connected' }, client.sessionKey);
    return;
  }

  // Forward web client message to agent, encrypted with agent's session key
  encryptAndSend(agent.ws, msg, agent.sessionKey);
}
