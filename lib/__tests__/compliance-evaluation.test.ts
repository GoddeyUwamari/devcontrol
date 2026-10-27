/**
 * lib/compliance/evaluation: the shared score (D1), framework state and poll rules (Security V2 F3,
 * founder decisions of Oct 27, 2026). Placeholders only.
 */
import { describe, it, expect } from 'vitest'
import type { ComplianceScan } from '@/lib/services/compliance-frameworks.service'
import {
  EVALUATION_COPY,
  EVALUATION_POLL_CEILING_MS,
  EVALUATION_POLL_FAST_FOR_MS,
  EVALUATION_POLL_FAST_MS,
  EVALUATION_POLL_SLOW_MS,
  FRAMEWORK_STALE_AFTER_MS,
  activeRunStarts,
  evaluateFramework,
  evaluationPollInterval,
  scanScore,
} from '@/lib/compliance/evaluation'

const NOW = Date.parse('2026-10-27T15:00:00Z')
const DAY = 86_400_000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const run = (framework_id: string, status: ComplianceScan['status'], msAgo: number, counts: [unknown, unknown] = [9, 1], id = `${framework_id}-${status}-${msAgo}`): ComplianceScan => ({
  id, organization_id: 'org-1', framework_id, scan_type: 'manual', status, total_resources: 10,
  compliant_resources: counts[0] as number, non_compliant_resources: counts[1] as number,
  compliance_score: '0.00' as unknown as number, critical_issues: 0, high_issues: 4, medium_issues: 0, low_issues: 0,
  started_at: iso(msAgo), completed_at: status === 'completed' || status === 'failed' ? iso(msAgo) : null, duration_seconds: 1, created_at: iso(msAgo),
})

describe('scanScore (D1): compliant ÷ (compliant + non-compliant), from the stored counts', () => {
  it('a whole percent, never rounded up', () => {
    expect(scanScore({ compliant_resources: 9, non_compliant_resources: 1 })).toEqual({ kind: 'score', value: '90' })
    expect(scanScore({ compliant_resources: 2, non_compliant_resources: 1 })).toEqual({ kind: 'score', value: '66' })
    expect(scanScore({ compliant_resources: 995, non_compliant_resources: 5 })).toEqual({ kind: 'score', value: '99' })
    expect(scanScore({ compliant_resources: 1, non_compliant_resources: 0 })).toEqual({ kind: 'score', value: '100' })
  })
  it('a genuine 0: nothing compliant, something counted', () => {
    expect(scanScore({ compliant_resources: 0, non_compliant_resources: 4 })).toEqual({ kind: 'score', value: '0' })
  })
  it('nothing counted is "no rules applied", never 0 or 100', () => {
    expect(scanScore({ compliant_resources: 0, non_compliant_resources: 0 })).toEqual({ kind: 'no_rules' })
    expect(EVALUATION_COPY.noRulesApplied).toBe('No rules applied to your resources.')
  })
  it('resources no rule evaluated are not in the denominator (the 0.00% case)', () => {
    // 10 resources scanned, 1 counted and compliant: the stored score said 10%, the counts say 100%.
    expect(scanScore({ ...run('a', 'completed', DAY, [1, 0]), resources_scanned: 10 } as never)).toEqual({ kind: 'score', value: '100' })
  })
  it('missing or unusable counts are unknown', () => {
    for (const bad of [null, undefined, -1, 1.5, NaN, Infinity, '', 'abc', {}]) {
      expect(scanScore({ compliant_resources: bad as number, non_compliant_resources: 1 }), String(bad)).toEqual({ kind: 'unknown' })
      expect(scanScore({ compliant_resources: 1, non_compliant_resources: bad as number }), String(bad)).toEqual({ kind: 'unknown' })
    }
    expect(scanScore({ compliant_resources: '3' as unknown as number, non_compliant_resources: '1' as unknown as number })).toEqual({ kind: 'score', value: '75' })
  })
})

