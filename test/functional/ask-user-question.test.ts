/**
 * AskUserQuestion E2E tests
 *
 * Verifies the interactive question card flow:
 * - Rendering of question cards with options
 * - Single-select and multi-select behavior
 * - Custom text input
 * - Submit button enablement
 * - Answered state display
 *
 * Protocol:
 *   Agent → Web: { type: 'ask_user_question', requestId, questions: [...] }
 *   Web → Agent: { type: 'ask_user_answer', requestId, answers: { questionText: answer } }
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type ChildProcess } from 'child_process';
import { chromium, type Browser, type Page } from 'playwright';
import {
  type MockAgent,
  waitForServer, startServer, stopServer,
  connectMockAgentEncrypted, delay,
} from './e2e-helpers';

const PORT = 19881;
const BASE_URL = `http://localhost:${PORT}`;

let serverProc: ChildProcess;
let browser: Browser;

async function setupTest(agentName: string): Promise<{ agent: MockAgent; page: Page }> {
  const agent = await connectMockAgentEncrypted(PORT, agentName, '/ask-question-test');
  const page = await browser.newPage();
  await page.goto(`${BASE_URL}/s/${agent.sessionId}`);
  await page.waitForSelector('text=Connected', { timeout: 5000 });

  await agent.waitForMessage((m) => m.type === 'list_sessions');
  agent.sendEncrypted({ type: 'sessions_list', sessions: [], workDir: '/ask-question-test' });

  return { agent, page };
}

function sendAskQuestion(
  agent: MockAgent,
  requestId: string,
  questions: Array<{
    header: string;
    question: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>,
) {
  agent.sendEncrypted({ type: 'ask_user_question', requestId, questions });
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

describe('AskUserQuestion', () => {
  it('TC-1: single-select: click option → submit → agent receives answer → card shows answered', async () => {
    const { agent, page } = await setupTest('AskQ1');
    try {
      sendAskQuestion(agent, 'req-1', [{
        header: 'Auth',
        question: 'Which auth method?',
        options: [
          { label: 'OAuth', description: 'Use OAuth 2.0' },
          { label: 'JWT', description: 'Use JSON Web Tokens' },
        ],
        multiSelect: false,
      }]);

      // Card should appear
      await page.waitForSelector('.ask-question-card', { timeout: 3000 });

      // Click the first option (OAuth)
      await page.locator('.ask-question-option').first().click();

      // Option should be marked as selected
      const selectedCount = await page.locator('.ask-question-option.selected').count();
      expect(selectedCount).toBe(1);

      // Submit button should be enabled now
      const submitDisabled = await page.locator('.ask-question-submit').isDisabled();
      expect(submitDisabled).toBe(false);

      // Click submit
      await page.click('.ask-question-submit');

      // Agent should receive the answer
      const answerMsg = await agent.waitForMessage(
        (m) => m.type === 'ask_user_answer' && m.requestId === 'req-1',
        3000,
      );
      expect(answerMsg).not.toBeNull();
      const answers = answerMsg.answers as Record<string, string>;
      expect(answers['Which auth method?']).toBe('OAuth');

      // Card should show answered state
      await page.waitForSelector('.ask-question-answered', { timeout: 2000 });
      const answeredText = await page.locator('.ask-answered-text').textContent();
      expect(answeredText).toContain('OAuth');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-2: multi-select: click 2 options → submit → agent receives comma-joined answer', async () => {
    const { agent, page } = await setupTest('AskQ2');
    try {
      sendAskQuestion(agent, 'req-2', [{
        header: 'Features',
        question: 'Which features to enable?',
        options: [
          { label: 'Dark mode', description: 'Enable dark theme' },
          { label: 'Notifications', description: 'Push notifications' },
          { label: 'Analytics', description: 'Usage analytics' },
        ],
        multiSelect: true,
      }]);

      await page.waitForSelector('.ask-question-card', { timeout: 3000 });

      // Click first and third options
      const options = page.locator('.ask-question-option');
      await options.nth(0).click();
      await options.nth(2).click();

      // Both should be selected
      const selectedCount = await page.locator('.ask-question-option.selected').count();
      expect(selectedCount).toBe(2);

      // Submit
      await page.click('.ask-question-submit');

      const answerMsg = await agent.waitForMessage(
        (m) => m.type === 'ask_user_answer' && m.requestId === 'req-2',
        3000,
      );
      const answers = answerMsg.answers as Record<string, string>;
      // Multi-select joins with ", "
      expect(answers['Which features to enable?']).toContain('Dark mode');
      expect(answers['Which features to enable?']).toContain('Analytics');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-3: custom text: type in input → submit → agent receives custom text', async () => {
    const { agent, page } = await setupTest('AskQ3');
    try {
      sendAskQuestion(agent, 'req-3', [{
        header: 'Tool',
        question: 'Which testing framework?',
        options: [
          { label: 'Jest', description: 'Facebook Jest' },
          { label: 'Vitest', description: 'Vite-native testing' },
        ],
        multiSelect: false,
      }]);

      await page.waitForSelector('.ask-question-card', { timeout: 3000 });

      // Type custom text
      await page.fill('.ask-question-custom input', 'Mocha + Chai');

      // Submit
      await page.click('.ask-question-submit');

      const answerMsg = await agent.waitForMessage(
        (m) => m.type === 'ask_user_answer' && m.requestId === 'req-3',
        3000,
      );
      const answers = answerMsg.answers as Record<string, string>;
      expect(answers['Which testing framework?']).toBe('Mocha + Chai');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-4: submit is disabled when no selection', async () => {
    const { agent, page } = await setupTest('AskQ4');
    try {
      sendAskQuestion(agent, 'req-4', [{
        header: 'DB',
        question: 'Which database?',
        options: [
          { label: 'PostgreSQL', description: 'Relational DB' },
          { label: 'MongoDB', description: 'Document DB' },
        ],
        multiSelect: false,
      }]);

      await page.waitForSelector('.ask-question-card', { timeout: 3000 });

      // Submit should be disabled initially
      const submitDisabled = await page.locator('.ask-question-submit').isDisabled();
      expect(submitDisabled).toBe(true);

      // Click an option
      await page.locator('.ask-question-option').first().click();

      // Now submit should be enabled
      const submitEnabled = await page.locator('.ask-question-submit').isDisabled();
      expect(submitEnabled).toBe(false);
    } finally {
      await page.close();
      agent.ws.close();
    }
  });

  it('TC-5: answered summary shows selected option label', async () => {
    const { agent, page } = await setupTest('AskQ5');
    try {
      sendAskQuestion(agent, 'req-5', [{
        header: 'Style',
        question: 'CSS approach?',
        options: [
          { label: 'Tailwind', description: 'Utility-first CSS' },
          { label: 'CSS Modules', description: 'Scoped CSS' },
        ],
        multiSelect: false,
      }]);

      await page.waitForSelector('.ask-question-card', { timeout: 3000 });

      // Select second option
      await page.locator('.ask-question-option').nth(1).click();
      await page.click('.ask-question-submit');

      // Wait for answered state
      await page.waitForSelector('.ask-question-answered', { timeout: 2000 });

      // Summary should show the selected label
      const summaryText = await page.locator('.ask-answered-text').textContent();
      expect(summaryText).toContain('CSS Modules');
    } finally {
      await page.close();
      agent.ws.close();
    }
  });
});
