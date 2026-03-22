import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDateGroup, getMeetingTypeBadge, getSectionIcon, buildMeetingContext, groupByDate } from '../../server/web/src/modules/recap.js';

describe('getMeetingTypeBadge', () => {
  it('returns correct badge for general_sync', () => {
    expect(getMeetingTypeBadge('general_sync')).toEqual({ label: 'General Sync', color: 'blue' });
  });

  it('returns correct badge for strategy', () => {
    expect(getMeetingTypeBadge('strategy')).toEqual({ label: 'Strategy', color: 'purple' });
  });

  it('returns correct badge for strategy_architecture', () => {
    expect(getMeetingTypeBadge('strategy_architecture')).toEqual({ label: 'Strategy', color: 'purple' });
  });

  it('returns correct badge for standup', () => {
    expect(getMeetingTypeBadge('standup')).toEqual({ label: 'Standup', color: 'green' });
  });

  it('returns correct badge for brainstorm', () => {
    expect(getMeetingTypeBadge('brainstorm')).toEqual({ label: 'Brainstorm', color: 'orange' });
  });

  it('returns correct badge for kickoff', () => {
    expect(getMeetingTypeBadge('kickoff')).toEqual({ label: 'Kickoff', color: 'teal' });
  });

  it('returns correct badge for post_mortem', () => {
    expect(getMeetingTypeBadge('post_mortem')).toEqual({ label: 'Post-Mortem', color: 'red' });
  });

  it('returns gray badge with raw type for unknown meeting types', () => {
    expect(getMeetingTypeBadge('unknown_type')).toEqual({ label: 'unknown_type', color: 'gray' });
  });

  it('returns undefined label in gray for undefined input', () => {
    expect(getMeetingTypeBadge(undefined)).toEqual({ label: undefined, color: 'gray' });
  });
});

describe('getSectionIcon', () => {
  it('returns clipboard for decisions', () => {
    expect(getSectionIcon('decisions')).toBe('\u{1F4CB}');
  });

  it('returns clipboard for action_items', () => {
    expect(getSectionIcon('action_items')).toBe('\u{1F4CB}');
  });

  it('returns red circle for blockers', () => {
    expect(getSectionIcon('blockers')).toBe('\u{1F534}');
  });

  it('returns lightbulb for key_themes', () => {
    expect(getSectionIcon('key_themes')).toBe('\u{1F4A1}');
  });

  it('returns lightbulb for context', () => {
    expect(getSectionIcon('context')).toBe('\u{1F4A1}');
  });

  it('returns target for vision', () => {
    expect(getSectionIcon('vision')).toBe('\u{1F3AF}');
  });

  it('returns magnifying glass for root_cause', () => {
    expect(getSectionIcon('root_cause')).toBe('\u{1F50D}');
  });

  it('returns shield for preventative_actions', () => {
    expect(getSectionIcon('preventative_actions')).toBe('\u{1F6E1}\uFE0F');
  });

  it('returns clipboard as default for unknown section type', () => {
    expect(getSectionIcon('unknown_section')).toBe('\u{1F4CB}');
  });
});

describe('getDateGroup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "now" to Wed Mar 22 2026, 10:00 AM local
    vi.setSystemTime(new Date(2026, 2, 22, 10, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Today" for today\'s date', () => {
    expect(getDateGroup('2026-03-22T09:00:00')).toBe('Today');
  });

  it('returns "Today" for today at midnight', () => {
    expect(getDateGroup('2026-03-22T00:00:00')).toBe('Today');
  });

  it('returns "Yesterday" for yesterday\'s date', () => {
    expect(getDateGroup('2026-03-21T14:30:00')).toBe('Yesterday');
  });

  it('returns "This Week" for earlier this week', () => {
    // March 22, 2026 is a Sunday. Week starts on Monday.
    // Current week = Mon Mar 16 – Sun Mar 22.
    // March 20 (Fri) is same week.
    expect(getDateGroup('2026-03-20T10:00:00')).toBe('This Week');
  });

  it('returns "Last Week" for last week', () => {
    // "now" is Mar 22, current week starts Mon Mar 16.
    // Last week = Mon Mar 9 – Sun Mar 15.
    expect(getDateGroup('2026-03-15T10:00:00')).toBe('Last Week');
  });

  it('returns "Older" for two weeks ago', () => {
    expect(getDateGroup('2026-03-08T10:00:00')).toBe('Older');
  });

  it('returns "Older" for last month', () => {
    expect(getDateGroup('2026-02-15T10:00:00')).toBe('Older');
  });

  it('returns "Older" for dates far in the past', () => {
    expect(getDateGroup('2025-01-01T00:00:00')).toBe('Older');
  });
});

