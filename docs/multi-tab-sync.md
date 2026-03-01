# Multi-Tab Synchronization — 技术方案

## 问题

多个浏览器标签页连到同一个 session，服务端已经会广播消息给所有 web client，但没有协调机制——两个标签页可能同时发 `chat`，或者一个标签页在处理中另一个不知道。

## 实现思路

### 1. 服务端维护每个 session 的 web client 列表

`context.ts` 里 `webClients` Map 已经按 sessionId 存了，但目前只存一个。改为存数组（或 Set），支持同一 session 多个 client 并存。

### 2. 状态广播

当任意一个 client 发起操作（发消息、取消执行、切换目录等），服务端在转发给 agent 的同时，也广播一条状态同步消息给**同 session 的其他 web client**：

```
{ type: 'state_sync', isProcessing: true, initiatedBy: clientId }
```

### 3. 输入锁定

其他标签页收到 `state_sync` 后，禁用输入框或显示"另一个标签页正在操作"的提示。`turn_completed` 时广播解锁。

### 4. 消息同步

让后打开的标签页能看到之前的消息，两种方案：

- **方案 A（简单）：** 新 client 连接时，服务端发送当前会话的消息历史（从 agent 侧取或服务端缓存最近 N 条）
- **方案 B（轻量）：** 不同步历史，只同步连接后的新消息（当前已经是这样），新标签页显示"从此刻开始"的提示

### 5. Client ID

每个 web client 连接时分配一个短 ID（已有 sessionKey 区分），用于区分"是自己发的还是别人发的"。

## 总结

本质上就是把单播改广播，加一个轻量的状态协调层。不需要大改架构，主要改服务端的 client 管理（单个 → 数组）+ 广播逻辑。
