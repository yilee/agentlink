import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSearch } from '../../server/web/src/modules/search.js';

describe('createSearch', () => {
  let wsSend: ReturnType<typeof vi.fn>;
  let search: ReturnType<typeof createSearch>;

  beforeEach(() => {
    vi.useFakeTimers();
    wsSend = vi.fn();
    search = createSearch({ wsSend });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('performSearch', () => {
    it('sends brain_search message via wsSend', () => {
      search.performSearch('hello');
      expect(wsSend).toHaveBeenCalledWith({ type: 'brain_search', query: 'hello', sources: undefined, limit: undefined });
      expect(search.searching.value).toBe(true);
      expect(search.searchQuery.value).toBe('hello');
    });

    it('does not send message for empty query', () => {
      search.performSearch('');
      expect(wsSend).not.toHaveBeenCalled();
      expect(search.searching.value).toBe(false);
      expect(search.searchResults.value).toEqual([]);
    });

    it('trims whitespace from query', () => {
      search.performSearch('  hello  ');
      expect(wsSend).toHaveBeenCalledWith({ type: 'brain_search', query: 'hello', sources: undefined, limit: undefined });
      expect(search.searchQuery.value).toBe('hello');
    });

    it('passes sources and limit parameters', () => {
      search.performSearch('test', ['teams', 'emails'], 5);
      expect(wsSend).toHaveBeenCalledWith({ type: 'brain_search', query: 'test', sources: ['teams', 'emails'], limit: 5 });
    });

    it('clears previous results when query is empty', () => {
      search.searchResults.value = [{ source: 'teams', label: 'Teams', count: 1, entries: [] }];
      search.totalResults.value = 1;
      search.searchError.value = 'old error';
      search.performSearch('');
      expect(search.searchResults.value).toEqual([]);
      expect(search.totalResults.value).toBe(0);
      expect(search.searchError.value).toBe('');
    });
  });

  describe('performSearchDebounced', () => {
    it('debounces the search request', () => {
      search.performSearchDebounced('hello', undefined, undefined, 300);
      expect(wsSend).not.toHaveBeenCalled();
      expect(search.searching.value).toBe(true);

      vi.advanceTimersByTime(300);
      expect(wsSend).toHaveBeenCalledWith({ type: 'brain_search', query: 'hello', sources: undefined, limit: undefined });
    });

    it('cancels previous debounce on new call', () => {
      search.performSearchDebounced('he', undefined, undefined, 300);
      vi.advanceTimersByTime(100);
      search.performSearchDebounced('hello', undefined, undefined, 300);
      vi.advanceTimersByTime(300);

      expect(wsSend).toHaveBeenCalledTimes(1);
      expect(wsSend).toHaveBeenCalledWith({ type: 'brain_search', query: 'hello', sources: undefined, limit: undefined });
    });

    it('clears results immediately for empty query', () => {
      search.searchResults.value = [{ source: 'teams', label: 'Teams', count: 1, entries: [] }];
      search.performSearchDebounced('', undefined, undefined, 300);
      expect(search.searchResults.value).toEqual([]);
      expect(search.searching.value).toBe(false);
      expect(wsSend).not.toHaveBeenCalled();
    });
  });

  describe('handleSearchResults', () => {
    it('applies results matching current query', () => {
      search.searchQuery.value = 'test';
      search.searching.value = true;
      search.handleSearchResults({
        query: 'test',
        groups: [{ source: 'teams', label: 'Teams', count: 2, entries: [{ id: '1' }, { id: '2' }] }],
        totalResults: 2,
      });
      expect(search.searching.value).toBe(false);
      expect(search.searchResults.value).toHaveLength(1);
      expect(search.totalResults.value).toBe(2);
      expect(search.searchError.value).toBe('');
    });

    it('ignores results for stale queries', () => {
      search.searchQuery.value = 'new query';
      search.searching.value = true;
      search.handleSearchResults({
        query: 'old query',
        groups: [{ source: 'teams', label: 'Teams', count: 1, entries: [] }],
        totalResults: 1,
      });
      // Should not have changed
      expect(search.searching.value).toBe(true);
      expect(search.searchResults.value).toEqual([]);
    });

    it('handles error in results', () => {
      search.searchQuery.value = 'test';
      search.searching.value = true;
      search.handleSearchResults({
        query: 'test',
        error: 'Something went wrong',
      });
      expect(search.searching.value).toBe(false);
      expect(search.searchError.value).toBe('Something went wrong');
      expect(search.searchResults.value).toEqual([]);
      expect(search.totalResults.value).toBe(0);
    });
  });

  describe('handleSearchIndexStats', () => {
    it('sets index stats from message', () => {
      search.handleSearchIndexStats({
        sources: [
          { name: 'teams', count: 100, generated: '2026-03-28' },
          { name: 'emails', count: 200, generated: '2026-03-27' },
        ],
      });
      expect(search.indexStats.value).toHaveLength(2);
      expect(search.indexStats.value[0].name).toBe('teams');
    });

    it('handles error in stats (does not crash)', () => {
      search.handleSearchIndexStats({ error: 'No stats available' });
      expect(search.indexStats.value).toEqual([]);
    });
  });

  describe('loadIndexStats', () => {
    it('sends get_search_index_stats message', () => {
      search.loadIndexStats();
      expect(wsSend).toHaveBeenCalledWith({ type: 'get_search_index_stats' });
    });
  });

  describe('clearSearch', () => {
    it('resets all state', () => {
      search.searchQuery.value = 'test';
      search.searchResults.value = [{ source: 'teams', label: 'Teams', count: 1, entries: [] }];
      search.totalResults.value = 1;
      search.searching.value = true;
      search.searchError.value = 'err';

      search.clearSearch();

      expect(search.searchQuery.value).toBe('');
      expect(search.searchResults.value).toEqual([]);
      expect(search.totalResults.value).toBe(0);
      expect(search.searching.value).toBe(false);
      expect(search.searchError.value).toBe('');
    });

    it('cancels pending debounce timer', () => {
      search.performSearchDebounced('hello', undefined, undefined, 300);
      search.clearSearch();
      vi.advanceTimersByTime(300);
      expect(wsSend).not.toHaveBeenCalled();
    });
  });
});
