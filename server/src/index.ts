import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { agents, webClients } from './context.js';
import { handleAgentConnection } from './ws-agent.js';
import { handleWebConnection } from './ws-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTLINK_DIR = join(homedir(), '.agentlink');
const SERVER_RUNTIME_FILE = join(AGENTLINK_DIR, 'server.json');

const PORT = parseInt(process.env.PORT || '3456', 10);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const webDir = join(__dirname, '../../web');

// Serve static assets from web/
app.use(express.static(webDir));

// SPA fallback: /s/:sessionId → serve index.html (Vue router handles the rest)
app.get('/s/:sessionId', (_req, res) => {
  res.sendFile(join(webDir, 'index.html'));
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    agents: agents.size,
    webClients: webClients.size,
    timestamp: new Date().toISOString(),
  });
});

// Session info API (web client fetches this to know agent details)
app.get('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  for (const [, agent] of agents) {
    if (agent.sessionId === sessionId) {
      res.json({
        sessionId,
        agent: {
          name: agent.name,
          workDir: agent.workDir,
          connectedAt: agent.connectedAt,
        },
      });
      return;
    }
  }
  res.status(404).json({ error: 'Session not found' });
});

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
  for (const [agentId, agent] of agents) {
    if (!agent.isAlive) {
      console.log(`[Heartbeat] Agent ${agent.name} timed out`);
      agent.ws.terminate();
      return;
    }
    agent.isAlive = false;
    agent.ws.ping();
  }

  for (const [clientId, client] of webClients) {
    if (!client.isAlive) {
      client.ws.terminate();
      webClients.delete(clientId);
      return;
    }
    client.isAlive = false;
    client.ws.ping();
  }
}, 30_000);

server.listen(PORT, () => {
  console.log(`[AgentLink] Server listening on http://localhost:${PORT}`);
  console.log(`[AgentLink] Web UI: ${webDir}`);

  // Write server runtime state for CLI stop command
  if (!existsSync(AGENTLINK_DIR)) {
    mkdirSync(AGENTLINK_DIR, { recursive: true });
  }
  writeFileSync(SERVER_RUNTIME_FILE, JSON.stringify({
    pid: process.pid,
    port: PORT,
    startedAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf-8');
});

// Clean up runtime state on exit
function cleanupServerState(): void {
  try { unlinkSync(SERVER_RUNTIME_FILE); } catch {}
}
process.on('exit', cleanupServerState);
process.on('SIGINT', () => { cleanupServerState(); process.exit(0); });
process.on('SIGTERM', () => { cleanupServerState(); process.exit(0); });
