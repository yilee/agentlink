/**
 * Read Claude Code session history from ~/.claude/projects/<folder>/<sessionId>.jsonl
 *
 * Claude stores sessions as JSONL files organized by project directory.
 * Path-to-folder mapping: `/foo/bar` → `-foo-bar`, `C:\foo\bar` → `C--foo-bar`
 */

import { homedir } from 'os';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface SessionInfo {
  sessionId: string;
  title: string;
  preview: string;
  lastModified: number;
}

function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

function pathToProjectFolder(workDir: string): string {
  return workDir
    .replace(/:/g, '-')
    .replace(/[/\\]/g, '-');
}

/**
 * List sessions for a given working directory by scanning JSONL files.
 * Returns sessions sorted by lastModified descending.
 */
export function listSessions(workDir: string): SessionInfo[] {
  const projectsDir = getClaudeProjectsDir();
  const projectFolder = pathToProjectFolder(workDir);
  const projectPath = join(projectsDir, projectFolder);

  if (!existsSync(projectPath)) {
    return [];
  }

  const sessions: SessionInfo[] = [];

  let files: string[];
  try {
    files = readdirSync(projectPath);
  } catch {
    return [];
  }

  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue;

    const sessionId = file.replace('.jsonl', '');
    const filePath = join(projectPath, file);

    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      continue;
    }

    let title = '';
    let preview = '';
    let hasUserMessage = false;
    let customTitle = '';
    let summary = '';

    try {
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter(l => l.trim());

      for (const line of lines) {
        try {
          const data = JSON.parse(line);

          if (!hasUserMessage && data.type === 'user' && data.message?.content) {
            const text = typeof data.message.content === 'string'
              ? data.message.content
              : data.message.content[0]?.text || '';
            if (text.trim()) {
              preview = text.substring(0, 100);
              title = text.substring(0, 100);
              hasUserMessage = true;
            }
          }

          if (data.type === 'custom-title' && data.customTitle) {
            customTitle = data.customTitle;
          }
          if (data.type === 'summary' && data.summary) {
            summary = data.summary;
          }
        } catch { /* skip malformed lines */ }
      }
    } catch { /* skip unreadable files */ }

    if (hasUserMessage) {
      sessions.push({
        sessionId,
        title: customTitle || summary || title || sessionId.slice(0, 8),
        preview,
        lastModified: stats.mtime.getTime(),
      });
    }
  }

  sessions.sort((a, b) => b.lastModified - a.lastModified);
  return sessions;
}
