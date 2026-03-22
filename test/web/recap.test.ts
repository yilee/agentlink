import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDateGroup, getMeetingTypeBadge, getSectionIcon } from '../../server/web/src/modules/recap.js';

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
