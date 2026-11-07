import { judgeFreshness, FreshnessInput, FreshnessRun } from '../cost-finding-freshness';
import type { CostAnalysisCheck } from '../cost-analysis-outcome';
import { lowActivityMetadata } from './helpers/low-activity-fixture';

const IDLE = 'Idle Instance';
const S3 = 'S3 Lifecycle Optimization';
const DECIDED = '2026-09-03T18:54:05.000Z';
const OBSERVED = '2026-11-04T00:00:02.000Z';
/** An Idle detection made by the low-activity rule (FP PR 2b): the only kind that confirms an Idle finding. */
const LOW_ACTIVITY = lowActivityMetadata({ evaluatedAt: new Date(OBSERVED) });

const check = (issue: string, outcome: 'complete' | 'failed' = 'complete', detected = 1, unknown = 0): CostAnalysisCheck => ({
  rule_id: null, issue, outcome, detected, unknown,
});

const run = (overrides: Partial<FreshnessRun> = {}): FreshnessRun => ({
  id: 'run-latest',
  run_state: 'completed',
  checks: [check(IDLE), check(S3)],
  ...overrides,
});

const input = (overrides: Partial<FreshnessInput> = {}): FreshnessInput => ({
  issue: IDLE,
  decidedAt: DECIDED,
  observation: { run_id: 'run-latest', outcome: 'detected', observed_at: OBSERVED, metadata: LOW_ACTIVITY },
  latestRun: run(),
  ...overrides,
});

describe('judgeFreshness', () => {
  it('still detected: the latest leased run completed, its check completed, and it detected this resource after the decision', () => {
    expect(judgeFreshness(input())).toEqual({ state: 'still_detected', reason: null });
  });

  it('a partial run confirms the issues whose check completed', () => {
    expect(judgeFreshness(input({ latestRun: run({ run_state: 'partial', checks: [check(IDLE), check(S3, 'failed', 0)] }) })))
      .toEqual({ state: 'still_detected', reason: null });
  });

  it("another resource's unknown result in the same check does not touch this finding (S3: detected 1, unknown 1)", () => {
    const latestRun = run({ checks: [check(IDLE, 'complete', 1, 0), check(S3, 'complete', 1, 1)] });
    expect(judgeFreshness(input({ issue: S3, latestRun }))).toEqual({ state: 'still_detected', reason: null });
  });

  it("this resource's own unknown result in the latest run: not fully checked", () => {
    expect(judgeFreshness(input({ observation: { run_id: 'run-latest', outcome: 'unknown', observed_at: OBSERVED } })))
      .toEqual({ state: 'not_confirmed', reason: 'not_fully_checked' });
  });

  it('the latest run\'s check for the issue failed: check failed, never still detected or cleared', () => {
    const latestRun = run({ run_state: 'partial', checks: [check(IDLE, 'failed', 0), check(S3)] });
    expect(judgeFreshness(input({ latestRun }))).toEqual({ state: 'not_confirmed', reason: 'check_failed' });
  });

  it.each(['running', 'interrupted', 'failed'] as const)('a %s latest run confirms nothing', (runState) => {
    expect(judgeFreshness(input({ latestRun: run({ run_state: runState }) })))
      .toEqual({ state: 'not_confirmed', reason: 'analysis_incomplete' });
  });

  it('a latest run with no checks recorded, or none for this issue, confirms nothing', () => {
    expect(judgeFreshness(input({ latestRun: run({ checks: null }) }))).toEqual({ state: 'not_confirmed', reason: 'analysis_incomplete' });
    expect(judgeFreshness(input({ latestRun: run({ checks: [check(S3)] }) }))).toEqual({ state: 'not_confirmed', reason: 'analysis_incomplete' });
  });

  it('a detection from an earlier run, never this resource in the latest: not checked since', () => {
    expect(judgeFreshness(input({ observation: { run_id: 'run-earlier', outcome: 'detected', observed_at: OBSERVED } })))
      .toEqual({ state: 'not_confirmed', reason: 'not_checked_since' });
  });

  it('no observation at all (historical rows alone): not checked since', () => {
    expect(judgeFreshness(input({ observation: null }))).toEqual({ state: 'not_confirmed', reason: 'not_checked_since' });
  });

  it('an observation with no run record never confirms', () => {
    expect(judgeFreshness(input({ observation: { run_id: null, outcome: 'detected', observed_at: OBSERVED } })))
      .toEqual({ state: 'not_confirmed', reason: 'not_checked_since' });
  });

  it('a detection older than the latest decision (resolved again after a reopen) does not confirm it', () => {
    expect(judgeFreshness(input({ decidedAt: '2026-11-04T00:00:05.000Z' })))
      .toEqual({ state: 'not_confirmed', reason: 'not_checked_since' });
    expect(judgeFreshness(input({ decidedAt: OBSERVED }))).toEqual({ state: 'not_confirmed', reason: 'not_checked_since' });
  });

  it('no leased run at all: not checked since', () => {
    expect(judgeFreshness(input({ latestRun: null }))).toEqual({ state: 'not_confirmed', reason: 'not_checked_since' });
  });

  it('accepts Date values from pg as well as strings', () => {
    expect(judgeFreshness(input({ decidedAt: new Date(DECIDED), observation: { run_id: 'run-latest', outcome: 'detected', observed_at: new Date(OBSERVED), metadata: LOW_ACTIVITY } })))
      .toEqual({ state: 'still_detected', reason: null });
  });
});

describe('judgeFreshness -- an Idle detection needs the low-activity rule identity (FP2b-Q14)', () => {
  it.each([
    ['no metadata (written before the detections carried any)', undefined],
    ['the CPU-only evidence of the earlier check', { average_cpu: 1.2, days_analyzed: 7, cpu_evidence: { window_end: OBSERVED } }],
    ['the stop marker without the rule object', { rule_version: 2 }],
    ['another rule version', { ...LOW_ACTIVITY, rule_version: 3 }],
  ])('%s: "not checked since", never still detected', (_label, metadata) => {
    expect(judgeFreshness(input({ observation: { run_id: 'run-latest', outcome: 'detected', observed_at: OBSERVED, metadata } })))
      .toEqual({ state: 'not_confirmed', reason: 'not_checked_since' });
  });

  it('a low-activity detection in the latest run is still detected', () => {
    expect(judgeFreshness(input())).toEqual({ state: 'still_detected', reason: null });
  });

  it("other issues do not need it: an S3 detection with no rule identity is still detected", () => {
    expect(judgeFreshness(input({ issue: S3, observation: { run_id: 'run-latest', outcome: 'detected', observed_at: OBSERVED, metadata: { savings_basis: 'ceiling: x' } } })))
      .toEqual({ state: 'still_detected', reason: null });
  });

  it('an unknown Idle observation by the new rule keeps "not fully checked" (C23), whatever evidence it kept', () => {
    expect(judgeFreshness(input({ observation: { run_id: 'run-latest', outcome: 'unknown', observed_at: OBSERVED, metadata: { average_cpu: 1 } } })))
      .toEqual({ state: 'not_confirmed', reason: 'not_fully_checked' });
  });
});
