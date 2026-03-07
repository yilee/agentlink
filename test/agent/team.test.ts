/**
 * Tests for team.ts state management functions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
});
