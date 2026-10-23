/**
 * The Infrastructure Overview view model (overview/overviewModel.ts), without
 * rendering: every number and sentence the page prints, per state
 * (infra-overview-plan.md §14.1, §17.11, §18.3, §19.6–19.7). Times are passed
 * in (`NOW`) and the zone is pinned, so nothing reads the real clock.
 */
process.env.TZ = 'UTC'

import { describe, it, expect } from 'vitest'
import type { AWSServicesStats } from '@/lib/services/aws-services.service'
import {
  describeOverview, displaySeverity, rankAttention, costByService, isOpenAccountFinding, OVERVIEW_COPY, type OverviewInputs,
} from '../overview/overviewModel'
import { STATUS_LABEL } from '../../services/AttentionTable'
import { region, withoutM5c } from '../../services/__tests__/m6-fixtures'
import {
  NOW, hoursAgo, ready, LOADING, ERROR, coverage, noAccountCoverage, STATS, QUIET_STATS, service, ATTENTION_ROWS, attentionPage,
  finding, ACCOUNT_FINDINGS, billedSummary, estimatedSummary, NO_SAVINGS, inputs,
} from './overview-fixtures'

const view = (o: Partial<OverviewInputs> = {}) => describeOverview(inputs(o), NOW)

/** Every string the view prints (leaf values, not keys). */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => strings(v, out))
  return out
}
const text = (o: Partial<OverviewInputs> = {}) => strings(view(o)).join('\n')
/** The one sentence allowed to say "every region": S3 / CloudFront, claimed only from the last completed scan (regionCoverage.ts footerText). */
const GLOBAL_LINE = /^S3 (and CloudFront )?is checked in every region|^S3 and CloudFront are checked in every region/

/** Every state the page has: each fixture is checked for invented claims (O-S9). */
const STATES: Record<string, Partial<OverviewInputs>> = {
  connected: {},
  'no-account': { coverage: ready(noAccountCoverage()) },
  'no-findings': { stats: ready(QUIET_STATS), attention: ready(attentionPage([])), accountFindings: ready([]) },
  'coverage-loading': { coverage: LOADING },
  'coverage-error': { coverage: ERROR },
  'all-loading': { coverage: LOADING, stats: LOADING, attention: LOADING, accountFindings: LOADING, costSummary: LOADING, savings: LOADING },
  'all-error': { stats: ERROR, attention: ERROR, accountFindings: ERROR, costSummary: ERROR, savings: ERROR },
  'unknown-list': { coverage: ready(coverage({ scope: { ...coverage().scope, enabled_regions: { known: false, count: null } } })) },
  'older-backend': { coverage: ready(withoutM5c(coverage())) },
  'scan-running': { coverage: ready(coverage({ scan_in_progress: { since: hoursAgo(0.25) } })) },
  stale: { coverage: ready({ ...coverage(), region_status: coverage().region_status!.map((r) => (r.home ? { ...r, stale: true } : r)) }) },
  unfinished: { coverage: ready(coverage({ last_scan: { status: 'failed', started_at: hoursAgo(1.2), completed_at: hoursAgo(1), warnings: [] } })) },
  'never-scanned': { coverage: ready(coverage({ last_completed_scan: null, last_successful_scan_at: null, last_scan: null })), stats: ready(QUIET_STATS), attention: ready(attentionPage([])), accountFindings: ready([]) },
  'missing-cost': { costSummary: ready(estimatedSummary()) },
}

// ── K1 spend ──

