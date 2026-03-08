# Web Terminal Design

## Overview

在 sidebar 的 Working Directory 路径弹出菜单中增加"Open Terminal"选项，点击后在主界面打开一个终端面板，用户可以在其中执行常规终端命令，命令在 agent 所在主机上执行。

## User Flow

1. 用户点击 sidebar 中 Working Directory 的路径行 → 弹出菜单
2. 菜单中新增 "Open Terminal" 选项
3. 点击后：
   - sidebar 自动关闭（mobile）
   - 主界面底部弹出一个终端面板（类似 VS Code 的集成终端）
   - 终端默认 cwd 为当前 workDir
4. 用户在终端中输入命令 → 回车 → 在 agent 主机上执行 → 输出实时流式回显
5. 终端面板可以关闭/最小化，也可以通过菜单再次打开

## Architecture

### Agent Side (agent/src/)

**新增 `terminal.ts` 模块：**

- `spawnTerminal(workDir)` — 使用 `node-pty`（或降级方案 `child_process.spawn` with shell）创建一个持久化的 shell 进程
  - Windows: `powershell.exe` or `cmd.exe`
  - macOS/Linux: `$SHELL` or `/bin/bash`
- 维护一个 `Map<string, TerminalSession>` 支持多终端（v1 先支持单终端）
- 输入：Web → Agent 发来的 `terminal_input` 消息 → 写入 shell stdin
- 输出：shell stdout/stderr → 通过 ws 发送 `terminal_output` 给 Web
- 终端 resize：Web 发 `terminal_resize` → pty resize

**降级方案（不用 node-pty）：**

由于 `node-pty` 是 native module，需要编译，可能对跨平台部署造成麻烦。降级方案：

- **方案 A: node-pty (推荐)** — 完整的 PTY 支持，支持交互式程序（vim, top 等），支持颜色/光标控制
- **方案 B: child_process.spawn with shell** — 无 PTY，只支持简单命令执行，不支持交互式程序，但零依赖

建议 v1 先用**方案 B**（逐条命令执行），简单可靠：
- 每次用户输入一条命令 → `spawn(shell, ['-c', command], { cwd })`
- 收集 stdout/stderr → 流式发送给 Web
- 命令结束 → 发送 exit code
- 不维护持久 shell（无状态，每条命令独立执行）

v2 再考虑引入 node-pty 做完整 PTY 终端。

### WebSocket Protocol

**新增消息类型：**

| Direction | Type | Fields | Purpose |
|-----------|------|--------|---------|
| Web → Agent | `terminal_execute` | `command`, `terminalId?` | 执行一条命令 |
| Web → Agent | `terminal_kill` | `terminalId?` | 终止当前正在运行的命令 |
| Agent → Web | `terminal_output` | `terminalId?`, `data`, `stream` (`stdout`/`stderr`) | 流式输出 |
| Agent → Web | `terminal_exit` | `terminalId?`, `exitCode` | 命令执行结束 |
| Agent → Web | `terminal_error` | `terminalId?`, `message` | 错误（如 spawn 失败） |

### Web UI (server/web/)

**新增 `modules/terminal.js` 模块：**

```js
export function createTerminal(deps) {
  // deps: wsSend, workDir, terminalOpen, terminalHistory, terminalInput, terminalRunning

  return {
    openTerminal(),     // 打开终端面板
    closeTerminal(),    // 关闭终端面板
    toggleTerminal(),   // 切换
    executeCommand(),   // 发送命令
    killCommand(),      // 终止命令
    handleOutput(msg),  // 处理 terminal_output
    handleExit(msg),    // 处理 terminal_exit
  };
}
```

**UI 设计：**

终端面板位于主界面底部，可拖拽调整高度（类似 file panel 的 resize）。

```
┌─────────────────────────────────────┐
│  Top Bar                            │
├──────┬──────────────────────────────┤
│      │                              │
│ Side │   Chat Messages Area         │
│ bar  │                              │
│      │                              │
│      ├──────────────────────────────┤
│      │ ▼ Terminal          [×]      │
│      │ $ ls -la                     │
│      │ total 48                     │
│      │ drwxr-xr-x  5 user ...      │
│      │ $ _                          │
│      ├──────────────────────────────┤
│      │  [input box]  [Send][Cancel] │
└──────┴──────────────────────────────┘
```

**终端面板内容：**
- 输出区域：滚动显示历史命令和输出（类似终端 scrollback）
- 输入行：底部输入框 + 执行按钮
- stdout 用白色/默认色，stderr 用红色/warning 色
- 命令执行中显示 spinner + Kill 按钮
- 退出码非零时高亮显示

**Reactive State (app.js)：**

```js
const terminalOpen = ref(false);
const terminalHistory = ref([]);     // [{ type: 'command'|'stdout'|'stderr'|'exit', content, exitCode? }]
const terminalInput = ref('');
const terminalRunning = ref(false);
const terminalPanelHeight = ref(200);
```

### Connection Routing

在 `connection.js` 的 `ws.onmessage` 中添加：
```js
} else if (msg.type === 'terminal_output') {
  terminal.handleOutput(msg);
} else if (msg.type === 'terminal_exit') {
  terminal.handleExit(msg);
} else if (msg.type === 'terminal_error') {
  terminal.handleError(msg);
}
```

在 `agent/src/connection.ts` 的 `handleServerMessage` 中添加：
```js
case 'terminal_execute':
  handleTerminalExecute(msg);
  break;
case 'terminal_kill':
  handleTerminalKill();
  break;
```

### Workdir Menu Integration

在 `app.js` 的 workdir 菜单 template 中，在 "Copy path" 之后添加：

```html
<div class="workdir-menu-item" @click.stop="workdirMenuOpenTerminal()">
  <svg ...terminal icon...></svg>
  <span>Open terminal</span>
</div>
```

## Security Considerations

- 终端命令直接在 agent 主机上执行，与 Claude 的 Bash tool 权限相当
- 已有 session auth (password) 机制保护 WebSocket 连接
- 不需要额外的权限控制（agent 已经具有完全的主机访问权限）

## Implementation Plan

1. Agent: 新增 `terminal.ts` 模块（方案 B: 逐条命令执行）
2. Agent: `connection.ts` 添加 `terminal_execute` / `terminal_kill` 消息处理
3. Web: 新增 `modules/terminal.js` 模块
4. Web: `app.js` 添加 terminal reactive state + template
5. Web: `connection.js` 添加 terminal 消息路由
6. Web: `style.css` 添加终端面板样式
7. Web: workdir 菜单添加 "Open Terminal" 入口

## Future Enhancements (v2)

- node-pty 集成：完整 PTY 支持，交互式程序
- xterm.js 前端：真正的终端模拟器（颜色、光标定位、滚动等）
- 多终端 tab 支持
- 命令历史（上下箭头）
- workDir 变更时自动切换终端 cwd
