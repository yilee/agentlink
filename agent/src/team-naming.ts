/**
 * Agent naming — fictional character pools and role classification.
 */

import type { TeamState } from './team-types.js';

// ── Color palette for auto-assigning agent colors ──────────────────────

const AGENT_COLORS = [
  '#EF4444', // red (Lead)
  '#EAB308', // yellow
  '#3B82F6', // blue
  '#10B981', // emerald
  '#8B5CF6', // violet
  '#F97316', // orange
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
  '#6366F1', // indigo
];

/**
 * Get the next color for an agent (based on current count).
 */
export function getNextAgentColor(team: TeamState): string {
  const idx = team.agents.size % AGENT_COLORS.length;
  return AGENT_COLORS[idx];
}

/**
 * Fictional character pools grouped by role archetype.
 * Each subagent gets a character name that fits its role.
 */
const CHARACTER_POOLS: Record<string, string[]> = {
  builder:   ['Tony Stark', 'Neo', 'Hiro Hamada', 'Rocket', 'Q'],
  designer:  ['Elsa', 'Remy', 'Edna Mode', 'Violet', 'WALL-E'],
  tester:    ['Sherlock', 'L', 'Conan', 'Poirot', 'Columbo'],
  writer:    ['Hermione', 'Gandalf', 'Dumbledore', 'Yoda', 'Jarvis'],
  reviewer:  ['Spock', 'Baymax', 'Alfred', 'Morpheus', 'Obi-Wan'],
  debugger:  ['MacGyver', 'Strange', 'Lelouch', 'House', 'Lupin'],
  analyst:   ['Data', 'Cortana', 'Oracle', 'Vision', 'Friday'],
  ops:       ['Scotty', 'R2-D2', 'BB-8', 'C-3PO', 'HAL'],
  general:   ['Aragorn', 'Leia', 'Zoro', 'Totoro', 'Pikachu'],
};

/** Track which characters have been used in this team to avoid duplicates. */
export function pickCharacter(team: TeamState, category: string): string {
  const pool = CHARACTER_POOLS[category] || CHARACTER_POOLS.general;
  const usedNames = new Set([...team.agents.values()].map(a => a.role.name));
  // Find an unused character from the pool
  for (const name of pool) {
    if (!usedNames.has(name)) return name;
  }
  // Fallback: try other pools
  for (const names of Object.values(CHARACTER_POOLS)) {
    for (const name of names) {
      if (!usedNames.has(name)) return name;
    }
  }
  return `Agent ${team.agents.size}`;
}

/**
 * Classify a subagent's role from its tool input into a character category.
 */
export function classifyRole(input: { name?: string; description?: string; prompt?: string }): string {
  const text = [input.name, input.description, input.prompt].filter(Boolean).join(' ').toLowerCase();

  if (/\b(test|testing|qa|verify|validation|spec)\b/.test(text)) return 'tester';
  if (/\b(review|audit|check|inspect|security|lint)\b/.test(text)) return 'reviewer';
  if (/\b(debug|fix|bug|patch|troubleshoot|diagnose)\b/.test(text)) return 'debugger';
  if (/\b(design|ui|ux|layout|style|css|visual|mockup)\b/.test(text)) return 'designer';
  if (/\b(writ|doc|readme|comment|markdown|copy)\b/.test(text)) return 'writer';
  if (/\b(analy|research|investigat|explor|study|benchmark)\b/.test(text)) return 'analyst';
  if (/\b(deploy|ci|cd|devops|infra|docker|k8s|config|setup|install|pipeline)\b/.test(text)) return 'ops';
  if (/\b(build|implement|creat|develop|code|program|engineer|construct|make|add)\b/.test(text)) return 'builder';
  return 'general';
}

/**
 * Derive a fictional character name for a subagent based on its role.
 */
export function deriveAgentDisplayName(
  team: TeamState,
  _input: { name?: string; description?: string; prompt?: string },
): string {
  return `Agent ${team.agents.size + 1}`;
}

/**
 * Derive a human-readable task title from the Agent tool input.
 * Used on the Kanban board to describe what the agent is working on.
 */
export function deriveTaskTitle(input: { name?: string; description?: string; prompt?: string }): string {
  // Short description → use directly
  if (input.description && input.description.length <= 80) {
    return input.description;
  }

  // Colon-prefixed description → use the full thing if ≤ 80, otherwise prefix
  if (input.description) {
    if (input.description.length <= 80) return input.description;
    const colonIdx = input.description.indexOf(':');
    if (colonIdx > 0 && colonIdx <= 40) {
      return input.description.slice(0, colonIdx).trim();
    }
    return input.description.slice(0, 77) + '...';
  }

  // Descriptive input.name (not a generic ID)
  if (input.name && !/^(worker|agent|hypothesis)-\d+$/i.test(input.name)) {
    return input.name;
  }

  // Extract from prompt
  if (input.prompt) {
    const first = input.prompt.split('\n')[0].trim();
    if (first.length <= 80) return first;
    return first.slice(0, 77) + '...';
  }

  return input.name || 'Task';
}
