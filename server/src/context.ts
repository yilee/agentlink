import { WebSocket } from 'ws';
import { randomBytes } from 'crypto';

export interface AgentSession {
  ws: WebSocket;
  agentId: string;
  name: string;
  hostname: string;
  workDir: string;
  version: string;
  sessionId: string;    // unique session ID for URL
  sessionKey: Uint8Array | null;  // encryption key for this agent
  connectedAt: Date;
  isAlive: boolean;
  passwordHash: string | null;
  passwordSalt: string | null;
}

export interface WebClient {
  ws: WebSocket;
  clientId: string;
  sessionId: string;    // which agent session this client belongs to
  sessionKey: Uint8Array | null;  // encryption key for this client
  connectedAt: Date;
  isAlive: boolean;
}

// Agent sessions: agentId → AgentSession
export const agents = new Map<string, AgentSession>();

// Session ID → agentId (reverse lookup)
export const sessionToAgent = new Map<string, string>();

// Web clients: clientId → WebClient
export const webClients = new Map<string, WebClient>();

// Brute-force tracking: sessionId → { failures, lockedUntil }
export interface AuthAttemptState {
  failures: number;
  lockedUntil: Date | null;
}
export const authAttempts = new Map<string, AuthAttemptState>();

// Pending auth: clientId → sessionId (web clients awaiting password verification)
export const pendingAuth = new Map<string, string>();

// Session auth: sessionId → { passwordHash, passwordSalt }
// Persists across agent disconnects so web clients can still be required to authenticate
export const sessionAuth = new Map<string, { passwordHash: string; passwordSalt: string }>();

// Server secret for HMAC auth tokens (generated fresh on each server start)
export const serverSecret = randomBytes(32);

/**
 * Generate a short, URL-safe session ID
 */
export function generateSessionId(): string {
  return randomBytes(12).toString('base64url');
}

/**
 * Clean up dead WebSocket connections detected by heartbeat.
 * Terminates dead sockets, removes them from maps, pings alive ones,
 * and notifies web clients when their agent disconnects.
 */
export function cleanupDeadConnections(
  notifyFn: (client: WebClient, msg: { type: string }) => void
): { removedAgents: string[]; removedClients: string[] } {
  const removedAgents: string[] = [];
  const removedClients: string[] = [];

  for (const [agentId, agent] of agents) {
    if (!agent.isAlive) {
      console.log(`[Heartbeat] Agent ${agent.name} timed out`);
      agent.ws.terminate();
      sessionToAgent.delete(agent.sessionId);
      agents.delete(agentId);
      removedAgents.push(agentId);

      // Notify connected web clients that agent is gone
      for (const [, client] of webClients) {
        if (client.sessionId === agent.sessionId) {
          notifyFn(client, { type: 'agent_disconnected' });
        }
      }
      continue;
    }
    agent.isAlive = false;
    agent.ws.ping();
  }

  for (const [clientId, client] of webClients) {
    if (!client.isAlive) {
      client.ws.terminate();
      webClients.delete(clientId);
      removedClients.push(clientId);
      continue;
    }
    client.isAlive = false;
    client.ws.ping();
  }

  return { removedAgents, removedClients };
}
