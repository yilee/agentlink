/**
 * Message processing helpers extracted from claude.ts.
 *
 * Pure (or near-pure) functions used by processOutput() to handle
 * different Claude stdout message types. No module-level state access.
 */

import type { ClaudeMessage, ConversationState, SendFn } from './claude.js';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Build a control_response JSON payload for writing to Claude's stdin. */
export function buildControlResponse(
  requestId: string,
  updatedInput: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response: {
        behavior: 'allow',
        updatedInput,
      },
    },
  };
}

// ── Message processing helpers (used by processOutput) ───────────────────

/**
 * Handle a 'result' message from Claude: send errors and turn_completed.
 * Returns true so the caller can `continue`.
 */
export function handleResultMessage(
  msg: ClaudeMessage,
  state: ConversationState,
  sendWithConvId: SendFn,
): void {
  state.turnActive = false;

  // If the result contains an error, send it as an error message for the chat
  if (msg.is_error || (msg.subtype === 'error_response')) {
    const errorText = typeof msg.result === 'string' ? msg.result
      : typeof msg.error === 'string' ? msg.error
      : '';
    if (errorText) {
      sendWithConvId({ type: 'error', message: errorText });
    }
  }

  // Signal turn_completed with usage stats
  const modelUsageValues = Object.values((msg.modelUsage as Record<string, Record<string, unknown>>) || {});
  sendWithConvId({
    type: 'turn_completed',
    usage: {
      inputTokens: (msg.usage as Record<string, unknown>)?.input_tokens ?? 0,
      outputTokens: (msg.usage as Record<string, unknown>)?.output_tokens ?? 0,
      cacheReadTokens: (msg.usage as Record<string, unknown>)?.cache_read_input_tokens ?? 0,
      totalCost: msg.total_cost_usd ?? 0,
      durationMs: msg.duration_ms ?? 0,
      model: Object.keys((msg.modelUsage as Record<string, unknown>) || {})[0] || '',
      contextWindow: (modelUsageValues[0] as Record<string, unknown>)?.contextWindow ?? 200000,
    },
  });
}

/**
 * Handle an 'assistant' message: compute text delta and forward tool_use blocks.
 * Returns the updated lastSentText for delta tracking.
 */
export function handleAssistantMessage(
  msg: ClaudeMessage,
  lastSentText: string,
  sendWithConvId: SendFn,
): string {
  const message = msg.message as { content?: Array<Record<string, unknown>> };
  const content = message.content;
  if (!Array.isArray(content)) return lastSentText;

  // Extract full text from all text blocks
  const fullText = content
    .filter((b) => b.type === 'text')
    .map((b) => (b.text as string) || '')
    .join('');

  // Compute delta (new text since last emit)
  if (fullText.length > lastSentText.length) {
    const delta = fullText.slice(lastSentText.length);
    lastSentText = fullText;
    sendWithConvId({
      type: 'claude_output',
      data: { type: 'content_block_delta', delta },
    });
  }

  // Forward tool_use blocks as-is (they appear once)
  // Filter out AskUserQuestion — handled via control_request path
  const toolBlocks = content.filter(
    (b) => b.type === 'tool_use' && b.name !== 'AskUserQuestion'
  );
  if (toolBlocks.length > 0) {
    sendWithConvId({
      type: 'claude_output',
      data: { type: 'tool_use', tools: toolBlocks },
    });
  }

  return lastSentText;
}

/**
 * Check if a user message is a task-notification (background task completed/failed).
 * These are system-injected and should not trigger visible output in the web UI.
 */
export function isTaskNotification(msg: ClaudeMessage): boolean {
  const message = msg.message as { content?: unknown } | undefined;
  if (!message?.content) return false;
  const raw = typeof message.content === 'string'
    ? message.content
    : Array.isArray(message.content)
      ? (message.content as Array<{ type: string; text?: string }>)
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('')
      : '';
  return raw.includes('<task-notification>');
}

/**
 * Handle a 'user' (tool_result) message: detect command output or forward as-is.
 * Returns true if a command output was extracted (caller should `continue`).
 */
export function handleUserMessage(
  msg: ClaudeMessage,
  sendWithConvId: SendFn,
): boolean {
  const message = msg.message as { content?: unknown } | undefined;
  if (message && message.content) {
    const raw = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? (message.content as Array<{ type: string; text?: string }>)
            .filter(b => b.type === 'text')
            .map(b => b.text || '')
            .join('')
        : '';
    const stdoutMatch = raw.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
    const stderrMatch = raw.match(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/);
    const cmdOutput = (stdoutMatch && stdoutMatch[1].trim()) || (stderrMatch && stderrMatch[1].trim());
    if (cmdOutput) {
      sendWithConvId({ type: 'command_output', content: cmdOutput });
      return true;
    }
  }

  sendWithConvId({ type: 'claude_output', data: msg });
  return false;
}
