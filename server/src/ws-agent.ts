import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import { sessions, type AgentSession } from './session-manager.js';
import { auth } from './auth-manager.js';
import { MessageRelay } from './message-relay.js';
import { generateSessionKey, encodeKey, parseMessage, encryptAndSend } from './encryption.js';

const agentRelay = new MessageRelay();

export function handleAgentConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const agentId = url.searchParams.get('id') || randomUUID();
  const name = url.searchParams.get('name') || `Agent-${agentId.slice(0, 8)}`;
  const workDir = url.searchParams.get('workDir') || 'unknown';
  const hostname = url.searchParams.get('hostname') || '';
  const version = url.searchParams.get('version') || '';
  const password = url.searchParams.get('password') || '';

  // Hash password if provided (agent sends plaintext over WSS)
  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (password) {
    const h = auth.hashPassword(password);
    passwordHash = h.hash;
    passwordSalt = h.salt;
  }

  // Reuse requested sessionId (agent reconnecting) or generate a new one
  const requestedSessionId = url.searchParams.get('sessionId');
  const sessionId = requestedSessionId || sessions.generateSessionId();
  if (!requestedSessionId) {
    console.log(`[Agent] No sessionId in query params for ${name} — generated new: ${sessionId}`);
  }
  const sessionKey = generateSessionKey();

  const agent: AgentSession = {
    ws,
    agentId,
    name,
    hostname,
    workDir,
    version,
    sessionId,
    sessionKey,
    connectedAt: new Date(),
    isAlive: true,
    passwordHash,
    passwordSalt,
  };

  sessions.registerAgent(agentId, agent);

  // Persist password auth per session so it survives agent disconnects
  if (passwordHash && passwordSalt) {
    auth.setSessionPassword(sessionId, passwordHash, passwordSalt);
  }

  console.log(`[Agent] Registered: ${name} (${agentId}), session: ${sessionId}${requestedSessionId ? ' (reconnect)' : ''}${passwordHash ? ' (password protected)' : ''}`);

  // Send registration with session key (this initial message is plain text)
  ws.send(JSON.stringify({
    type: 'registered',
    agentId,
    sessionId,
    sessionKey: encodeKey(sessionKey),
  }));

  // Notify any web clients already connected to this session (reconnect scenario)
  for (const client of sessions.getClientsForSession(sessionId)) {
    if (client.ws.readyState === WebSocket.OPEN) {
      encryptAndSend(client.ws, {
        type: 'agent_reconnected',
        agent: { agentId, name, hostname, workDir, version },
      }, client.sessionKey);
    }
  }

  ws.on('message', (data) => {
    agentRelay.enqueue(agentId, () => handleAgentMessage(agentId, data.toString()));
  });

  ws.on('close', () => {
    console.log(`[Agent] Disconnected: ${name} (${agentId})`);
    agentRelay.cleanup(agentId);

    // Only clean up if this WebSocket is still the current one for this agent.
    // On reconnect, the new connection overwrites the agents Map entry before
    // the old connection's close event fires — deleting would remove the new entry.
    const current = sessions.getAgent(agentId);
    if (current && current.ws === ws) {
      sessions.removeAgent(agentId);

      // Notify connected web clients that agent is gone
      for (const client of sessions.getClientsForSession(sessionId)) {
        if (client.ws.readyState === WebSocket.OPEN) {
          encryptAndSend(client.ws, { type: 'agent_disconnected' }, client.sessionKey);
        }
      }
    }
  });

  ws.on('pong', () => {
    agent.isAlive = true;
  });
}

async function handleAgentMessage(agentId: string, raw: string): Promise<void> {
  const agent = sessions.getAgent(agentId);
  if (!agent) return;

  const msg = await parseMessage(raw, agent.sessionKey);
  if (!msg) {
    console.error(`[Agent] Failed to parse/decrypt message from ${agentId} (key=${agent.sessionKey ? 'set' : 'null'})`);
    return;
  }

  // Log non-streaming messages for debugging
  if (msg.type !== 'claude_output' && msg.type !== 'pong') {
    console.log(`[Agent] ${agent.name} → ${msg.type}`);
  }

  // Intercept workdir_changed to keep server state in sync
  if (msg.type === 'workdir_changed' && typeof msg.workDir === 'string') {
    agent.workDir = msg.workDir;
    console.log(`[Agent] ${agent.name} changed workDir to: ${msg.workDir}`);
  }

  // Forward agent messages to all web clients connected to this session
  let relayCount = 0;
  for (const client of sessions.getClientsForSession(agent.sessionId)) {
    if (client.ws.readyState === WebSocket.OPEN) {
      await encryptAndSend(client.ws, msg, client.sessionKey);
      relayCount++;
    }
  }
  if (relayCount === 0 && msg.type !== 'claude_output' && msg.type !== 'pong') {
    console.warn(`[Agent] No web clients to relay ${msg.type} for session ${agent.sessionId}`);
  }
}
