import type { AgentConfig } from './config.js';
import { connect, disconnect } from './connection.js';

export async function start(config: AgentConfig): Promise<void> {
  console.log('[AgentLink] Starting agent...');
  console.log(`[AgentLink] Working directory: ${config.dir}`);
  console.log(`[AgentLink] Relay server: ${config.server}`);
  console.log(`[AgentLink] Agent name: ${config.name}`);

  // Derive the HTTP base URL from the WebSocket URL for session URL display
  const httpBase = config.server
    .replace(/^wss:/, 'https:')
    .replace(/^ws:/, 'http:');

  try {
    const sessionId = await connect(config);
    console.log('');
    console.log(`[AgentLink] Session URL: ${httpBase}/s/${sessionId}`);
    console.log('[AgentLink] Waiting for connections...');

    // Keep process alive, handle graceful shutdown
    const shutdown = () => {
      console.log('\n[AgentLink] Shutting down...');
      disconnect();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error(`[AgentLink] Failed to connect: ${(err as Error).message}`);
    process.exit(1);
  }
}
