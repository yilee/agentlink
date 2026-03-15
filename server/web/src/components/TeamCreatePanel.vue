<script setup>
import { inject } from 'vue';

const store = inject('store');
const teamStore = inject('team');

const { t } = store;

const {
  TEMPLATES,
  TEMPLATE_KEYS,
  teamsList,
  selectedTemplate,
  onTemplateChange,
  editedLeadPrompt,
  leadPromptExpanded,
  leadPromptPreview,
  resetLeadPrompt,
  teamInstruction,
  teamExamples,
  launchTeamFromPanel,
  backToChat,
  viewHistoricalTeam,
} = teamStore;
</script>

<template>
  <div class="team-create-panel">
    <div class="team-create-inner">
      <div class="team-create-header">
        <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" opacity="0.5" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        <h2>{{ t('team.launchAgentTeam') }}</h2>
      </div>
      <p class="team-create-desc">{{ t('team.selectTemplateDesc') }}</p>

      <!-- Template selector -->
      <div class="team-tpl-section">
        <label class="team-tpl-label">{{ t('team.template') }}</label>
        <select class="team-tpl-select" :value="selectedTemplate" @change="onTemplateChange($event.target.value)">
          <option v-for="key in TEMPLATE_KEYS" :key="key" :value="key">{{ TEMPLATES[key].label }}</option>
        </select>
        <span class="team-tpl-desc">{{ TEMPLATES[selectedTemplate].description }}</span>
      </div>

      <!-- Collapsible lead prompt -->
      <div class="team-lead-prompt-section">
        <div class="team-lead-prompt-header" @click="leadPromptExpanded = !leadPromptExpanded">
          <svg class="team-lead-prompt-arrow" :class="{ expanded: leadPromptExpanded }" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>
          <span class="team-lead-prompt-title">{{ t('team.leadPrompt') }}</span>
          <span v-if="!leadPromptExpanded" class="team-lead-prompt-preview">{{ leadPromptPreview() }}</span>
        </div>
        <div v-if="leadPromptExpanded" class="team-lead-prompt-body">
          <textarea
            v-model="editedLeadPrompt"
            class="team-lead-prompt-textarea"
            rows="10"
          ></textarea>
          <div class="team-lead-prompt-actions">
            <button class="team-lead-prompt-reset" @click="resetLeadPrompt()" :title="t('team.reset')">{{ t('team.reset') }}</button>
          </div>
        </div>
      </div>

      <!-- Task description -->
      <div class="team-tpl-section">
        <label class="team-tpl-label">{{ t('team.taskDescription') }}</label>
        <textarea
          v-model="teamInstruction"
          class="team-create-textarea"
          :placeholder="t('team.taskPlaceholder')"
          rows="4"
        ></textarea>
      </div>

      <div class="team-create-actions">
        <button class="team-create-launch" :disabled="!teamInstruction.trim()" @click="launchTeamFromPanel()">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
          {{ t('team.launchTeam') }}
        </button>
        <button class="team-create-cancel" @click="backToChat()">{{ t('team.backToChat') }}</button>
      </div>

      <!-- Example instructions -->
      <div class="team-examples-section">
        <div class="team-examples-header">{{ t('team.examples') }}</div>
        <div class="team-examples-list">
          <div class="team-example-card" v-for="(ex, i) in teamExamples" :key="i">
            <div class="team-example-icon" v-html="ex.icon"></div>
            <div class="team-example-body">
              <div class="team-example-title">{{ ex.title }}</div>
              <div class="team-example-text">{{ ex.text }}</div>
            </div>
            <button class="team-example-try" @click="onTemplateChange(ex.template); teamInstruction = ex.text">{{ t('team.tryIt') }}</button>
          </div>
        </div>
      </div>

      <!-- Historical teams -->
      <div v-if="teamsList.length > 0" class="team-history-section">
        <div class="team-history-section-header">{{ t('team.previousTeams') }}</div>
        <div class="team-history-list">
          <div
            v-for="tm in teamsList" :key="tm.teamId"
            class="team-history-item"
            @click="viewHistoricalTeam(tm.teamId)"
            :title="tm.title"
          >
            <div class="team-history-info">
              <div class="team-history-title">{{ tm.title || t('sidebar.untitledTeam') }}</div>
              <div class="team-history-meta">
                <span :class="['team-status-badge', 'team-status-badge-sm', 'team-status-' + tm.status]">{{ tm.status }}</span>
                <span v-if="tm.taskCount" class="team-history-tasks">{{ tm.taskCount }} {{ t('sidebar.tasks') }}</span>
                <span v-if="tm.totalCost" class="team-history-tasks">{{'$' + tm.totalCost.toFixed(2) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
