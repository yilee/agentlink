import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listProjects, getProjectDetail, countNumberedSections } from '../../agent/src/project.js';

const tempDir = join(tmpdir(), `agentlink-test-project-${process.pid}`);

beforeEach(() => {
  mkdirSync(join(tempDir, 'projects'), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function createProject(name: string, opts: {
  readme?: string;
  overview?: string;
  team?: string;
  timeline?: string;
  decisions?: string;
  blockers?: string;
  pendingDecisions?: string;
  staleItems?: string;
  workstreams?: Record<string, string>;
  digest?: string;
} = {}) {
  const base = join(tempDir, 'projects', name);
  const projectDir = join(base, 'project');
  mkdirSync(join(projectDir, 'workstreams'), { recursive: true });
  mkdirSync(join(projectDir, 'cross_cutting'), { recursive: true });

  if (opts.readme) writeFileSync(join(base, 'README.md'), opts.readme);
  if (opts.digest) writeFileSync(join(base, '.memory_digest.yaml'), opts.digest);
  if (opts.overview) writeFileSync(join(projectDir, 'overview.md'), opts.overview);
  if (opts.team) writeFileSync(join(projectDir, 'team.md'), opts.team);
  if (opts.timeline) writeFileSync(join(projectDir, 'timeline.md'), opts.timeline);
  if (opts.decisions) writeFileSync(join(projectDir, 'decisions.md'), opts.decisions);
  if (opts.blockers) writeFileSync(join(projectDir, 'cross_cutting', 'blockers.md'), opts.blockers);
  if (opts.pendingDecisions) writeFileSync(join(projectDir, 'cross_cutting', 'pending_decisions.md'), opts.pendingDecisions);
  if (opts.staleItems) writeFileSync(join(projectDir, 'cross_cutting', 'stale_items.md'), opts.staleItems);
  if (opts.workstreams) {
    for (const [wsName, content] of Object.entries(opts.workstreams)) {
      writeFileSync(join(projectDir, 'workstreams', wsName), content);
    }
  }
}

describe('countNumberedSections', () => {
  it('counts ## N. sections', () => {
    expect(countNumberedSections('## 1. First\n## 2. Second\n## 3. Third')).toBe(3);
  });

  it('returns 0 for null/empty', () => {
    expect(countNumberedSections(null)).toBe(0);
    expect(countNumberedSections('')).toBe(0);
  });

  it('ignores non-matching headings', () => {
    expect(countNumberedSections('# Title\n## Overview\nSome text')).toBe(0);
  });
});

describe('listProjects', () => {
  it('returns empty array when no projects exist', async () => {
    const result = await listProjects(tempDir);
    expect(result).toEqual([]);
  });

  it('lists a project with basic info', async () => {
    createProject('test-project', {
      readme: '# Test Project\n\nA short description of the test project.',
      workstreams: { 'task_one.md': '# Task One\nContent' },
    });

    const result = await listProjects(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test-project');
    expect(result[0].title).toBe('Test Project');
    expect(result[0].description).toContain('short description');
    expect(result[0].workstreamCount).toBe(1);
    expect(result[0].blockerCount).toBe(0);
  });

  it('counts cross-cutting items correctly', async () => {
    createProject('counted', {
      readme: '# Counted\n\nDesc.',
      blockers: '# Active Blockers\n## 1. Blocker A\n## 2. Blocker B',
      pendingDecisions: '# Pending\n## 1. Decision X',
      staleItems: '# Stale\n## 1. Stale A\n## 2. Stale B\n## 3. Stale C',
    });

    const result = await listProjects(tempDir);
    expect(result[0].blockerCount).toBe(2);
    expect(result[0].pendingDecisionCount).toBe(1);
    expect(result[0].staleItemCount).toBe(3);
  });

  it('sorts by lastModified descending', async () => {
    createProject('older', {
      readme: '# Older\n\nOld project.',
      digest: 'generated: 2026-03-01T10:00:00Z',
    });
    createProject('newer', {
      readme: '# Newer\n\nNew project.',
      digest: 'generated: 2026-03-25T10:00:00Z',
    });

    const result = await listProjects(tempDir);
    expect(result[0].name).toBe('newer');
    expect(result[1].name).toBe('older');
  });

  it('falls back to directory name when no README', async () => {
    createProject('no-readme', {});
    const result = await listProjects(tempDir);
    expect(result[0].title).toBe('no-readme');
    expect(result[0].description).toBe('');
  });

  it('excludes workstreams README.md from count', async () => {
    createProject('ws-test', {
      readme: '# WS Test\n\nDesc.',
      workstreams: {
        'README.md': '# Workstreams index',
        'actual_work.md': '# Actual workstream',
      },
    });

    const result = await listProjects(tempDir);
    expect(result[0].workstreamCount).toBe(1);
  });
});

describe('getProjectDetail', () => {
  it('returns all project files', async () => {
    createProject('full-project', {
      readme: '# Full Project\n\nComplete project.',
      overview: '# Overview\nMission statement.',
      team: '# Team\n- Alice\n- Bob',
      timeline: '# Timeline\n- 2026-03-01: Start',
      decisions: '# Decisions\n## 1. Use TypeScript',
      blockers: '# Blockers\n## 1. API latency',
      pendingDecisions: '# Pending\n## 1. Auth method',
      staleItems: '# Stale\nNone',
      workstreams: {
        'migration.md': '# Migration\nStatus: IN PROGRESS',
        'testing.md': '# Testing\nStatus: COMPLETED',
      },
    });

    const detail = await getProjectDetail(tempDir, 'full-project');
    expect(detail.name).toBe('full-project');
    expect(detail.overview).toContain('Mission statement');
    expect(detail.team).toContain('Alice');
    expect(detail.timeline).toContain('2026-03-01');
    expect(detail.decisions).toContain('Use TypeScript');
    expect(detail.blockers).toContain('API latency');
    expect(detail.pendingDecisions).toContain('Auth method');
    expect(detail.workstreams).toHaveLength(2);
    expect(detail.workstreams[0].content).toContain('Status:');
  });

  it('returns empty strings for missing files', async () => {
    createProject('minimal', {});
    const detail = await getProjectDetail(tempDir, 'minimal');
    expect(detail.overview).toBe('');
    expect(detail.team).toBe('');
    expect(detail.workstreams).toHaveLength(0);
  });

  it('rejects path traversal', async () => {
    await expect(getProjectDetail(tempDir, '../etc')).rejects.toThrow('Invalid project name');
    await expect(getProjectDetail(tempDir, 'foo/bar')).rejects.toThrow('Invalid project name');
  });

  it('humanizes workstream names from filenames', async () => {
    createProject('ws-names', {
      workstreams: { 'plugin_campaign_migration.md': '# Content' },
    });

    const detail = await getProjectDetail(tempDir, 'ws-names');
    expect(detail.workstreams[0].name).toBe('plugin campaign migration');
    expect(detail.workstreams[0].filename).toBe('plugin_campaign_migration.md');
  });
});
