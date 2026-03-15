// @vitest-environment jsdom
/**
 * Tests for backgroundRouting.js — background conversation message routing,
 * activeClaudeSessions management, and uncached conversation handling.
 */

import { describe, it, expect, vi } from 'vitest';
import { routeToBackgroundConversation, finalizeLastStreaming, buildHistoryBatch } from '../../server/web/src/modules/backgroundRouting.js';

// Helper to create a minimal cache entry
function makeCache(overrides: Record<string, unknown> = {}) {
  return {
    messages: [],
    messageIdCounter: 0,
    isProcessing: false,
    isCompacting: false,
    claudeSessionId: null as string | null,
    toolMsgMap: new Map(),
    needsResume: false,
    usageStats: null,
    queuedMessages: [],
    ...overrides,
  };
}

// Helper to create deps with reactive-like value wrappers
function makeDeps(overrides: Record<string, unknown> = {}) {
  const conversationCache = { value: {} as Record<string, ReturnType<typeof makeCache>> };
  const processingConversations = { value: {} as Record<string, boolean> };
  const activeClaudeSessions = { value: new Set<string>() };
  const sidebar = { requestSessionList: vi.fn() };
  const wsSend = vi.fn();
  return {
    conversationCache,
    processingConversations,
    activeClaudeSessions,
    sidebar,
    wsSend,
    ...overrides,
  };
}

