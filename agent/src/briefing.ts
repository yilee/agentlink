import fs from 'fs';
import path from 'path';

export interface BriefingEntry {
  date: string;           // "2026-03-27"
  title: string;          // "Daily Briefing — 2026-03-27 Thursday"
  tldr: string;           // Extracted TL;DR paragraph (truncated)
  action_today: number;   // Count of 🔴 Today items
  action_week: number;    // Count of 🟡 This Week items
  fyi_count: number;      // Count of ⚪ FYI items
  file_size: number;      // File size in bytes
}

const BRIEFING_DIR = 'reports/daily';

function extractMetadata(content: string, fileSize: number): Omit<BriefingEntry, 'date'> {
  // Title: first H1 line
  const titleMatch = content.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1] : 'Daily Briefing';

  // TL;DR: text between ## TL;DR and the next --- or ##
  let tldr = '';
  const tldrMatch = content.match(/## TL;DR\s*\n([\s\S]*?)(?=\n---|\n## )/);
  if (tldrMatch) {
    tldr = tldrMatch[1].trim().replace(/\n/g, ' ');
    if (tldr.length > 300) tldr = tldr.slice(0, 297) + '...';
  }

  // Action counts: count numbered items in each priority section
  let action_today = 0;
  let action_week = 0;
  let fyi_count = 0;

  // Count numbered items (e.g. "1. **..." or "- **...") under each priority heading
  const todayMatch = content.match(/\*\*🔴 Today\*\*\s*\n([\s\S]*?)(?=\*\*🟡|\*\*⚪|---|\n## )/);
  if (todayMatch) {
    action_today = (todayMatch[1].match(/^\d+\.\s/gm) || []).length;
  }

  const weekMatch = content.match(/\*\*🟡 This Week\*\*\s*\n([\s\S]*?)(?=\*\*⚪|---|\n## )/);
  if (weekMatch) {
    action_week = (weekMatch[1].match(/^\d+\.\s/gm) || []).length;
  }

  const fyiMatch = content.match(/\*\*⚪ FYI[^*]*\*\*\s*\n([\s\S]*?)(?=---|\n## )/);
  if (fyiMatch) {
    fyi_count = (fyiMatch[1].match(/^- \*\*/gm) || []).length;
  }

  return { title, tldr, action_today, action_week, fyi_count, file_size: fileSize };
}

export async function listBriefings(brainHome: string): Promise<BriefingEntry[]> {
  const dirPath = path.join(brainHome, BRIEFING_DIR);
  try {
    const files = fs.readdirSync(dirPath);
    const entries: BriefingEntry[] = [];

    for (const file of files) {
      // Only process YYYY-MM-DD.md files (skip meeting-recap-*.md or other files)
      const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!dateMatch) continue;

      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const meta = extractMetadata(content, stat.size);
      entries.push({ date: dateMatch[1], ...meta });
    }

    // Sort by date descending (newest first)
    entries.sort((a, b) => b.date.localeCompare(a.date));
    return entries;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      console.log(`[AgentLink] Briefing directory not found at ${dirPath}`);
      return [];
    }
    throw err;
  }
}

export async function getBriefingDetail(brainHome: string, date: string): Promise<{ date: string; content: string }> {
  // Validate date format to prevent path traversal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}`);
  }
  const filePath = path.join(brainHome, BRIEFING_DIR, `${date}.md`);
  const content = fs.readFileSync(filePath, 'utf-8');
  return { date, content };
}
