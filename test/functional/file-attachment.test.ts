/**
 * File Attachment E2E tests
 *
 * Verifies that file attachments can be added, removed, and sent with chat messages.
 *
 * Protocol:
 *   Web → Agent: { type: 'chat', prompt, files: [{ name, mimeType, data }] }
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19883;
const BASE_URL = `http://localhost:${PORT}`;
const TEMP_DIR = join(__dirname, '.tmp-attachments');

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/file-attach-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/file-attach-test' });

  return { agent, page };
}

beforeAll(async () => {
  // Create temp fixture files
  mkdirSync(TEMP_DIR, { recursive: true });
  writeFileSync(join(TEMP_DIR, 'test1.txt'), 'Hello file 1');
  writeFileSync(join(TEMP_DIR, 'test2.txt'), 'Hello file 2');
  writeFileSync(join(TEMP_DIR, 'test3.json'), '{"key":"value"}');

  serverProc = startServer(PORT);
  await waitForServer(PORT);
  browser = await chromium.launch({ headless: true });
}, 15000);

afterAll(async () => {
  if (browser) await browser.close();
  await stopServer(serverProc);
  try { rmSync(TEMP_DIR, { recursive: true }); } catch { /* ignore */ }
});

describe('File Attachment', () => {
  it('TC-1: attach file → chip appears → send → agent receives files[] in chat', async () => {
    const { agent, page } = await setupTest('FileAttach1');
    try {
      // Attach a file via the hidden file input
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(join(TEMP_DIR, 'test1.txt'));

      // Attachment chip should appear
      await page.waitForSelector('.attachment-chip', { timeout: 3000 });
      const chipCount = await page.locator('.attachment-chip').count();
      expect(chipCount).toBe(1);

      // File name should be visible
      const fileName = await page.locator('.attachment-name').textContent();
      expect(fileName).toContain('test1.txt');

      // Type a message and send
      await page.fill('textarea', 'check this file');
      await page.click('.send-btn');

      // Agent should receive chat with files
      const chatMsg = await agent.waitForMessage(
        (m) => m.type === 'chat' && Array.isArray(m.files) && (m.files as Array<Record<string, unknown>>).length > 0,
        3000,
      );
      expect(chatMsg.prompt).toBe('check this file');
      const files = chatMsg.files as Array<{ name: string; mimeType: string; data: string }>;
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('test1.txt');
      expect(files[0].data).toBeTruthy(); // base64 data
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-2: remove attachment chip → chip disappears', async () => {
    const { agent, page } = await setupTest('FileAttach2');
    try {
      // Attach a file
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(join(TEMP_DIR, 'test1.txt'));
      await page.waitForSelector('.attachment-chip', { timeout: 3000 });

      // Click the remove button
      await page.click('.attachment-remove');
      await delay(200);

      // Chip should be gone
      const chipCount = await page.locator('.attachment-chip').count();
      expect(chipCount).toBe(0);

      // Attachment bar should also be gone (or empty)
      const barCount = await page.locator('.attachment-bar').count();
      // Bar might still exist but be empty, or not exist at all
      if (barCount > 0) {
        const barChildren = await page.locator('.attachment-bar .attachment-chip').count();
        expect(barChildren).toBe(0);
      }
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-3: multiple files → both chips show → send → both in files[]', async () => {
    const { agent, page } = await setupTest('FileAttach3');
    try {
      // Attach two files at once
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles([
        join(TEMP_DIR, 'test1.txt'),
        join(TEMP_DIR, 'test2.txt'),
      ]);

      // Both chips should appear
      await page.waitForSelector('.attachment-chip', { timeout: 3000 });
      const chipCount = await page.locator('.attachment-chip').count();
      expect(chipCount).toBe(2);

      // Send with message
      await page.fill('textarea', 'two files here');
      await page.click('.send-btn');

      const chatMsg = await agent.waitForMessage(
        (m) => m.type === 'chat' && Array.isArray(m.files) && (m.files as Array<Record<string, unknown>>).length === 2,
        3000,
      );
      const files = chatMsg.files as Array<{ name: string }>;
      expect(files).toHaveLength(2);
      const names = files.map((f) => f.name).sort();
      expect(names).toEqual(['test1.txt', 'test2.txt']);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-4: files-only send (no text) → user bubble shows file attachment info', async () => {
    const { agent, page } = await setupTest('FileAttach4');
    try {
      // Attach file without typing a message
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(join(TEMP_DIR, 'test3.json'));
      await page.waitForSelector('.attachment-chip', { timeout: 3000 });

      // Send with empty message
      await page.click('.send-btn');

      // Agent should still receive the chat with files
      const chatMsg = await agent.waitForMessage(
        (m) => m.type === 'chat' && Array.isArray(m.files) && (m.files as Array<Record<string, unknown>>).length > 0,
        3000,
      );
      const files = chatMsg.files as Array<{ name: string }>;
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('test3.json');

      // User message bubble should appear indicating files attached
      await page.waitForSelector('.user-bubble', { timeout: 2000 });
      const userMsgText = await page.locator('.user-bubble').textContent();
      expect(userMsgText).toContain('file');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