describe('evaluateFramework: the five states (safeguard 2) plus not found', () => {
  it('current: the newest run completed under 7 days ago; the score comes with it', () => {
    expect(evaluateFramework('a', [run('a', 'completed', DAY)], NOW)).toMatchObject({ state: 'current', score: { kind: 'score', value: '90' } })
  })
  it('out of date at exactly 7 days, with no score', () => {
    expect(evaluateFramework('a', [run('a', 'completed', FRAMEWORK_STALE_AFTER_MS - 1)], NOW).state).toBe('current')
    expect(evaluateFramework('a', [run('a', 'completed', FRAMEWORK_STALE_AFTER_MS)], NOW)).toMatchObject({ state: 'out_of_date', score: null })
  })
  it('running: no score, even with an earlier completed run', () => {
    const e = evaluateFramework('a', [run('a', 'completed', DAY), run('a', 'pending', 1000)], NOW)
    expect(e).toMatchObject({ state: 'running', score: null, startedAt: NOW - 1000, overdue: false })
    expect(e.lastDone?.id).toBe(`a-completed-${DAY}`)
  })
  it('failed after an earlier success: no score; the earlier run is still the last evaluation', () => {
    const e = evaluateFramework('a', [run('a', 'completed', 2 * DAY), run('a', 'failed', DAY)], NOW)
    expect(e).toMatchObject({ state: 'failed', score: null, lastEvaluatedAt: NOW - 2 * DAY })
  })
  it('a retry that failed after a completed one that came after an older failure: still failed, no score', () => {
    const e = evaluateFramework('a', [run('a', 'failed', 3 * DAY), run('a', 'completed', 2 * DAY), run('a', 'failed', DAY)], NOW)
    expect(e).toMatchObject({ state: 'failed', score: null })
  })
  it('never only when the history is complete; otherwise not found', () => {
    expect(evaluateFramework('a', [], NOW, true).state).toBe('never')
    expect(evaluateFramework('a', [], NOW, false).state).toBe('not_found')
    expect(evaluateFramework('a', [run('b', 'completed', DAY)], NOW, true).state).toBe('never')
  })
  it('a completed run with unusable counts is not found (there was an evaluation), never never', () => {
    expect(evaluateFramework('a', [run('a', 'completed', DAY, [null, null])], NOW, true)).toMatchObject({ state: 'not_found', score: null })
  })
  it('a run started on this page and not listed yet is Running from that moment', () => {
    expect(evaluateFramework('a', [run('a', 'completed', DAY)], NOW, true, { at: NOW - 2000, scanId: 's-new' })).toMatchObject({ state: 'running', startedAt: NOW - 2000, score: null })
    // A 409 (no run id) with nothing active in the list: Running from the answer until the list is read again.
    expect(evaluateFramework('a', [run('a', 'completed', DAY)], NOW, true, { at: NOW - 2000, scanId: null })).toMatchObject({ state: 'running', startedAt: NOW - 2000 })
  })
  it('the newer of a listed active run and a new run started here is the start time', () => {
    expect(evaluateFramework('a', [run('a', 'running', 20 * 60_000)], NOW, true, { at: NOW - 1000, scanId: 's-new' }).startedAt).toBe(NOW - 1000)
  })
  it('a 409 (no run id) never restarts a listed active run: past the ceiling it stays overdue', () => {
    const e = evaluateFramework('a', [run('a', 'running', 20 * 60_000)], NOW, true, { at: NOW - 1000, scanId: null })
    expect(e).toMatchObject({ state: 'running', startedAt: NOW - 20 * 60_000, overdue: true })
  })
  it('overdue from the ceiling on', () => {
    expect(evaluateFramework('a', [run('a', 'running', EVALUATION_POLL_CEILING_MS - 1)], NOW).overdue).toBe(false)
    expect(evaluateFramework('a', [run('a', 'running', EVALUATION_POLL_CEILING_MS)], NOW).overdue).toBe(true)
  })
  it('the newest run is chosen by creation time, whatever the response order; ties by id', () => {
    const scans = [run('a', 'completed', DAY), run('a', 'failed', 1000)]
    expect(evaluateFramework('a', scans, NOW).state).toBe('failed')
    expect(evaluateFramework('a', [...scans].reverse(), NOW).state).toBe('failed')
  })
})

describe('polling', () => {
  it('5 s for the first minute of the youngest active run, then 15 s, then nothing past the ceiling', () => {
    expect(evaluationPollInterval([], NOW)).toBe(false)
    expect(evaluationPollInterval([NOW], NOW)).toBe(EVALUATION_POLL_FAST_MS)
    expect(evaluationPollInterval([NOW - EVALUATION_POLL_FAST_FOR_MS + 1], NOW)).toBe(5_000)
    expect(evaluationPollInterval([NOW - EVALUATION_POLL_FAST_FOR_MS], NOW)).toBe(EVALUATION_POLL_SLOW_MS)
    expect(EVALUATION_POLL_SLOW_MS).toBe(15_000)
    expect(evaluationPollInterval([NOW - EVALUATION_POLL_CEILING_MS + 1], NOW)).toBe(15_000)
    expect(evaluationPollInterval([NOW - EVALUATION_POLL_CEILING_MS], NOW)).toBe(false)
    expect(EVALUATION_POLL_CEILING_MS).toBe(15 * 60_000)
    // A stuck run past the ceiling doesn't stop a young run from being polled fast.
    expect(evaluationPollInterval([NOW - DAY, NOW - 1000], NOW)).toBe(5_000)
  })
  it('activeRunStarts: only frameworks whose newest run is pending or running', () => {
    const scans = [
      run('a', 'running', 30_000), run('a', 'completed', DAY),
      run('b', 'completed', 1000), run('b', 'running', 2 * DAY),
      run('c', 'pending', 5000),
      run('d', 'failed', 1000),
    ]
    expect(activeRunStarts(scans).sort()).toEqual([NOW - 30_000, NOW - 5000].sort())
  })
})
