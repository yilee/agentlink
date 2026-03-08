/**
 * Tests for team-persistence.ts — serialization, deserialization, and round-trip.
 */

import { describe, it, expect } from 'vitest';
import { serializeTeam, deserializeTeam } from '../../agent/src/team-persistence.js';
import type { TeamState, AgentTeammate } from '../../agent/src/team-types.js';

function makeTeamState(overrides?: Partial<TeamState>): TeamState {
  return {
    teamId: 'test-team',
    title: 'Test Team',
    config: { instruction: 'do something' },
    conversationId: 'conv-1',
    claudeSessionId: 'session-1',
    agents: new Map(),
    tasks: [],
    feed: [],
    status: 'planning',
    leadStatus: 'thinking',
    summary: null,
    totalCost: 0,
    durationMs: 0,
    createdAt: 1700000000000,
    ...overrides,
  };
}

function makeAgent(id: string, name: string): AgentTeammate {
  return {
    role: { id, name, color: '#EF4444' },
    toolUseId: `tool-${id}`,
    agentTaskId: `task-${id}`,
    status: 'working',
    currentTaskId: `current-${id}`,
    messages: [{ role: 'user', text: 'hello' }],
  };
}

describe('team-persistence', () => {
  describe('serializeTeam', () => {
    it('serializes empty team correctly', () => {
      const team = makeTeamState();
      const serialized = serializeTeam(team);

      expect(serialized.teamId).toBe('test-team');
      expect(serialized.title).toBe('Test Team');
      expect(serialized.agents).toEqual([]);
      expect(serialized.tasks).toEqual([]);
      expect(serialized.status).toBe('planning');
      expect(serialized.createdAt).toBe(1700000000000);
    });

    it('serializes agents from Map to array', () => {
      const team = makeTeamState();
      team.agents.set('a1', makeAgent('a1', 'Sherlock'));
      team.agents.set('a2', makeAgent('a2', 'Spock'));

      const serialized = serializeTeam(team);
      expect(serialized.agents).toHaveLength(2);
      expect(serialized.agents[0].id).toBe('a1');
      expect(serialized.agents[0].name).toBe('Sherlock');
      expect(serialized.agents[1].id).toBe('a2');
      expect(serialized.agents[1].name).toBe('Spock');
    });

    it('excludes messages by default', () => {
      const team = makeTeamState();
      team.agents.set('a1', makeAgent('a1', 'Neo'));

      const serialized = serializeTeam(team);
      expect(serialized.agents[0]).not.toHaveProperty('messages');
    });

    it('includes messages when includeMessages=true', () => {
      const team = makeTeamState();
      team.agents.set('a1', makeAgent('a1', 'Neo'));

      const serialized = serializeTeam(team, true);
      expect(serialized.agents[0].messages).toEqual([{ role: 'user', text: 'hello' }]);
    });

    it('preserves all team fields', () => {
      const team = makeTeamState({
        conversationId: 'conv-42',
        claudeSessionId: 'sess-42',
        status: 'completed',
        leadStatus: 'done',
        summary: 'All done',
        totalCost: 1.23,
        durationMs: 5000,
      });
      team.tasks = [{ id: 't1', title: 'Task 1', agentName: 'Neo', agentId: 'a1', status: 'done', createdAt: 1700000000000, updatedAt: 1700000001000 }];
      team.feed = [{ type: 'status', text: 'started', timestamp: 1700000000000 }];

      const serialized = serializeTeam(team);
      expect(serialized.conversationId).toBe('conv-42');
      expect(serialized.claudeSessionId).toBe('sess-42');
      expect(serialized.status).toBe('completed');
      expect(serialized.leadStatus).toBe('done');
      expect(serialized.summary).toBe('All done');
      expect(serialized.totalCost).toBe(1.23);
      expect(serialized.durationMs).toBe(5000);
      expect(serialized.tasks).toHaveLength(1);
      expect(serialized.feed).toHaveLength(1);
    });
  });

  describe('deserializeTeam', () => {
    it('deserializes empty team', () => {
      const serialized = serializeTeam(makeTeamState());
      const team = deserializeTeam(serialized);

      expect(team.teamId).toBe('test-team');
      expect(team.agents).toBeInstanceOf(Map);
      expect(team.agents.size).toBe(0);
    });

    it('deserializes agents from array to Map', () => {
      const original = makeTeamState();
      original.agents.set('a1', makeAgent('a1', 'Sherlock'));
      const serialized = serializeTeam(original, true);

      const restored = deserializeTeam(serialized);
      expect(restored.agents.size).toBe(1);
      const agent = restored.agents.get('a1')!;
      expect(agent.role.name).toBe('Sherlock');
      expect(agent.role.color).toBe('#EF4444');
      expect(agent.status).toBe('working');
      expect(agent.messages).toEqual([{ role: 'user', text: 'hello' }]);
    });

    it('defaults messages to empty array when not present', () => {
      const original = makeTeamState();
      original.agents.set('a1', makeAgent('a1', 'Neo'));
      const serialized = serializeTeam(original); // excludes messages

      const restored = deserializeTeam(serialized);
      expect(restored.agents.get('a1')!.messages).toEqual([]);
    });

    it('defaults leadStatus to empty string when not present', () => {
      const serialized = serializeTeam(makeTeamState());
      delete (serialized as Record<string, unknown>).leadStatus;

      const restored = deserializeTeam(serialized);
      expect(restored.leadStatus).toBe('');
    });
  });

  describe('round-trip serialization', () => {
    it('preserves team data through serialize → deserialize', () => {
      const original = makeTeamState({
        title: 'Round Trip Test',
        status: 'working',
        totalCost: 3.14,
      });
      original.agents.set('a1', makeAgent('a1', 'Sherlock'));
      original.agents.set('a2', makeAgent('a2', 'Spock'));
      original.tasks = [
        { id: 't1', title: 'Investigate', agentName: 'Sherlock', agentId: 'a1', status: 'in_progress', createdAt: 1700000000000, updatedAt: 1700000001000 },
      ];

      const serialized = serializeTeam(original, true);
      const restored = deserializeTeam(serialized);

      expect(restored.teamId).toBe(original.teamId);
      expect(restored.title).toBe('Round Trip Test');
      expect(restored.status).toBe('working');
      expect(restored.totalCost).toBe(3.14);
      expect(restored.agents.size).toBe(2);
      expect(restored.agents.get('a1')!.role.name).toBe('Sherlock');
      expect(restored.agents.get('a2')!.role.name).toBe('Spock');
      expect(restored.tasks).toHaveLength(1);
      expect(restored.tasks[0].title).toBe('Investigate');
    });

    it('handles JSON round-trip (simulate disk persistence)', () => {
      const original = makeTeamState();
      original.agents.set('a1', makeAgent('a1', 'Neo'));
      const serialized = serializeTeam(original, true);

      // Simulate writing to disk and reading back
      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);
      const restored = deserializeTeam(parsed);

      expect(restored.teamId).toBe(original.teamId);
      expect(restored.agents.get('a1')!.role.name).toBe('Neo');
    });
  });
});
