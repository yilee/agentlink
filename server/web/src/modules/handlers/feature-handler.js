// ── Feature-specific message handlers (btw, plan mode, workdir) ───────────────

export function createFeatureHandlers(deps) {
  const {
    messages, isProcessing, streaming, scrollToBottom,
    btwState, btwPending, setPlanMode, setBrainMode,
    workDir, workdirSwitching, sessionId,
    currentConversationId, processingConversations,
    queuedMessages, visibleLimit, currentClaudeSessionId,
    historySessions, memoryFiles, memoryDir, memoryPanelOpen, memoryEditing,
    sidebar, wsSend, switchConversation, toolMsgMap,
    t,
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
      isProcessing.value = false;
      if (currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = false;
      }
    },
    workdir_changed(msg) {
      workdirSwitching.value = false;
      workDir.value = msg.workDir;
      localStorage.setItem(`agentlink-workdir-${sessionId.value}`, msg.workDir);
      sidebar.addToWorkdirHistory(msg.workDir);
      if (deps.fileBrowser) deps.fileBrowser.onWorkdirChanged();
      if (deps.filePreview) deps.filePreview.onWorkdirChanged();

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

      // Auto-enable brain mode when switching to Brain Home directory
      // Must run AFTER switchConversation which resets brainMode to false
      const normalizedDir = msg.workDir.replace(/\\/g, '/');
      if (setBrainMode) setBrainMode(normalizedDir.endsWith('/.brain/BrainCore'));
      messages.value.push({
        id: streaming.nextId(), role: 'system',
        content: t('system.workdirChanged', { dir: msg.workDir }),
        timestamp: new Date(),
      });
      // Clear old history so UI doesn't show stale data
      historySessions.value = [];
      if (deps.team) {
        deps.team.teamsList.value = [];
        deps.team.teamState.value = null;
        deps.team.historicalTeam.value = null;
        if (deps.team.viewMode.value === 'team') {
          deps.team.viewMode.value = 'chat';
        }
      }
      if (deps.loop) deps.loop.loopsList.value = [];
      memoryFiles.value = [];
      memoryDir.value = null;
      memoryPanelOpen.value = false;
      memoryEditing.value = false;
      if (deps.git) deps.git.onWorkdirChanged();
      sidebar.requestSessionList();
      if (deps.team) deps.team.requestTeamsList();
      if (deps.loop) deps.loop.requestLoopsList();
    },
    git_status_result(msg) {
      if (deps.git) deps.git.handleGitStatus(msg);
    },
    git_diff_result(msg) {
      if (deps.git) deps.git.handleGitDiff(msg);
    },
    git_stage_result(msg) {
      if (deps.git) deps.git.handleGitWriteResult(msg);
    },
    git_unstage_result(msg) {
      if (deps.git) deps.git.handleGitWriteResult(msg);
    },
    git_discard_result(msg) {
      if (deps.git) deps.git.handleGitWriteResult(msg);
    },
    git_commit_result(msg) {
      if (deps.git) deps.git.handleGitCommitResult(msg);
    },
  };
}
