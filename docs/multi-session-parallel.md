# 多会话并行执行 — 技术方案

## 问题

当前架构是单会话模型：`claude.ts` 持有唯一的 `conversation: ConversationState | null`。每次切换会话或开始新对话时，都会 `abort()` 杀掉正在运行的 Claude 进程。用户无法在一个 session 处理中切换到另一个 session 继续工作。

## 目标

允许多个 Claude 进程同时运行。用户可以在 sidebar 中自由切换会话（新建、resume 历史），不影响其他正在执行的会话。每个会话拥有独立的消息列表、processing 状态、streaming 动画。

## 核心概念

- **conversationId**：Web 端生成的 UUID，标识一个"前端会话"。每次 new conversation 或 resume session 时生成。
- **claudeSessionId**：Claude CLI 内部的 session ID（来自 `--resume`），用于在 Claude 的 JSONL 文件中恢复上下文。
- 两者是一对一映射关系，但生命周期不同：`conversationId` 在 Web 端创建，`claudeSessionId` 由 Claude 进程分配。

## 设计决策

1. **Server 不需要改动**：服务端是透明中继，`conversationId` 字段会原样转发。
2. **Agent 端 singleton → Map**：`claude.ts` 从单个 `conversation` 变为 `Map<string, ConversationState>`，每个 conversation 独立管理自己的子进程。
3. **Web 端 save/restore 模式**：前端保持现有 refs 作为"当前可见视图"，通过 `conversationCache` Map 在切换时保存/恢复状态。只有当前可见的 conversation 执行 streaming 动画。
4. **并发上限**：最多 5 个 Claude 进程同时运行。超出时驱逐最早的空闲会话。
5. **向后兼容**：`conversationId` 在所有消息中是可选字段。旧版 Web + 新版 Agent 仍按单会话模式运行。
6. **切换 workDir 不终止已有会话**：每个 conversation 持有自己的 `workDir`。切换工作目录只影响后续新建的 conversation，已经在运行的 Claude 进程继续在原目录工作。

---

## Agent 改动

### claude.ts — 核心重构

#### 状态：singleton → Map

```
// 当前
let conversation: ConversationState | null = null;
let lastClaudeSessionId: string | null = null;
let isCompacting = false;

// 改为
const conversations = new Map<string, ConversationState>();
// lastClaudeSessionId 和 isCompacting 移入 ConversationState
```

#### ConversationState 增加字段

```typescript
interface ConversationState {
  // 现有
  child: ChildProcess | null;
  inputStream: Stream<ClaudeMessage> | null;
  abortController: AbortController | null;
  claudeSessionId: string | null;
  workDir: string;
  turnActive: boolean;
  turnResultReceived: boolean;
  // 新增
  conversationId: string;
  lastClaudeSessionId: string | null;  // 从模块级变量移入
  isCompacting: boolean;               // 从模块级变量移入
  createdAt: number;                   // 用于驱逐最早空闲会话
}
```

#### API 变化

| 现有签名 | 新签名 |
|----------|--------|
| `handleChat(prompt, workDir, resumeSessionId?, files?)` | `handleChat(conversationId, prompt, workDir, resumeSessionId?, files?)` |
| `cancelExecution()` | `cancelExecution(conversationId)` |
| `abort()` | `abort(conversationId?)` — 无参数 = abort all |
| `getConversation()` | `getConversation(conversationId)` |
| `getIsCompacting()` | `getIsCompacting(conversationId)` |
| `clearSessionId()` | `clearSessionId(conversationId?)` — 无参数 = 全部清除 |

#### handleChat() 行为变化

当前：如果 `conversation` 存在且无 `inputStream`，调用 `startQuery()`；否则直接 enqueue。

改为：
1. 查找 `conversations.get(conversationId)`
2. 如果找不到或该 conversation 的 `inputStream` 为空，调用 `startQuery(conversationId, ...)`
3. **不再 abort 其他 conversation**

#### startQuery() 行为变化

当前：调用 `abort()` 杀掉唯一的 conversation，然后 spawn 新进程。

改为：
1. 只 abort 同一个 `conversationId` 对应的 conversation（如果存在）
2. Spawn 新 Claude 进程，`conversations.set(conversationId, state)`
3. 检查 `conversations.size`，如果超过 `MAX_CONVERSATIONS = 5`，驱逐最早的空闲会话（`turnActive === false` 且 `createdAt` 最小的）

#### processOutput() 变化

所有 `sendFn(...)` 调用加上 `conversationId`：

```typescript
sendFn({ type: 'claude_output', conversationId: state.conversationId, data: {...} });
sendFn({ type: 'turn_completed', conversationId: state.conversationId });
sendFn({ type: 'error', conversationId: state.conversationId, message: '...' });
sendFn({ type: 'context_compaction', conversationId: state.conversationId, status: '...' });
sendFn({ type: 'command_output', conversationId: state.conversationId, content: '...' });
```

