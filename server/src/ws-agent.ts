import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import {
  agents,
  sessionToAgent,
  webClients,
  generateSessionId,
  type AgentSession,
} from './context.js';
import { generateSessionKey, encodeKey, parseMessage, encryptAndSend } from './encryption.js';

export function handleAgentConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const agentId = url.searchParams.get('id') || randomUUID();
  const name = url.searchParams.get('name') || `Agent-${agentId.slice(0, 8)}`;
  const workDir = url.searchParams.get('workDir') || 'unknown';
  const hostname = url.searchParams.get('hostname') || '';

  const sessionId = generateSessionId();
  const sessionKey = generateSessionKey();

  const agent: AgentSession = {
    ws,
    agentId,
    name,
    hostname,
    workDir,
    sessionId,
    sessionKey,
    connectedAt: new Date(),
    isAlive: true,
  };

  agents.set(agentId, agent);
  sessionToAgent.set(sessionId, agentId);

  console.log(`[Agent] Registered: ${name} (${agentId}), session: ${sessionId}`);

  // Send registration with session key (this initial message is plain text)
  ws.send(JSON.stringify({
    type: 'registered',
    agentId,
    sessionId,
    sessionKey: encodeKey(sessionKey),
  }));

  ws.on('message', (data) => {
    handleAgentMessage(agentId, data.toString());
  });

  ws.on('close', () => {
    console.log(`[Agent] Disconnected: ${name} (${agentId})`);
    sessionToAgent.delete(sessionId);
    agents.delete(agentId);

    // Notify connected web clients that agent is gone
    for (const [, client] of webClients) {
      if (client.sessionId === sessionId && client.ws.readyState === WebSocket.OPEN) {
        encryptAndSend(client.ws, { type: 'agent_disconnected' }, client.sessionKey);
      }
    }
  });

  ws.on('pong', () => {
    agent.isAlive = true;
  });
}

async function handleAgentMessage(agentId: string, raw: string): Promise<void> {
  const agent = agents.get(agentId);
  if (!agent) return;

  const msg = await parseMessage(raw, agent.sessionKey);
  if (!msg) {
    console.error(`[Agent] Failed to parse/decrypt message from ${agentId}`);
    return;
  }

  // Intercept workdir_changed to keep server state in sync
  if (msg.type === 'workdir_changed' && typeof msg.workDir === 'string') {
    agent.workDir = msg.workDir;
    console.log(`[Agent] ${agent.name} changed workDir to: ${msg.workDir}`);
  }

  // Forward agent messages to all web clients connected to this session
  // Re-encrypt with each client's own session key
  for (const [, client] of webClients) {
    if (client.sessionId === agent.sessionId && client.ws.readyState === WebSocket.OPEN) {
      encryptAndSend(client.ws, msg, client.sessionKey);
    }
  }
}
