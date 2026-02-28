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

export interface HistoryMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: string;
  toolId?: string;
  timestamp?: string;
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

/**
 * Read the message history from a session's JSONL file.
 * Returns user messages and assistant text/tool_use blocks as a flat list.
 */
export function readSessionMessages(workDir: string, sessionId: string): HistoryMessage[] {
  const projectsDir = getClaudeProjectsDir();
  const projectFolder = pathToProjectFolder(workDir);
  const filePath = join(projectsDir, projectFolder, `${sessionId}.jsonl`);

  if (!existsSync(filePath)) {
    return [];
  }

  const result: HistoryMessage[] = [];

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        const ts = data.timestamp || undefined;

        if (data.type === 'user' && data.message?.content) {
          const text = typeof data.message.content === 'string'
            ? data.message.content
            : data.message.content
                .filter((b: { type: string }) => b.type === 'text')
                .map((b: { text: string }) => b.text || '')
                .join('');
          if (text.trim()) {
            result.push({ role: 'user', content: text, timestamp: ts });
          }
        }

        if (data.type === 'assistant' && data.message?.content && Array.isArray(data.message.content)) {
          for (const block of data.message.content) {
            if (block.type === 'text' && block.text) {
              result.push({ role: 'assistant', content: block.text, timestamp: ts });
            } else if (block.type === 'tool_use') {
              result.push({
                role: 'tool',
                content: '',
                toolName: block.name,
                toolInput: JSON.stringify(block.input || {}),
                toolId: block.id,
                timestamp: ts,
              });
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* skip unreadable files */ }

  return result;
}
