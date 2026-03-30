// ── Port Proxy tunnel executor (agent side) ─────────────────────────────────
// Handles tunnel_request (HTTP) and tunnel_ws_* (WebSocket) messages from the
// server, forwarding them to localhost:<port> on the agent machine.

import http from 'http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import WebSocket from 'ws';

type SendFn = (msg: Record<string, unknown>) => void;

export interface ProxyPortConfig {
  port: number;
  enabled: boolean;
  label?: string;
}

export interface ProxyConfig {
  enabled: boolean;
  ports: ProxyPortConfig[];
}

interface TunnelRequest {
  type: 'tunnel_request';
  tunnelId: string;
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string; // base64
}

interface TunnelWsOpen {
  type: 'tunnel_ws_open';
  tunnelId: string;
  port: number;
  path: string;
  headers: Record<string, string>;
}

interface TunnelWsMessage {
  type: 'tunnel_ws_message';
  tunnelId: string;
  data: string; // base64
  binary: boolean;
}

interface TunnelWsClose {
  type: 'tunnel_ws_close';
  tunnelId: string;
  code?: number;
  reason?: string;
}

const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
const HTTP_TIMEOUT = 30_000;

// ── Persistence ──
const TOOLS_DIR = join(homedir(), '.agentlink', 'tools');
const PROXY_CONFIG_FILE = join(TOOLS_DIR, 'proxy-config.json');