#### cleanup() → cleanupConversation(conv)

改为只清理指定 conversation 的状态：
- 只删除属于该 conversation 的 pending control requests
- 从 `conversations` Map 中删除
- 不影响其他 conversation

#### 新增导出

- `abortAll()` — 中断所有 conversation（仅 agent 进程退出时使用）

#### pendingControlRequests 隔离

AskUserQuestion 请求目前存在全局 `pendingControlRequests` Map 中。由于 `request_id` 全局唯一，无需改结构。但 `cleanupConversation()` 需要只清理属于该 conversation 的请求——在 `PendingControlRequest` 中加一个 `conversationId` 字段来过滤。

### connection.ts — 路由 conversationId

#### handleServerMessage() 提取 conversationId

```typescript
case 'chat':
  claudeHandleChat(
    m.conversationId,   // 新参数
    m.prompt,
    state.workDir,      // 当前 workDir，每个 conversation spawn 时记录
    m.resumeSessionId,
    m.files,
  );
  break;
case 'cancel_execution':
  claudeCancelExecution(m.conversationId);
  break;
case 'resume_conversation':
  // 不再 abort 其他 conversation
  // 只检查该 claudeSessionId 是否已有活跃进程
  break;
```

#### handleChangeWorkDir() — 不终止已有会话

当前行为：`abortClaude()` + `clearSessionId()` + 更新 `state.workDir`。

改为：**只更新 `state.workDir`**，不终止任何正在运行的 conversation。

```typescript
function handleChangeWorkDir(msg: { workDir: string }): void {
  const newDir = msg.workDir;
  if (!existsSync(newDir)) {
    send({ type: 'error', message: `Directory does not exist: ${newDir}` });
    return;
  }

  // 只更新 agent 的当前 workDir，已有 conversation 不受影响
  // 因为每个 conversation 在 spawn 时已经记录了自己的 workDir (cwd)
  state.workDir = newDir;
  console.log(`[AgentLink] Working directory changed to: ${newDir}`);

  send({ type: 'workdir_changed', workDir: newDir });
  handleListSessions();
}
```

这是安全的，因为：
- 每个 Claude 进程在 spawn 时已经通过 `cwd: workDir` 绑定了工作目录
- `ConversationState.workDir` 记录着该 conversation 使用的目录
- 改变 `state.workDir` 只影响后续新 conversation 的 `cwd` 参数
- 已有进程的文件操作、git 命令不受影响

#### disconnect() 与 WebSocket 断开 — 不终止 Claude

当前行为：`disconnect()` 调用 `abortClaude()`，杀掉 Claude 进程。但 `disconnect()` 只在 agent 进程主动退出时调用（SIGINT/SIGTERM → `index.ts` 的 `shutdown()`）。WebSocket 断开（网络中断）走的是 `ws.on('close')` → `scheduleReconnect()`，不调 `abort()`——Claude 继续运行。

多会话并行后，这个行为保持不变：

| 场景 | 行为 |
|------|------|
| Agent 进程退出（SIGINT/SIGTERM/`agentlink stop`）| `abortAll()` 终止所有 conversation |
| WebSocket 网络断开 | 不终止 Claude，agent 自动重连，重连后继续转发输出 |
| Web client 关闭浏览器 | 不影响 agent 端，Claude 继续运行。Web client 重新打开 URL 后可以看到后续输出（输出会持续写入 Claude 的 JSONL，resume 时可加载） |

**关键点**：Web client 断开不等于 agent 断开。Server 只是中继——web client 关闭后，server 通知 agent `web_disconnected`（如果有这个消息的话），但 agent 端 Claude 不应因此停止。

Claude 产生的输出在 web 断开期间会：
1. 调用 `sendFn()` → `send()` → 检查 `ws.readyState`，如果 WebSocket 仍连着 server 则正常发送（server 侧 web client 不在只是发不到前端）
2. Claude 的输出同时写入 `~/.claude/projects/.../<sessionId>.jsonl`
3. Web client 重新打开后，resume 该 session 即可从 JSONL 加载完整历史

---

## Server 改动

**无。** 服务端是透明中继，已有代码会原样转发消息中的 `conversationId` 字段。

---

## Web UI 改动

### app.js — 会话状态管理

#### 新增 reactive 状态

```javascript
const conversationCache = ref({});         // conversationId → 保存的状态快照
const currentConversationId = ref(null);   // 当前前台的 conversationId
const processingConversations = ref({});   // conversationId → boolean，sidebar 指示器用
```

#### switchConversation(newConvId)

核心切换函数，在 new conversation / resume session / 点击 sidebar session 时调用：

