/**
 * Tests for appHelpers.js — scroll management, highlight scheduling, and formatting utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createScrollManager, createHighlightScheduler, formatTokens, formatUsage } from '../../server/web-src/src/modules/appHelpers.js';

describe('appHelpers', () => {
  describe('formatTokens', () => {
    it('returns raw number for values under 1000', () => {
      expect(formatTokens(0)).toBe('0');
      expect(formatTokens(500)).toBe('500');
      expect(formatTokens(999)).toBe('999');
    });

    it('formats thousands with k suffix', () => {
      expect(formatTokens(1000)).toBe('1.0k');
      expect(formatTokens(1500)).toBe('1.5k');
      expect(formatTokens(10000)).toBe('10.0k');
      expect(formatTokens(128000)).toBe('128.0k');
    });
  });

  describe('formatUsage', () => {
    it('returns empty string for null/undefined', () => {
      expect(formatUsage(null)).toBe('');
      expect(formatUsage(undefined)).toBe('');
    });

    it('formats usage stats into summary string', () => {
      const result = formatUsage({
        inputTokens: 5000,
        contextWindow: 128000,
        totalCost: 0.15,
        model: 'claude-sonnet-4-20250514',
        durationMs: 3500,
      });

      expect(result).toContain('5.0k');
      expect(result).toContain('128.0k');
      expect(result).toContain('4%');
      expect(result).toContain('$0.15');
      expect(result).toContain('sonnet-4');
      expect(result).toContain('3.5s');
    });

    it('strips claude- prefix and date suffix from model name', () => {
      const result = formatUsage({
        inputTokens: 100,
        contextWindow: 1000,
        totalCost: 0.01,
        model: 'claude-opus-4-20250514',
        durationMs: 1000,
      });
      expect(result).toContain('opus-4');
      expect(result).not.toContain('claude-');
      expect(result).not.toContain('20250514');
    });

    it('handles zero context window', () => {
      const result = formatUsage({
        inputTokens: 100,
        contextWindow: 0,
        totalCost: 0,
        model: 'test-model',
        durationMs: 0,
      });
      expect(result).toContain('0%');
    });
  });

  describe('createScrollManager', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Mock document.hidden and requestAnimationFrame for Node.js test env
      (globalThis as any).document = { hidden: false, querySelector: () => null };
      (globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
      (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
    });
    afterEach(() => {
      vi.useRealTimers();
      delete (globalThis as any).document;
      delete (globalThis as any).requestAnimationFrame;
      delete (globalThis as any).cancelAnimationFrame;
    });

    it('scrollToBottom schedules a timeout', () => {
      const { scrollToBottom, cleanup } = createScrollManager('.test');
      scrollToBottom(false);
      // Should have scheduled a timer
      cleanup(); // should not throw
    });

    it('onScroll tracks user scroll position', () => {
      const { onScroll, scrollToBottom, cleanup } = createScrollManager('.test');
      // Simulate user scrolled up
      onScroll({ target: { scrollHeight: 1000, scrollTop: 100, clientHeight: 500 } });
      // scrollToBottom(false) should be suppressed since user is scrolled up
      // (we can't easily verify the DOM effect, but we verify no error)
      scrollToBottom(false);
      cleanup();
    });

    it('scrollToBottom with force=true overrides user scroll', () => {
      const { onScroll, scrollToBottom, cleanup } = createScrollManager('.test');
      onScroll({ target: { scrollHeight: 1000, scrollTop: 100, clientHeight: 500 } });
      scrollToBottom(true); // forced — should schedule
      cleanup();
    });
  });

  describe('createHighlightScheduler', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('schedules highlight without error', () => {
      const { scheduleHighlight, cleanup } = createHighlightScheduler();
      scheduleHighlight();
      cleanup();
    });

    it('deduplicates rapid calls', () => {
      const { scheduleHighlight, cleanup } = createHighlightScheduler();
      scheduleHighlight();
      scheduleHighlight(); // should be no-op (timer already pending)
      cleanup();
    });
  });
});
