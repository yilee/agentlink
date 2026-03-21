import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock os.homedir() before importing history module
const tempHome = join(tmpdir(), `agentlink-test-history-${process.pid}`);

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => tempHome };
});

// Import after mock is set up
const { listSessions, readSessionMessages, readConversationContext, CONTEXT_MAX_CHARS } = await import('../../agent/src/history.js');

// Test work directory and its JSONL folder
const TEST_WORK_DIR = process.platform === 'win32' ? 'C:\\test\\project' : '/test/project';
const PROJECT_FOLDER = process.platform === 'win32' ? 'C--test-project' : '-test-project';

function projectDir(): string {
  return join(tempHome, '.claude', 'projects', PROJECT_FOLDER);
}

function writeJsonl(sessionId: string, lines: unknown[], mtimeMs?: number): void {
  const dir = projectDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${sessionId}.jsonl`);
  writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  if (mtimeMs) {
    const t = new Date(mtimeMs);
    utimesSync(filePath, t, t);
  }
}

beforeEach(() => {
  mkdirSync(projectDir(), { recursive: true });
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
});

describe('History', () => {
  describe('listSessions', () => {
    it('returns empty for non-existent directory', () => {
      rmSync(tempHome, { recursive: true, force: true });
      expect(listSessions(TEST_WORK_DIR)).toEqual([]);
    });

    it('lists sessions sorted by mtime descending', () => {
      writeJsonl('session-old', [
        { type: 'user', message: { content: 'old message' } },
      ], Date.now() - 100_000);
      writeJsonl('session-new', [
        { type: 'user', message: { content: 'new message' } },
      ], Date.now());

      const sessions = listSessions(TEST_WORK_DIR);
      expect(sessions.length).toBe(2);
      expect(sessions[0].sessionId).toBe('session-new');
      expect(sessions[1].sessionId).toBe('session-old');
    });

    it('uses custom-title over summary over first user message', () => {
      writeJsonl('s1', [
        { type: 'user', message: { content: 'first msg' } },
        { type: 'custom-title', customTitle: 'My Custom Title' },
        { type: 'summary', summary: 'A summary' },
      ]);
      const sessions = listSessions(TEST_WORK_DIR);
      expect(sessions[0].title).toBe('My Custom Title');
    });

    it('falls back to summary when no custom title', () => {
      writeJsonl('s2', [
        { type: 'user', message: { content: 'msg' } },
        { type: 'summary', summary: 'Summary text' },
      ]);
      const sessions = listSessions(TEST_WORK_DIR);
      expect(sessions[0].title).toBe('Summary text');
    });

    it('skips sessions with only hidden commands', () => {
      writeJsonl('s-hidden', [
        { type: 'user', message: { content: '<command-name>compact</command-name>' } },
      ]);
      expect(listSessions(TEST_WORK_DIR)).toEqual([]);
    });

    it('handles paths with dots and special characters', () => {
      // Simulate a path like C:\Users\user.DOMAIN\Desktop\project
      const dotDir = process.platform === 'win32'
        ? 'C:\\Users\\user.DOMAIN\\project'
        : '/home/user.name/project';
      const dotFolder = process.platform === 'win32'
        ? 'C--Users-user-DOMAIN-project'
        : '-home-user-name-project';
      const dir = join(tempHome, '.claude', 'projects', dotFolder);
      mkdirSync(dir, { recursive: true });
      const filePath = join(dir, 'dot-session.jsonl');
      writeFileSync(filePath, JSON.stringify({ type: 'user', message: { content: 'hello from dot path' } }) + '\n');

      const sessions = listSessions(dotDir);
      expect(sessions.length).toBe(1);
      expect(sessions[0].sessionId).toBe('dot-session');
    });
  });

  describe('readSessionMessages', () => {
    it('returns empty for non-existent file', () => {
      expect(readSessionMessages(TEST_WORK_DIR, 'nonexistent')).toEqual([]);
    });

    it('parses user text (string format)', () => {
      writeJsonl('s-str', [
        { type: 'user', message: { content: 'hello world' } },
      ]);
      const msgs = readSessionMessages(TEST_WORK_DIR, 's-str');
      expect(msgs.length).toBe(1);
      expect(msgs[0]).toMatchObject({ role: 'user', content: 'hello world' });
    });

    it('parses user text (array format)', () => {
      writeJsonl('s-arr', [
        { type: 'user', message: { content: [{ type: 'text', text: 'part1' }, { type: 'text', text: 'part2' }] } },
      ]);
      const msgs = readSessionMessages(TEST_WORK_DIR, 's-arr');
      expect(msgs[0].content).toBe('part1part2');
    });

    it('merges assistant text blocks and extracts tool_use', () => {
      writeJsonl('s-asst', [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Hello' },
              { type: 'text', text: 'World' },
              { type: 'tool_use', name: 'Read', input: { file: 'a.txt' }, id: 'tool-1' },
            ],
          },
        },
      ]);
      const msgs = readSessionMessages(TEST_WORK_DIR, 's-asst');
      expect(msgs.length).toBe(2); // text + tool
      expect(msgs[0]).toMatchObject({ role: 'assistant', content: 'Hello\n\nWorld' });
      expect(msgs[1]).toMatchObject({ role: 'tool', toolName: 'Read', toolId: 'tool-1' });
    });

    it('filters hidden commands', () => {
      writeJsonl('s-cmd', [
        { type: 'user', message: { content: '<local-command-caveat>hidden</local-command-caveat>' } },
        { type: 'user', message: { content: 'visible' } },
      ]);
      const msgs = readSessionMessages(TEST_WORK_DIR, 's-cmd');
      expect(msgs.length).toBe(1);
      expect(msgs[0].content).toBe('visible');
    });

    it('extracts command output from stdout tags', () => {
      writeJsonl('s-stdout', [
        { type: 'user', message: { content: 'prefix <local-command-stdout>output text</local-command-stdout> suffix' } },
      ]);
      const msgs = readSessionMessages(TEST_WORK_DIR, 's-stdout');
      expect(msgs[0]).toMatchObject({ role: 'user', content: 'output text', isCommandOutput: true });
    });
  });

  describe('readConversationContext', () => {
    it('returns null for non-existent session file', () => {
      expect(readConversationContext(TEST_WORK_DIR, 'nonexistent')).toBeNull();
    });

    it('returns null for empty session file', () => {
      writeJsonl('ctx-empty', []);
      expect(readConversationContext(TEST_WORK_DIR, 'ctx-empty')).toBeNull();
    });

    it('extracts user and assistant text, skips tool_use blocks', () => {
      writeJsonl('ctx-basic', [
        { type: 'user', message: { content: 'What is X?' } },
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Let me check.' },
              { type: 'tool_use', name: 'Read', input: { file: 'x.ts' }, id: 't1' },
            ],
          },
        },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file content' }] } },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'X is a variable.' }] },
        },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-basic');
      expect(ctx).not.toBeNull();
      expect(ctx).toContain('[User]\nWhat is X?');
      expect(ctx).toContain('[Assistant]\nLet me check.');
      expect(ctx).toContain('[Assistant]\nX is a variable.');
      // Should NOT contain tool_use or tool_result content
      expect(ctx).not.toContain('Read');
      expect(ctx).not.toContain('file content');
      expect(ctx).not.toContain('tool_use');
    });

    it('starts from the last summary (compact point)', () => {
      writeJsonl('ctx-compact', [
        { type: 'user', message: { content: 'Old message before compact' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Old reply' }] } },
        { type: 'summary', summary: 'Conversation so far: discussed X and Y.' },
        { type: 'user', message: { content: 'New message after compact' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'New reply' }] } },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-compact');
      expect(ctx).not.toBeNull();
      expect(ctx).toContain('[Summary]\nConversation so far: discussed X and Y.');
      expect(ctx).toContain('[User]\nNew message after compact');
      expect(ctx).toContain('[Assistant]\nNew reply');
      // Pre-compact messages should NOT appear
      expect(ctx).not.toContain('Old message before compact');
      expect(ctx).not.toContain('Old reply');
    });

    it('uses the last summary when multiple summaries exist', () => {
      writeJsonl('ctx-multi-compact', [
        { type: 'summary', summary: 'First summary' },
        { type: 'user', message: { content: 'After first compact' } },
        { type: 'summary', summary: 'Second summary' },
        { type: 'user', message: { content: 'After second compact' } },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-multi-compact');
      expect(ctx).not.toBeNull();
      expect(ctx).toContain('[Summary]\nSecond summary');
      expect(ctx).toContain('[User]\nAfter second compact');
      expect(ctx).not.toContain('First summary');
      expect(ctx).not.toContain('After first compact');
    });

    it('includes all messages from the start when no summary exists', () => {
      writeJsonl('ctx-no-summary', [
        { type: 'user', message: { content: 'First question' } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'First answer' }] } },
        { type: 'user', message: { content: 'Second question' } },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-no-summary');
      expect(ctx).toContain('[User]\nFirst question');
      expect(ctx).toContain('[Assistant]\nFirst answer');
      expect(ctx).toContain('[User]\nSecond question');
    });

    it('skips messages containing system tags (isHiddenCommand)', () => {
      writeJsonl('ctx-tags', [
        { type: 'user', message: { content: '<system-reminder>some reminder</system-reminder>' } },
        { type: 'user', message: { content: 'Visible message' } },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-tags');
      expect(ctx).not.toBeNull();
      expect(ctx).toContain('Visible message');
      expect(ctx).not.toContain('system-reminder');
    });

    it('skips hidden command messages', () => {
      writeJsonl('ctx-hidden', [
        { type: 'user', message: { content: '<command-name>compact</command-name>' } },
        { type: 'user', message: { content: 'Visible message' } },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-hidden');
      expect(ctx).not.toBeNull();
      expect(ctx).toContain('Visible message');
      expect(ctx).not.toContain('compact');
    });

    it('handles user content in array format', () => {
      writeJsonl('ctx-array', [
        { type: 'user', message: { content: [{ type: 'text', text: 'Part A ' }, { type: 'text', text: 'Part B' }] } },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-array');
      expect(ctx).toContain('Part A Part B');
    });

    it('truncates from the beginning when exceeding max chars', () => {
      // Create a session with many messages that exceed the limit
      const entries: unknown[] = [];
      const msgSize = 1000;
      const msgCount = Math.ceil(CONTEXT_MAX_CHARS / msgSize) + 10;
      for (let i = 0; i < msgCount; i++) {
        entries.push({ type: 'user', message: { content: `Message-${i}: ${'x'.repeat(msgSize)}` } });
        entries.push({ type: 'assistant', message: { content: [{ type: 'text', text: `Reply-${i}: ${'y'.repeat(msgSize)}` }] } });
      }
      writeJsonl('ctx-truncate', entries);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-truncate');
      expect(ctx).not.toBeNull();
      expect(ctx!.length).toBeLessThanOrEqual(CONTEXT_MAX_CHARS);
      // Should start at a section boundary (not mid-text)
      expect(ctx!.startsWith('[')).toBe(true);
      // Recent messages should be present, old ones truncated
      expect(ctx).toContain(`Message-${msgCount - 1}`);
    });

    it('returns null when session has only tool_result entries', () => {
      writeJsonl('ctx-tools-only', [
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'result' }] } },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-tools-only');
      expect(ctx).toBeNull();
    });

    it('merges multiple text blocks in assistant messages', () => {
      writeJsonl('ctx-multi-text', [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Part 1' },
              { type: 'text', text: 'Part 2' },
            ],
          },
        },
      ]);

      const ctx = readConversationContext(TEST_WORK_DIR, 'ctx-multi-text');
      expect(ctx).toContain('[Assistant]\nPart 1\n\nPart 2');
    });
  });
});
