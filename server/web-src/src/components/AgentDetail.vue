<script setup>
import { inject } from 'vue';

const store = inject('store');
const teamStore = inject('team');

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
  activeAgentView,
  viewDashboard,
  findAgent,
  getAgentColor,
  getAgentMessages,
} = teamStore;
</script>

<template>
  <div class="team-agent-detail">
    <div class="team-agent-detail-header" :style="{ borderBottom: '2px solid ' + getAgentColor(activeAgentView) }">
      <button class="team-agent-back-btn" @click="viewDashboard()">
        <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
        {{ t('team.dashboard') }}
      </button>
      <span :class="['team-agent-dot', { working: findAgent(activeAgentView)?.status === 'working' || findAgent(activeAgentView)?.status === 'starting' }]" :style="{ background: getAgentColor(activeAgentView) }"></span>
      <span class="team-agent-detail-name" :style="{ color: getAgentColor(activeAgentView) }">{{ findAgent(activeAgentView)?.name || activeAgentView }}</span>
      <span class="team-agent-detail-status">{{ findAgent(activeAgentView)?.status }}</span>
    </div>
    <div class="team-agent-messages">
      <div class="team-agent-messages-inner">
        <div v-if="getAgentMessages(activeAgentView).length === 0" class="team-agent-empty-msg">
          {{ t('team.noMessages') }}
        </div>
        <template v-for="(msg, mi) in getAgentMessages(activeAgentView)" :key="msg.id">
          <!-- Agent user/prompt message -->
          <div v-if="msg.role === 'user' && msg.content" class="team-agent-prompt">
            <div class="team-agent-prompt-label">{{ t('team.taskPrompt') }}</div>
            <div class="team-agent-prompt-body markdown-body" v-html="getRenderedContent(msg)"></div>
          </div>
          <!-- System notice (e.g. completion message) -->
          <div v-else-if="msg.role === 'system'" class="team-agent-empty-msg">
            {{ msg.content }}
          </div>
          <!-- Agent assistant text -->
          <div v-else-if="msg.role === 'assistant'" :class="['message', 'message-assistant']">
            <div class="team-agent-detail-name-tag" :style="{ color: getAgentColor(activeAgentView) }">{{ findAgent(activeAgentView)?.name || activeAgentView }}</div>
            <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]">
              <div class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
            </div>
          </div>
          <!-- Plan mode switch indicator -->
          <div v-else-if="msg.role === 'tool' && (msg.toolName === 'EnterPlanMode' || msg.toolName === 'ExitPlanMode')" class="plan-mode-divider">
            <span class="plan-mode-divider-line"></span>
            <span class="plan-mode-divider-text">{{ msg.toolName === 'EnterPlanMode' ? t('tool.enteredPlanMode') : t('tool.exitedPlanMode') }}</span>
            <span class="plan-mode-divider-line"></span>
          </div>
          <!-- Agent tool use -->
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
