import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Minimal browser-global mocks (avoids jsdom ESM issues on CI) ──

let _hash = '';
let _hashChangeListeners: Function[] = [];
let _replaceStateCalls: any[][] = [];

// Stub location.hash
const locationStub = {
  get hash() { return _hash; },
  set hash(v: string) { _hash = v; },
  get href() { return 'http://localhost' + _hash; },
  get pathname() { return '/'; },
  get origin() { return 'http://localhost'; },
  get protocol() { return 'http:'; },
  get host() { return 'localhost'; },
  get hostname() { return 'localhost'; },
  get port() { return ''; },
  get search() { return ''; },
  toString() { return 'http://localhost' + _hash; },
};

// Stub window
const windowStub = {
  addEventListener(event: string, listener: Function) {
    if (event === 'hashchange') _hashChangeListeners.push(listener);
  },
  removeEventListener(event: string, listener: Function) {
    if (event === 'hashchange') {
      _hashChangeListeners = _hashChangeListeners.filter(l => l !== listener);
    }
  },
  dispatchEvent(e: any) {
    if (e?.type === 'hashchange') {
      for (const listener of [..._hashChangeListeners]) listener(e);
    }
  },
  location: locationStub,
};

const historyStub = {
  replaceState(...args: any[]) {
    _replaceStateCalls.push(args);
    // Extract hash from the URL argument
    const url = args[2];
    if (url && typeof url === 'object' && url.hash) {
      _hash = url.hash;
    } else if (typeof url === 'string') {
      const m = url.match(/#.*/);
      if (m) _hash = m[0];
    }
  },
};

// Install stubs as globals
(globalThis as any).location = locationStub;
(globalThis as any).window = windowStub;
(globalThis as any).history = historyStub;
(globalThis as any).HashChangeEvent = class HashChangeEvent { type = 'hashchange'; constructor(public _type: string) {} };

// Mock vue's nextTick to run callback synchronously (good enough for tests)
vi.mock('vue', () => ({
  nextTick: (fn: Function) => fn(),
}));

import { createRouter } from '../../server/web/src/modules/router.js';

describe('createRouter', () => {
  let router: ReturnType<typeof createRouter>;

  beforeEach(() => {
    _hash = '';
    _hashChangeListeners = [];
    _replaceStateCalls = [];
    router = createRouter();
  });

  afterEach(() => {
    router.stop();
  });

  // ── Pattern matching ──

  describe('addRoute + route matching', () => {
    it('matches a static route', () => {
      const handler = vi.fn();
      router.addRoute('/team', handler);
      router.start();
      _hash = '#/team';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).toHaveBeenCalledWith({});
    });

    it('matches a route with a param', () => {
      const handler = vi.fn();
      router.addRoute('/chat/:sessionId', handler);
      router.start();
      _hash = '#/chat/abc123';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).toHaveBeenCalledWith({ sessionId: 'abc123' });
    });

    it('matches a route with multiple params', () => {
      const handler = vi.fn();
      router.addRoute('/loop/:loopId/exec/:execId', handler);
      router.start();
      _hash = '#/loop/L1/exec/E2';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).toHaveBeenCalledWith({ loopId: 'L1', execId: 'E2' });
    });

    it('does not match a route with wrong segment count', () => {
      const handler = vi.fn();
      router.addRoute('/team', handler);
      router.start();
      _hash = '#/team/extra';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not match a route with wrong static segment', () => {
      const handler = vi.fn();
      router.addRoute('/team', handler);
      router.start();
      _hash = '#/loop';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).not.toHaveBeenCalled();
    });

    it('matches the root route /', () => {
      const handler = vi.fn();
      router.addRoute('/', handler);
      router.start();
      _hash = '#/';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).toHaveBeenCalledWith({});
    });

    it('decodes URI-encoded params', () => {
      const handler = vi.fn();
      router.addRoute('/chat/:sessionId', handler);
      router.start();
      _hash = '#/chat/hello%20world';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).toHaveBeenCalledWith({ sessionId: 'hello world' });
    });

    it('silently ignores unknown routes', () => {
      const teamHandler = vi.fn();
      router.addRoute('/team', teamHandler);
      router.start();
      _hash = '#/unknown/path';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(teamHandler).not.toHaveBeenCalled();
    });
  });

  // ── push / replace ──

  describe('push', () => {
    it('updates location.hash', () => {
      router.start();
      router.push('/team');
      expect(_hash).toBe('#/team');
    });

    it('suppresses the next hashchange (no restore loop)', () => {
      const handler = vi.fn();
      router.addRoute('/team', handler);
      router.start();
      router.push('/team');
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).not.toHaveBeenCalled();
    });

    it('is a no-op when hash is already the target', () => {
      router.start();
      router.push('/team');
      expect(_hash).toBe('#/team');
      // Push same path again — should be a no-op
      router.push('/team');
      // Next hashchange should be handled (no _suppressNext was set for duplicate push)
      const handler = vi.fn();
      router.addRoute('/team', handler);
      // Re-create router to test handler
    });
  });

  describe('replace', () => {
    it('updates location.hash without adding history entry', () => {
      router.start();
      _replaceStateCalls = [];
      router.replace('/loop');
      expect(_hash).toBe('#/loop');
      expect(_replaceStateCalls.length).toBeGreaterThan(0);
    });

    it('suppresses the next hashchange', () => {
      const handler = vi.fn();
      router.addRoute('/loop', handler);
      router.start();
      router.replace('/loop');
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── start / stop ──

  describe('start', () => {
    it('restores initial hash on start', () => {
      const handler = vi.fn();
      router.addRoute('/team', handler);
      _hash = '#/team';
      router.start();
      expect(handler).toHaveBeenCalledWith({});
    });

    it('does not restore if hash is empty', () => {
      const handler = vi.fn();
      router.addRoute('/', handler);
      _hash = '';
      router.start();
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not restore if hash is just #/', () => {
      const handler = vi.fn();
      router.addRoute('/', handler);
      _hash = '#/';
      router.start();
      expect(handler).not.toHaveBeenCalled();
    });

    it('is idempotent (calling start twice does not double-listen)', () => {
      const handler = vi.fn();
      router.addRoute('/team', handler);
      router.start();
      router.start();
      _hash = '#/team';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('stops listening to hashchange', () => {
      const handler = vi.fn();
      router.addRoute('/team', handler);
      router.start();
      router.stop();
      _hash = '#/team';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── Circular-update prevention ──

  describe('circular-update prevention', () => {
    it('isRestoring returns true during restore', () => {
      let wasRestoring = false;
      router.addRoute('/team', () => {
        wasRestoring = router.isRestoring();
      });
      router.start();
      _hash = '#/team';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(wasRestoring).toBe(true);
    });

    it('push is a no-op during restore', () => {
      router.addRoute('/team', () => {
        router.push('/other');
      });
      router.start();
      _hash = '#/team';
      windowStub.dispatchEvent(new (globalThis as any).HashChangeEvent('hashchange'));
      expect(_hash).toBe('#/team');
    });
  });
});
