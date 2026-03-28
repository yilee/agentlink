import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Lightweight mock of Vue's ref/computed/nextTick so we don't need the full vue package
function ref(val: unknown) {
  return { value: val };
}
function computed(fn: () => unknown) {
  return { get value() { return fn(); } };
}
function nextTick(fn?: () => void) {
  if (fn) fn();
  return Promise.resolve();
}
vi.mock('vue', () => ({ ref, computed, nextTick }));

// Mock useConfirmDialog
vi.mock('../../server/web/src/composables/useConfirmDialog.js', () => ({
  useConfirmDialog: () => ({ showConfirm: vi.fn() }),
}));

// Mock localStorage if running outside browser
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
}

// Mock document.body and addEventListener/removeEventListener
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    body: { style: {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

import { createProject, buildProjectContext } from '../../server/web/src/modules/project.js';

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    wsSend: vi.fn(),
    currentView: ref('project-feed'),
    switchConversation: vi.fn(),
    conversationCache: ref({}),
    messages: ref([]),
    currentConversationId: ref('main'),
    currentClaudeSessionId: ref(null),
    needsResume: ref(false),
    loadingHistory: ref(false),
    setBrainMode: vi.fn(),
    scrollToBottom: vi.fn(),
    historySessions: ref([]),
    loadingSessions: ref(false),
    ...overrides,
  };
}

