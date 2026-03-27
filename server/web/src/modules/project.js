// ── Project module — Project Knowledge Base feed, detail, and chat ──────────
import { ref, computed, nextTick } from 'vue';
import { useConfirmDialog } from '../composables/useConfirmDialog.js';

/**
 * Build project context string for injecting into first chat message.
 * Pure function — easily testable.
 */
export function buildProjectContext(projectName, allContent) {
  if (!allContent) return '';
  let ctx = `[Project Context — You are answering questions about the "${projectName}" project]\n\n`;
  ctx += allContent + '\n';
  ctx += '\n## Source Files (relative to working directory ~/BrainData/)\n';
  ctx += `- Project directory: projects/${projectName}/project/\n`;
  ctx += `- Overview: projects/${projectName}/project/overview.md\n`;
  ctx += `- Team: projects/${projectName}/project/team.md\n`;
  ctx += `- Timeline: projects/${projectName}/project/timeline.md\n`;
  ctx += `- Decisions: projects/${projectName}/project/decisions.md\n`;
  ctx += `- Workstreams: projects/${projectName}/project/workstreams/\n`;
  ctx += `- Cross-cutting: projects/${projectName}/project/cross_cutting/\n\n`;
  ctx += 'You can Read these files for more detail if needed.\n';
  ctx += '\n</brain-context>\n';
  return ctx;
}

/**
 * Concatenate all project detail content into a single string for context injection.
 */
function concatProjectContent(detail) {
  if (!detail) return '';
  const parts = [];
  if (detail.overview) parts.push('## Overview\n' + detail.overview);
  if (detail.team) parts.push('## Team\n' + detail.team);
  if (detail.timeline) parts.push('## Timeline\n' + detail.timeline);
  if (detail.decisions) parts.push('## Decisions\n' + detail.decisions);
  if (detail.workstreams && detail.workstreams.length > 0) {
    parts.push('## Workstreams\n' + detail.workstreams.map(w => `### ${w.name}\n${w.content}`).join('\n\n'));
  }
  if (detail.blockers) parts.push('## Blockers\n' + detail.blockers);
  if (detail.pendingDecisions) parts.push('## Pending Decisions\n' + detail.pendingDecisions);
  if (detail.staleItems) parts.push('## Stale Items\n' + detail.staleItems);
  if (detail.codePaths) parts.push('## Code Paths\n' + detail.codePaths);
  if (detail.missingInfo) parts.push('## Missing Info\n' + detail.missingInfo);
  if (detail.gapAnalysis) parts.push('## Gap Analysis\n' + detail.gapAnalysis);
  return parts.join('\n\n');
}

/**
 * Creates the project state module.
 * @param {object} deps - { wsSend, currentView, switchConversation, conversationCache,
 *   messages, currentConversationId, currentClaudeSessionId, needsResume, loadingHistory,
 *   setBrainMode, scrollToBottom, historySessions, loadingSessions }
 */
