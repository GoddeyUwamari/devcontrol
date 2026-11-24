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
import { REDESIGN_COPY } from '../../services/redesignModel'
import { UNKNOWN_WARNING_TEXT } from '../../services/coverage'
import { DELETION_DETECTION_PAUSED_TEXT } from '@/components/aws/discovery-warning-notice'
import { footerText } from '../../services/regionCoverage'
import { region, withoutM5c } from '../../services/__tests__/m6-fixtures'
import { mrRegion, tab3Throttled } from '../../services/__tests__/redesign-fixtures'
import { formatShare } from '../overview/CostByService'
import {
  NOW, hoursAgo, ready, LOADING, ERROR, coverage, withoutPr3a, noAccountCoverage, STATS, QUIET_STATS, service, ATTENTION_ROWS, attentionPage,
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
  'older-backend': { coverage: ready(withoutPr3a(withoutM5c(coverage()))) },
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
    expect(spend.label).toBe('AWS spend, this month')
    expect(spend.value).toBe('$1,000.00')
    expect(spend.captions[0]).toEqual(['whole account · billed, from Cost Explorer · billed through Oct 21'])
    expect(spend.captions[1]).toEqual(['Cost Explorer, as of ', { iso: hoursAgo(1) }])
    // Redesign R5: the card shows the first caption; the Cost Explorer time moves to Cost by AWS service.
    // Round 3: "billed" once on the card; the caption itself is unchanged.
    expect(spend.line).toEqual(['Whole account · billed, from Cost Explorer · through Oct 21'])
    expect(view().costByService!.asOf).toBe(hoursAgo(1))
    expect(spend.link).toEqual({ text: 'Cost by service ↓', href: '#infra-cost-heading' })
  })
  it('an inventory estimate is never shown as spend: the amount appears nowhere in the view', () => {
    const v = view({ costSummary: ready(estimatedSummary()) })
    expect(v.tiles!.spend.value).toBe('Cost data not available yet')
    expect(v.tiles!.spend.captions).toEqual([['Cost Explorer is not enabled']])
    expect(v.tiles!.spend.line).toEqual(['Cost Explorer is not enabled'])
    expect(v.costByService!.asOf).toBeNull()
    expect(JSON.stringify(v)).not.toMatch(/777/)
  })
  it('error and loading: never $0', () => {
    expect(view({ costSummary: ERROR }).tiles!.spend.value).toBe('Cost data not available yet')
    expect(view({ costSummary: LOADING }).tiles!.spend.value).toBe('…')
  })
})

// ── K2 findings ──

describe('O-K2 / O-K2b / O-K2c / O-Q8 open findings (ruling 2: keep rule)', () => {
  it('the big number is findings on resources, with its Critical and High counts; account-level findings on their own line', () => {
    const f = view().tiles!.findings
    expect(f).toMatchObject({ label: 'Open findings', value: '8', resourceNote: null })
    expect(f.chips).toEqual([{ severity: 'critical', label: '1 Critical' }, { severity: 'high', label: '2 High' }])
    // Open = active or acknowledged: dismissed and accepted risk are left out (and said so, behind ⓘ).
    expect(f.accountLine).toBe('+ 4 account-level findings (1 Critical, 1 High)')
    expect(f.info).toEqual(['2 dismissed or accepted account-level findings are not counted.'])
    expect(f.link).toEqual({ text: 'Security findings →', href: '/security' })
  })
  it('no critical: only the High chip, and the account line names High only', () => {
    const stats = ready({ ...STATS, findings_by_severity: { critical: 0, high: 2, medium: 5, low: 0 } })
    const accounts = ready([finding('a1', { severity: 'high' }), finding('a2', { severity: 'low' })])
    const f = view({ stats, accountFindings: accounts }).tiles!.findings
    expect(f.chips).toEqual([{ severity: 'high', label: '2 High' }])
    expect(f.accountLine).toBe('+ 2 account-level findings (1 High)')
    expect(f.info).toEqual([])
  })
  it('never a sum: 8 + 4 = 12 appears nowhere, and nothing says "total"', () => {
    const v = view()
    const tile = JSON.stringify(v.tiles!.findings)
    expect(tile).not.toMatch(/\b12\b/)
    expect(JSON.stringify(v.attention)).not.toMatch(/\b(12|5 high|5 critical)\b/i)
    expect(text()).not.toMatch(/total/i)
  })
  it('one source failing leaves the other number; the failed one is "—" or its reason, never 0', () => {
    const acc = view({ accountFindings: ERROR }).tiles!.findings
    expect(acc).toMatchObject({ value: '8', accountLine: "Account-level findings couldn't be loaded" })
    const res = view({ stats: ERROR }).tiles!.findings
    expect(res).toMatchObject({ value: '—', chips: [], resourceNote: "Findings on resources couldn't be loaded", accountLine: '+ 4 account-level findings (1 Critical, 1 High)' })
    expect(view({ stats: LOADING, accountFindings: LOADING }).tiles!.findings).toMatchObject({ value: '…', accountLine: null, resourceNote: null })
  })
  it('isOpenAccountFinding: active and acknowledged only', () => {
    expect(ACCOUNT_FINDINGS.filter(isOpenAccountFinding).map((f) => f.id)).toEqual(['sg-open', 'iam-mfa', 'sg-medium', 'sg-low'])
  })
})

