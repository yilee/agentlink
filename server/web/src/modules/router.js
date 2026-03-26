// ── Hash Router — URL-driven page state ─────────────────────────────────────
import { nextTick } from 'vue';

/**
 * Creates a lightweight hash router for encoding view state in the URL.
 *
 * Usage:
 *   const router = createRouter();
 *   router.addRoute('/team', () => { viewMode.value = 'team'; });
 *   router.addRoute('/chat/:sessionId', ({ sessionId }) => { ... });
 *   router.start();  // call after WebSocket connects
 */
export function createRouter() {
  const _routes = [];  // { segments: string[], paramNames: string[], handler: Function }
  let _restoring = false;
  let _suppressNext = false;
  let _started = false;

  // ── Route registration ──

  /**
   * Register a route pattern with a handler.
   * Pattern: '/team/agent/:agentId' — static segments + :param segments.
   */
  function addRoute(pattern, handler) {
    const parts = pattern.replace(/^\//, '').split('/').filter(Boolean);
    const segments = [];
    const paramNames = [];
    for (const part of parts) {
      if (part.startsWith(':')) {
        segments.push(null); // null = param slot
        paramNames.push(part.slice(1));
      } else {
        segments.push(part);
        paramNames.push(null);
      }
    }
    _routes.push({ segments, paramNames, handler });
  }

  // ── Pattern matching ──

  function _match(path) {
    const parts = path.replace(/^\//, '').split('/').filter(Boolean);

    // Try longest match first — routes are tried in registration order,
    // but segment count must match exactly.
    for (const route of _routes) {
      if (route.segments.length !== parts.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        if (route.segments[i] === null) {
          // Param slot — capture value
          params[route.paramNames[i]] = decodeURIComponent(parts[i]);
        } else if (route.segments[i] !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  // ── Hash → state restoration ──

  function _restore() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const result = _match(hash);
    if (!result) return; // Unknown route — silently ignore

    _restoring = true;
    result.handler(result.params);
    nextTick(() => { _restoring = false; });
  }

  function _onHashChange() {
    if (_suppressNext) { _suppressNext = false; return; }
    _restore();
  }

  // ── State → hash sync ──

  /**
   * Update the URL hash (adds a history entry).
   * Suppresses the next hashchange to avoid restore loop.
   * No-op when called during a restore cycle.
   */
  function push(path) {
    if (_restoring) return;
    const target = '#' + path;
    if (location.hash === target) return; // Already there
    _suppressNext = true;
    location.hash = target;
  }

  /**
   * Replace the current URL hash (no history entry).
   * Suppresses the next hashchange to avoid restore loop.
   * No-op when called during a restore cycle.
   */
  function replace(path) {
    if (_restoring) return;
    const target = '#' + path;
    if (location.hash === target) return;
    _suppressNext = true;
    const url = new URL(location);
    url.hash = target;
    history.replaceState(null, '', url);
  }

  // ── Lifecycle ──

  /**
   * Start listening to hashchange and restore the initial hash.
   * Call this AFTER WebSocket connects so route handlers can safely
   * call wsSend / access module state.
   */
  function start() {
    if (_started) return;
    _started = true;
    window.addEventListener('hashchange', _onHashChange);
    // Restore initial hash (if any)
    if (location.hash && location.hash !== '#' && location.hash !== '#/') {
      _restore();
    }
  }

  /** Stop listening (cleanup). */
  function stop() {
    _started = false;
    window.removeEventListener('hashchange', _onHashChange);
  }

  /** Whether the router is currently restoring state from hash. */
  function isRestoring() {
    return _restoring;
  }

  return { addRoute, push, replace, start, stop, isRestoring };
}
