# Port Proxy (端口反向代理) — Design Document

**Date:** 2026-03-29
**Status:** Draft — Pending Review

## 1. Overview

AgentLink 新增端口反向代理功能，让用户通过 `https://msclaude.ai/s/<sessionId>/proxy/<port>/path` 访问 agent 所在机器的 `localhost:<port>`，无需远程桌面或 SSH 隧道。

功能特性：
- **临时性**：通过 UI 全局开关随时启/停，默认关闭
- **按端口管理**：用户手动添加要代理的端口，每个端口可单独启/停
- **无需认证**：知道 URL 即可访问（临时开发工具，非生产功能）
- **支持 HTTP + WebSocket** 协议

## 2. Use Cases

1. **开发调试**：开发者在远程机器上运行 `npm run dev`（如 Vite 跑在 5173 端口），通过浏览器直接访问预览页面。
2. **Agent 自动化**：Claude 在 agent 机器启动了一个 web 服务，用户直接在浏览器中查看结果。

## 3. Architecture

### 3.1 Data Flow

```
Browser (任意设备)
  │
  │  HTTP/WS request: GET /s/<sessionId>/proxy/<port>/path/to/resource
  ▼
Server (msclaude.ai)
  │  ① 从 URL 解析 sessionId, port, path
  │  ② 查找 agent: sessions.getAgentBySession(sessionId)
  │  ③ 检查 agent 的 proxy 是否启用 & 该端口是否在允许列表中
  │  ④ 构造 tunnel_request，通过 agent WebSocket 发送 (加密)
  ▼
Agent (开发机)
  │  ⑤ 校验端口在本地允许列表中
  │  ⑥ 向 localhost:<port> 发起真实 HTTP/WS 请求
  │  ⑦ 组装 tunnel_response，通过 WebSocket 发回 server (加密)
  ▼
Server
  │  ⑧ 解密 tunnel_response
  │  ⑨ 转写为 HTTP 响应返回给 Browser
  ▼
Browser 收到响应
```

### 3.2 URL Scheme

```
/s/<sessionId>/proxy/<port>[/<path>]
```

Examples:
- `/s/abc123/proxy/5173/` → agent 的 `http://localhost:5173/`
- `/s/abc123/proxy/8080/api/users` → agent 的 `http://localhost:8080/api/users`
- `/s/abc123/proxy/3000/ws` → agent 的 `ws://localhost:3000/ws` (WebSocket upgrade)

### 3.3 Proxy State Management

Proxy 开关状态由 **agent 端维护**，通过消息协议同步到 server 和 web UI：

```
Web UI (用户操作)
  │  proxy_config_update { enabled: true, ports: [{ port: 5173, enabled: true }] }
  ▼
Agent (权威状态)
  │  维护 proxyConfig: { enabled, ports[] }
  │  回复 proxy_config_updated 确认
  ▼
Server (缓存)
  │  缓存 agent 的 proxy 配置，用于 HTTP 路由校验
  ▼
Web UI (展示)
```

## 4. Message Protocol

### 4.1 Proxy Config Messages

#### `proxy_config_update` (Web → Agent)

用户在 UI 上修改 proxy 配置：

```typescript
{
  type: 'proxy_config_update',
  config: {
    enabled: boolean,           // 全局开关
    ports: Array<{
      port: number,
      enabled: boolean,         // 单端口开关
      label?: string,           // 可选标签, e.g. "Vite dev server"
    }>,
  },
}
```

#### `proxy_config_updated` (Agent → Web/Server)

Agent 确认配置变更（也在 agent 重连时发送，同步状态）：

```typescript
{
  type: 'proxy_config_updated',
  config: {
    enabled: boolean,
    ports: Array<{
      port: number,
      enabled: boolean,
      label?: string,
    }>,
  },
}
```

### 4.2 Tunnel Messages (HTTP)

#### `tunnel_request` (Server → Agent)

```typescript
{
  type: 'tunnel_request',
  tunnelId: string,       // UUID, 用于匹配 request/response
  port: number,           // agent 本地端口
  method: string,         // GET, POST, PUT, DELETE, etc.
  path: string,           // 含 query string, e.g. "/api/users?page=2"
  headers: Record<string, string>,
  body?: string,          // base64 encoded (binary-safe)
}
```

#### `tunnel_response` (Agent → Server)

```typescript
{
  type: 'tunnel_response',
  tunnelId: string,
  status: number,         // HTTP status code
  headers: Record<string, string>,
  body?: string,          // base64 encoded
  error?: string,         // 连接失败时的错误消息 (ECONNREFUSED etc.)
}
```

### 4.3 Tunnel Messages (WebSocket)

#### `tunnel_ws_open` (Server → Agent)

```typescript
{
  type: 'tunnel_ws_open',
  tunnelId: string,
  port: number,
  path: string,
  headers: Record<string, string>,
}
```

#### `tunnel_ws_opened` (Agent → Server)

Agent 成功连接到本地 WebSocket 后的确认：

