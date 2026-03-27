import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PrEntry {
  pr_number: string;
  title: string | null;
  url: string;
  project: string;
  repository: string;
  source: 'azure_devops' | 'github';
  total_mentions: number;
  status: string;
  created_by: string;
  created_date: string;
  source_branch: string;
  target_branch: string;
  merge_status: string;
  reviewers: Array<{ name: string; vote: string }>;
}

export interface WiEntry {
  work_item_id: string;
  title: string | null;
  url: string;
  project: string;
  total_mentions: number;
  state: string;
  assigned_to: string;
  priority: string;
  severity: string;
  area_path: string;
  created_date: string;
  work_item_type: string;
}

const PR_DIR = 'devops/pull_requests';
const WI_DIR = 'devops/work_items';

/** Simple YAML parser for flat key-value metadata files (no nested objects). */
function parseSimpleYaml(content: string): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const line of content.split('\n')) {
    // Match "key: value" or "key: 'value'" — skip array entries (- item)
    const m = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    // Strip surrounding quotes
    if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
      val = val.slice(1, -1);
    }
    result[m[1]] = val;
  }
  return result;
}

/** Extract a table field value from markdown "| **Field** | Value |" rows. */
function extractTableField(content: string, fieldName: string): string {
  // Match both "| **Field** | value |" and "| Field | value |" patterns
  const regex = new RegExp(`^\\|\\s*\\*{0,2}${fieldName}\\*{0,2}\\s*\\|\\s*(.+?)\\s*\\|`, 'mi');
  const m = content.match(regex);
  if (!m) return '';
  return m[1].trim().replace(/`/g, '');
}

/** Parse reviewer lines from description.md Reviewers section. */
function parseReviewers(content: string): Array<{ name: string; vote: string }> {
  const reviewers: Array<{ name: string; vote: string }> = [];
  // Find the ## Reviewers section
  const sectionMatch = content.match(/## Reviewers\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/);
  if (!sectionMatch) return reviewers;

  const section = sectionMatch[1];
  // Match lines like: - **Name**: ✅ Approved | ⏸️ No vote | ❌ Rejected | ⏳ Wait
  const lineRegex = /^- \*\*(.+?)\*\*:\s*(?:✅|⏸️|❌|⏳|🔵)?\s*(.+)$/gm;
  let m;
  while ((m = lineRegex.exec(section)) !== null) {
    const name = m[1].trim();
    const voteText = m[2].trim().toLowerCase();
    let vote = 'no_vote';
    if (voteText.includes('approved')) vote = 'approved';
    else if (voteText.includes('rejected') || voteText.includes('declined')) vote = 'rejected';
    else if (voteText.includes('wait')) vote = 'wait';
    reviewers.push({ name, vote });
  }
  return reviewers;
}

/** Parse title from description.md H1 line. */
function parseTitleFromDescription(content: string, entityType: 'pr' | 'wi'): string | null {
  const h1Match = content.match(/^# (.+)$/m);
  if (!h1Match) return null;
  const h1 = h1Match[1];
  if (entityType === 'pr') {
    // "Pull Request #6325916: Add video asset..." → "Add video asset..."
    const m = h1.match(/Pull Request #\d+:\s*(.+)/);
    return m ? m[1].trim() : h1;
  } else {
    // "[Task 6493060] Refactor Slideshow..." or "[Bug 128076] AnswersException..."
    const m = h1.match(/\[(?:Task|Bug|Feature|User Story|Epic|Issue)\s+\d+\]\s*(.+)/i);
    return m ? m[1].trim() : h1;
  }
}

/** Parse work item type from description.md H1 line. */
function parseWorkItemType(content: string): string {
  const h1Match = content.match(/^# \[(\w[\w\s]*?)\s+\d+\]/m);
  return h1Match ? h1Match[1] : 'Task';
}

export async function listDevops(brainHome: string): Promise<{ pullRequests: PrEntry[]; workItems: WiEntry[]; userName: string }> {
  const userName = os.userInfo().username;
  const pullRequests = await listPullRequests(brainHome);
  const workItems = await listWorkItems(brainHome);
  return { pullRequests, workItems, userName };
}

async function listPullRequests(brainHome: string): Promise<PrEntry[]> {
  const dirPath = path.join(brainHome, PR_DIR);
  try {
    const dirs = fs.readdirSync(dirPath);
    const entries: PrEntry[] = [];

    for (const dir of dirs) {
      if (!dir.startsWith('pr_')) continue;
      const prDir = path.join(dirPath, dir);
      const stat = fs.statSync(prDir);
      if (!stat.isDirectory()) continue;

      try {
        const metaPath = path.join(prDir, 'metadata.yaml');
        const metaContent = fs.readFileSync(metaPath, 'utf-8');
        const meta = parseSimpleYaml(metaContent);

        let descContent = '';
        const descPath = path.join(prDir, 'description.md');
        try {
          descContent = fs.readFileSync(descPath, 'utf-8');
        } catch { /* no description.md */ }

        const title = (meta.title && meta.title !== 'null')
          ? String(meta.title)
          : parseTitleFromDescription(descContent, 'pr');

        entries.push({
          pr_number: String(meta.pr_number || ''),
          title,
          url: String(meta.url || ''),
          project: String(meta.project || ''),
          repository: String(meta.repository || ''),
          source: (String(meta.source || '') === 'github' ? 'github' : 'azure_devops'),
          total_mentions: Number(meta.total_mentions) || 0,
          status: extractTableField(descContent, 'Status').toLowerCase() || 'active',
          created_by: extractTableField(descContent, 'Created By'),
          created_date: extractTableField(descContent, 'Created Date'),
          source_branch: extractTableField(descContent, 'Source Branch'),
          target_branch: extractTableField(descContent, 'Target Branch'),
          merge_status: extractTableField(descContent, 'Merge Status').toLowerCase(),
          reviewers: parseReviewers(descContent),
        });
      } catch (err) {
        console.error(`[AgentLink] Failed to parse PR ${dir}:`, err);
      }
    }

    // Sort by created_date descending
    entries.sort((a, b) => b.created_date.localeCompare(a.created_date));
    return entries;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`[AgentLink] PR directory not found at ${dirPath}`);
      return [];
    }
    throw err;
  }
}

async function listWorkItems(brainHome: string): Promise<WiEntry[]> {
  const dirPath = path.join(brainHome, WI_DIR);
  try {
    const dirs = fs.readdirSync(dirPath);
    const entries: WiEntry[] = [];

    for (const dir of dirs) {
      if (!dir.startsWith('wi_')) continue;
      const wiDir = path.join(dirPath, dir);
      const stat = fs.statSync(wiDir);
      if (!stat.isDirectory()) continue;

      try {
        const metaPath = path.join(wiDir, 'metadata.yaml');
        const metaContent = fs.readFileSync(metaPath, 'utf-8');
        const meta = parseSimpleYaml(metaContent);

        let descContent = '';
        const descPath = path.join(wiDir, 'description.md');
        try {
          descContent = fs.readFileSync(descPath, 'utf-8');
        } catch { /* no description.md */ }

        const title = parseTitleFromDescription(descContent, 'wi') || String(meta.title || null);

        entries.push({
          work_item_id: String(meta.work_item_id || ''),
          title: title === 'null' ? null : title,
          url: String(meta.url || ''),
          project: String(meta.project || ''),
          total_mentions: Number(meta.total_mentions) || 0,
          state: extractTableField(descContent, 'State') || 'New',
          assigned_to: extractTableField(descContent, 'Assigned To'),
          priority: extractTableField(descContent, 'Priority') || 'N/A',
          severity: extractTableField(descContent, 'Severity') || 'N/A',
          area_path: extractTableField(descContent, 'Area Path'),
          created_date: extractTableField(descContent, 'Created Date'),
          work_item_type: parseWorkItemType(descContent),
        });
      } catch (err) {
        console.error(`[AgentLink] Failed to parse WI ${dir}:`, err);
      }
    }

    // Sort by priority ascending (P1 first), then created_date descending
    entries.sort((a, b) => {
      const pa = a.priority === 'N/A' ? 99 : Number(a.priority);
      const pb = b.priority === 'N/A' ? 99 : Number(b.priority);
      if (pa !== pb) return pa - pb;
      return b.created_date.localeCompare(a.created_date);
    });
    return entries;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`[AgentLink] WI directory not found at ${dirPath}`);
      return [];
    }
    throw err;
  }
}

export async function getDevopsDetail(
  brainHome: string,
  entityType: 'pr' | 'wi',
  entityId: string,
): Promise<{ entityType: string; entityId: string; description: string; mentions: string }> {
  // Validate entityId to prevent path traversal
  if (!/^[\w]+$/.test(entityId)) {
    throw new Error(`Invalid entity ID: ${entityId}`);
  }

  const subdir = entityType === 'pr' ? PR_DIR : WI_DIR;
  const prefix = entityType === 'pr' ? 'pr_' : 'wi_';
  const entityDir = path.join(brainHome, subdir, `${prefix}${entityId}`);

  let description = '';
  let mentions = '';

  try {
    description = fs.readFileSync(path.join(entityDir, 'description.md'), 'utf-8');
  } catch { /* no description.md */ }

  try {
    mentions = fs.readFileSync(path.join(entityDir, 'mentions.md'), 'utf-8');
  } catch { /* no mentions.md */ }

  if (!description && !mentions) {
    throw new Error(`Entity ${entityType}/${entityId} not found`);
  }

  return { entityType, entityId, description, mentions };
}
