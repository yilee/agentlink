<script setup>
import { inject } from 'vue';

const store = inject('store');
const sidebarStore = inject('sidebar');
const teamStore = inject('team');

const { t } = store;

const {
  teamsCollapsed,
  loadingTeams,
} = sidebarStore;

const {
  renamingTeamId,
  startTeamRename,
  renameTeamText,
  confirmTeamRename,
  cancelTeamRename,
  requestDeleteTeam,
  teamsList,
  viewHistoricalTeam,
  isTeamActive,
  displayTeam,
  newTeam,
  requestTeamsList,
} = teamStore;
</script>

<template>
  <div class="sidebar-section sidebar-teams" :style="{ flex: teamsCollapsed ? '0 0 auto' : '1 1 0', minHeight: teamsCollapsed ? 'auto' : '0' }">
    <div class="sidebar-section-header" @click="teamsCollapsed = !teamsCollapsed" style="cursor: pointer;">
      <span>{{ t('sidebar.teamsHistory') }}</span>
      <span class="sidebar-section-header-actions">
        <button class="sidebar-refresh-btn" @click.stop="requestTeamsList" :title="t('sidebar.refresh')" :disabled="loadingTeams">
          <svg :class="{ spinning: loadingTeams }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
        </button>
        <button class="sidebar-collapse-btn" :title="teamsCollapsed ? t('sidebar.expand') : t('sidebar.collapse')">
          <svg :class="{ collapsed: teamsCollapsed }" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
        </button>
      </span>
    </div>

    <div v-show="!teamsCollapsed" class="sidebar-section-collapsible">
    <button class="new-conversation-btn" @click="newTeam" :disabled="isTeamActive">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      {{ t('sidebar.newTeam') }}
    </button>

    <div class="team-history-list">
      <div
        v-for="tm in teamsList" :key="tm.teamId"
        :class="['team-history-item', { active: displayTeam && displayTeam.teamId === tm.teamId }]"
        @click="renamingTeamId !== tm.teamId && viewHistoricalTeam(tm.teamId)"
        :title="tm.title"
      >
        <div class="team-history-info">
          <div v-if="renamingTeamId === tm.teamId" class="session-rename-row">
            <input
              class="session-rename-input"
              v-model="renameTeamText"
              @click.stop
              @keydown.enter.stop="confirmTeamRename"
              @keydown.escape.stop="cancelTeamRename"
              @vue:mounted="$event.el.focus()"
            />
            <button class="session-rename-ok" @click.stop="confirmTeamRename" :title="t('sidebar.confirm')">&#10003;</button>
            <button class="session-rename-cancel" @click.stop="cancelTeamRename" :title="t('sidebar.cancel')">&times;</button>
          </div>
          <div v-else class="team-history-title">{{ tm.title || t('sidebar.untitledTeam') }}</div>
          <div v-if="renamingTeamId !== tm.teamId" class="team-history-meta">
            <span :class="['team-status-badge', 'team-status-badge-sm', 'team-status-' + tm.status]">{{ tm.status }}</span>
            <span v-if="tm.taskCount" class="team-history-tasks">{{ tm.taskCount }} {{ t('sidebar.tasks') }}</span>
            <span v-if="tm.totalCost" class="team-history-tasks">{{'$' + tm.totalCost.toFixed(2) }}</span>
            <span class="session-actions">
              <button class="session-rename-btn" @click.stop="startTeamRename(tm)" :title="t('sidebar.renameTeam')">
                <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </button>
              <button class="session-delete-btn" @click.stop="requestDeleteTeam(tm)" :title="t('sidebar.deleteTeam')">
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