```typescript
{
  type: 'tunnel_ws_opened',
  tunnelId: string,
}
```

#### `tunnel_ws_message` (双向)

```typescript
{
  type: 'tunnel_ws_message',
  tunnelId: string,
  data: string,           // base64 encoded
  binary: boolean,        // true=binary frame, false=text frame
}
```

#### `tunnel_ws_close` (双向)

```typescript
{
  type: 'tunnel_ws_close',
  tunnelId: string,
  code?: number,
  reason?: string,
}
```

#### `tunnel_ws_error` (Agent → Server)

```typescript
{
  type: 'tunnel_ws_error',
  tunnelId: string,
  message: string,
}
```

## 5. Web UI

### 5.1 位置

Sidebar workdir 菜单新增 "Port Proxy" 入口（和 Browse Files、Git 并列），点击后 sidebar 切换到 proxy 管理视图。

### 5.2 Proxy 管理视图

```
┌─ Sidebar ────────────────────┐
│ ← Back          Port Proxy   │
│ ─────────────────────────────│
│ [  Global toggle  ●ON ] │
│ ─────────────────────────────│
│ Add port:                    │
│ ┌──────────┐ ┌──────┐       │
│ │ 5173     │ │ Add  │       │
│ └──────────┘ └──────┘       │
│ ─────────────────────────────│
│ ● 5173  (Vite dev)     [×]  │
│   📋 /s/abc123/proxy/5173   │
│                              │
│ ○ 8080                 [×]  │
│   📋 /s/abc123/proxy/8080   │
│                              │
│ ─────────────────────────────│
│ ⚠ Proxy is public — anyone  │
│ with the URL can access.     │
└──────────────────────────────┘
```

说明：
- **Global toggle**：全局开关，关闭后所有端口停止代理
- **端口列表**：每行可单独 toggle 启/停，显示完整 proxy URL，支持一键复制
- **添加端口**：输入框 + Add 按钮
- **删除**：每行的 × 按钮
- **安全提示**：底部显示 "Proxy is public" 警告

### 5.3 TopBar 指示器

当 proxy 功能启用时，TopBar 显示一个小指示器（如 `🔌 2 ports`），点击可快速跳到 proxy 视图。

## 6. Implementation Plan

### 6.1 Server Side

**New file: `server/src/tunnel.ts`**

```typescript
// 核心数据结构
const pendingRequests = new Map<string, {
  resolve: (resp: TunnelResponse) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}>();

const activeTunnelWs = new Map<string, {
  browserWs: WebSocket;   // browser ↔ server
  agentSessionId: string; // 用于路由
}>();

// Agent 的 proxy 配置缓存 (权威数据在 agent 端)
const agentProxyConfigs = new Map<string, ProxyConfig>();  // agentId → config

// 导出函数
export function createTunnelHandler(sessions: SessionManager) {
  return {
    httpHandler,       // Express middleware
    wsUpgradeHandler,  // WebSocket upgrade
    handleAgentMessage, // 处理 agent 发来的 tunnel 消息
    updateProxyConfig,  // 更新 agent proxy 配置缓存
    getProxyConfig,     // 查询配置
  };
}
```

核心逻辑：
- **HTTP proxy handler**: Express middleware，挂载在 `/s/:sessionId/proxy/:port/*`
  - 查找 agent WebSocket
  - 检查 proxy 开关和端口白名单
  - 生成 tunnelId，构造 `tunnel_request`
  - 等待 agent 返回 `tunnel_response`（Promise + timeout 30s）
  - 将 tunnel_response 转写为 HTTP response
- **WebSocket proxy handler**: 检测 `Upgrade: websocket` 请求
  - 接受浏览器端 WebSocket
  - 发送 `tunnel_ws_open` 到 agent
  - 双向中继 `tunnel_ws_message` / `tunnel_ws_close`
- **Pending request map**: agent 回复时 resolve，超时 reject

**修改 `server/src/ws-agent.ts`**:
- 识别 `tunnel_response` / `tunnel_ws_*` / `proxy_config_updated` 消息
- `tunnel_*` 消息路由到 tunnel handler（不转发给 web clients）
- `proxy_config_updated` 更新 tunnel 配置缓存，并转发给 web clients

**修改 `server/src/http.ts`**:
- 注册 `/s/:sessionId/proxy/:port/*` 路由

**修改 `server/src/index.ts`**:
- WebSocket upgrade 时，区分 web client 连接和 tunnel WebSocket 连接（检查 URL path）

### 6.2 Agent Side

**New file: `agent/src/tunnel.ts`**

```typescript
// Proxy 配置 (权威状态)
let proxyConfig: ProxyConfig = { enabled: false, ports: [] };

export function createTunnelHandler(send: SendFn) {
  return {
    handleTunnelRequest,     // HTTP tunnel
    handleTunnelWsOpen,      // WS tunnel open
    handleTunnelWsMessage,   // WS tunnel data
    handleTunnelWsClose,     // WS tunnel close
    handleProxyConfigUpdate, // 配置变更
    getProxyConfig,
    cleanup,                 // 关闭所有活跃 tunnel
  };
}
```

