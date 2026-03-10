// ── Loop template definitions ─────────────────────────────────────────────────
// Predefined sample cases for the Loop creation panel ("Try it" cards).
// Each template pre-fills name, prompt, scheduleType, and scheduleConfig.

export const LOOP_TEMPLATES = {
  'competitive-intel': {
    label: 'Competitive Intel Monitor',
    description: 'Track competitor products, pricing, and industry trends',
    name: 'Competitive Intelligence Monitor',
    prompt: `Monitor competitor and industry developments. Scan the working directory for any tracked competitor data, news feeds, or intelligence files.

1. Identify new product launches, feature updates, or pricing changes from competitors
2. Summarize key industry trends, regulatory changes, or market shifts
3. Highlight strategic threats (competitors gaining ground) and opportunities (gaps in market)
4. Compare against our current positioning where relevant

Provide a structured briefing with sections: Key Developments, Threats, Opportunities, Recommended Actions.`,
    scheduleType: 'daily',
    scheduleConfig: { hour: 8, minute: 0 },
  },

  'knowledge-base': {
    label: 'Knowledge Base Maintenance',
    description: 'Audit notes and docs for broken links, orphan files, and organization',
    name: 'Knowledge Base Maintenance',
    prompt: `Perform a maintenance audit on the knowledge base / notes in this directory.

1. Find broken internal links (references to files or headings that no longer exist)
2. Identify orphan files (documents with no inbound links from any other document)
3. Detect duplicate or near-duplicate content across files
4. Check for outdated information (files not modified in 90+ days that reference time-sensitive topics)
5. Suggest tag/folder reorganization for better discoverability

Provide a structured report with sections: Broken Links, Orphan Files, Duplicates, Stale Content, Reorganization Suggestions.`,
    scheduleType: 'weekly',
    scheduleConfig: { hour: 20, minute: 0, dayOfWeek: 5 },  // Friday 20:00
  },

  custom: {
    label: 'Custom',
    description: 'Create your own scheduled task with a custom prompt',
    name: '',
    prompt: '',
    scheduleType: 'daily',
    scheduleConfig: { hour: 9, minute: 0 },
  },
};

export const LOOP_TEMPLATE_KEYS = ['competitive-intel', 'knowledge-base', 'custom'];

/**
 * Convert scheduleType + scheduleConfig into a cron expression string.
 * @param {string} scheduleType - 'hourly' | 'daily' | 'weekly' | 'cron'
 * @param {object} scheduleConfig - { hour?, minute?, dayOfWeek?, cronExpression? }
 * @returns {string} cron expression
 */
export function buildCronExpression(scheduleType, scheduleConfig) {
  const min = scheduleConfig.minute ?? 0;
  const hr = scheduleConfig.hour ?? 9;
  switch (scheduleType) {
    case 'hourly':
      return `${min} * * * *`;
    case 'daily':
      return `${min} ${hr} * * *`;
    case 'weekly':
      return `${min} ${hr} * * ${scheduleConfig.dayOfWeek ?? 1}`;
    case 'cron':
      return scheduleConfig.cronExpression || `${min} ${hr} * * *`;
    default:
      return `${min} ${hr} * * *`;
  }
}

/**
 * Format a cron expression into a human-readable description.
 * @param {string} scheduleType - 'hourly' | 'daily' | 'weekly' | 'cron'
 * @param {object} scheduleConfig - { hour?, minute?, dayOfWeek? }
 * @param {string} cronExpr - raw cron expression (for 'cron' type)
 * @returns {string}
 */
export function formatSchedule(scheduleType, scheduleConfig, cronExpr) {
  const pad = n => String(n).padStart(2, '0');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  switch (scheduleType) {
    case 'hourly':
      return 'Every hour';
    case 'daily':
      return `Every day at ${pad(scheduleConfig.hour ?? 9)}:${pad(scheduleConfig.minute ?? 0)}`;
    case 'weekly': {
      const day = DAYS[scheduleConfig.dayOfWeek ?? 1] || 'Monday';
      return `Every ${day} at ${pad(scheduleConfig.hour ?? 9)}:${pad(scheduleConfig.minute ?? 0)}`;
    }
    case 'cron':
      return cronExpr || 'Custom cron';
    default:
      return cronExpr || 'Unknown schedule';
  }
}