1. **保存当前状态**到 `conversationCache[oldConvId]`：
   - `messages` 数组（深拷贝 `.value`）
   - `isProcessing`
   - `isCompacting`
   - `currentClaudeSessionId`
   - `visibleLimit`
   - `needsResume`
   - streaming 状态（通过 `streaming.saveState()`）
   - connection 模块的 `toolMsgMap`（通过 `getToolMsgMap()`）

2. **加载目标状态**：
   - 如果 `conversationCache[newConvId]` 存在 → 恢复所有保存的状态
   - 如果不存在 → 初始化为空白会话

3. 设置 `currentConversationId = newConvId`

#### sendMessage() 带上 conversationId

```javascript
wsSend({
  type: 'chat',
  conversationId: currentConversationId.value,
  prompt: text,
  ...
});
```

#### cancelExecution() 带上 conversationId

```javascript
wsSend({
  type: 'cancel_execution',
  conversationId: currentConversationId.value,
});
```

### modules/connection.js — 按 conversationId 路由

收到 agent 消息时：

```javascript
if (msg.conversationId && msg.conversationId !== currentConversationId.value) {
  // 消息不属于当前前台会话 → 路由到后台缓存
  routeToBackgroundConversation(msg.conversationId, msg);
  return;
}
// 否则走现有逻辑（更新 messages、streaming 等）
```

#### routeToBackgroundConversation(convId, msg)

直接更新 `conversationCache[convId]` 中保存的 messages 数组，不执行 streaming 动画：
- `claude_output` + `content_block_delta` → 追加文本到最后一条 assistant 消息（或创建新的）
- `claude_output` + `tool_use` → 追加 tool 消息
- `turn_completed` → 设置 `isProcessing = false`
- `execution_cancelled` → 设置 `isProcessing = false`
- `context_compaction` → 更新 `isCompacting`
- `error` → 追加 error 系统消息
- `command_output` → 追加 command output 系统消息

#### 更新 processingConversations

- 发送 `chat` 消息时：`processingConversations[convId] = true`
- 收到 `turn_completed` / `execution_cancelled`：`processingConversations[convId] = false`

#### workdir_changed 处理不再清空后台会话

当前 `workdir_changed` handler 清空所有 messages、reset streaming 等。改为：
- **只清空当前前台会话的 UI 状态**（messages、streaming、visibleLimit）
- **不动后台会话的 cache**——后台正在运行的 conversation 继续接收输出
- 更新 `workDir` ref
- 刷新 session 列表

```javascript
} else if (msg.type === 'workdir_changed') {
  workDir.value = msg.workDir;
  localStorage.setItem(`agentlink-workdir-${sessionId.value}`, msg.workDir);
  sidebar.addToWorkdirHistory(msg.workDir);

  // 当前前台切换到新的空白会话
  const newConvId = crypto.randomUUID();
  switchConversation(newConvId);
  messages.value.push({
    id: streaming.nextId(), role: 'system',
    content: 'Working directory changed to: ' + msg.workDir,
    timestamp: new Date(),
  });

  sidebar.requestSessionList();
}
```

#### 新增暴露

- `getToolMsgMap()` — 返回当前 toolMsgMap（conversation switch 时保存用）
- `restoreToolMsgMap(map)` — 恢复 toolMsgMap（conversation switch 时恢复用）
- `clearToolMsgMap()` — 清空 toolMsgMap（new conversation 时用）

### modules/sidebar.js — 会话管理

#### resumeSession(session)

```javascript
function resumeSession(session) {
  // 检查是否已有 conversation 加载了这个 claudeSessionId → 直接切过去
  for (const [convId, cached] of Object.entries(conversationCache.value)) {
    if (cached.claudeSessionId === session.sessionId) {
      switchConversation(convId);
      return;
    }
  }
  // 也检查当前前台会话
  if (currentClaudeSessionId.value === session.sessionId) {
    return; // 已经在看这个 session
  }
  // 否则创建新的 conversationId，切换过去，发送 resume
  const newConvId = crypto.randomUUID();
  switchConversation(newConvId);
  wsSend({
    type: 'resume_conversation',
    conversationId: newConvId,
    claudeSessionId: session.sessionId,
  });
}
```

移除 `if (isProcessing.value) return` 限制。

#### newConversation()

```javascript
function newConversation() {
  const newConvId = crypto.randomUUID();
  switchConversation(newConvId);
  // 不再受 isProcessing 限制
}
```

移除 `if (isProcessing.value) return` 限制。

同时移除 `deleteSession()`、`startRename()`、`switchToWorkdir()` 中的 `if (isProcessing.value) return` 限制——多会话并行后，有一个 session 在 processing 不应阻止这些操作。

#### isSessionProcessing(claudeSessionId)

