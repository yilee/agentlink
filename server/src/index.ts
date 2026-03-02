import express from 'express';
import { createServer } from 'http';
import { createRequire } from 'module';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { agents, webClients } from './context.js';
import { handleAgentConnection } from './ws-agent.js';
import { handleWebConnection } from './ws-client.js';
import { saveServerRuntimeState, clearServerRuntimeState } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const startedAt = new Date();

const PORT = parseInt(process.env.PORT || '3456', 10);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const webDir = join(__dirname, '../web');

// Landing page at root
app.get('/', (_req, res) => {
  res.sendFile(join(webDir, 'landing.html'));
});

// Serve static assets from web/ with no-cache for JS/CSS (ensures updates are picked up)
app.use(express.static(webDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

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

// Server status (aggregate stats, no session IDs exposed)
app.get('/api/status', (_req, res) => {
  // Count web clients per agent session
  const clientsBySession = new Map<string, number>();
  for (const [, client] of webClients) {
    clientsBySession.set(client.sessionId, (clientsBySession.get(client.sessionId) || 0) + 1);
  }

  const agentList = [];
  for (const [, agent] of agents) {
    agentList.push({
      name: agent.name,
      hostname: agent.hostname,
      workDir: agent.workDir,
      version: agent.version,
      hasPassword: !!agent.passwordHash,
      connectedAt: agent.connectedAt.toISOString(),
      webClients: clientsBySession.get(agent.sessionId) || 0,
    });
  }

  const mem = process.memoryUsage();
  res.json({
    server: {
      version: pkg.version,
      startedAt: startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / 1000),
      memoryMB: Math.round(mem.rss / 1024 / 1024),
    },
    agents: {
      connected: agents.size,
      list: agentList,
    },
    webClients: {
      connected: webClients.size,
    },
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
