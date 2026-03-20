// ── Execution lifecycle message handlers ──────────────────────────────────────

function findLast(arr, predicate) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return arr[i];
  }
  return undefined;
}

export function createExecutionHandlers(deps) {
  const {
    messages, isProcessing, isCompacting, streaming, scrollToBottom,
    needsResume, usageStats, toolMsgMap, sidebar,
    currentConversationId, processingConversations, activeClaudeSessions,
    currentClaudeSessionId,
    clearIdleCheck, t,
    finalizeStreamingMsg,
  } = deps;

  function clearActiveSession() {
    if (activeClaudeSessions && currentClaudeSessionId && currentClaudeSessionId.value) {
      const s = activeClaudeSessions.value;
      if (s instanceof Set && s.has(currentClaudeSessionId.value)) {
        const next = new Set(s);
        next.delete(currentClaudeSessionId.value);
        activeClaudeSessions.value = next;
      }
    }
  }

  return {
    clearActiveSession,
    turn_completed(msg, scheduleHighlight) {
      if (deps.clearCancelled) deps.clearCancelled();
      streaming.flushReveal();
      finalizeStreamingMsg(scheduleHighlight);
      isProcessing.value = false;
      isCompacting.value = false;
      clearIdleCheck();
      toolMsgMap.clear();
      if (msg.usage) usageStats.value = msg.usage;
      if (currentConversationId && currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = false;
      }
      clearActiveSession();
      sidebar.requestSessionList();
      deps.dequeueNext();
    },
    execution_cancelled(msg, scheduleHighlight) {
      if (deps.markCancelled) deps.markCancelled();
      streaming.flushReveal();
      finalizeStreamingMsg(scheduleHighlight);
      isProcessing.value = false;
      isCompacting.value = false;
      clearIdleCheck();
      toolMsgMap.clear();
      if (msg.usage) usageStats.value = msg.usage;
      if (currentConversationId && currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = false;
      }
      clearActiveSession();
      needsResume.value = true;
      messages.value.push({
        id: streaming.nextId(), role: 'system',
        content: t('system.generationStopped'), timestamp: new Date(),
      });
      scrollToBottom();
      sidebar.requestSessionList();
      deps.dequeueNext();
    },
    context_compaction(msg) {
      if (msg.status === 'started') {
        isCompacting.value = true;
        messages.value.push({
          id: streaming.nextId(), role: 'system',
          content: t('system.contextCompacting'), isCompactStart: true,
          timestamp: new Date(),
        });
        scrollToBottom();
      } else if (msg.status === 'completed') {
        isCompacting.value = false;
        const startMsg = findLast(messages.value, m => m.isCompactStart && !m.compactDone);
        if (startMsg) {
          startMsg.content = t('system.contextCompacted');
          startMsg.compactDone = true;
        }
        scrollToBottom();
      }
    },
    ask_user_question(msg, scheduleHighlight) {
      streaming.flushReveal();
      finalizeStreamingMsg(scheduleHighlight);
      // Remove pending AskUserQuestion tool block
      for (let i = messages.value.length - 1; i >= 0; i--) {
        const m = messages.value[i];
        if (m.role === 'tool' && m.toolName === 'AskUserQuestion') {
          messages.value.splice(i, 1);
          break;
        }
        if (m.role === 'user') break;
      }
      const questions = msg.questions || [];
      const selectedAnswers = {};
      const customTexts = {};
      for (let i = 0; i < questions.length; i++) {
        selectedAnswers[i] = questions[i].multiSelect ? [] : null;
        customTexts[i] = '';
      }
      messages.value.push({
        id: streaming.nextId(),
        role: 'ask-question',
        requestId: msg.requestId,
        questions,
        answered: false,
        selectedAnswers,
        customTexts,
        timestamp: new Date(),
      });
      scrollToBottom();
    },
  };
}
