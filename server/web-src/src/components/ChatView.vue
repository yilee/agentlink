<script setup>
import { inject } from 'vue';

const store = inject('store');
const teamStore = inject('team');

const {
  messages,
  status,
  viewMode,
  t,
  getRenderedContent,
  getToolIcon,
  getToolSummary,
  isPrevAssistant,
  toggleContextSummary,
  selectQuestionOption,
  submitQuestionAnswer,
  hasQuestionAnswer,
  attachments,
  planMode,
  onMessageListScroll,
  loadingHistory,
  btwState,
  agentName,
  getEditDiffHtml,
  getQuestionResponseSummary,
  pendingPlanMode,
  workDir,
  visibleMessages,
  hasMoreMessages,
  loadMoreMessages,
  isProcessing,
  hasStreamingMessage,
  formatTimestamp,
  copyMessage,
  toggleTool,
  isEditTool,
  getFormattedToolInput
} = store;

const { teamState: team } = teamStore;
</script>

<template>
          <template v-if="viewMode === 'chat'">
          <div class="message-list" @scroll="onMessageListScroll">
            <div class="message-list-inner">
              <div v-if="messages.length === 0 && status === 'Connected' && !loadingHistory" class="empty-state">
                <div class="empty-state-icon">
                  <svg viewBox="0 0 24 24" width="48" height="48"><path fill="currentColor" opacity="0.4" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
                </div>
                <p>{{ t('chat.connectedTo') }} <strong>{{ agentName }}</strong></p>
                <p class="muted">{{ workDir }}</p>
                <p class="muted" style="margin-top: 0.5rem;">{{ t('chat.sendToStart') }}</p>
              </div>

              <div v-if="loadingHistory" class="history-loading">
                <div class="history-loading-spinner"></div>
                <span>{{ t('chat.loadingHistory') }}</span>
              </div>

              <div v-if="hasMoreMessages" class="load-more-wrapper">
                <button class="load-more-btn" @click="loadMoreMessages">{{ t('chat.loadEarlier') }}</button>
              </div>

              <div v-for="(msg, msgIdx) in visibleMessages" :key="msg.id" :class="['message', 'message-' + msg.role]">

                <!-- User message -->
                <template v-if="msg.role === 'user'">
                  <div class="message-role-label user-label">{{ t('chat.you') }}</div>
                  <div class="message-bubble user-bubble" :title="formatTimestamp(msg.timestamp)">
                    <div class="message-content">{{ msg.content }}</div>
                    <div v-if="msg.attachments && msg.attachments.length" class="message-attachments">
                      <div v-for="(att, ai) in msg.attachments" :key="ai" class="message-attachment-chip">
                        <img v-if="att.isImage && att.thumbUrl" :src="att.thumbUrl" class="message-attachment-thumb" />
                        <span v-else class="message-attachment-file-icon">
                          <svg viewBox="0 0 16 16" width="12" height="12"><path fill="currentColor" d="M1 2.5A2.5 2.5 0 0 1 3.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75H3.5a1 1 0 0 0-1 1h9.25a.75.75 0 0 1 0 1.5H3.5A2.5 2.5 0 0 1 1 14V2.5z"/></svg>
                        </span>
                        <span>{{ att.name }}</span>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Assistant message (markdown) -->
                <template v-else-if="msg.role === 'assistant'">
                  <div v-if="!isPrevAssistant(msgIdx)" class="message-role-label assistant-label">{{ t('chat.claude') }}</div>
                  <div :class="['message-bubble', 'assistant-bubble', { streaming: msg.isStreaming }]" :title="formatTimestamp(msg.timestamp)">
                    <div class="message-actions">
                      <button class="icon-btn" @click="copyMessage(msg)" :title="msg.copied ? t('chat.copied') : t('chat.copy')">
                        <svg v-if="!msg.copied" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                        <svg v-else viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                      </button>
                    </div>
                    <div class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
                  </div>
                </template>

                <!-- Agent tool call (team-styled) -->
                <div v-else-if="msg.role === 'tool' && msg.toolName === 'Agent'" class="tool-line-wrapper team-agent-tool-wrapper">
                  <div :class="['tool-line', 'team-agent-tool-line', { completed: msg.hasResult, running: !msg.hasResult }]" @click="toggleTool(msg)">
                    <span class="team-agent-tool-icon">
                      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                    </span>
                    <span class="team-agent-tool-name">Agent</span>
                    <span class="team-agent-tool-desc">{{ getToolSummary(msg) }}</span>
                    <span class="tool-status-icon" v-if="msg.hasResult">\u{2713}</span>
                    <span class="tool-status-icon running-dots" v-else>
                      <span></span><span></span><span></span>
                    </span>
                    <span class="tool-toggle">{{ msg.expanded ? '\u{25B2}' : '\u{25BC}' }}</span>
                  </div>
                  <div v-if="msg.expanded" class="tool-expand team-agent-tool-expand">
                    <pre v-if="msg.toolInput" class="tool-block">{{ msg.toolInput }}</pre>
                    <div v-if="msg.toolOutput" class="team-agent-tool-result">
                      <div class="team-agent-tool-result-label">{{ t('team.agentResult') }}</div>
                      <div class="team-agent-tool-result-content markdown-body" v-html="getRenderedContent({ role: 'assistant', content: msg.toolOutput })"></div>
                    </div>
                  </div>
                </div>

                <!-- Plan mode switch indicator -->
                <div v-else-if="msg.role === 'tool' && (msg.toolName === 'EnterPlanMode' || msg.toolName === 'ExitPlanMode')" class="plan-mode-divider">
                  <span class="plan-mode-divider-line"></span>
                  <span class="plan-mode-divider-text">{{ msg.toolName === 'EnterPlanMode' ? t('tool.enteredPlanMode') : t('tool.exitedPlanMode') }}</span>
                  <span class="plan-mode-divider-line"></span>
                </div>

                <!-- Tool use block (collapsible) -->
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

                <!-- AskUserQuestion interactive card -->
                <div v-else-if="msg.role === 'ask-question'" class="ask-question-wrapper">
                  <div v-if="!msg.answered" class="ask-question-card">
                    <div v-for="(q, qi) in msg.questions" :key="qi" class="ask-question-block">
                      <div v-if="q.header" class="ask-question-header">{{ q.header }}</div>
                      <div class="ask-question-text">{{ q.question }}</div>
                      <div class="ask-question-options">
                        <div
                          v-for="(opt, oi) in q.options" :key="oi"
                          :class="['ask-question-option', {
                            selected: q.multiSelect
                              ? (msg.selectedAnswers[qi] || []).includes(opt.label)
                              : msg.selectedAnswers[qi] === opt.label
                          }]"
                          @click="selectQuestionOption(msg, qi, opt.label)"
                        >
                          <div class="ask-option-label">{{ opt.label }}</div>
                          <div v-if="opt.description" class="ask-option-desc">{{ opt.description }}</div>
                        </div>
                      </div>
                      <div class="ask-question-custom">
                        <input
                          type="text"
                          v-model="msg.customTexts[qi]"
                          :placeholder="t('chat.customResponse')"
                          @input="msg.selectedAnswers[qi] = q.multiSelect ? [] : null"
                          @keydown.enter="hasQuestionAnswer(msg) && submitQuestionAnswer(msg)"
                        />
                      </div>
                    </div>
                    <div class="ask-question-actions">
                      <button class="ask-question-submit" :disabled="!hasQuestionAnswer(msg)" @click="submitQuestionAnswer(msg)">
                        {{ t('chat.submit') }}
                      </button>
                    </div>
                  </div>
                  <div v-else class="ask-question-answered">
                    <span class="ask-answered-icon">\u{2713}</span>
                    <span class="ask-answered-text">{{ getQuestionResponseSummary(msg) }}</span>
                  </div>
                </div>

                <!-- Context summary (collapsed by default) -->
                <div v-else-if="msg.role === 'context-summary'" class="context-summary-wrapper">
                  <div class="context-summary-bar" @click="toggleContextSummary(msg)">
                    <svg class="context-summary-icon" viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25Zm1.75-.25a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25Zm7 2.25v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 9a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/></svg>
                    <span class="context-summary-label">{{ t('chat.contextContinued') }}</span>
                    <span class="context-summary-toggle">{{ msg.contextExpanded ? t('chat.hide') : t('chat.show') }}</span>
                  </div>
                  <div v-if="msg.contextExpanded" class="context-summary-body">
                    <div class="markdown-body" v-html="getRenderedContent({ role: 'assistant', content: msg.content })"></div>
                  </div>
                </div>

                <!-- System message -->
                <div v-else-if="msg.role === 'system'" :class="['system-msg', { 'compact-msg': msg.isCompactStart, 'command-output-msg': msg.isCommandOutput, 'error-msg': msg.isError }]">
                  <template v-if="msg.isCompactStart && !msg.compactDone">
                    <span class="compact-inline-spinner"></span>
                  </template>
                  <template v-if="msg.isCompactStart && msg.compactDone">
                    <span class="compact-done-icon">✓</span>
                  </template>
                  <div v-if="msg.isCommandOutput" class="message-content markdown-body" v-html="getRenderedContent(msg)"></div>
                  <template v-else>{{ msg.content }}</template>
                </div>
              </div>

              <div v-if="isProcessing && !hasStreamingMessage" class="typing-indicator">
                <span></span><span></span><span></span>
                <span v-if="pendingPlanMode" class="typing-label">{{ pendingPlanMode === 'enter' ? t('tool.enteringPlanMode') : t('tool.exitingPlanMode') }}</span>
              </div>
            </div>
          </div>
          </template>
</template>
