// ── Chat Search: session list filtering + in-conversation message search ──
import { ref, computed } from 'vue';

/**
 * Creates chat search functionality (session filtering + message search).
 * @param {object} deps
 * @param {import('vue').Ref} deps.historySessions
 * @param {import('vue').ComputedRef} deps.groupedSessions
 * @param {import('vue').ComputedRef} deps.flatSessionItems
 * @param {import('vue').Ref} deps.messages
 * @param {Function} deps.t
 */
export function createChatSearch(deps) {
  const { historySessions, groupedSessions, flatSessionItems, messages, t } = deps;

  // ── Session search ──
  const sessionSearchQuery = ref('');

  const filteredFlatSessionItems = computed(() => {
    const query = sessionSearchQuery.value.trim().toLowerCase();
    if (!query) return flatSessionItems.value;

    // Filter groupedSessions, then rebuild flat items
    const items = [];
    for (const group of groupedSessions.value) {
      const matched = group.sessions.filter(s => {
        const title = (s.title || '').toLowerCase();
        const preview = (s.preview || '').toLowerCase();
        return title.includes(query) || preview.includes(query);
      });
      if (matched.length > 0) {
        items.push({ _type: 'header', label: group.label });
        for (const s of matched) {
          items.push({ _type: 'session', ...s });
        }
      }
    }
    return items;
  });

  // ── Message search ──
  const messageSearchQuery = ref('');

  const messageSearchResults = computed(() => {
    const query = messageSearchQuery.value.trim().toLowerCase();
    if (!query) return [];

    const results = [];
    for (let i = 0; i < messages.value.length; i++) {
      const msg = messages.value[i];
      const content = msg.content || '';
      const lowerContent = content.toLowerCase();
      const matchStart = lowerContent.indexOf(query);
      if (matchStart === -1) continue;

      // Extract snippet: keyword ± ~30 chars
      const snippetStart = Math.max(0, matchStart - 30);
      const snippetEnd = Math.min(content.length, matchStart + query.length + 30);
      let snippet = content.slice(snippetStart, snippetEnd).replace(/\n/g, ' ');
      if (snippetStart > 0) snippet = '\u2026' + snippet;
      if (snippetEnd < content.length) snippet += '\u2026';

      results.push({
        role: msg.role,
        msgIdx: i,
        msgId: msg.id,
        snippet,
        matchStart: matchStart - snippetStart + (snippetStart > 0 ? 1 : 0), // offset within snippet (account for ellipsis)
        matchLength: query.length,
      });
    }
    return results;
  });

  return {
    sessionSearchQuery,
    filteredFlatSessionItems,
    messageSearchQuery,
    messageSearchResults,
  };
}