describe('O-K1 spend this month', () => {
  it('billed: the amount, billed through, and the Cost Explorer time', () => {
    const spend = view().tiles!.spend
    expect(spend.value).toBe('$1,000.00')
    expect(spend.captions[0]).toEqual(['whole account · billed, from Cost Explorer · billed through Oct 21'])
    expect(spend.captions[1]).toEqual(['Cost Explorer, as of ', { iso: hoursAgo(1) }])
  })
  it('an inventory estimate is never shown as spend: the amount appears nowhere in the view', () => {
    const v = view({ costSummary: ready(estimatedSummary()) })
    expect(v.tiles!.spend.value).toBe('Cost data not available yet')
    expect(v.tiles!.spend.captions).toEqual([['Cost Explorer is not enabled']])
    expect(JSON.stringify(v)).not.toMatch(/777/)
  })
  it('error and loading: never $0', () => {
    expect(view({ costSummary: ERROR }).tiles!.spend.value).toBe('Cost data not available yet')
    expect(view({ costSummary: LOADING }).tiles!.spend.value).toBe('…')
  })
})

// ── K2 findings ──

describe('O-K2 / O-K2b / O-K2c / O-Q8 open findings', () => {
  it('two labelled sources, each with its own severity breakdown', () => {
    const [res, acc] = view().tiles!.findings.sources
    expect(res).toMatchObject({ label: 'On resources', value: '8', breakdown: 'Critical 1 · High 2 · Medium 5 · Low 0' })
    // Open = active or acknowledged: dismissed and accepted risk are left out (and said so).
    expect(acc).toMatchObject({ label: 'Account-level (security groups, IAM users)', value: '4', breakdown: 'Critical 1 · High 1 · Medium 1 · Low 1', note: '2 dismissed or accepted not counted' })
  })
  it('never a sum: 8 + 4 = 12 appears nowhere, and nothing says "total"', () => {
    const v = view()
    const tile = JSON.stringify(v.tiles!.findings)
    expect(tile).not.toMatch(/\b12\b/)
    expect(JSON.stringify(v.status)).not.toMatch(/\b(12|2 critical|3 high)\b/i)
    expect(text()).not.toMatch(/total/i)
  })
  it('one source failing leaves the other number; the failed one is "—", never 0', () => {
    const [res, acc] = view({ accountFindings: ERROR }).tiles!.findings.sources
    expect(res.value).toBe('8')
    expect(acc).toMatchObject({ value: '—', breakdown: null, note: "Couldn't be loaded" })
    const [res2, acc2] = view({ stats: ERROR }).tiles!.findings.sources
    expect(res2).toMatchObject({ value: '—', note: "Couldn't be loaded" })
    expect(acc2.value).toBe('4')
  })
  it('isOpenAccountFinding: active and acknowledged only', () => {
    expect(ACCOUNT_FINDINGS.filter(isOpenAccountFinding).map((f) => f.id)).toEqual(['sg-open', 'iam-mfa', 'sg-medium', 'sg-low'])
  })
})

// ── K3 savings ──

describe('O-K3 / RU-3 possible savings', () => {
  it('the estimate only; each ceiling on its own line, never added', () => {
    const s = view().tiles!.savings
    expect(s.value).toBe('$123.45/mo est.')
    expect(s.captions).toEqual([[OVERVIEW_COPY.savingsSource], ['Plus up to $41.27/mo if S3 data qualifies for Standard-IA (upper bound, not included above)']])
    expect(JSON.stringify(s)).not.toMatch(/164\.72/)
  })
  it('no recommendations: $0/mo est. and says so; no time is printed', () => {
    const s = view({ savings: ready(NO_SAVINGS) }).tiles!.savings
    expect(s.value).toBe('$0.00/mo est.')
    expect(s.captions).toContainEqual([OVERVIEW_COPY.savingsNone])
    expect(JSON.stringify(s)).not.toMatch(/today|ago|as of/i)
  })
  it('error "—", loading "…"', () => {
    expect(view({ savings: ERROR }).tiles!.savings).toMatchObject({ value: '—', captions: [[OVERVIEW_COPY.savingsError]] })
    expect(view({ savings: LOADING }).tiles!.savings.value).toBe('…')
  })
  it.each(['connected', 'no-findings', 'coverage-loading', 'coverage-error', 'all-loading', 'all-error', 'missing-cost', 'never-scanned'])(
    'the "Review recommendations →" link is in the savings tile (%s)', (state) => {
      expect(view(STATES[state]).tiles!.savings.link).toEqual({ text: 'Review recommendations →', href: '/cost-optimization' })
    })
  it('no AWS account: no tiles at all, so no savings link (S1)', () => {
    expect(view(STATES['no-account']).tiles).toBeNull()
  })
})

