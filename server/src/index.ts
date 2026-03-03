import express from 'express';
import { createServer } from 'http';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { WebSocket, WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { agents, webClients, cleanupDeadConnections } from './context.js';
import { handleAgentConnection } from './ws-agent.js';
import { handleWebConnection } from './ws-client.js';
import { saveServerRuntimeState, clearServerRuntimeState } from './config.js';
import { encryptAndSend } from './encryption.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const startedAt = new Date();

// Build versioned index.html at startup (cache-busting for browsers like iPhone Safari)
const versionTag = `v=${pkg.version}`;
const indexHtml = readFileSync(join(__dirname, '../web/index.html'), 'utf-8')
  // Version-stamp local asset URLs in src="..." and href="..." attributes
  .replace(/((?:src|href)\s*=\s*")(\/(?!\/)[^"?]+\.(?:js|css))(")/g, `$1$2?${versionTag}$3`)
  // Version-stamp JS string literals referencing local .css/.js paths (e.g. theme switching)
  .replace(/(')(\/(?!\/)[^'?]+\.(?:js|css))(')/g, `$1$2?${versionTag}$3`);

const PORT = parseInt(process.env.PORT || '3456', 10);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const webDir = join(__dirname, '../web');

// Landing page at root
app.get('/', (_req, res) => {
  res.sendFile(join(webDir, 'landing.html'));
});

// Serve versioned index.html with no-store (cache-busting for browsers like iPhone Safari)
const sendIndexHtml = (_req: express.Request, res: express.Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(indexHtml);
};

// Intercept /index.html before express.static to ensure versioned HTML is served
app.get('/index.html', sendIndexHtml);

// Serve static assets from web/ with no-cache for JS/CSS (ensures updates are picked up)
app.use(express.static(webDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

// SPA fallback: /s/:sessionId → serve versioned index.html
app.get('/s/:sessionId', sendIndexHtml);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    agents: agents.size,
    webClients: webClients.size,
    timestamp: new Date().toISOString(),
  });
});

// Server status (aggregate stats, no agent details exposed)
app.get('/api/status', (_req, res) => {
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
  cleanupDeadConnections((client, msg) => {
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
