/**
 * Tests for team-naming.ts — character naming, role classification, task title derivation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  classifyRole,
  pickCharacter,
  deriveAgentDisplayName,
  deriveTaskTitle,
  getNextAgentColor,
} from '../../agent/src/team-naming.js';
import type { TeamState } from '../../agent/src/team-types.js';

function makeTeamState(): TeamState {
  return {
    teamId: 'test-team',
    title: 'Test',
    config: { instruction: 'test' },
    conversationId: 'conv-1',
    claudeSessionId: null,
    agents: new Map(),
    tasks: [],
    feed: [],
    status: 'planning',
    leadStatus: '',
    summary: null,
    totalCost: 0,
    durationMs: 0,
    createdAt: Date.now(),
  };
}

describe('team-naming', () => {
  let team: TeamState;

  beforeEach(() => {
    team = makeTeamState();
  });

  describe('classifyRole', () => {
    it('classifies test-related roles', () => {
      expect(classifyRole({ name: 'test-runner', prompt: 'Run tests' })).toBe('tester');
      expect(classifyRole({ description: 'QA validation' })).toBe('tester');
    });

    it('classifies review-related roles', () => {
      expect(classifyRole({ name: 'security-reviewer' })).toBe('reviewer');
      expect(classifyRole({ description: 'Audit the code' })).toBe('reviewer');
    });

    it('classifies debug-related roles', () => {
      expect(classifyRole({ prompt: 'Fix this bug' })).toBe('debugger');
      expect(classifyRole({ name: 'troubleshoot-issue' })).toBe('debugger');
    });

    it('classifies design-related roles', () => {
      expect(classifyRole({ description: 'Design the UI layout' })).toBe('designer');
    });

    it('classifies writer-related roles', () => {
      expect(classifyRole({ description: 'Write a doc for the API' })).toBe('writer');
    });

    it('classifies analyst-related roles', () => {
      expect(classifyRole({ description: 'Analyze performance benchmark' })).toBe('analyst');
    });

    it('classifies ops-related roles', () => {
      expect(classifyRole({ description: 'Deploy with Docker pipeline' })).toBe('ops');
    });

    it('classifies builder-related roles', () => {
      expect(classifyRole({ description: 'Implement new feature' })).toBe('builder');
    });

    it('falls back to general for unknown roles', () => {
      expect(classifyRole({ name: 'agent-1' })).toBe('general');
      expect(classifyRole({})).toBe('general');
    });
  });

  describe('pickCharacter', () => {
    it('picks from the correct category pool', () => {
      const name = pickCharacter(team, 'tester');
      expect(['Sherlock', 'L', 'Conan', 'Poirot', 'Columbo']).toContain(name);
    });

    it('avoids duplicate names', () => {
      // Add an agent named 'Sherlock'
      team.agents.set('agent-1', {
        role: { id: 'agent-1', name: 'Sherlock', color: '#000' },
        toolUseId: null,
        agentTaskId: null,
        status: 'working',
        currentTaskId: null,
        messages: [],
      });
      const name = pickCharacter(team, 'tester');
      expect(name).not.toBe('Sherlock');
      expect(['L', 'Conan', 'Poirot', 'Columbo']).toContain(name);
    });

    it('falls back to other pools when category exhausted', () => {
      // Fill all tester names
      const testers = ['Sherlock', 'L', 'Conan', 'Poirot', 'Columbo'];
      for (let i = 0; i < testers.length; i++) {
        team.agents.set(`t-${i}`, {
          role: { id: `t-${i}`, name: testers[i], color: '#000' },
          toolUseId: null,
          agentTaskId: null,
          status: 'working',
          currentTaskId: null,
          messages: [],
        });
      }
      const name = pickCharacter(team, 'tester');
      // Should pick from another pool
      expect(testers).not.toContain(name);
      expect(name).toBeTruthy();
    });

    it('falls back to generic name when all pools exhausted', () => {
      // This is hard to hit in practice (45+ agents), so just test the logic
      // by using a pool that doesn't exist
      const name = pickCharacter(team, 'nonexistent-category');
      // Falls back to general pool
      expect(['Aragorn', 'Leia', 'Zoro', 'Totoro', 'Pikachu']).toContain(name);
    });
  });

  describe('deriveAgentDisplayName', () => {
    it('returns a character name based on role classification', () => {
      const name = deriveAgentDisplayName(team, { description: 'Run the test suite for QA' });
      // Should be a tester name
      expect(['Sherlock', 'L', 'Conan', 'Poirot', 'Columbo']).toContain(name);
    });
  });

  describe('deriveTaskTitle', () => {
    it('uses short description directly', () => {
      expect(deriveTaskTitle({ description: 'Fix login bug' })).toBe('Fix login bug');
    });

    it('truncates long descriptions with colon prefix', () => {
      const desc = 'Security Review: ' + 'A'.repeat(80);
      const title = deriveTaskTitle({ description: desc });
      expect(title).toBe('Security Review');
    });

    it('truncates long descriptions without colon', () => {
      const desc = 'A'.repeat(100);
      const title = deriveTaskTitle({ description: desc });
      expect(title).toHaveLength(80);
      expect(title.endsWith('...')).toBe(true);
    });

    it('uses descriptive name when no description', () => {
      expect(deriveTaskTitle({ name: 'Security Reviewer' })).toBe('Security Reviewer');
    });

    it('ignores generic names like worker-1', () => {
      expect(deriveTaskTitle({ name: 'worker-1', prompt: 'Do stuff' })).toBe('Do stuff');
      expect(deriveTaskTitle({ name: 'agent-2', prompt: 'Build it' })).toBe('Build it');
    });

    it('extracts from prompt first line', () => {
      expect(deriveTaskTitle({ prompt: 'First line\nSecond line' })).toBe('First line');
    });

    it('truncates long prompt first line', () => {
      const title = deriveTaskTitle({ prompt: 'A'.repeat(100) });
      expect(title).toHaveLength(80);
      expect(title.endsWith('...')).toBe(true);
    });

    it('returns Task as final fallback', () => {
      expect(deriveTaskTitle({})).toBe('Task');
    });
  });

  describe('getNextAgentColor', () => {
    it('returns first color for empty team', () => {
      expect(getNextAgentColor(team)).toBe('#EF4444');
    });

    it('cycles through colors', () => {
      // Add agents to advance the index
      team.agents.set('a1', { role: { id: 'a1', name: 'A', color: '#000' }, toolUseId: null, agentTaskId: null, status: 'working', currentTaskId: null, messages: [] });
      expect(getNextAgentColor(team)).toBe('#EAB308'); // second color
    });
  });
});
