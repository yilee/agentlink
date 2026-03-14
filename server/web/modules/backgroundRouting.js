// ── History batch building & background conversation routing ──────────────────
import { isContextSummary } from './messageHelpers.js';

function findLast(arr, predicate) {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) return arr[i];
  }
  return undefined;
}

/**
 * Convert a history array (from conversation_resumed) into a batch of UI messages.
 * @param {Array} history - Array of {role, content, ...} from the agent
 * @param {() => number} nextId - Function that returns the next message ID
 * @returns {Array} Batch of UI message objects
 */
export function buildHistoryBatch(history, nextId) {
  const batch = [];
  for (const h of history) {
    if (h.role === 'user') {
      if (isContextSummary(h.content)) {
        batch.push({
          id: nextId(), role: 'context-summary',
          content: h.content, contextExpanded: false,
          timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
        });
      } else if (h.isCommandOutput) {
        batch.push({
          id: nextId(), role: 'system',
          content: h.content, isCommandOutput: true,
          timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
        });
      } else {
        batch.push({
          id: nextId(), role: 'user',
          content: h.content,
          timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
        });
      }
    } else if (h.role === 'assistant') {
      const last = batch[batch.length - 1];
      if (last && last.role === 'assistant' && !last.isStreaming) {
        last.content += '\n\n' + h.content;
      } else {
        batch.push({
          id: nextId(), role: 'assistant',
          content: h.content, isStreaming: false,
          timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
        });
      }
    } else if (h.role === 'tool') {
      batch.push({
        id: nextId(), role: 'tool',
        toolId: h.toolId || '', toolName: h.toolName || 'unknown',
        toolInput: h.toolInput || '', hasResult: !!h.toolOutput,
        toolOutput: h.toolOutput || '',
        expanded: (h.toolName === 'Edit' || h.toolName === 'TodoWrite' || h.toolName === 'Agent'),
        timestamp: h.timestamp ? new Date(h.timestamp) : new Date(),
      });
    }
  }
  return batch;
}

/**
 * Finalize the last streaming assistant message in a message array.
 * @param {Array} msgs - Array of message objects
 */
export function finalizeLastStreaming(msgs) {
  const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
  if (last && last.role === 'assistant' && last.isStreaming) {
    last.isStreaming = false;
    if (isContextSummary(last.content)) {
      last.role = 'context-summary';
      last.contextExpanded = false;
    }
  }
}

/**
 * Route a message to a background (non-foreground) conversation's cache.
 * @param {object} deps - Dependencies: conversationCache, processingConversations, sidebar, wsSend
 * @param {string} convId - The conversation ID
 * @param {object} msg - The incoming message
 */
