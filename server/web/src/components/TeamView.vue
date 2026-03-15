<script setup>
import { inject } from 'vue';
import TeamCreatePanel from './TeamCreatePanel.vue';
import TeamDashboard from './TeamDashboard.vue';
import AgentDetail from './AgentDetail.vue';

const store = inject('store');
const teamStore = inject('team');

const { t, viewMode } = store;

const {
  displayTeam,
  activeAgentView,
  isTeamRunning,
  isTeamActive,
  instructionExpanded,
  dissolveTeam,
  newTeam,
  backToChat,
  viewAgent,
} = teamStore;
</script>

<template>
  <template v-if="viewMode === 'team'">
    <!-- Team creation panel (no active team) -->
    <TeamCreatePanel v-if="!displayTeam" />

    <!-- Active/historical team dashboard -->
    <div v-else class="team-dashboard">
      <!-- Dashboard header -->
      <div class="team-dash-header">
        <div class="team-dash-header-top">
          <span :class="['team-status-badge', 'team-status-' + displayTeam.status]">{{ displayTeam.status }}</span>
          <div class="team-dash-header-right">
            <button v-if="isTeamRunning" class="team-dissolve-btn" @click="dissolveTeam()">{{ t('team.dissolveTeam') }}</button>
            <button v-if="!isTeamActive" class="team-new-btn" @click="newTeam()">{{ t('team.newTeam') }}</button>
            <button v-if="!isTeamActive" class="team-back-btn" @click="backToChat()">{{ t('team.backToChat') }}</button>
          </div>
        </div>
        <div class="team-dash-instruction" :class="{ expanded: instructionExpanded }">
          <div class="team-dash-instruction-text">{{ displayTeam.config?.instruction || displayTeam.title || t('team.agentTeam') }}</div>
          <button v-if="(displayTeam.config?.instruction || '').length > 120" class="team-dash-instruction-toggle" @click="instructionExpanded = !instructionExpanded">
            {{ instructionExpanded ? t('team.showLess') : t('team.showMore') }}
          </button>
        </div>
      </div>

      <!-- Lead status bar (clickable to view lead detail) -->
      <div v-if="displayTeam.leadStatus && (displayTeam.status === 'planning' || displayTeam.status === 'running' || displayTeam.status === 'summarizing')" class="team-lead-bar team-lead-bar-clickable" @click="viewAgent('lead')">
        <span class="team-lead-dot"></span>
        <span class="team-lead-label">{{ t('team.lead') }}</span>
        <span class="team-lead-text">{{ displayTeam.leadStatus }}</span>
      </div>

      <!-- Dashboard body -->
      <div class="team-dash-body">
        <!-- Main content: kanban + agents + feed (dashboard view) -->
        <TeamDashboard v-if="!activeAgentView" />

        <!-- Agent detail view -->
        <AgentDetail v-else />
      </div>
    </div>
  </template>
</template>
