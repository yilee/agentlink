/**
 * Daemon entry point — spawned by `agentlink start --daemon` as a detached child process.
 * Reads config from argv (JSON-encoded), runs the agent, and writes runtime state.
 */
import type { AgentConfig } from './config.js';
import { start } from './index.js';

const configArg = process.argv[2];
if (!configArg) {
  console.error('daemon: missing config argument');
  process.exit(1);
}

let config: AgentConfig;
try {
  const parsed = JSON.parse(configArg);
  // Handle ephemeral flag passed from CLI — set env before start()
  if (parsed.ephemeral) {
    process.env.AGENTLINK_NO_STATE = '1';
    delete parsed.ephemeral;
  }
  config = parsed as AgentConfig;
} catch {
  console.error('daemon: invalid config JSON');
  process.exit(1);
}

start(config, true).catch((err) => {
  console.error(`daemon: ${(err as Error).message}`);
  process.exit(1);
});
