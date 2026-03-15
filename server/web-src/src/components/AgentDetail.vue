<script setup>
import { inject } from 'vue';
import ToolBlock from './ToolBlock.vue';

const store = inject('store');
const teamStore = inject('team');

const {
  t,
  getRenderedContent,
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
          <!-- Tool use block (shared component) -->
          <ToolBlock v-else-if="msg.role === 'tool'" :msg="msg" />
        </template>
      </div>
    </div>
  </div>
</template>
