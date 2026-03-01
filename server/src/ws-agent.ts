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

  // Reuse requested sessionId (agent reconnecting) or generate a new one
  const requestedSessionId = url.searchParams.get('sessionId');
  const sessionId = requestedSessionId || generateSessionId();
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
    claudeSessionId: null,
    processing: false,
    messageBuffer: [],
  };

  agents.set(agentId, agent);
  sessionToAgent.set(sessionId, agentId);

  console.log(`[Agent] Registered: ${name} (${agentId}), session: ${sessionId}${requestedSessionId ? ' (reconnect)' : ''}`);

  // Send registration with session key (this initial message is plain text)
  ws.send(JSON.stringify({
    type: 'registered',
    agentId,
    sessionId,
    sessionKey: encodeKey(sessionKey),
  }));

  // Notify any web clients already connected to this session (reconnect scenario)
  for (const [, client] of webClients) {
    if (client.sessionId === sessionId && client.ws.readyState === WebSocket.OPEN) {
      encryptAndSend(client.ws, {
        type: 'agent_reconnected',
        agent: { agentId, name, hostname, workDir },
      }, client.sessionKey);
    }
  }

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
    agent.claudeSessionId = null;
    agent.processing = false;
    agent.messageBuffer = [];
    console.log(`[Agent] ${agent.name} changed workDir to: ${msg.workDir}`);
  }

  // Track current Claude session ID
  if (msg.type === 'session_started' && typeof msg.claudeSessionId === 'string') {
    agent.claudeSessionId = msg.claudeSessionId;
  }

  // Track processing state
  if (msg.type === 'turn_completed' || msg.type === 'execution_cancelled') {
    agent.processing = false;
  }
  if (msg.type === 'claude_output') {
    agent.processing = true;
  }

  // Forward to connected web clients, or buffer if none are connected
  let forwarded = false;
  for (const [, client] of webClients) {
    if (client.sessionId === agent.sessionId && client.ws.readyState === WebSocket.OPEN) {
      encryptAndSend(client.ws, msg, client.sessionKey);
      forwarded = true;
    }
  }

  if (!forwarded && agent.messageBuffer.length < 2000) {
    agent.messageBuffer.push(msg);
  }
}
