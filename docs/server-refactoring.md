# Server 架构重构方案

## 背景

Server 端共 9 个文件 ~1450 行，功能完整但存在以下结构性问题：

1. **全局可变状态散落** — `context.ts` 导出 6 个模块级 Map，所有模块直接读写，无封装，测试时无法隔离
2. **认证逻辑跨 3 个文件** — `auth.ts` 做 crypto，`ws-client.ts` 跑认证状态机，`context.ts` 存认证状态
3. **消息转发队列重复** — `ws-agent.ts` 和 `ws-client.ts` 各维护一个 `Map<string, Promise<void>>` 做消息排序，代码几乎相同
4. **`index.ts` 职责混合** — HTTP 静态文件、WS 路由、健康检查 API、心跳清理全在一个文件

## 原则

- **不改功能，不改协议** — 对 agent 端和 web 端完全透明
- **只拆文件、提取类** — 纯内部重构
- **保持外部 API 兼容** — 所有 WS 消息类型和 HTTP 端点不变

## 重构方向

### 方向 1：`context.ts` → `SessionManager` 类

**现状：** `context.ts` 导出 6 个独立 Map + 2 个函数，任何模块都能直接增删改查。

**目标：** 收进 `SessionManager` 类，提供语义化方法，状态修改集中管控。

**新文件：** `server/src/session-manager.ts`

```typescript
import { WebSocket } from 'ws';
import { randomBytes } from 'crypto';

export interface AgentSession {
  ws: WebSocket;
  agentId: string;
  name: string;
  hostname: string;
  workDir: string;
  version: string;
  sessionId: string;
  sessionKey: Uint8Array | null;
  connectedAt: Date;
  isAlive: boolean;
  passwordHash: string | null;
  passwordSalt: string | null;
}

export interface WebClient {
  ws: WebSocket;
  clientId: string;
  sessionId: string;
  sessionKey: Uint8Array | null;
  connectedAt: Date;
  isAlive: boolean;
}

class SessionManager {
  agents = new Map<string, AgentSession>();
  sessionToAgent = new Map<string, string>();
  webClients = new Map<string, WebClient>();

  generateSessionId(): string {
    return randomBytes(12).toString('base64url');
  }

  // Agent operations
  registerAgent(agentId: string, agent: AgentSession): void;
  removeAgent(agentId: string): void;
  getAgent(agentId: string): AgentSession | undefined;
  getAgentBySession(sessionId: string): AgentSession | undefined;

  // Client operations
  registerClient(clientId: string, client: WebClient): void;
  removeClient(clientId: string): void;
  getClient(clientId: string): WebClient | undefined;
  getClientsForSession(sessionId: string): WebClient[];

  // Heartbeat cleanup
  cleanupDeadConnections(
    notifyFn: (client: WebClient, msg: { type: string }) => void
  ): { removedAgents: string[]; removedClients: string[] };
}

// 单例导出，向后兼容
export const sessions = new SessionManager();
```

**删除：** `context.ts`（类型和功能全部迁移到 `session-manager.ts`）

**影响文件：** `index.ts`, `ws-agent.ts`, `ws-client.ts`, `auth.ts` 的 import 路径

**测试变更：** `test/server/context.test.ts` → `test/server/session-manager.test.ts`，import 改为从新模块导入，用法不变

---

### 方向 2：认证逻辑合并 → `AuthManager` 类

**现状：**
- `auth.ts` — crypto 函数（hashPassword, verifyPassword, generateAuthToken, verifyAuthToken, lockout）
- `context.ts` — `authAttempts`, `pendingAuth`, `sessionAuth`, `serverSecret` 四个认证相关 Map/值
- `ws-client.ts` — 认证状态机（handlePendingAuthMessage）

**目标：** 合并 `auth.ts` + 认证相关状态 → `AuthManager` 类，认证流程一个文件看完。

**新文件：** `server/src/auth-manager.ts`

```typescript
class AuthManager {
  // 内部状态（从 context.ts 迁移）
  private authAttempts = new Map<string, AuthAttemptState>();
  private pendingAuth = new Map<string, string>();
  private sessionAuth = new Map<string, { passwordHash: string; passwordSalt: string }>();
  private serverSecret = randomBytes(32);

  // 密码 (保持原有函数逻辑)
  hashPassword(password: string): { hash: string; salt: string };
  verifyPassword(submitted: string, storedHash: string, storedSalt: string): boolean;

  // Session 密码管理
  setSessionPassword(sessionId: string, hash: string, salt: string): void;
  getSessionAuth(sessionId: string): { passwordHash: string; passwordSalt: string } | undefined;
  requiresAuth(sessionId: string): boolean;

  // Token
  generateAuthToken(sessionId: string): string;
  verifyAuthToken(token: string, expectedSessionId: string): boolean;

  // 暴力破解防护
  isLocked(sessionId: string): boolean;
  recordFailure(sessionId: string): { locked: boolean; remaining: number };
  clearFailures(sessionId: string): void;

  // Pending auth（web client 等待密码验证）
  setPending(clientId: string, sessionId: string): void;
  getPending(clientId: string): string | undefined;
  removePending(clientId: string): void;
}

export const auth = new AuthManager();
```

**删除：** `auth.ts`（功能全部迁移到 `auth-manager.ts`）

**影响文件：** `ws-agent.ts`（hashPassword）, `ws-client.ts`（所有 auth 函数）

**测试变更：** `test/server/auth.test.ts` import 改为从 `auth-manager.js` 导入，`authAttempts.clear()` 改为 `auth.clearAll()` 或类似方法

---

### 方向 3：消息转发队列提取 → `MessageRelay`

