import { createServer } from 'http';
import { createRequire } from 'module';
import { WebSocket, WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { sessions } from './session-manager.js';
import { createApp } from './http.js';
import { handleAgentConnection } from './ws-agent.js';
import { handleWebConnection } from './ws-client.js';
import { saveServerRuntimeState, clearServerRuntimeState } from './config.js';
import { encryptAndSend } from './encryption.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const startedAt = new Date();

const PORT = parseInt(process.env.PORT || '3456', 10);

const webDir = join(__dirname, '../web/dist');
const app = createApp(webDir, pkg, startedAt);
const server = createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket routing: agent or web client
wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const type = url.searchParams.get('type');

  if (type === 'agent') {
    handleAgentConnection(ws, req);
  } else if (type === 'web') {
    handleWebConnection(ws, req);
  } else {
    ws.send(JSON.stringify({ type: 'error', message: 'Unknown type. Use ?type=agent or ?type=web' }));
    ws.close();
  }
});

// Heartbeat every 30s to detect dead connections
setInterval(() => {
  sessions.cleanupDeadConnections((client, msg) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      encryptAndSend(client.ws, msg, client.sessionKey);
    }
  });
}, 30_000);

server.listen(PORT, () => {
  console.log(`[AgentLink] Server listening on http://localhost:${PORT}`);
  console.log(`[AgentLink] Web UI: ${webDir}`);

  // Write server runtime state for CLI stop command
  saveServerRuntimeState({
    pid: process.pid,
    port: PORT,
    startedAt: new Date().toISOString(),
  });
});

// Clean up runtime state on exit
process.on('exit', clearServerRuntimeState);
process.on('SIGINT', () => { clearServerRuntimeState(); process.exit(0); });
process.on('SIGTERM', () => { clearServerRuntimeState(); process.exit(0); });
