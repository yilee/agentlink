import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { brainSearch, getSearchIndexStats, clearSearchCache } from '../../agent/src/search.js';

const tempDir = join(tmpdir(), `agentlink-test-search-${process.pid}`);
const indexDir = join(tempDir, '.search_index');

function writeIndex(source: string, data: object) {
  writeFileSync(join(indexDir, `${source}.json`), JSON.stringify(data));
}

beforeEach(() => {
  mkdirSync(indexDir, { recursive: true });
  clearSearchCache();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  clearSearchCache();
});

describe('brainSearch', () => {
  it('returns empty results for empty query', async () => {
    const result = await brainSearch(tempDir, '');
    expect(result).toEqual({ query: '', groups: [], totalResults: 0 });
  });

  it('returns empty results for whitespace query', async () => {
    const result = await brainSearch(tempDir, '   ');
    expect(result).toEqual({ query: '   ', groups: [], totalResults: 0 });
  });

  it('returns empty results when no index files exist', async () => {
    const result = await brainSearch(tempDir, 'test');
    expect(result.groups).toEqual([]);
    expect(result.totalResults).toBe(0);
  });

  it('searches teams by sender field', async () => {
    writeIndex('teams', {
      source: 'teams',
      generated: '2026-03-28',
      count: 2,
      entries: [
        { id: 't1', sender: 'Alice', chat: 'General', body_preview: 'Hello world', timestamp: '2026-03-28T10:00:00Z' },
        { id: 't2', sender: 'Bob', chat: 'Dev', body_preview: 'Goodbye', timestamp: '2026-03-27T10:00:00Z' },
      ],
    });
    const result = await brainSearch(tempDir, 'Alice');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].source).toBe('teams');
    expect(result.groups[0].entries).toHaveLength(1);
    expect(result.groups[0].entries[0].title).toBe('Alice');
  });

  it('searches emails by subject field', async () => {
    writeIndex('emails', {
      source: 'emails',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 'e1', sender: 'Charlie', subject: 'Sprint Review', body_preview: 'Agenda attached', timestamp: '2026-03-28T09:00:00Z', folder: 'Inbox', importance: 'normal' },
      ],
    });
    const result = await brainSearch(tempDir, 'Sprint');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].source).toBe('emails');
    expect(result.groups[0].entries[0].subtitle).toBe('Sprint Review');
  });

  it('performs case-insensitive matching', async () => {
    writeIndex('meetings', {
      source: 'meetings',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 'm1', meeting_name: 'Design Review', body_preview: 'UI discussion', timestamp: '2026-03-28T14:00:00Z' },
      ],
    });
    const result = await brainSearch(tempDir, 'design review');
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].entries[0].title).toBe('Design Review');
  });

  it('searches across multiple sources', async () => {
    writeIndex('teams', {
      source: 'teams',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 't1', sender: 'Alice', chat: 'Project X', body_preview: 'project update', timestamp: '2026-03-28T10:00:00Z' },
      ],
    });
    writeIndex('work_items', {
      source: 'work_items',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 'w1', title: 'Project X task', project: 'Project X' },
      ],
    });
    const result = await brainSearch(tempDir, 'Project X');
    expect(result.groups).toHaveLength(2);
    expect(result.totalResults).toBe(2);
  });

  it('filters by specified sources', async () => {
    writeIndex('teams', {
      source: 'teams',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 't1', sender: 'Alice', chat: 'General', body_preview: 'hello', timestamp: '2026-03-28T10:00:00Z' },
      ],
    });
    writeIndex('emails', {
      source: 'emails',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 'e1', sender: 'Bob', subject: 'hello', body_preview: 'hello there', timestamp: '2026-03-28T09:00:00Z' },
      ],
    });
    const result = await brainSearch(tempDir, 'hello', ['teams']);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].source).toBe('teams');
  });

  it('respects limit per source', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      sender: 'Alice',
      chat: 'General',
      body_preview: `Message ${i}`,
      timestamp: `2026-03-${String(20 + i).padStart(2, '0')}T10:00:00Z`,
    }));
    writeIndex('teams', {
      source: 'teams',
      generated: '2026-03-28',
      count: 10,
      entries,
    });
    const result = await brainSearch(tempDir, 'Alice', undefined, 3);
    expect(result.groups[0].entries).toHaveLength(3);
    expect(result.groups[0].count).toBe(10); // count reflects all matches
    expect(result.totalResults).toBe(10);
  });

  it('sorts results by timestamp descending', async () => {
    writeIndex('teams', {
      source: 'teams',
      generated: '2026-03-28',
      count: 3,
      entries: [
        { id: 't1', sender: 'Alice', chat: 'A', body_preview: 'msg', timestamp: '2026-03-26T10:00:00Z' },
        { id: 't2', sender: 'Alice', chat: 'B', body_preview: 'msg', timestamp: '2026-03-28T10:00:00Z' },
        { id: 't3', sender: 'Alice', chat: 'C', body_preview: 'msg', timestamp: '2026-03-27T10:00:00Z' },
      ],
    });
    const result = await brainSearch(tempDir, 'Alice');
    const timestamps = result.groups[0].entries.map(e => e.timestamp);
    expect(timestamps).toEqual([
      '2026-03-28T10:00:00Z',
      '2026-03-27T10:00:00Z',
      '2026-03-26T10:00:00Z',
    ]);
  });

  it('maps pull_requests correctly', async () => {
    writeIndex('pull_requests', {
      source: 'pull_requests',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 'pr1', title: 'Add search feature', pr_number: '42', project: 'AgentLink', repository: 'agentlink', url: 'https://dev.azure.com/pr/42', total_mentions: 3 },
      ],
    });
    const result = await brainSearch(tempDir, 'search');
    const entry = result.groups[0].entries[0];
    expect(entry.title).toBe('Add search feature');
    expect(entry.subtitle).toBe('AgentLink / agentlink');
    expect(entry.url).toBe('https://dev.azure.com/pr/42');
  });

  it('maps documents correctly', async () => {
    writeIndex('documents', {
      source: 'documents',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 'd1', title: 'Architecture Guide', url: 'https://docs.example.com/arch', total_mentions: 5 },
      ],
    });
    const result = await brainSearch(tempDir, 'Architecture');
    const entry = result.groups[0].entries[0];
    expect(entry.title).toBe('Architecture Guide');
    expect(entry.url).toBe('https://docs.example.com/arch');
  });

  it('skips malformed index files', async () => {
    writeFileSync(join(indexDir, 'teams.json'), 'not valid json');
    const result = await brainSearch(tempDir, 'test');
    expect(result.groups).toEqual([]);
  });

  it('skips index files with empty entries', async () => {
    writeIndex('teams', {
      source: 'teams',
      generated: '2026-03-28',
      count: 0,
      entries: [],
    });
    const result = await brainSearch(tempDir, 'test');
    expect(result.groups).toEqual([]);
  });

  it('uses cache for repeated searches', async () => {
    writeIndex('teams', {
      source: 'teams',
      generated: '2026-03-28',
      count: 1,
      entries: [
        { id: 't1', sender: 'Alice', chat: 'General', body_preview: 'hello', timestamp: '2026-03-28T10:00:00Z' },
      ],
    });
    // First call loads from disk
    const r1 = await brainSearch(tempDir, 'Alice');
    expect(r1.totalResults).toBe(1);

    // Delete the file — cached data should still be used
    rmSync(join(indexDir, 'teams.json'));
    const r2 = await brainSearch(tempDir, 'Alice');
    expect(r2.totalResults).toBe(1);
  });
});

