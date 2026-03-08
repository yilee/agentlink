/**
 * Tests for team-templates.ts — template agent definitions and lead prompts.
 */

import { describe, it, expect } from 'vitest';
import { buildAgentsDef, buildLeadPrompt } from '../../agent/src/team-templates.js';
import type { TeamConfig } from '../../agent/src/team-types.js';

describe('team-templates', () => {
  describe('buildAgentsDef', () => {
    it('returns code-review agents for code-review template', () => {
      const agents = buildAgentsDef('code-review');
      expect(Object.keys(agents)).toEqual(['security-reviewer', 'quality-reviewer', 'performance-reviewer']);
      expect(agents['security-reviewer'].tools).toEqual(['Read', 'Grep', 'Glob']);
    });

    it('returns full-stack agents for full-stack template', () => {
      const agents = buildAgentsDef('full-stack');
      expect(Object.keys(agents)).toEqual(['backend-dev', 'frontend-dev', 'test-engineer']);
      expect(agents['backend-dev'].tools).toContain('Bash');
    });

    it('returns debug agents for debug template', () => {
      const agents = buildAgentsDef('debug');
      expect(Object.keys(agents)).toEqual(['hypothesis-a', 'hypothesis-b', 'hypothesis-c']);
    });

    it('returns custom agents for custom template', () => {
      const agents = buildAgentsDef('custom');
      expect(Object.keys(agents)).toEqual(['worker-1', 'worker-2', 'worker-3']);
    });

    it('falls back to custom for unknown template', () => {
      const agents = buildAgentsDef('nonexistent');
      expect(Object.keys(agents)).toEqual(['worker-1', 'worker-2', 'worker-3']);
    });

    it('falls back to custom when template is undefined', () => {
      const agents = buildAgentsDef();
      expect(Object.keys(agents)).toEqual(['worker-1', 'worker-2', 'worker-3']);
    });

    it('returns a shallow copy (not the original)', () => {
      const a = buildAgentsDef('custom');
      const b = buildAgentsDef('custom');
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  describe('buildLeadPrompt', () => {
    it('includes template-specific instructions', () => {
      const config: TeamConfig = { instruction: 'Review my code', template: 'code-review' };
      const agents = buildAgentsDef('code-review');
      const prompt = buildLeadPrompt(config, agents);
      expect(prompt).toContain('code review');
      expect(prompt).toContain('security-reviewer');
      expect(prompt).toContain('Review my code');
    });

    it('includes user instruction in the prompt', () => {
      const config: TeamConfig = { instruction: 'Build a login page' };
      const agents = buildAgentsDef('custom');
      const prompt = buildLeadPrompt(config, agents);
      expect(prompt).toContain('Build a login page');
    });

    it('lists all available agents', () => {
      const config: TeamConfig = { instruction: 'test', template: 'full-stack' };
      const agents = buildAgentsDef('full-stack');
      const prompt = buildLeadPrompt(config, agents);
      expect(prompt).toContain('backend-dev');
      expect(prompt).toContain('frontend-dev');
      expect(prompt).toContain('test-engineer');
    });

    it('falls back to custom instructions for unknown template', () => {
      const config: TeamConfig = { instruction: 'do stuff', template: 'nonexistent' };
      const agents = buildAgentsDef('custom');
      const prompt = buildLeadPrompt(config, agents);
      // Should use custom template instructions
      expect(prompt).toContain('team lead coordinating a development task');
    });

    it('includes agent descriptions in the listing', () => {
      const config: TeamConfig = { instruction: 'test', template: 'debug' };
      const agents = buildAgentsDef('debug');
      const prompt = buildLeadPrompt(config, agents);
      expect(prompt).toContain('Debug investigator exploring the first hypothesis');
    });
  });
});