**现状：** `ws-agent.ts` 有 `agentSendQueues`，`ws-client.ts` 有 `clientSendQueues`，逻辑几乎一样：

```typescript
const prev = queues.get(id) || Promise.resolve();
queues.set(id, prev.then(() => handler()).catch(() => {}));
```

**目标：** 提取公共 `MessageRelay` 类，两处复用。

**新文件：** `server/src/message-relay.ts`

```typescript
/**
 * 保证同一 ID 的消息按顺序处理。
 * 内部维护 per-ID 的 Promise 链。
 */
export class MessageRelay {
  private queues = new Map<string, Promise<void>>();

  /**
   * 入队一条消息处理任务，保证同 id 串行执行。
   */
  enqueue(id: string, handler: () => Promise<void>): void {
    const prev = this.queues.get(id) || Promise.resolve();
    this.queues.set(id, prev.then(handler).catch(() => {}));
  }

  /**
   * 清理指定 id 的队列（断开连接时调用）。
   */
  cleanup(id: string): void {
    this.queues.delete(id);
  }
}
```

**影响文件：** `ws-agent.ts`、`ws-client.ts` 删除各自的 Map 和手动链式调用，改用 `relay.enqueue(id, handler)`

**测试：** 新增 `test/server/message-relay.test.ts` 测试排序保证 + cleanup

---

### 方向 4：拆分 `index.ts` → `http.ts` + `index.ts`

**现状：** `index.ts` 150 行，混合了：
- Express app 创建和静态文件配置（~40 行）
- HTTP API 路由: `/api/health`, `/api/status`, `/api/session/:sessionId`（~30 行）
- WebSocket server 创建和路由（~15 行）
- 心跳 setInterval（~7 行）
- 启停生命周期（~15 行）

**目标：** 提取 HTTP 路由到 `http.ts`，`index.ts` 只做服务器创建和生命周期。

**新文件：** `server/src/http.ts`

```typescript
import express from 'express';
import { join } from 'path';
import { sessions } from './session-manager.js';

export function createApp(webDir: string, pkg: { version: string }, startedAt: Date): express.Express {
  const app = express();

  // Landing pages
  app.get('/', (_req, res) => res.sendFile(join(webDir, 'landing.html')));
  app.get('/zh', (_req, res) => res.sendFile(join(webDir, 'landing.zh.html')));

  // SPA index.html (no-store)
  const sendIndexHtml = (_req: express.Request, res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(join(webDir, 'index.html'));
  };
  app.get('/index.html', sendIndexHtml);

  // Static assets with cache headers
  app.use(express.static(webDir, { ... }));

  // SPA fallback
  app.get('/s/:sessionId', sendIndexHtml);

  // API routes
  app.get('/api/health', ...);
  app.get('/api/status', ...);
  app.get('/api/session/:sessionId', ...);

  return app;
}
```

**修改后 `index.ts`：** (~50 行)

```typescript
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { createApp } from './http.js';
import { sessions } from './session-manager.js';
import { handleAgentConnection } from './ws-agent.js';
import { handleWebConnection } from './ws-client.js';

const app = createApp(webDir, pkg, startedAt);
const server = createServer(app);
const wss = new WebSocketServer({ server });

// WS routing
wss.on('connection', (ws, req) => { ... });

// Heartbeat
setInterval(() => sessions.cleanupDeadConnections(...), 30_000);

// Listen + lifecycle
server.listen(PORT, () => { ... });
```

**测试：** 无需新增测试（HTTP 路由测试可用 supertest 但不在本次范围）

---

## 文件变更总结

| 操作 | 文件 | 说明 |
|------|------|------|
| **新增** | `server/src/session-manager.ts` | 替代 `context.ts` |
| **新增** | `server/src/auth-manager.ts` | 替代 `auth.ts` |
| **新增** | `server/src/message-relay.ts` | 从 ws-*.ts 提取 |
| **新增** | `server/src/http.ts` | 从 index.ts 提取 |
| **删除** | `server/src/context.ts` | 迁移到 session-manager.ts |
| **删除** | `server/src/auth.ts` | 迁移到 auth-manager.ts |
| **修改** | `server/src/index.ts` | 精简为启停 + WS 路由 |
| **修改** | `server/src/ws-agent.ts` | 使用 SessionManager + MessageRelay |
| **修改** | `server/src/ws-client.ts` | 使用 SessionManager + AuthManager + MessageRelay |
| **修改** | `test/server/context.test.ts` → `session-manager.test.ts` | import 路径更新 |
| **修改** | `test/server/auth.test.ts` | import 路径更新 |
| **修改** | `test/server/heartbeat.test.ts` | import 路径更新 |
| **新增** | `test/server/message-relay.test.ts` | MessageRelay 单元测试 |

**不动：** `cli.ts`, `encryption.ts`, `config.ts`, `service.ts`

## 执行顺序

1. 创建分支 `refactor/server-architecture`
2. 实现 `message-relay.ts`（无依赖，独立模块）
3. 实现 `session-manager.ts`（替代 context.ts）
4. 实现 `auth-manager.ts`（替代 auth.ts，依赖 session-manager）
5. 实现 `http.ts`（从 index.ts 提取）
6. 修改 `ws-agent.ts` — 使用 SessionManager + MessageRelay
7. 修改 `ws-client.ts` — 使用 SessionManager + AuthManager + MessageRelay
8. 修改 `index.ts` — 使用 createApp，精简
9. 删除 `context.ts` 和 `auth.ts`
10. 更新/新增测试
11. 运行 `npm test` + `npm run build` 验证
12. Playwright E2E 验证

## 验证

- `npm run build` 编译通过
- `npm test` 全部通过
- 本地启动 ephemeral server + agent，Playwright 验证：连接、发消息、收回复流
