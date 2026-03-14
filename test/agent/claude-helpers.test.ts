/**
 * Tests for extracted helper functions in claude.ts:
 * buildControlResponse, handleResultMessage, handleAssistantMessage, handleUserMessage.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildControlResponse,
  handleResultMessage,
  handleAssistantMessage,
  handleUserMessage,
  isTaskNotification,
} from '../../agent/src/claude.js';
import type { ClaudeMessage, ConversationState } from '../../agent/src/claude.js';

describe('claude.ts helpers', () => {
  // ── buildControlResponse ──────────────────────────────────────────────

  describe('buildControlResponse', () => {
    it('builds a well-formed control_response envelope', () => {
      const result = buildControlResponse('req-123', { foo: 'bar' });
      expect(result).toEqual({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: 'req-123',
          response: {
            behavior: 'allow',
            updatedInput: { foo: 'bar' },
          },
        },
      });
    });

    it('handles empty updatedInput', () => {
      const result = buildControlResponse('req-456', {});
      const inner = (result.response as Record<string, unknown>);
      expect(inner.request_id).toBe('req-456');
      expect((inner.response as Record<string, unknown>).updatedInput).toEqual({});
    });
  });

  // ── handleResultMessage ───────────────────────────────────────────────

  describe('handleResultMessage', () => {
    function makeState(): ConversationState {
      return {
        child: null,
        inputStream: null,
        abortController: null,
        claudeSessionId: null,
        workDir: '/tmp',
        turnActive: true,
        turnResultReceived: false,
        conversationId: 'test-conv',
        lastClaudeSessionId: null,
        isCompacting: false,
        createdAt: Date.now(),
      };
    }

    it('sets turnActive to false', () => {
      const state = makeState();
      const send = vi.fn();
      handleResultMessage({ type: 'result' } as ClaudeMessage, state, send);
      expect(state.turnActive).toBe(false);
    });

    it('sends turn_completed with usage stats', () => {
      const state = makeState();
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'result',
        usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 50 },
        total_cost_usd: 0.05,
        duration_ms: 3000,
        modelUsage: { 'claude-sonnet-4-20250514': { contextWindow: 200000 } },
      };
      handleResultMessage(msg, state, send);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'turn_completed',
          usage: expect.objectContaining({
            inputTokens: 500,
            outputTokens: 200,
            cacheReadTokens: 50,
            totalCost: 0.05,
            durationMs: 3000,
            model: 'claude-sonnet-4-20250514',
            contextWindow: 200000,
          }),
        }),
      );
    });

    it('sends error when result has is_error flag', () => {
      const state = makeState();
      const send = vi.fn();
      handleResultMessage(
        { type: 'result', is_error: true, result: 'Something went wrong' } as ClaudeMessage,
        state,
        send,
      );
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'Something went wrong' }),
      );
    });

    it('sends error when result has error_response subtype', () => {
      const state = makeState();
      const send = vi.fn();
      handleResultMessage(
        { type: 'result', subtype: 'error_response', error: 'Rate limited' } as ClaudeMessage,
        state,
        send,
      );
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', message: 'Rate limited' }),
      );
    });

    it('does not send error when result is successful', () => {
      const state = makeState();
      const send = vi.fn();
      handleResultMessage({ type: 'result' } as ClaudeMessage, state, send);
      const calls = send.mock.calls.map(c => c[0]);
      expect(calls.every((c: Record<string, unknown>) => c.type !== 'error')).toBe(true);
    });
  });

  // ── handleAssistantMessage ────────────────────────────────────────────

  describe('handleAssistantMessage', () => {
    it('returns updated lastSentText with text delta', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world' }] },
      };
      const result = handleAssistantMessage(msg, '', send);
      expect(result).toBe('Hello world');
      expect(send).toHaveBeenCalledWith({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'Hello world' },
      });
    });

    it('computes delta from previous lastSentText', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Hello world, how are you?' }] },
      };
      const result = handleAssistantMessage(msg, 'Hello world', send);
      expect(result).toBe('Hello world, how are you?');
      expect(send).toHaveBeenCalledWith({
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: ', how are you?' },
      });
    });

    it('does not send delta when text has not grown', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Same' }] },
      };
      const result = handleAssistantMessage(msg, 'Same', send);
      expect(result).toBe('Same');
      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'content_block_delta' }) }),
      );
    });

    it('forwards tool_use blocks (excluding AskUserQuestion)', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Let me read the file.' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { path: '/foo' } },
            { type: 'tool_use', id: 't2', name: 'AskUserQuestion', input: {} },
          ],
        },
      };
      handleAssistantMessage(msg, '', send);

      // Should have two calls: one for delta, one for tool_use
      const toolCall = send.mock.calls.find(
        (c: unknown[]) => (c[0] as Record<string, unknown>).type === 'claude_output'
          && ((c[0] as Record<string, Record<string, unknown>>).data?.type === 'tool_use'),
      );
      expect(toolCall).toBeDefined();
      const tools = (toolCall![0] as Record<string, Record<string, unknown>>).data.tools as Array<Record<string, unknown>>;
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('Read');
    });

    it('returns lastSentText unchanged when content is not an array', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'assistant',
        message: { content: 'just a string' },
      };
      const result = handleAssistantMessage(msg, 'prev', send);
      expect(result).toBe('prev');
      expect(send).not.toHaveBeenCalled();
    });
  });

  // ── handleUserMessage ─────────────────────────────────────────────────

  describe('handleUserMessage', () => {
    it('forwards regular user messages as claude_output and returns false', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'user',
        message: { content: [{ type: 'tool_result', content: 'result data' }] },
      };
      const result = handleUserMessage(msg, send);
      expect(result).toBe(false);
      expect(send).toHaveBeenCalledWith({
        type: 'claude_output',
        data: msg,
      });
    });

    it('extracts command output from local-command-stdout and returns true', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'user',
        message: {
          content: 'Result: <local-command-stdout>$0.42 total cost</local-command-stdout>',
        },
      };
      const result = handleUserMessage(msg, send);
      expect(result).toBe(true);
      expect(send).toHaveBeenCalledWith({
        type: 'command_output',
        content: '$0.42 total cost',
      });
    });

    it('extracts command output from local-command-stderr', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'user',
        message: {
          content: 'Error: <local-command-stderr>Something failed</local-command-stderr>',
        },
      };
      const result = handleUserMessage(msg, send);
      expect(result).toBe(true);
      expect(send).toHaveBeenCalledWith({
        type: 'command_output',
        content: 'Something failed',
      });
    });

    it('extracts text from content array blocks', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'Prefix <local-command-stdout>output here</local-command-stdout>' },
          ],
        },
      };
      const result = handleUserMessage(msg, send);
      expect(result).toBe(true);
      expect(send).toHaveBeenCalledWith({
        type: 'command_output',
        content: 'output here',
      });
    });

    it('forwards as claude_output when no command tags', () => {
      const send = vi.fn();
      const msg: ClaudeMessage = {
        type: 'user',
        message: { content: 'just a regular message' },
      };
      const result = handleUserMessage(msg, send);
      expect(result).toBe(false);
      expect(send).toHaveBeenCalledWith({ type: 'claude_output', data: msg });
    });
  });

  // ── isTaskNotification ──────────────────────────────────────────────

  describe('isTaskNotification', () => {
    it('returns true for string content with task-notification tag', () => {
      const msg: ClaudeMessage = {
        type: 'user',
        message: {
          content: '<task-notification>Background task completed: exit code 0</task-notification>',
        },
      };
      expect(isTaskNotification(msg)).toBe(true);
    });

    it('returns true for array content with task-notification tag', () => {
      const msg: ClaudeMessage = {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: '<task-notification>Task failed</task-notification>' },
          ],
        },
      };
      expect(isTaskNotification(msg)).toBe(true);
    });

    it('returns true when task-notification is mixed with other content', () => {
      const msg: ClaudeMessage = {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'Some prefix' },
            { type: 'text', text: '<task-notification>done</task-notification>' },
          ],
        },
      };
      expect(isTaskNotification(msg)).toBe(true);
    });

    it('returns false for regular user messages', () => {
      const msg: ClaudeMessage = {
        type: 'user',
        message: { content: 'Hello, please help me' },
      };
      expect(isTaskNotification(msg)).toBe(false);
    });

    it('returns false for command output messages', () => {
      const msg: ClaudeMessage = {
        type: 'user',
        message: {
          content: '<local-command-stdout>$0.42</local-command-stdout>',
        },
      };
      expect(isTaskNotification(msg)).toBe(false);
    });

    it('returns false when message has no content', () => {
      const msg: ClaudeMessage = { type: 'user', message: {} };
      expect(isTaskNotification(msg)).toBe(false);
    });

    it('returns false when message has no message field', () => {
      const msg: ClaudeMessage = { type: 'user' } as ClaudeMessage;
      expect(isTaskNotification(msg)).toBe(false);
    });

    it('returns false for non-text content blocks', () => {
      const msg: ClaudeMessage = {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', content: '<task-notification>sneaky</task-notification>' },
          ],
        },
      };
      expect(isTaskNotification(msg)).toBe(false);
    });
  });
});
