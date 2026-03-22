<script setup>
import { inject } from 'vue';
import ToolBlock from './ToolBlock.vue';
import AskQuestionCard from './AskQuestionCard.vue';

const props = defineProps({
  messages: { type: Array, required: true },
  visibleMessages: { type: Array, required: true },
  hasMoreMessages: { type: Boolean, default: false },
  isProcessing: { type: Boolean, default: false },
  hasStreamingMessage: { type: Boolean, default: false },
  loadingHistory: { type: Boolean, default: false },
  showEmptyState: { type: Boolean, default: true },
  compact: { type: Boolean, default: false },
});

const emit = defineEmits(['scroll', 'load-more']);

const store = inject('store');
const teamStore = inject('team');
const {
  t,
  status,
  agentName,
  workDir,
  getRenderedContent,
  getToolSummary,
  isPrevAssistant: isPrevAssistantFn,
  toggleContextSummary,
  pendingPlanMode,
  formatTimestamp,
  copyMessage,
  toggleTool,
} = store;

const { teamState: team } = teamStore;

function isPrevAssistant(msgIdx) {
  // isPrevAssistant from store checks against the full visibleMessages list,
  // but we receive visibleMessages as a prop. Delegate to store function which
  // uses the live store.visibleMessages ref (which is the same array when used
  // from ChatView, and the recap chat array when switched via switchConversation).
  return isPrevAssistantFn(msgIdx);
}
</script>

