import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface IndexEntry {
  recap_id: string;
  meeting_id: string;
  meeting_name: string;
  series_name: string;
  date_utc: string;
  date_local: string;
  meeting_type: string;
  project: string | null;
  for_you_count: number;
  tldr_snippet: string;
  sidecar_path: string;
  recap_path: string;
  sharing_link: string | null;
}

export interface SidecarJSON {
  schema_version: string;
  meta: Record<string, unknown>;
  feed: Record<string, unknown>;
  detail: {
    tldr: string;
    for_you: Array<{ text: string; reason: string; kind: string }>;
    hook_sections: Array<{
      section_type: string;
      title: string;
      items: Array<{ text: string; [key: string]: unknown }>;
      omitted_count: number;
    }>;
    decisions_count: number;
    action_items_count: number;
    open_items_count: number;
  };
  decisions: Array<Record<string, unknown>>;
  action_items: Array<Record<string, unknown>>;
  open_items: Array<Record<string, unknown>>;
}

const RECAP_INDEX_PATH = 'reports/meeting-recap/recap_index.yaml';

export async function listRecaps(brainHome: string): Promise<IndexEntry[]> {
  const indexPath = path.join(brainHome, RECAP_INDEX_PATH);
  try {
    const content = fs.readFileSync(indexPath, 'utf-8');
    const parsed = yaml.load(content) as { recaps?: IndexEntry[] } | null;
    if (!parsed || !Array.isArray(parsed.recaps)) {
      return [];
    }
    return parsed.recaps;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      console.log(`[AgentLink] recap_index.yaml not found at ${indexPath}`);
      return [];
    }
    throw err;
  }
}

export async function getRecapDetail(brainHome: string, sidecarPath: string): Promise<SidecarJSON> {
  const fullPath = path.join(brainHome, sidecarPath);
  const content = fs.readFileSync(fullPath, 'utf-8');
  return JSON.parse(content) as SidecarJSON;
}
