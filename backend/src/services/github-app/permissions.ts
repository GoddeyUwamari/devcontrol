/**
 * The App's permissions (d8a-build.md D8-D3, founder-approved 2026-11-20):
 * repository Metadata, Actions, Deployments and Pull requests, all read. No
 * code access, nothing else. A claim records what GitHub reports and marks
 * any difference 'mismatch' (D8-N16) instead of refusing silently.
 */
export const EXPECTED_PERMISSIONS: Readonly<Record<string, 'read'>> = {
  actions: 'read',
  deployments: 'read',
  metadata: 'read',
  pull_requests: 'read',
};

/** One permission whose access differs from EXPECTED_PERMISSIONS (granted null: missing; expected null: not asked for). */
export interface PermissionDifference {
  permission: string;
  granted: string | null;
  expected: 'read' | null;
}

/**
 * What differs between the granted set and EXPECTED_PERMISSIONS, by permission
 * name (D8b: the mismatch banner names them). Empty exactly when
 * permissionsStateOf is 'expected'.
 */
export function permissionDifferences(granted: Readonly<Record<string, string>>): PermissionDifference[] {
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const names = [...new Set([...Object.keys(granted), ...Object.keys(EXPECTED_PERMISSIONS)])].sort();
  return names
    .map((permission) => ({
      permission,
      granted: has(granted, permission) ? String(granted[permission]) : null,
      expected: has(EXPECTED_PERMISSIONS, permission) ? EXPECTED_PERMISSIONS[permission] : null,
    }))
    .filter((d) => d.granted !== d.expected);
}

export function permissionsStateOf(granted: Readonly<Record<string, string>>): 'expected' | 'mismatch' {
  const names = Object.keys(granted).sort();
  const expected = Object.keys(EXPECTED_PERMISSIONS).sort();
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) return 'mismatch';
  return expected.every((n) => granted[n] === EXPECTED_PERMISSIONS[n]) ? 'expected' : 'mismatch';
}
