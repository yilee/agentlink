<script setup>
import { inject } from 'vue';

const store = inject('store');
const {
  LOOP_TEMPLATES,
  LOOP_TEMPLATE_KEYS,
  t,
  selectedLoop,
  selectedExecution,
  executionHistory,
  executionMessages,
  loopsList,
  runningLoops,
  loadingExecution,
  loadingExecutions,
  loadingMoreExecutions,
  editingLoopId,
  hasRunningLoop,
  firstRunningLoop,
  loopError,
  hasMoreExecutions,
  toggleLoop,
  runNow,
  cancelLoopExecution,
  viewLoopDetail,
  viewExecution,
  backToLoopsList,
  backToLoopDetail,
  backToChat,
  loopName,
  loopPrompt,
  loopSelectedTemplate,
  selectLoopTemplate,
  loopScheduleType,
  loopScheduleMinute,
  loopScheduleHour,
  loopScheduleDayOfWeek,
  loopCronExpr,
  loopDeleteConfirmOpen,
  loopDeleteConfirmName,
  confirmDeleteLoop,
  cancelDeleteLoop,
  requestDeleteLoop,
  createLoopFromPanel,
  startEditingLoop,
  saveLoopEdits,
  cancelEditingLoop,
  loadMoreExecutions,
  clearLoopError,
  loopScheduleDisplay,
  loopLastRunDisplay,
  formatExecTime,
  formatDuration,
  isLoopRunning,
  padTwo,
  getRenderedContent,
  getToolIcon,
  getToolSummary,
  viewLoop,
  messages,
  status,
  viewMode,
  resetLoopForm,
  error,
  getEditDiffHtml,
  loop,
  toggleTool,
  isEditTool,
  getFormattedToolInput
} = store;
</script>

