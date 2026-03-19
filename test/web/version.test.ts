import { describe, it, expect } from 'vitest';
import { parseVersion, compareVersions, meetsMinVersion } from '../../server/web/src/modules/version.js';

describe('parseVersion', () => {
  it('parses a valid semver string', () => {
    expect(parseVersion('0.1.112')).toEqual({ major: 0, minor: 1, patch: 112 });
  });

  it('parses major-only', () => {
    expect(parseVersion('3')).toEqual({ major: 3, minor: 0, patch: 0 });
  });

  it('parses major.minor', () => {
    expect(parseVersion('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
  });

  it('returns null for empty string', () => {
    expect(parseVersion('')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it('returns null for non-numeric', () => {
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.2.x')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns positive when a > b (major)', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  });

  it('returns positive when a > b (minor)', () => {
    expect(compareVersions('0.2.0', '0.1.999')).toBeGreaterThan(0);
  });

  it('returns positive when a > b (patch)', () => {
    expect(compareVersions('0.1.112', '0.1.111')).toBeGreaterThan(0);
  });

  it('returns negative when a < b', () => {
    expect(compareVersions('0.1.100', '0.1.112')).toBeLessThan(0);
  });

  it('returns 0 when either version is invalid', () => {
    expect(compareVersions('', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', null)).toBe(0);
  });
});

describe('meetsMinVersion', () => {
  it('returns true when current equals minimum', () => {
    expect(meetsMinVersion('0.1.112', '0.1.112')).toBe(true);
  });

  it('returns true when current exceeds minimum', () => {
    expect(meetsMinVersion('0.1.113', '0.1.112')).toBe(true);
    expect(meetsMinVersion('0.2.0', '0.1.112')).toBe(true);
    expect(meetsMinVersion('1.0.0', '0.1.112')).toBe(true);
  });

  it('returns false when current is below minimum', () => {
    expect(meetsMinVersion('0.1.111', '0.1.112')).toBe(false);
    expect(meetsMinVersion('0.0.999', '0.1.112')).toBe(false);
  });

  it('returns true when either version is invalid (fail-open)', () => {
    expect(meetsMinVersion('', '0.1.112')).toBe(true);
    expect(meetsMinVersion(null, '0.1.112')).toBe(true);
  });
});
