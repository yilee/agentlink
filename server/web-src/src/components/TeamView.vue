<script setup>
import { inject } from 'vue';

const store = inject('store');
const {
  TEMPLATES,
  TEMPLATE_KEYS,
  t,
  displayTeam,
  historicalTeam,
  teamsList,
  activeAgentView,
  viewDashboard,
  viewAgent,
  viewAgentWithHistory,
  findAgent,
  isTeamActive,
  isTeamRunning,
  teamInstruction,
  teamExamples,
  selectedTemplate,
  onTemplateChange,
  editedLeadPrompt,
  leadPromptExpanded,
  leadPromptPreview,
  resetLeadPrompt,
  launchTeamFromPanel,
  dissolveTeam,
  newTeam,
  backToChat,
  pendingTasks,
  activeTasks,
  doneTasks,
  failedTasks,
  getTaskAgent,
  kanbanExpanded,
  instructionExpanded,
  getAgentColor,
  getAgentMessages,
  getLatestAgentActivity,
  feedAgentName,
  feedContentRest,
  formatTeamTime,
  formatDuration,
  getRenderedContent,
  getToolIcon,
  messages,
  status,
  viewMode,
  viewHistoricalTeam,
  launchTeam,
  getToolSummary,
  getEditDiffHtml,
  team,
  toggleTool,
  isEditTool,
  getFormattedToolInput
} = store;
</script>

<template>
          <template v-if="viewMode === 'team'">

            <!-- Team creation panel (no active team) -->
            <div v-if="!displayTeam" class="team-create-panel">
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
                <div v-if="!activeAgentView" class="team-dash-main">

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

                <!-- Agent detail view -->
                <div v-else class="team-agent-detail">
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

              </div>
            </div>
          </template>
</template>
