// ── Fork Conversation: fork a new conversation from any assistant message ────

/**
 * Summarize a tool call into a compact one-liner or short block.
 * Returns null if the tool has no meaningful content.
 */
function formatToolMessage(m) {
  const name = m.toolName || 'unknown';
  let input = '';
  try {
    const parsed = JSON.parse(m.toolInput || '{}');
    // Extract the most informative field per tool type
    if (parsed.command) input = parsed.command;
    else if (parsed.file_path) input = parsed.file_path;
    else if (parsed.pattern) input = parsed.pattern;
    else if (parsed.query) input = parsed.query;
    else if (parsed.url) input = parsed.url;
    else if (parsed.content) input = '(file content)';
    else input = m.toolInput?.slice(0, 200) || '';
  } catch {
    input = m.toolInput?.slice(0, 200) || '';
  }
  const parts = [`[Tool: ${name}] ${input}`];
  if (m.toolOutput) {
    const out = m.toolOutput.length > 300
      ? m.toolOutput.slice(0, 300) + '...'
      : m.toolOutput;
    parts.push(out);
  }
  return parts.join('\n');
}

/**
 * Build a context string from the UI messages array up to (and including) msgIdx.
 * Extracts user, assistant, tool, and context-summary messages.
 */
function buildContextFromMessages(msgs, upToIdx) {
  const parts = [];
  for (let i = 0; i <= upToIdx; i++) {
    const m = msgs[i];
    if (!m) continue;
    if (m.role === 'user') {
      if (m.content) parts.push(`[User]\n${m.content}`);
    } else if (m.role === 'assistant' && !m.isStreaming) {
      if (m.content) parts.push(`[Assistant]\n${m.content}`);
    } else if (m.role === 'tool') {
      const formatted = formatToolMessage(m);
      if (formatted) parts.push(formatted);
    } else if (m.role === 'context-summary') {
      if (m.content) parts.push(`[Summary]\n${m.content}`);
    }
  }
  return parts.join('\n\n');
}

/**
 * Creates the fork conversation controller.
 * Fork is instant — no popover, directly creates new conversation with context.
 * @param {object} deps - Reactive state and callbacks
 */
export function createFork(deps) {
  const {
    wsSend,
    switchConversation,
    messages,
    streaming,
    scrollToBottom,
    isProcessing,
    processingConversations,
  } = deps;

  /**
   * Fork from the given assistant message — instant, no popover.
   */
  function forkFromMessage(msg, msgIdx, _event) {
    // msgIdx is the index in visibleMessages (a truncated slice of messages.value).
    // Find the real index in messages.value by matching msg.id.
    const realIdx = messages.value.findIndex(m => m.id === msg.id);
    const idx = realIdx >= 0 ? realIdx : msgIdx;

    const contextText = buildContextFromMessages(messages.value, idx);
    if (!contextText) return;

    // Create new conversation
    const newConvId = crypto.randomUUID();
    switchConversation(newConvId);

    // Insert collapsible fork-context message
    messages.value.push({
      id: streaming.nextId(),
      role: 'fork-context',
      content: contextText,
      contextExpanded: false,
      timestamp: new Date(),
    });

    // Compose the prompt using the [Fork Context] prefix + </brain-context> pattern
    // so that buildHistoryBatch() can reconstruct the fork-context role on conversation resume.
    const prompt = `[Fork Context]\nBelow is the conversation history from a previous session. Use it as background context only.\n\n${contextText}\n</brain-context>\nReview the conversation history above — read only, do not use any tools or take any actions. Respond in the same language the user used. First, briefly summarize the conversation content. Then describe the current state: what has been done, what remains unfinished, and any open questions. Then wait for the user's next instruction.`;

    // Send as chat message
    wsSend({
      type: 'chat',
      conversationId: newConvId,
      prompt,
    });

    // Set processing state (show stop button, disable input)
    isProcessing.value = true;
    processingConversations.value[newConvId] = true;

    scrollToBottom(true);
  }

  return {
    forkFromMessage,
  };
}
