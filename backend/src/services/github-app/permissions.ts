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

export function permissionsStateOf(granted: Readonly<Record<string, string>>): 'expected' | 'mismatch' {
  const names = Object.keys(granted).sort();
  const expected = Object.keys(EXPECTED_PERMISSIONS).sort();
  if (names.length !== expected.length || names.some((n, i) => n !== expected[i])) return 'mismatch';
  return expected.every((n) => granted[n] === EXPECTED_PERMISSIONS[n]) ? 'expected' : 'mismatch';
}
