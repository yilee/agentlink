import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface SearchResultEntry {
  id: string;
  source: string;
  timestamp: string;
  title: string;
  subtitle: string;
  snippet: string;
  url?: string;
  file?: string;
  extra?: Record<string, unknown>;
}

export interface SearchResultGroup {
  source: string;
  label: string;
  count: number;
  entries: SearchResultEntry[];
}

export interface SearchIndexStats {
  sources: Array<{ name: string; count: number; generated: string }>;
}

interface IndexFile {
  source: string;
  version?: number;
  generated: string;
  count: number;
  entries: Record<string, unknown>[];
}

const SEARCH_INDEX_DIR = '.search_index';
const RECAP_INDEX_PATH = 'reports/meeting-recap/recap_index.yaml';
const SOURCE_META: Record<string, { label: string; searchFields: string[] }> = {
  teams:          { label: 'Teams',          searchFields: ['sender', 'chat', 'body_preview'] },
  emails:         { label: 'Email',          searchFields: ['sender', 'subject', 'body_preview'] },
  meetings:       { label: 'Meetings',       searchFields: ['meeting_name', 'body_preview'] },
  meeting_recaps: { label: 'Meeting Recaps', searchFields: ['meeting_name', 'series_name', 'tldr_snippet'] },
  pull_requests:  { label: 'Pull Requests',  searchFields: ['title', 'pr_number', 'project', 'repository'] },
  work_items:     { label: 'Work Items',     searchFields: ['title', 'project'] },
  documents:      { label: 'Documents',      searchFields: ['title'] },
};

// In-memory cache
let cachedIndexes: Map<string, IndexFile> | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function loadIndexes(brainHome: string): Map<string, IndexFile> {
  const indexDir = path.join(brainHome, SEARCH_INDEX_DIR);
  const indexes = new Map<string, IndexFile>();

  for (const source of Object.keys(SOURCE_META)) {
    if (source === 'meeting_recaps') continue; // loaded separately below
    const filePath = path.join(indexDir, `${source}.json`);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as IndexFile;
      if (data.entries && data.entries.length > 0) {
        indexes.set(source, data);
      }
    } catch {
      // Skip missing or malformed index files
    }
  }

  // Load meeting recaps from YAML index
  try {
    const recapPath = path.join(brainHome, RECAP_INDEX_PATH);
    const raw = fs.readFileSync(recapPath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown>[] | { recaps?: Record<string, unknown>[] } | null;
    const entries = Array.isArray(parsed) ? parsed : (parsed as { recaps?: Record<string, unknown>[] })?.recaps;
    if (Array.isArray(entries) && entries.length > 0) {
      indexes.set('meeting_recaps', {
        source: 'meeting_recaps',
        generated: '',
        count: entries.length,
        entries,
      });
    }
  } catch {
    // Skip if recap index not found
  }

  return indexes;
}

function getIndexes(brainHome: string): Map<string, IndexFile> {
  const now = Date.now();
  if (cachedIndexes && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedIndexes;
  }
  cachedIndexes = loadIndexes(brainHome);
  cacheTimestamp = now;
  return cachedIndexes;
}

function entryMatchesQuery(entry: Record<string, unknown>, fields: string[], lowerQuery: string): boolean {
  for (const field of fields) {
    const val = entry[field];
    if (typeof val === 'string' && val.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    // Handle mentioned_users array for teams
    if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'string' && item.toLowerCase().includes(lowerQuery)) {
          return true;
        }
      }
    }
  }
  return false;
}

