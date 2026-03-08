# AgentLink

[![CI](https://github.com/yilee/agentlink/actions/workflows/ci.yml/badge.svg)](https://github.com/yilee/agentlink/actions/workflows/ci.yml)
[![npm server](https://img.shields.io/npm/v/@agent-link/server?label=server)](https://www.npmjs.com/package/@agent-link/server)
[![npm agent](https://img.shields.io/npm/v/@agent-link/agent?label=agent)](https://www.npmjs.com/package/@agent-link/agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](./README.md) | 中文

在任何设备上远程访问你本地的 Claude Code —— 只需一个链接。

AgentLink 在你的开发机器上运行一个轻量级客户端，通过云端中继服务器，让你可以在手机、平板或任何浏览器上以 `https://msclaude.ai/xxxx` 的形式与 Claude 对话。所有代码执行都在本地完成，中继服务器只转发加密消息。

```
浏览器（任意设备）  ←→  云端中继  ←→  本地 Agent  ←→  你的代码库
```

## 快速开始

```bash
# 安装
npm install -g @agent-link/agent

# 启动（会打印一个会话链接）
agentlink-client start --daemon

# 在任意浏览器中打开链接，开始使用
```

## 为什么选择 AgentLink？

- **随时随地访问** —— 手机、平板、另一台电脑，打开链接即可使用，无需任何额外配置。
- **代码不离本地** —— 文件始终留在你的机器上，中继服务器只转发端到端加密后的消息。
- **零配置浏览器端** —— 不需要浏览器插件、本地服务器或端口转发，一个链接搞定一切。
- **会话历史** —— 支持恢复之前的对话，直接读取 Claude 本地的会话记录。
- **实时流式输出** —— 工具调用、Markdown、代码块，Claude 工作时实时渲染。
- **端到端加密** —— 所有 WebSocket 通信使用 XSalsa20-Poly1305 (TweetNaCl) 加密。

## 功能一览

- 深色/浅色主题切换，自动记忆偏好
- 文件上传（拖拽、粘贴、按钮）
- Claude 交互式提问卡片（AskUserQuestion）
- 会话历史按时间分组（今天 / 昨天 / 本周 / 更早）
- 工作目录历史记录，快速切换
- 在浏览器中切换工作目录（文件夹选择器）
- 上下文压缩状态显示
- 命令输出渲染（`/cost`、`/help` 等）
- 密码保护（`--password` 参数）
- 移动端适配（手机和平板优化）
- 守护进程模式下自动更新（`--no-auto-update` 可关闭）
- 开机自启（`service install` —— 支持 systemd / launchd / Windows 启动项）
- 原地升级（`agentlink-client upgrade`）
- Markdown 实时预览工具（`tools/markdown-preview.html` —— 分栏实时预览，代码语法高亮）

## 工作原理

1. `agentlink-client start` 通过 WebSocket 连接到中继服务器
2. 服务器分配一个唯一的会话链接（96 位随机 ID）
3. 你在浏览器中打开链接，浏览器也连接到同一个中继
4. 消息流向：浏览器 → 中继 → Agent → Claude CLI → Agent → 中继 → 浏览器
5. Claude 以 `bypassPermissions` 模式运行，可以自主完成各类操作
6. Agent↔中继、浏览器↔中继之间的所有消息均使用会话密钥加密

## 常用命令

```bash
# Agent 客户端
agentlink-client start [--daemon] [--server URL] [--name NAME] [--dir PATH] [--password PWD]
agentlink-client stop
agentlink-client status
agentlink-client config list|get|set
agentlink-client service install|uninstall
agentlink-client upgrade

# 自建中继服务器
agentlink-server start [--daemon] [--port PORT]
agentlink-server stop
agentlink-server status
```

## 自建服务器

你可以运行自己的中继服务器，不依赖公共服务：

```bash
npm install -g @agent-link/server
agentlink-server start --daemon --port 3456

# 让 Agent 连接到你自己的服务器
agentlink-client start --daemon --server ws://your-server:3456
```

## 环境要求

- Node.js 18+
- 已安装并认证 Claude CLI（`claude` 命令可用）

## 技术架构

| 组件 | 技术栈 |
|------|--------|
| Agent 客户端 | TypeScript, Commander.js, `ws` |
| 中继服务器 | Express, `ws`, 静态文件服务 |
| Web 界面 | Vue 3（浏览器 ES 模块）, marked.js, highlight.js |
| 加密 | TweetNaCl (XSalsa20-Poly1305 secretbox) |

## 相关链接

- [npm: @agent-link/agent](https://www.npmjs.com/package/@agent-link/agent)
- [npm: @agent-link/server](https://www.npmjs.com/package/@agent-link/server)
- [GitHub](https://github.com/yilee/agentlink)

## 开源协议

MIT
