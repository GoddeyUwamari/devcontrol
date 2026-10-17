/**
 * Pins the lint-and-build gate job in .github/workflows/ci.yml.
 *
 * lint-and-build is the ruleset's required status check and what every
 * production deploy job needs. The real work runs in parallel jobs; this
 * gate only joins them. GitHub treats a SKIPPED required check as passing,
 * so the gate must always run (always(), not success() or !cancelled()) and
 * must fail unless every needed job's result is exactly 'success'.
 *
 * ci.yml is parsed as text, like the other ci.yml tests in this directory,
 * and the gate's own run script is executed with bash for each result.
 * No Postgres, network or AWS.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../../../../');
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

const GATE_NEEDS = ['lint', 'release-compatibility', 'frontend-tests', 'build', 'backend-tests'];

function extractJobBlock(ciYml: string, jobName: string): string {
  const match = ciYml.match(new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  \\S|$)`));
  if (!match) throw new Error(`Could not locate job "${jobName}" in ci.yml`);
  return match[0];
}

/** The gate step's env (VAR -> need name) and its run script, from the gate job block. */
function parseGateStep(gate: string): { envToNeed: Record<string, string>; script: string } {
  const envToNeed: Record<string, string> = {};
  for (const m of gate.matchAll(/\n {10}([A-Z_]+): \$\{\{ needs\.([a-z-]+)\.result \}\}/g)) {
    envToNeed[m[1]] = m[2];
  }
  const run = gate.match(/\n {8}run: \|\n((?: {10}.*\n?|\n)+)/);
  if (!run) throw new Error('Could not locate the gate step run script');
  const script = run[1]
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
  return { envToNeed, script };
}

/** Runs the gate script with each need's result; returns the exit status. */
function runGate(script: string, envToNeed: Record<string, string>, results: Record<string, string>): number | null {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  for (const [name, need] of Object.entries(envToNeed)) env[name] = results[need] ?? '';
  // GitHub runs `run:` steps with `bash -e {0}`.
  return spawnSync('bash', ['-e', '-c', script], { env, encoding: 'utf8' }).status;
}

/** Every assertion on the gate, as one function so it can be run against altered copies of ci.yml. */
function assertGate(ciYml: string): void {
  // Named exactly lint-and-build, with no `name:` that would change the check name.
  expect(ciYml.match(/^ {2}lint-and-build:$/gm)).toHaveLength(1);
  const gate = extractJobBlock(ciYml, 'lint-and-build');
  expect(gate).not.toMatch(/\n {4}name:/);

  // Always runs: a skipped required check would pass.
  expect(gate.match(/\n {4}if: .*/g)).toEqual(['\n    if: ${{ always() }}']);

  // Needs exactly the five parallel jobs.
  const needs = gate.match(/\n {4}needs: \[(.*)\]\n/);
  expect(needs).toBeTruthy();
  expect(needs![1].split(',').map((n) => n.trim()).sort()).toEqual([...GATE_NEEDS].sort());

  // The step reads each of the five results, and passes only when all are 'success'.
  const { envToNeed, script } = parseGateStep(gate);
  expect(Object.values(envToNeed).sort()).toEqual([...GATE_NEEDS].sort());
  const allSuccess = Object.fromEntries(GATE_NEEDS.map((n) => [n, 'success']));
  expect(runGate(script, envToNeed, allSuccess)).toBe(0);
  for (const need of GATE_NEEDS) {
    for (const result of ['failure', 'cancelled', 'skipped', '']) {
      expect({ need, result, status: runGate(script, envToNeed, { ...allSuccess, [need]: result }) }).toEqual({
        need,
        result,
        status: 1,
      });
    }
  }
}

describe('.github/workflows/ci.yml — lint-and-build gate', () => {
  const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');

  it('is named lint-and-build, always runs, needs exactly the five jobs, and fails unless all five succeeded', () => {
    assertGate(ciYml);
  });

  describe('the assertions above catch a regression', () => {
    it('if: reverted to !cancelled()', () => {
      const altered = ciYml.replace('    if: ${{ always() }}', '    if: ${{ !cancelled() }}');
      expect(altered).not.toBe(ciYml);
      expect(() => assertGate(altered)).toThrow();
    });

    it('a need removed from needs:', () => {
      const altered = ciYml.replace(
        'needs: [lint, release-compatibility, frontend-tests, build, backend-tests]',
        'needs: [lint, release-compatibility, frontend-tests, build]'
      );
      expect(altered).not.toBe(ciYml);
      expect(() => assertGate(altered)).toThrow();
    });

    it("a need's result no longer checked by the step", () => {
      const altered = ciYml.replace(
        'for job in LINT RELEASE_COMPATIBILITY FRONTEND_TESTS BUILD BACKEND_TESTS; do',
        'for job in LINT RELEASE_COMPATIBILITY FRONTEND_TESTS BUILD; do'
      );
      expect(altered).not.toBe(ciYml);
      expect(() => assertGate(altered)).toThrow();
    });
  });
});
