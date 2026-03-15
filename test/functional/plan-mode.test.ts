/**
 * Plan Mode E2E tests
 *
 * Verifies that EnterPlanMode / ExitPlanMode tool_use messages render as
 * visual dividers (`.plan-mode-divider`) rather than regular tool blocks.
 *
 * Protocol: Regular `claude_output` with tool_use name "EnterPlanMode" / "ExitPlanMode"
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19882;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/plan-mode-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/plan-mode-test' });

  return { agent, page };
}

/** Send a chat message and consume it on the agent so we have an active turn. */
async function startTurn(agent: MockAgent, page: Page) {
  await page.click('textarea');
  await page.fill('textarea', 'test message');
  await page.click('.send-btn');
  await agent.waitForMessage((m) => m.type === 'chat', 3000);
}

/** Send a tool_use block from the agent. */
function sendToolUse(agent: MockAgent, name: string, id: string) {
  agent.sendEncrypted({
    type: 'claude_output',
    data: { type: 'tool_use', tools: [{ id, name, input: {} }] },
  });
}

/** Complete the current turn. */
function completeTurn(agent: MockAgent) {
  agent.sendEncrypted({ type: 'turn_completed' });
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

describe('Plan Mode', () => {
  it('TC-1: EnterPlanMode renders a plan-mode-divider (not a tool-line)', async () => {
    const { agent, page } = await setupTest('PlanMode1');
    try {
      await startTurn(agent, page);

      sendToolUse(agent, 'EnterPlanMode', 'tool_pm_enter');
      await page.waitForSelector('.plan-mode-divider', { timeout: 3000 });

      // Divider text should say "Entered Plan Mode"
      const text = await page.locator('.plan-mode-divider-text').textContent();
      expect(text).toContain('Entered Plan Mode');

      // Should NOT render as a regular tool-line
      const toolLines = await page.locator('.tool-line').count();
      expect(toolLines).toBe(0);

      completeTurn(agent);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-2: ExitPlanMode renders a plan-mode-divider', async () => {
    const { agent, page } = await setupTest('PlanMode2');
    try {
      await startTurn(agent, page);

      sendToolUse(agent, 'ExitPlanMode', 'tool_pm_exit');
      await page.waitForSelector('.plan-mode-divider', { timeout: 3000 });

      const text = await page.locator('.plan-mode-divider-text').textContent();
      expect(text).toContain('Exited Plan Mode');

      const toolLines = await page.locator('.tool-line').count();
      expect(toolLines).toBe(0);

      completeTurn(agent);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-3: regular tool + EnterPlanMode + regular tool renders divider between tool-lines', async () => {
    const { agent, page } = await setupTest('PlanMode3');
    try {
      await startTurn(agent, page);

      // Regular tool
      sendToolUse(agent, 'Read', 'tool_read1');
      await page.waitForSelector('.tool-line', { timeout: 3000 });

      // Plan mode divider
      sendToolUse(agent, 'EnterPlanMode', 'tool_pm');
      await page.waitForSelector('.plan-mode-divider', { timeout: 3000 });

      // Another regular tool
      sendToolUse(agent, 'Write', 'tool_write1');
      await delay(300);

      // Count elements
      const dividerCount = await page.locator('.plan-mode-divider').count();
      expect(dividerCount).toBe(1);

      const toolLineCount = await page.locator('.tool-line').count();
      expect(toolLineCount).toBe(2);

      completeTurn(agent);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
