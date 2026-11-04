/**
 * The Cost Optimization scan state (pr2-step1.md §1, approved 2026-11-02):
 * one case per state, the precedence rules, and the rules that keep a failure
 * from reading as zero, never or clean.
 */
import { describe, it, expect } from 'vitest'
import { deriveCostScanState, runCounts, runsRefetchInterval, safeRunMessage, RUNNING_REFETCH_MS, type CostScanInput } from '../costScanState'
import { LEGACY_RUN, PRODUCTION_HIDDEN, RAW_JOB_TEXT, checks, job, run } from './fixtures'

const ok = <T,>(data: T) => ({ data, isError: false })
const failed = { data: undefined, isError: true }
const pending = { data: undefined, isError: false }

function input(overrides: Partial<CostScanInput> = {}): CostScanInput {
  return {
    connection: ok('connected' as const),
    runs: ok([run()]),
    jobs: ok([]),
    isAnalyzing: false,
    ...overrides,
  }
}

const key = (overrides: Partial<CostScanInput> = {}) => deriveCostScanState(input(overrides)).key

describe('deriveCostScanState: one case per state', () => {
  it('1 loading: the connection check pending', () => expect(key({ connection: pending })).toBe('loading'))
  it('1 loading: runs pending', () => expect(key({ runs: pending })).toBe('loading'))
  it('2 not connected: the server reports no active connection', () => expect(key({ connection: ok('not_connected' as const) })).toBe('not_connected'))
  it('2b more than one active connection: status unavailable, never connected or not connected', () =>
    expect(key({ connection: ok('ambiguous' as const) })).toBe('status_unavailable'))
  it('2c a finished run left from an earlier connection never makes it connected', () =>
    expect(key({ connection: ok('not_connected' as const), runs: ok([run({ detected_count: 3, new_count: 3, persisted_count: 3 })]) })).toBe('not_connected'))
  it('3 never scanned: runs and jobs both loaded and empty', () => expect(key({ runs: ok([]), jobs: ok([]) })).toBe('never_analyzed'))
  it('4 running: a running run', () => expect(key({ runs: ok([run({ run_state: 'running', status: 'running', completed_at: null })]) })).toBe('running'))
  it('4 running: the button was just clicked, whatever the history says', () => expect(key({ isAnalyzing: true, runs: ok([PRODUCTION_HIDDEN]) })).toBe('running'))
  it('5 completed, new findings', () => expect(key({ runs: ok([run({ detected_count: 3, new_count: 2, refreshed_count: 1, persisted_count: 3 })]) })).toBe('completed_new'))
  it('5b completed, open findings but none new', () => expect(key({ runs: ok([run({ detected_count: 1, refreshed_count: 1, persisted_count: 1 })]) })).toBe('completed_open'))
  it('6 completed, hidden findings (production today)', () => expect(key({ runs: ok([PRODUCTION_HIDDEN]) })).toBe('completed_hidden'))
  it('6b completed, resources not fully checked', () => expect(key({ runs: ok([run({ unknown_resource_count: 2 })]) })).toBe('completed_unchecked'))
  it('7 completed, nothing detected: the only clean state', () => expect(key()).toBe('completed_clean'))
  it('7b completed, legacy row without counts', () => expect(key({ runs: ok([LEGACY_RUN]) })).toBe('completed_unrecorded'))
  it('8 partial', () => expect(key({ runs: ok([run({ run_state: 'partial', status: 'failed', failed_detector_count: 1, checks: checks(1) })]) })).toBe('partial'))
  it('9 failed', () => expect(key({ runs: ok([run({ run_state: 'failed', status: 'failed', detected_count: null })]) })).toBe('failed'))
  it('10 interrupted', () => expect(key({ runs: ok([run({ run_state: 'interrupted', status: 'failed', completed_at: null })]) })).toBe('interrupted'))
  it('11 scheduled run whose cost step threw: failed, labelled scheduled, with the fixed message only', () => {
    const s = deriveCostScanState(input({ runs: ok([run({ run_state: 'failed', status: 'failed', source: 'discovery', error_message: 'The analysis did not complete due to an unexpected error.' })]) }))
    expect(s).toMatchObject({ key: 'failed', source: 'scheduled', errorMessage: 'The analysis did not complete due to an unexpected error.' })
  })
  it('13 run-history fetch failed', () => expect(key({ runs: failed })).toBe('status_unavailable'))
  it('14 connection check failed', () => expect(key({ connection: failed })).toBe('status_unavailable'))
})

describe('never green unless every check ran and nothing was detected or hidden', () => {
  it('hidden findings are never clean', () => {
    expect(key({ runs: ok([run({ detected_count: 1, suppressed_dismissed_count: 1 })]) })).not.toBe('completed_clean')
    expect(key({ runs: ok([run({ detected_count: 1, suppressed_resolved_count: 1 })]) })).not.toBe('completed_clean')
  })
  it('unknown resources are never clean', () => expect(key({ runs: ok([run({ unknown_resource_count: 1 })]) })).not.toBe('completed_clean'))
  it('a missing count is never clean (null)', () => expect(key({ runs: ok([run({ suppressed_resolved_count: null })]) })).toBe('completed_unrecorded'))
  it('a missing count is never clean (unknown_resource_count null)', () => expect(key({ runs: ok([run({ unknown_resource_count: null })]) })).toBe('completed_unrecorded'))
  it('missing checks are never clean', () => expect(key({ runs: ok([run({ checks: null })]) })).toBe('completed_unrecorded'))
  it('a check that did not complete is never clean', () => expect(key({ runs: ok([run({ checks: checks(1) })]) })).toBe('completed_other'))
  it('a partial run is never clean, even with zero counts', () => expect(key({ runs: ok([run({ run_state: 'partial', status: 'failed' })]) })).toBe('partial'))
  it('duplicates only: never clean', () => expect(key({ runs: ok([run({ detected_count: 1, duplicate_count: 1 })]) })).toBe('completed_other'))
})