// ── K4 ownership ──

describe('O-K4 owned resources', () => {
  it('owned of total; unknown is never counted as unowned', () => {
    expect(view().tiles!.ownership).toMatchObject({ value: '6 of 9', captions: [['3 unowned']] })
    const withUnknown: AWSServicesStats = { ...STATS, ownership: { owned: 5, unowned: 2, unknown: 2 } }
    expect(view({ stats: ready(withUnknown) }).tiles!.ownership).toMatchObject({ value: '5 of 9', captions: [['2 unowned · 2 tags unreadable']] })
  })
  it('no resources: "No resources yet", with "Not scanned yet" only when never scanned', () => {
    const empty = { ...QUIET_STATS, total: 0, ownership: { owned: 0, unowned: 0, unknown: 0 } }
    expect(view({ stats: ready(empty) }).tiles!.ownership).toMatchObject({ value: 'No resources yet', captions: [] })
    expect(view({ ...STATES['never-scanned'], stats: ready(empty) }).tiles!.ownership.captions).toEqual([['Not scanned yet']])
  })
})

// ── Attention ──

describe('O-A attention rows', () => {
  it('O-A1 severity, then the hidden cost (largest first, none last, account rows after costed rows), then name', () => {
    const rows = rankAttention(ATTENTION_ROWS, ACCOUNT_FINDINGS, null)
    expect(rows.map((r) => r.key)).toEqual([
      'resource-db-prod', 'resource-db-stopped', 'account-sg-open',
      'resource-web-1', 'resource-vol-x', 'resource-bucket-a', 'account-iam-mfa',
      'resource-worker',
    ])
  })
  it('O-A1 deterministic whatever the input order', () => {
    const a = rankAttention([...ATTENTION_ROWS].reverse(), [...ACCOUNT_FINDINGS].reverse(), null).map((r) => r.key)
    expect(a).toEqual(rankAttention(ATTENTION_ROWS, ACCOUNT_FINDINGS, null).map((r) => r.key))
  })
  it('O-A3 with no costs at all: severity, then name', () => {
    const rows = rankAttention(ATTENTION_ROWS.map((r) => ({ ...r, monthly_cost: null })), [], null)
    expect(rows.map((r) => r.resource)).toEqual(['db-prod', 'db-stopped', 'bucket-a', 'vol-x', 'web-1', 'worker'])
  })
  it('O-A2 / MU-ST the severity cell for every cause (C1: status rows use the Services wording)', () => {
    const by = Object.fromEntries(ATTENTION_ROWS.map((r) => [r.id, displaySeverity(r)]))
    expect(by['db-prod']).toEqual({ kind: 'badge', severity: 'critical', label: 'Critical' })
    expect(by['web-1']).toEqual({ kind: 'badge', severity: 'high', label: 'High' })
    expect(by['vol-x']).toEqual({ kind: 'badge', severity: 'info', label: 'Cost · ≥ $100/mo est.' })
    expect(by['db-stopped']).toEqual({ kind: 'badge', severity: 'info', label: STATUS_LABEL.critical })
    expect(by['worker']).toEqual({ kind: 'badge', severity: 'info', label: STATUS_LABEL.warning })
    expect(STATUS_LABEL.critical).toBe('Failed or terminated')
    expect(STATUS_LABEL.warning).toBe('Stopped or degraded')
    for (const r of [by['db-stopped'], by['worker']]) expect(r.label).not.toMatch(/^(Stopped|Failed)$/)
    expect(displaySeverity(service('x', { attention_cause: null, priority_severity: 'high' }))).toEqual({ kind: 'badge', severity: 'info', label: '—' })
  })
  it('O-A4 a cost or status row is never labelled with a finding severity', () => {
    for (const r of ATTENTION_ROWS.filter((x) => x.attention_cause !== 'finding')) {
      expect(displaySeverity(r).severity).toBe('info')
      expect(displaySeverity(r).label).not.toMatch(/^(Critical|High|Medium|Low)$/)
    }
  })
  it('O-A5 account rows: open and critical/high only; IAM has no region', () => {
    const rows = rankAttention([], ACCOUNT_FINDINGS, null)
    expect(rows.map((r) => r.key)).toEqual(['account-sg-open', 'account-iam-mfa'])
    expect(rows[1]).toMatchObject({ region: 'Global (IAM)', resource: 'alice', resourceKind: 'IAM user', nextStep: { text: 'Enable MFA for alice' } })
    expect(rows[0]).toMatchObject({ region: 'us-east-1', resourceKind: 'Security group' })
  })
  it('O-A6 the first 10; "View all" uses the list total; each source counted on its own', () => {
    const many = Array.from({ length: 30 }, (_, i) => service(`r${String(i).padStart(2, '0')}`, { priority_severity: 'high', attention_cause: 'finding', reason: 'x' }))
    const a = view({ attention: ready(attentionPage(many, 140)) }).attention
    if (a?.status !== 'ready') throw new Error('not ready')
    expect(a.rows).toHaveLength(10)
    expect(a).toMatchObject({ viewAll: 140, resourceTotal: 140, accountTotal: 2, securityLink: true, firstHundred: true })
  })
  it('O-A7 a status row carrying a cost reason keeps the status label and the server text', () => {
    const edge = service('edge', { status: 'warning', priority_severity: 'medium', attention_cause: 'status', reason: 'Unattached EBS volume (est. $60/mo)' })
    const [row] = rankAttention([edge], [], null)
    expect(row.severity.label).toBe('Stopped or degraded')
    expect(row.issue).toBe('Unattached EBS volume (est. $60/mo)')
  })
  it('next steps: findings → Security, cost → recommendations, status → none', () => {
    const rows = Object.fromEntries(rankAttention(ATTENTION_ROWS, [], hoursAgo(2)).map((r) => [r.resource, r]))
    expect(rows['db-prod'].nextStep).toEqual({ link: 'Review on the Security page →', href: '/security' })
    expect(rows['vol-x'].nextStep).toEqual({ link: 'Review recommendations →', href: '/cost-optimization' })
    expect(rows['worker'].nextStep).toBeNull()
    expect(rows['db-prod'].foundAt).toBe(hoursAgo(2))
  })
  it('empty: the scope it covers, never "healthy"', () => {
    const a = view(STATES['no-findings']).attention
    expect(a).toMatchObject({ status: 'ready', rows: [], empty: { scope: 'Checked: us-east-1 (1 of 17 enabled regions).' } })
  })
  it('O-H1 the cost used for ordering is in no row', () => {
    const rows = rankAttention(ATTENTION_ROWS, ACCOUNT_FINDINGS, null)
    expect(JSON.stringify(rows)).not.toMatch(/\b(200|50|30)\b|\$5\b|\$8\b|monthly_cost/)
  })
  it('C3: an S3 placeholder ($5) orders the row within its severity and is never shown', () => {
    const rows = rankAttention(ATTENTION_ROWS, [], null).map((r) => r.resource)
    expect(rows.indexOf('bucket-a')).toBeLessThan(rows.indexOf('worker'))
    expect(JSON.stringify(rankAttention(ATTENTION_ROWS, [], null))).not.toMatch(/\$5/)
  })
})

