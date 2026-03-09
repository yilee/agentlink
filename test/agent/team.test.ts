/**
 * Tests for team.ts state management functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Use a temp directory for team persistence tests
// NOTE: vi.mock is hoisted, so we use a static expression inside the factory
vi.mock('../../agent/src/config.js', () => {
  const path = require('path');
  const os = require('os');
  return {
    CONFIG_DIR: path.join(os.tmpdir(), `agentlink-team-test-${process.pid}`),
  };
});

// Resolve the same path for test cleanup
const TEST_CONFIG_DIR = join(tmpdir(), `agentlink-team-test-${process.pid}`);

import {
  createTeamState,
  clearActiveTeam,
  getActiveTeam,
  registerSubagent,
  linkSubagentTaskId,
  findAgentByToolUseId,
  findAgentByTaskId,
  addAgentMessage,
  addFeedEntry,
  updateTaskStatus,
  allSubagentsDone,
  serializeTeam,
  buildAgentsDef,
  buildLeadPrompt,
  onLeadOutput,
  setTeamSendFn,
  setTeamClaudeFns,
  persistTeam,
  loadTeam,
  listTeams,
  deleteTeam,
  flushPendingPersists,
  persistTeamDebounced,
  createTeam,
  dissolveTeam,
  completeTeam,
  type TeamConfig,
  type TeamState,
} from '../../agent/src/team.js';

describe('team.ts state management', () => {
  let team: TeamState;
  const config: TeamConfig = {
    instruction: 'Review all code in agent/src/',
    template: 'code-review',
  };

  beforeEach(() => {
    clearActiveTeam();
    team = createTeamState(config, 'conv-team-1', '/test/workdir');
  });

  describe('createTeamState', () => {
    it('creates team with correct initial state', () => {
      expect(team.teamId).toBeTruthy();
      expect(team.title).toBe('Review all code in agent/src/');
      expect(team.config).toEqual(config);
      expect(team.conversationId).toBe('conv-team-1');
      expect(team.status).toBe('planning');
      expect(team.agents.size).toBe(1); // Lead
      expect(team.agents.get('lead')?.role.name).toBe('Lead');
      expect(team.tasks).toHaveLength(0);
      expect(team.feed).toHaveLength(1); // Initial "Lead is analyzing..." entry
      expect(team.summary).toBeNull();
      expect(team.totalCost).toBe(0);
    });

    it('truncates long titles', () => {
      clearActiveTeam();
      const longConfig: TeamConfig = {
        instruction: 'A'.repeat(100),
      };
      const t = createTeamState(longConfig, 'conv-2', '/test/workdir');
      expect(t.title).toHaveLength(60);
      expect(t.title.endsWith('...')).toBe(true);
    });

    it('sets active team', () => {
      expect(getActiveTeam()).toBe(team);
    });

    it('throws if team already active', () => {
      expect(() => createTeamState(config, 'conv-3', '/test/workdir')).toThrow('already active');
    });
  });

  describe('clearActiveTeam', () => {
    it('clears the active team', () => {
      clearActiveTeam();
      expect(getActiveTeam()).toBeNull();
    });
  });

  describe('registerSubagent', () => {
    it('adds a subagent with correct fields', () => {
      const agent = registerSubagent(team, 'tool-use-1', {
        name: 'Security Reviewer',
        description: 'Reviews security',
        prompt: 'Check for vulnerabilities',
      });

      expect(agent.role.id).toBe('security-reviewer');
      expect(agent.role.name).toBe('Agent 2');
      expect(agent.role.color).toBeTruthy();
      expect(agent.toolUseId).toBe('tool-use-1');
      expect(agent.status).toBe('starting');
      expect(team.agents.size).toBe(2); // Lead + new
    });

    it('auto-creates a task for the agent', () => {
      registerSubagent(team, 'tool-use-1', { name: 'Tester' });

      expect(team.tasks).toHaveLength(1);
      expect(team.tasks[0].title).toBe('Tester'); // task title from input.name
      expect(team.tasks[0].assignee).toBe('tester');
      expect(team.tasks[0].toolUseId).toBe('tool-use-1');
      expect(team.tasks[0].status).toBe('pending');
    });

    it('transitions team from planning to running', () => {
      expect(team.status).toBe('planning');
      registerSubagent(team, 'tool-use-1', { name: 'Agent1' });
      expect(team.status).toBe('running');
    });

    it('assigns unique colors to agents', () => {
      const a1 = registerSubagent(team, 'tu-1', { name: 'A1' });
      const a2 = registerSubagent(team, 'tu-2', { name: 'A2' });
      expect(a1.role.color).not.toBe(a2.role.color);
    });
  });

  describe('linkSubagentTaskId', () => {
    it('links task_id to agent and updates task status', () => {
      registerSubagent(team, 'tool-use-1', { name: 'Worker' });
      const agent = linkSubagentTaskId(team, 'tool-use-1', 'native-task-id-1');

      expect(agent).not.toBeNull();
      expect(agent!.agentTaskId).toBe('native-task-id-1');
      expect(agent!.status).toBe('working');
      expect(team.tasks[0].agentTaskId).toBe('native-task-id-1');
      expect(team.tasks[0].status).toBe('active');
    });

    it('returns null for unknown toolUseId', () => {
      expect(linkSubagentTaskId(team, 'unknown', 'tid')).toBeNull();
    });
  });

  describe('findAgentByToolUseId', () => {
    it('finds agent by tool use ID', () => {
      registerSubagent(team, 'tu-abc', { name: 'Finder' });
      const found = findAgentByToolUseId(team, 'tu-abc');
      expect(found?.role.id).toBe('finder');
    });

    it('returns null for unknown', () => {
      expect(findAgentByToolUseId(team, 'nope')).toBeNull();
    });
  });

  describe('findAgentByTaskId', () => {
    it('finds agent by native task ID', () => {
      registerSubagent(team, 'tu-1', { name: 'Searcher' });
      linkSubagentTaskId(team, 'tu-1', 'native-123');
      const found = findAgentByTaskId(team, 'native-123');
      expect(found?.role.id).toBe('searcher');
    });
  });

  describe('addAgentMessage', () => {
    it('adds message to agent list with incrementing IDs', () => {
      const agent = registerSubagent(team, 'tu-1', { name: 'Talker' });
      const m1 = addAgentMessage(agent, 'assistant', { content: 'hello' });
      const m2 = addAgentMessage(agent, 'tool', { toolName: 'Read', toolInput: '/tmp/a.txt' });

      expect(agent.messages).toHaveLength(2);
      expect(m1.id).toBeLessThan(m2.id);
      expect(m1.role).toBe('assistant');
      expect(m2.toolName).toBe('Read');
    });
  });

  describe('addFeedEntry', () => {
    it('adds feed entries', () => {
      const initialFeedLen = team.feed.length;
      addFeedEntry(team, 'lead', 'status_change', 'Team planning started');
      expect(team.feed).toHaveLength(initialFeedLen + 1);
      const added = team.feed[team.feed.length - 1];
      expect(added.agentId).toBe('lead');
      expect(added.type).toBe('status_change');
    });

    it('caps feed at 200 entries', () => {
      for (let i = 0; i < 210; i++) {
        addFeedEntry(team, 'lead', 'tool_call', `Entry ${i}`);
      }
      expect(team.feed).toHaveLength(200);
      // Should keep the latest entries
      expect(team.feed[0].content).toBe('Entry 10');
    });
  });

  describe('updateTaskStatus', () => {
    it('updates task status', () => {
      registerSubagent(team, 'tu-1', { name: 'Worker' });
      const task = updateTaskStatus(team, team.tasks[0].id, 'done');
      expect(task?.status).toBe('done');
    });

    it('returns null for unknown task', () => {
      expect(updateTaskStatus(team, 'nonexistent', 'done')).toBeNull();
    });
  });

  describe('allSubagentsDone', () => {
    it('returns false when no subagents', () => {
      expect(allSubagentsDone(team)).toBe(false);
    });

    it('returns false when some subagents still working', () => {
      registerSubagent(team, 'tu-1', { name: 'A1' });
      registerSubagent(team, 'tu-2', { name: 'A2' });
      team.agents.get('a1')!.status = 'done';
      expect(allSubagentsDone(team)).toBe(false);
    });

    it('returns true when all subagents done or error', () => {
      registerSubagent(team, 'tu-1', { name: 'A1' });
      registerSubagent(team, 'tu-2', { name: 'A2' });
      team.agents.get('a1')!.status = 'done';
      team.agents.get('a2')!.status = 'error';
      expect(allSubagentsDone(team)).toBe(true);
    });
  });

  describe('serializeTeam', () => {
    it('converts Map to array and preserves all fields', () => {
      registerSubagent(team, 'tu-1', { name: 'Worker' });
      const serialized = serializeTeam(team);

      expect(serialized.teamId).toBe(team.teamId);
      expect(serialized.agents).toBeInstanceOf(Array);
      expect(serialized.agents).toHaveLength(2); // Lead + Worker
      expect(serialized.agents[0].id).toBe('lead');
      expect(serialized.agents[1].id).toBe('worker');
      expect(serialized.tasks).toEqual(team.tasks);
      expect(serialized.status).toBe(team.status);
    });
  });

  describe('persistence', () => {
    const teamsDir = join(TEST_CONFIG_DIR, 'teams');

    beforeEach(() => {
      // Ensure clean teams dir
      if (existsSync(teamsDir)) {
        rmSync(teamsDir, { recursive: true });
      }
    });

    afterEach(() => {
      flushPendingPersists();
      if (existsSync(TEST_CONFIG_DIR)) {
        rmSync(TEST_CONFIG_DIR, { recursive: true });
      }
    });

    describe('persistTeam / loadTeam round-trip', () => {
      it('persists and loads a team with correct data', () => {
        registerSubagent(team, 'tu-1', { name: 'Worker', prompt: 'Do stuff' });
        addFeedEntry(team, 'worker', 'status_change', 'Worker joined');

        persistTeam(team);

        const loaded = loadTeam(team.teamId);
        expect(loaded).not.toBeNull();
        expect(loaded!.teamId).toBe(team.teamId);
        expect(loaded!.title).toBe(team.title);
        expect(loaded!.config).toEqual(team.config);
        expect(loaded!.conversationId).toBe(team.conversationId);
        expect(loaded!.status).toBe(team.status);
        expect(loaded!.agents.size).toBe(2); // Lead + Worker
        expect(loaded!.agents.get('lead')?.role.name).toBe('Lead');
        expect(loaded!.agents.get('worker')?.role.name).toBe('Agent 2');
        expect(loaded!.tasks).toHaveLength(1);
        expect(loaded!.tasks[0].assignee).toBe('worker');
        expect(loaded!.feed).toHaveLength(2); // 1 initial + 1 added
      });

      it('loaded team preserves agent messages', () => {
        const agent = registerSubagent(team, 'tu-1', { name: 'Talker' });
        addAgentMessage(agent, 'assistant', { content: 'hello' });
        expect(agent.messages).toHaveLength(1);

        persistTeam(team);
        const loaded = loadTeam(team.teamId);
        expect(loaded!.agents.get('talker')?.messages).toHaveLength(1);
        expect(loaded!.agents.get('talker')?.messages[0].content).toBe('hello');
      });
    });

    describe('loadTeam', () => {
      it('returns null for nonexistent team', () => {
        expect(loadTeam('nonexistent-id')).toBeNull();
      });
    });

    describe('listTeams', () => {
      it('returns empty array when no teams', () => {
        expect(listTeams()).toEqual([]);
      });

      it('lists persisted teams sorted by createdAt descending', () => {
        // Create and persist two teams
        persistTeam(team);

        clearActiveTeam();
        const team2Config: TeamConfig = { instruction: 'Second task' };
        const team2 = createTeamState(team2Config, 'conv-list-2', '/test/workdir');
        // Ensure team2 has a strictly later createdAt to avoid same-millisecond flakiness
        team2.createdAt = team.createdAt + 1000;
        persistTeam(team2);

        const list = listTeams();
        expect(list).toHaveLength(2);
        // team2 created after team1, so it should be first
        expect(list[0].teamId).toBe(team2.teamId);
        expect(list[1].teamId).toBe(team.teamId);
      });

      it('returns correct summary fields', () => {
        registerSubagent(team, 'tu-1', { name: 'Agent1' });
        team.totalCost = 0.25;
        persistTeam(team);

        const list = listTeams();
        expect(list).toHaveLength(1);
        expect(list[0].title).toBe(team.title);
        expect(list[0].status).toBe(team.status);
        expect(list[0].template).toBe('code-review');
        expect(list[0].agentCount).toBe(2); // Lead + Agent1
        expect(list[0].totalCost).toBe(0.25);
      });
    });

    describe('deleteTeam', () => {
      it('deletes a persisted team', () => {
        persistTeam(team);
        expect(loadTeam(team.teamId)).not.toBeNull();

        const result = deleteTeam(team.teamId);
        expect(result).toBe(true);
        expect(loadTeam(team.teamId)).toBeNull();
      });

      it('returns false for nonexistent team', () => {
        expect(deleteTeam('nonexistent')).toBe(false);
      });
    });

    describe('persistTeamDebounced', () => {
      it('eventually persists the team', async () => {
        persistTeamDebounced(team);

        // Should not be persisted yet
        expect(loadTeam(team.teamId)).toBeNull();

        // Wait for debounce to fire
        await new Promise(r => setTimeout(r, 600));

        expect(loadTeam(team.teamId)).not.toBeNull();
      });

      it('flushPendingPersists writes immediately', () => {
        persistTeamDebounced(team);
        expect(loadTeam(team.teamId)).toBeNull();

        flushPendingPersists();
        expect(loadTeam(team.teamId)).not.toBeNull();
      });
    });
  });

  describe('buildAgentsDef', () => {
    it('returns code-review agents for code-review template', () => {
      const agents = buildAgentsDef('code-review');
      expect(Object.keys(agents)).toContain('security-reviewer');
      expect(Object.keys(agents)).toContain('quality-reviewer');
      expect(Object.keys(agents)).toContain('performance-reviewer');
      expect(agents['security-reviewer'].tools).toContain('Read');
    });

    it('returns full-stack agents for full-stack template', () => {
      const agents = buildAgentsDef('full-stack');
      expect(Object.keys(agents)).toContain('backend-dev');
      expect(Object.keys(agents)).toContain('frontend-dev');
      expect(Object.keys(agents)).toContain('test-engineer');
    });

    it('returns debug agents for debug template', () => {
      const agents = buildAgentsDef('debug');
      expect(Object.keys(agents)).toContain('investigator-1');
      expect(Object.keys(agents)).toContain('investigator-2');
    });

    it('falls back to custom for unknown template', () => {
      const agents = buildAgentsDef('nonexistent');
      expect(Object.keys(agents)).toContain('worker-1');
    });

    it('returns custom agents when no template specified', () => {
      const agents = buildAgentsDef();
      expect(Object.keys(agents)).toContain('worker-1');
    });
  });

  describe('buildLeadPrompt', () => {
    it('includes user instruction', () => {
      const agents = buildAgentsDef('code-review');
      const prompt = buildLeadPrompt(config, agents);
      expect(prompt).toContain(config.instruction);
    });

    it('lists available agents', () => {
      const agents = buildAgentsDef('code-review');
      const prompt = buildLeadPrompt(config, agents);
      expect(prompt).toContain('security-reviewer');
      expect(prompt).toContain('quality-reviewer');
    });

    it('includes template-specific instructions', () => {
      const agents = buildAgentsDef('code-review');
      const prompt = buildLeadPrompt({ ...config, template: 'code-review' }, agents);
      expect(prompt).toContain('code review');
    });

    it('uses custom instructions for unknown template', () => {
      const agents = buildAgentsDef('custom');
      const prompt = buildLeadPrompt({ instruction: 'do stuff', template: 'custom' }, agents);
      expect(prompt).toContain('multi-agent task');
    });
  });

  describe('onLeadOutput', () => {
    let sentMessages: Record<string, unknown>[];

    beforeEach(() => {
      sentMessages = [];
      setTeamSendFn((msg) => sentMessages.push(msg));
    });

    afterEach(() => {
      setTeamSendFn(() => {});
    });

    it('returns false for non-team conversation', () => {
      const result = onLeadOutput('other-conv', { type: 'assistant' });
      expect(result).toBe(false);
    });

    it('returns false when no active team', () => {
      clearActiveTeam();
      const result = onLeadOutput('conv-team-1', { type: 'assistant' });
      expect(result).toBe(false);
    });

    describe('session ID capture', () => {
      it('captures session ID from system init', () => {
        onLeadOutput('conv-team-1', {
          type: 'system',
          subtype: 'init',
          session_id: 'sess-abc-123',
        });
        expect(team.claudeSessionId).toBe('sess-abc-123');
      });

      it('does not suppress system init messages', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'system',
          subtype: 'init',
          session_id: 'sess-abc',
        });
        expect(result).toBe(false);
      });
    });

    describe('Agent tool call detection', () => {
      const agentToolCallMsg = {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu-sec-1',
              name: 'Agent',
              input: {
                name: 'Security Reviewer',
                description: 'Reviews for security issues',
                prompt: 'Check for vulnerabilities',
              },
            },
          ],
        },
      };

      it('registers subagent when Agent tool called', () => {
        onLeadOutput('conv-team-1', agentToolCallMsg);

        expect(team.agents.size).toBe(2); // Lead + Security Reviewer
        expect(team.agents.get('security-reviewer')).toBeDefined();
        expect(team.agents.get('security-reviewer')?.toolUseId).toBe('tu-sec-1');
      });

      it('emits team_agent_status on Agent tool call', () => {
        onLeadOutput('conv-team-1', agentToolCallMsg);

        const statusMsg = sentMessages.find(m => m.type === 'team_agent_status');
        expect(statusMsg).toBeDefined();
        expect((statusMsg?.agent as Record<string, unknown>)?.id).toBe('security-reviewer');
        expect((statusMsg?.agent as Record<string, unknown>)?.status).toBe('starting');
      });

      it('emits team_task_update on Agent tool call', () => {
        onLeadOutput('conv-team-1', agentToolCallMsg);

        const taskMsg = sentMessages.find(m => m.type === 'team_task_update');
        expect(taskMsg).toBeDefined();
        expect((taskMsg?.task as Record<string, unknown>)?.assignee).toBe('security-reviewer');
      });

      it('emits team_feed on Agent tool call', () => {
        onLeadOutput('conv-team-1', agentToolCallMsg);

        const feedMsg = sentMessages.find(m => m.type === 'team_feed');
        expect(feedMsg).toBeDefined();
        expect((feedMsg?.entry as Record<string, unknown>)?.content).toContain('Agent 2');
      });

      it('does not suppress Lead assistant messages without parent_tool_use_id', () => {
        const result = onLeadOutput('conv-team-1', agentToolCallMsg);
        expect(result).toBe(false);
      });

      it('handles multiple Agent tool calls in one message', () => {
        const multiMsg = {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-1', name: 'Agent', input: { name: 'Worker A' } },
              { type: 'tool_use', id: 'tu-2', name: 'Agent', input: { name: 'Worker B' } },
            ],
          },
        };

        onLeadOutput('conv-team-1', multiMsg);

        expect(team.agents.size).toBe(3); // Lead + A + B
        expect(team.agents.get('worker-a')).toBeDefined();
        expect(team.agents.get('worker-b')).toBeDefined();

        const statusMsgs = sentMessages.filter(m => m.type === 'team_agent_status');
        expect(statusMsgs).toHaveLength(2);
      });

      it('transitions team from planning to running', () => {
        expect(team.status).toBe('planning');
        onLeadOutput('conv-team-1', agentToolCallMsg);
        expect(team.status).toBe('running');
      });
    });

    describe('system.task_started', () => {
      it('links task ID and suppresses message', () => {
        // First register the agent
        onLeadOutput('conv-team-1', {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-worker-1', name: 'Agent', input: { name: 'Worker' } },
            ],
          },
        });

        sentMessages = [];

        const result = onLeadOutput('conv-team-1', {
          type: 'system',
          subtype: 'task_started',
          tool_use_id: 'tu-worker-1',
          task_id: 'native-task-42',
        });

        expect(result).toBe(true); // suppressed
        const agent = team.agents.get('worker');
        expect(agent?.agentTaskId).toBe('native-task-42');
        expect(agent?.status).toBe('working');
      });

      it('emits status updates on task_started', () => {
        onLeadOutput('conv-team-1', {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-w', name: 'Agent', input: { name: 'W' } },
            ],
          },
        });
        sentMessages = [];

        onLeadOutput('conv-team-1', {
          type: 'system',
          subtype: 'task_started',
          tool_use_id: 'tu-w',
          task_id: 'tid-1',
        });

        const agentStatus = sentMessages.find(m => m.type === 'team_agent_status');
        expect(agentStatus).toBeDefined();
        expect((agentStatus?.agent as Record<string, unknown>)?.status).toBe('working');

        const feedMsg = sentMessages.find(m => m.type === 'team_feed');
        expect(feedMsg).toBeDefined();

        const taskUpdate = sentMessages.find(m => m.type === 'team_task_update');
        expect(taskUpdate).toBeDefined();
        expect((taskUpdate?.task as Record<string, unknown>)?.status).toBe('active');
      });

      it('returns true even for unknown tool_use_id (still suppressed)', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'system',
          subtype: 'task_started',
          tool_use_id: 'unknown-tu',
          task_id: 'tid-unknown',
        });
        expect(result).toBe(true);
      });
    });

    describe('parent_tool_use_id routing', () => {
      beforeEach(() => {
        // Register and link an agent
        onLeadOutput('conv-team-1', {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-agent-x', name: 'Agent', input: { name: 'AgentX' } },
            ],
          },
        });
        onLeadOutput('conv-team-1', {
          type: 'system',
          subtype: 'task_started',
          tool_use_id: 'tu-agent-x',
          task_id: 'tid-x',
        });
        sentMessages = [];
      });

      it('routes assistant message with parent_tool_use_id to agent', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'assistant',
          parent_tool_use_id: 'tu-agent-x',
          message: {
            content: [
              { type: 'text', text: 'Analyzing security...' },
            ],
          },
        });

        expect(result).toBe(true); // suppressed
        const agent = team.agents.get('agentx');
        expect(agent?.messages).toHaveLength(1);
        expect(agent?.messages[0].content).toBe('Analyzing security...');
      });

      it('routes tool use blocks to agent messages and feed', () => {
        onLeadOutput('conv-team-1', {
          type: 'assistant',
          parent_tool_use_id: 'tu-agent-x',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', id: 'tool-1', input: { file_path: '/src/main.ts' } },
            ],
          },
        });

        const agent = team.agents.get('agentx')!;
        expect(agent.messages).toHaveLength(1);
        expect(agent.messages[0].toolName).toBe('Read');

        // Feed should have a tool_call entry
        const feedEntries = team.feed.filter(f => f.type === 'tool_call' && f.agentId === 'agentx');
        expect(feedEntries.length).toBeGreaterThan(0);
        expect(feedEntries[0].content).toContain('Agent 2');
        expect(feedEntries[0].content).toContain('reading');
      });

      it('routes tool results (user messages) to agent', () => {
        onLeadOutput('conv-team-1', {
          type: 'user',
          parent_tool_use_id: 'tu-agent-x',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tool-read-1', content: 'file contents here...' },
            ],
          },
        });

        const agent = team.agents.get('agentx')!;
        expect(agent.messages).toHaveLength(1);
        expect(agent.messages[0].toolOutput).toBe('file contents here...');
        expect(agent.messages[0].hasResult).toBe(true);
      });

      it('emits claude_output with agentRole and teamId', () => {
        onLeadOutput('conv-team-1', {
          type: 'assistant',
          parent_tool_use_id: 'tu-agent-x',
          message: {
            content: [
              { type: 'text', text: 'Found a vulnerability' },
            ],
          },
        });

        const outputMsg = sentMessages.find(m => m.type === 'claude_output');
        expect(outputMsg).toBeDefined();
        expect(outputMsg?.agentRole).toBe('agentx');
        expect(outputMsg?.teamId).toBe(team.teamId);
        expect((outputMsg?.data as Record<string, unknown>)?.delta).toBe('Found a vulnerability');
      });

      it('returns false for unknown parent_tool_use_id', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'assistant',
          parent_tool_use_id: 'tu-unknown',
          message: { content: [{ type: 'text', text: 'hello' }] },
        });
        expect(result).toBe(false);
      });
    });

    describe('subagent completion (tool_result for Agent tool)', () => {
      beforeEach(() => {
        // Register agent
        onLeadOutput('conv-team-1', {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-done-agent', name: 'Agent', input: { name: 'Finisher' } },
            ],
          },
        });
        onLeadOutput('conv-team-1', {
          type: 'system',
          subtype: 'task_started',
          tool_use_id: 'tu-done-agent',
          task_id: 'tid-done',
        });
        sentMessages = [];
      });

      it('marks agent as done on tool_result', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-done-agent', content: 'Agent result...' },
            ],
          },
        });

        expect(result).toBe(true); // suppressed
        const agent = team.agents.get('finisher');
        expect(agent?.status).toBe('done');
      });

      it('updates task status to done', () => {
        onLeadOutput('conv-team-1', {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-done-agent', content: 'Done' },
            ],
          },
        });

        const task = team.tasks.find(t => t.assignee === 'finisher');
        expect(task?.status).toBe('done');
      });

      it('emits team_agent_status, team_task_update, team_feed on completion', () => {
        onLeadOutput('conv-team-1', {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-done-agent', content: 'Done' },
            ],
          },
        });

        expect(sentMessages.find(m => m.type === 'team_agent_status')).toBeDefined();
        expect(sentMessages.find(m => m.type === 'team_task_update')).toBeDefined();
        expect(sentMessages.find(m => m.type === 'team_feed')).toBeDefined();
      });

      it('transitions team to summarizing when all subagents done', () => {
        expect(team.status).toBe('running');

        onLeadOutput('conv-team-1', {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-done-agent', content: 'Done' },
            ],
          },
        });

        expect(team.status).toBe('summarizing');
      });

      it('does not transition to summarizing when subagents still working', () => {
        // Register a second agent
        onLeadOutput('conv-team-1', {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-other', name: 'Agent', input: { name: 'Other' } },
            ],
          },
        });

        // Complete only the first agent
        onLeadOutput('conv-team-1', {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-done-agent', content: 'Done' },
            ],
          },
        });

        expect(team.status).toBe('running'); // not summarizing yet
      });

      it('suppresses and re-forwards tool_result for non-Agent tool calls with team context', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-random-tool', content: 'some result' },
            ],
          },
        });

        expect(result).toBe(true); // suppressed — re-forwarded with team context
      });
    });

    describe('result message', () => {
      it('captures total_cost_usd and duration_ms', () => {
        onLeadOutput('conv-team-1', {
          type: 'result',
          total_cost_usd: 0.42,
          duration_ms: 15000,
        });

        expect(team.totalCost).toBe(0.42);
        expect(team.durationMs).toBe(15000);
      });

      it('does not suppress result messages', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'result',
          total_cost_usd: 0.1,
          duration_ms: 5000,
        });

        expect(result).toBe(false);
      });
    });

    describe('Lead text output (no parent_tool_use_id)', () => {
      it('does not suppress Lead text messages', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'I will now analyze the codebase...' },
            ],
          },
        });

        expect(result).toBe(false);
      });
    });
  });

  describe('Team lifecycle (createTeam, dissolveTeam, completeTeam)', () => {
    let mockHandleChat: ReturnType<typeof vi.fn>;
    let mockCancelExecution: ReturnType<typeof vi.fn>;
    let mockSetOutputObserver: ReturnType<typeof vi.fn>;
    let mockClearOutputObserver: ReturnType<typeof vi.fn>;
    let sentMessages: Record<string, unknown>[];

    beforeEach(() => {
      // Reset any active team
      clearActiveTeam();
      sentMessages = [];
      setTeamSendFn((msg) => sentMessages.push(msg));

      // Set up mock claude functions
      mockHandleChat = vi.fn();
      mockCancelExecution = vi.fn();
      mockSetOutputObserver = vi.fn();
      mockClearOutputObserver = vi.fn();

      setTeamClaudeFns({
        handleChat: mockHandleChat,
        cancelExecution: mockCancelExecution,
        setOutputObserver: mockSetOutputObserver,
        clearOutputObserver: mockClearOutputObserver,
      });
    });

    afterEach(() => {
      clearActiveTeam();
    });

    describe('createTeam()', () => {
      it('creates a team and sets it as active', () => {
        const teamConfig: TeamConfig = {
          instruction: 'Build a REST API',
          template: 'full-stack',
        };

        const team = createTeam(teamConfig, '/projects/myapp');

        expect(team).not.toBeNull();
        expect(getActiveTeam()).toBe(team);
        expect(team.status).toBe('planning');
        expect(team.config).toBe(teamConfig);
      });

      it('calls handleChat with correct conversationId, prompt, and extraArgs', () => {
        const teamConfig: TeamConfig = {
          instruction: 'Build a REST API',
          template: 'full-stack',
        };

        const team = createTeam(teamConfig, '/projects/myapp');

        expect(mockHandleChat).toHaveBeenCalledTimes(1);
        const [convId, prompt, workDir, options] = mockHandleChat.mock.calls[0];
        expect(convId).toBe(team.conversationId);
        expect(convId).toMatch(/^team-/);
        expect(prompt).toContain('Build a REST API');
        expect(workDir).toBe('/projects/myapp');
        expect(options).toBeDefined();
        expect(options.extraArgs).toBeDefined();
        expect(options.extraArgs[0]).toBe('--agents');
        // extraArgs[1] should be valid JSON
        const agentsDef = JSON.parse(options.extraArgs[1]);
        expect(agentsDef).toHaveProperty('backend-dev');
        expect(agentsDef).toHaveProperty('frontend-dev');
        expect(agentsDef).toHaveProperty('test-engineer');
      });

      it('registers the output observer before spawning', () => {
        createTeam({ instruction: 'test', template: 'custom' }, '/tmp');

        expect(mockSetOutputObserver).toHaveBeenCalledTimes(1);
        // Output observer should be set before handleChat
        const setObserverOrder = mockSetOutputObserver.mock.invocationCallOrder[0];
        const handleChatOrder = mockHandleChat.mock.invocationCallOrder[0];
        expect(setObserverOrder).toBeLessThan(handleChatOrder);
      });

      it('sends team_created message with serialized team', () => {
        const team = createTeam({ instruction: 'test task', template: 'debug' }, '/tmp');

        const msg = sentMessages.find(m => m.type === 'team_created');
        expect(msg).toBeDefined();
        expect(msg!.team).toBeDefined();
        const serialized = msg!.team as Record<string, unknown>;
        expect(serialized.teamId).toBe(team.teamId);
        expect(serialized.status).toBe('planning');
      });

      it('persists team to disk', () => {
        const team = createTeam({ instruction: 'persist test', template: 'custom' }, '/tmp');

        const loaded = loadTeam(team.teamId);
        expect(loaded).not.toBeNull();
        expect(loaded!.teamId).toBe(team.teamId);
        expect(loaded!.config.instruction).toBe('persist test');
      });

      it('throws if claude functions not initialized', () => {
        // Reset claude fns
        setTeamClaudeFns({
          handleChat: null as unknown as any,
          cancelExecution: mockCancelExecution,
          setOutputObserver: null as unknown as any,
          clearOutputObserver: mockClearOutputObserver,
        });

        expect(() => createTeam({ instruction: 'fail' }, '/tmp')).toThrow(
          'Team claude functions not initialized',
        );
      });

      it('throws if another team is already active', () => {
        createTeam({ instruction: 'first', template: 'custom' }, '/tmp');

        expect(() => createTeam({ instruction: 'second', template: 'custom' }, '/tmp'))
          .toThrow('A team is already active');
      });

      it('uses correct template agents based on config', () => {
        createTeam({ instruction: 'review code', template: 'code-review' }, '/tmp');

        const [, , , options] = mockHandleChat.mock.calls[0];
        const agentsDef = JSON.parse(options.extraArgs[1]);
        expect(agentsDef).toHaveProperty('security-reviewer');
        expect(agentsDef).toHaveProperty('quality-reviewer');
        expect(agentsDef).toHaveProperty('performance-reviewer');
      });

      it('defaults to custom template when no template specified', () => {
        createTeam({ instruction: 'do stuff' }, '/tmp');

        const [, , , options] = mockHandleChat.mock.calls[0];
        const agentsDef = JSON.parse(options.extraArgs[1]);
        expect(agentsDef).toHaveProperty('worker-1');
        expect(agentsDef).toHaveProperty('worker-2');
        expect(agentsDef).toHaveProperty('worker-3');
      });

      it('uses config.agents when provided instead of template lookup', () => {
        const customAgents = {
          'my-agent': {
            description: 'A custom agent',
            prompt: 'Do custom work',
            tools: ['Read', 'Write'],
          },
        };
        createTeam({ instruction: 'custom agents test', agents: customAgents }, '/tmp');

        const [, , , options] = mockHandleChat.mock.calls[0];
        const agentsDef = JSON.parse(options.extraArgs[1]);
        expect(agentsDef).toHaveProperty('my-agent');
        expect(agentsDef['my-agent'].description).toBe('A custom agent');
        // Should NOT have template agents
        expect(agentsDef).not.toHaveProperty('worker-1');
      });

      it('uses config.leadPrompt when provided instead of building from template', () => {
        const customPrompt = 'You are a specialized lead for testing.';
        createTeam({
          instruction: 'lead prompt test',
          leadPrompt: customPrompt,
        }, '/tmp');

        const [, prompt] = mockHandleChat.mock.calls[0];
        expect(prompt).toBe(customPrompt);
        // Should use the custom prompt directly, not template-built one
        expect(prompt).not.toContain('team lead coordinating a development task');
      });
    });

    describe('dissolveTeam()', () => {
      it('does nothing if no active team', () => {
        dissolveTeam();
        expect(sentMessages).toHaveLength(0);
        expect(mockCancelExecution).not.toHaveBeenCalled();
      });

      it('cancels execution with the correct conversationId', () => {
        const team = createTeam({ instruction: 'dissolve me', template: 'custom' }, '/tmp');
        sentMessages = [];

        dissolveTeam();

        expect(mockCancelExecution).toHaveBeenCalledWith(team.conversationId);
      });

      it('marks active agents as error', () => {
        const team = createTeam({ instruction: 'dissolve me', template: 'custom' }, '/tmp');
        // Register some subagents
        registerSubagent(team, 'tu-1', { name: 'Worker A' });
        registerSubagent(team, 'tu-2', { name: 'Worker B' });
        linkSubagentTaskId(team, 'tu-1', 'task-1');
        // Worker A is now 'working', Worker B is 'starting'

        dissolveTeam();

        // Both should be error (they were active)
        // Team has been cleared, but we captured state before clearing via the sent message
        const completedMsg = sentMessages.find(m => m.type === 'team_completed');
        const serialized = completedMsg!.team as { agents: Array<{ id: string; status: string }> };
        const workerA = serialized.agents.find(a => a.id === 'worker-a');
        const workerB = serialized.agents.find(a => a.id === 'worker-b');
        expect(workerA?.status).toBe('error');
        expect(workerB?.status).toBe('error');
      });

      it('marks pending/active tasks as failed', () => {
        const team = createTeam({ instruction: 'dissolve me', template: 'custom' }, '/tmp');
        registerSubagent(team, 'tu-1', { name: 'Worker A' });
        linkSubagentTaskId(team, 'tu-1', 'task-1');
        // task is 'active' now

        dissolveTeam();

        const completedMsg = sentMessages.find(m => m.type === 'team_completed');
        const serialized = completedMsg!.team as { tasks: Array<{ status: string }> };
        for (const task of serialized.tasks) {
          expect(task.status).toBe('failed');
        }
      });

      it('sets team status to failed', () => {
        createTeam({ instruction: 'dissolve me', template: 'custom' }, '/tmp');
        sentMessages = [];

        dissolveTeam();

        const msg = sentMessages.find(m => m.type === 'team_completed');
        expect(msg).toBeDefined();
        expect(msg!.status).toBe('failed');
      });

      it('clears the output observer', () => {
        createTeam({ instruction: 'dissolve me', template: 'custom' }, '/tmp');
        mockClearOutputObserver.mockClear();

        dissolveTeam();

        expect(mockClearOutputObserver).toHaveBeenCalled();
      });

      it('clears activeTeam after dissolving', () => {
        createTeam({ instruction: 'dissolve me', template: 'custom' }, '/tmp');

        dissolveTeam();

        expect(getActiveTeam()).toBeNull();
      });

      it('persists team state before clearing', () => {
        const team = createTeam({ instruction: 'dissolve persist', template: 'custom' }, '/tmp');
        const teamId = team.teamId;

        dissolveTeam();

        const loaded = loadTeam(teamId);
        expect(loaded).not.toBeNull();
        expect(loaded!.status).toBe('failed');
      });

      it('preserves already-done agents status', () => {
        const team = createTeam({ instruction: 'dissolve me', template: 'custom' }, '/tmp');
        registerSubagent(team, 'tu-1', { name: 'Worker Done' });
        const agent = findAgentByToolUseId(team, 'tu-1')!;
        agent.status = 'done';
        registerSubagent(team, 'tu-2', { name: 'Worker Active' });

        dissolveTeam();

        const completedMsg = sentMessages.find(m => m.type === 'team_completed');
        const serialized = completedMsg!.team as { agents: Array<{ id: string; status: string }> };
        const done = serialized.agents.find(a => a.id === 'worker-done');
        const active = serialized.agents.find(a => a.id === 'worker-active');
        expect(done?.status).toBe('done'); // preserved
        expect(active?.status).toBe('error'); // was starting → error
      });
    });

    describe('completeTeam()', () => {
      it('does nothing if no active team', () => {
        completeTeam('summary');
        expect(sentMessages).toHaveLength(0);
      });

      it('sets team status to completed', () => {
        createTeam({ instruction: 'complete me', template: 'custom' }, '/tmp');
        sentMessages = [];

        completeTeam('All done!');

        const msg = sentMessages.find(m => m.type === 'team_completed');
        expect(msg).toBeDefined();
        expect(msg!.status).toBe('completed');
      });

      it('stores the summary', () => {
        const team = createTeam({ instruction: 'complete me', template: 'custom' }, '/tmp');
        const teamId = team.teamId;
        sentMessages = [];

        completeTeam('My final summary');

        const msg = sentMessages.find(m => m.type === 'team_completed');
        const serialized = msg!.team as { summary: string };
        expect(serialized.summary).toBe('My final summary');

        // Also persisted
        const loaded = loadTeam(teamId);
        expect(loaded!.summary).toBe('My final summary');
      });

      it('marks Lead agent as done', () => {
        createTeam({ instruction: 'complete me', template: 'custom' }, '/tmp');
        sentMessages = [];

        completeTeam();

        const msg = sentMessages.find(m => m.type === 'team_completed');
        const serialized = msg!.team as { agents: Array<{ id: string; status: string }> };
        const lead = serialized.agents.find(a => a.id === 'lead');
        expect(lead?.status).toBe('done');
      });

      it('clears the output observer', () => {
        createTeam({ instruction: 'complete me', template: 'custom' }, '/tmp');
        mockClearOutputObserver.mockClear();

        completeTeam();

        expect(mockClearOutputObserver).toHaveBeenCalled();
      });

      it('clears activeTeam after completing', () => {
        createTeam({ instruction: 'complete me', template: 'custom' }, '/tmp');

        completeTeam();

        expect(getActiveTeam()).toBeNull();
      });

      it('works without summary argument', () => {
        const team = createTeam({ instruction: 'complete me', template: 'custom' }, '/tmp');
        const teamId = team.teamId;

        completeTeam();

        const loaded = loadTeam(teamId);
        expect(loaded!.summary).toBeNull();
        expect(loaded!.status).toBe('completed');
      });
    });

    describe('Full lifecycle: create → run → complete', () => {
      it('handles create → subagent registration → completion via onLeadOutput', () => {
        const team = createTeam({ instruction: 'full lifecycle test', template: 'custom' }, '/tmp');
        sentMessages = [];

        // Simulate session init
        onLeadOutput(team.conversationId, {
          type: 'system',
          session_id: 'sess-lifecycle-1',
        });
        expect(team.claudeSessionId).toBe('sess-lifecycle-1');

        // Simulate Lead spawning an agent
        onLeadOutput(team.conversationId, {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'tu-lc-1',
              name: 'Agent',
              input: { name: 'Implementer', prompt: 'Build the feature' },
            }],
          },
        });
        expect(team.agents.size).toBe(2); // Lead + Implementer
        expect(team.status).toBe('running');

        // Simulate task_started
        onLeadOutput(team.conversationId, {
          type: 'system',
          subtype: 'task_started',
          tool_use_id: 'tu-lc-1',
          task_id: 'task-lc-1',
        });
        const agent = findAgentByToolUseId(team, 'tu-lc-1')!;
        expect(agent.status).toBe('working');

        // Simulate subagent completion (tool_result for Agent call)
        onLeadOutput(team.conversationId, {
          type: 'user',
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: 'tu-lc-1',
              content: 'Feature built successfully',
            }],
          },
        });

        // Agent should be done, team should be summarizing
        // (team object was mutated before completeTeam clears it)
        const agentStatus = sentMessages.find(
          m => m.type === 'team_agent_status' &&
            (m.agent as Record<string, unknown>).id === 'implementer' &&
            (m.agent as Record<string, unknown>).status === 'done',
        );
        expect(agentStatus).toBeDefined();

        // Simulate result message → completes the team
        onLeadOutput(team.conversationId, {
          type: 'result',
          total_cost_usd: 0.05,
          duration_ms: 30000,
          result: 'All tasks completed successfully.',
        });

        // Team should be completed
        const completedMsg = sentMessages.find(m => m.type === 'team_completed');
        expect(completedMsg).toBeDefined();
        expect(completedMsg!.status).toBe('completed');
        const serialized = completedMsg!.team as Record<string, unknown>;
        expect(serialized.summary).toBe('All tasks completed successfully.');
        expect(serialized.totalCost).toBe(0.05);
        expect(serialized.durationMs).toBe(30000);

        // Active team should be cleared
        expect(getActiveTeam()).toBeNull();
      });

      it('handles create → dissolve mid-execution', () => {
        const team = createTeam({ instruction: 'dissolve mid', template: 'custom' }, '/tmp');

        // Simulate some agents starting
        onLeadOutput(team.conversationId, {
          type: 'assistant',
          message: {
            content: [{
              type: 'tool_use',
              id: 'tu-mid-1',
              name: 'Agent',
              input: { name: 'Worker' },
            }],
          },
        });

        sentMessages = [];
        dissolveTeam();

        // Should have sent team_completed with failed status
        const msg = sentMessages.find(m => m.type === 'team_completed');
        expect(msg!.status).toBe('failed');
        expect(getActiveTeam()).toBeNull();
      });
    });
  });
});
