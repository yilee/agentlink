<script setup>
import { inject, computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { renderMarkdown } from '../modules/markdown.js';
import MessageList from './MessageList.vue';

const store = inject('store');
const project = inject('project');

const {
  currentView, messages,
  isProcessing, hasStreamingMessage, loadingHistory,
  onMessageListScroll,
} = store;
const {
  selectedProject, selectedDetail, selectedContent,
  detailLoading, projectChatActive, detailExpanded, detailHeight,
  onDetailResizeStart,
} = project;

const headerTitle = computed(() => {
  const detail = selectedDetail.value;
  if (detail) return detail.name;
  return selectedProject.value || '';
});

// ── Sections: build from detail data ──
const sections = computed(() => {
  const detail = selectedDetail.value;
  if (!detail) return [];
  const s = [];

  if (detail.overview) {
    s.push({ key: 'overview', label: 'Overview', content: detail.overview });
  }

  if (detail.workstreams && detail.workstreams.length > 0) {
    const md = detail.workstreams.map(w => `### ${w.name}\n${w.content}`).join('\n\n---\n\n');
    s.push({ key: 'workstreams', label: `Workstreams (${detail.workstreams.length})`, content: md });
  }

  if (detail.decisions) {
    s.push({ key: 'decisions', label: 'Decisions', content: detail.decisions });
  }

  if (detail.timeline) {
    s.push({ key: 'timeline', label: 'Timeline', content: detail.timeline });
  }

  if (detail.team) {
    s.push({ key: 'team', label: 'Team', content: detail.team });
  }

  // Risks & Issues (combined section)
  const riskParts = [];
  if (detail.blockers) riskParts.push('### Blockers\n' + detail.blockers);
  if (detail.pendingDecisions) riskParts.push('### Pending Decisions\n' + detail.pendingDecisions);
  if (detail.staleItems) riskParts.push('### Stale Items\n' + detail.staleItems);
  if (riskParts.length > 0) {
    s.push({ key: 'risks', label: 'Risks & Issues', content: riskParts.join('\n\n') });
  }

  // References (combined section)
  const refParts = [];
  if (detail.codePaths) refParts.push('### Code Paths\n' + detail.codePaths);
  if (detail.missingInfo) refParts.push('### Missing Info\n' + detail.missingInfo);
  if (detail.gapAnalysis) refParts.push('### Gap Analysis\n' + detail.gapAnalysis);
  if (detail.schema) refParts.push('### Schema\n' + detail.schema);
  if (refParts.length > 0) {
    s.push({ key: 'references', label: 'References', content: refParts.join('\n\n') });
  }

  return s;
});

// ── Active tab ──
const STORAGE_KEY = 'agentlink-project-active-tab';
const activeTab = ref(localStorage.getItem(STORAGE_KEY) || 'overview');

// Ensure activeTab is valid when sections change
watch(sections, (newSections) => {
  if (newSections.length > 0 && !newSections.find(s => s.key === activeTab.value)) {
    activeTab.value = newSections[0].key;
  }
});

function selectTab(key) {
  activeTab.value = key;
  localStorage.setItem(STORAGE_KEY, key);
}

const activeSection = computed(() => {
  return sections.value.find(s => s.key === activeTab.value) || sections.value[0] || null;
});

function renderedSection(content) {
  if (!content) return '';
  return renderMarkdown(content);
}

const detailBodyRef = ref(null);

const detailContentStyle = computed(() => {
  if (detailHeight.value > 0) {
    return { height: detailHeight.value + 'px', maxHeight: 'none' };
  }
  return {};
});

function startResize(e) {
  if (detailBodyRef.value) {
    onDetailResizeStart(e, detailBodyRef.value);
  }
}

function goBack() {
  project.goBackToFeed();
}

function toggleDetail() {
  detailExpanded.value = !detailExpanded.value;
}

function resetChat() {
  if (selectedProject.value) {
    project.resetProjectChat(selectedProject.value);
  }
}

onMounted(() => {
  if (selectedProject.value && !projectChatActive.value) {
    project.enterProjectChat(selectedProject.value);
  }
});

onUnmounted(() => {
  if (projectChatActive.value) {
    project.exitProjectChat();
  }
});
</script>

<template>
  <div class="project-detail" v-if="currentView === 'project-detail'">
    <div class="devops-detail-back" @click="goBack">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
      Back
    </div>

    <div v-if="detailLoading" class="devops-detail-loading">
      <div class="devops-detail-spinner"></div>
      <span>Loading project...</span>
    </div>

    <div v-else-if="!selectedDetail" class="devops-detail-empty">
      <p>Project detail not available.</p>
    </div>

    <div v-else class="devops-detail-body" ref="detailBodyRef">
      <!-- Collapsible header bar -->
      <div class="devops-detail-collapse-header" @click="toggleDetail">
        <span class="devops-detail-collapse-icon">{{ detailExpanded ? '&#x25B2;' : '&#x25BC;' }}</span>
        <span class="devops-detail-name-inline">
          <span class="devops-detail-icon">&#x1F4DA;</span>
          {{ headerTitle }}
        </span>
      </div>

      <div v-if="detailExpanded" class="devops-detail-content project-detail-content" :style="detailContentStyle">
        <!-- Tab pills -->
        <div class="project-tab-bar">
          <button
            v-for="section in sections"
            :key="section.key"
            class="project-tab-pill"
            :class="{ active: activeTab === section.key }"
            @click="selectTab(section.key)"
          >
            {{ section.label }}
          </button>
        </div>

        <!-- Active section content -->
        <div v-if="activeSection" class="project-tab-content">
          <div class="devops-detail-markdown markdown-body" v-html="renderedSection(activeSection.content)"></div>
        </div>
      </div>

      <!-- Resize handle -->
      <div v-if="detailExpanded" class="devops-resize-handle" @mousedown="startResize($event)" @touchstart="startResize($event)">
        <div class="devops-resize-handle-bar"></div>
      </div>

      <!-- Chat area -->
      <div class="devops-chat-area">
        <MessageList
          :messages="messages"
          :is-processing="isProcessing"
          :has-streaming-message="hasStreamingMessage"
          :loading-history="loadingHistory"
          :compact="true"
          @scroll="onMessageListScroll"
        >
          <template #empty>
            <div class="devops-chat-empty">
              <div class="devops-chat-empty-icon">&#x1F4AC;</div>
              <p>Ask anything about this project</p>
              <p class="muted">e.g. "What's blocking progress?" or "Summarize the team structure"</p>
            </div>
          </template>
        </MessageList>
      </div>
    </div>
  </div>
</template>