describe('getSearchIndexStats', () => {
  it('returns empty sources when no indexes exist', async () => {
    const stats = await getSearchIndexStats(tempDir);
    expect(stats.sources).toEqual([]);
  });

  it('returns stats for available indexes', async () => {
    writeIndex('teams', {
      source: 'teams',
      generated: '2026-03-28T10:00:00Z',
      count: 150,
      entries: [{ id: 't1' }],
    });
    writeIndex('emails', {
      source: 'emails',
      generated: '2026-03-27T08:00:00Z',
      count: 200,
      entries: [{ id: 'e1' }],
    });
    const stats = await getSearchIndexStats(tempDir);
    expect(stats.sources).toHaveLength(2);
    const teamsStats = stats.sources.find(s => s.name === 'teams');
    expect(teamsStats).toBeDefined();
    expect(teamsStats!.count).toBe(150);
    expect(teamsStats!.generated).toBe('2026-03-28T10:00:00Z');
  });

  it('falls back to entries.length when count is missing', async () => {
    writeIndex('meetings', {
      source: 'meetings',
      generated: '2026-03-28',
      entries: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }],
    });
    const stats = await getSearchIndexStats(tempDir);
    const meetingStats = stats.sources.find(s => s.name === 'meetings');
    expect(meetingStats!.count).toBe(3);
  });
});
