import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Lightweight mock of Vue's ref/computed so we don't need the full vue package
function ref(val: unknown) {
  return { value: val };
}
function computed(fn: () => unknown) {
  return { get value() { return fn(); } };
}
vi.mock('vue', () => ({ ref, computed }));

import { createBriefing } from '../../server/web/src/modules/briefing.js';

describe('createBriefing', () => {
  let wsSend: ReturnType<typeof vi.fn>;
  let currentView: { value: string };
  let briefing: ReturnType<typeof createBriefing>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 27, 10, 0, 0)); // Thu Mar 27 2026
    wsSend = vi.fn();
    currentView = ref('briefing-feed');
    briefing = createBriefing({ wsSend, currentView });
  });

  afterEach(() => {
    briefing.stopAutoRefresh();
    vi.useRealTimers();
  });

  describe('loadFeed', () => {
    it('sets loading and sends list_briefings message', () => {
      briefing.loadFeed();
      expect(briefing.loading.value).toBe(true);
      expect(wsSend).toHaveBeenCalledWith({ type: 'list_briefings' });
    });
  });

  describe('handleBriefingsList', () => {
    it('populates feedEntries and clears loading', () => {
      briefing.loading.value = true;
      const entries = [
        { date: '2026-03-27', title: 'Briefing 1', tldr: 'Summary', action_today: 2, action_week: 1, fyi_count: 0 },
        { date: '2026-03-26', title: 'Briefing 2', tldr: 'Older', action_today: 0, action_week: 3, fyi_count: 1 },
      ];
      briefing.handleBriefingsList({ briefings: entries });
      expect(briefing.feedEntries.value).toEqual(entries);
      expect(briefing.loading.value).toBe(false);
    });

    it('handles missing briefings key gracefully', () => {
      briefing.handleBriefingsList({});
      expect(briefing.feedEntries.value).toEqual([]);
      expect(briefing.loading.value).toBe(false);
    });
  });

  describe('selectBriefing', () => {
    it('sets selectedDate, sends get_briefing_detail, and switches to detail view', () => {
      briefing.selectBriefing('2026-03-27');
      expect(briefing.selectedDate.value).toBe('2026-03-27');
      expect(briefing.selectedContent.value).toBeNull();
      expect(briefing.detailLoading.value).toBe(true);
      expect(currentView.value).toBe('briefing-detail');
      expect(wsSend).toHaveBeenCalledWith({ type: 'get_briefing_detail', date: '2026-03-27' });
    });
  });

  describe('handleBriefingDetail', () => {
    it('sets content when date matches', () => {
      briefing.selectBriefing('2026-03-27');
      briefing.handleBriefingDetail({ date: '2026-03-27', content: '# Full content' });
      expect(briefing.selectedContent.value).toBe('# Full content');
      expect(briefing.detailLoading.value).toBe(false);
    });

    it('ignores content when date does not match', () => {
      briefing.selectBriefing('2026-03-27');
      briefing.handleBriefingDetail({ date: '2026-03-26', content: '# Wrong date' });
      expect(briefing.selectedContent.value).toBeNull();
      expect(briefing.detailLoading.value).toBe(false);
    });
  });

  describe('goBackToFeed', () => {
    it('clears detail state and switches to feed view', () => {
      briefing.selectBriefing('2026-03-27');
      briefing.handleBriefingDetail({ date: '2026-03-27', content: '# Content' });
      briefing.goBackToFeed();
      expect(briefing.selectedDate.value).toBeNull();
      expect(briefing.selectedContent.value).toBeNull();
      expect(briefing.detailLoading.value).toBe(false);
      expect(currentView.value).toBe('briefing-feed');
    });
  });

  describe('groupedEntries', () => {
    it('groups entries by date bucket', () => {
      briefing.handleBriefingsList({
        briefings: [
          { date: '2026-03-27', title: 'Today' },
          { date: '2026-03-26', title: 'Yesterday' },
          { date: '2026-03-20', title: 'Last Week' },
          { date: '2026-02-15', title: 'Older' },
        ],
      });
      const groups = briefing.groupedEntries.value;
      expect(groups.map((g: { label: string }) => g.label)).toEqual(['Today', 'Yesterday', 'Last Week', 'Older']);
      expect(groups[0].entries).toHaveLength(1);
      expect(groups[0].entries[0].title).toBe('Today');
    });

    it('returns empty array for no entries', () => {
      expect(briefing.groupedEntries.value).toEqual([]);
    });

    it('omits empty date buckets', () => {
      briefing.handleBriefingsList({
        briefings: [
          { date: '2026-03-27', title: 'Today' },
          { date: '2025-01-01', title: 'Very Old' },
        ],
      });
      const groups = briefing.groupedEntries.value;
      expect(groups.map((g: { label: string }) => g.label)).toEqual(['Today', 'Older']);
    });
  });

  describe('auto-refresh', () => {
    it('starts and stops interval timer', () => {
      briefing.startAutoRefresh();
      expect(wsSend).not.toHaveBeenCalled();

      // Advance past the 30-minute interval
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(wsSend).toHaveBeenCalledWith({ type: 'list_briefings' });

      briefing.stopAutoRefresh();
      wsSend.mockClear();
      vi.advanceTimersByTime(30 * 60 * 1000);
      expect(wsSend).not.toHaveBeenCalled();
    });

    it('restarts timer on repeated startAutoRefresh calls', () => {
      briefing.startAutoRefresh();
      briefing.startAutoRefresh(); // should clear old timer
      vi.advanceTimersByTime(30 * 60 * 1000);
      // Should only fire once (not twice from two timers)
      expect(wsSend).toHaveBeenCalledTimes(1);
    });
  });
});
