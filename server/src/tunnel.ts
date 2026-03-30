// ── Port Proxy tunnel handler (server side) ─────────────────────────────────
// Routes HTTP/WS proxy requests from browsers to the agent via the existing
// encrypted WebSocket channel.  Also caches per-agent proxy config.

import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { WebSocket, type RawData } from 'ws';
import { IncomingMessage } from 'http';
import { sessions } from './session-manager.js';
import { encryptAndSend, parseMessage } from './encryption.js';
import type { Duplex } from 'stream';

// ── Types ───────────────────────────────────────────────────────────────────

interface ProxyPortConfig {
  port: number;
  enabled: boolean;
  label?: string;
}

interface ProxyConfig {
  enabled: boolean;
  ports: ProxyPortConfig[];
}

interface PendingRequest {
  resolve: (resp: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ActiveTunnelWs {
  browserWs: WebSocket;
  agentId: string;
}

// ── State ───────────────────────────────────────────────────────────────────

// Agent proxy configs (agentId → config), authoritative copy lives on agent
const agentProxyConfigs = new Map<string, ProxyConfig>();

// Pending HTTP tunnel requests (tunnelId → promise resolver)
const pendingRequests = new Map<string, PendingRequest>();

// Active WebSocket tunnels (tunnelId → browser ws + agentId)
const activeTunnelWs = new Map<string, ActiveTunnelWs>();

const HTTP_TIMEOUT = 30_000;
const MAX_CONCURRENT = 50;

// Track concurrent requests per session
const sessionConcurrency = new Map<string, number>();

// ── Exported API ────────────────────────────────────────────────────────────

export function updateProxyConfig(agentId: string, config: ProxyConfig): void {
  agentProxyConfigs.set(agentId, config);
  console.log(`[Tunnel] Config updated for agent ${agentId}: enabled=${config.enabled}, ports=[${config.ports.map(p => `${p.port}(${p.enabled ? 'on' : 'off'})`).join(', ')}]`);
}

export function getProxyConfig(agentId: string): ProxyConfig | undefined {
  return agentProxyConfigs.get(agentId);
}

export function removeProxyConfig(agentId: string): void {
  agentProxyConfigs.delete(agentId);
}

function isPortAllowed(agentId: string, port: number): boolean {
  const config = agentProxyConfigs.get(agentId);
  if (!config || !config.enabled) return false;
  const entry = config.ports.find(p => p.port === port);
  return !!entry && entry.enabled;
}

// ── Agent message handler ───────────────────────────────────────────────────

/**
 * Returns true if the message was handled by the tunnel module (should NOT
 * be forwarded to web clients).
 */
export function handleAgentTunnelMessage(msg: Record<string, unknown>): boolean {
  switch (msg.type) {
    case 'tunnel_response': {
      const tunnelId = msg.tunnelId as string;
      const pending = pendingRequests.get(tunnelId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingRequests.delete(tunnelId);
        pending.resolve(msg);
      }
      return true;
    }

    case 'tunnel_ws_opened': {
      // nothing extra — the browser ws is already connected
      return true;
    }

    case 'tunnel_ws_message': {
      const tunnelId = msg.tunnelId as string;
      const tunnel = activeTunnelWs.get(tunnelId);
      if (tunnel && tunnel.browserWs.readyState === WebSocket.OPEN) {
        try {
          const buf = Buffer.from(msg.data as string, 'base64');
          tunnel.browserWs.send((msg.binary as boolean) ? buf : buf.toString('utf8'));
        } catch (err) {
          console.error(`[Tunnel] Failed to send to browser WS ${tunnelId}:`, (err as Error).message);
        }
      }
      return true;
    }

    case 'tunnel_ws_close': {
      const tunnelId = msg.tunnelId as string;
      const tunnel = activeTunnelWs.get(tunnelId);
      if (tunnel) {
        activeTunnelWs.delete(tunnelId);
        if (tunnel.browserWs.readyState === WebSocket.OPEN) {
          const code = typeof msg.code === 'number' && msg.code >= 1000 && msg.code <= 4999 ? msg.code : 1000;
          try {
            tunnel.browserWs.close(code, (msg.reason as string) || '');
          } catch (err) {
            console.error(`[Tunnel] Failed to close browser WS ${tunnelId}:`, (err as Error).message);
            try { tunnel.browserWs.terminate(); } catch { /* swallow */ }
          }
        }
      }
      return true;
    }

    case 'tunnel_ws_error': {
      const tunnelId = msg.tunnelId as string;
      const tunnel = activeTunnelWs.get(tunnelId);
      if (tunnel) {
        activeTunnelWs.delete(tunnelId);
        if (tunnel.browserWs.readyState === WebSocket.OPEN) {
          try {
            tunnel.browserWs.close(1011, (msg.message as string) || 'Tunnel error');
          } catch (err) {
            console.error(`[Tunnel] Failed to close browser WS ${tunnelId} on error:`, (err as Error).message);
            try { tunnel.browserWs.terminate(); } catch { /* swallow */ }
          }
        }
      }
      return true;
    }

    default:
      return false;
  }
}

// ── HTTP proxy handler (Express middleware) ──────────────────────────────────

export function httpProxyHandler(req: Request, res: Response): void {
  const sessionId = req.params.sessionId;
  const port = parseInt(req.params.port, 10);

  if (!port || port < 1024 || port > 65535) {
    res.status(400).json({ error: 'Invalid port. Must be 1024-65535.' });
    return;
  }

  const agent = sessions.getAgentBySession(sessionId);
  if (!agent) {
    res.status(404).json({ error: 'Agent not found for this session.' });
    return;
  }

  if (!isPortAllowed(agent.agentId, port)) {
    res.status(403).json({ error: `Port ${port} is not enabled for proxy.` });
    return;
  }

  // Concurrency check
  const current = sessionConcurrency.get(sessionId) || 0;
  if (current >= MAX_CONCURRENT) {
    res.status(429).json({ error: 'Too many concurrent proxy requests.' });
    return;
  }
  sessionConcurrency.set(sessionId, current + 1);

  const tunnelId = randomUUID();
  const proxyPath = '/' + (req.params[0] || '');
  const fullPath = proxyPath + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');

  // Collect request body
  const bodyChunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks).toString('base64') : undefined;

    // Extract headers (skip hop-by-hop)
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v !== 'string') continue;
      const lower = k.toLowerCase();
      if (lower === 'host' || lower === 'connection' || lower === 'upgrade') continue;
      headers[k] = v;
    }

    // Send tunnel_request to agent
    const tunnelReq = {
      type: 'tunnel_request',
      tunnelId,
      port,
      method: req.method,
      path: fullPath,
      headers,
      body,
    };

    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(tunnelId);
        reject(new Error('Tunnel request timed out'));
      }, HTTP_TIMEOUT);

      pendingRequests.set(tunnelId, { resolve, reject, timer });
    });

    encryptAndSend(agent.ws, tunnelReq, agent.sessionKey).catch((err) => {
      console.error(`[Tunnel] Failed to send tunnel_request for ${tunnelId}:`, (err as Error).message);
    });

    promise.then((resp) => {
      const dec = sessionConcurrency.get(sessionId);
      if (dec) sessionConcurrency.set(sessionId, dec - 1);

      if (resp.error) {
        const status = typeof resp.status === 'number' ? resp.status : 502;
        res.status(status).json({ error: resp.error });
        return;
      }

      const status = typeof resp.status === 'number' ? resp.status : 200;
      const respHeaders = (resp.headers || {}) as Record<string, string>;

      // Set response headers (skip hop-by-hop)
      for (const [k, v] of Object.entries(respHeaders)) {
        const lower = k.toLowerCase();
        if (lower === 'transfer-encoding' || lower === 'connection') continue;
        res.setHeader(k, v);
      }

      const respBody = resp.body ? Buffer.from(resp.body as string, 'base64') : Buffer.alloc(0);

      // Inject <base> tag into HTML responses so relative asset paths resolve through the proxy prefix
      const contentType = (respHeaders['content-type'] || respHeaders['Content-Type'] || '') as string;
      if (contentType.includes('text/html') && respBody.length > 0) {
        const html = respBody.toString('utf-8');
        const baseHref = `/s/${sessionId}/proxy/${port}/`;
        const injected = html.replace('<head>', `<head><base href="${baseHref}">`);
        res.status(status).send(injected);
      } else {
        res.status(status).send(respBody);
      }
    }).catch((err) => {
      const dec = sessionConcurrency.get(sessionId);
      if (dec) sessionConcurrency.set(sessionId, dec - 1);
      res.status(504).json({ error: err.message });
    });
  });
}

