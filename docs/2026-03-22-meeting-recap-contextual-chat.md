# Meeting Recap Contextual Chat

> **Date:** 2026-03-22
> **Status:** Draft
> **Depends on:** Meeting Recap Feed (2026-03-21), Multi-Session Parallel, Session Metadata

## Overview

在 RecapDetail 详情页中添加 "Ask about this meeting" 聊天功能。用户可以在查看会议纪要的同时，针对会议内容进行对话（提问、总结、深入探讨等）。

### 核心需求

1. RecapDetail 页面分两部分：上方详情内容 + 下方聊天区域
2. 点击 "Ask about this meeting" 启动新聊天，首条消息注入会议上下文
3. 完整聊天能力：消息渲染、工具调用、流式输出、取消等，与普通聊天窗口一致
4. 会话持久化：退出再进入同一个 recap 时恢复历史聊天
5. 最大化复用现有聊天组件（消息渲染、输入框等）
6. 未来在 Feed sidebar 显示所有 recap chat history

---

## Architecture

### 设计原则：Recap Chat = 普通对话 + 会议上下文

核心思路：每个 recap chat 就是一个独立的 conversation（与普通多会话并行完全一致），唯一区别是首条消息包含会议上下文。不引入新的 WebSocket 消息类型，不修改 agent 消息处理主逻辑。

```
┌─────────────────────────────────────────────────────┐
│  RecapDetail (recap-detail view)                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  Detail Content (collapsible)                 │  │
│  │  - Header, For You, TL;DR, Hook Sections      │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  ─── Ask about this meeting ────────────────  │  │  ← divider
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Chat Message List (reuses message rendering) │  │  ← 复用 ChatView 消息渲染
│  │  - user, assistant, tool, system roles         │  │
│  └───────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────┐  │
│  │  Chat Input (reuses ChatInput pattern)        │  │  ← 复用输入框
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 数据流

```
User types question in RecapDetail
  → recap.sendRecapChat(text)
    → builds payload { type: 'chat', conversationId: 'recap-chat-{recapId}', prompt, brainMode: true }
    → first message: prompt = meetingContext + "\n---\n" + userQuestion
    → wsSend(payload)
  → Agent receives chat with conversationId
    → handleChat() starts new Claude process (or reuses existing)
    → Claude streams output → claude_output with matching conversationId
  → Web receives claude_output
    → routes to correct conversation via conversationId
    → updates recap chat messages array
    → RecapDetail re-renders chat section