describe('a failure never reads as never, empty or loading', () => {
  it('runs error with no jobs is not "never analyzed"', () => expect(key({ runs: failed, jobs: ok([]) })).toBe('status_unavailable'))
  it('runs empty but jobs error is not "never analyzed"', () => expect(key({ runs: ok([]), jobs: failed })).toBe('status_unavailable'))
  it('runs empty and jobs pending is still loading', () => expect(key({ runs: ok([]), jobs: pending })).toBe('loading'))
  it('accounts error is not loading forever and not "not connected"', () => {
    expect(key({ connection: failed, runs: ok([run()]) })).toBe('status_unavailable')
  })
})

describe('status source: cost analysis runs only (decision 10)', () => {
  it('a failed discovery job never makes the scan failed while a run exists', () => {
    const s = deriveCostScanState(input({ runs: ok([run()]), jobs: ok([job({ status: 'failed', error_message: RAW_JOB_TEXT, created_at: '2026-11-03T00:00:00.000Z' })]) }))
    expect(s.key).toBe('completed_clean')
    expect(JSON.stringify(s)).not.toContain('arn:aws')
  })
  it('the latest run wins whatever its source: a scheduled run is read', () => {
    const s = deriveCostScanState(input({ runs: ok([run({ source: 'discovery', detected_count: 1, new_count: 1, persisted_count: 1 }), run()]) }))
    expect(s).toMatchObject({ key: 'completed_new', source: 'scheduled' })
  })
  it('legacy fallback (no run rows): a completed job reads only cost_analysis_completed', () => {
    expect(deriveCostScanState(input({ runs: ok([]), jobs: ok([job()]) }))).toMatchObject({ key: 'completed_unrecorded', source: 'scheduled' })
  })
  it('legacy fallback: cost not completed is failed, with no job text', () => {
    const s = deriveCostScanState(input({ runs: ok([]), jobs: ok([job({ cost_analysis_completed: false, error_message: RAW_JOB_TEXT })]) }))
    expect(s).toMatchObject({ key: 'failed', errorMessage: null })
  })
  it('legacy fallback: a failed job whose cost step completed is not failed', () => {
    expect(key({ runs: ok([]), jobs: ok([job({ status: 'failed', cost_analysis_completed: true, error_message: RAW_JOB_TEXT })]) })).toBe('completed_unrecorded')
  })
  it('legacy fallback: only running jobs means never analyzed', () => {
    expect(key({ runs: ok([]), jobs: ok([job({ status: 'running', completed_at: null })]) })).toBe('never_analyzed')
  })
})

describe('counts come from the latest run only', () => {
  it('a hidden count is not carried over from an older run', () => {
    const s = deriveCostScanState(input({ runs: ok([run({ run_state: 'failed', status: 'failed', detected_count: null, new_count: null }), PRODUCTION_HIDDEN]) }))
    expect(s.counts).toBeNull()
  })
  it('hidden = resolved + dismissed; NULL stays unrecorded, never 0', () => {
    expect(runCounts(PRODUCTION_HIDDEN)).toMatchObject({ hidden: 2, detected: 2, persisted: 0 })
    expect(runCounts(run({ suppressed_dismissed_count: null }))).toBeNull()
  })
})

describe('safeRunMessage: exact allowlist', () => {
  it.each([
    "The analysis ran, but its results couldn't be saved. Try again.",
    'None of the cost checks could complete. Try again.',
    'The analysis did not complete due to an unexpected error.',
  ])('keeps %s', (message) => expect(safeRunMessage(message)).toBe(message))
  it.each([
    RAW_JOB_TEXT,
    'None of the cost checks could complete. Try again. arn:aws:iam::123456789012:role/placeholder-role',
    'Failed to analyze AWS resources: AccessDenied',
    '',
    null,
  ])('drops %j', (message) => expect(safeRunMessage(message)).toBeNull())
  it('a failed run with raw text keeps no message', () => {
    expect(deriveCostScanState(input({ runs: ok([run({ run_state: 'failed', status: 'failed', error_message: RAW_JOB_TEXT })]) })).errorMessage).toBeNull()
  })
})

describe('polling while running (decision 9)', () => {
  it('polls every 15s only while the latest run is running', () => {
    expect(RUNNING_REFETCH_MS).toBe(15_000)
    expect(runsRefetchInterval([run({ run_state: 'running', status: 'running' })])).toBe(15_000)
    expect(runsRefetchInterval([run()])).toBe(false)
    expect(runsRefetchInterval([])).toBe(false)
    expect(runsRefetchInterval(undefined)).toBe(false)
  })
})
