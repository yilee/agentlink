import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.PORT || '3456', 10);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve web/ directory as static files
const webDir = join(__dirname, '../../web');
app.use(express.static(webDir));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// WebSocket connection handler (placeholder)
wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const type = url.searchParams.get('type'); // 'agent' or 'web'

  console.log(`[WS] ${type || 'unknown'} connected from ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    console.log(`[WS] Received: ${data.toString().slice(0, 200)}`);
  });

  ws.on('close', () => {
    console.log(`[WS] ${type || 'unknown'} disconnected`);
  });
});

server.listen(PORT, () => {
  console.log(`[AgentLink] Server listening on http://localhost:${PORT}`);
  console.log(`[AgentLink] Web UI: ${webDir}`);
});
