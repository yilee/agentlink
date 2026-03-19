/**
 * Semantic version comparison utilities.
 * Pure functions — no dependencies.
 */

export function parseVersion(str) {
  if (!str) return null;
  const parts = str.split('.').map(Number);
  if (parts.some(isNaN)) return null;
  return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

export function meetsMinVersion(current, minimum) {
  return compareVersions(current, minimum) >= 0;
}