describe('createProject', () => {
  let deps: ReturnType<typeof makeDeps>;
  let project: ReturnType<typeof createProject>;

  beforeEach(() => {
    vi.useFakeTimers();
    deps = makeDeps();
    project = createProject(deps as any);
  });

  afterEach(() => {
    project.stopAutoRefresh();
    vi.useRealTimers();
  });

  describe('loadFeed', () => {
    it('sets loading and sends list_projects message', () => {
      project.loadFeed();
      expect(project.loading.value).toBe(true);
      expect(deps.wsSend).toHaveBeenCalledWith({ type: 'list_projects' });
    });
  });

  describe('handleProjectsList', () => {
    it('populates feedEntries and clears loading', () => {
      project.loading.value = true;
      const entries = [
        { name: 'proj-a', title: 'Project A', description: 'Desc A', workstreamCount: 2, blockerCount: 1, pendingDecisionCount: 0, staleItemCount: 0 },
        { name: 'proj-b', title: 'Project B', description: 'Desc B', workstreamCount: 4, blockerCount: 0, pendingDecisionCount: 3, staleItemCount: 1 },
      ];
      project.handleProjectsList({ projects: entries });
      expect(project.projects.value).toEqual(entries);
      expect(project.loading.value).toBe(false);
    });

    it('handles missing projects key gracefully', () => {
      project.handleProjectsList({});
      expect(project.projects.value).toEqual([]);
      expect(project.loading.value).toBe(false);
    });
  });

  describe('selectProject', () => {
    it('sets selectedProject name, sends get_project_detail, and switches to detail view', () => {
      project.selectProject('proj-a');
      expect(project.selectedProjectName.value).toBe('proj-a');
      expect(project.detailLoading.value).toBe(true);
      expect(deps.currentView.value).toBe('project-detail');
      expect(deps.wsSend).toHaveBeenCalledWith({ type: 'get_project_detail', projectName: 'proj-a' });
    });
  });

  describe('handleProjectDetail', () => {
    it('sets detail content when project name matches', () => {
      project.selectProject('proj-a');
      const detail = {
        name: 'proj-a',
        overview: '# Overview',
        team: '## Team',
        timeline: '',
        decisions: '',
        codePaths: '',
        missingInfo: '',
        gapAnalysis: '',
        schema: '',
        workstreams: [{ name: 'ws1', filename: 'ws1.md', content: '# WS1' }],
        blockers: '',
        pendingDecisions: '',
        staleItems: '',
      };
      project.handleProjectDetail(detail);
      expect(project.selectedDetail.value).toEqual(detail);
      expect(project.detailLoading.value).toBe(false);
    });

    it('ignores detail when project name does not match', () => {
      project.selectProject('proj-a');
      project.handleProjectDetail({ name: 'proj-b', overview: '# Wrong' });
      expect(project.selectedDetail.value).toBeNull();
    });
  });

  describe('goBackToFeed', () => {
    it('clears detail state and switches to feed view', () => {
      project.selectProject('proj-a');
      project.handleProjectDetail({ name: 'proj-a', overview: '# Content' });
      project.goBackToFeed();
      expect(project.selectedProjectName.value).toBeNull();
      expect(project.selectedDetail.value).toBeNull();
      expect(project.detailLoading.value).toBe(false);
      expect(deps.currentView.value).toBe('project-feed');
    });
  });

  describe('auto-refresh', () => {
    it('starts and stops interval timer', () => {
      project.startAutoRefresh();
      expect(deps.wsSend).not.toHaveBeenCalled();

      // Advance past the 5-minute interval
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(deps.wsSend).toHaveBeenCalledWith({ type: 'list_projects' });

      project.stopAutoRefresh();
      deps.wsSend.mockClear();
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(deps.wsSend).not.toHaveBeenCalled();
    });

    it('restarts timer on repeated startAutoRefresh calls', () => {
      project.startAutoRefresh();
      project.startAutoRefresh(); // should clear old timer
      vi.advanceTimersByTime(5 * 60 * 1000);
      // Should only fire once (not twice from two timers)
      expect(deps.wsSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('section collapse', () => {
    it('toggles section collapse state', () => {
      expect(project.isSectionCollapsed('overview')).toBe(false);
      project.toggleSection('overview');
      expect(project.isSectionCollapsed('overview')).toBe(true);
      project.toggleSection('overview');
      expect(project.isSectionCollapsed('overview')).toBe(false);
    });
  });

  describe('projectChatSessions', () => {
    it('returns all sessions that have projectName', () => {
      deps.historySessions.value = [
        { id: '1', title: 'Chat 1', projectName: 'proj-a', lastModified: '2026-03-28' },
        { id: '2', title: 'Chat 2', projectName: 'proj-b', lastModified: '2026-03-27' },
        { id: '3', title: 'Chat 3', lastModified: '2026-03-26' },
        { id: '4', title: 'Chat 4', projectName: 'proj-a', lastModified: '2026-03-25' },
      ];
      const sessions = project.projectChatSessions.value;
      expect(sessions).toHaveLength(3);
      expect(sessions.every((s: any) => s.projectName)).toBe(true);
    });

    it('returns empty when no sessions have projectName', () => {
      deps.historySessions.value = [
        { id: '1', title: 'Chat 1', lastModified: '2026-03-28' },
        { id: '2', title: 'Chat 2', lastModified: '2026-03-27' },
      ];
      expect(project.projectChatSessions.value).toEqual([]);
    });
  });
});

describe('buildProjectContext', () => {
  it('wraps content with context header and project name', () => {
    const result = buildProjectContext('my-project', '# Overview\n\nProject details here.');
    expect(result).toContain('[Project Context');
    expect(result).toContain('my-project');
    expect(result).toContain('# Overview');
    expect(result).toMatch(/<\/brain-context>\n$/);
  });

  it('includes source file paths for project', () => {
    const result = buildProjectContext('ads-relevance', '# Content');
    expect(result).toContain('Source Files');
    expect(result).toContain('projects/ads-relevance/project/');
    expect(result).toContain('projects/ads-relevance/project/overview.md');
    expect(result).toContain('projects/ads-relevance/project/workstreams/');
  });

  it('returns empty string for falsy content', () => {
    expect(buildProjectContext('proj', '')).toBe('');
    expect(buildProjectContext('proj', null)).toBe('');
    expect(buildProjectContext('proj', undefined)).toBe('');
  });

  it('preserves full content in context', () => {
    const content = '# Overview\n\n## Team\n- Alice\n- Bob\n\n## Timeline\n| Phase | Date |\n|---|---|\n| Alpha | Apr 1 |';
    const result = buildProjectContext('test-proj', content);
    expect(result).toContain('## Team');
    expect(result).toContain('Alice');
    expect(result).toContain('## Timeline');
  });
});
