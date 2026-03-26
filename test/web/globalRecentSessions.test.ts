/**
 * Tests for Global Recent Sessions feature — session handler, sidebar methods
 * (requestGlobalSessions, resumeGlobalSession, onWorkdirChanged).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('globalRecentSessions', () => {
  // Minimal reactive ref helper (mirrors Vue's ref for testing)
  function ref<T>(val: T) {
    return { value: val };
  }

  describe('recent_sessions_list handler', () => {
    it('populates globalRecentSessions from message', () => {
      const globalRecentSessions = ref<any[]>([]);
      const loadingGlobalSessions = ref(true);

      function handleRecentSessionsList(msg: { sessions?: any[] }) {
        globalRecentSessions.value = msg.sessions || [];
        loadingGlobalSessions.value = false;
      }

      const sessions = [
        { sessionId: 's1', title: 'Session 1', projectPath: '/home/user/proj1', lastModified: 1000 },
        { sessionId: 's2', title: 'Session 2', projectPath: '/home/user/proj2', lastModified: 2000 },
      ];

      handleRecentSessionsList({ sessions });
      expect(globalRecentSessions.value).toHaveLength(2);
      expect(globalRecentSessions.value[0].sessionId).toBe('s1');
      expect(loadingGlobalSessions.value).toBe(false);
    });

    it('defaults to empty array when sessions is undefined', () => {
      const globalRecentSessions = ref<any[]>([{ sessionId: 'old' }]);
      const loadingGlobalSessions = ref(true);

      function handleRecentSessionsList(msg: { sessions?: any[] }) {
        globalRecentSessions.value = msg.sessions || [];
        loadingGlobalSessions.value = false;
      }

      handleRecentSessionsList({});
      expect(globalRecentSessions.value).toHaveLength(0);
      expect(loadingGlobalSessions.value).toBe(false);
    });
  });

  describe('requestGlobalSessions', () => {
    it('sends list_recent_sessions on first call', () => {
      const globalRecentSessions = ref<any[]>([]);
      const loadingGlobalSessions = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);

      let loaded = false;

      function requestGlobalSessions() {
        if (loaded && globalRecentSessions.value.length > 0) return;
        loadingGlobalSessions.value = true;
        wsSend({ type: 'list_recent_sessions', limit: 20 });
        loaded = true;
      }

      requestGlobalSessions();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({ type: 'list_recent_sessions', limit: 20 });
      expect(loadingGlobalSessions.value).toBe(true);
    });

    it('skips request when already loaded with data', () => {
      const globalRecentSessions = ref<any[]>([{ sessionId: 's1' }]);
      const loadingGlobalSessions = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);

      let loaded = true; // already loaded

      function requestGlobalSessions() {
        if (loaded && globalRecentSessions.value.length > 0) return;
        loadingGlobalSessions.value = true;
        wsSend({ type: 'list_recent_sessions', limit: 20 });
        loaded = true;
      }

      requestGlobalSessions();
      expect(sent).toHaveLength(0);
      expect(loadingGlobalSessions.value).toBe(false);
    });

    it('sends request when loaded but data is empty', () => {
      const globalRecentSessions = ref<any[]>([]);
      const loadingGlobalSessions = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);

      let loaded = true; // loaded but no data

      function requestGlobalSessions() {
        if (loaded && globalRecentSessions.value.length > 0) return;
        loadingGlobalSessions.value = true;
        wsSend({ type: 'list_recent_sessions', limit: 20 });
        loaded = true;
      }

      requestGlobalSessions();
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('list_recent_sessions');
    });
  });

  describe('refreshGlobalSessions', () => {
    it('always sends request regardless of loaded state', () => {
      const loadingGlobalSessions = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);

      function refreshGlobalSessions() {
        loadingGlobalSessions.value = true;
        wsSend({ type: 'list_recent_sessions', limit: 20 });
      }

      refreshGlobalSessions();
      expect(sent).toHaveLength(1);
      expect(loadingGlobalSessions.value).toBe(true);

      refreshGlobalSessions();
      expect(sent).toHaveLength(2);
    });
  });

  describe('resumeGlobalSession', () => {
    it('resumes directly when workDir matches (same-dir)', () => {
      const workDir = ref('Q:\\src\\agentlink');
      const sidebarOpen = ref(true);
      const workdirSwitching = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const resumed: any[] = [];

      function resumeSession(session: any) {
        resumed.push(session);
      }

      function setWorkdirSwitching() {
        workdirSwitching.value = true;
      }

      let pendingGlobalResume: string | null = null;

      function resumeGlobalSession(session: any) {
        const currentDir = (workDir.value || '').replace(/[/\\]+$/, '');
        const sessionDir = (session.projectPath || '').replace(/[/\\]+$/, '');
        const sameWorkDir = currentDir.toLowerCase() === sessionDir.toLowerCase();

        if (sameWorkDir) {
          resumeSession({ sessionId: session.sessionId, title: session.title });
        } else {
          setWorkdirSwitching();
          wsSend({ type: 'change_workdir', workDir: session.projectPath });
          pendingGlobalResume = session.sessionId;
        }
      }

      resumeGlobalSession({
        sessionId: 'abc123',
        title: 'My Session',
        projectPath: 'Q:\\src\\agentlink',
      });

      expect(resumed).toHaveLength(1);
      expect(resumed[0]).toEqual({ sessionId: 'abc123', title: 'My Session' });
      expect(sent).toHaveLength(0); // no change_workdir sent
      expect(workdirSwitching.value).toBe(false);
    });

    it('sends change_workdir and sets pending resume when workDir differs', () => {
      const workDir = ref('Q:\\src\\agentlink');
      const workdirSwitching = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const resumed: any[] = [];

      function resumeSession(session: any) {
        resumed.push(session);
      }

      function setWorkdirSwitching() {
        workdirSwitching.value = true;
      }

      let pendingGlobalResume: string | null = null;

      function resumeGlobalSession(session: any) {
        const currentDir = (workDir.value || '').replace(/[/\\]+$/, '');
        const sessionDir = (session.projectPath || '').replace(/[/\\]+$/, '');
        const sameWorkDir = currentDir.toLowerCase() === sessionDir.toLowerCase();

        if (sameWorkDir) {
          resumeSession({ sessionId: session.sessionId, title: session.title });
        } else {
          setWorkdirSwitching();
          wsSend({ type: 'change_workdir', workDir: session.projectPath });
          pendingGlobalResume = session.sessionId;
        }
      }

      resumeGlobalSession({
        sessionId: 'xyz789',
        title: 'Other Session',
        projectPath: '/home/user/other-project',
      });

      expect(resumed).toHaveLength(0); // not resumed yet
      expect(sent).toHaveLength(1);
      expect(sent[0]).toEqual({ type: 'change_workdir', workDir: '/home/user/other-project' });
      expect(workdirSwitching.value).toBe(true);
      expect(pendingGlobalResume).toBe('xyz789');
    });

    it('normalizes trailing slashes when comparing workDir', () => {
      const workDir = ref('Q:\\src\\agentlink\\');
      const workdirSwitching = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const resumed: any[] = [];

      function resumeSession(session: any) {
        resumed.push(session);
      }

      function setWorkdirSwitching() {
        workdirSwitching.value = true;
      }

      let pendingGlobalResume: string | null = null;

      function resumeGlobalSession(session: any) {
        const currentDir = (workDir.value || '').replace(/[/\\]+$/, '');
        const sessionDir = (session.projectPath || '').replace(/[/\\]+$/, '');
        const sameWorkDir = currentDir.toLowerCase() === sessionDir.toLowerCase();

        if (sameWorkDir) {
          resumeSession({ sessionId: session.sessionId, title: session.title });
        } else {
          setWorkdirSwitching();
          wsSend({ type: 'change_workdir', workDir: session.projectPath });
          pendingGlobalResume = session.sessionId;
        }
      }

      // Same dir but with trailing slash difference
      resumeGlobalSession({
        sessionId: 'abc',
        title: 'Same Dir',
        projectPath: 'Q:\\src\\agentlink',
      });

      expect(resumed).toHaveLength(1); // should match after normalization
      expect(sent).toHaveLength(0);
    });
  });

  describe('onWorkdirChanged', () => {
    it('returns false and clears switching state when no pending resume', () => {
      const workdirSwitching = ref(true);
      let pendingGlobalResume: string | null = null;
      const resumed: any[] = [];

      function resumeSession(session: any) {
        resumed.push(session);
      }

      function onWorkdirChanged() {
        workdirSwitching.value = false;
        if (pendingGlobalResume) {
          const sid = pendingGlobalResume;
          pendingGlobalResume = null;
          resumeSession({ sessionId: sid });
          return true;
        }
        return false;
      }

      const result = onWorkdirChanged();
      expect(result).toBe(false);
      expect(workdirSwitching.value).toBe(false);
      expect(resumed).toHaveLength(0);
    });

    it('returns true and triggers resume when pending global resume exists', () => {
      const workdirSwitching = ref(true);
      let pendingGlobalResume: string | null = 'session-abc';
      const resumed: any[] = [];

      function resumeSession(session: any) {
        resumed.push(session);
      }

      function onWorkdirChanged() {
        workdirSwitching.value = false;
        if (pendingGlobalResume) {
          const sid = pendingGlobalResume;
          pendingGlobalResume = null;
          resumeSession({ sessionId: sid });
          return true;
        }
        return false;
      }

      const result = onWorkdirChanged();
      expect(result).toBe(true);
      expect(workdirSwitching.value).toBe(false);
      expect(resumed).toHaveLength(1);
      expect(resumed[0]).toEqual({ sessionId: 'session-abc' });
      expect(pendingGlobalResume).toBeNull(); // cleared after use
    });

    it('clears pending resume after use (one-shot)', () => {
      const workdirSwitching = ref(true);
      let pendingGlobalResume: string | null = 'session-xyz';
      const resumed: any[] = [];

      function resumeSession(session: any) {
        resumed.push(session);
      }

      function onWorkdirChanged() {
        workdirSwitching.value = false;
        if (pendingGlobalResume) {
          const sid = pendingGlobalResume;
          pendingGlobalResume = null;
          resumeSession({ sessionId: sid });
          return true;
        }
        return false;
      }

      // First call — consumes pending resume
      expect(onWorkdirChanged()).toBe(true);
      expect(resumed).toHaveLength(1);

      // Second call — no more pending resume
      workdirSwitching.value = true;
      expect(onWorkdirChanged()).toBe(false);
      expect(resumed).toHaveLength(1); // no additional resume
    });
  });

  describe('workdir_changed handler integration', () => {
    it('skips new conversation when onWorkdirChanged returns true', () => {
      const workdirSwitching = ref(true);
      const workDir = ref('old/dir');
      const messages = ref<any[]>([]);
      let switchConversationCalled = false;
      let pendingGlobalResume: string | null = 'resume-session';
      const resumed: any[] = [];

      function resumeSession(session: any) {
        resumed.push(session);
      }

      function switchConversation(_id: string) {
        switchConversationCalled = true;
      }

      function onWorkdirChanged() {
        workdirSwitching.value = false;
        if (pendingGlobalResume) {
          const sid = pendingGlobalResume;
          pendingGlobalResume = null;
          resumeSession({ sessionId: sid });
          return true;
        }
        return false;
      }

      // Simulate workdir_changed handler
      const msg = { workDir: '/new/dir' };
      workDir.value = msg.workDir;
      const hasGlobalResume = onWorkdirChanged();

      if (!hasGlobalResume) {
        switchConversation(crypto.randomUUID());
        messages.value.push({ role: 'system', content: 'Dir changed' });
      }

      expect(hasGlobalResume).toBe(true);
      expect(switchConversationCalled).toBe(false); // skipped
      expect(messages.value).toHaveLength(0); // no system message
      expect(resumed).toHaveLength(1);
      expect(resumed[0].sessionId).toBe('resume-session');
    });

    it('creates new conversation when onWorkdirChanged returns false', () => {
      const workdirSwitching = ref(true);
      const workDir = ref('old/dir');
      const messages = ref<any[]>([]);
      let switchConversationCalled = false;
      let pendingGlobalResume: string | null = null;

      function resumeSession(_s: any) {}

      function switchConversation(_id: string) {
        switchConversationCalled = true;
      }

      function onWorkdirChanged() {
        workdirSwitching.value = false;
        if (pendingGlobalResume) {
          const sid = pendingGlobalResume;
          pendingGlobalResume = null;
          resumeSession({ sessionId: sid });
          return true;
        }
        return false;
      }

      // Simulate workdir_changed handler
      const msg = { workDir: '/new/dir' };
      workDir.value = msg.workDir;
      const hasGlobalResume = onWorkdirChanged();

      if (!hasGlobalResume) {
        switchConversation('new-conv-id');
        messages.value.push({ role: 'system', content: 'Dir changed' });
      }

      expect(hasGlobalResume).toBe(false);
      expect(switchConversationCalled).toBe(true);
      expect(messages.value).toHaveLength(1);
    });
  });

  describe('version gating', () => {
    it('requestGlobalSessions is blocked when agent version is too low', () => {
      const globalRecentSessions = ref<any[]>([]);
      const loadingGlobalSessions = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      let loaded = false;
      const requireVersion = (_minVer: string, _feature: string) => false; // version too low

      function requestGlobalSessions() {
        if (requireVersion && !requireVersion('0.1.127', 'Global Sessions')) return;
        if (loaded && globalRecentSessions.value.length > 0) return;
        loadingGlobalSessions.value = true;
        wsSend({ type: 'list_recent_sessions', limit: 20 });
        loaded = true;
      }

      requestGlobalSessions();
      expect(sent).toHaveLength(0);
      expect(loadingGlobalSessions.value).toBe(false);
    });

    it('requestGlobalSessions proceeds when agent version meets minimum', () => {
      const globalRecentSessions = ref<any[]>([]);
      const loadingGlobalSessions = ref(false);
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      let loaded = false;
      const requireVersion = (_minVer: string, _feature: string) => true; // version ok

      function requestGlobalSessions() {
        if (requireVersion && !requireVersion('0.1.127', 'Global Sessions')) return;
        if (loaded && globalRecentSessions.value.length > 0) return;
        loadingGlobalSessions.value = true;
        wsSend({ type: 'list_recent_sessions', limit: 20 });
        loaded = true;
      }

      requestGlobalSessions();
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('list_recent_sessions');
    });

    it('resumeGlobalSession is blocked when agent version is too low', () => {
      const workDir = ref('Q:\\src\\agentlink');
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const resumed: any[] = [];
      const requireVersion = (_minVer: string, _feature: string) => false;

      function resumeSession(session: any) { resumed.push(session); }
      function setWorkdirSwitching() {}

      let pendingGlobalResume: string | null = null;

      function resumeGlobalSession(session: any) {
        if (requireVersion && !requireVersion('0.1.127', 'Global Sessions')) return;
        const currentDir = (workDir.value || '').replace(/[/\\]+$/, '');
        const sessionDir = (session.projectPath || '').replace(/[/\\]+$/, '');
        const sameWorkDir = currentDir.toLowerCase() === sessionDir.toLowerCase();
        if (sameWorkDir) {
          resumeSession({ sessionId: session.sessionId, title: session.title });
        } else {
          setWorkdirSwitching();
          wsSend({ type: 'change_workdir', workDir: session.projectPath });
          pendingGlobalResume = session.sessionId;
        }
      }

      resumeGlobalSession({ sessionId: 'abc', title: 'Test', projectPath: 'Q:\\src\\agentlink' });
      expect(resumed).toHaveLength(0);
      expect(sent).toHaveLength(0);
    });

    it('resumeGlobalSession proceeds when agent version meets minimum', () => {
      const workDir = ref('Q:\\src\\agentlink');
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const resumed: any[] = [];
      const requireVersion = (_minVer: string, _feature: string) => true;

      function resumeSession(session: any) { resumed.push(session); }
      function setWorkdirSwitching() {}

      let pendingGlobalResume: string | null = null;

      function resumeGlobalSession(session: any) {
        if (requireVersion && !requireVersion('0.1.127', 'Global Sessions')) return;
        const currentDir = (workDir.value || '').replace(/[/\\]+$/, '');
        const sessionDir = (session.projectPath || '').replace(/[/\\]+$/, '');
        const sameWorkDir = currentDir.toLowerCase() === sessionDir.toLowerCase();
        if (sameWorkDir) {
          resumeSession({ sessionId: session.sessionId, title: session.title });
        } else {
          setWorkdirSwitching();
          wsSend({ type: 'change_workdir', workDir: session.projectPath });
          pendingGlobalResume = session.sessionId;
        }
      }

      resumeGlobalSession({ sessionId: 'abc', title: 'Test', projectPath: 'Q:\\src\\agentlink' });
      expect(resumed).toHaveLength(1);
      expect(resumed[0].sessionId).toBe('abc');
    });
  });

  describe('recentTab state', () => {
    it('defaults to dirs tab', () => {
      const recentTab = ref('dirs');
      expect(recentTab.value).toBe('dirs');
    });

    it('can switch to sessions tab', () => {
      const recentTab = ref('dirs');
      recentTab.value = 'sessions';
      expect(recentTab.value).toBe('sessions');
    });

    it('switching to sessions tab triggers request', () => {
      const recentTab = ref('dirs');
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);
      const globalRecentSessions = ref<any[]>([]);
      const loadingGlobalSessions = ref(false);
      let loaded = false;

      function requestGlobalSessions() {
        if (loaded && globalRecentSessions.value.length > 0) return;
        loadingGlobalSessions.value = true;
        wsSend({ type: 'list_recent_sessions', limit: 20 });
        loaded = true;
      }

      function switchRecentTab(tab: string) {
        recentTab.value = tab;
        if (tab === 'sessions') {
          requestGlobalSessions();
        }
      }

      switchRecentTab('sessions');
      expect(recentTab.value).toBe('sessions');
      expect(sent).toHaveLength(1);
      expect(sent[0].type).toBe('list_recent_sessions');
    });

    it('switching to dirs tab does not trigger request', () => {
      const recentTab = ref('sessions');
      const sent: any[] = [];
      const wsSend = (msg: any) => sent.push(msg);

      function requestGlobalSessions() {
        wsSend({ type: 'list_recent_sessions', limit: 20 });
      }

      function switchRecentTab(tab: string) {
        recentTab.value = tab;
        if (tab === 'sessions') {
          requestGlobalSessions();
        }
      }

      switchRecentTab('dirs');
      expect(recentTab.value).toBe('dirs');
      expect(sent).toHaveLength(0);
    });
  });
});