```

---

## Implementation Plan

### Phase 1: Session Metadata 扩展

**文件:** `agent/src/session-metadata.ts`

扩展 `SessionMetadata` 接口，新增 `recapId` 字段：

```typescript
export interface SessionMetadata {
  brainMode?: boolean;
  recapId?: string;       // 关联的 recap ID，用于持久化映射
}
```

**写入时机:** 当 recap chat 的 Claude session 启动时（收到 `session_started`），agent 端调用 `saveSessionMetadata(claudeSessionId, { recapId, brainMode: true })`。

**读取时机:** `handleListSessions()` 已经通过 `loadAllSessionMetadata()` 把全部 metadata merge 到 session 列表，web 端直接能拿到 `recapId` 字段。

变更范围：
| 文件 | 改动 |
|------|------|
| `agent/src/session-metadata.ts` | `SessionMetadata` 加 `recapId?: string` |
| `agent/src/connection.ts` | chat handler：如果 payload 带 `recapId`，在 session_started 时 save 到 metadata |

### Phase 2: Web 端 recap.js 扩展聊天状态

**文件:** `server/web/src/modules/recap.js`

现有的 `chatMessages` ref 已预留但未使用。扩展 `createRecap()` 添加聊天管理：

```javascript
export function createRecap({ wsSend, switchConversation, conversationCache, messages,
                              isProcessing, currentConversationId, streaming }) {
  // ... existing state ...

  // ── Recap Chat State ──
  const recapChatSessionMap = ref({});   // { [recapId]: claudeSessionId } — 从 sessions_list 构建
  const recapChatActive = ref(false);    // 当前 recap 是否有聊天进行中

  // 切换到 recap chat 的 conversation
  function enterRecapChat(recapId) {
    const convId = `recap-chat-${recapId}`;
    switchConversation(convId);
    recapChatActive.value = true;
  }

  // 退出 recap chat，恢复之前的 conversation
  function exitRecapChat(previousConvId) {
    switchConversation(previousConvId);
    recapChatActive.value = false;
  }

  // 发送 recap chat 消息
  function sendRecapChat(text, recapId, detail) {
    const convId = `recap-chat-${recapId}`;
    const isFirstMessage = !conversationCache.value[convId]
      || conversationCache.value[convId].messages.length === 0;

    let prompt = text;
    if (isFirstMessage) {
      prompt = buildMeetingContext(detail) + '\n---\n' + text;
    }

    wsSend({
      type: 'chat',
      conversationId: convId,
      prompt,
      brainMode: true,
      recapId,                // agent 用于 session metadata 关联
    });
  }

  // 从 sessions_list 中提取 recap chat sessions
  function updateRecapChatSessions(sessions) {
    const map = {};
    for (const s of sessions) {
      if (s.recapId) {
        map[s.recapId] = s.sessionId;
      }
    }
    recapChatSessionMap.value = map;
  }

  return {
    // ... existing returns ...
    recapChatActive, recapChatSessionMap,
    enterRecapChat, exitRecapChat, sendRecapChat,
    updateRecapChatSessions,
  };
}
```

**变更范围:**
| 文件 | 改动 |
|------|------|
| `server/web/src/modules/recap.js` | 添加聊天状态管理、context builder、session map |

### Phase 3: 构建会议上下文 (Context Builder)

**文件:** `server/web/src/modules/recap.js`

首条消息发送时，自动拼接会议上下文，让 Claude 了解会议背景：

```javascript
function buildMeetingContext(sidecarDetail) {
  const { meta, detail } = sidecarDetail;
  const lines = [];

  lines.push('[Meeting Context — You are answering questions about this meeting recap]');
  lines.push('');
  lines.push(`Meeting: ${meta?.meeting_name || 'Unknown'}`);
  if (meta?.occurred_at_local) lines.push(`Date: ${meta.occurred_at_local}`);
  if (meta?.duration) lines.push(`Duration: ${meta.duration}`);
  if (meta?.meeting_type) lines.push(`Type: ${meta.meeting_type}`);
  if (meta?.project) lines.push(`Project: ${meta.project}`);
  if (meta?.participants?.length) {
    lines.push(`Participants: ${meta.participants.join(', ')}`);
  }

  if (detail?.tldr) {
    lines.push('');
    lines.push(`## TL;DR`);
    lines.push(detail.tldr);
  }

  if (detail?.for_you?.length) {
    lines.push('');
    lines.push(`## Key Takeaways for You`);
    for (const item of detail.for_you) {
      lines.push(`- ${item.text} (${item.reason})`);
    }
  }

  if (detail?.hook_sections?.length) {
    for (const section of detail.hook_sections) {
      lines.push('');
      lines.push(`## ${section.title}`);
      for (const item of section.items) {
        lines.push(`- ${item.text}`);
      }
      if (section.omitted_count > 0) {
        lines.push(`  (${section.omitted_count} more items omitted)`);
      }
    }
  }

  return lines.join('\n');
}
```

这样 Claude 收到的首条消息是完整的会议摘要 + 用户实际问题，无需读取额外文件。

### Phase 4: 组件重构 — 提取 MessageList

**问题:** 现在 `ChatView.vue` 的消息渲染逻辑和 `v-if="viewMode === 'chat' && currentView === 'chat'"` 绑定在一起，无法在 RecapDetail 里复用。

**方案:** 提取 `MessageList.vue` 组件，封装消息列表渲染逻辑。

#### 4a. 新建 `MessageList.vue`

**文件:** `server/web/src/components/MessageList.vue`

从 `ChatView.vue` 提取消息循环渲染（原 lines 39-151），使其成为一个通用组件：

```vue
<script setup>
import { inject } from 'vue';
import ToolBlock from './ToolBlock.vue';
import AskQuestionCard from './AskQuestionCard.vue';

