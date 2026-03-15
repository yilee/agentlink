<script setup>
import { inject } from 'vue';

const store = inject('store');
const loopStore = inject('loop');

const {
  t,
  getRenderedContent,
  getToolIcon,
  getToolSummary,
  getEditDiffHtml,
  toggleTool,
  isEditTool,
  getFormattedToolInput,
} = store;

const {
  selectedLoop,
  executionMessages,
  loadingExecution,
  backToLoopDetail,
} = loopStore;
</script>

<template>
  <div class="team-create-panel">
    <div class="team-create-inner">
      <div class="loop-detail-header">
        <button class="team-agent-back-btn" @click="backToLoopDetail()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          {{ selectedLoop.name }}
        </button>
      </div>

      <div v-if="loadingExecution" class="loop-loading">
        <div class="history-loading-spinner"></div>
        <span>{{ t('loop.loadingExecution') }}</span>
      </div>

      <div v-else class="loop-exec-messages">
        <div v-if="executionMessages.length === 0" class="team-agent-empty-msg">{{ t('loop.noExecMessages') }}</div>
        <template v-for="(msg, mi) in executionMessages" :key="msg.id">
          <div v-if="msg.role === 'user' && msg.content" class="team-agent-prompt">
            <div class="team-agent-prompt-label">{{ t('loop.loopPrompt') }}</div>
            <div class="team-agent-prompt-body markdown-body" v-html="getRenderedContent(msg)"></div>
          </div>
          <div v-else-if="msg.role === 'assistant'" :class="['message', 'message-assistant']">
            <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]">
              <div class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
            </div>
          </div>
          <div v-else-if="msg.role === 'tool' && (msg.toolName === 'EnterPlanMode' || msg.toolName === 'ExitPlanMode')" class="plan-mode-divider">
            <span class="plan-mode-divider-line"></span>
            <span class="plan-mode-divider-text">{{ msg.toolName === 'EnterPlanMode' ? t('tool.enteredPlanMode') : t('tool.exitedPlanMode') }}</span>
            <span class="plan-mode-divider-line"></span>
          </div>
          <div v-else-if="msg.role === 'tool'" class="tool-line-wrapper">
            <div :class="['tool-line', { completed: msg.hasResult, running: !msg.hasResult }]" @click="toggleTool(msg)">
              <span class="tool-icon" v-html="getToolIcon(msg.toolName)"></span>
              <span class="tool-name">{{ msg.toolName }}</span>
              <span class="tool-summary">{{ getToolSummary(msg) }}</span>
              <span class="tool-status-icon" v-if="msg.hasResult">&#x2713;</span>
              <span class="tool-status-icon running-dots" v-else>
                <span></span><span></span><span></span>
              </span>
              <span class="tool-toggle">{{ msg.expanded ? '&#x25B2;' : '&#x25BC;' }}</span>
            </div>
            <div v-if="msg.expanded" class="tool-expand">
              <div v-if="isEditTool(msg) && getEditDiffHtml(msg)" class="tool-diff" v-html="getEditDiffHtml(msg)"></div>
              <div v-else-if="getFormattedToolInput(msg)" class="tool-input-formatted" v-html="getFormattedToolInput(msg)"></div>
              <pre v-else-if="msg.toolInput" class="tool-block">{{ msg.toolInput }}</pre>
              <pre v-if="msg.toolOutput" class="tool-block tool-output">{{ msg.toolOutput }}</pre>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