describe('buildMeetingContext', () => {
  it('returns empty string for null/undefined input', () => {
    expect(buildMeetingContext(null)).toBe('');
    expect(buildMeetingContext(undefined)).toBe('');
  });

  it('builds basic context with meta only', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Sprint Planning' },
      detail: {},
    });
    expect(result).toContain('[Meeting Context');
    expect(result).toContain('Meeting: Sprint Planning');
  });

  it('includes all meta fields when present', () => {
    const result = buildMeetingContext({
      meta: {
        meeting_name: 'Design Review',
        occurred_at_local: '2026-03-22T10:00:00',
        duration: '45m',
        meeting_type: 'strategy',
        project: 'AgentLink',
        participants: ['Alice', 'Bob', 'Charlie'],
      },
      detail: {},
    });
    expect(result).toContain('Meeting: Design Review');
    expect(result).toContain('Date: 2026-03-22T10:00:00');
    expect(result).toContain('Duration: 45m');
    expect(result).toContain('Type: strategy');
    expect(result).toContain('Project: AgentLink');
    expect(result).toContain('Participants: Alice, Bob, Charlie');
  });

  it('includes TL;DR section', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Test' },
      detail: { tldr: 'We decided to ship next week.' },
    });
    expect(result).toContain('## TL;DR');
    expect(result).toContain('We decided to ship next week.');
  });

  it('includes for_you section', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Test' },
      detail: {
        for_you: [
          { text: 'Review the PR', reason: 'You are the reviewer' },
          { text: 'Update docs', reason: 'Owner of the docs' },
        ],
      },
    });
    expect(result).toContain('## Key Takeaways for You');
    expect(result).toContain('- Review the PR (You are the reviewer)');
    expect(result).toContain('- Update docs (Owner of the docs)');
  });

  it('includes hook_sections', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Test' },
      detail: {
        hook_sections: [
          {
            title: 'Decisions',
            items: [{ text: 'Use TypeScript' }, { text: 'Deploy to prod Friday' }],
            omitted_count: 0,
          },
          {
            title: 'Action Items',
            items: [{ text: 'Write tests' }],
            omitted_count: 3,
          },
        ],
      },
    });
    expect(result).toContain('## Decisions');
    expect(result).toContain('- Use TypeScript');
    expect(result).toContain('- Deploy to prod Friday');
    expect(result).toContain('## Action Items');
    expect(result).toContain('- Write tests');
    expect(result).toContain('(3 more items omitted)');
  });

  it('omits missing optional sections gracefully', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Minimal' },
      detail: {},
    });
    expect(result).toContain('Meeting: Minimal');
    expect(result).not.toContain('## TL;DR');
    expect(result).not.toContain('## Key Takeaways');
    expect(result).not.toContain('Date:');
    expect(result).not.toContain('Duration:');
  });

  it('handles empty participants array', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Test', participants: [] },
      detail: {},
    });
    expect(result).not.toContain('Participants:');
  });

  it('handles full context with all sections', () => {
    const result = buildMeetingContext({
      meta: {
        meeting_name: 'Full Meeting',
        occurred_at_local: '2026-03-22T14:00:00',
        duration: '1h',
        meeting_type: 'general_sync',
        project: 'MyProject',
        participants: ['Alice', 'Bob'],
      },
      detail: {
        tldr: 'Summary here.',
        for_you: [{ text: 'Do task', reason: 'assigned' }],
        hook_sections: [
          { title: 'Blockers', items: [{ text: 'Blocked on API' }], omitted_count: 0 },
        ],
      },
    });
    // Verify ordering: meta → tldr → for_you → hook_sections
    const metaIdx = result.indexOf('Meeting: Full Meeting');
    const tldrIdx = result.indexOf('## TL;DR');
    const forYouIdx = result.indexOf('## Key Takeaways for You');
    const blockersIdx = result.indexOf('## Blockers');
    expect(metaIdx).toBeLessThan(tldrIdx);
    expect(tldrIdx).toBeLessThan(forYouIdx);
    expect(forYouIdx).toBeLessThan(blockersIdx);
  });

  it('includes top-level decisions array', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Test' },
      detail: {},
      decisions: [
        { tag: 'DECIDED', text: 'Use REST over GraphQL' },
        { tag: 'PROPOSED', text: 'Add caching layer' },
      ],
    });
    expect(result).toContain('## Decisions');
    expect(result).toContain('- [DECIDED] Use REST over GraphQL');
    expect(result).toContain('- [PROPOSED] Add caching layer');
  });

  it('includes top-level action_items array', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Test' },
      detail: {},
      action_items: [
        { owner: 'Alice', action: 'Write API spec', due: '2026-03-25' },
        { owner: 'Bob', action: 'Review PR' },
      ],
    });
    expect(result).toContain('## Action Items');
    expect(result).toContain('- [Alice] Write API spec — 2026-03-25');
    expect(result).toContain('- [Bob] Review PR');
    expect(result).not.toContain('— undefined');
  });

  it('includes top-level open_items array', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Test' },
      detail: {},
      open_items: [
        { text: 'Database migration plan', owner: 'Charlie' },
      ],
    });
    expect(result).toContain('## Open Items');
    expect(result).toContain('Database migration plan');
  });

  it('includes source files section when transcript/recap paths present', () => {
    const result = buildMeetingContext({
      meta: {
        meeting_name: 'Test',
        transcript_path: 'reports/transcript/t1.md',
        full_recap_path: 'reports/meeting-recap/r1.md',
      },
      detail: {},
    });
    expect(result).toContain('## Source Files');
    expect(result).toContain('Full transcript: reports/transcript/t1.md');
    expect(result).toContain('Detailed recap: reports/meeting-recap/r1.md');
  });

  it('omits source files section when no paths present', () => {
    const result = buildMeetingContext({
      meta: { meeting_name: 'Test' },
      detail: {},
    });
    expect(result).not.toContain('## Source Files');
  });

  it('includes only transcript path when recap path is absent', () => {
    const result = buildMeetingContext({
      meta: {
        meeting_name: 'Test',
        transcript_path: 'reports/transcript/t1.md',
      },
      detail: {},
    });
    expect(result).toContain('Full transcript: reports/transcript/t1.md');
    expect(result).not.toContain('Detailed recap:');
  });
});

