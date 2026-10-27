/**
 * The Compliance page's view model (Security V2 F3b): D1 score, D2 tile + banner (Q3/Q4), Q1 frameworks count,
 * D3 Security Hub states (Q5/Q6), D4 history, D7 errors. In UTC here; compliance-model-tz.test.ts runs west of it.
 * Every stored compliance_score is a decoy ('0.00'): a test can't pass by reading it.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  return Date.parse('2026-10-27T15:00:00Z')
})

import { describe, it, expect, vi } from 'vitest'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'
import type { SecurityHubCapability } from '@/lib/services/security-hub.service'
import { EVALUATION_POLL_CEILING_MS, FRAMEWORK_STALE_AFTER_MS } from '@/lib/compliance/evaluation'
import type { FrameworkResults } from '@/lib/compliance/useFrameworkEvaluations'
import {
  COMPLIANCE_COPY, countedFrameworks, describeCompliance, describeSecurityHub, securityHubState,
  type Loadable, type SecurityHubInput,
} from '../complianceModel'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const fw = (id: string, name: string, over: Partial<ComplianceFramework> = {}): ComplianceFramework => ({
  id, organization_id: 'org-1', name, description: null, framework_type: 'custom', enabled: true, is_default: false,
  standard_name: null, version: null, created_at: at(90 * DAY), updated_at: at(90 * DAY), ...over,
})

let seq = 0
const run = (framework_id: string, status: ComplianceScan['status'], msAgo: number, counts: [number, number] = [9, 1], over: Partial<ComplianceScan> = {}): ComplianceScan => ({
  id: `s-${++seq}`, organization_id: 'org-1', framework_id, scan_type: 'manual', status,
  total_resources: 40, compliant_resources: counts[0], non_compliant_resources: counts[1],
  compliance_score: '0.00' as unknown as number, critical_issues: 2, high_issues: 5, medium_issues: 0, low_issues: 0,
  started_at: at(msAgo), completed_at: status === 'completed' || status === 'failed' ? at(msAgo) : null,
  duration_seconds: 1, created_at: at(msAgo), ...over,
})

const ready = (frameworks: ComplianceFramework[], scans: ComplianceScan[], scansLimit = 50): Loadable<FrameworkResults> =>
  ({ status: 'ready', data: { frameworks, scans, scansLimit } })

const noSh: SecurityHubInput = { failed: false, capability: null, evaluated: { cis: false, pci: false, nist: false } }
const capability = (over: Partial<SecurityHubCapability> = {}): SecurityHubCapability =>
  ({ capabilityStatus: 'ENABLED', syncStatus: 'COMPLETED', checkedAt: at(HOUR), error: null, enabledStandards: [], ...over })

const view = (results: Loadable<FrameworkResults>, sh: SecurityHubInput = noSh, overlay?: Parameters<typeof describeCompliance>[3]) =>
  describeCompliance(results, sh, NOW, overlay)
const A = fw('fw-a', 'Example baseline')
const B = fw('fw-b', 'Example tagging')

describe('score tile (D1, D2)', () => {
  it('current: compliant ÷ (compliant + non-compliant) from the counts, naming the framework and its local time', () => {
    const v = view(ready([A], [run('fw-a', 'completed', HOUR, [9, 1])]))
    expect(v.tiles.score).toEqual({ label: 'Overall Compliance Score', value: '90%', sub: 'Example baseline · evaluated today, 2:00 PM', note: null })
    expect(v.tiles.critical).toMatchObject({ value: '2', sub: 'From latest completed evaluation' })
    expect(v.tiles.high).toMatchObject({ value: '5', sub: 'From latest completed evaluation' })
  })
  it('a genuine 0: nothing compliant, something counted', () => {
    expect(view(ready([A], [run('fw-a', 'completed', HOUR, [0, 4])])).tiles.score.value).toBe('0%')
  })
  it('can\'t be calculated: nothing counted is "—" with the reason, never 0% or 100% and never the raw "0.00"', () => {
    const v = view(ready([A], [run('fw-a', 'completed', HOUR, [0, 0])]))
    expect(v.tiles.score).toMatchObject({ value: '—', note: 'No rules applied to your resources.' })
    expect(JSON.stringify(v)).not.toMatch(/0\.00|100%|"0%"/)
  })
  it('never evaluated: "—" and "Not yet evaluated" on all three', () => {
    const v = view(ready([A], []))
    for (const t of [v.tiles.score, v.tiles.critical, v.tiles.high]) expect(t).toMatchObject({ value: '—', sub: 'Not yet evaluated' })
  })
  it.each([
    ['running', 'running' as const],
    ['pending', 'pending' as const],
    ['failed', 'failed' as const],
  ])('a newer %s run of the tile\'s framework: "—" and "No score is shown as current." on all three (D7)', (_, status) => {
    const v = view(ready([A], [run('fw-a', 'completed', DAY), run('fw-a', status, MIN)]))
    for (const t of [v.tiles.score, v.tiles.critical, v.tiles.high]) expect(t).toMatchObject({ value: '—', sub: 'No score is shown as current.' })
    expect(JSON.stringify(v.tiles)).not.toContain('90%')
  })
  it('a run this page started and the list doesn\'t show yet hides the score too', () => {
    const v = view(ready([A], [run('fw-a', 'completed', DAY)]), noSh, { clock: NOW, startedLocally: { 'fw-a': { at: NOW, scanId: 's-new' } } })
    expect(v.tiles.score).toMatchObject({ value: '—', sub: 'No score is shown as current.' })
  })
  it('Q3: another framework\'s running run never hides this framework\'s score', () => {
    const v = view(ready([A, B], [run('fw-a', 'completed', HOUR), run('fw-b', 'completed', 2 * DAY), run('fw-b', 'running', MIN)]))
    expect(v.tiles.score).toMatchObject({ value: '90%', sub: 'Example baseline · evaluated today, 2:00 PM' })
  })
  it('D2: the most recently completed evaluation, across enabled frameworks', () => {
    const v = view(ready([A, B], [run('fw-a', 'completed', 2 * DAY, [1, 1]), run('fw-b', 'completed', HOUR, [3, 1])]))
    expect(v.tiles.score).toMatchObject({ value: '75%', sub: 'Example tagging · evaluated today, 2:00 PM' })
  })
  it('a disabled framework is never the tile\'s framework (Q1: not mentioned)', () => {
    const off = fw('fw-off', 'Example disabled', { enabled: false })
    const v = view(ready([A, off], [run('fw-a', 'completed', 2 * DAY), run('fw-off', 'completed', HOUR, [1, 3])]))
    expect(v.tiles.score.sub).toBe('Example baseline · evaluated Oct 25, 3:00 PM')
  })
  it('out of date: the score stays, marked " · out of date" on every tile', () => {
    const v = view(ready([A], [run('fw-a', 'completed', 8 * DAY)]))
    expect(v.tiles.score).toMatchObject({ value: '90%', sub: 'Example baseline · evaluated Oct 19, 3:00 PM · out of date' })
    expect(v.tiles.critical.sub).toBe('From latest completed evaluation · out of date')
    expect(v.tiles.high.sub).toBe('From latest completed evaluation · out of date')
  })
  it('counts that aren\'t whole numbers are "—", never printed raw', () => {
    const v = view(ready([A], [run('fw-a', 'completed', HOUR, [9, 1], { critical_issues: 'x' as unknown as number, high_issues: -1 })]))
    expect(v.tiles.critical.value).toBe('—')
    expect(v.tiles.high.value).toBe('—')
  })
})

describe('staleness boundary (FRAMEWORK_STALE_AFTER_MS), banner and tile together', () => {
  it.each([
    ['just under', FRAMEWORK_STALE_AFTER_MS - 1, false],
    ['exactly at', FRAMEWORK_STALE_AFTER_MS, true],
    ['just over', FRAMEWORK_STALE_AFTER_MS + 1, true],
  ])('%s 7 days', (_, age, stale) => {
    const v = view(ready([A], [run('fw-a', 'completed', age)]))
    expect(v.banner !== null).toBe(stale)
    expect(v.tiles.score.sub.endsWith(' · out of date')).toBe(stale)
    if (stale) expect(v.banner).toMatchObject({ kind: 'one', frameworkId: 'fw-a' })
  })
  it('a day short of the threshold is not stale; a day past it is', () => {
    expect(view(ready([A], [run('fw-a', 'completed', FRAMEWORK_STALE_AFTER_MS - DAY)])).banner).toBeNull()
    expect(view(ready([A], [run('fw-a', 'completed', FRAMEWORK_STALE_AFTER_MS + DAY)])).banner).not.toBeNull()
  })
})

describe('out-of-date banner (D2, Q4)', () => {
  it('one stale framework: names it and when, and starts that framework\'s run (the tile names the same framework)', () => {
    const v = view(ready([A], [run('fw-a', 'completed', 9 * DAY)]))
    expect(v.banner).toEqual({ kind: 'one', frameworkId: 'fw-a', text: 'Results are out of date — Example baseline was last evaluated Oct 18, 3:00 PM.' })
    expect(v.tiles.score.sub.startsWith('Example baseline ·')).toBe(true)
  })
  it('two or more: "[n] frameworks are out of date." with Review', () => {
    const v = view(ready([A, B], [run('fw-a', 'completed', 9 * DAY), run('fw-b', 'completed', 8 * DAY)]))
    expect(v.banner).toEqual({ kind: 'many', text: '2 frameworks are out of date.' })
  })
  it('any framework: a current tile framework and a stale other one still show the banner, naming the stale one', () => {
    const v = view(ready([A, B], [run('fw-a', 'completed', HOUR), run('fw-b', 'completed', 9 * DAY)]))
    expect(v.tiles.score.sub).toBe('Example baseline · evaluated today, 2:00 PM')
    expect(v.banner).toMatchObject({ kind: 'one', frameworkId: 'fw-b' })
  })
  it('a stale framework being re-evaluated is not offered again; a failed re-run is not "out of date" either', () => {
    expect(view(ready([A], [run('fw-a', 'completed', 9 * DAY), run('fw-a', 'running', MIN)])).banner).toBeNull()
    expect(view(ready([A], [run('fw-a', 'completed', 9 * DAY), run('fw-a', 'failed', MIN)])).banner).toBeNull()
  })
  it('a disabled framework is never counted', () => {
    const off = fw('fw-off', 'Example disabled', { enabled: false })
    expect(view(ready([off], [run('fw-off', 'completed', 9 * DAY)])).banner).toBeNull()
  })
})

describe('failed banner (founder answer 1 on the F3b calls)', () => {
  it('a failed newest run surfaces with the mock\'s text and that framework', () => {
    expect(view(ready([A], [run('fw-a', 'completed', 3 * DAY), run('fw-a', 'failed', DAY)])).failed).toEqual([
      { frameworkId: 'fw-a', title: 'The last evaluation failed', text: 'The last run failed on Oct 26. No score is shown as current.' },
    ])
  })
  it('never for a running, current, out-of-date or never-evaluated framework', () => {
    expect(view(ready([A], [run('fw-a', 'failed', 2 * DAY), run('fw-a', 'running', MIN)])).failed).toEqual([])
    expect(view(ready([A], [run('fw-a', 'failed', 2 * DAY), run('fw-a', 'completed', DAY)])).failed).toEqual([])
    expect(view(ready([A], [run('fw-a', 'completed', 9 * DAY)])).failed).toEqual([])
    expect(view(ready([A], [])).failed).toEqual([])
  })
  it('one per failed framework, the most recent failure first; a disabled framework is never shown', () => {
    const off = fw('fw-off', 'Example disabled', { enabled: false })
    const v = view(ready([A, B, off], [run('fw-a', 'failed', 3 * DAY), run('fw-b', 'failed', DAY), run('fw-off', 'failed', HOUR)]))
    expect(v.failed.map((f) => [f.frameworkId, f.text])).toEqual([
      ['fw-b', 'The last run failed on Oct 26. No score is shown as current.'],
      ['fw-a', 'The last run failed on Oct 24. No score is shown as current.'],
    ])
  })
  it('a 402 or a failed read has no failed banner (D7)', () => {
    expect(view({ status: 'plan' }).failed).toEqual([])
    expect(view({ status: 'error' }).failed).toEqual([])
  })
})

describe('frameworks tile (Q1)', () => {
  const shOn = (evaluated: SecurityHubInput['evaluated']): SecurityHubInput => ({ failed: false, capability: capability(), evaluated })
  it('counts frameworks, never runs', () => {
    const v = view(ready([A], [run('fw-a', 'completed', HOUR), run('fw-a', 'completed', 2 * HOUR), run('fw-a', 'running', MIN)]))
    expect(v.tiles.frameworks).toMatchObject({ value: '1', sub: '1 custom framework evaluated' })
  })
  it('enabled custom frameworks only (compliance_frameworks.enabled; built-in rows are not custom)', () => {
    const list = [A, B, fw('fw-off', 'Example off', { enabled: false }), fw('fw-bi', 'Example built-in', { framework_type: 'built_in' })]
    expect(countedFrameworks(list).map((f) => f.id)).toEqual(['fw-a', 'fw-b'])
    expect(view(ready(list, [])).tiles.frameworks).toMatchObject({ value: '2', sub: '2 custom frameworks evaluated' })
  })
  it('"No frameworks yet." only for a real zero', () => {
    expect(view(ready([], [])).tiles.frameworks).toMatchObject({ value: '0', sub: 'No frameworks yet.' })
  })
  it('with Security Hub standards DevControl evaluates: "[n] custom · [n] Security Hub standards"', () => {
    expect(view(ready([A], []), shOn({ cis: true, pci: true, nist: false })).tiles.frameworks).toMatchObject({ value: '3', sub: '1 custom · 2 Security Hub standards' })
    expect(view(ready([], []), shOn({ cis: true, pci: false, nist: false })).tiles.frameworks).toMatchObject({ value: '1', sub: '0 custom · 1 Security Hub standard' })
  })
  it('a standard counts only while Security Hub itself is enabled (Q6)', () => {
    const notGranted = { failed: false, capability: capability({ capabilityStatus: 'NOT_GRANTED' }), evaluated: { cis: true, pci: true, nist: true } }
    expect(view(ready([A], []), notGranted).tiles.frameworks).toMatchObject({ value: '1', sub: '1 custom framework evaluated' })
  })
})

describe('D7: 402 and failed reads never become an empty state', () => {
  it.each([
    ['plan (402)', { status: 'plan' } as const],
    ['error (500 or network)', { status: 'error' } as const],
  ])('%s: no "No frameworks yet", no "Not yet evaluated", no history, no banner', (_, results) => {
    const v = view(results)
    const text = JSON.stringify(v)
    expect(text).not.toContain(COMPLIANCE_COPY.noFrameworks)
    expect(text).not.toContain(COMPLIANCE_COPY.notYetEvaluated)
    expect(v.history).toEqual([])
    expect(v.banner).toBeNull()
    expect(v.status).toBe(results.status)
  })
  it('loading says so', () => {
    const v = view({ status: 'loading' })
    expect(v.tiles.score).toMatchObject({ value: '—', sub: 'Loading…' })
    expect(v.tiles.frameworks).toMatchObject({ value: '—', sub: 'Loading…' })
  })
  it('error tiles say "Unable to load"', () => {
    const v = view({ status: 'error' })
    for (const t of Object.values(v.tiles)) expect(t).toMatchObject({ value: '—', sub: 'Unable to load' })
  })
})

describe('history (D4, D5)', () => {
  it('every run, failed ones included, newest first, in the D4 formats (local time)', () => {
    const scans = [
      run('fw-a', 'completed', 3 * DAY, [9, 1]),
      run('fw-a', 'failed', DAY + HOUR),
      run('fw-a', 'running', 30 * MIN),
    ]
    expect(view(ready([A], scans)).history.map((r) => r.text)).toEqual([
      'Example baseline · Running · started today, 2:30 PM',
      'Example baseline · Failed yesterday, 2:00 PM',
      'Example baseline · Completed Oct 24, 3:00 PM · 90%',
    ])
  })
  it('a completed run with nothing counted is "—" with the reason', () => {
    const [row] = view(ready([A], [run('fw-a', 'completed', HOUR, [0, 0])])).history
    expect(row).toMatchObject({ text: 'Example baseline · Completed today, 2:00 PM · —', note: 'No rules applied to your resources.' })
  })
  it('D5: two runs 2 s apart are both kept, one row per run id', () => {
    const one = run('fw-a', 'completed', DAY)
    const two = run('fw-a', 'completed', DAY - 2000)
    const rows = view(ready([A], [one, two])).history
    expect(rows.map((r) => r.id)).toEqual([two.id, one.id])
  })
  it('"Re-evaluate now" on the newest row of each framework, not while its run is live; again past the ceiling', () => {
    const rows = view(ready([A, B], [run('fw-a', 'completed', 2 * DAY), run('fw-a', 'failed', DAY), run('fw-b', 'running', MIN)])).history
    expect(rows.map((r) => [r.frameworkId, r.status, r.canReEvaluate])).toEqual([
      ['fw-b', 'running', false], ['fw-a', 'failed', true], ['fw-a', 'completed', false],
    ])
    const stuck = view(ready([B], [run('fw-b', 'running', EVALUATION_POLL_CEILING_MS)])).history
    expect(stuck[0].canReEvaluate).toBe(true)
  })
  it('a run of a framework no longer listed keeps its row, named "Custom framework", with no action', () => {
    const [row] = view(ready([A], [run('fw-gone', 'completed', HOUR)])).history
    expect(row).toMatchObject({ text: 'Custom framework · Completed today, 2:00 PM · 90%', canReEvaluate: false })
  })
})

describe('Security Hub states (D3, Q5, Q6)', () => {
  it.each([
    ['never synced (no state yet)', { failed: false, capability: null }, 'never_synced', 'Not checked yet', null, false],
    ['never synced (NEVER_RUN)', { failed: false, capability: capability({ syncStatus: 'NEVER_RUN', capabilityStatus: null }) }, 'never_synced', 'Not checked yet', null, false],
    ['enabled', { failed: false, capability: capability() }, 'enabled', 'Connected', null, false],
    ['missing permission', { failed: false, capability: capability({ capabilityStatus: 'NOT_GRANTED' }) }, 'not_granted', 'Permission required', "DevControl can't read Security Hub — the connected role is missing a permission.", false],
    ['not enabled', { failed: false, capability: capability({ capabilityStatus: 'NOT_AVAILABLE' }) }, 'not_available', 'Not enabled', 'Turn it on in your AWS account, then sync to evaluate CIS, PCI DSS and NIST.', true],
    ['error', { failed: false, capability: capability({ capabilityStatus: 'ERROR' }) }, 'error', 'Check failed', "Couldn't check Security Hub. Try again later.", false],
    ['unknown status', { failed: false, capability: capability({ capabilityStatus: null }) }, 'error', 'Check failed', "Couldn't check Security Hub. Try again later.", false],
    ['the read failed', { failed: true, capability: null }, 'error', 'Check failed', "Couldn't check Security Hub. Try again later.", false],
  ])('%s', (_, input, state, pill, body, needs) => {
    expect(securityHubState(input)).toBe(state)
    expect(describeSecurityHub(input)).toEqual({ state, pill, body, needsSecurityHub: needs })
  })
  it('"Turn it on" appears only in the not-enabled state', () => {
    const states = ['ENABLED', 'NOT_GRANTED', 'NOT_AVAILABLE', 'ERROR'] as const
    const withTurnOn = states.filter((s) => describeSecurityHub({ failed: false, capability: capability({ capabilityStatus: s }) }).body?.includes('Turn it on'))
    expect(withTurnOn).toEqual(['NOT_AVAILABLE'])
  })
})