function mapEntry(source: string, entry: Record<string, unknown>): SearchResultEntry {
  const e = entry as Record<string, string>;
  switch (source) {
    case 'teams':
      return {
        id: e.id,
        source,
        timestamp: e.timestamp || '',
        title: e.sender || '',
        subtitle: e.chat || '',
        snippet: e.body_preview || '',
        file: e.file,
      };
    case 'emails':
      return {
        id: e.id,
        source,
        timestamp: e.timestamp || '',
        title: e.sender || '',
        subtitle: e.subject || '',
        snippet: e.body_preview || '',
        file: e.file,
        extra: {
          folder: e.folder,
          importance: e.importance,
          thread_id: e.thread_id,
        },
      };
    case 'meetings':
      return {
        id: e.id,
        source,
        timestamp: e.timestamp || '',
        title: e.meeting_name || '',
        subtitle: '',
        snippet: e.body_preview || '',
        file: e.file,
      };
    case 'meeting_recaps':
      return {
        id: e.recap_id || e.id || '',
        source,
        timestamp: e.date_utc || '',
        title: e.meeting_name || '',
        subtitle: e.series_name || '',
        snippet: e.tldr_snippet || '',
        extra: { recapId: e.recap_id, sidecarPath: e.sidecar_path },
      };
    case 'pull_requests':
      return {
        id: e.id,
        source,
        timestamp: '',
        title: e.title || `PR #${e.pr_number}`,
        subtitle: [e.project, e.repository].filter(Boolean).join(' / '),
        snippet: '',
        url: e.url,
        file: e.file,
        extra: {
          pr_number: e.pr_number,
          total_mentions: Number(entry.total_mentions) || 0,
        },
      };
    case 'work_items':
      return {
        id: e.id,
        source,
        timestamp: '',
        title: e.title || `WI #${e.id}`,
        subtitle: e.project || '',
        snippet: '',
        url: e.url,
        file: e.file,
        extra: {
          total_mentions: Number(entry.total_mentions) || 0,
        },
      };
    case 'documents':
      return {
        id: e.id,
        source,
        timestamp: '',
        title: e.title || '',
        subtitle: '',
        snippet: '',
        url: e.url,
        file: e.file,
        extra: {
          total_mentions: Number(entry.total_mentions) || 0,
        },
      };
    default:
      return {
        id: e.id || '',
        source,
        timestamp: e.timestamp || '',
        title: '',
        subtitle: '',
        snippet: e.body_preview || '',
        file: e.file,
      };
  }
}

export async function brainSearch(
  brainHome: string,
  query: string,
  sources?: string[],
  limit?: number,
): Promise<{ query: string; groups: SearchResultGroup[]; totalResults: number }> {
  const maxPerSource = limit || 20;
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) {
    return { query, groups: [], totalResults: 0 };
  }

  const indexes = getIndexes(brainHome);
  const groups: SearchResultGroup[] = [];
  let totalResults = 0;

  const sourcesToSearch = sources && sources.length > 0
    ? sources.filter(s => SOURCE_META[s])
    : Object.keys(SOURCE_META);

  for (const source of sourcesToSearch) {
    const index = indexes.get(source);
    if (!index) continue;

    const meta = SOURCE_META[source];
    const matched: SearchResultEntry[] = [];

    for (const entry of index.entries) {
      if (entryMatchesQuery(entry, meta.searchFields, lowerQuery)) {
        matched.push(mapEntry(source, entry));
      }
    }

    if (matched.length === 0) continue;

    // Sort by timestamp descending (newest first)
    matched.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    totalResults += matched.length;
    groups.push({
      source,
      label: meta.label,
      count: matched.length,
      entries: matched.slice(0, maxPerSource),
    });
  }

  return { query, groups, totalResults };
}

export async function getSearchIndexStats(brainHome: string): Promise<SearchIndexStats> {
  const indexes = getIndexes(brainHome);
  const sources: SearchIndexStats['sources'] = [];

  for (const [source, index] of indexes) {
    if (!SOURCE_META[source]) continue;
    sources.push({
      name: source,
      count: index.count || index.entries.length,
      generated: index.generated || '',
    });
  }

  return { sources };
}

/** Clear cache (for testing). */
export function clearSearchCache(): void {
  cachedIndexes = null;
  cacheTimestamp = 0;
}
