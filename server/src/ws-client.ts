import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import {
  agents,
  sessionToAgent,
  webClients,
  type WebClient,
} from './context.js';

export function handleWebConnection(ws: WebSocket, req: IncomingMessage): void {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('sessionId');
  const clientId = randomUUID();

  if (!sessionId) {
    ws.send(JSON.stringify({ type: 'error', message: 'Missing sessionId' }));
    ws.close();
    return;
  }

  // Check if agent exists for this session
  const agentId = sessionToAgent.get(sessionId);
  const agent = agentId ? agents.get(agentId) : undefined;

  const client: WebClient = {
    ws,
    clientId,
    sessionId,
    connectedAt: new Date(),
    isAlive: true,
  };

  webClients.set(clientId, client);

  // Send connection result with agent info
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    agent: agent ? {
      agentId: agent.agentId,
      name: agent.name,
      hostname: agent.hostname,
      workDir: agent.workDir,
    } : null,
  }));

  console.log(`[Web] Client ${clientId.slice(0, 8)} connected to session ${sessionId}, agent: ${agent ? agent.name : 'none'}`);

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

function handleWebMessage(clientId: string, raw: string): void {
  let msg: { type: string; [key: string]: unknown };
  try {
    msg = JSON.parse(raw);
  } catch {
    console.error(`[Web] Invalid JSON from ${clientId.slice(0, 8)}`);
    return;
  }

  const client = webClients.get(clientId);
  if (!client) return;

  // Find the agent for this session and forward
  const agentId = sessionToAgent.get(client.sessionId);
  const agent = agentId ? agents.get(agentId) : undefined;

  if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
    client.ws.send(JSON.stringify({ type: 'error', message: 'Agent not connected' }));
    return;
  }

  // Forward web client message to agent
  agent.ws.send(raw);
}
