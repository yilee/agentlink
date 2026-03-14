# Task Notification 导致的"幽灵回复"问题

## 现象

用户让 Claude 重启服务，Claude 回复 URL 后对话轮次结束（按钮状态恢复）。但几秒后，Claude 会突然追加一条新消息，用户没有发任何内容却看到新回复，体验很奇怪。

## 原因

Claude Code 的后台任务（`run_in_background: true`）完成或失败时，系统会注入一条 `task-notification` 消息。这条消息和用户消息一样会触发一轮新的对话，导致 Claude 产生回复。

流程：
1. 用户请求重启服务 → Claude 启动后台 agent 进程 → 回复 URL → **轮次结束**
2. 旧的后台进程被 kill → 系统注入 `task-notification` → 触发新一轮对话 → Claude 回复

用户视角：没发任何消息，突然多了一条回复。

## AgentLink 侧的影响

`task-notification` 从 Claude Code 的 stdout 输出，经过 AgentLink 的 `processOutput` → consumer loop → `handleAssistantMessage` → 发送 `claude_output` 到 Web UI。Web UI 显示为一条新的 assistant 消息。

## 可能的修复方案

### 方案 1：Agent 端过滤（推荐）

在 `agent/src/claude.ts` 的 consumer loop 中，检测 Claude 对 `task-notification` 的回复。可以通过以下方式识别：
- 跟踪 `user` 消息内容，如果包含 `<task-notification>` 标签，标记该轮次为"静默轮次"
- 静默轮次的 assistant 输出不转发到 Web UI

难点：`task-notification` 是 Claude Code 内部机制，AgentLink 无法控制其格式，依赖标签检测可能不够稳定。

### 方案 2：UI 端合并/隐藏

在 Web UI 的 `handleClaudeOutput` 中，如果上一轮刚结束（比如 500ms 内），且新的 assistant 消息内容较短、没有用户主动发送的消息，将其合并到上一条回复或隐藏。

难点：判断条件不够精确，可能误隐藏正常回复。

### 方案 3：不使用 run_in_background

启动 agent 进程时不用 `run_in_background`，改用 `timeout` 等待初始输出后直接返回。这样就不会有延迟的 `task-notification`。

难点：这只是规避问题，不是真正的修复。且有些场景确实需要后台任务。

### 方案 4：标记后台任务的输出

在 `claude_output` 消息中增加一个字段（如 `isBackgroundTaskResponse: true`），UI 端收到后可以选择静默处理（比如只在控制台打印，不追加到聊天列表）。

需要在 agent 端识别哪些 Claude 回复是由 `task-notification` 触发的。