// ── Status line ──

describe('O-S status line', () => {
  it('O-S2b critical and high, per source, never one count', () => {
    expect(view().status.headline).toBe('Critical-severity findings need review: 1 on resources, 1 account-level · High: 2 on resources, 1 account-level')
  })
  it('O-S2b high only; a source with 0 is still printed', () => {
    const s = { ...STATS, findings_by_severity: { critical: 0, high: 2, medium: 0, low: 0 } }
    expect(view({ stats: ready(s), accountFindings: ready([]) }).status.headline).toBe('High-severity findings need review: 2 on resources, 0 account-level')
  })
  it('O-S2b one source failed: said in place of its number', () => {
    expect(view({ accountFindings: ERROR }).status.headline).toBe("Critical-severity findings need review: 1 on resources, account-level findings couldn't be loaded · High: 2 on resources, account-level findings couldn't be loaded")
  })
  it('O-S1 both sources failed', () => {
    expect(view({ stats: ERROR, accountFindings: ERROR }).status.headline).toBe("Findings couldn't be loaded.")
  })
  it('O-S4 no critical/high but other items: stopped, failed, cost', () => {
    const s = { ...QUIET_STATS, needs_attention: 3, attention_reasons: { with_finding: 0, with_cost_recommendation: 1, stopped_or_degraded: 1, failed: 1 } }
    expect(view({ stats: ready(s), accountFindings: ready([]) }).status.headline)
      .toBe('3 resources need review: 1 stopped or degraded · 1 failed or terminated · 1 with a cost recommendation of $100/mo or more (est.)')
  })
  it('O-S5 nothing found: says so with its scope', () => {
    const s = view(STATES['no-findings']).status
    expect(s.headline).toBe('No critical or high-severity findings from the last scan.')
    expect(s.notChecked).toBe('Not checked yet: 16 regions · IAM roles and policies')
    expect(s.reason).toBeNull()
  })
  it('O-S6 never scanned', () => {
    expect(view(STATES['never-scanned']).status.headline).toBe('No scan has finished yet.')
  })
  it('O-S3 the not-checked line stays when there are findings; the top item is the first row', () => {
    const s = view().status
    expect(s.notChecked).toBe('Not checked yet: 16 regions · IAM roles and policies')
    expect(s.reason).toBe('Top: RDS instance is publicly accessible')
  })
  it('O-S7 unknown region list and an older backend: no "N of M"', () => {
    expect(view(STATES['unknown-list']).status.notChecked).toBe('Not checked yet: other regions (region list not read yet) · IAM roles and policies')
    expect(view(STATES['older-backend']).status.notChecked).toBe('Not checked yet: other regions (region list not read yet) · IAM roles and policies')
  })
  it('O-S8 notes: unfinished, running, stale', () => {
    expect(view(STATES.unfinished).status.notes).toContainEqual(["The most recent scan attempt didn't finish; results are from the scan that finished ", { iso: hoursAgo(2) }, '.'])
    expect(view(STATES['scan-running']).status.notes).toContainEqual(['Scan in progress since ', { iso: hoursAgo(0.25) }, '.'])
    expect(view(STATES.stale).status.notes).toContainEqual(['Results may be out of date: ', 'us-east-1 was last scanned ', { iso: hoursAgo(2) }, '.'])
  })
  it('O-S5 coverage error: never "nothing found", and says what is missing', () => {
    const s = view({ ...STATES['coverage-error'], stats: ready(QUIET_STATS), attention: ready(attentionPage([])), accountFindings: ready([]) }).status
    expect(s.headline).toBe(OVERVIEW_COPY.coverageError)
    expect(s.notChecked).toBeNull()
    expect(JSON.stringify(s)).not.toMatch(/No critical or high/)
  })
  it('O-S10 the status line counts are the tile counts', () => {
    const v = view()
    const [res, acc] = v.tiles!.findings.sources
    expect(res.breakdown).toContain('Critical 1 · High 2')
    expect(acc.breakdown).toContain('Critical 1 · High 1')
    expect(v.status.headline).toContain('1 on resources, 1 account-level · High: 2 on resources, 1 account-level')
  })
  it.each(Object.keys(STATES))('O-S9 no invented claims (%s)', (state) => {
    const printed = strings(view(STATES[state])).filter((line) => !GLOBAL_LINE.test(line))
    expect(printed.join('\n')).not.toMatch(/healthy|all good|secure\b|no issues|real-time|every region|all regions|complete coverage|zero risk|act now|recoverable|nothing to worry|fully/i)
  })
  it('O-S9 "every region" only in the S3/CloudFront line, and only when the last completed scan listed them', () => {
    expect(strings(view()).filter((l) => /every region/.test(l))).toEqual([expect.stringMatching(GLOBAL_LINE)])
    const notListed = coverage({ last_completed_scan: { ...coverage().last_completed_scan!, resource_types: ['ec2'] } })
    expect(text({ coverage: ready(notListed) })).not.toMatch(/every region/)
  })
})

