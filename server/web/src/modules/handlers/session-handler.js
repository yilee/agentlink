// ── Session management message handlers ───────────────────────────────────────
import { buildHistoryBatch } from '../backgroundRouting.js';

export function createSessionHandlers(deps) {
  const {
    messages, isProcessing, isCompacting, streaming, scrollToBottom,
    historySessions, currentClaudeSessionId, loadingHistory,
    loadingSessions, setPlanMode, t, toolMsgMap,
  } = deps;

  return {
    sessions_list(msg) {
      historySessions.value = msg.sessions || [];
      loadingSessions.value = false;
    },
    session_deleted(msg) {
      historySessions.value = historySessions.value.filter(s => s.sessionId !== msg.sessionId);
    },
    session_renamed(msg) {
      const session = historySessions.value.find(s => s.sessionId === msg.sessionId);
      if (session) session.title = msg.newTitle;
    },
    conversation_resumed(msg) {
      currentClaudeSessionId.value = msg.claudeSessionId;
      if (msg.history && Array.isArray(msg.history)) {
        messages.value = buildHistoryBatch(msg.history, () => streaming.nextId());
        toolMsgMap.clear();
      }
      // Detect plan mode from agent-provided flag
      if (msg.planMode != null) {
        if (setPlanMode) setPlanMode(!!msg.planMode);
      }
      loadingHistory.value = false;
      // Restore live status from agent (compacting / processing)
      if (msg.isCompacting) {
        isCompacting.value = true;
        isProcessing.value = true;
        messages.value.push({
          id: streaming.nextId(), role: 'system',
          content: t('system.contextCompacting'), isCompactStart: true,
          timestamp: new Date(),
        });
      } else if (msg.isProcessing) {
        isProcessing.value = true;
        messages.value.push({
          id: streaming.nextId(), role: 'system',
          content: t('system.agentProcessing'),
          timestamp: new Date(),
        });
      } else {
        messages.value.push({
          id: streaming.nextId(), role: 'system',
          content: t('system.sessionRestored'),
          timestamp: new Date(),
        });
      }
      scrollToBottom();
    },
  };
}