// Props 控制数据源（而非硬编码 store）
const props = defineProps({
  messages: { type: Array, required: true },
  visibleMessages: { type: Array, required: true },
  hasMoreMessages: { type: Boolean, default: false },
  isProcessing: { type: Boolean, default: false },
  hasStreamingMessage: { type: Boolean, default: false },
  loadingHistory: { type: Boolean, default: false },
  showEmptyState: { type: Boolean, default: true },
  emptyStateText: { type: String, default: '' },
  compact: { type: Boolean, default: false },  // recap chat 用紧凑模式
});

const emit = defineEmits(['scroll', 'load-more']);

// 渲染辅助函数仍从 store 注入（它们是纯函数，与数据源无关）
const store = inject('store');
const {
  t, getRenderedContent, getToolSummary, isPrevAssistant,
  toggleContextSummary, pendingPlanMode, formatTimestamp,
  copyMessage, toggleTool, agentName, workDir,
} = store;
</script>

<template>
  <div :class="['message-list', { compact }]" @scroll="emit('scroll', $event)">
    <div class="message-list-inner">
      <!-- Empty state (optional) -->
      <slot name="empty" v-if="messages.length === 0 && showEmptyState">
        <div class="empty-state">
          <!-- default or custom empty state -->
        </div>
      </slot>

      <!-- Loading history -->
      <div v-if="loadingHistory" class="history-loading">...</div>

      <!-- Load more -->
      <div v-if="hasMoreMessages" class="load-more-wrapper">
        <button class="load-more-btn" @click="emit('load-more')">{{ t('chat.loadEarlier') }}</button>
      </div>

      <!-- Message loop (identical to current ChatView rendering) -->
      <div v-for="(msg, msgIdx) in visibleMessages" :key="msg.id"
           :class="['message', 'message-' + msg.role]">
        <!-- ... 所有消息角色的渲染模板，与当前 ChatView 完全一致 ... -->
      </div>

      <!-- Typing indicator -->
      <div v-if="isProcessing && !hasStreamingMessage" class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    </div>
  </div>
</template>
```

#### 4b. 重构 `ChatView.vue`

`ChatView.vue` 变为薄封装，使用 `MessageList`：

```vue
<template>
  <template v-if="viewMode === 'chat' && currentView === 'chat'">
    <MessageList
      :messages="messages"
      :visible-messages="visibleMessages"
      :has-more-messages="hasMoreMessages"
      :is-processing="isProcessing"
      :has-streaming-message="hasStreamingMessage"
      :loading-history="loadingHistory"
      @scroll="onMessageListScroll"
      @load-more="loadMoreMessages"
    />
  </template>
</template>
```

#### 4c. RecapDetail 中使用 `MessageList`

RecapDetail 用同样的 `MessageList` 渲染 recap chat 消息，传入 recap conversation 的消息数组。

**变更范围:**
| 文件 | 改动 |
|------|------|
| `server/web/src/components/MessageList.vue` | **新建**，从 ChatView 提取消息渲染 |
| `server/web/src/components/ChatView.vue` | 重构为 MessageList 的薄封装 |

### Phase 5: RecapDetail 集成聊天

**文件:** `server/web/src/components/RecapDetail.vue`

#### 5a. 布局改造

```
┌──────────────────────────────────────┐
│  [← Back]                            │
│                                      │
│  Detail Content                      │   ← 可折叠
│  (header, for-you, tldr, sections)   │
│                                      │
│  ──── Ask about this meeting ─────   │   ← 分割线/按钮
│                                      │
│  Chat Messages (MessageList)         │   ← 复用 MessageList
│  ...                                 │
│                                      │
│  ┌──────────────────────────────┐    │
│  │  Input Box                    │    │   ← 简化版 ChatInput
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

#### 5b. Conversation 切换策略

进入 RecapDetail 时：
1. 保存当前 `currentConversationId` 到临时变量
2. 调用 `switchConversation('recap-chat-{recapId}')` 切入 recap 会话
3. 此时 store 的 `messages`, `isProcessing` 等都指向 recap chat 的状态
4. `MessageList` 和输入框直接用 store 的数据