// ── Cost by service ──

describe('O-C cost by AWS service', () => {
  it('O-C1 / O-C3 the top 5 plus everything else; the rows add up to the spend', () => {
    const c = costByService(ready(billedSummary()))
    expect(c.sub).toBe('This month, billed · billed through Oct 21')
    expect(c.rows.map((r) => [r.service, r.amount, r.share])).toEqual([
      ['Amazon Elastic Compute Cloud - Compute', '$400.00', '40%'],
      ['Amazon Relational Database Service', '$300.00', '30%'],
      ['Amazon Simple Storage Service', '$100.00', '10%'],
      ['AWS Lambda', '$50.00', '5%'],
      ['Amazon CloudFront', '$25.00', '2.5%'],
      ['All other services', '$125.00', null],
    ])
    const sum = c.rows.reduce((n, r) => n + Number(r.amount.replace(/[$,]/g, '')), 0)
    expect(sum).toBe(1000)
  })
  it('O-C1 credits: a negative remainder; none under a cent', () => {
    const credits = costByService(ready(billedSummary({ amount: 800, top: [{ service: 'EC2', amount: 900, sharePercent: 100 }] })))
    expect(credits.rows.at(-1)).toEqual({ service: 'All other services and credits', amount: '-$100.00', share: null })
    const exact = costByService(ready(billedSummary({ amount: 900.004, top: [{ service: 'EC2', amount: 900, sharePercent: 100 }] })))
    expect(exact.rows).toHaveLength(1)
  })
  it('O-C2 no share from the server: none shown, none computed', () => {
    const c = costByService(ready(billedSummary({ amount: 0, top: [{ service: 'EC2', amount: 0, sharePercent: null }] })))
    expect(c.rows[0].share).toBeNull()
  })
  it('O-C2 an older backend (no topServices) and O-C4 an estimate: unavailable, with the reason', () => {
    expect(costByService(ready(billedSummary({ top: null })))).toMatchObject({ status: 'unavailable', unavailable: "Cost by service isn't available: Cost Explorer data not available yet" })
    const est = costByService(ready(estimatedSummary()))
    expect(est).toMatchObject({ status: 'unavailable', rows: [], unavailable: "Cost by service isn't available: Cost Explorer is not enabled" })
    expect(costByService(ERROR).status).toBe('unavailable')
  })
})

