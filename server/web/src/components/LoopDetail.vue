<script setup>
import { inject } from 'vue';

const store = inject('store');
const loopStore = inject('loop');

const { t } = store;

const {
  selectedLoop,
  executionHistory,
  loadingExecutions,
  loadingMoreExecutions,
  hasMoreExecutions,
  backToLoopsList,
  viewExecution,
  startEditingLoop,
  toggleLoop,
  runNow,
  cancelExecution: cancelLoopExecution,
  loadMoreExecutions,
  loopScheduleDisplay,
  formatExecTime,
  formatDuration,
  isLoopRunning,
} = loopStore;
</script>

<template>
  <div class="team-create-panel">
    <div class="team-create-inner">
      <div class="loop-detail-header">
        <button class="team-agent-back-btn" @click="backToLoopsList()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          {{ t('loop.backToLoops') }}
        </button>
      </div>
      <div class="loop-detail-info">
        <h2 class="loop-detail-name">{{ selectedLoop.name }}</h2>
        <div class="loop-detail-meta">
          <span class="loop-detail-schedule">{{ loopScheduleDisplay(selectedLoop) }}</span>
          <span :class="['loop-status-badge', selectedLoop.enabled ? 'loop-status-enabled' : 'loop-status-disabled']">{{ selectedLoop.enabled ? t('loop.enabled') : t('loop.disabled') }}</span>
          <span v-if="selectedLoop.brainMode" class="loop-status-badge loop-status-brain">🧠 Brain</span>
        </div>
        <div class="loop-detail-actions">
          <button class="loop-action-btn" @click="startEditingLoop(selectedLoop); selectedLoop = null">{{ t('loop.edit') }}</button>
          <button class="loop-action-btn loop-action-run" @click="runNow(selectedLoop.id)" :disabled="isLoopRunning(selectedLoop.id)">{{ t('loop.runNow') }}</button>
          <button class="loop-action-btn" @click="toggleLoop(selectedLoop.id)">{{ selectedLoop.enabled ? t('loop.disable') : t('loop.enable') }}</button>
        </div>
      </div>

      <div class="loop-detail-prompt-section">
        <div class="loop-detail-prompt-label">{{ t('loop.prompt') }}</div>
        <div class="loop-detail-prompt-text">{{ selectedLoop.prompt }}</div>
      </div>

      <div class="loop-exec-history-section">
        <div class="loop-exec-history-header">{{ t('loop.executionHistory') }}</div>
        <div v-if="loadingExecutions" class="loop-loading">
          <div class="history-loading-spinner"></div>
          <span>{{ t('loop.loadingExecutions') }}</span>
        </div>
        <div v-else-if="executionHistory.length === 0" class="loop-exec-empty">{{ t('loop.noExecutions') }}</div>
        <div v-else class="loop-exec-list">
          <div v-for="exec in executionHistory" :key="exec.id" class="loop-exec-item">
            <div class="loop-exec-item-left">
              <span :class="['loop-exec-status-icon', 'loop-exec-status-' + exec.status]">
                <template v-if="exec.status === 'running'">&#x21BB;</template>
                <template v-else-if="exec.status === 'success'">&#x2713;</template>
                <template v-else-if="exec.status === 'error'">&#x2717;</template>
                <template v-else-if="exec.status === 'cancelled'">&#x25CB;</template>
                <template v-else>?</template>
              </span>
              <span class="loop-exec-time">{{ formatExecTime(exec.startedAt) }}</span>
              <span v-if="exec.status === 'running'" class="loop-exec-running-label">{{ t('loop.running') }}</span>
              <span v-else-if="exec.durationMs" class="loop-exec-duration">{{ formatDuration(exec.durationMs) }}</span>
              <span v-if="exec.error" class="loop-exec-error-text" :title="exec.error">{{ exec.error.length > 40 ? exec.error.slice(0, 40) + '...' : exec.error }}</span>
              <span v-if="exec.trigger === 'manual'" class="loop-exec-trigger-badge">{{ t('loop.manualBadge') }}</span>
            </div>
            <div class="loop-exec-item-right">
              <button v-if="exec.status === 'running'" class="loop-action-btn" @click="viewExecution(selectedLoop.id, exec.id)">{{ t('loop.view') }}</button>
              <button v-if="exec.status === 'running'" class="loop-action-btn loop-action-cancel" @click="cancelLoopExecution(selectedLoop.id)">{{ t('loop.cancelExec') }}</button>
              <button v-if="exec.status !== 'running'" class="loop-action-btn" @click="viewExecution(selectedLoop.id, exec.id)">{{ t('loop.view') }}</button>
            </div>
          </div>
          <!-- Load more executions -->
          <div v-if="hasMoreExecutions && !loadingExecutions" class="loop-load-more">
            <button class="loop-action-btn" :disabled="loadingMoreExecutions" @click="loadMoreExecutions()">
              {{ loadingMoreExecutions ? t('filePanel.loading') : t('loop.loadMore') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
