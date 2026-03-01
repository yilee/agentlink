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
const { listSessions, readSessionMessages } = await import('../../agent/src/history.js');

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
});
