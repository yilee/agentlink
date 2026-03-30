import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { sessions, type AgentSession, type WebClient } from './session-manager.js';
import { auth } from './auth-manager.js';
import { MessageRelay } from './message-relay.js';
import { generateSessionKey, encodeKey, parseMessage, encryptAndSend } from './encryption.js';

const require = createRequire(import.meta.url);
const serverPkg = require('../package.json');

const clientRelay = new MessageRelay();

export function handleWebConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  const authToken = url.searchParams.get('authToken');
  const clientId = randomUUID();

  if (!sessionId) {
    try { ws.send(JSON.stringify({ type: 'error', message: 'Missing sessionId' })); } catch { /* swallow */ }
    ws.close();
    return;
  }

  // Check if agent exists for this session
  const agent = sessions.getAgentBySession(sessionId);

  // Password-protected session?
  const requiresAuth = auth.requiresAuth(sessionId);

  if (requiresAuth) {
    // Check saved auth token first
    if (authToken && auth.verifyAuthToken(authToken, sessionId)) {
      const refreshedToken = auth.generateAuthToken(sessionId);
      completeConnection(ws, clientId, sessionId, agent, refreshedToken);
      return;
    }

    // Check lockout
    if (auth.isLocked(sessionId)) {
      ws.send(JSON.stringify({
        type: 'auth_locked',
        message: 'Too many failed attempts. Try again in 15 minutes.',
      }));
      ws.close();
      return;
    }

    // Require authentication
    auth.setPending(clientId, sessionId);

    try { ws.send(JSON.stringify({ type: 'auth_required', sessionId })); } catch { /* swallow */ }

    ws.on('message', (data) => {
      handlePendingAuthMessage(clientId, ws, data.toString());
    });

    ws.on('close', () => {
      auth.removePending(clientId);
    });

    ws.on('error', (err) => {
      console.error(`[Web] WebSocket error during auth for ${clientId.slice(0, 8)}:`, err.message);
    });

    return;
  }

  // No auth required — proceed directly
  completeConnection(ws, clientId, sessionId, agent);
}

function handlePendingAuthMessage(clientId: string, ws: WebSocket, raw: string): void {
  const sessionId = auth.getPending(clientId);
  if (!sessionId) return;

  let msg: { type: string; password?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  if (msg.type !== 'authenticate' || typeof msg.password !== 'string') return;

  const agent = sessions.getAgentBySession(sessionId);
  const sessionAuth = auth.getSessionAuth(sessionId);

  if (!sessionAuth?.passwordHash || !sessionAuth?.passwordSalt) {
    // Password removed while authenticating
    ws.send(JSON.stringify({ type: 'error', message: 'Session no longer available.' }));
    auth.removePending(clientId);
    ws.close();
    return;
  }

  // Check lockout (may have been triggered by another client)
  if (auth.isLocked(sessionId)) {
    ws.send(JSON.stringify({
      type: 'auth_locked',
      message: 'Too many failed attempts. Try again in 15 minutes.',
    }));
    auth.removePending(clientId);
    ws.close();
    return;
  }

  const valid = auth.verifyPassword(msg.password, sessionAuth.passwordHash, sessionAuth.passwordSalt);

  if (!valid) {
    const { locked, remaining } = auth.recordFailure(sessionId);
    if (locked) {
      ws.send(JSON.stringify({
        type: 'auth_locked',
        message: 'Too many failed attempts. Try again in 15 minutes.',
      }));
      auth.removePending(clientId);
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
  auth.clearFailures(sessionId);
  auth.removePending(clientId);

  const token = auth.generateAuthToken(sessionId);

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

  sessions.registerClient(clientId, client);

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

  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error(`[Web] Failed to send connected payload to ${clientId.slice(0, 8)}:`, (err as Error).message);
  }

  console.log(`[Web] Client ${clientId.slice(0, 8)} connected to session ${sessionId}, agent: ${agent ? agent.name : 'none'}${authToken ? ' (authenticated)' : ''}`);

  ws.on('message', (data) => {
    clientRelay.enqueue(clientId, () => handleWebMessage(clientId, data.toString()));
  });

  ws.on('close', () => {
    console.log(`[Web] Client ${clientId.slice(0, 8)} disconnected`);
    clientRelay.cleanup(clientId);
    sessions.removeClient(clientId);
  });

  ws.on('pong', () => {
    client.isAlive = true;
  });

  ws.on('error', (err) => {
    console.error(`[Web] WebSocket error for ${clientId.slice(0, 8)}:`, err.message);
  });
}

async function handleWebMessage(clientId: string, raw: string): Promise<void> {
  const client = sessions.getClient(clientId);
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
  const agent = sessions.getAgentBySession(client.sessionId);

  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    await encryptAndSend(client.ws, { type: 'error', message: 'Agent not connected' }, client.sessionKey);
    return;
  }

  // Forward web client message to agent, encrypted with agent's session key
  await encryptAndSend(agent.ws, msg, agent.sessionKey);
}
