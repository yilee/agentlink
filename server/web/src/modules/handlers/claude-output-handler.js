// ── Claude output message handlers ────────────────────────────────────────────
import { isContextSummary } from '../messageHelpers.js';

export function createClaudeOutputHandlers(deps) {
  const {
    messages, isProcessing, isCompacting,
    streaming, scrollToBottom, toolMsgMap,
    currentConversationId, processingConversations,
    resetIdleCheck, clearIdleCheck, usageStats,
    currentClaudeSessionId, sidebar,
  } = deps;

  // Track when execution was cancelled to suppress stale output that arrives
  // after cancellation (race condition: buffered messages in-flight).
  let cancelledAt = 0;

  function finalizeStreamingMsg(scheduleHighlight) {
    const sid = streaming.getStreamingMessageId();
    if (sid === null) return;
    const streamMsg = messages.value.find(m => m.id === sid);
    if (streamMsg) {
      streamMsg.isStreaming = false;
      if (isContextSummary(streamMsg.content)) {
        streamMsg.role = 'context-summary';
        streamMsg.contextExpanded = false;
      }
    }
    streaming.setStreamingMessageId(null);
    if (scheduleHighlight) scheduleHighlight();
  }

  function handleClaudeOutput(msg, scheduleHighlight) {
    const data = msg.data;
    if (!data) return;

    // Safety net: if streaming output arrives but isProcessing is false.
    // Suppress stale output that arrives after cancellation — these are
    // buffered messages that were in-flight when the cancel was processed.
    if (!isProcessing.value) {
      if (cancelledAt && Date.now() - cancelledAt < 5000) {
        // Stale output after cancel — ignore it
        return;
      }
      isProcessing.value = true;
      resetIdleCheck();
      if (currentConversationId && currentConversationId.value) {
        processingConversations.value[currentConversationId.value] = true;
      }
    }

    if (data.type === 'content_block_delta' && data.delta) {
      streaming.appendPending(data.delta);
      streaming.startReveal();
      return;
    }

    if (data.type === 'tool_use' && data.tools) {
      streaming.flushReveal();
      finalizeStreamingMsg(scheduleHighlight);

      for (const tool of data.tools) {
        const toolMsg = {
          id: streaming.nextId(), role: 'tool',
          toolId: tool.id, toolName: tool.name || 'unknown',
          toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
          hasResult: false, expanded: (tool.name === 'Edit' || tool.name === 'TodoWrite' || tool.name === 'Agent'), timestamp: new Date(),
        };
        messages.value.push(toolMsg);
        if (tool.id) toolMsgMap.set(tool.id, toolMsg);
      }
      scrollToBottom();
      return;
    }

    if (data.type === 'user' && data.tool_use_result) {
      const result = data.tool_use_result;
      const results = Array.isArray(result) ? result : [result];
      for (const r of results) {
        const toolMsg = toolMsgMap.get(r.tool_use_id);
        if (toolMsg) {
          toolMsg.toolOutput = typeof r.content === 'string'
            ? r.content : JSON.stringify(r.content, null, 2);
          toolMsg.hasResult = true;
        }
      }
      scrollToBottom();
      return;
    }
  }

  return {
    claude_output(msg, scheduleHighlight) {
      handleClaudeOutput(msg, scheduleHighlight);
      resetIdleCheck();
    },
    command_output(msg, scheduleHighlight) {
      streaming.flushReveal();
      finalizeStreamingMsg(scheduleHighlight);
      messages.value.push({
        id: streaming.nextId(), role: 'system',
        content: msg.content, isCommandOutput: true,
        timestamp: new Date(),
      });
      scrollToBottom();
    },
    session_started(msg) {
      currentClaudeSessionId.value = msg.claudeSessionId;
      sidebar.requestSessionList();
      // Auto-rename recap chat session with user's first question
      if (deps.recap) {
        deps.recap.handleRecapSessionStarted(msg.claudeSessionId);
      }
    },
    // Exposed for other handlers that need to finalize streaming
    finalizeStreamingMsg,
    // Mark that execution was just cancelled (suppresses stale output)
    markCancelled() { cancelledAt = Date.now(); },
    // Clear cancellation flag (e.g., on new turn start)
    clearCancelled() { cancelledAt = 0; },
  };
}