describe('backgroundRouting', () => {
  describe('routeToBackgroundConversation — uncached conversation handling', () => {
    it('re-queries active_conversations on turn_completed for uncached conversation', () => {
      const deps = makeDeps();
      // conversationCache is empty — simulates post-page-refresh state

      routeToBackgroundConversation(deps, 'conv-orphan', { type: 'turn_completed' });

      expect(deps.wsSend).toHaveBeenCalledWith({ type: 'query_active_conversations' });
    });

    it('re-queries active_conversations on execution_cancelled for uncached conversation', () => {
      const deps = makeDeps();

      routeToBackgroundConversation(deps, 'conv-orphan', { type: 'execution_cancelled' });

      expect(deps.wsSend).toHaveBeenCalledWith({ type: 'query_active_conversations' });
    });

    it('re-queries active_conversations on error for uncached conversation', () => {
      const deps = makeDeps();

      routeToBackgroundConversation(deps, 'conv-orphan', { type: 'error', message: 'fail' });

      expect(deps.wsSend).toHaveBeenCalledWith({ type: 'query_active_conversations' });
    });

    it('does NOT re-query for non-terminal events on uncached conversation', () => {
      const deps = makeDeps();

      routeToBackgroundConversation(deps, 'conv-orphan', { type: 'claude_output', data: { type: 'content_block_delta', delta: 'hi' } });

      expect(deps.wsSend).not.toHaveBeenCalled();
    });
  });

  describe('routeToBackgroundConversation — activeClaudeSessions clearing', () => {
    it('removes claudeSessionId from activeClaudeSessions on turn_completed', () => {
      const deps = makeDeps();
      const cache = makeCache({ claudeSessionId: 'claude-abc', isProcessing: true });
      deps.conversationCache.value['conv-1'] = cache;
      deps.activeClaudeSessions.value = new Set(['claude-abc', 'claude-other']);

      routeToBackgroundConversation(deps, 'conv-1', { type: 'turn_completed' });

      expect(deps.activeClaudeSessions.value.has('claude-abc')).toBe(false);
      expect(deps.activeClaudeSessions.value.has('claude-other')).toBe(true);
    });

    it('removes claudeSessionId from activeClaudeSessions on execution_cancelled', () => {
      const deps = makeDeps();
      const cache = makeCache({ claudeSessionId: 'claude-xyz', isProcessing: true });
      deps.conversationCache.value['conv-2'] = cache;
      deps.activeClaudeSessions.value = new Set(['claude-xyz']);

      routeToBackgroundConversation(deps, 'conv-2', { type: 'execution_cancelled' });

      expect(deps.activeClaudeSessions.value.has('claude-xyz')).toBe(false);
      expect(deps.activeClaudeSessions.value.size).toBe(0);
    });

    it('does not crash when activeClaudeSessions is undefined', () => {
      const deps = makeDeps({ activeClaudeSessions: undefined });
      const cache = makeCache({ claudeSessionId: 'claude-123', isProcessing: true });
      deps.conversationCache.value['conv-3'] = cache;

      // Should not throw
      routeToBackgroundConversation(deps, 'conv-3', { type: 'turn_completed' });

      expect(cache.isProcessing).toBe(false);
    });

    it('does not modify activeClaudeSessions when claudeSessionId is not in the set', () => {
      const deps = makeDeps();
      const cache = makeCache({ claudeSessionId: 'claude-not-in-set', isProcessing: true });
      deps.conversationCache.value['conv-4'] = cache;
      deps.activeClaudeSessions.value = new Set(['claude-other']);

      routeToBackgroundConversation(deps, 'conv-4', { type: 'turn_completed' });

      // Set should be unchanged
      expect(deps.activeClaudeSessions.value.size).toBe(1);
      expect(deps.activeClaudeSessions.value.has('claude-other')).toBe(true);
    });
  });

  describe('routeToBackgroundConversation — processing state', () => {
    it('sets isProcessing on claude_output', () => {
      const deps = makeDeps();
      const cache = makeCache();
      deps.conversationCache.value['conv-5'] = cache;

      routeToBackgroundConversation(deps, 'conv-5', {
        type: 'claude_output',
        data: { type: 'content_block_delta', delta: 'hello' },
      });

      expect(cache.isProcessing).toBe(true);
      expect(deps.processingConversations.value['conv-5']).toBe(true);
    });

    it('clears isProcessing on turn_completed', () => {
      const deps = makeDeps();
      const cache = makeCache({ isProcessing: true });
      deps.conversationCache.value['conv-6'] = cache;
      deps.processingConversations.value['conv-6'] = true;

      routeToBackgroundConversation(deps, 'conv-6', { type: 'turn_completed' });

      expect(cache.isProcessing).toBe(false);
      expect(deps.processingConversations.value['conv-6']).toBe(false);
    });

    it('sets needsResume on execution_cancelled', () => {
      const deps = makeDeps();
      const cache = makeCache({ isProcessing: true });
      deps.conversationCache.value['conv-7'] = cache;

      routeToBackgroundConversation(deps, 'conv-7', { type: 'execution_cancelled' });

      expect(cache.needsResume).toBe(true);
      expect(cache.isProcessing).toBe(false);
    });
  });

  describe('finalizeLastStreaming', () => {
    it('sets isStreaming to false on last streaming message', () => {
      const msgs = [
        { role: 'assistant', content: 'hello', isStreaming: true },
      ];
      finalizeLastStreaming(msgs);
      expect(msgs[0].isStreaming).toBe(false);
    });

    it('does nothing when last message is not streaming', () => {
      const msgs = [
        { role: 'assistant', content: 'hello', isStreaming: false },
      ];
      finalizeLastStreaming(msgs);
      expect(msgs[0].isStreaming).toBe(false);
    });

    it('does nothing on empty array', () => {
      finalizeLastStreaming([]);
      // Should not throw
    });
  });

  describe('buildHistoryBatch', () => {
    it('builds user and assistant messages from history', () => {
      let id = 0;
      const nextId = () => ++id;
      const batch = buildHistoryBatch([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
      ], nextId);

      expect(batch).toHaveLength(2);
      expect(batch[0].role).toBe('user');
      expect(batch[0].content).toBe('Hi');
      expect(batch[1].role).toBe('assistant');
      expect(batch[1].content).toBe('Hello!');
    });

    it('merges consecutive assistant messages', () => {
      let id = 0;
      const nextId = () => ++id;
      const batch = buildHistoryBatch([
        { role: 'assistant', content: 'Part 1' },
        { role: 'assistant', content: 'Part 2' },
      ], nextId);

      expect(batch).toHaveLength(1);
      expect(batch[0].content).toContain('Part 1');
      expect(batch[0].content).toContain('Part 2');
    });

    it('handles tool messages', () => {
      let id = 0;
      const nextId = () => ++id;
      const batch = buildHistoryBatch([
        { role: 'tool', toolName: 'Read', toolId: 't1', toolInput: '{}', toolOutput: 'result' },
      ], nextId);

      expect(batch).toHaveLength(1);
      expect(batch[0].role).toBe('tool');
      expect(batch[0].toolName).toBe('Read');
      expect(batch[0].hasResult).toBe(true);
    });
  });
});