describe('groupByDate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 22, 10, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups entries by date bucket in correct order', () => {
    const entries = [
      { date_local: '2026-03-22T09:00:00', meeting_name: 'Today Meeting' },
      { date_local: '2026-03-21T14:00:00', meeting_name: 'Yesterday Meeting' },
      { date_local: '2026-03-20T10:00:00', meeting_name: 'This Week Meeting' },
      { date_local: '2026-02-15T10:00:00', meeting_name: 'Older Meeting' },
    ];
    const groups = groupByDate(entries);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Yesterday', 'This Week', 'Older']);
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[0].entries[0].meeting_name).toBe('Today Meeting');
  });

  it('omits empty date buckets', () => {
    const entries = [
      { date_local: '2026-03-22T09:00:00', meeting_name: 'A' },
      { date_local: '2025-01-01T00:00:00', meeting_name: 'B' },
    ];
    const groups = groupByDate(entries);
    expect(groups.map(g => g.label)).toEqual(['Today', 'Older']);
  });

  it('returns empty array for empty input', () => {
    expect(groupByDate([])).toEqual([]);
  });

  it('groups multiple entries in the same bucket', () => {
    const entries = [
      { date_local: '2026-03-22T08:00:00', meeting_name: 'A' },
      { date_local: '2026-03-22T14:00:00', meeting_name: 'B' },
    ];
    const groups = groupByDate(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].entries).toHaveLength(2);
  });

  it('preserves entry order within each group', () => {
    const entries = [
      { date_local: '2026-03-22T08:00:00', meeting_name: 'First' },
      { date_local: '2026-03-22T14:00:00', meeting_name: 'Second' },
    ];
    const groups = groupByDate(entries);
    expect(groups[0].entries[0].meeting_name).toBe('First');
    expect(groups[0].entries[1].meeting_name).toBe('Second');
  });
});