export function routeToBackgroundConversation(deps, convId, msg) {
  const { conversationCache, processingConversations, sidebar, wsSend } = deps;
  const cache = conversationCache.value[convId];
  if (!cache) return;

  if (msg.type === 'session_started') {
    cache.claudeSessionId = msg.claudeSessionId;
    sidebar.requestSessionList();
    return;
  }

  if (msg.type === 'conversation_resumed') {
    cache.claudeSessionId = msg.claudeSessionId;
    if (msg.history && Array.isArray(msg.history)) {
      const nextId = () => ++cache.messageIdCounter;
      cache.messages = buildHistoryBatch(msg.history, nextId);
      if (cache.toolMsgMap) cache.toolMsgMap.clear();
    }
    cache.loadingHistory = false;
    if (msg.isCompacting) {
      cache.isCompacting = true;
      cache.isProcessing = true;
      processingConversations.value[convId] = true;
      cache.messages.push({
        id: ++cache.messageIdCounter, role: 'system',
        content: 'Context compacting...', isCompactStart: true,
        timestamp: new Date(),
      });
    } else if (msg.isProcessing) {
      cache.isProcessing = true;
      processingConversations.value[convId] = true;
      cache.messages.push({
        id: ++cache.messageIdCounter, role: 'system',
        content: 'Agent is processing...',
        timestamp: new Date(),
      });
    } else {
      cache.messages.push({
        id: ++cache.messageIdCounter, role: 'system',
        content: 'Session restored. You can continue the conversation.',
        timestamp: new Date(),
      });
    }
    return;
  }

  if (msg.type === 'claude_output') {
    if (!cache.isProcessing) {
      cache.isProcessing = true;
      processingConversations.value[convId] = true;
    }
    const data = msg.data;
    if (!data) return;
    if (data.type === 'content_block_delta' && data.delta) {
      const msgs = cache.messages;
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      if (last && last.role === 'assistant' && last.isStreaming) {
        last.content += data.delta;
      } else {
        msgs.push({
          id: ++cache.messageIdCounter, role: 'assistant',
          content: data.delta, isStreaming: true, timestamp: new Date(),
        });
      }
    } else if (data.type === 'tool_use' && data.tools) {
      const msgs = cache.messages;
      finalizeLastStreaming(msgs);
      for (const tool of data.tools) {
        const toolMsg = {
          id: ++cache.messageIdCounter, role: 'tool',
          toolId: tool.id, toolName: tool.name || 'unknown',
          toolInput: tool.input ? JSON.stringify(tool.input, null, 2) : '',
          hasResult: false, expanded: (tool.name === 'Edit' || tool.name === 'TodoWrite' || tool.name === 'Agent'),
          timestamp: new Date(),
        };
        msgs.push(toolMsg);
        if (tool.id) {
          if (!cache.toolMsgMap) cache.toolMsgMap = new Map();
          cache.toolMsgMap.set(tool.id, toolMsg);
        }
      }
    } else if (data.type === 'user' && data.tool_use_result) {
      const result = data.tool_use_result;
      const results = Array.isArray(result) ? result : [result];
      const tMap = cache.toolMsgMap || new Map();
      for (const r of results) {
        const toolMsg = tMap.get(r.tool_use_id);
        if (toolMsg) {
          toolMsg.toolOutput = typeof r.content === 'string'
            ? r.content : JSON.stringify(r.content, null, 2);
          toolMsg.hasResult = true;
        }
      }
    }
  } else if (msg.type === 'turn_completed' || msg.type === 'execution_cancelled') {
    finalizeLastStreaming(cache.messages);
    cache.isProcessing = false;
    cache.isCompacting = false;
    if (msg.usage) cache.usageStats = msg.usage;
    if (cache.toolMsgMap) cache.toolMsgMap.clear();
    processingConversations.value[convId] = false;
    if (msg.type === 'execution_cancelled') {
      cache.needsResume = true;
      cache.messages.push({
        id: ++cache.messageIdCounter, role: 'system',
        content: 'Generation stopped.', timestamp: new Date(),
      });
    }
    sidebar.requestSessionList();
    if (cache.queuedMessages && cache.queuedMessages.length > 0) {
      const queued = cache.queuedMessages.shift();
      cache.messages.push({
        id: ++cache.messageIdCounter, role: 'user', status: 'sent',
        content: queued.content, attachments: queued.attachments,
        timestamp: new Date(),
      });
      cache.isProcessing = true;
      processingConversations.value[convId] = true;
      wsSend(queued.payload);
    }
  } else if (msg.type === 'context_compaction') {
    if (msg.status === 'started') {
      cache.isCompacting = true;
      cache.messages.push({
        id: ++cache.messageIdCounter, role: 'system',
        content: 'Context compacting...', isCompactStart: true,
        timestamp: new Date(),
      });
    } else if (msg.status === 'completed') {
      cache.isCompacting = false;
      const startMsg = findLast(cache.messages, m => m.isCompactStart && !m.compactDone);
      if (startMsg) {
        startMsg.content = 'Context compacted';
        startMsg.compactDone = true;
      }
    }
  } else if (msg.type === 'error') {
    finalizeLastStreaming(cache.messages);
    cache.messages.push({
      id: ++cache.messageIdCounter, role: 'system',
      content: msg.message, isError: true, timestamp: new Date(),
    });
    cache.isProcessing = false;
    cache.isCompacting = false;
    processingConversations.value[convId] = false;
  } else if (msg.type === 'command_output') {
    finalizeLastStreaming(cache.messages);
    cache.messages.push({
      id: ++cache.messageIdCounter, role: 'system',
      content: msg.content, isCommandOutput: true, timestamp: new Date(),
    });
  } else if (msg.type === 'ask_user_question') {
    const msgs = cache.messages;
    finalizeLastStreaming(msgs);
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'tool' && m.toolName === 'AskUserQuestion') {
        msgs.splice(i, 1);
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
    msgs.push({
      id: ++cache.messageIdCounter,
      role: 'ask-question',
      requestId: msg.requestId,
      questions,
      answered: false,
      selectedAnswers,
      customTexts,
      timestamp: new Date(),
    });
  }
}
