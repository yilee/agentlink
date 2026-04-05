import { describe, it, expect } from 'vitest';
// Import Vue reactivity from the web workspace
import { ref, computed } from '../../server/web/node_modules/vue/dist/vue.cjs.js';
import { createChatSearch } from '../../server/web/src/modules/chatSearch.js';

function makeDeps(overrides: any = {}) {
  const historySessions = ref(overrides.historySessions ?? []);
  const groupedSessions = computed(() => overrides.groupedSessions ?? []);
  const flatSessionItems = computed(() => overrides.flatSessionItems ?? []);
  const messages = ref(overrides.messages ?? []);
  const t = (k: string) => k;
  return { historySessions, groupedSessions, flatSessionItems, messages, t };
}

describe('createChatSearch', () => {
  // ── Session search ──

  describe('filteredFlatSessionItems', () => {
    it('returns all flat items when query is empty', () => {
      const flat = [
        { _type: 'header', label: 'Today' },
        { _type: 'session', sessionId: '1', title: 'Hello world' },
      ];
      const deps = makeDeps({ flatSessionItems: flat });
      const cs = createChatSearch(deps);

      expect(cs.filteredFlatSessionItems.value).toEqual(flat);
    });

    it('filters sessions by title match', () => {
      const deps = makeDeps({
        groupedSessions: [
          { label: 'Today', sessions: [
            { sessionId: '1', title: 'Fix authentication bug', preview: '' },
            { sessionId: '2', title: 'Add new feature', preview: '' },
          ]},
        ],
        flatSessionItems: [
          { _type: 'header', label: 'Today' },
          { _type: 'session', sessionId: '1', title: 'Fix authentication bug' },
          { _type: 'session', sessionId: '2', title: 'Add new feature' },
        ],
      });
      const cs = createChatSearch(deps);
      cs.sessionSearchQuery.value = 'auth';

      const results = cs.filteredFlatSessionItems.value;
      expect(results).toHaveLength(2); // header + 1 session
      expect(results[0]).toEqual({ _type: 'header', label: 'Today' });
      expect(results[1].sessionId).toBe('1');
    });

    it('filters sessions by preview match', () => {
      const deps = makeDeps({
        groupedSessions: [
          { label: 'Today', sessions: [
            { sessionId: '1', title: 'Session A', preview: 'debugging the login flow' },
            { sessionId: '2', title: 'Session B', preview: 'refactor CSS' },
          ]},
        ],
        flatSessionItems: [],
      });
      const cs = createChatSearch(deps);
      cs.sessionSearchQuery.value = 'login';

      const results = cs.filteredFlatSessionItems.value;
      expect(results).toHaveLength(2);
      expect(results[1].sessionId).toBe('1');
    });

    it('is case insensitive', () => {
      const deps = makeDeps({
        groupedSessions: [
          { label: 'Today', sessions: [
            { sessionId: '1', title: 'FIX BUG', preview: '' },
          ]},
        ],
        flatSessionItems: [],
      });
      const cs = createChatSearch(deps);
      cs.sessionSearchQuery.value = 'fix bug';

      expect(cs.filteredFlatSessionItems.value).toHaveLength(2);
    });

    it('omits groups with no matching sessions', () => {
      const deps = makeDeps({
        groupedSessions: [
          { label: 'Today', sessions: [
            { sessionId: '1', title: 'Alpha', preview: '' },
          ]},
          { label: 'Yesterday', sessions: [
            { sessionId: '2', title: 'Beta', preview: '' },
          ]},
        ],
        flatSessionItems: [],
      });
      const cs = createChatSearch(deps);
      cs.sessionSearchQuery.value = 'alpha';

      const results = cs.filteredFlatSessionItems.value;
      expect(results).toHaveLength(2); // Today header + Alpha session
      expect(results.find((r: any) => r.label === 'Yesterday')).toBeUndefined();
    });

    it('returns empty array when nothing matches', () => {
      const deps = makeDeps({
        groupedSessions: [
          { label: 'Today', sessions: [
            { sessionId: '1', title: 'Hello', preview: 'world' },
          ]},
        ],
        flatSessionItems: [],
      });
      const cs = createChatSearch(deps);
      cs.sessionSearchQuery.value = 'zzz_no_match';

      expect(cs.filteredFlatSessionItems.value).toEqual([]);
    });

    it('treats whitespace-only query as empty', () => {
      const flat = [
        { _type: 'header', label: 'Today' },
        { _type: 'session', sessionId: '1', title: 'Hello' },
      ];
      const deps = makeDeps({
        groupedSessions: [{ label: 'Today', sessions: [{ sessionId: '1', title: 'Hello', preview: '' }] }],
        flatSessionItems: flat,
      });
      const cs = createChatSearch(deps);
      cs.sessionSearchQuery.value = '  ';

      expect(cs.filteredFlatSessionItems.value).toEqual(flat);
    });
  });

  // ── Message search ──

  describe('messageSearchResults', () => {
    it('returns empty when query is empty', () => {
      const deps = makeDeps({
        messages: [{ role: 'user', id: '1', content: 'hello world' }],
      });
      const cs = createChatSearch(deps);

      expect(cs.messageSearchResults.value).toEqual([]);
    });

    it('finds matches in user messages', () => {
      const deps = makeDeps({
        messages: [
          { role: 'user', id: 'u1', content: 'How do I fix the authentication bug?' },
          { role: 'assistant', id: 'a1', content: 'Try checking the middleware.' },
        ],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'authentication';

      const results = cs.messageSearchResults.value;
      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('user');
      expect(results[0].msgIdx).toBe(0);
      expect(results[0].msgId).toBe('u1');
      expect(results[0].matchLength).toBe('authentication'.length);
    });

    it('finds matches in assistant messages', () => {
      const deps = makeDeps({
        messages: [
          { role: 'user', id: 'u1', content: 'Help me' },
          { role: 'assistant', id: 'a1', content: 'Check the middleware configuration.' },
        ],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'middleware';

      const results = cs.messageSearchResults.value;
      expect(results).toHaveLength(1);
      expect(results[0].role).toBe('assistant');
      expect(results[0].msgIdx).toBe(1);
    });

    it('is case insensitive', () => {
      const deps = makeDeps({
        messages: [{ role: 'user', id: 'u1', content: 'HELLO WORLD' }],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'hello';

      expect(cs.messageSearchResults.value).toHaveLength(1);
    });

    it('extracts snippet with ellipsis for mid-content match', () => {
      const longText = 'A'.repeat(50) + 'KEYWORD' + 'B'.repeat(50);
      const deps = makeDeps({
        messages: [{ role: 'user', id: 'u1', content: longText }],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'keyword';

      const results = cs.messageSearchResults.value;
      expect(results).toHaveLength(1);
      const snippet = results[0].snippet;
      expect(snippet.startsWith('\u2026')).toBe(true);
      expect(snippet.endsWith('\u2026')).toBe(true);
      expect(snippet).toContain('KEYWORD');
    });

    it('no leading ellipsis when match is near start', () => {
      const deps = makeDeps({
        messages: [{ role: 'user', id: 'u1', content: 'keyword and some trailing text that goes on for a while' }],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'keyword';

      const snippet = cs.messageSearchResults.value[0].snippet;
      expect(snippet.startsWith('\u2026')).toBe(false);
    });

    it('no trailing ellipsis when match is near end', () => {
      const deps = makeDeps({
        messages: [{ role: 'user', id: 'u1', content: 'some text keyword' }],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'keyword';

      const snippet = cs.messageSearchResults.value[0].snippet;
      expect(snippet.endsWith('\u2026')).toBe(false);
    });

    it('matchStart correctly accounts for ellipsis offset', () => {
      const longText = 'A'.repeat(50) + 'keyword' + 'B'.repeat(50);
      const deps = makeDeps({
        messages: [{ role: 'user', id: 'u1', content: longText }],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'keyword';

      const r = cs.messageSearchResults.value[0];
      const match = r.snippet.slice(r.matchStart, r.matchStart + r.matchLength);
      expect(match.toLowerCase()).toBe('keyword');
    });

    it('replaces newlines with spaces in snippet', () => {
      const deps = makeDeps({
        messages: [{ role: 'user', id: 'u1', content: 'hello\nworld\nkeyword\nhere' }],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'keyword';

      const snippet = cs.messageSearchResults.value[0].snippet;
      expect(snippet).not.toContain('\n');
    });

    it('skips messages with no content', () => {
      const deps = makeDeps({
        messages: [
          { role: 'user', id: 'u1', content: '' },
          { role: 'user', id: 'u2', content: null },
          { role: 'user', id: 'u3', content: 'hello keyword' },
        ],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'keyword';

      const results = cs.messageSearchResults.value;
      expect(results).toHaveLength(1);
      expect(results[0].msgId).toBe('u3');
    });

    it('returns multiple results from different messages', () => {
      const deps = makeDeps({
        messages: [
          { role: 'user', id: 'u1', content: 'fix the bug' },
          { role: 'assistant', id: 'a1', content: 'the bug is in auth' },
          { role: 'user', id: 'u2', content: 'another bug found' },
        ],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = 'bug';

      expect(cs.messageSearchResults.value).toHaveLength(3);
    });

    it('treats whitespace-only query as empty', () => {
      const deps = makeDeps({
        messages: [{ role: 'user', id: 'u1', content: 'hello world' }],
      });
      const cs = createChatSearch(deps);
      cs.messageSearchQuery.value = '   ';

      expect(cs.messageSearchResults.value).toEqual([]);
    });
  });
});
