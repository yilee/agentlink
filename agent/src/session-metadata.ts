import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { CONFIG_DIR } from './config.js';

const SESSIONS_DIR = join(CONFIG_DIR, 'sessions');

export interface SessionMetadata {
  brainMode?: boolean;
  recapId?: string;
  briefingDate?: string;
  devopsEntityType?: string;
  devopsEntityId?: string;
  devopsEntityTitle?: string;
  projectName?: string;
}

function ensureSessionsDir(): void {
  if (!existsSync(SESSIONS_DIR)) {
    mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

/** Save (merge) metadata for a Claude session. */
export function saveSessionMetadata(claudeSessionId: string, metadata: Partial<SessionMetadata>): void {
  ensureSessionsDir();
  const filePath = join(SESSIONS_DIR, `${claudeSessionId}.json`);
  const existing = loadSessionMetadata(claudeSessionId);
  writeFileSync(filePath, JSON.stringify({ ...existing, ...metadata }, null, 2) + '\n', 'utf-8');
}

/** Load metadata for a single session. Returns {} on missing/corrupt files. */
export function loadSessionMetadata(claudeSessionId: string): SessionMetadata {
  try {
    return JSON.parse(readFileSync(join(SESSIONS_DIR, `${claudeSessionId}.json`), 'utf-8'));
  } catch { return {}; }
}

/** Load metadata for all sessions (bulk). Returns Map keyed by claudeSessionId. */
export function loadAllSessionMetadata(): Map<string, SessionMetadata> {
  const map = new Map<string, SessionMetadata>();
  try {
    for (const f of readdirSync(SESSIONS_DIR)) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      try { map.set(id, JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf-8'))); } catch { /* skip corrupt */ }
    }
  } catch { /* dir missing */ }
  return map;
}

/** Delete metadata file for a session. */
export function deleteSessionMetadata(claudeSessionId: string): void {
  try { unlinkSync(join(SESSIONS_DIR, `${claudeSessionId}.json`)); } catch { /* ignore */ }
}
