import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listBriefings, getBriefingDetail } from '../../agent/src/briefing.js';

const tempDir = join(tmpdir(), `agentlink-test-briefing-${process.pid}`);

beforeEach(() => {
  mkdirSync(join(tempDir, 'reports', 'daily'), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const SAMPLE_BRIEFING = `# Daily Briefing — 2026-03-27 Thursday

## TL;DR

3 action items need attention today. Sprint review prep is the top priority.

---

## 🎯 Action Required

**🔴 Today**

1. Prepare sprint review demo slides
2. Review Alice's PR on auth module
3. Reply to security audit findings

**🟡 This Week**

1. Complete API documentation
2. Schedule design review with UX team

**⚪ FYI / Low Priority**

- **New team onboarding**: Two new engineers joining next week
- **Office closure**: Building maintenance on Friday afternoon

---

## Meetings
Some meeting content here.
`;

describe('listBriefings', () => {
  it('returns empty array when directory does not exist', async () => {
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    const result = await listBriefings(tempDir);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty directory', async () => {
    const result = await listBriefings(tempDir);
    expect(result).toEqual([]);
  });

  it('parses a valid briefing markdown file', async () => {
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-27.md'), SAMPLE_BRIEFING);
    const result = await listBriefings(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-03-27');
    expect(result[0].title).toBe('Daily Briefing — 2026-03-27 Thursday');
    expect(result[0].tldr).toContain('3 action items');
    expect(result[0].action_today).toBe(3);
    expect(result[0].action_week).toBe(2);
    expect(result[0].fyi_count).toBe(2);
    expect(result[0].file_size).toBeGreaterThan(0);
  });

  it('skips non-date files in the directory', async () => {
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-27.md'), SAMPLE_BRIEFING);
    writeFileSync(join(tempDir, 'reports', 'daily', 'README.md'), '# Not a briefing');
    writeFileSync(join(tempDir, 'reports', 'daily', 'meeting-recap-2026-03-27.md'), '# Wrong format');
    const result = await listBriefings(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].date).toBe('2026-03-27');
  });

  it('sorts entries by date descending', async () => {
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-25.md'), '# Daily Briefing — 2026-03-25\n## TL;DR\nOld.\n---');
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-27.md'), '# Daily Briefing — 2026-03-27\n## TL;DR\nNew.\n---');
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-26.md'), '# Daily Briefing — 2026-03-26\n## TL;DR\nMid.\n---');
    const result = await listBriefings(tempDir);
    expect(result).toHaveLength(3);
    expect(result[0].date).toBe('2026-03-27');
    expect(result[1].date).toBe('2026-03-26');
    expect(result[2].date).toBe('2026-03-25');
  });

  it('handles file with no TL;DR section', async () => {
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-27.md'), '# Daily Briefing — 2026-03-27\n\nSome content.');
    const result = await listBriefings(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].tldr).toBe('');
  });

  it('handles file with no action sections', async () => {
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-27.md'), '# Daily Briefing — 2026-03-27\n## TL;DR\nNothing to do.\n---');
    const result = await listBriefings(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0].action_today).toBe(0);
    expect(result[0].action_week).toBe(0);
    expect(result[0].fyi_count).toBe(0);
  });

  it('truncates long TL;DR to 300 chars', async () => {
    const longTldr = 'A'.repeat(400);
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-27.md'), `# Daily Briefing\n## TL;DR\n${longTldr}\n---`);
    const result = await listBriefings(tempDir);
    expect(result[0].tldr.length).toBe(300);
    expect(result[0].tldr.endsWith('...')).toBe(true);
  });

  it('uses default title when no H1 found', async () => {
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-27.md'), 'No heading here.\n## TL;DR\nStuff.\n---');
    const result = await listBriefings(tempDir);
    expect(result[0].title).toBe('Daily Briefing');
  });
});

describe('getBriefingDetail', () => {
  it('reads full content of a briefing file', async () => {
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-03-27.md'), SAMPLE_BRIEFING);
    const result = await getBriefingDetail(tempDir, '2026-03-27');
    expect(result.date).toBe('2026-03-27');
    expect(result.content).toBe(SAMPLE_BRIEFING);
  });

  it('throws for non-existent date', async () => {
    await expect(getBriefingDetail(tempDir, '2099-01-01')).rejects.toThrow();
  });

  it('rejects invalid date format (path traversal prevention)', async () => {
    await expect(getBriefingDetail(tempDir, '../../../etc/passwd')).rejects.toThrow('Invalid date format');
    await expect(getBriefingDetail(tempDir, '2026-03-27/../../..')).rejects.toThrow('Invalid date format');
    await expect(getBriefingDetail(tempDir, 'not-a-date')).rejects.toThrow('Invalid date format');
  });

  it('accepts valid date format', async () => {
    writeFileSync(join(tempDir, 'reports', 'daily', '2026-01-01.md'), '# New Year Briefing');
    const result = await getBriefingDetail(tempDir, '2026-01-01');
    expect(result.content).toBe('# New Year Briefing');
  });
});