<template>
          <template v-if="viewMode === 'loop'">

            <!-- ── Execution detail view ── -->
            <div v-if="selectedLoop && selectedExecution" class="team-create-panel">
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
                        <span class="tool-status-icon" v-if="msg.hasResult">\u{2713}</span>
                        <span class="tool-status-icon running-dots" v-else>
                          <span></span><span></span><span></span>
                        </span>
                        <span class="tool-toggle">{{ msg.expanded ? '\u{25B2}' : '\u{25BC}' }}</span>
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

            <!-- ── Loop detail view (execution history) ── -->
            <div v-else-if="selectedLoop" class="team-create-panel">
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
                          <template v-if="exec.status === 'running'">\u{21BB}</template>
                          <template v-else-if="exec.status === 'success'">\u{2713}</template>
                          <template v-else-if="exec.status === 'error'">\u{2717}</template>
                          <template v-else-if="exec.status === 'cancelled'">\u{25CB}</template>
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

            <!-- ── Loop creation panel (default) ── -->
            <div v-else class="team-create-panel">
              <div class="team-create-inner">
                <div class="team-create-header">
                  <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" opacity="0.5" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                  <h2>{{ editingLoopId ? t('loop.editLoop') : t('loop.createLoop') }}</h2>
                </div>
                <p class="team-create-desc">{{ t('loop.createDesc') }}</p>

                <!-- Template cards -->
                <div v-if="!editingLoopId" class="team-examples-section" style="margin-top: 0;">
                  <div class="team-examples-header">{{ t('loop.templates') }}</div>
                  <div class="team-examples-list">
                    <div v-for="key in LOOP_TEMPLATE_KEYS" :key="key"
                         :class="['team-example-card', { 'loop-template-selected': loopSelectedTemplate === key }]"
                    >
                      <div class="team-example-icon">
                        <svg v-if="key === 'competitive-intel'" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 0 1 5.08 16zm2.95-8H5.08a7.987 7.987 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>
                        <svg v-else-if="key === 'knowledge-base'" viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                        <svg v-else viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>
                      </div>
                      <div class="team-example-body">
                        <div class="team-example-title">{{ LOOP_TEMPLATES[key].label }}</div>
                        <div class="team-example-text">{{ LOOP_TEMPLATES[key].description }}</div>
                      </div>
                      <button class="team-example-try" @click="selectLoopTemplate(key)">{{ t('team.tryIt') }}</button>
                    </div>
                  </div>
                </div>

                <!-- Name field -->
                <div class="team-tpl-section">
                  <label class="team-tpl-label">{{ t('loop.name') }}</label>
                  <input
                    v-model="loopName"
                    type="text"
                    class="loop-name-input"
                    :placeholder="t('loop.namePlaceholder')"
                  />
                </div>

                <!-- Prompt field -->
                <div class="team-tpl-section">
                  <label class="team-tpl-label">{{ t('loop.prompt') }}</label>
                  <textarea
                    v-model="loopPrompt"
                    class="team-create-textarea"
                    :placeholder="t('loop.promptPlaceholder')"
                    rows="5"
                  ></textarea>
                </div>

                <!-- Schedule selector -->
                <div class="team-tpl-section">
                  <label class="team-tpl-label">{{ t('loop.schedule') }}</label>
                  <div class="loop-schedule-options">
                    <label class="loop-schedule-radio">
                      <input type="radio" v-model="loopScheduleType" value="manual" />
                      <span>{{ t('loop.manual') }}</span>
                      <span v-if="loopScheduleType === 'manual'" class="loop-schedule-detail" style="opacity:0.6">{{ t('loop.manualDetail') }}</span>
                    </label>
                    <label class="loop-schedule-radio">
                      <input type="radio" v-model="loopScheduleType" value="hourly" />
                      <span>{{ t('loop.everyHour') }}</span>
                      <span v-if="loopScheduleType === 'hourly'" class="loop-schedule-detail">at minute {{ padTwo(loopScheduleMinute) }}</span>
                    </label>
                    <label class="loop-schedule-radio">
                      <input type="radio" v-model="loopScheduleType" value="daily" />
                      <span>{{ t('loop.everyDay') }}</span>
                      <span v-if="loopScheduleType === 'daily'" class="loop-schedule-detail">
                        at
                        <input type="number" v-model.number="loopScheduleHour" min="0" max="23" class="loop-time-input" />
                        :
                        <input type="number" v-model.number="loopScheduleMinute" min="0" max="59" class="loop-time-input" />
                      </span>
                    </label>
                    <label class="loop-schedule-radio">
                      <input type="radio" v-model="loopScheduleType" value="cron" />
                      <span>{{ t('loop.advancedCron') }}</span>
                      <span v-if="loopScheduleType === 'cron'" class="loop-schedule-detail">
                        <input type="text" v-model="loopCronExpr" class="loop-cron-input" placeholder="0 9 * * *" />
                      </span>
                    </label>
                  </div>
                </div>

                <!-- Action buttons -->
                <div class="team-create-actions">
                  <button v-if="editingLoopId" class="team-create-launch" :disabled="!loopName.trim() || !loopPrompt.trim()" @click="saveLoopEdits()">
                    {{ t('loop.saveChanges') }}
                  </button>
                  <button v-else class="team-create-launch" :disabled="!loopName.trim() || !loopPrompt.trim()" @click="createLoopFromPanel()">
                    <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>
                    {{ t('loop.createLoopBtn') }}
                  </button>
                  <button v-if="editingLoopId" class="team-create-cancel" @click="cancelEditingLoop()">{{ t('loop.cancel') }}</button>
                  <button class="team-create-cancel" @click="backToChat()">{{ t('loop.backToChat') }}</button>
                </div>

                <!-- Error message -->
                <div v-if="loopError" class="loop-error-banner" @click="clearLoopError()">
                  <span class="loop-error-icon">\u{26A0}</span>
                  <span class="loop-error-text">{{ loopError }}</span>
                  <span class="loop-error-dismiss">\u{2715}</span>
                </div>

                <!-- Active Loops list -->
                <div v-if="loopsList.length > 0" class="loop-active-section">
                  <div class="loop-active-header">{{ t('loop.activeLoops') }}</div>
                  <div class="loop-active-list">
                    <div v-for="l in loopsList" :key="l.id" class="loop-active-item">
                      <div class="loop-active-item-info" @click="viewLoop(l.id)">
                        <div class="loop-active-item-top">
                          <span class="loop-active-item-name">{{ l.name }}</span>
                          <span :class="['loop-status-dot', l.enabled ? 'loop-status-dot-on' : 'loop-status-dot-off']"></span>
                        </div>
                        <div class="loop-active-item-meta">
                          <span class="loop-active-item-schedule">{{ loopScheduleDisplay(l) }}</span>
                          <span v-if="l.lastExecution" class="loop-active-item-last">
                            Last: {{ loopLastRunDisplay(l) }}
                          </span>
                          <span v-if="isLoopRunning(l.id)" class="loop-exec-running-label">{{ t('loop.running') }}</span>
                        </div>
                      </div>
                      <div class="loop-active-item-actions">
                        <button class="loop-action-btn loop-action-sm" @click="startEditingLoop(l)" :title="t('loop.edit')">{{ t('loop.edit') }}</button>
                        <button class="loop-action-btn loop-action-sm loop-action-run" @click="runNow(l.id)" :disabled="isLoopRunning(l.id)" :title="t('loop.runNow')">{{ t('loop.run') }}</button>
                        <button class="loop-action-btn loop-action-sm" @click="toggleLoop(l.id)" :title="l.enabled ? t('loop.disable') : t('loop.enable')">{{ l.enabled ? t('loop.pause') : t('loop.resume') }}</button>
                        <button v-if="!l.enabled" class="loop-action-btn loop-action-sm loop-action-delete" @click="requestDeleteLoop(l)" :title="t('loop.deleteLoop')">{{ t('loop.del') }}</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Running Loop notification banner -->
            <div v-if="hasRunningLoop && !selectedLoop" class="loop-running-banner">
              <span class="loop-running-banner-dot"></span>
              <span>{{ firstRunningLoop.name }} {{ t('loop.isRunning') }}</span>
              <button class="loop-action-btn loop-action-sm" @click="viewLoop(firstRunningLoop.loopId)">{{ t('loop.view') }}</button>
            </div>

            <!-- Loop delete confirm dialog -->
            <div v-if="loopDeleteConfirmOpen" class="modal-overlay" @click.self="cancelDeleteLoop()">
              <div class="modal-dialog">
                <div class="modal-title">{{ t('loop.deleteLoop') }}</div>
                <div class="modal-body" v-html="t('loop.deleteConfirm', { name: loopDeleteConfirmName })"></div>
                <div class="modal-actions">
                  <button class="modal-confirm-btn" @click="confirmDeleteLoop()">{{ t('loop.delete') }}</button>
                  <button class="modal-cancel-btn" @click="cancelDeleteLoop()">{{ t('loop.cancel') }}</button>
                </div>
              </div>
            </div>
          </template>
</template>