// ── Regions and what we checked ──

describe('O-R regions and what we checked', () => {
  it('O-R1 the strip: regionCounts reused, "1 of 17", gaps when there are some', () => {
    expect(view().account!.items).toEqual([
      { term: 'AWS account', value: 'Connected' }, { term: 'Home region', value: 'us-east-1' },
      { term: 'Enabled regions', value: '17' }, { term: 'Regions checked', value: '1 of 17' },
    ])
    const gaps = coverage({ region_status: [region('us-east-1', { home: true, status: 'partial', last_scan_finished_at: hoursAgo(2) }), region('eu-west-1')] })
    gaps.scope.enabled_regions.count = 2
    expect(view({ coverage: ready(gaps) }).account!.items[3].value).toBe('1 of 2 · 1 with gaps')
  })
  it('O-R1 unknown list and older backend: no "N of M" anywhere in the strip', () => {
    for (const state of ['unknown-list', 'older-backend']) {
      const strip = JSON.stringify(view(STATES[state]).account)
      expect(strip).not.toMatch(/\d+ of \d+/)
    }
    expect(view(STATES['unknown-list']).account!.items[3].value).toBe('us-east-1 checked · region list not read yet')
    expect(view(STATES['older-backend']).account!.items[3].value).toBe('us-east-1')
  })
  it('O-R2 IAM and alarm lines exact; S3/CloudFront only from the last completed scan', () => {
    const lines = Object.fromEntries(view().checked.map((l) => [l.key, l]))
    expect(lines.iam.parts).toEqual(['IAM roles and policies: not checked. IAM users are checked for MFA and old access keys.'])
    expect(lines.global.parts[0]).toMatch(/^S3 and CloudFront are checked in every region on each scan/)
    const noTypes = coverage({ last_completed_scan: { ...coverage().last_completed_scan!, resource_types: ['ec2'] } })
    expect(view({ coverage: ready(noTypes) }).checked.find((l) => l.key === 'global')).toBeUndefined()
    expect(text()).not.toMatch(/IAM not checked/)
  })
  it('O-AC the alarm line is the constant, with no digit or %, linking to alert history', () => {
    const line = view().checked.find((l) => l.key === 'alarms')!
    expect(line.parts).toEqual(['CloudWatch alarms (EC2/RDS): Unavailable on this page'])
    // No count or percent: the only digit is the 2 of "EC2".
    expect(line.parts.join('').replace('EC2', 'EC')).not.toMatch(/[0-9%]/)
    expect(line.link).toEqual({ text: 'See alert coverage →', href: '/observability/alert-history' })
  })
  it('regions links only when the Services V2 and M6 flags are both on', () => {
    expect(view().account!.regionsLink).toBe(false)
    expect(view().checked.find((l) => l.key === 'other-regions')!.link).toBeUndefined()
    const on = view({ regionsLinkAvailable: true })
    expect(on.account!.regionsLink).toBe(true)
    expect(on.checked.find((l) => l.key === 'other-regions')!.link).toEqual({ text: 'View regions not checked →', href: '/services#region-coverage' })
  })
})

