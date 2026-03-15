// ── UI utility functions for the main App component ──────────────────────────
import hljs from 'highlight.js';

/**
 * Create scroll management functions.
 * @param {string} selector - CSS selector for the scrollable element
 * @returns {{ onScroll, scrollToBottom, cleanup }}
 */
export function createScrollManager(selector) {
  let _rafId = null;
  let _userScrolledUp = false;

  function onScroll(e) {
    const el = e.target;
    _userScrolledUp = (el.scrollHeight - el.scrollTop - el.clientHeight) > 80;
  }

  function scrollToBottom(force) {
    if (_userScrolledUp && !force) return;
    if (document.hidden) return;
    if (_rafId) return;
    _rafId = requestAnimationFrame(() => {
      _rafId = null;
      const el = document.querySelector(selector);
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function cleanup() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
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
      const root = document.querySelector('.message-list') || document;
      root.querySelectorAll('pre code:not([data-highlighted])').forEach(block => {
        hljs.highlightElement(block);
        block.dataset.highlighted = 'true';
      });
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

export function formatDurationShort(ms) {
  if (!ms && ms !== 0) return '';
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return (ms / 1000).toFixed(1) + 's';
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  if (m < 60) return m + 'm ' + String(s).padStart(2, '0') + 's';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return h + 'h ' + String(rm).padStart(2, '0') + 'm';
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
  const dur = formatDurationShort(u.durationMs);
  const contextLabel = t ? t('usage.context') : 'Context';
  const costLabel = t ? t('usage.cost') : 'Cost';
  return contextLabel + ' ' + ctx + '  \u00b7  ' + costLabel + ' ' + cost + '  \u00b7  ' + model + '  \u00b7  ' + dur;
}