// ── WebSocket tunnel upgrade handler ────────────────────────────────────────

/**
 * Returns true if the URL matches a proxy WebSocket path and was handled
 * (or rejected). Returns false if the URL is not a proxy path.
 */
export function handleTunnelWsUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: { handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer, cb: (ws: WebSocket) => void) => void },
): boolean {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  // Match: /s/<sessionId>/proxy/<port>[/path...]
  const match = url.pathname.match(/^\/s\/([^/]+)\/proxy\/(\d+)(\/.*)?$/);
  if (!match) return false;

  const sessionId = match[1];
  const port = parseInt(match[2], 10);
  const proxyPath = (match[3] || '/') + url.search;

  if (!port || port < 1024 || port > 65535) {
    socket.destroy();
    return true;
  }

  const agent = sessions.getAgentBySession(sessionId);
  if (!agent) {
    socket.destroy();
    return true;
  }

  if (!isPortAllowed(agent.agentId, port)) {
    socket.destroy();
    return true;
  }

  // Accept the WebSocket upgrade from the browser
  wss.handleUpgrade(req, socket, head, (browserWs: WebSocket) => {
    const tunnelId = randomUUID();

    activeTunnelWs.set(tunnelId, { browserWs, agentId: agent.agentId });

    // Extract headers
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v;
    }

    // Send tunnel_ws_open to agent
    encryptAndSend(agent.ws, {
      type: 'tunnel_ws_open',
      tunnelId,
      port,
      path: proxyPath,
      headers,
    }, agent.sessionKey).catch((err) => {
      console.error(`[Tunnel] Failed to send tunnel_ws_open for ${tunnelId}:`, (err as Error).message);
    });

    // Relay browser → agent messages
    browserWs.on('message', (data: RawData, isBinary: boolean) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      encryptAndSend(agent.ws, {
        type: 'tunnel_ws_message',
        tunnelId,
        data: buf.toString('base64'),
        binary: isBinary,
      }, agent.sessionKey).catch((err) => {
        console.error(`[Tunnel] Failed to relay browser→agent msg for ${tunnelId}:`, (err as Error).message);
      });
    });

    browserWs.on('close', (code, reason) => {
      activeTunnelWs.delete(tunnelId);
      const safeCode = code >= 1000 && code <= 4999 ? code : 1000;
      encryptAndSend(agent.ws, {
        type: 'tunnel_ws_close',
        tunnelId,
        code: safeCode,
        reason: reason?.toString(),
      }, agent.sessionKey).catch((err) => {
        console.error(`[Tunnel] Failed to send tunnel_ws_close for ${tunnelId}:`, (err as Error).message);
      });
    });

    browserWs.on('error', () => {
      activeTunnelWs.delete(tunnelId);
      encryptAndSend(agent.ws, {
        type: 'tunnel_ws_close',
        tunnelId,
        code: 1011,
        reason: 'Browser WebSocket error',
      }, agent.sessionKey).catch((err) => {
        console.error(`[Tunnel] Failed to send tunnel_ws_close (error) for ${tunnelId}:`, (err as Error).message);
      });
    });
  });

  return true;
}

// ── Cleanup on agent disconnect ─────────────────────────────────────────────

export function cleanupAgentTunnels(agentId: string): void {
  removeProxyConfig(agentId);
  // Close any active WebSocket tunnels for this agent
  for (const [tunnelId, tunnel] of activeTunnelWs) {
    if (tunnel.agentId === agentId) {
      activeTunnelWs.delete(tunnelId);
      if (tunnel.browserWs.readyState === WebSocket.OPEN) {
        try { tunnel.browserWs.close(1001, 'Agent disconnected'); } catch { /* swallow */ }
      }
    }
  }
}