// ── Unknown is never zero; no account; no raw text ──

describe('O-U1 / O-N1 / O-L1', () => {
  it.each(['stats', 'attention', 'accountFindings', 'costSummary', 'savings'] as const)('O-U1 %s loading or failed produces no 0 from it', (key) => {
    for (const state of [LOADING, ERROR]) {
      const v = view({ [key]: state })
      const fromIt = {
        stats: [v.tiles!.findings.sources[0].value, v.tiles!.ownership.value, v.footer!.total],
        attention: [v.attention],
        accountFindings: [v.tiles!.findings.sources[1].value],
        costSummary: [v.tiles!.spend.value, v.costByService],
        savings: [v.tiles!.savings.value],
      }[key]
      expect(JSON.stringify(fromIt)).not.toMatch(/"0"|\$0|0 of|^0$/)
    }
  })
  it('O-N1 no account: the no-account mode, no tiles, table, cost or ownership', () => {
    const v = view(STATES['no-account'])
    expect(v).toMatchObject({ mode: 'no-account', tiles: null, attention: null, costByService: null, ownership: null, footer: null, account: null })
    expect(v.header).toEqual({ lastScan: null, scanRunning: false, showSync: false })
    expect(v.status.headline).toBe('No AWS account connected.')
    expect(v.checked).toEqual([{ key: 'nothing', parts: ['Nothing has been checked yet.'] }])
  })
  it('O-L1 no raw evidence or AWS error text: only title, recommendation and reason fields are used', () => {
    const leaky = finding('leak', { severity: 'critical', evidence: { schema_version: 1, security_group_id: 'sg-SECRET', security_group_name: 'n', region: 'us-east-1', direction: 'ingress', protocol: 'tcp', from_port: 22, to_port: 22, ip_version: 'v4', cidr: '0.0.0.0/0', detected_at: hoursAgo(1) } })
    const v = view({ accountFindings: ready([leaky]) })
    expect(JSON.stringify(v)).not.toMatch(/sg-SECRET|evidence|0\.0\.0\.0/)
  })
})
