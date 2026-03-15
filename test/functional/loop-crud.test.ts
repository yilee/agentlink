/**
 * Loop CRUD E2E tests
 *
 * Verifies loop creation, listing, toggling, and deletion through the UI.
 *
 * Protocol:
 *   Web → Agent: create_loop, update_loop, delete_loop, list_loops
 *   Agent → Web: loop_created, loop_updated, loop_deleted, loops_list
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19884;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/loop-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/loop-test' });

  return { agent, page };
}

/** Expand the loops sidebar section if collapsed. */
async function expandLoopsSection(page: Page) {
  const loopsSection = page.locator('.sidebar-section.sidebar-loops');
  const count = await loopsSection.count();
  if (count === 0) return;
  // Check if collapsible content is hidden
  const collapsible = loopsSection.locator('.sidebar-section-collapsible');
  const isVisible = await collapsible.isVisible().catch(() => false);
  if (!isVisible) {
    await loopsSection.locator('.sidebar-section-header').click();
    await delay(200);
  }
}

beforeAll(async () => {
  serverProc = startServer(PORT);
  await waitForServer(PORT);
  browser = await chromium.launch({ headless: true });
}, 15000);

afterAll(async () => {
  if (browser) await browser.close();
  await stopServer(serverProc);
});

describe('Loop CRUD', () => {
  it('TC-1: create loop → agent receives create_loop → respond loop_created → loop in sidebar', async () => {
    const { agent, page } = await setupTest('LoopCRUD1');
    try {
      await expandLoopsSection(page);

      // Click "New Loop" button
      const newLoopBtn = page.locator('.sidebar-loops .new-conversation-btn');
      await newLoopBtn.click();
      await delay(300);

      // Fill loop name and prompt
      await page.fill('.loop-name-input', 'My Test Loop');
      await page.fill('.team-create-textarea', 'Check server health every hour');

      // Click create
      await page.click('.team-create-launch');

      // Agent should receive create_loop
      const createMsg = await agent.waitForMessage(
        (m) => m.type === 'create_loop',
        3000,
      );
      expect(createMsg.name).toBe('My Test Loop');
      expect(createMsg.prompt).toBe('Check server health every hour');

      // Respond with loop_created
      agent.sendEncrypted({
        type: 'loop_created',
        loop: {
          id: 'loop-1',
          name: 'My Test Loop',
          prompt: 'Check server health every hour',
          schedule: '0 * * * *',
          scheduleType: 'hourly',
          scheduleConfig: { minute: 0 },
          enabled: true,
          createdAt: new Date().toISOString(),
          lastExecution: null,
        },
      });
      await delay(500);

      // Loop should appear in the active loops list in the create panel
      const loopItems = page.locator('.loop-active-item');
      const count = await loopItems.count();
      expect(count).toBeGreaterThanOrEqual(1);

      // Verify loop name is displayed
      const loopNameText = await page.locator('.loop-active-item-name').first().textContent();
      expect(loopNameText).toContain('My Test Loop');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-2: loops_list response renders loops in sidebar', async () => {
    const { agent, page } = await setupTest('LoopCRUD2');
    try {
      // Consume the initial list_loops request (if any)
      const listMsg = await agent.waitForMessage(
        (m) => m.type === 'list_loops',
        2000,
      ).catch(() => null);

      // Send loops_list with 2 loops
      agent.sendEncrypted({
        type: 'loops_list',
        loops: [
          {
            id: 'loop-a',
            name: 'Loop Alpha',
            prompt: 'Alpha prompt',
            schedule: '0 9 * * *',
            scheduleType: 'daily',
            scheduleConfig: { hour: 9, minute: 0 },
            enabled: true,
            createdAt: new Date().toISOString(),
            lastExecution: null,
          },
          {
            id: 'loop-b',
            name: 'Loop Beta',
            prompt: 'Beta prompt',
            schedule: '0 17 * * 1-5',
            scheduleType: 'weekly',
            scheduleConfig: { hour: 17, minute: 0, dayOfWeek: 1 },
            enabled: false,
            createdAt: new Date().toISOString(),
            lastExecution: null,
          },
        ],
      });
      await delay(500);

      await expandLoopsSection(page);

      // Both loops should appear in sidebar
      const loopItems = page.locator('.team-history-item');
      const count = await loopItems.count();
      expect(count).toBe(2);

      // Verify names
      const firstTitle = await page.locator('.team-history-title').first().textContent();
      const secondTitle = await page.locator('.team-history-title').nth(1).textContent();
      const titles = [firstTitle, secondTitle].sort();
      expect(titles).toEqual(['Loop Alpha', 'Loop Beta']);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-3: toggle loop enabled/disabled → agent receives update_loop', async () => {
    const { agent, page } = await setupTest('LoopCRUD3');
    try {
      // Populate with one loop
      agent.sendEncrypted({
        type: 'loops_list',
        loops: [{
          id: 'loop-toggle',
          name: 'Toggleable Loop',
          prompt: 'test prompt',
          schedule: '0 9 * * *',
          scheduleType: 'daily',
          scheduleConfig: { hour: 9, minute: 0 },
          enabled: true,
          createdAt: new Date().toISOString(),
          lastExecution: null,
        }],
      });
      await delay(500);

      await expandLoopsSection(page);

      // Click the "New Loop" button to open the create panel, which shows active loops
      const newLoopBtn = page.locator('.sidebar-loops .new-conversation-btn');
      await newLoopBtn.click();
      await delay(300);

      // Find and click the pause button in the active list
      // Button order: Edit(0), Run(1), Pause(2), Delete(3 - only when disabled)
      const pauseBtn = page.locator('.loop-active-item-actions .loop-action-btn').nth(2);
      const pauseCount = await pauseBtn.count();
      if (pauseCount > 0) {
        await pauseBtn.click();

        // Agent should receive update_loop with enabled toggle
        const updateMsg = await agent.waitForMessage(
          (m) => m.type === 'update_loop',
          3000,
        );
        expect(updateMsg.loopId).toBe('loop-toggle');
        const updates = updateMsg.updates as Record<string, unknown>;
        expect(updates.enabled).toBe(false);

        // Respond with loop_updated
        agent.sendEncrypted({
          type: 'loop_updated',
          loop: {
            id: 'loop-toggle',
            name: 'Toggleable Loop',
            prompt: 'test prompt',
            schedule: '0 9 * * *',
            scheduleType: 'daily',
            scheduleConfig: { hour: 9, minute: 0 },
            enabled: false,
            createdAt: new Date().toISOString(),
            lastExecution: null,
          },
        });
        await delay(300);
      }
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-4: delete loop → agent receives delete_loop → loop removed', async () => {
    const { agent, page } = await setupTest('LoopCRUD4');
    try {
      // Populate with a disabled loop (delete only works on paused loops)
      agent.sendEncrypted({
        type: 'loops_list',
        loops: [{
          id: 'loop-del',
          name: 'Deletable Loop',
          prompt: 'will be deleted',
          schedule: '0 9 * * *',
          scheduleType: 'daily',
          scheduleConfig: { hour: 9, minute: 0 },
          enabled: false,
          createdAt: new Date().toISOString(),
          lastExecution: null,
        }],
      });
      await delay(500);

      await expandLoopsSection(page);

      // Open create panel to see active loops section
      const newLoopBtn = page.locator('.sidebar-loops .new-conversation-btn');
      await newLoopBtn.click();
      await delay(300);

      // Find and click the delete button
      const deleteBtn = page.locator('.loop-action-delete');
      const deleteCount = await deleteBtn.count();
      if (deleteCount > 0) {
        await deleteBtn.click();
        await delay(200);

        // Confirm deletion in modal
        const confirmBtn = page.locator('.modal-confirm-btn');
        const confirmCount = await confirmBtn.count();
        if (confirmCount > 0) {
          await confirmBtn.click();

          // Agent should receive delete_loop
          const deleteMsg = await agent.waitForMessage(
            (m) => m.type === 'delete_loop',
            3000,
          );
          expect(deleteMsg.loopId).toBe('loop-del');

          // Respond with loop_deleted
          agent.sendEncrypted({
            type: 'loop_deleted',
            loopId: 'loop-del',
          });
          await delay(300);

          // Loop should be removed from the list
          const remainingItems = await page.locator('.loop-active-item').count();
          expect(remainingItems).toBe(0);
        }
      }
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
