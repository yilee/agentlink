import { createRequire } from 'module';
import type { AgentConfig } from './config.js';
import { saveRuntimeState, clearRuntimeState, writePidFile } from './config.js';
import { connect, disconnect } from './connection.js';
import { startAutoUpdate, stopAutoUpdate } from './auto-update.js';
import { shutdownScheduler } from './scheduler.js';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-terminal');

/** Highlight a URL with bold + underline ANSI codes if stdout supports color. */
function highlightUrl(url: string): string {
  if (!process.stdout.isTTY) return url;
  return `\x1b[1;4;36m${url}\x1b[0m`;
}

export async function start(config: AgentConfig, daemon = false, pidFile?: string): Promise<void> {
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
    const sessionUrl = `${httpBase}/${config.entra ? 'ms' : 's'}/${sessionId}`;

    // Persist runtime state so `agentlink status` can read it
    saveRuntimeState({
      pid: process.pid,
      sessionId,
      sessionUrl,
      server: config.server,
      name: config.name,
      dir: config.dir,
      startedAt: new Date().toISOString(),
    });

    console.log('');
    console.log(`[AgentLink] Session URL: ${highlightUrl(sessionUrl)}`);
    qrcode.generate(sessionUrl, { small: true }, (code: string) => {
      console.log(code);
    });
    if (config.entra) {
      console.log('\x1b[33m  Tip: Use your phone\'s native camera to scan. WeChat scanner will not work.\x1b[0m');
    }
    console.log('[AgentLink] Waiting for connections...');

    // Write PID file for test harness (foreground mode)
    if (pidFile) {
      writePidFile(pidFile, { pid: process.pid, sessionUrl, password: config.password });
    }

    // Start auto-update checker (opt-in, disabled by default)
    if (config.autoUpdate === true) {
      startAutoUpdate(daemon);
    }

    // Keep process alive, handle graceful shutdown
    const shutdown = () => {
      console.log('\n[AgentLink] Shutting down...');
      shutdownScheduler();
      stopAutoUpdate();
      clearRuntimeState();
      disconnect();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`\n[AgentLink] Failed to connect to server: ${config.server}`);

    if (msg.includes('ECONNREFUSED')) {
      console.error('[AgentLink] Connection refused. Is the server running?');
      console.error('[AgentLink] Check with: agentlink-server status');
    } else if (msg.includes('ENOTFOUND') || msg.includes('EAI_AGAIN')) {
      console.error('[AgentLink] Server address not found. Check the URL is correct.');
      console.error(`[AgentLink] Current server: ${config.server}`);
      console.error('[AgentLink] Update with: agentlink-client config set server <url>');
    } else if (msg.includes('ETIMEDOUT') || msg.includes('ENETUNREACH')) {
      console.error('[AgentLink] Network timeout. Check your internet connection and firewall.');
    } else if (msg.includes('ECONNRESET') || msg.includes('socket hang up')) {
      console.error('[AgentLink] Connection was reset by the server.');
    } else {
      console.error(`[AgentLink] Error: ${msg}`);
    }

    process.exit(1);
  }
}
