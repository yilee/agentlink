// ── UI utility functions for the main App component ──────────────────────────

/**
 * Create scroll management functions.
 * @param {string} selector - CSS selector for the scrollable element
 * @returns {{ onScroll, scrollToBottom, cleanup }}
 */
export function createScrollManager(selector) {
  let _scrollTimer = null;
  let _userScrolledUp = false;

  function onScroll(e) {
    const el = e.target;
    _userScrolledUp = (el.scrollHeight - el.scrollTop - el.clientHeight) > 80;
  }

  function scrollToBottom(force) {
    if (_userScrolledUp && !force) return;
    if (_scrollTimer) return;
    _scrollTimer = setTimeout(() => {
      _scrollTimer = null;
      const el = document.querySelector(selector);
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  function cleanup() {
    if (_scrollTimer) { clearTimeout(_scrollTimer); _scrollTimer = null; }
  }

  return { onScroll, scrollToBottom, cleanup };
}

/**
 * Create a debounced highlight.js scheduler.
 * @returns {{ scheduleHighlight, cleanup }}
 */
export function createHighlightScheduler() {
  let _hlTimer = null;

  function scheduleHighlight() {
    if (_hlTimer) return;
    _hlTimer = setTimeout(() => {
      _hlTimer = null;
      if (typeof hljs !== 'undefined') {
        document.querySelectorAll('pre code:not([data-highlighted])').forEach(block => {
          hljs.highlightElement(block);
          block.dataset.highlighted = 'true';
        });
      }
    }, 300);
  }

  function cleanup() {
    if (_hlTimer) { clearTimeout(_hlTimer); _hlTimer = null; }
  }

  return { scheduleHighlight, cleanup };
}

/**
 * Format a token count for display (e.g. 1500 → "1.5k").
 * @param {number} n
 * @returns {string}
 */
export function formatTokens(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

/**
 * Format a usage stats object into a human-readable summary string.
 * @param {object|null} u - Usage stats from turn_completed
 * @returns {string}
 */
export function formatUsage(u, t) {
  if (!u) return '';
  const pct = u.contextWindow ? Math.round(u.inputTokens / u.contextWindow * 100) : 0;
  const ctx = formatTokens(u.inputTokens) + ' / ' + formatTokens(u.contextWindow) + ' (' + pct + '%)';
  const cost = '$' + u.totalCost.toFixed(2);
  const model = u.model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-1m$/, '');
  const dur = (u.durationMs / 1000).toFixed(1) + 's';
  const contextLabel = t ? t('usage.context') : 'Context';
  const costLabel = t ? t('usage.cost') : 'Cost';
  return contextLabel + ' ' + ctx + '  \u00b7  ' + costLabel + ' ' + cost + '  \u00b7  ' + model + '  \u00b7  ' + dur;
}