退出 RecapDetail（点 Back）时：
1. 调用 `switchConversation(savedConversationId)` 切回主会话

这样 **零数据源重定向**——store 的 reactive state 就是当前 recap chat 的状态。

#### 5c. 输入框

可以选择：
- **方案 A：复用 ChatInput.vue** — 修改其 `v-if` 条件为 `currentView === 'chat' || currentView === 'recap-detail'`。优点：完全复用，包括附件、slash commands。缺点：recap chat 不一定需要 plan mode / brain mode 切换。
- **方案 B：简化版输入框** — RecapDetail 内联一个简单的 textarea + send button。优点：干净、无多余按钮。缺点：不能复用附件等功能。

**推荐方案 A**，修改 `v-if` 即可，按钮可以通过 prop 或 `currentView` 条件隐藏不需要的（如 plan mode）。

#### 5d. 首次聊天引导

当 recap chat 没有历史消息时，显示一个引导状态：

```
  ─── Ask about this meeting ───

  💬 Ask anything about this meeting recap
     e.g., "What were the main blockers discussed?"

  [input box]
```

**变更范围:**
| 文件 | 改动 |
|------|------|
| `server/web/src/components/RecapDetail.vue` | 布局改造，添加 MessageList + 输入框，conversation 切换 |
| `server/web/src/components/ChatInput.vue` | 修改 `v-if` 条件，recap-detail 模式下隐藏 plan/brain 按钮 |
| `server/web/src/css/recap-feed.css` | 详情+聊天分割布局样式 |

### Phase 6: Agent 端 — recapId 传递与持久化

**文件:** `agent/src/connection.ts`

chat handler 扩展：如果 payload 带 `recapId`，在收到 `session_started` 时持久化映射。

```typescript
case 'chat': {
  const chatConvId = msg.conversationId;
  const recapId = msg.recapId;      // ← 新增
  // ... existing logic ...
  claudeHandleChat(chatConvId, prompt, workDir, chatOptions, files);

  // 存下 recapId，等 session_started 时写入 metadata
  if (recapId && chatConvId) {
    pendingRecapIds.set(chatConvId, recapId);
  }
  break;
}
```

在 `claude.ts` 的 session_started handler 中：

```typescript
// Existing: save brainMode
if (state.brainMode) {
  saveSessionMetadata(state.claudeSessionId, { brainMode: true });
}
// New: save recapId if pending
const recapId = pendingRecapIds.get(convId);
if (recapId) {
  saveSessionMetadata(state.claudeSessionId, { recapId });
  pendingRecapIds.delete(convId);
}
```

**变更范围:**
| 文件 | 改动 |
|------|------|
| `agent/src/connection.ts` | 提取 `recapId` 从 chat payload，暂存到 pending map |
| `agent/src/claude.ts` | session_started 时写入 `recapId` 到 metadata |

### Phase 7: 会话恢复（持久化读取）

用户刷新页面后再次进入同一 recap detail：

1. Sidebar 或 Feed 页加载时，`sessions_list` 已经带了每个 session 的 `recapId`（因为 `handleListSessions()` 已经 merge `loadAllSessionMetadata()`）
2. Web 端从 `sessions_list` 中提取有 `recapId` 的 sessions，构建 `recapChatSessionMap: { [recapId]: claudeSessionId }`
3. 进入 RecapDetail 时，检查 `recapChatSessionMap[recapId]`：
   - **有值：** 先 `switchConversation('recap-chat-{recapId}')`，然后发 `resume_conversation` 恢复历史
   - **无值：** 空白聊天，显示引导状态

```javascript
function enterRecapChat(recapId) {
  const convId = `recap-chat-${recapId}`;
  switchConversation(convId);

  // 如果 conversationCache 为空（刷新后），尝试从持久化恢复
  if (messages.value.length === 0 && recapChatSessionMap.value[recapId]) {
    const claudeSessionId = recapChatSessionMap.value[recapId];
    wsSend({
      type: 'resume_conversation',
      claudeSessionId,
      conversationId: convId,
    });
  }
}
```