sidebar 用于显示哪些 session 正在处理：

```javascript
function isSessionProcessing(claudeSessionId) {
  for (const [convId, cached] of Object.entries(conversationCache.value)) {
    if (cached.claudeSessionId === claudeSessionId && cached.isProcessing) {
      return true;
    }
  }
  // 也检查当前前台会话
  if (currentClaudeSessionId.value === claudeSessionId && isProcessing.value) {
    return true;
  }
  return false;
}
```

### modules/streaming.js — 状态保存/恢复

新增两个方法，用于 conversation switch 时保存和恢复 streaming 内部状态：

```javascript
function saveState() {
  flushReveal(); // 先把 pending text 冲刷到 message 里
  return {
    pendingText: '',  // flush 后为空
    streamingMessageId,
    messageIdCounter,
  };
}

function restoreState(saved) {
  flushReveal();  // 清空当前 pending
  pendingText = saved.pendingText || '';
  streamingMessageId = saved.streamingMessageId ?? null;
  messageIdCounter = saved.messageIdCounter || 0;
  if (pendingText) startReveal();
}
```

### style.css — 处理中指示器

sidebar 中正在处理的 session 旁显示脉冲小圆点：

```css
.session-item.processing .session-title::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  margin-right: 6px;
  animation: pulse-dot 1.5s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

---

## 向后兼容

- `conversationId` 在所有消息中为可选字段
- Agent 端：消息中无 `conversationId` → 回退到单会话行为（使用固定 key 如 `'default'`）
- Web 端：响应消息中无 `conversationId` → 路由到当前前台会话
- 旧版 Web + 新版 Agent = 正常工作（单会话模式，与目前行为一致）

---

## 实现步骤

| 步骤 | 文件 | 改动内容 |
|------|------|---------|
| 1 | `agent/src/claude.ts` | 核心重构：conversations Map，输出消息带 conversationId |
| 2 | `agent/src/connection.ts` | 提取并传递 conversationId，disconnect 时 abortAll，workdir 只更新 state 不终止会话 |
| 3 | `server/web/app.js` | conversationCache、currentConversationId、switchConversation、发送消息带 conversationId |
| 4 | `server/web/modules/connection.js` | 按 conversationId 路由、后台 conversation 处理逻辑、workdir_changed 不清空后台会话 |
| 5 | `server/web/modules/sidebar.js` | 生成 conversationId、移除 isProcessing 限制、isSessionProcessing |
| 6 | `server/web/modules/streaming.js` | saveState / restoreState |
| 7 | `server/web/style.css` | session processing 脉冲指示器 |

---

## 验证

1. `npm run build` 通过
2. `npm test` 通过
3. 手动测试：
   - 启动 ephemeral server + agent
   - 打开 web UI，发一条消息（会话 A 开始处理）
   - 在 A 处理中点击 "New conversation" → sidebar 中 A 旁边出现脉冲圆点
   - 在会话 B 中发消息 → A 和 B 同时在运行
   - 切换回 A → 看到 A 在后台积累的输出
   - 验证 cancel 只取消当前 conversation
   - 切换 workdir → 前台切到新空白会话，后台正在运行的 A 和 B 不受影响，继续接收输出
   - 切换回旧 workdir 的 session 列表中的 A → 看到 A 的完整输出
   - 关闭浏览器，等 Claude 完成后重新打开 URL → resume session 能看到完整历史
   - `agentlink stop` → 所有 Claude 进程终止

---

## 后续：Sidebar 多 workDir 展示（暂不实现）

多会话并行后，不同 conversation 可能运行在不同 workDir 下。当前 sidebar 的 session 列表按当前 workDir 过滤，切换 workDir 后看不到旧目录的活跃会话。

**方案：活跃会话区 + 历史区 分开**

Sidebar 分两个区域：

```
┌─────────────────────┐
│ ● Active (2)        │  ← 所有正在运行/有缓存的 conversation，不分目录
│  ├─ "Fix login bug" │     小字: Q:\src\app
│  │   ● processing   │
│  └─ "Add tests"     │     小字: Q:\src\lib
│     ✓ idle          │
├─────────────────────┤
│ History             │  ← 当前 workDir 的历史 session（来自 JSONL）
│  Today              │
│   ├─ session1       │
│   └─ session2       │
│  Yesterday          │
│   └─ session3       │
└─────────────────────┘
```

- **Active 区**：来自 `conversationCache`，始终可见，不受 workDir 切换影响。每个条目显示标题（第一条用户消息截断）+ 小字 workDir。有脉冲圆点表示 processing。点击切换到该 conversation。
- **History 区**：保持现有逻辑，来自 `list_sessions`，按当前 workDir 过滤，分 Today/Yesterday/This week/Earlier 分组。