// ── K3 savings ──

describe('O-K3 / RU-3 possible savings', () => {
  it('the estimate only; each ceiling on its own line, never added; one line on the card, every sentence behind ⓘ', () => {
    const s = view().tiles!.savings
    expect(s.value).toBe('$123.45/month')
    expect(s.tone).toBe('success')
    expect(s.captions).toEqual([
      ['Estimated savings: $123.45/month. This is a DevControl estimate, not realized savings.'],
      ['Plus up to $41.27/month if S3 data qualifies for Standard-IA (upper bound, not included above).'],
      [OVERVIEW_COPY.savingsSource],
    ])
    expect(s.line).toEqual(['DevControl estimate · 3 open opportunities'])
    expect(s.info).toEqual(s.captions.map((c) => c[0]))
    expect(JSON.stringify(s)).not.toMatch(/164\.72/)
  })
  it('open findings with no estimate: "—", "No dollar estimate yet · N open opportunit(y|ies)", the upper bounds and method behind ⓘ', () => {
    const one = view({ savings: ready({ ...NO_SAVINGS, activeRecommendations: 1, potentialSavingsCeilingByResourceType: { S3: 0.01 } }) }).tiles!.savings
    expect(one).toMatchObject({ value: '—', line: ['No dollar estimate yet · 1 open opportunity'] })
    expect(one.tone).toBeUndefined()
    expect(one.info).toEqual(['Up to $0.01/month if S3 data qualifies for Standard-IA (upper bound).', OVERVIEW_COPY.savingsSource])
    const three = view({ savings: ready({ ...NO_SAVINGS, activeRecommendations: 3 }) }).tiles!.savings
    expect(three.line).toEqual(['No dollar estimate yet · 3 open opportunities'])
  })
  it('no recommendations: $0/mo est. and says so; no time is printed', () => {
    const s = view({ savings: ready(NO_SAVINGS) }).tiles!.savings
    expect(s.value).toBe('$0.00/mo est.')
    expect(s.captions).toContainEqual([OVERVIEW_COPY.savingsNone])
    expect(s.line).toEqual([OVERVIEW_COPY.savingsNone])
    expect(s.info).toEqual([OVERVIEW_COPY.savingsSource])
    expect(JSON.stringify(s)).not.toMatch(/today|ago|as of/i)
  })
  it('error "—", loading "…"', () => {
    expect(view({ savings: ERROR }).tiles!.savings).toMatchObject({ value: '—', captions: [[OVERVIEW_COPY.savingsError]], line: [OVERVIEW_COPY.savingsError] })
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

// ── Ownership ──

describe('O-K4 ownership card', () => {
  it('"No owner tag" and "Tags couldn\'t be read"; owned of total; unknown is never counted as "No owner tag"', () => {
    expect(view().ownership).toEqual({ status: 'ready', noOwnerTag: 3, unknown: 0, total: 9, sentence: '6 of 9 resources have an owner.' })
    const withUnknown: AWSServicesStats = { ...STATS, ownership: { owned: 5, unowned: 2, unknown: 2 }, unknown_by_type: { vpc: 1, sns: 1 } } as AWSServicesStats
    expect(view({ stats: ready(withUnknown) }).ownership).toMatchObject({
      noOwnerTag: 2, unknown: 2,
      sentence: '5 of 9 resources have an owner. Tags couldn\'t be read on 2 (SNS 1, VPC 1), so their owner is unknown, not missing; they aren\'t counted as "No owner tag".',
    })
    const one: AWSServicesStats = { ...STATS, total: 1, ownership: { owned: 0, unowned: 0, unknown: 1 } } as AWSServicesStats
    expect(view({ stats: ready(one) }).ownership).toMatchObject({
      sentence: '0 of 1 resource has an owner. Tags couldn\'t be read on 1, so its owner is unknown, not missing; it isn\'t counted as "No owner tag".',
    })
  })
  it('"unowned" is never printed, in any state', () => {
    for (const [name, state] of Object.entries(STATES)) expect(text(state), name).not.toMatch(/unowned/i)
  })
  it('no resources: "No resources yet", with "Not scanned yet" only when never scanned; loading and error', () => {
    const empty = { ...QUIET_STATS, total: 0, ownership: { owned: 0, unowned: 0, unknown: 0 } }
    expect(view({ stats: ready(empty) }).ownership).toEqual({ status: 'empty', text: 'No resources yet', note: null })
    expect(view({ ...STATES['never-scanned'], stats: ready(empty) }).ownership).toMatchObject({ note: 'Not scanned yet' })
    expect(view({ stats: LOADING }).ownership).toEqual({ status: 'loading' })
    expect(view({ stats: ERROR }).ownership).toEqual({ status: 'error', text: "Ownership couldn't be loaded" })
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
    expect(rows[0]).toMatchObject({ region: 'us-east-1', resourceKind: 'Security group · account-level' })
  })
  it('O-A6 the first 10; "View all" uses the list total; each source counted on its own', () => {
    const many = Array.from({ length: 30 }, (_, i) => service(`r${String(i).padStart(2, '0')}`, { priority_severity: 'high', attention_cause: 'finding', reason: 'x' }))
    const a = view({ attention: ready(attentionPage(many, 140)) }).attention
    if (a?.status !== 'ready') throw new Error('not ready')
    expect(a.rows).toHaveLength(10)
    expect(a).toMatchObject({ viewAll: 140, securityLink: true, firstHundred: true })
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
    expect(a).toMatchObject({ status: 'ready', rows: [], empty: { text: 'Nothing needs review from the last scan.', scope: '1 of 17 regions checked · us-east-1.' } })
  })
  describe('empty and partial states, per source (loaded / failed)', () => {
    const noRows = { attention: ready(attentionPage([])), accountFindings: ready([]) }
    it('both loaded, no rows: "Nothing needs review" with its scope', () => {
      expect(view(noRows).attention).toMatchObject({ status: 'ready', empty: { text: OVERVIEW_COPY.attentionEmpty } })
    })
    it('resources loaded (none), account findings failed: never "Nothing needs review"', () => {
      const a = view({ ...noRows, accountFindings: ERROR }).attention
      expect(a).toMatchObject({ status: 'ready', accountError: true, resourceError: false, empty: { text: OVERVIEW_COPY.attentionEmptyAccountError, scope: null } })
      expect(JSON.stringify(a)).not.toMatch(/Nothing needs review/)
    })
    it('resources failed, account findings loaded (none): never "Nothing needs review"', () => {
      const a = view({ ...noRows, attention: ERROR }).attention
      expect(a).toMatchObject({ status: 'ready', resourceError: true, accountError: false, empty: { text: OVERVIEW_COPY.attentionEmptyResourceError, scope: null } })
      expect(JSON.stringify(a)).not.toMatch(/Nothing needs review/)
    })
    it('both failed: the error state', () => {
      expect(view({ attention: ERROR, accountFindings: ERROR }).attention).toEqual({ status: 'error' })
    })
    it('resources failed, account findings loaded: the account rows, and the failure said', () => {
      const a = view({ attention: ERROR }).attention
      if (a?.status !== 'ready') throw new Error('not ready')
      expect(a.rows.map((r) => r.key)).toEqual(['account-sg-open', 'account-iam-mfa'])
      expect(a).toMatchObject({ resourceError: true, empty: null, viewAll: null })
    })
    it('resources loaded, account findings failed: the resource rows, and the failure said', () => {
      const a = view({ accountFindings: ERROR }).attention
      if (a?.status !== 'ready') throw new Error('not ready')
      expect(a.rows.every((r) => r.source === 'resource')).toBe(true)
      expect(a).toMatchObject({ accountError: true, empty: null })
    })
    it('either still loading: loading, never an empty claim', () => {
      expect(view({ ...noRows, accountFindings: LOADING }).attention).toEqual({ status: 'loading' })
      expect(view({ ...noRows, attention: LOADING }).attention).toEqual({ status: 'loading' })
    })
  })
  it('O-H1 the cost used for ordering is in no row, in any format', () => {
    const rows = rankAttention(ATTENTION_ROWS, ACCOUNT_FINDINGS, null)
    expect(JSON.stringify(rows)).not.toMatch(/\b(200|50|30)\b|5[.,]37|\b537\b|\$8\b|monthly_cost/)
    expect(JSON.stringify(view())).not.toMatch(/5[.,]37|\b537\b/)
  })
  it('C3: an S3 placeholder orders the row within its severity and is never shown', () => {
    const rows = rankAttention(ATTENTION_ROWS, [], null).map((r) => r.resource)
    expect(rows.indexOf('bucket-a')).toBeLessThan(rows.indexOf('worker'))
    expect(JSON.stringify(rankAttention(ATTENTION_ROWS, [], null))).not.toMatch(/5[.,]37/)
  })
})

// ── Header status line, region notice, attention severity line ──

describe('O-S header status line (redesign item 1; replaces the account strip and status line)', () => {
  it('home region, the Services coverage line\'s count, the scan line', () => {
    const st = view().header.status!
    expect(st.home).toBe('us-east-1')
    expect(st.regions).toEqual({ strong: '1 of 17', text: '1 of 17 regions checked' })
    expect(st.lastScan.map((p) => (typeof p === 'string' ? p : p.text)).join('')).toMatch(/^Last scan finished /)
    expect(st.notes).toEqual([])
  })
  it('O-S7 unknown region list and an older backend: no "N of M"', () => {
    expect(view(STATES['unknown-list']).header.status!.regions.strong).toBeNull()
    expect(view(STATES['older-backend']).header.status!.regions.strong).toBeNull()
  })
  it('O-S8 notes: unfinished, running, stale (words unchanged)', () => {
    expect(view(STATES.unfinished).header.status!.notes).toContainEqual(["The most recent scan attempt didn't finish; results are from the scan that finished ", { iso: hoursAgo(2) }, '.'])
    expect(view(STATES['scan-running']).header.status!.notes).toContainEqual(['Scan in progress since ', { iso: hoursAgo(0.25) }, '.'])
    expect(view(STATES.stale).header.status!.notes).toContainEqual(['Results may be out of date: ', 'us-east-1 was last scanned ', { iso: hoursAgo(2) }, '.'])
  })
  it('the region list\'s age, only when it is stale', () => {
    const c = coverage()
    const stale = coverage({ scope: { ...c.scope, enabled_regions: { ...c.scope.enabled_regions, stale: true, listed_at: hoursAgo(30) } } })
    expect(view({ coverage: ready(stale) }).header.status!.notes).toContainEqual(['Region list last read ', { iso: hoursAgo(30) }])
  })
  it('O-S5 coverage error: no status line, and What we checked says what is missing', () => {
    const v = view({ ...STATES['coverage-error'], stats: ready(QUIET_STATS), attention: ready(attentionPage([])), accountFindings: ready([]) })
    expect(v.mode).toBe('coverage-error')
    expect(v.header.status).toBeNull()
    expect(v.checked).toMatchObject({ rows: [], error: OVERVIEW_COPY.coverageError })
    expect(v.notice).toBeNull()
  })
})

describe('O-N region notice (redesign item 2)', () => {
  it('flag off, every region the scan covers checked: no notice', () => {
    expect(view().notice).toBeNull()
  })
  it('flag off, home region denied: the Services wording, the access-denied sentence', () => {
    const c = coverage({
      region_status: coverage().region_status!.map((r) => (r.home ? { ...r, status: 'denied' } : r)),
      home_only_coverage: { regions_total: 17, regions_checked: 0 },
    })
    expect(view({ coverage: ready(c) }).notice).toEqual({ lead: "us-east-1 couldn't be checked.", body: OVERVIEW_COPY.regionsDenied, link: false })
  })
  it('the "Region coverage →" link only when the Services V2 and M6 flags are both on', () => {
    const c = coverage({ region_status: coverage().region_status!.map((r) => (r.home ? { ...r, status: 'failed' } : r)), home_only_coverage: { regions_total: 17, regions_checked: 0 } })
    // A failed region is not access denied: the generic count alone.
    expect(view({ coverage: ready(c), regionsLinkAvailable: true }).notice).toEqual({ lead: "us-east-1 couldn't be checked.", body: null, link: true })
  })
})

describe('O-N region notice, flagged (multi-region)', () => {
  /** Tab 3 with ap-south-1 and a second region both refused (or one refused, one throttled). */
  function denied(second: Record<string, unknown>) {
    const c = tab3Throttled()
    const mr = c.multi_region
    mr.regions[1] = mrRegion('ap-south-1', { status: 'denied', error_code: 'access_denied', state: 'denied', resources: 31, resources_from: 'earlier_success' })
    mr.regions.push(mrRegion('eu-north-1', second))
    Object.assign(mr.scan, { regions_total: 4, regions_checked: 2 })
    return c
  }
  it('every region not checked was refused: "<n> regions couldn\'t be checked." + the access-denied sentence', () => {
    const v = view({ coverage: ready(denied({ status: 'denied', error_code: 'access_denied', state: 'denied', resources: 0 })), regionsLinkAvailable: true })
    expect(v.notice).toEqual({ lead: "2 regions couldn't be checked.", body: OVERVIEW_COPY.regionsDenied, link: true })
    // The inventory chip is the same count, amber; the notice's regions are not repeated on the row.
    expect(v.checked.rows.find((r) => r.key === 'inventory')!).toMatchObject({ chip: { text: '2 of 4 regions', tone: 'warn' }, extra: null })
    expect(v.header.status!.regions).toEqual({ strong: '2 of 4', text: '2 of 4 regions checked' })
  })
  it('one refused, one throttled: the generic count alone (the reasons are on Region coverage)', () => {
    const v = view({ coverage: ready(denied({ status: 'timed_out', error_code: 'throttled', state: 'failed', resources: 0 })) })
    expect(v.notice).toEqual({ lead: "2 regions couldn't be checked.", body: null, link: false })
  })
  it('a blocked-by-policy region is not "AWS refused DevControl\'s read role": generic', () => {
    const v = view({ coverage: ready(denied({ status: 'denied', error_code: 'access_denied_scp', state: 'denied', resources: 0 })) })
    expect(v.notice!.body).toBeNull()
  })
  it('all regions checked: no notice; chip green', () => {
    const c = tab3Throttled()
    c.multi_region.coverage_status = 'all_checked'
    c.multi_region.regions = [c.multi_region.regions[0], c.multi_region.regions[2]]
    Object.assign(c.multi_region.scan, { regions_total: 2, regions_checked: 2 })
    const v = view({ coverage: ready(c) })
    expect(v.notice).toBeNull()
    expect(v.checked.rows.find((r) => r.key === 'inventory')!.chip).toEqual({ text: '2 of 2 regions', tone: 'ok' })
  })
})

describe('O-AS the attention severity line (ruling 2: never one total; ruling 3)', () => {
  const line = (o: Partial<OverviewInputs>) => { const a = view(o).attention!; return a.status === 'ready' ? a.severityLine : 'not ready' }
  const highs = (r: number, accounts: number) => ({
    stats: ready({ ...STATS, findings_by_severity: { critical: 0, high: r, medium: 0, low: 0 } }),
    accountFindings: ready(Array.from({ length: accounts }, (_, i) => finding(`h${i}`, { severity: 'high' as const }))),
  })
  it('critical present: "critical and high-severity", each source on its own', () => {
    expect(line({})).toBe('3 critical and high-severity on resources, 2 account-level')
  })
  it('high only: "x high-severity on resources, y account-level"', () => {
    expect(line(highs(2, 2))).toBe('2 high-severity on resources, 2 account-level')
  })
  it('a clause whose count is 0 is left out', () => {
    expect(line(highs(2, 0))).toBe('2 high-severity on resources')
    expect(line(highs(0, 1))).toBe('1 high-severity account-level')
  })
  it('none, or a source that didn\'t load: no line (the failure is said under the heading)', () => {
    for (const o of [STATES['no-findings'], { accountFindings: ERROR }, { stats: ERROR }]) {
      const a = view(o).attention!
      expect(a.status === 'ready' ? a.severityLine : null).toBeNull()
    }
  })
})

describe('O-S9 no invented claims', () => {
  it.each(Object.keys(STATES))('(%s)', (state) => {
    const printed = strings(view(STATES[state]))
    expect(printed.join('\n')).not.toMatch(/healthy|all good|secure\b|no issues|real-time|every region|all regions|complete coverage|zero risk|act now|recoverable|nothing to worry|fully/i)
  })
  it('the S3/CloudFront row is footerText\'s claim, only when the last completed scan listed them', () => {
    const found = footerText(coverage())!.split(' on each scan: ')[1].replace(/\.$/, '')
    expect(view().checked.rows.find((r) => r.key === 'global')).toMatchObject({ name: 'S3 and CloudFront', detail: [`Every scan: ${found}`], chip: { text: 'Checked', tone: 'ok' } })
    const notListed = coverage({ last_completed_scan: { ...coverage().last_completed_scan!, resource_types: ['ec2'] } })
    expect(footerText(notListed)).toBeNull()
    expect(view({ coverage: ready(notListed) }).checked.rows.find((r) => r.key === 'global')).toBeUndefined()
  })
})

// ── Cost by service ──

describe('O-C cost by AWS service', () => {
  it('O-C1 / O-C3 the top 5 plus everything else; the rows add up to the spend', () => {
    const c = costByService(ready(billedSummary()))
    expect(c.sub).toBe('This month, billed · billed through Oct 21')
    expect(c.rows.map((r) => [r.service, r.amount, r.share])).toEqual([
      ['Amazon Elastic Compute Cloud - Compute', '$400.00', 40],
      ['Amazon Relational Database Service', '$300.00', 30],
      ['Amazon Simple Storage Service', '$100.00', 10],
      ['AWS Lambda', '$50.00', 5],
      ['Amazon CloudFront', '$25.00', 2.5],
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
  it('O-C5 a non-round share: the raw ratio in the model, one decimal only for display', () => {
    const third = 100 / 3
    const c = costByService(ready(billedSummary({ amount: 300, top: [
      { service: 'EC2', amount: 100, sharePercent: third },
      { service: 'RDS', amount: 199.88, sharePercent: 66.62666666666667 },
      { service: 'KMS', amount: 0.12, sharePercent: 0.04 },
    ] })))
    expect(c.rows.map((r) => r.share)).toEqual([third, 66.62666666666667, 0.04])
    expect(c.rows.map((r) => (r.share === null ? null : formatShare(r.share)))).toEqual(['33.3%', '66.6%', '<0.1%'])
    expect([formatShare(40), formatShare(2.5), formatShare(12.499367185743936), formatShare(0), formatShare(-0.01)]).toEqual(['40%', '2.5%', '12.5%', '0%', '>-0.1%'])
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
  // PR 3d-1 (D6, R1): the header says the Services page's coverage line's count, from home_only_coverage; a
  // partial home region is checked (G8) and its chip is amber (the old line's "Partly checked").
  it('O-R1 the header count and the inventory chip: "1 of 17 regions"; a partial home region is amber', () => {
    expect(view().checked.rows.find((r) => r.key === 'inventory')).toMatchObject({
      name: 'Resource inventory', detail: ['EC2, EBS, RDS, S3, Lambda, CloudFront'], extra: '16 regions not scanned yet', chip: { text: '1 of 17 regions', tone: 'ok' },
    })
    const partial = coverage({ region_status: [region('us-east-1', { home: true, status: 'partial', last_scan_finished_at: hoursAgo(2) }), region('eu-west-1')] })
    partial.scope.enabled_regions.count = 2
    partial.home_only_coverage = { regions_total: 2, regions_checked: 1 }
    const v = view({ coverage: ready(partial) })
    expect(v.header.status!.regions.text).toBe('1 of 2 regions checked')
    expect(v.checked.rows.find((r) => r.key === 'inventory')!.chip).toEqual({ text: '1 of 2 regions', tone: 'warn' })
  })
  it('O-R1 the denominator is the server\'s regions_total; the regions not scanned yet are the listed rows, as on Services', () => {
    const c = coverage()
    c.scope.enabled_regions.count = 20
    c.home_only_coverage = { regions_total: 20, regions_checked: 1 }
    const v = view({ coverage: ready(c) })
    expect(v.header.status!.regions.text).toBe('1 of 20 regions checked')
    expect(v.checked.rows.find((r) => r.key === 'inventory')!.extra).toBe('16 regions not scanned yet')
  })
  it('O-R1 unknown list and older backend: no "N of M" anywhere', () => {
    for (const state of ['unknown-list', 'older-backend']) {
      const v = view(STATES[state])
      expect(JSON.stringify(v.header.status!.regions)).not.toMatch(/\d+ of \d+/)
      expect(v.header.status!.regions.text).toBe("We haven't read this account's region list yet. It's read during each scan.")
      expect(v.checked.rows.find((r) => r.key === 'inventory')!.extra).toBe('Other regions: region list not read yet')
    }
  })
  it('O-R2 every row exact: IAM partly checked, alarms not shown here, other types not checked', () => {
    const rows = view().checked.rows
    expect(rows.map((r) => r.key)).toEqual(['inventory', 'global', 'security-groups', 'iam', 'alarms', 'other-types'])
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by['security-groups']).toMatchObject({ name: 'Security groups', detail: ['us-east-1, during each scan'], chip: { text: 'Checked', tone: 'ok' } })
    expect(by.iam).toMatchObject({ name: 'IAM', detail: ['Users checked for MFA and old access keys; roles and policies not checked'], chip: { text: 'Partly checked', tone: 'muted' } })
    expect(by['other-types']).toMatchObject({ name: 'Other AWS resource types', detail: ['Not inventoried'], chip: { text: 'Not checked', tone: 'muted' } })
    expect(view().checked.from).toEqual(['From the scan that finished ', { iso: hoursAgo(2) }, '.'])
    // Never scanned: nothing claimed as checked; no security-group row.
    const never = view(STATES['never-scanned']).checked
    expect(never.rows.find((r) => r.key === 'inventory')).toMatchObject({ detail: ['No scan has finished yet.'], chip: { text: 'Not checked yet', tone: 'muted' } })
    expect(never.rows.find((r) => r.key === 'security-groups')).toBeUndefined()
    expect(never.from).toBeNull()
  })
  it('O-AC the alarm row is the constant, with no digit or %, linking to alert history', () => {
    const row = view().checked.rows.find((r) => r.key === 'alarms')!
    expect(row).toMatchObject({ name: 'CloudWatch alarms (EC2/RDS)', detail: ['Unavailable on this page'], chip: { text: 'Not shown here', tone: 'muted' } })
    // No count or percent: the only digit is the 2 of "EC2".
    expect(`${row.name} ${row.detail!.join('')} ${row.chip.text}`.replace('EC2', 'EC')).not.toMatch(/[0-9%]/)
    expect(row.link).toEqual({ text: 'See alert coverage →', href: '/observability/alert-history' })
  })
})

// ── R1: the scan's warnings ──

describe('O-W scan warnings (ruling R1)', () => {
  const withWarnings = (warnings: string[]) => ready(coverage({ last_scan: { ...coverage().last_scan!, warnings } }))
  const warnings = (o: Partial<OverviewInputs>) => view(o).checked.warnings
  it('region_incomplete and scan_budget get no line of their own (the notice and the inventory chip say it)', () => {
    expect(warnings({ coverage: withWarnings(['region_incomplete', 'scan_budget']) })).toEqual([])
    expect(warnings({ inTabWarnings: ['region_incomplete'] })).toEqual([])
  })
  it('scan_deadline: Services\' approved sentence, never the generic one', () => {
    expect(warnings({ coverage: withWarnings(['region_incomplete', 'scan_deadline']) })).toEqual([{ key: 'warning-scan-deadline', text: REDESIGN_COPY.scanDeadline }])
    expect(text({ coverage: withWarnings(['scan_deadline']) })).not.toContain(UNKNOWN_WARNING_TEXT)
  })
  it('a code the page doesn\'t know keeps the generic line; known codes keep their sentences', () => {
    expect(warnings({ coverage: withWarnings(['something_new']) })).toEqual([{ key: 'warning-unknown-warning', text: UNKNOWN_WARNING_TEXT }])
    expect(warnings({ coverage: withWarnings(['deletion_detection_paused_truncated_index']) })).toEqual([{ key: 'warning-deletion-paused', text: DELETION_DETECTION_PAUSED_TEXT }])
    expect(warnings({ coverage: withWarnings(['scan_lease_lost']) })).toEqual([])
  })
})

// ── Unknown is never zero; no account; no raw text ──

describe('O-U1 / O-N1 / O-L1', () => {
  it.each(['stats', 'attention', 'accountFindings', 'costSummary', 'savings'] as const)('O-U1 %s loading or failed produces no 0 from it', (key) => {
    for (const state of [LOADING, ERROR]) {
      const v = view({ [key]: state })
      const fromIt = {
        stats: [v.tiles!.findings.value, v.ownership],
        attention: [v.attention],
        accountFindings: [v.tiles!.findings.accountLine],
        costSummary: [v.tiles!.spend.value, v.costByService],
        savings: [v.tiles!.savings.value],
      }[key]
      expect(JSON.stringify(fromIt)).not.toMatch(/"0"|\$0|0 of|^0$/)
    }
  })
  it('O-N1 no account: the no-account mode, no tiles, table, cost or ownership', () => {
    const v = view(STATES['no-account'])
    expect(v).toMatchObject({ mode: 'no-account', tiles: null, attention: null, costByService: null, ownership: null, notice: null })
    expect(v.header).toEqual({ status: null, scanRunning: false, showSync: false })
    expect(v.checked).toEqual({ from: null, rows: [], warnings: [], error: 'Nothing has been checked yet.' })
  })
  it('O-L1 no raw evidence or AWS error text: only title, recommendation and reason fields are used', () => {
    const leaky = finding('leak', { severity: 'critical', evidence: { schema_version: 1, security_group_id: 'sg-SECRET', security_group_name: 'n', region: 'us-east-1', direction: 'ingress', protocol: 'tcp', from_port: 22, to_port: 22, ip_version: 'v4', cidr: '0.0.0.0/0', detected_at: hoursAgo(1) } })
    const v = view({ accountFindings: ready([leaky]) })
    expect(JSON.stringify(v)).not.toMatch(/sg-SECRET|evidence|0\.0\.0\.0/)
  })
})