function loadPersistedConfig(): ProxyConfig {
  try {
    const raw = readFileSync(PROXY_CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as ProxyConfig;
    // Validate loaded data
    if (typeof parsed.enabled !== 'boolean' || !Array.isArray(parsed.ports)) {
      return { enabled: false, ports: [] };
    }
    return {
      enabled: parsed.enabled,
      ports: parsed.ports.filter(p => validatePort(p.port)).map(p => ({
        port: p.port,
        enabled: !!p.enabled,
        ...(p.label ? { label: p.label } : {}),
      })),
    };
  } catch {
    return { enabled: false, ports: [] };
  }
}

function persistConfig(config: ProxyConfig): void {
  try {
    if (!existsSync(TOOLS_DIR)) {
      mkdirSync(TOOLS_DIR, { recursive: true });
    }
    writeFileSync(PROXY_CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.warn('[AgentLink] Failed to persist proxy config:', err);
  }
}

// Active tunnel WebSocket connections (tunnelId → ws to localhost)
const activeTunnelWs = new Map<string, WebSocket>();

let proxyConfig: ProxyConfig = loadPersistedConfig();

function isPortAllowed(port: number): boolean {
  if (!proxyConfig.enabled) return false;
  const entry = proxyConfig.ports.find(p => p.port === port);
  return !!entry && entry.enabled;
}

function validatePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

export function createTunnelHandler(send: SendFn) {
  function handleTunnelRequest(msg: TunnelRequest): void {
    const { tunnelId, port, method, path, headers, body } = msg;

    if (!validatePort(port)) {
      send({ type: 'tunnel_response', tunnelId, status: 403, error: `Invalid port: ${port}` });
      return;
    }
    if (!isPortAllowed(port)) {
      send({ type: 'tunnel_response', tunnelId, status: 403, error: `Port ${port} is not enabled for proxy` });
      return;
    }

    const bodyBuffer = body ? Buffer.from(body, 'base64') : undefined;
    if (bodyBuffer && bodyBuffer.length > MAX_BODY_SIZE) {
      send({ type: 'tunnel_response', tunnelId, status: 413, error: 'Request body too large' });
      return;
    }

    // Strip hop-by-hop headers that shouldn't be forwarded
    const forwardHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      const lower = k.toLowerCase();
      if (lower === 'host' || lower === 'connection' || lower === 'upgrade' || lower === 'transfer-encoding') continue;
      forwardHeaders[k] = v;
    }
    forwardHeaders['host'] = `localhost:${port}`;

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path,
      headers: forwardHeaders,
      timeout: HTTP_TIMEOUT,
    }, (res) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      res.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_BODY_SIZE) {
          res.destroy();
          send({ type: 'tunnel_response', tunnelId, status: 502, error: 'Response body too large' });
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const respHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v) respHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
        }

        send({
          type: 'tunnel_response',
          tunnelId,
          status: res.statusCode || 502,
          headers: respHeaders,
          body: Buffer.concat(chunks).toString('base64'),
        });
      });

      res.on('error', (err) => {
        send({ type: 'tunnel_response', tunnelId, status: 502, error: err.message });
      });
    });

    req.on('error', (err) => {
      send({ type: 'tunnel_response', tunnelId, status: 502, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      send({ type: 'tunnel_response', tunnelId, status: 504, error: 'Request timed out' });
    });

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  }

  function handleTunnelWsOpen(msg: TunnelWsOpen): void {
    const { tunnelId, port, path, headers } = msg;

    if (!validatePort(port) || !isPortAllowed(port)) {
      send({ type: 'tunnel_ws_error', tunnelId, message: `Port ${port} is not enabled for proxy` });
      send({ type: 'tunnel_ws_close', tunnelId, code: 1008, reason: 'Port not allowed' });
      return;
    }

    const wsUrl = `ws://127.0.0.1:${port}${path || '/'}`;
    const forwardHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      const lower = k.toLowerCase();
      if (lower === 'host' || lower === 'connection' || lower === 'upgrade' ||
          lower === 'sec-websocket-key' || lower === 'sec-websocket-version' ||
          lower === 'sec-websocket-extensions') continue;
      forwardHeaders[k] = v;
    }

    const ws = new WebSocket(wsUrl, { headers: forwardHeaders });

    ws.on('open', () => {
      activeTunnelWs.set(tunnelId, ws);
      send({ type: 'tunnel_ws_opened', tunnelId });
    });

    ws.on('message', (data: Buffer | string, isBinary: boolean) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      send({ type: 'tunnel_ws_message', tunnelId, data: buf.toString('base64'), binary: isBinary });
    });

    ws.on('close', (code, reason) => {
      activeTunnelWs.delete(tunnelId);
      send({ type: 'tunnel_ws_close', tunnelId, code, reason: reason?.toString() });
    });

    ws.on('error', (err) => {
      activeTunnelWs.delete(tunnelId);
      send({ type: 'tunnel_ws_error', tunnelId, message: err.message });
    });
  }

  function handleTunnelWsMessage(msg: TunnelWsMessage): void {
    const ws = activeTunnelWs.get(msg.tunnelId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const buf = Buffer.from(msg.data, 'base64');
    ws.send(msg.binary ? buf : buf.toString('utf8'));
  }

  function handleTunnelWsClose(msg: TunnelWsClose): void {
    const ws = activeTunnelWs.get(msg.tunnelId);
    if (ws) {
      activeTunnelWs.delete(msg.tunnelId);
      const code = msg.code && msg.code >= 1000 && msg.code <= 4999 ? msg.code : 1000;
      ws.close(code, msg.reason || '');
    }
  }

  function handleProxyConfigUpdate(msg: { config: ProxyConfig }): void {
    // Validate ports
    const validPorts = msg.config.ports.filter(p => validatePort(p.port));
    proxyConfig = {
      enabled: !!msg.config.enabled,
      ports: validPorts.map(p => ({
        port: p.port,
        enabled: !!p.enabled,
        ...(p.label ? { label: p.label } : {}),
      })),
    };
    console.log(`[AgentLink] Proxy config updated: enabled=${proxyConfig.enabled}, ports=[${proxyConfig.ports.map(p => `${p.port}(${p.enabled ? 'on' : 'off'})`).join(', ')}]`);
    persistConfig(proxyConfig);

    // Echo back confirmed config to server/web
    send({ type: 'proxy_config_updated', config: proxyConfig });
  }

  function getProxyConfig(): ProxyConfig {
    return proxyConfig;
  }

  function cleanup(): void {
    for (const [tunnelId, ws] of activeTunnelWs) {
      ws.close(1001, 'Agent shutting down');
      activeTunnelWs.delete(tunnelId);
    }
  }

  return {
    handleTunnelRequest,
    handleTunnelWsOpen,
    handleTunnelWsMessage,
    handleTunnelWsClose,
    handleProxyConfigUpdate,
    getProxyConfig,
    cleanup,
  };
}
