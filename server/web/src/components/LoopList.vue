<script setup>
import { inject } from 'vue';

const store = inject('store');
const sidebarStore = inject('sidebar');
const loopStore = inject('loop');

const { t } = store;

const {
  loopsCollapsed,
  loadingLoops,
} = sidebarStore;

const {
  loopsList,
  selectedLoop,
  viewLoop,
  newLoop,
  renamingLoopId,
  startLoopRename,
  renameLoopText,
  confirmLoopRename,
  cancelLoopRename,
  requestDeleteLoop,
  formatSchedule,
  requestLoopsList,
} = loopStore;
</script>

<template>
  <div class="sidebar-section sidebar-loops" :style="{ flex: loopsCollapsed ? '0 0 auto' : '1 1 0', minHeight: loopsCollapsed ? 'auto' : '0' }">
    <div class="sidebar-section-header" @click="loopsCollapsed = !loopsCollapsed" style="cursor: pointer;">
      <span>{{ t('sidebar.loops') }}</span>
      <span class="sidebar-section-header-actions">
        <button class="sidebar-refresh-btn" @click.stop="requestLoopsList" :title="t('sidebar.refresh')" :disabled="loadingLoops">
          <svg :class="{ spinning: loadingLoops }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
        <button class="sidebar-collapse-btn" :title="loopsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
          <svg :class="{ collapsed: loopsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
        </button>
      </span>
    </div>

    <div v-show="!loopsCollapsed" class="sidebar-section-collapsible">
    <button class="new-conversation-btn" @click="newLoop">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      {{ t('sidebar.newLoop') }}
    </button>

    <div v-if="loopsList.length === 0 && !loadingLoops" class="sidebar-empty">
      {{ t('sidebar.noLoops') }}
    </div>
    <div v-else class="loop-history-list">
      <div
        v-for="l in loopsList" :key="l.id"
        :class="['team-history-item', { active: selectedLoop?.id === l.id }]"
        @click="renamingLoopId !== l.id && viewLoop(l.id)"
        :title="l.name"
      >
        <div class="team-history-info">
          <div v-if="renamingLoopId === l.id" class="session-rename-row">
            <input
              class="session-rename-input"
              v-model="renameLoopText"
              @click.stop
              @keydown.enter.stop="confirmLoopRename"
              @keydown.escape.stop="cancelLoopRename"
              @vue:mounted="$event.el.focus()"
            />
            <button class="session-rename-ok" @click.stop="confirmLoopRename" :title="t('sidebar.confirm')">&#10003;</button>
            <button class="session-rename-cancel" @click.stop="cancelLoopRename" :title="t('sidebar.cancel')">&times;</button>
          </div>
          <div v-else class="team-history-title">{{ l.name || t('sidebar.untitledLoop') }}</div>
          <div v-if="renamingLoopId !== l.id" class="team-history-meta">
            <span :class="['team-status-badge', 'team-status-badge-sm', l.enabled ? 'team-status-running' : 'team-status-completed']">{{ l.enabled ? t('sidebar.active') : t('sidebar.paused') }}</span>
            <span v-if="l.scheduleType" class="team-history-tasks">{{ formatSchedule(l.scheduleType, l.scheduleConfig || {}, l.schedule) }}</span>
            <span class="session-actions">
              <button class="session-rename-btn" @click.stop="startLoopRename(l)" :title="t('sidebar.renameLoop')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button class="session-delete-btn" @click.stop="requestDeleteLoop(l)" :title="t('sidebar.deleteLoop')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
    </div>
  </div>
</template>
