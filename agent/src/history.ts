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
  isCommandOutput?: boolean;
}

function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

function pathToProjectFolder(workDir: string): string {
  return workDir
    .replace(/:/g, '-')
    .replace(/[/\\]/g, '-')
    .replace(/ /g, '-');
}

/** Messages that are pure CLI metadata — always hidden */
function isHiddenCommand(text: string): boolean {
  return text.includes('<local-command-caveat>') ||
    text.includes('<command-name>');
}

/** Extract displayable output from local command stdout/stderr tags */
function extractCommandOutput(text: string): string | null {
  const stdoutMatch = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (stdoutMatch) return stdoutMatch[1].trim();
  const stderrMatch = text.match(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/);
  if (stderrMatch) return stderrMatch[1].trim();
  return null;
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
            if (text.trim() && !isHiddenCommand(text) && !extractCommandOutput(text)) {
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
          if (!text.trim()) continue;
          // Skip caveat and command-name metadata
          if (isHiddenCommand(text)) continue;
          // Extract command output (e.g. /cost, /context results)
          const cmdOutput = extractCommandOutput(text);
          if (cmdOutput) {
            result.push({ role: 'user', content: cmdOutput, timestamp: ts, isCommandOutput: true });
          } else {
            result.push({ role: 'user', content: text, timestamp: ts });
          }
        }

        if (data.type === 'assistant' && data.message?.content && Array.isArray(data.message.content)) {
          // Merge all text blocks within this assistant message into one entry
          const textParts: string[] = [];
          const toolBlocks: typeof data.message.content = [];

          for (const block of data.message.content) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            } else if (block.type === 'tool_use') {
              toolBlocks.push(block);
            }
          }

          if (textParts.length > 0) {
            result.push({ role: 'assistant', content: textParts.join('\n\n'), timestamp: ts });
          }

          for (const tool of toolBlocks) {
            result.push({
              role: 'tool',
              content: '',
              toolName: tool.name,
              toolInput: JSON.stringify(tool.input || {}),
              toolId: tool.id,
              timestamp: ts,
            });
          }
        }
      } catch { /* skip malformed lines */ }
    }
  } catch { /* skip unreadable files */ }

  return result;
}
