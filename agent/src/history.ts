/**
 * Read Claude Code session history from ~/.claude/projects/<folder>/<sessionId>.jsonl
 *
 * Claude stores sessions as JSONL files organized by project directory.
 * Path-to-folder mapping: `/foo/bar` → `-foo-bar`, `C:\foo\bar` → `C--foo-bar`
 */

import { homedir } from 'os';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, appendFileSync } from 'fs';
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
  toolOutput?: string;
  timestamp?: string;
  isCommandOutput?: boolean;
}

function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

export function pathToProjectFolder(workDir: string): string {
  const sanitized = workDir.replace(/[^a-zA-Z0-9]/g, '-');
  if (sanitized.length <= 200) return sanitized;
  // Hash for long paths (matches Claude CLI's Java-style hashCode)
  let hash = 0;
  for (let i = 0; i < workDir.length; i++) {
    hash = (hash << 5) - hash + workDir.charCodeAt(i);
    hash |= 0;
  }
  return `${sanitized.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

/** Messages that are pure CLI metadata or system tags — always hidden */
function isHiddenCommand(text: string): boolean {
  return text.includes('<local-command-caveat>') ||
    text.includes('<command-name>') ||
    text.includes('<task-notification>') ||
    text.includes('<system-reminder>') ||
    text.includes('<user-prompt-submit-hook>') ||
    text.includes('<available-deferred-tools>');
}

/** Strip system-injected tags from user/assistant text */
function stripSystemTags(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, '')
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, '')
    .replace(/<available-deferred-tools>[\s\S]*?<\/available-deferred-tools>/g, '')
    .trim();
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
            const cleaned = stripSystemTags(text);
            if (cleaned) {
              result.push({ role: 'user', content: cleaned, timestamp: ts });
            }
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

/**
 * Delete a session's JSONL file.
 * Returns true if the file was deleted, false if it didn't exist.
 */
export function deleteSession(workDir: string, sessionId: string): boolean {
  const projectsDir = getClaudeProjectsDir();
  const projectFolder = pathToProjectFolder(workDir);
  const filePath = join(projectsDir, projectFolder, `${sessionId}.jsonl`);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read lightweight conversation context from a session's JSONL file.
 * Extracts only user/assistant text from the last compact point (summary) onward,
 * stripping all tool_use/tool_result blocks. Used by BTW side questions to provide
 * conversation context without the full session history overhead.
 *
 * Returns null if the JSONL file doesn't exist or has no extractable content.
 */
export const CONTEXT_MAX_CHARS = 100_000;

export function readConversationContext(workDir: string, sessionId: string): string | null {
  const projectsDir = getClaudeProjectsDir();
  const projectFolder = pathToProjectFolder(workDir);
  const filePath = join(projectsDir, projectFolder, `${sessionId}.jsonl`);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    // Parse all lines, tracking the last summary position
    interface ParsedEntry {
      type: 'summary' | 'user' | 'assistant';
      text: string;
    }

    const entries: ParsedEntry[] = [];
    let lastSummaryIndex = -1;

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        // Summary entry (compact point)
        if (data.type === 'summary' && data.summary) {
          lastSummaryIndex = entries.length;
          entries.push({ type: 'summary', text: data.summary });
          continue;
        }

        // User messages — text only, skip hidden commands
        if (data.type === 'user' && data.message?.content) {
          const text = typeof data.message.content === 'string'
            ? data.message.content
            : data.message.content
                .filter((b: { type: string }) => b.type === 'text')
                .map((b: { text: string }) => b.text || '')
                .join('');

          if (!text.trim()) continue;
          if (isHiddenCommand(text)) continue;

          const cleaned = stripSystemTags(text);
          if (cleaned) {
            entries.push({ type: 'user', text: cleaned });
          }
          continue;
        }

        // Assistant messages — text blocks only, skip tool_use
        if (data.type === 'assistant' && data.message?.content && Array.isArray(data.message.content)) {
          const textParts: string[] = [];
          for (const block of data.message.content) {
            if (block.type === 'text' && block.text) {
              textParts.push(block.text);
            }
            // Skip tool_use blocks entirely
          }
          if (textParts.length > 0) {
            entries.push({ type: 'assistant', text: textParts.join('\n\n') });
          }
          continue;
        }

        // Skip everything else: tool_result, system, custom-title, etc.
      } catch { /* skip malformed lines */ }
    }

    // Start from the last summary (compact point), or from the beginning
    const startIndex = lastSummaryIndex >= 0 ? lastSummaryIndex : 0;
    const relevantEntries = entries.slice(startIndex);

    if (relevantEntries.length === 0) {
      return null;
    }

    // Format as readable dialogue
    const parts: string[] = [];
    for (const entry of relevantEntries) {
      switch (entry.type) {
        case 'summary':
          parts.push(`[Summary]\n${entry.text}`);
          break;
        case 'user':
          parts.push(`[User]\n${entry.text}`);
          break;
        case 'assistant':
          parts.push(`[Assistant]\n${entry.text}`);
          break;
      }
    }

    let formatted = parts.join('\n\n');

    // Truncate from the beginning if too large (keep most recent messages)
    if (formatted.length > CONTEXT_MAX_CHARS) {
      formatted = formatted.slice(-CONTEXT_MAX_CHARS);
      // Find the first complete section marker to avoid partial text
      const firstSectionIdx = formatted.indexOf('\n[');
      if (firstSectionIdx > 0) {
        formatted = formatted.slice(firstSectionIdx + 1); // skip the leading newline
      }
    }

    return formatted;
  } catch {
    return null;
  }
}

/**
 * Rename a session by appending a custom-title entry to its JSONL file.
 * This matches what Claude CLI's /rename command does.
 */
export function renameSession(workDir: string, sessionId: string, newTitle: string): boolean {
  const projectsDir = getClaudeProjectsDir();
  const projectFolder = pathToProjectFolder(workDir);
  const filePath = join(projectsDir, projectFolder, `${sessionId}.jsonl`);

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const entry = JSON.stringify({ type: 'custom-title', customTitle: newTitle });
    appendFileSync(filePath, '\n' + entry + '\n', 'utf-8');
    return true;
  } catch {
    return false;
  }
}
