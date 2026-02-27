import type { AgentConfig } from './config.js';

export async function start(config: AgentConfig): Promise<void> {
  console.log('[AgentLink] Starting agent...');
  console.log(`[AgentLink] Working directory: ${config.dir}`);
  console.log(`[AgentLink] Relay server: ${config.server}`);
  console.log(`[AgentLink] Agent name: ${config.name}`);
  console.log('[AgentLink] Agent started (skeleton - no connection yet)');
}
