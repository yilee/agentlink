import { WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { randomUUID } from 'crypto';
import {
  agents,
  sessionToAgent,
  webClients,
  type WebClient,
} from './context.js';
import { generateSessionKey, encodeKey, parseMessage, encryptAndSend } from './encryption.js';

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

  // Send connection result with agent info and session key (plain text — key exchange)
  ws.send(JSON.stringify({
    type: 'connected',
    clientId,
    sessionKey: encodeKey(sessionKey),
    agent: agent ? {
      agentId: agent.agentId,
      name: agent.name,
      hostname: agent.hostname,
      workDir: agent.workDir,
      claudeSessionId: agent.claudeSessionId,
      processing: agent.processing,
    } : null,
  }));

  console.log(`[Web] Client ${clientId.slice(0, 8)} connected to session ${sessionId}, agent: ${agent ? agent.name : 'none'}`);

  // Flush buffered messages that arrived while no web client was connected
  // Send as a single batch to avoid per-message encryption overhead on the client
  if (agent && agent.messageBuffer.length > 0) {
    console.log(`[Web] Flushing ${agent.messageBuffer.length} buffered messages to ${clientId.slice(0, 8)}`);
    encryptAndSend(client.ws, {
      type: 'buffered_messages',
      messages: agent.messageBuffer,
    }, client.sessionKey);
    agent.messageBuffer = [];
  }
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
    console.error(`[Web] Failed to parse/decrypt message from ${clientId.slice(0, 8)}`);
    return;
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
