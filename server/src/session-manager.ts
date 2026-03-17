import { WebSocket } from 'ws';
import { randomBytes } from 'crypto';

export interface AgentSession {
  ws: WebSocket;
  agentId: string;
  name: string;
  hostname: string;
  workDir: string;
  version: string;
  sessionId: string;
  sessionKey: Uint8Array | null;
  connectedAt: Date;
  isAlive: boolean;
  passwordHash: string | null;
  passwordSalt: string | null;
  entra: boolean;
}

export interface WebClient {
  ws: WebSocket;
  clientId: string;
  sessionId: string;
  sessionKey: Uint8Array | null;
  connectedAt: Date;
  isAlive: boolean;
}

export class SessionManager {
  readonly agents = new Map<string, AgentSession>();
  readonly sessionToAgent = new Map<string, string>();
  readonly webClients = new Map<string, WebClient>();

  generateSessionId(): string {
    return randomBytes(12).toString('base64url');
  }

  // --- Agent operations ---

  registerAgent(agentId: string, agent: AgentSession): void {
    this.agents.set(agentId, agent);
    this.sessionToAgent.set(agent.sessionId, agentId);
  }

  removeAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.sessionToAgent.delete(agent.sessionId);
      this.agents.delete(agentId);
    }
  }

  getAgent(agentId: string): AgentSession | undefined {
    return this.agents.get(agentId);
  }

  getAgentBySession(sessionId: string): AgentSession | undefined {
    const agentId = this.sessionToAgent.get(sessionId);
    return agentId ? this.agents.get(agentId) : undefined;
  }

  // --- Client operations ---

  registerClient(clientId: string, client: WebClient): void {
    this.webClients.set(clientId, client);
  }

  removeClient(clientId: string): void {
    this.webClients.delete(clientId);
  }

  getClient(clientId: string): WebClient | undefined {
    return this.webClients.get(clientId);
  }

  getClientsForSession(sessionId: string): WebClient[] {
    const result: WebClient[] = [];
    for (const [, client] of this.webClients) {
      if (client.sessionId === sessionId) {
        result.push(client);
      }
    }
    return result;
  }

  // --- Heartbeat ---

  cleanupDeadConnections(
    notifyFn: (client: WebClient, msg: { type: string }) => void
  ): { removedAgents: string[]; removedClients: string[] } {
    const removedAgents: string[] = [];
    const removedClients: string[] = [];

    for (const [agentId, agent] of this.agents) {
      if (!agent.isAlive) {
        console.log(`[Heartbeat] Agent ${agent.name} timed out`);
        agent.ws.terminate();
        this.sessionToAgent.delete(agent.sessionId);
        this.agents.delete(agentId);
        removedAgents.push(agentId);

        for (const [, client] of this.webClients) {
          if (client.sessionId === agent.sessionId) {
            notifyFn(client, { type: 'agent_disconnected' });
          }
        }
        continue;
      }
      agent.isAlive = false;
      agent.ws.ping();
    }

    for (const [clientId, client] of this.webClients) {
      if (!client.isAlive) {
        client.ws.terminate();
        this.webClients.delete(clientId);
        removedClients.push(clientId);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }

    return { removedAgents, removedClients };
  }
}

// Singleton instance for backward compatibility
export const sessions = new SessionManager();