<template>
  <div :class="['message-list', { compact }]" @scroll="emit('scroll', $event)">
    <div class="message-list-inner">
      <div v-if="messages.length === 0 && status === 'Connected' && !loadingHistory && showEmptyState" class="empty-state">
        <slot name="empty">
          <div class="empty-state-icon">
            <svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" opacity="0.4" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
          </div>
          <p>{{ t('chat.connectedTo') }} <strong>{{ agentName }}</strong></p>
          <p class="muted">{{ workDir }}</p>
          <p class="muted" style="margin-top: 0.5rem;">{{ t('chat.sendToStart') }}</p>
        </slot>
      </div>

      <div v-if="loadingHistory" class="history-loading">
        <div class="history-loading-spinner"></div>
        <span>{{ t('chat.loadingHistory') }}</span>
      </div>

      <div v-if="hasMoreMessages" class="load-more-wrapper">
        <button class="load-more-btn" @click="emit('load-more')">{{ t('chat.loadEarlier') }}</button>
      </div>

      <div v-for="(msg, msgIdx) in visibleMessages" :key="msg.id" :class="['message', 'message-' + msg.role]">

        <!-- User message -->
        <template v-if="msg.role === 'user'">
          <div class="message-role-label user-label">{{ t('chat.you') }}</div>
          <div class="message-bubble user-bubble" :title="formatTimestamp(msg.timestamp)">
            <div class="message-content">{{ msg.content }}</div>
            <div v-if="msg.attachments && msg.attachments.length" class="message-attachments">
              <div v-for="(att, ai) in msg.attachments" :key="ai" class="message-attachment-chip">
                <img v-if="att.isImage && att.thumbUrl" :src="att.thumbUrl" class="message-attachment-thumb" />
                <span v-else class="message-attachment-file-icon">
                  <svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.5a1 1 0 0 0-1 1h9.25a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 14V2.5z"/></svg>
                </span>
                <span>{{ att.name }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Assistant message (markdown) -->
        <template v-else-if="msg.role === 'assistant'">
          <div v-if="!isPrevAssistant(msgIdx)" class="message-role-label assistant-label">{{ t('chat.claude') }}</div>
          <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]" :title="formatTimestamp(msg.timestamp)">
            <div class="message-actions">
              <button class="icon-btn" @click="copyMessage(msg)" :title="msg.copied ? t('chat.copied') : t('chat.copy')">
                <svg v-if="!msg.copied" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                <svg v-else viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              </button>
            </div>
            <div class="message-content markdown-body" :key="msg.id + (msg.isStreaming ? '-s' : '-d')" v-html="getRenderedContent(msg)"></div>
          </div>
        </template>

        <!-- Agent tool call (team-styled) -->
        <div v-else-if="msg.role === 'tool' && msg.toolName === 'Agent'" class="tool-line-wrapper team-agent-tool-wrapper">
          <div :class="['tool-line', 'team-agent-tool-line', { completed: msg.hasResult, running: !msg.hasResult }]" @click="toggleTool(msg)">
            <span class="team-agent-tool-icon">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
            </span>
            <span class="team-agent-tool-name">Agent</span>
            <span class="team-agent-tool-desc">{{ getToolSummary(msg) }}</span>
            <span class="tool-status-icon" v-if="msg.hasResult">&#x2713;</span>
            <span class="tool-status-icon running-dots" v-else>
              <span></span><span></span><span></span>
            </span>
            <span class="tool-toggle">{{ msg.expanded ? '&#x25B2;' : '&#x25BC;' }}</span>
          </div>
          <div v-if="msg.expanded" class="tool-expand team-agent-tool-expand">
            <pre v-if="msg.toolInput" class="tool-block">{{ msg.toolInput }}</pre>
            <div v-if="msg.toolOutput" class="team-agent-tool-result">
              <div class="team-agent-tool-result-label">{{ t('team.agentResult') }}</div>
              <div class="team-agent-tool-result-content markdown-body" v-html="getRenderedContent({ role: 'assistant', content: msg.toolOutput })"></div>
            </div>
          </div>
        </div>

        <!-- Tool use block (shared component) -->
        <ToolBlock v-else-if="msg.role === 'tool'" :msg="msg" />

        <!-- AskUserQuestion interactive card -->
        <AskQuestionCard v-else-if="msg.role === 'ask-question'" :msg="msg" />

        <!-- Context summary (collapsed by default) -->
        <div v-else-if="msg.role === 'context-summary'" class="context-summary-wrapper">
          <div class="context-summary-bar" @click="toggleContextSummary(msg)">
            <svg class="context-summary-icon" viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>
            <span class="context-summary-label">{{ t('chat.contextContinued') }}</span>
            <span class="context-summary-toggle">{{ msg.contextExpanded ? t('chat.hide') : t('chat.show') }}</span>
          </div>
          <div v-if="msg.contextExpanded" class="context-summary-body">
            <div class="markdown-body" v-html="getRenderedContent({ role: 'assistant', content: msg.content })"></div>
          </div>
        </div>

        <!-- Meeting context (collapsed by default, injected in recap chat first message) -->
        <div v-else-if="msg.role === 'meeting-context'" class="context-summary-wrapper meeting-context-wrapper">
          <div class="context-summary-bar meeting-context-bar" @click="toggleContextSummary(msg)">
            <svg class="context-summary-icon" viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M4.75 0a.75.75 0 0 1 .75.75V2h5V.75a.75.75 0 0 1 1.5 0V2h1.25c.966 0 1.75.784 1.75 1.75v10.5A1.75 1.75 0 0 1 13.25 16H2.75A1.75 1.75 0 0 1 1 14.25V3.75C1 2.784 1.784 2 2.75 2H4V.75A.75.75 0 0 1 4.75 0ZM2.5 7.5v6.75c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V7.5Zm10.75-4H2.75a.25.25 0 0 0-.25.25V6h11V3.75a.25.25 0 0 0-.25-.25Z"/></svg>
            <span class="context-summary-label">{{ t('chat.meetingContextInjected') }}</span>
            <span class="context-summary-toggle">{{ msg.contextExpanded ? t('chat.hide') : t('chat.show') }}</span>
          </div>
          <div v-if="msg.contextExpanded" class="context-summary-body">
            <div class="markdown-body" v-html="getRenderedContent({ role: 'assistant', content: msg.content })"></div>
          </div>
        </div>

        <!-- System message -->
        <div v-else-if="msg.role === 'system'" :class="['system-msg', { 'compact-msg': msg.isCompactStart, 'command-output-msg': msg.isCommandOutput, 'error-msg': msg.isError }]">
          <template v-if="msg.isCompactStart && !msg.compactDone">
            <span class="compact-inline-spinner"></span>
          </template>
          <template v-if="msg.isCompactStart && msg.compactDone">
            <span class="compact-done-icon">✓</span>
          </template>
          <div v-if="msg.isCommandOutput" class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
          <template v-else>{{ msg.content }}</template>
        </div>
      </div>

      <div v-if="isProcessing && !hasStreamingMessage" class="typing-indicator">
        <span></span><span></span><span></span>
        <span v-if="pendingPlanMode" class="typing-label">{{ pendingPlanMode === 'enter' ? t('tool.enteringPlanMode') : t('tool.exitingPlanMode') }}</span>
      </div>
    </div>
  </div>
</template>