核心逻辑：
- **HTTP tunnel handler**: 收到 `tunnel_request`，用 `node:http` 向 `localhost:<port>` 发请求
  - 校验端口在允许列表中
  - 收集完整 response，base64 编码 body
  - 发回 `tunnel_response`
- **WebSocket tunnel handler**: 收到 `tunnel_ws_open`，用 `ws` 连接 `ws://localhost:<port><path>`
  - 双向中继 `tunnel_ws_message`
  - 连接关闭时发 `tunnel_ws_close`
- **Config handler**: 收到 `proxy_config_update`，更新本地配置，回复 `proxy_config_updated`

**修改 `agent/src/connection.ts`**:
- 在 `handleServerMessage()` switch 中添加 tunnel 和 proxy_config 消息类型的 dispatch
- Agent 注册成功后，发送当前 `proxy_config_updated` 同步初始状态

### 6.3 Web UI

**New file: `server/web/src/components/ProxyPanel.vue`**

Sidebar proxy 管理视图组件：
- 全局开关 toggle
- 端口添加（输入框 + 按钮）
- 端口列表（toggle、URL 复制、删除）
- 安全警告

**New file: `server/web/src/modules/proxy.js`**

Proxy 模块（factory pattern `createProxy(deps)`）：
- Reactive state: `proxyConfig`, `proxyEnabled`
- Methods: `addPort()`, `removePort()`, `togglePort()`, `toggleProxy()`, `copyProxyUrl()`
- 发送 `proxy_config_update` 消息到 agent
- 处理 `proxy_config_updated` 消息

**New file: `server/web/src/css/proxy.css`**

Proxy 面板样式。

**修改 `server/web/src/modules/handlers/feature-handler.js`**:
- 添加 `proxy_config_updated` 消息处理

**修改 `server/web/src/store.js`**:
- 集成 proxy module（`createProxy()`）
- 通过 `provide('proxy', store._proxy)` 暴露

**修改 `server/web/src/components/Sidebar.vue`**:
- Workdir 菜单添加 "Port Proxy" 入口
- 条件渲染 `<ProxyPanel />` 组件

**修改 `server/web/src/components/TopBar.vue`**:
- 当 proxy 启用时显示指示器

**修改 `server/web/src/App.vue`**:
- 提供 proxy module

## 7. Safety Guardrails

1. **默认关闭**：Proxy 功能默认不启用，需用户手动打开
2. **仅 localhost**：Agent 端只向 `127.0.0.1` / `localhost` 发请求，禁止代理到其他 IP
3. **端口范围**：仅允许 `1024-65535`，禁止 well-known 端口
4. **UI 警告**：明确告知用户 "proxy URL 是公开的，任何知道 URL 的人都可以访问"
5. **Timeout**：HTTP 请求 30s 超时
6. **Body 大小限制**：默认 10MB per request/response
7. **并发限制**：每个 session 最多 50 个并发 tunnel 请求

## 8. Limitations & Future Work

- **大文件/流式传输**：Phase 1 完整 buffer 后返回。Phase 2 可加 chunked transfer。
- **SSE (Server-Sent Events)**：Phase 1 不支持，Phase 2 可加。
- **Agent 自动探测端口**：Phase 2，agent 扫描 listening ports 自动上报。
- **自定义域名**：如 `myapp.msclaude.ai`，需 DNS 配置。

## 9. File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `server/src/tunnel.ts` | **New** | HTTP/WS proxy handler, pending request map, config cache |
| `server/src/ws-agent.ts` | Modify | Route tunnel/proxy messages to tunnel module |
| `server/src/http.ts` | Modify | Register proxy routes |
| `server/src/index.ts` | Modify | Handle tunnel WebSocket upgrades |
| `agent/src/tunnel.ts` | **New** | HTTP/WS tunnel executor, proxy config state |
| `agent/src/connection.ts` | Modify | Dispatch tunnel/proxy message types |
| `server/web/src/components/ProxyPanel.vue` | **New** | Proxy management UI |
| `server/web/src/modules/proxy.js` | **New** | Proxy state module |
| `server/web/src/css/proxy.css` | **New** | Proxy panel styles |
| `server/web/src/modules/handlers/feature-handler.js` | Modify | Handle proxy_config_updated |
| `server/web/src/store.js` | Modify | Integrate proxy module |
| `server/web/src/components/Sidebar.vue` | Modify | Add proxy menu entry + panel |
| `server/web/src/components/TopBar.vue` | Modify | Proxy active indicator |
| `server/web/src/App.vue` | Modify | Provide proxy module |
| `test/server/tunnel.test.ts` | **New** | Server tunnel unit tests |
| `test/agent/tunnel.test.ts` | **New** | Agent tunnel unit tests |
| `test/functional/tunnel.test.ts` | **New** | Functional test (mock agent + proxy) |
