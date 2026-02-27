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

export function handleAgentConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const agentId = url.searchParams.get('id') || randomUUID();
  const name = url.searchParams.get('name') || `Agent-${agentId.slice(0, 8)}`;
  const workDir = url.searchParams.get('workDir') || 'unknown';

  const sessionId = generateSessionId();

  const agent: AgentSession = {
    ws,
    agentId,
    name,
    workDir,
    sessionId,
    connectedAt: new Date(),
    isAlive: true,
  };

  agents.set(agentId, agent);
  sessionToAgent.set(sessionId, agentId);

  console.log(`[Agent] Registered: ${name} (${agentId}), session: ${sessionId}`);

  // Send registration confirmation with session info
  ws.send(JSON.stringify({
    type: 'registered',
    agentId,
    sessionId,
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
        client.ws.send(JSON.stringify({ type: 'agent_disconnected' }));
      }
    }
  });

  ws.on('pong', () => {
    agent.isAlive = true;
  });
}

function handleAgentMessage(agentId: string, raw: string): void {
  let msg: { type: string; [key: string]: unknown };
  try {
    msg = JSON.parse(raw);
  } catch {
    console.error(`[Agent] Invalid JSON from ${agentId}`);
    return;
  }

  const agent = agents.get(agentId);
  if (!agent) return;

  // Forward agent messages to all web clients connected to this session
  for (const [, client] of webClients) {
    if (client.sessionId === agent.sessionId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  }
}
