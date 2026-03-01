import { WebSocket } from 'ws';
import { randomBytes } from 'crypto';

export interface AgentSession {
  ws: WebSocket;
  agentId: string;
  name: string;
  hostname: string;
  workDir: string;
  sessionId: string;    // unique session ID for URL
  sessionKey: Uint8Array | null;  // encryption key for this agent
  connectedAt: Date;
  isAlive: boolean;
  claudeSessionId: string | null;  // current Claude Code session ID
  processing: boolean;             // whether a turn is in progress
  messageBuffer: Record<string, unknown>[];  // messages buffered while no web client connected
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

/**
 * Generate a short, URL-safe session ID
 */
export function generateSessionId(): string {
  return randomBytes(12).toString('base64url');
}
