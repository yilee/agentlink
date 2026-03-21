import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listRecaps, getRecapDetail } from '../../agent/src/recap.js';

const tempDir = join(tmpdir(), `agentlink-test-recap-${process.pid}`);

beforeEach(() => {
  mkdirSync(join(tempDir, 'reports', 'meeting-recap'), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('listRecaps', () => {
  it('returns empty array when index file does not exist', async () => {
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    const result = await listRecaps(tempDir);
    expect(result).toEqual([]);
  });

  it('parses valid YAML index file', async () => {
    const yaml = `recaps:
  - recap_id: r1
    meeting_id: m1
    meeting_name: standup
    series_name: daily
    date_utc: "2026-03-22T17:00:00Z"
    date_local: "2026-03-22T10:00:00"
    meeting_type: standup
    project: null
    for_you_count: 2
    tldr_snippet: "Quick sync"
    sidecar_path: reports/meeting-recap/r1.json
    recap_path: reports/meeting-recap/r1.md
    sharing_link: null
`;
    writeFileSync(join(tempDir, 'reports', 'meeting-recap', 'recap_index.yaml'), yaml);
    const result = await listRecaps(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].recap_id).toBe('r1');
    expect(result[0].meeting_name).toBe('standup');
    expect(result[0].for_you_count).toBe(2);
  });

  it('returns empty array for YAML with no recaps key', async () => {
    writeFileSync(
      join(tempDir, 'reports', 'meeting-recap', 'recap_index.yaml'),
      'other_key: true\n',
    );
    const result = await listRecaps(tempDir);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty YAML file', async () => {
    writeFileSync(
      join(tempDir, 'reports', 'meeting-recap', 'recap_index.yaml'),
      '',
    );
    const result = await listRecaps(tempDir);
    expect(result).toEqual([]);
  });

  it('handles multiple entries', async () => {
    const yaml = `recaps:
  - recap_id: r1
    meeting_name: "Meeting A"
    meeting_type: standup
    date_local: "2026-03-22T10:00:00"
  - recap_id: r2
    meeting_name: "Meeting B"
    meeting_type: brainstorm
    date_local: "2026-03-21T14:00:00"
`;
    writeFileSync(join(tempDir, 'reports', 'meeting-recap', 'recap_index.yaml'), yaml);
    const result = await listRecaps(tempDir);
    expect(result).toHaveLength(2);
    expect(result[0].recap_id).toBe('r1');
    expect(result[1].recap_id).toBe('r2');
  });
});

describe('getRecapDetail', () => {
  it('reads and parses sidecar JSON', async () => {
    const sidecar = {
      schema_version: '1.0',
      meta: { meeting_name: 'Test Meeting', duration: '30 min' },
      feed: { type_badge: 'Standup' },
      detail: {
        tldr: 'Quick sync on status.',
        for_you: [{ text: 'Action needed', reason: 'You own this', kind: 'action_item' }],
        hook_sections: [
          {
            section_type: 'action_items',
            title: 'Action Items',
            items: [{ text: 'Fix the bug', owner: 'Alice' }],
            omitted_count: 0,
          },
        ],
        decisions_count: 1,
        action_items_count: 1,
        open_items_count: 0,
      },
      decisions: [{ text: 'Use new API', championed_by: ['Bob'] }],
      action_items: [{ text: 'Fix the bug', owner: 'Alice', due: '2026-03-25' }],
      open_items: [],
    };
    const sidecarPath = 'reports/meeting-recap/r1.json';
    mkdirSync(join(tempDir, 'reports', 'meeting-recap'), { recursive: true });
    writeFileSync(join(tempDir, sidecarPath), JSON.stringify(sidecar));

    const result = await getRecapDetail(tempDir, sidecarPath);
    expect(result.schema_version).toBe('1.0');
    expect(result.meta.meeting_name).toBe('Test Meeting');
    expect(result.detail.tldr).toBe('Quick sync on status.');
    expect(result.detail.for_you).toHaveLength(1);
    expect(result.detail.hook_sections).toHaveLength(1);
    expect(result.decisions).toHaveLength(1);
  });

  it('throws for non-existent sidecar file', async () => {
    await expect(getRecapDetail(tempDir, 'nonexistent.json')).rejects.toThrow();
  });
});
