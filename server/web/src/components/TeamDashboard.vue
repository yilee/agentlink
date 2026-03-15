<script setup>
import { inject } from 'vue';

const store = inject('store');
const teamStore = inject('team');

const {
  t,
  getRenderedContent,
  feedAgentName,
  feedContentRest,
  formatDuration,
} = store;

const {
  displayTeam,
  historicalTeam,
  teamInstruction,
  kanbanExpanded,
  pendingTasks,
  activeTasks,
  doneTasks,
  failedTasks,
  getTaskAgent,
  getAgentColor,
  getLatestAgentActivity,
  formatTeamTime,
  viewAgent,
  viewAgentWithHistory,
  backToChat,
  launchTeamFromPanel,
} = teamStore;
</script>

<template>
  <div class="team-dash-main">

    <!-- Kanban board (collapsible) -->
    <div class="team-kanban-section">
      <div class="team-kanban-section-header" @click="kanbanExpanded = !kanbanExpanded">
        <span class="team-kanban-section-toggle">{{ kanbanExpanded ? '\u25BC' : '\u25B6' }}</span>
        <span class="team-kanban-section-title">{{ t('team.tasks') }}</span>
        <span class="team-kanban-section-summary">{{ doneTasks.length }}/{{ displayTeam.tasks.length }} {{ t('team.done') }}</span>
      </div>
      <div v-show="kanbanExpanded" class="team-kanban">
        <div class="team-kanban-col">
          <div class="team-kanban-col-header">
            <span class="team-kanban-col-dot pending"></span>
            {{ t('team.pending') }}
            <span class="team-kanban-col-count">{{ pendingTasks.length }}</span>
          </div>
          <div class="team-kanban-col-body">
            <div v-for="task in pendingTasks" :key="task.id" class="team-task-card">
              <div class="team-task-title">{{ task.title }}</div>
              <div v-if="task.description" class="team-task-desc team-task-desc-clamp" @click.stop="$event.target.classList.toggle('team-task-desc-expanded')">{{ task.description }}</div>
            </div>
            <div v-if="pendingTasks.length === 0" class="team-kanban-empty">{{ t('team.noTasks') }}</div>
          </div>
        </div>
        <div class="team-kanban-col">
          <div class="team-kanban-col-header">
            <span class="team-kanban-col-dot active"></span>
            {{ t('team.activeCol') }}
            <span class="team-kanban-col-count">{{ activeTasks.length }}</span>
          </div>
          <div class="team-kanban-col-body">
            <div v-for="task in activeTasks" :key="task.id" class="team-task-card active">
              <div class="team-task-title">{{ task.title }}</div>
              <div v-if="task.description" class="team-task-desc team-task-desc-clamp" @click.stop="$event.target.classList.toggle('team-task-desc-expanded')">{{ task.description }}</div>
              <div v-if="getTaskAgent(task)" class="team-task-assignee">
                <span class="team-agent-dot" :style="{ background: getAgentColor(task.assignee || task.assignedTo) }"></span>
                {{ getTaskAgent(task).name || task.assignee || task.assignedTo }}
              </div>
            </div>
            <div v-if="activeTasks.length === 0" class="team-kanban-empty">{{ t('team.noTasks') }}</div>
          </div>
        </div>
        <div class="team-kanban-col">
          <div class="team-kanban-col-header">
            <span class="team-kanban-col-dot done"></span>
            {{ t('team.doneCol') }}
            <span class="team-kanban-col-count">{{ doneTasks.length }}</span>
          </div>
          <div class="team-kanban-col-body">
            <div v-for="task in doneTasks" :key="task.id" class="team-task-card done">
              <div class="team-task-title">{{ task.title }}</div>
              <div v-if="task.description" class="team-task-desc team-task-desc-clamp" @click.stop="$event.target.classList.toggle('team-task-desc-expanded')">{{ task.description }}</div>
              <div v-if="getTaskAgent(task)" class="team-task-assignee">
                <span class="team-agent-dot" :style="{ background: getAgentColor(task.assignee || task.assignedTo) }"></span>
                {{ getTaskAgent(task).name || task.assignee || task.assignedTo }}
              </div>
            </div>
            <div v-if="doneTasks.length === 0" class="team-kanban-empty">{{ t('team.noTasks') }}</div>
          </div>
        </div>
        <div v-if="failedTasks.length > 0" class="team-kanban-col">
          <div class="team-kanban-col-header">
            <span class="team-kanban-col-dot failed"></span>
            {{ t('team.failed') }}
            <span class="team-kanban-col-count">{{ failedTasks.length }}</span>
          </div>
          <div class="team-kanban-col-body">
            <div v-for="task in failedTasks" :key="task.id" class="team-task-card failed">
              <div class="team-task-title">{{ task.title }}</div>
              <div v-if="task.description" class="team-task-desc team-task-desc-clamp" @click.stop="$event.target.classList.toggle('team-task-desc-expanded')">{{ task.description }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Agent cards (horizontal) -->
    <div class="team-agents-bar">
      <div class="team-agents-bar-header">{{ t('team.agents') }}</div>
      <div class="team-agents-bar-list">
        <div
          v-for="agent in (displayTeam.agents || [])" :key="agent.id"
          class="team-agent-card"
          @click="historicalTeam ? viewAgentWithHistory(agent.id) : viewAgent(agent.id)"
        >
          <div class="team-agent-card-top">
            <span :class="['team-agent-dot', { working: agent.status === 'working' || agent.status === 'starting' }]" :style="{ background: getAgentColor(agent.id) }"></span>
            <span class="team-agent-card-name">{{ agent.name || agent.id }}</span>
            <span :class="['team-agent-card-status', 'team-agent-card-status-' + agent.status]">{{ agent.status }}</span>
          </div>
          <div v-if="getLatestAgentActivity(agent.id)" class="team-agent-card-activity">{{ getLatestAgentActivity(agent.id) }}</div>
        </div>
        <div v-if="!displayTeam.agents || displayTeam.agents.length === 0" class="team-agents-empty">
          <span v-if="displayTeam.status === 'planning'">{{ t('team.planningTasks') }}</span>
          <span v-else>{{ t('team.noAgents') }}</span>
        </div>
      </div>
    </div>

    <!-- Activity feed -->
    <div v-if="displayTeam.feed && displayTeam.feed.length > 0" class="team-feed">
      <div class="team-feed-header">{{ t('team.activity') }}</div>
      <div class="team-feed-list">
        <div v-for="(entry, fi) in displayTeam.feed" :key="fi" class="team-feed-entry">
          <span v-if="entry.agentId" class="team-agent-dot" :style="{ background: getAgentColor(entry.agentId) }"></span>
          <span v-else class="team-agent-dot" style="background: #666;"></span>
          <span class="team-feed-time">{{ formatTeamTime(entry.timestamp) }}</span>
          <span class="team-feed-text"><span v-if="feedAgentName(entry)" class="team-feed-agent-name" :style="{ color: getAgentColor(entry.agentId) }">{{ feedAgentName(entry) }}</span>{{ feedContentRest(entry) }}</span>
        </div>
      </div>
    </div>

    <!-- Completion stats -->
    <div v-if="displayTeam.status === 'completed' || displayTeam.status === 'failed'" class="team-stats-bar">
      <div class="team-stat">
        <span class="team-stat-label">{{ t('team.tasksStat') }}</span>
        <span class="team-stat-value">{{ doneTasks.length }}/{{ displayTeam.tasks.length }}</span>
      </div>
      <div v-if="displayTeam.durationMs" class="team-stat">
        <span class="team-stat-label">{{ t('team.duration') }}</span>
        <span class="team-stat-value">{{ formatDuration(displayTeam.durationMs) }}</span>
      </div>
      <div v-if="displayTeam.totalCost" class="team-stat">
        <span class="team-stat-label">{{ t('team.cost') }}</span>
        <span class="team-stat-value">{{ '$' + displayTeam.totalCost.toFixed(2) }}</span>
      </div>
      <div class="team-stat">
        <span class="team-stat-label">{{ t('team.agentsStat') }}</span>
        <span class="team-stat-value">{{ (displayTeam.agents || []).length }}</span>
      </div>
    </div>

    <!-- Completion summary -->
    <div v-if="displayTeam.status === 'completed' && displayTeam.summary" class="team-summary">
      <div class="team-summary-header">{{ t('team.summary') }}</div>
      <div class="team-summary-body markdown-body" v-html="getRenderedContent({ role: 'assistant', content: displayTeam.summary })"></div>
    </div>

    <!-- New team launcher after completion -->
    <div v-if="!historicalTeam && (displayTeam.status === 'completed' || displayTeam.status === 'failed')" class="team-new-launcher">
      <textarea
        v-model="teamInstruction"
        class="team-new-launcher-input"
        :placeholder="t('team.launchAnotherPlaceholder')"
        rows="2"
        @keydown.enter.ctrl="launchTeamFromPanel()"
      ></textarea>
      <div class="team-new-launcher-actions">
        <button class="team-create-launch" :disabled="!teamInstruction.trim()" @click="launchTeamFromPanel()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          {{ t('team.newTeam') }}
        </button>
        <button class="team-create-cancel" @click="backToChat()">{{ t('team.backToChat') }}</button>
      </div>
    </div>
  </div>
</template>
