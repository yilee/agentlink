/**
 * Tests for team.ts state management functions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    team = createTeamState(config, 'conv-team-1');
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
      expect(team.feed).toHaveLength(0);
      expect(team.summary).toBeNull();
      expect(team.totalCost).toBe(0);
    });

    it('truncates long titles', () => {
      clearActiveTeam();
      const longConfig: TeamConfig = {
        instruction: 'A'.repeat(100),
      };
      const t = createTeamState(longConfig, 'conv-2');
      expect(t.title).toHaveLength(60);
      expect(t.title.endsWith('...')).toBe(true);
    });

    it('sets active team', () => {
      expect(getActiveTeam()).toBe(team);
    });

    it('throws if team already active', () => {
      expect(() => createTeamState(config, 'conv-3')).toThrow('already active');
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
      expect(agent.role.name).toBe('Security Reviewer');
      expect(agent.role.color).toBeTruthy();
      expect(agent.toolUseId).toBe('tool-use-1');
      expect(agent.status).toBe('starting');
      expect(team.agents.size).toBe(2); // Lead + new
    });

    it('auto-creates a task for the agent', () => {
      registerSubagent(team, 'tool-use-1', { name: 'Tester' });

      expect(team.tasks).toHaveLength(1);
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
      addFeedEntry(team, 'lead', 'status_change', 'Team planning started');
      expect(team.feed).toHaveLength(1);
      expect(team.feed[0].agentId).toBe('lead');
      expect(team.feed[0].type).toBe('status_change');
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
      expect(Object.keys(agents)).toContain('hypothesis-a');
      expect(Object.keys(agents)).toContain('hypothesis-b');
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
      expect(prompt).toContain('development task');
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
        expect((feedMsg?.entry as Record<string, unknown>)?.content).toContain('Security Reviewer');
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
        expect(feedEntries[0].content).toContain('AgentX');
        expect(feedEntries[0].content).toContain('Read');
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

      it('does not suppress tool_result for non-Agent tool calls', () => {
        const result = onLeadOutput('conv-team-1', {
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-random-tool', content: 'some result' },
            ],
          },
        });

        expect(result).toBe(false); // not suppressed
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
});