export function createProject({ wsSend, currentView, switchConversation, conversationCache,
                                messages, currentConversationId, currentClaudeSessionId,
                                needsResume, loadingHistory, setBrainMode, scrollToBottom,
                                historySessions, loadingSessions }) {
  // ── Feed State ──
  const projects = ref([]);
  const loading = ref(false);

  // ── Detail State ──
  const selectedProject = ref(null); // project name (exposed as selectedProjectName)
  const selectedDetail = ref(null);  // full project detail object
  const detailLoading = ref(false);
  const detailExpanded = ref(false);
  const detailHeight = ref(parseInt(localStorage.getItem('agentlink-project-detail-height')) || 0);

  // Section collapse state — Overview expanded by default, rest collapsed
  const sectionCollapsed = ref(JSON.parse(localStorage.getItem('agentlink-project-sections') || '{}'));

  function isSectionCollapsed(section) {
    if (sectionCollapsed.value[section] === undefined) {
      // Default: overview expanded, all others collapsed
      return section !== 'overview';
    }
    return sectionCollapsed.value[section];
  }

  function toggleSection(section) {
    sectionCollapsed.value[section] = !isSectionCollapsed(section);
    localStorage.setItem('agentlink-project-sections', JSON.stringify(sectionCollapsed.value));
  }

  // ── Detail / Chat resize handle ──
  const MIN_DETAIL_HEIGHT = 60;
  const MAX_DETAIL_RATIO = 0.7;
  let _resizing = false;
  let _startY = 0;
  let _startHeight = 0;
  let _containerEl = null;

  function onDetailResizeStart(e, containerEl) {
    e.preventDefault();
    _resizing = true;
    _startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    const contentEl = containerEl.querySelector('.project-detail-content');
    _startHeight = contentEl ? contentEl.offsetHeight : 200;
    _containerEl = containerEl;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    if (e.type === 'touchstart') {
      document.addEventListener('touchmove', onDetailResizeMove, { passive: false });
      document.addEventListener('touchend', onDetailResizeEnd);
    } else {
      document.addEventListener('mousemove', onDetailResizeMove);
      document.addEventListener('mouseup', onDetailResizeEnd);
    }
  }

  function onDetailResizeMove(e) {
    if (!_resizing || !_containerEl) return;
    if (e.type === 'touchmove') e.preventDefault();
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    const delta = clientY - _startY;
    const maxHeight = _containerEl.offsetHeight * MAX_DETAIL_RATIO;
    const newHeight = Math.max(MIN_DETAIL_HEIGHT, Math.min(maxHeight, _startHeight + delta));
    detailHeight.value = Math.round(newHeight);
  }

  function onDetailResizeEnd() {
    if (!_resizing) return;
    _resizing = false;
    _containerEl = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.removeEventListener('mousemove', onDetailResizeMove);
    document.removeEventListener('mouseup', onDetailResizeEnd);
    document.removeEventListener('touchmove', onDetailResizeMove);
    document.removeEventListener('touchend', onDetailResizeEnd);
    if (detailHeight.value > 0) {
      localStorage.setItem('agentlink-project-detail-height', String(detailHeight.value));
    }
  }

  // ── Chat State ──
  const projectChatActive = ref(false);
  const activeProjectSessionId = ref(null);
  const collapsedGroups = ref({});

  let _previousConvId = null;
  let _pendingProjectTitle = null;
  let _requestSessionList = null;

  // ── Concatenated content for context ──
  const selectedContent = computed(() => {
    return concatProjectContent(selectedDetail.value);
  });

  // ── Feed ──

  function loadFeed() {
    loading.value = true;
    wsSend({ type: 'list_projects' });
  }

  function handleProjectsList(msg) {
    projects.value = msg.projects || [];
    loading.value = false;
  }

  let _autoRefreshTimer = null;
  const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

  function startAutoRefresh() {
    stopAutoRefresh();
    _autoRefreshTimer = setInterval(() => loadFeed(), AUTO_REFRESH_INTERVAL);
  }

  function stopAutoRefresh() {
    if (_autoRefreshTimer) {
      clearInterval(_autoRefreshTimer);
      _autoRefreshTimer = null;
    }
  }

  // ── Detail ──

  function selectProject(projectName) {
    selectedProject.value = projectName;
    selectedDetail.value = null;
    detailLoading.value = true;
    detailExpanded.value = true;
    currentView.value = 'project-detail';
    wsSend({ type: 'get_project_detail', projectName });
  }

  function handleProjectDetail(msg) {
    if (msg.name === selectedProject.value) {
      selectedDetail.value = msg;
    }
    detailLoading.value = false;
  }

  function goBackToFeed() {
    if (projectChatActive.value) {
      exitProjectChat();
    }
    selectedProject.value = null;
    selectedDetail.value = null;
    detailLoading.value = false;
    currentView.value = 'project-feed';
  }

  // ── Project Chat Functions ──

  function enterProjectChat(projectName) {
    const convId = `project-chat-${projectName}`;
    _previousConvId = currentConversationId.value;
    if (conversationCache.value[convId]) {
      delete conversationCache.value[convId];
    }
    switchConversation(convId);
    projectChatActive.value = true;
    activeProjectSessionId.value = null;
    setBrainMode(true);
    currentClaudeSessionId.value = null;
    nextTick(() => nextTick(() => scrollToBottom(true)));
  }

  function enterProjectChatSession(projectName, claudeSessionId) {
    const convId = `project-chat-${claudeSessionId}`;
    _previousConvId = currentConversationId.value;
    switchConversation(convId);
    projectChatActive.value = true;
    activeProjectSessionId.value = claudeSessionId;
    setBrainMode(true);

    nextTick(() => nextTick(() => scrollToBottom(true)));

    const cached = conversationCache.value[convId];
    const hasHistory = (cached && cached.messages && cached.messages.length > 0)
                    || messages.value.length > 0;
    if (!hasHistory) {
      currentClaudeSessionId.value = claudeSessionId;
      needsResume.value = true;
      loadingHistory.value = true;
      wsSend({
        type: 'resume_conversation',
        conversationId: convId,
        claudeSessionId,
      });
    }
  }

  function exitProjectChat() {
    if (_previousConvId) {
      switchConversation(_previousConvId);
    }
    projectChatActive.value = false;
    activeProjectSessionId.value = null;
    _previousConvId = null;
  }

  function sendProjectChat(text, projectName, content) {
    let prompt = text;
    if (!currentClaudeSessionId.value) {
      const ctx = buildProjectContext(projectName, content);
      prompt = ctx + text;
      _pendingProjectTitle = text.trim().substring(0, 100);
    }

    wsSend({
      type: 'chat',
      conversationId: currentConversationId.value,
      prompt,
      brainMode: true,
      projectName,
    });
  }

  function resetProjectChat(projectName) {
    const prevConvId = currentConversationId.value;
    const claudeSessionId = currentClaudeSessionId.value;

    if (prevConvId && conversationCache.value[prevConvId]) {
      delete conversationCache.value[prevConvId];
    }

    if (claudeSessionId) {
      wsSend({ type: 'delete_session', sessionId: claudeSessionId });
    }

    const newConvId = `project-chat-${projectName}`;
    if (conversationCache.value[newConvId]) {
      delete conversationCache.value[newConvId];
    }
    switchConversation(newConvId);
    activeProjectSessionId.value = null;
    currentClaudeSessionId.value = null;
    needsResume.value = false;
    messages.value.length = 0;
  }

  // ── Feed Sidebar Chat History ──

  const renamingChatSessionId = ref(null);
  const renameChatText = ref('');

  const { showConfirm } = useConfirmDialog();

  const projectChatSessions = computed(() => {
    const sessions = historySessions ? historySessions.value : [];
    return sessions
      .filter(s => s.projectName)
      .map(s => ({
        ...s,
        displayTitle: s.customTitle || s.projectName,
      }))
      .sort((a, b) => b.lastModified - a.lastModified);
  });

  const _refreshing = ref(false);
  const projectChatLoading = computed(() => loading.value || loadingSessions.value || _refreshing.value);

  const groupedProjectChatSessions = computed(() => {
    const sessions = projectChatSessions.value;
    if (!sessions.length) return [];
    const groupMap = {};
    for (const s of sessions) {
      const key = s.projectName;
      if (!groupMap[key]) {
        groupMap[key] = {
          projectName: key,
          entityKey: key,
          entityTitle: key,
          sessions: [],
        };
      }
      groupMap[key].sessions.push(s);
    }
    const groups = Object.values(groupMap);
    groups.sort((a, b) => b.sessions[0].lastModified - a.sessions[0].lastModified);
    return groups;
  });

  function refreshProjectChats() {
    _refreshing.value = true;
    loadFeed();
    if (_requestSessionList) _requestSessionList();
    setTimeout(() => { _refreshing.value = false; }, 500);
  }

  function setRequestSessionList(fn) { _requestSessionList = fn; }

  function navigateToProjectChat(session) {
    if (!session.projectName) return;
    if (projectChatActive.value) {
      exitProjectChat();
    }
    selectProject(session.projectName);
    if (currentView) currentView.value = 'project-detail';
    enterProjectChatSession(session.projectName, session.sessionId);
  }

  function deleteProjectChatSession(session) {
    const convIdByProject = `project-chat-${session.projectName}`;
    const convIdBySession = `project-chat-${session.sessionId}`;
    const cached1 = conversationCache.value[convIdByProject];
    const cached2 = conversationCache.value[convIdBySession];
    if ((cached1 && cached1.isProcessing) || (cached2 && cached2.isProcessing)) return;

    showConfirm({
      title: 'Delete Chat History',
      message: 'Delete chat history for this project?',
      itemName: session.displayTitle,
      warning: 'Chat history will be permanently deleted.',
      confirmText: 'Delete',
      onConfirm: () => {
        if (projectChatActive.value && activeProjectSessionId.value === session.sessionId) {
          goBackToFeed();
        }
        wsSend({ type: 'delete_session', sessionId: session.sessionId });
        if (conversationCache.value[convIdBySession]) {
          delete conversationCache.value[convIdBySession];
        }
      },
    });
  }

  function renameProjectChatSession(sessionId, newTitle) {
    if (!sessionId || !newTitle.trim()) {
      cancelChatRename();
      return;
    }
    wsSend({ type: 'rename_session', sessionId, newTitle: newTitle.trim() });
    renamingChatSessionId.value = null;
    renameChatText.value = '';
  }

  function startChatRename(session) {
    renamingChatSessionId.value = session.sessionId;
    renameChatText.value = session.displayTitle || '';
  }

  function cancelChatRename() {
    renamingChatSessionId.value = null;
    renameChatText.value = '';
  }

  function handleProjectSessionStarted(claudeSessionId) {
    if (!projectChatActive.value) return;
    activeProjectSessionId.value = claudeSessionId;

    if (_pendingProjectTitle) {
      const title = _pendingProjectTitle;
      _pendingProjectTitle = null;
      wsSend({ type: 'rename_session', sessionId: claudeSessionId, newTitle: title });
    }
  }

  return {
    // Feed
    projects, loading,
    loadFeed, handleProjectsList,
    startAutoRefresh, stopAutoRefresh,
    // Detail
    selectedProject, selectedProjectName: selectedProject,
    selectedDetail, selectedContent, selectedAllContent: selectedContent,
    detailLoading, detailExpanded, detailHeight,
    sectionCollapsed, isSectionCollapsed, toggleSection,
    selectProject, goBackToFeed, handleProjectDetail,
    onDetailResizeStart,
    // Project chat
    projectChatActive, activeProjectSessionId,
    enterProjectChat, enterProjectChatSession, exitProjectChat,
    sendProjectChat, resetProjectChat,
    handleProjectSessionStarted,
    // Feed sidebar chat history
    projectChatSessions, projectChatLoading, groupedProjectChatSessions,
    navigateToProjectChat, refreshProjectChats, setRequestSessionList,
    deleteProjectChatSession, renameProjectChatSession,
    startChatRename, cancelChatRename,
    renamingChatSessionId, renameChatText, collapsedGroups,
  };
}