**变更范围:**
| 文件 | 改动 |
|------|------|
| `server/web/src/modules/recap.js` | `enterRecapChat` 加恢复逻辑 |
| `server/web/src/modules/handlers/session-handler.js` | `sessions_list` handler 中调用 `recap.updateRecapChatSessions()` |

### Phase 8: Feed Sidebar 显示 Recap Chat History（未来）

为后续需求预留。所有 recap chat 的 `claudeSessionId` 已通过 session metadata 持久化，`sessions_list` 返回数据中已包含 `recapId` 字段。

Sidebar 显示逻辑：
1. 从 `sessions_list` 中 filter `s => s.recapId` → recap chat sessions
2. 与 `feedEntries` 关联：用 `recapId` 匹配 → 获取 meeting_name, date 等展示信息
3. 渲染为独立列表（类似 SessionList），点击切换到对应 recap detail + chat

无需新增消息类型，复用现有 `sessions_list` 数据。

---

## 变更汇总

### 新建文件

| 文件 | 说明 |
|------|------|
| `server/web/src/components/MessageList.vue` | 通用消息列表渲染组件，从 ChatView 提取 |

### 修改文件

| 文件 | 改动说明 | 风险 |
|------|---------|------|
| `agent/src/session-metadata.ts` | `SessionMetadata` 加 `recapId` 字段 | 低：纯添加，向后兼容 |
| `agent/src/connection.ts` | chat handler 提取 `recapId`，暂存 pending map | 低：新字段，不影响现有逻辑 |
| `agent/src/claude.ts` | session_started 写入 `recapId` metadata | 低：条件写入，仅 recap chat 触发 |
| `server/web/src/modules/recap.js` | 添加聊天状态、context builder、session map、enter/exit | 中：核心新逻辑 |
| `server/web/src/components/RecapDetail.vue` | 布局改造：detail + divider + chat + input | 中：模板重构 |
| `server/web/src/components/ChatView.vue` | 重构为 MessageList 的薄封装 | 中：需确保不破坏现有聊天 |
| `server/web/src/components/ChatInput.vue` | `v-if` 条件扩展，recap-detail 模式下隐藏部分按钮 | 低：条件修改 |
| `server/web/src/modules/handlers/session-handler.js` | `sessions_list` handler 调用 `updateRecapChatSessions()` | 低：纯添加 |
| `server/web/src/css/recap-feed.css` | 分割布局、chat section 样式 | 低：纯样式 |

### 不需要修改的文件

| 文件 | 原因 |
|------|------|
| `server/src/` (server) | 透明中继，无需感知 recap chat |
| `agent/src/history.ts` | session history 读取已通用 |
| `modules/streaming.js` | conversation-agnostic，直接复用 |
| `modules/handlers/claude-output-handler.js` | conversationId 路由已通用 |
| `modules/connection.js` | 已有 `recap` getter 在 handlerDeps |

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| ChatView 提取 MessageList 可能引入回归 | 中 | 提取后立即跑 unit + functional tests；MessageList 完全保留原有渲染逻辑 |
| switchConversation 在 recap detail 来回切换可能丢失主会话状态 | 中 | 进入前保存 `previousConvId`，退出时恢复；加 defensive check |
| 首条消息上下文过长超预期 | 低 | context builder 做字数限制，omit 过长 section |
| recap chat conversationId 格式冲突 | 低 | 使用 `recap-chat-` 前缀，与 UUID 格式的普通 conversation 不冲突 |
| 多 tab 同时打开同一 recap 的 chat | 低 | 不做额外处理；各 tab 独立发消息，agent 按 conversationId 路由 |

---

## 实现顺序

1. **Phase 1** — Session metadata 扩展（agent 端，最小改动）
2. **Phase 6** — Agent 端 recapId 传递与持久化
3. **Phase 3** — Context builder（纯函数，可独立测试）
4. **Phase 4** — 提取 MessageList + 重构 ChatView
5. **Phase 2** — recap.js 扩展聊天状态
6. **Phase 5** — RecapDetail 集成聊天
7. **Phase 7** — 会话恢复
8. **Phase 8** — Feed sidebar history（后续迭代）

每个 Phase 完成后跑测试，确保无回归。Phase 4（组件重构）是风险最高的步骤，需要 functional test 全部通过才继续。
