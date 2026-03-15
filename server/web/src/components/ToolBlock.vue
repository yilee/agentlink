<script setup>
import { inject } from 'vue';

defineProps(['msg']);

const store = inject('store');

const {
  t,
  getToolIcon,
  getToolSummary,
  toggleTool,
  isEditTool,
  getEditDiffHtml,
  getFormattedToolInput,
} = store;
</script>

<template>
  <!-- Plan mode switch indicator -->
  <div v-if="msg.toolName === 'EnterPlanMode' || msg.toolName === 'ExitPlanMode'" class="plan-mode-divider">
    <span class="plan-mode-divider-line"></span>
    <span class="plan-mode-divider-text">{{ msg.toolName === 'EnterPlanMode' ? t('tool.enteredPlanMode') : t('tool.exitedPlanMode') }}</span>
    <span class="plan-mode-divider-line"></span>
  </div>

  <!-- Collapsible tool line -->
  <div v-else class="tool-line-wrapper">
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
