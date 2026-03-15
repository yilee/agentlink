// ── Feature-specific message handlers (btw, plan mode, workdir) ───────────────

export function createFeatureHandlers(deps) {
  const {
    messages, isProcessing, streaming, scrollToBottom,
    btwState, btwPending, setPlanMode,
    workDir, workdirSwitching, sessionId,
    currentConversationId, processingConversations,
    queuedMessages, visibleLimit, currentClaudeSessionId,
    historySessions, memoryFiles, memoryDir, memoryPanelOpen, memoryEditing,
    sidebar, wsSend, switchConversation, toolMsgMap,
    fileBrowser, filePreview, team, loop, t,
  } = deps;

  return {
    btw_answer(msg) {
      if (btwPending) btwPending.value = false;
      if (btwState && btwState.value) {
        btwState.value.answer += msg.delta;
        if (msg.done) {
          btwState.value.done = true;
        }
      }
    },
    plan_mode_changed(msg) {
      if (setPlanMode) setPlanMode(msg.enabled);
      // For the immediate path (no injected turn), clear isProcessing here
      if (msg.immediate) {
        isProcessing.value = false;
        if (currentConversationId.value) {
          processingConversations.value[currentConversationId.value] = false;
        }
      }
    },
    workdir_changed(msg) {
      workdirSwitching.value = false;
      workDir.value = msg.workDir;
      localStorage.setItem(`agentlink-workdir-${sessionId.value}`, msg.workDir);
      sidebar.addToWorkdirHistory(msg.workDir);
      if (fileBrowser) fileBrowser.onWorkdirChanged();
      if (filePreview) filePreview.onWorkdirChanged();

      // Multi-session: switch to a new blank conversation for the new workdir
      if (switchConversation) {
        const newConvId = crypto.randomUUID();
        switchConversation(newConvId);
      } else {
        messages.value = [];
        queuedMessages.value = [];
        toolMsgMap.clear();
        visibleLimit.value = 50;
        streaming.setMessageIdCounter(0);
        streaming.setStreamingMessageId(null);
        streaming.reset();
        currentClaudeSessionId.value = null;
        isProcessing.value = false;
      }
      messages.value.push({
        id: streaming.nextId(), role: 'system',
        content: t('system.workdirChanged', { dir: msg.workDir }),
        timestamp: new Date(),
      });
      // Clear old history so UI doesn't show stale data
      historySessions.value = [];
      if (team) {
        team.teamsList.value = [];
        team.teamState.value = null;
        team.historicalTeam.value = null;
        if (team.viewMode.value === 'team') {
          team.viewMode.value = 'chat';
        }
      }
      if (loop) loop.loopsList.value = [];
      memoryFiles.value = [];
      memoryDir.value = null;
      memoryPanelOpen.value = false;
      memoryEditing.value = false;
      sidebar.requestSessionList();
      if (team) team.requestTeamsList();
      if (loop) loop.requestLoopsList();
    },
  };
}
