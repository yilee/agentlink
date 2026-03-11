/**
 * Tests for loopTemplates.js — cron expression building, schedule formatting, and template definitions.
 */

import { describe, it, expect } from 'vitest';
import {
  LOOP_TEMPLATES,
  LOOP_TEMPLATE_KEYS,
  buildCronExpression,
  formatSchedule,
} from '../../server/web/modules/loopTemplates.js';

describe('loopTemplates', () => {
  describe('LOOP_TEMPLATES', () => {
    it('has all expected template keys', () => {
      expect(LOOP_TEMPLATE_KEYS).toEqual(['competitive-intel', 'knowledge-base', 'daily-summary']);
    });

    it('all template keys exist in the templates object', () => {
      for (const key of LOOP_TEMPLATE_KEYS) {
        expect(LOOP_TEMPLATES[key]).toBeDefined();
        expect(LOOP_TEMPLATES[key].label).toBeTruthy();
        expect(LOOP_TEMPLATES[key].description).toBeTruthy();
      }
    });

    it('all templates have name and prompt', () => {
      for (const key of LOOP_TEMPLATE_KEYS) {
        expect(LOOP_TEMPLATES[key].name).toBeTruthy();
        expect(LOOP_TEMPLATES[key].prompt).toBeTruthy();
      }
    });

    it('all templates have valid scheduleType', () => {
      const validTypes = ['manual', 'hourly', 'daily', 'weekly', 'cron'];
      for (const key of LOOP_TEMPLATE_KEYS) {
        expect(validTypes).toContain(LOOP_TEMPLATES[key].scheduleType);
      }
    });
  });

  describe('buildCronExpression', () => {
    it('returns empty string for manual', () => {
      expect(buildCronExpression('manual', {})).toBe('');
    });

    it('builds hourly expression', () => {
      expect(buildCronExpression('hourly', { minute: 15 })).toBe('15 * * * *');
    });

    it('builds hourly with default minute', () => {
      expect(buildCronExpression('hourly', {})).toBe('0 * * * *');
    });

    it('builds daily expression', () => {
      expect(buildCronExpression('daily', { hour: 9, minute: 30 })).toBe('30 9 * * *');
    });

    it('builds daily with defaults', () => {
      expect(buildCronExpression('daily', {})).toBe('0 9 * * *');
    });

    it('builds weekly expression', () => {
      expect(buildCronExpression('weekly', { hour: 14, minute: 0, dayOfWeek: 5 })).toBe('0 14 * * 5');
    });

    it('builds weekly with default dayOfWeek (Monday)', () => {
      expect(buildCronExpression('weekly', { hour: 10, minute: 0 })).toBe('0 10 * * 1');
    });

    it('passes through custom cron expression', () => {
      expect(buildCronExpression('cron', { cronExpression: '*/5 * * * *' })).toBe('*/5 * * * *');
    });

    it('falls back to default for cron type without cronExpression', () => {
      expect(buildCronExpression('cron', { hour: 8, minute: 15 })).toBe('15 8 * * *');
    });

    it('falls back to default for unknown type', () => {
      expect(buildCronExpression('unknown', { hour: 12, minute: 45 })).toBe('45 12 * * *');
    });

    it('handles zero values correctly', () => {
      expect(buildCronExpression('daily', { hour: 0, minute: 0 })).toBe('0 0 * * *');
    });

    it('handles dayOfWeek 0 (Sunday)', () => {
      expect(buildCronExpression('weekly', { hour: 8, minute: 0, dayOfWeek: 0 })).toBe('0 8 * * 0');
    });
  });

  describe('formatSchedule', () => {
    it('formats manual', () => {
      expect(formatSchedule('manual', {}, '')).toBe('Manual only');
    });

    it('formats hourly', () => {
      expect(formatSchedule('hourly', {}, '')).toBe('Every hour');
    });

    it('formats daily', () => {
      expect(formatSchedule('daily', { hour: 9, minute: 0 }, '')).toBe('Every day at 09:00');
    });

    it('formats daily with non-padded values', () => {
      expect(formatSchedule('daily', { hour: 14, minute: 5 }, '')).toBe('Every day at 14:05');
    });

    it('formats daily with defaults', () => {
      expect(formatSchedule('daily', {}, '')).toBe('Every day at 09:00');
    });

    it('formats weekly', () => {
      expect(formatSchedule('weekly', { hour: 20, minute: 0, dayOfWeek: 5 }, '')).toBe(
        'Every Friday at 20:00',
      );
    });

    it('formats weekly with default day (Monday)', () => {
      expect(formatSchedule('weekly', { hour: 10, minute: 30 }, '')).toBe(
        'Every Monday at 10:30',
      );
    });

    it('formats weekly Sunday', () => {
      expect(formatSchedule('weekly', { hour: 8, minute: 0, dayOfWeek: 0 }, '')).toBe(
        'Every Sunday at 08:00',
      );
    });

    it('formats cron type with expression', () => {
      expect(formatSchedule('cron', {}, '*/5 * * * *')).toBe('*/5 * * * *');
    });

    it('formats cron type without expression', () => {
      expect(formatSchedule('cron', {}, '')).toBe('Custom cron');
    });

    it('formats unknown type with cronExpr', () => {
      expect(formatSchedule('other', {}, '0 12 * * *')).toBe('0 12 * * *');
    });

    it('formats unknown type without cronExpr', () => {
      expect(formatSchedule('other', {}, '')).toBe('Unknown schedule');
    });

    it('pads single-digit hours and minutes', () => {
      expect(formatSchedule('daily', { hour: 3, minute: 7 }, '')).toBe('Every day at 03:07');
    });

    it('handles midnight correctly', () => {
      expect(formatSchedule('daily', { hour: 0, minute: 0 }, '')).toBe('Every day at 00:00');
    });
  });
});
