const NOW = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  const now = Date.parse('2026-10-23T15:00:00Z')
  vi.useFakeTimers({ toFake: ['Date'], now })
  return now
})

import { describe, it, expect, vi } from 'vitest'
import type { AccountSecurityFinding } from '@/lib/services/account-security-findings.service'
import type { AWSService, ServicesCoverage } from '@/lib/services/aws-services.service'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'
import type { RiskScore, RiskScoreTrendResponse } from '@/lib/services/risk-score.service'
import {
  FRAMEWORK_STALE_AFTER_MS,
  SECURITY_COPY,
  describeFramework,
  describeSecurity,
  filterRows,
  formatDay,
  formatScore,
  formatScanWhen,
  formatTime,
  groupRows,
  notCheckedText,
  scanLine,
  securityCheckedLines,
  type ResourceWithIssues,
  type SecLoadable,
  type SecurityInputs,
} from '../overview/securityModel'

// Placeholders only.
const ACCOUNT = '000000000000'
const KEY = 'AKIAEXAMPLE000000001'
const DAY = 86_400_000
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

const ready = <T,>(data: T): SecLoadable<T> => ({ status: 'ready', data })
const LOADING = { status: 'loading' } as const
const ERROR = { status: 'error' } as const
const PLAN = { status: 'plan' } as const

// ── Fixtures ──

let n = 0
const finding = (over: Partial<AccountSecurityFinding>): AccountSecurityFinding => ({
  id: `af-${++n}`, organization_id: 'org-1', finding_key: `k-${n}`, category: 'iam', severity: 'high', title: 'A finding',
  recommendation: 'Fix it.', resource_identifier: `arn:aws:iam::${ACCOUNT}:user/example-user`, region: null, status: 'active',
  detected_at: iso(10 * DAY), last_seen_at: iso(0), resolved_at: null, disposition: null, disposition_actor_id: null,
  disposition_at: null, disposition_note: null, evidence: null, created_at: iso(10 * DAY), updated_at: iso(0),
  derived_status: 'active', framework_mapping: null, ...over,
})
const sgEvidence = (protocol: string, from: number, to: number, name = 'example-sg', id = 'sg-0123456789abcdef0') => ({
  schema_version: 1 as const, security_group_id: id, security_group_name: name, region: 'us-east-1', direction: 'ingress' as const,
  protocol, from_port: from, to_port: to, ip_version: 'v4' as const, cidr: '0.0.0.0/0', detected_at: iso(0),
})
const sgFinding = (protocol: string, from: number, to: number, over: Partial<AccountSecurityFinding> = {}) => finding({
  category: 'networking', region: 'us-east-1', severity: from <= 22 && to >= 22 ? 'critical' : 'high',
  title: `Security group "example-sg" (sg-0123456789abcdef0) allows port ${from} from anywhere (0.0.0.0/0)`,
  resource_identifier: `arn:aws:ec2:us-east-1:${ACCOUNT}:security-group/sg-0123456789abcdef0`,
  evidence: sgEvidence(protocol, from, to), ...over,
})
const keyFinding = (over: Partial<AccountSecurityFinding> = {}) => finding({
  severity: 'medium', title: `IAM user "example-user" has an access key (${KEY}) that is 120 days old`,
  evidence: {
    schema_version: 1, resource_type: 'iam_access_key', resource_identifier: `arn:aws:iam::${ACCOUNT}:user/example-user`,
    resource_name: 'example-user', finding_type: 'access_key_stale',
    relevant_aws_attributes: { access_key_id: KEY, age_in_days: 120, key_status: 'Active' }, detected_at: iso(0),
  },
  ...over,
})
const resource = (name: string, issues: ResourceWithIssues['issues'], over: Partial<ResourceWithIssues> = {}): ResourceWithIssues => ({
  id: `res-${name}`, resource_name: name, resource_arn: `arn:aws:s3:::${name}`, resource_type: 's3', region: 'eu-west-1', issues, ...over,
})
const issue = (severity: string, text: string, findingKey?: string) => ({ severity, category: 'public_access', issue: text, recommendation: 'Review it.', findingKey })

const coverage = (over: Partial<ServicesCoverage> = {}, s3 = true): ServicesCoverage => ({
  account: { connected: true, status: 'active', home_region: 'us-east-1' },
  scope: {
    home_region: { region: 'us-east-1', count: 10 },
    s3: { in_last_scan: s3, regions: [] },
    cloudfront: { in_last_scan: false, count: 0 },
    enabled_regions: { known: true, count: 17 },
  },
  region_status: [{ region: 'us-east-1', home: true, status: 'ok', last_scan_finished_at: iso(DAY / 4), last_success_at: iso(DAY / 4), last_error_code: null } as never],
  scan_in_progress: null,
  last_completed_scan: { started_at: iso(DAY / 4), completed_at: iso(DAY / 4), resource_types: ['ec2', 's3'], warnings: [] },
  last_successful_scan_at: iso(DAY / 4),
  last_scan: { status: 'completed', started_at: iso(DAY / 4), completed_at: iso(DAY / 4), warnings: [] },
  resource_types: ['ec2', 's3'], tags_unknown_by_type: {}, regions: [], total: 10,
  ...over,
})

const SCORE: RiskScore = {
  score: 86, grade: 'B', color: '', factors: { encryption: 0, publicAccess: 0, backup: 0, compliance: 0, resourceManagement: 0 },
  complianceIssueCounts: { critical: 0, high: 0, medium: 0, low: 0 }, accountFindingsCounts: { critical: 0, high: 0, medium: 0, low: 0 },
  resourceComplianceCounts: { critical: 0, high: 0, medium: 0, low: 0 }, frameworksAtRisk: [], isPreliminary: false,
}
const trend = (points: [string, number][]): RiskScoreTrendResponse => ({
  current: SCORE, trend: 'stable', trendPercentage: 3,
  history: points.map(([date, score]) => ({ date, score, grade: 'B', factors: SCORE.factors })),
  period: { start: '2026-09-23', end: '2026-10-23', days: 30 },
})

const fw = (id: string, name = id): ComplianceFramework => ({
  id, organization_id: 'org-1', name, description: null, framework_type: 'custom', enabled: true, is_default: false,
  standard_name: null, version: null, created_at: iso(40 * DAY), updated_at: iso(40 * DAY),
})
const scan = (framework_id: string, status: ComplianceScan['status'], score: unknown, msAgo: number, id = `${framework_id}-${status}-${msAgo}`): ComplianceScan => ({
  id, organization_id: 'org-1', framework_id, scan_type: 'manual', status, total_resources: 10, compliant_resources: 0,
  non_compliant_resources: 10, compliance_score: score as number | null, critical_issues: 0, high_issues: 0, medium_issues: 0, low_issues: 0,
  started_at: iso(msAgo), completed_at: status === 'completed' || status === 'failed' ? iso(msAgo) : null, duration_seconds: 1, created_at: iso(msAgo),
})

function inputs(over: Partial<SecurityInputs> = {}): SecurityInputs {
  return {
    score: ready(SCORE),
    trend: ready(trend([['2026-10-21', 89], ['2026-10-23', 86]])),
    accountFindings: ready([]),
    resourceFindings: ready({ kind: 'full', resources: [] }),
    coverage: ready(coverage()),
    frameworks: ready({ frameworks: [], scans: [], scansLimit: 50 }),
    anomalies: ready({ active: 0 }),
    ...over,
  }
}

// ── Formatting ──

describe('one formatter for dates, times and scores (UTC)', () => {
  it('formats a day in UTC, adding the year only outside the current year', () => {
    expect(formatDay('2026-10-03T23:30:00Z', NOW)).toBe('Oct 3')
    expect(formatDay('2026-10-04T00:30:00Z', NOW)).toBe('Oct 4')
    expect(formatDay('2025-12-31T23:59:00Z', NOW)).toBe('Dec 31, 2025')
    expect(formatDay('2026-10-21', NOW)).toBe('Oct 21')
    expect(formatDay('not a date', NOW)).toBeNull()
    expect(formatDay(null, NOW)).toBeNull()
  })
  it('formats a time with the shared Services format, in UTC', () => {
    expect(formatTime('2026-10-23T14:05:00Z', NOW)).toBe('today, 2:05 PM UTC')
    expect(formatTime(undefined, NOW)).toBeNull()
  })
  it('formats a score as a whole percent from a string or number, never rounding up', () => {
    expect(formatScore('0.00')).toBe('0')
    expect(formatScore('87.50')).toBe('87')
    expect(formatScore(99.6)).toBe('99')
    expect(formatScore(100)).toBe('100')
    for (const bad of [null, undefined, '', ' ', 'abc', NaN, Infinity, {}]) expect(formatScore(bad), String(bad)).toBeNull()
  })
})

// ── Rows ──

describe('rows', () => {
  const all = [
    sgFinding('tcp', 443, 443, { derived_status: 'acknowledged' }),
    keyFinding(),
    finding({ derived_status: 'accepted_risk', severity: 'low', title: 'Accepted one' }),
    finding({ derived_status: 'dismissed', severity: 'low', title: 'Dismissed one' }),
    finding({ derived_status: 'resolved', severity: 'critical', title: 'Resolved one' }),
  ]
  const view = describeSecurity(inputs({
    accountFindings: ready(all),
    resourceFindings: ready({ kind: 'full', resources: [resource('example-bucket', [issue('medium', 'S3 bucket accepts HTTP', 's3.https_only')])] }),
  }), NOW)

  it('open = active or acknowledged; accepted and dismissed have their own filters; resolved is not shown', () => {
    expect(filterRows(view.rows, 'all').map((r) => r.title)).toEqual([
      'Security group "example-sg" (sg-0123456789abcdef0) allows port 443 from anywhere (0.0.0.0/0)',
      'IAM user "example-user" has an access key (…0001) that is 120 days old',
      'S3 bucket accepts HTTP',
    ])
    expect(filterRows(view.rows, 'accepted').map((r) => r.title)).toEqual(['Accepted one'])
    expect(filterRows(view.rows, 'dismissed').map((r) => r.title)).toEqual(['Dismissed one'])
    expect(view.rows.some((r) => r.title === 'Resolved one')).toBe(false)
  })

  it('filters in the approved order, each with a count, and All = Resources + Account', () => {
    expect(view.filters.map((f) => [f.label, f.count])).toEqual([['All', 3], ['Resources', 1], ['Account', 2], ['Accepted', 1], ['Dismissed', 1]])
    expect(view.filters[0].count).toBe(view.filters[1].count! + view.filters[2].count!)
  })

  it('account rows carry "First found <day>" in UTC and actions; resource rows carry a review link only', () => {
    const acc = view.rows.find((r) => r.scope === 'account')!
    expect(acc.firstFound).toBe('First found Oct 13')
    expect(acc.canDisposition).toBe(true)
    const res = view.rows.find((r) => r.scope === 'resource')!
    expect(res.firstFound).toBeNull()
    expect(res.canDisposition).toBe(false)
    expect(res.review).toEqual({ text: 'Review in Infrastructure', href: '/infrastructure' })
  })

  it('the web-server hint only on an open web port, the policy statement only on HTTPS-only with a bucket name', () => {
    const web = view.rows.find((r) => r.guidanceKey === 'sg_open_web')!
    expect(web.webHint).toBe('Expected for a web server? Accept the risk with a reason.')
    const admin = describeSecurity(inputs({ accountFindings: ready([sgFinding('tcp', 22, 22)]) }), NOW).rows[0]
    expect(admin.guidanceKey).toBe('sg_open_admin')
    expect(admin.webHint).toBeNull()
    const https = view.rows.find((r) => r.guidanceKey === 's3_https_only')!
    expect(JSON.parse(https.policyStatement!).Resource).toEqual(['arn:aws:s3:::example-bucket', 'arn:aws:s3:::example-bucket/*'])
    expect(view.rows.filter((r) => r.policyStatement !== null)).toHaveLength(1)
  })

  it('a finding without a key shows its own title and recommendation, with no guidance', () => {
    const row = describeSecurity(inputs({ accountFindings: ready([sgFinding('', 22, 22)]) }), NOW).rows[0]
    expect(row.guidanceKey).toBeNull()
    expect(row.guidance).toBeNull()
    expect(row.webHint).toBeNull()
    expect(row.recommendation).toBe('Fix it.')
  })

  it('sorts by severity, then the oldest first-found, then name A–Z', () => {
    const rows = describeSecurity(inputs({
      accountFindings: ready([
        finding({ severity: 'high', detected_at: iso(2 * DAY), evidence: null, resource_identifier: `arn:aws:iam::${ACCOUNT}:user/b-user` }),
        finding({ severity: 'high', detected_at: iso(5 * DAY), evidence: null, resource_identifier: `arn:aws:iam::${ACCOUNT}:user/z-user` }),
        finding({ severity: 'high', detected_at: iso(2 * DAY), evidence: null, resource_identifier: `arn:aws:iam::${ACCOUNT}:user/a-user` }),
        finding({ severity: 'low', detected_at: iso(30 * DAY), evidence: null, resource_identifier: `arn:aws:iam::${ACCOUNT}:user/old-user` }),
        finding({ severity: 'critical', detected_at: iso(1 * DAY), evidence: null, resource_identifier: `arn:aws:iam::${ACCOUNT}:user/new-user` }),
      ]),
      resourceFindings: ready({ kind: 'full', resources: [resource('a-bucket', [issue('high', 'Bucket issue')])] }),
    }), NOW).rows
    expect(rows.map((r) => r.where.name)).toEqual(['new-user', 'z-user', 'a-user', 'b-user', 'a-bucket', 'old-user'])
  })

  it('never prints a full key ID or the account number', () => {
    const text = JSON.stringify(describeSecurity(inputs({
      accountFindings: ready([keyFinding(), keyFinding({ evidence: null }), sgFinding('tcp', 22, 22, { evidence: null })]),
      resourceFindings: ready({ kind: 'full', resources: [resource('example-bucket', [issue('high', `Role arn:aws:iam::${ACCOUNT}:role/example-role can read`)], { resource_name: null })] }),
    }), NOW))
    expect(text).not.toContain(ACCOUNT)
    expect(text).not.toMatch(/(?:AKIA|ASIA)[A-Z0-9]{12,}/)
    expect(text).not.toMatch(/arn:aws:(?:iam|ec2)/)
  })
})

describe('group by issue (M1, M8)', () => {
  const rows = describeSecurity(inputs({
    accountFindings: ready([
      sgFinding('tcp', 443, 443), sgFinding('tcp', 80, 80), sgFinding('tcp', 22, 22),
      keyFinding(), keyFinding(), keyFinding(),
      finding({ severity: 'high', title: 'Unmapped issue', evidence: null }),
    ]),
    resourceFindings: ready({ kind: 'full', resources: [resource('a', [issue('low', 'Missing tags')]), resource('b', [issue('low', 'Missing tags')])] }),
  }), NOW).rows
  const groups = groupRows(filterRows(rows, 'all'))

  it('labels "<title> · <count>", groups key-less findings by their own title', () => {
    expect(groups.map((g) => g.label)).toEqual([
      'Remote-admin port open to the internet · 1',
      'Web port open to the internet · 2',
      'Unmapped issue · 1',
      'Access key older than 90 days · 3',
      'Missing tags · 2',
    ])
  })
  it('orders groups by highest severity, then count, then title; rows inside follow the list order', () => {
    for (const g of groups) expect(g.rows).toEqual(filterRows(rows, 'all').filter((r) => g.rows.includes(r)))
    expect(groups.map((g) => g.severity)).toEqual(['critical', 'high', 'high', 'medium', 'low'])
  })
})

// ── Banner (M2, decision 10) ──

describe('banner', () => {
  const b = (over: Partial<SecurityInputs>) => describeSecurity(inputs(over), NOW).banner
  const crit = sgFinding('tcp', 22, 22)
  const high = keyFinding({ severity: 'high' })

  it('critical and high', () => {
    expect(b({ accountFindings: ready([crit, crit, high]) })).toEqual({ tone: 'danger', headline: '2 critical and 1 high-severity findings need review', detail: null })
  })
  it('drops the high part when there are none, with singular forms', () => {
    expect(b({ accountFindings: ready([crit]) })?.headline).toBe('1 critical finding needs review')
  })
  it('high only, with the no-critical line', () => {
    expect(b({ accountFindings: ready([high]) })).toEqual({ tone: 'warning', headline: '1 high-severity finding needs review', detail: 'No critical findings in the areas we checked.' })
  })
  it('all sources fine with zero findings', () => {
    expect(b({})).toEqual({ tone: 'success', headline: 'No critical or high-severity findings in the areas we checked.', detail: null })
  })
  it('no banner while loading', () => {
    expect(b({ accountFindings: LOADING })).toBeNull()
    expect(b({ resourceFindings: LOADING })).toBeNull()
  })
  it('one source failing while another returns a critical finding: the finding stays, the count is qualified', () => {
    const view = describeSecurity(inputs({ accountFindings: ready([crit]), resourceFindings: ERROR }), NOW)
    expect(view.banner).toEqual({ tone: 'danger', headline: '1 critical finding needs review', detail: "Some checks couldn't load, so this may be incomplete." })
    expect(view.rows).toHaveLength(1)
    expect(view.tiles.findings).toMatchObject({ total: 1, complete: false, note: "Some checks couldn't load, so this may be incomplete." })
    expect(view.filters.map((f) => [f.key, f.count])).toEqual([['all', null], ['resources', null], ['account', 1], ['accepted', 0], ['dismissed', 0]])
  })
  it('a failed account source leaves only the resource count', () => {
    const view = describeSecurity(inputs({ accountFindings: ERROR }), NOW)
    expect(view.filters.map((f) => f.count)).toEqual([null, 0, null, null, null])
  })
  it('a resource critical survives a failed account source', () => {
    const view = describeSecurity(inputs({ accountFindings: ERROR, resourceFindings: ready({ kind: 'full', resources: [resource('x', [issue('critical', 'Bad')])] }) }), NOW)
    expect(view.rows.map((r) => r.title)).toEqual(['Bad'])
    expect(view.banner?.detail).toBe(SECURITY_COPY.incomplete)
  })
  it('a failed source never shows a zero or a "No critical …" line', () => {
    for (const over of [{ resourceFindings: ERROR }, { accountFindings: ERROR }, { resourceFindings: PLAN }, { accountFindings: ready([high]), resourceFindings: ERROR }] as Partial<SecurityInputs>[]) {
      const banner = b(over)!
      expect(JSON.stringify(banner)).not.toMatch(/No critical|\b0 /)
      expect([banner.headline, banner.detail]).toContain(SECURITY_COPY.incomplete)
    }
  })
  it('no "No critical …" without coverage, and "No scan has finished yet." before the first scan', () => {
    expect(b({ coverage: ERROR })?.headline).toBe(SECURITY_COPY.incomplete)
    expect(b({ accountFindings: ready([high]), coverage: ERROR })?.detail).toBeNull()
    expect(b({ coverage: ready(coverage({ last_completed_scan: null, last_successful_scan_at: null })) })?.headline).toBe('No scan has finished yet.')
  })
  it('high only with no finished scan: no "No critical …" line (findings from a scan that stopped early)', () => {
    expect(b({ accountFindings: ready([high]), coverage: ready(coverage({ last_completed_scan: null, last_successful_scan_at: null })) }))
      .toEqual({ tone: 'warning', headline: '1 high-severity finding needs review', detail: null })
  })
  it('high only with the account disconnected: no "No critical …" line', () => {
    expect(b({ accountFindings: ready([high]), coverage: ready(coverage({ account: { connected: false, status: null, home_region: null } })) }))
      .toEqual({ tone: 'warning', headline: '1 high-severity finding needs review', detail: null })
  })
  it('below Pro (the needs-attention list) counts are shown but never called complete', () => {
    const svc = { id: 's1', name: 'example-bucket', type: 's3', region: 'eu-west-1', priority_severity: 'high', attention_cause: 'finding', reason: 'Bucket is public' } as AWSService
    const view = describeSecurity(inputs({ resourceFindings: ready({ kind: 'attention', services: [svc, { ...svc, id: 's2', attention_cause: 'cost_recommendation' }] }) }), NOW)
    expect(view.rows.map((r) => r.title)).toEqual(['Bucket is public'])
    expect(view.rows[0].where.name).toBe('example-bucket')
    const arnNamed = describeSecurity(inputs({ resourceFindings: ready({ kind: 'attention', services: [{ ...svc, name: `arn:aws:iam::${ACCOUNT}:role/example-role` }] }) }), NOW)
    expect(arnNamed.rows[0].where.name).toBe('example-role')
    expect(JSON.stringify(arnNamed.rows)).not.toContain(ACCOUNT)
    expect(view.banner).toEqual({ tone: 'warning', headline: '1 high-severity finding needs review', detail: 'Showing high and critical resource findings.' })
    expect(view.filters.find((f) => f.key === 'resources')).toMatchObject({ count: 1, complete: false })
    expect(view.filters.find((f) => f.key === 'all')).toMatchObject({ count: 1, complete: false })
    expect(view.tiles.findings).toMatchObject({ total: 1, complete: false, note: 'Showing high and critical resource findings.' })
    expect(describeSecurity(inputs({ resourceFindings: ready({ kind: 'attention', services: [] }) }), NOW).banner)
      .toEqual({ tone: 'neutral', headline: null, detail: 'Showing high and critical resource findings.' })
  })
})

// ── Tiles (M7) ──

describe('tiles', () => {
  const t = (over: Partial<SecurityInputs>) => describeSecurity(inputs(over), NOW).tiles

  it('score: the coverage caption, S3 only when it was in the last scan', () => {
    expect(t({}).score).toEqual({ value: 86, caption: 'From the last scan: resources in us-east-1 and S3 buckets in all regions, security groups in us-east-1, IAM users.', retry: false })
    expect(t({ coverage: ready(coverage({}, false)) }).score.caption).toBe('From the last scan: resources in us-east-1, security groups in us-east-1, IAM users.')
    expect(t({ coverage: ERROR }).score.caption).toBe('From the last scan.')
  })
  it('score: never 0 when not available', () => {
    expect(t({ score: ready({ ...SCORE, isPreliminary: true }) }).score).toEqual({ value: null, caption: 'The first scan is still running.', retry: false })
    expect(t({ score: PLAN }).score).toEqual({ value: null, caption: 'The score is on the Pro plan.', retry: false })
    expect(t({ score: ERROR }).score).toEqual({ value: null, caption: "Couldn't load the score.", retry: true })
    expect(t({ score: ready({ ...SCORE, score: NaN }) }).score.value).toBeNull()
    expect(t({ score: LOADING }).score.value).toBeNull()
  })
  it('open findings: critical counted, every severity listed', () => {
    const f = t({ accountFindings: ready([sgFinding('tcp', 22, 22), keyFinding({ severity: 'high' }), keyFinding(), finding({ severity: 'low' }), finding({ severity: 'low', derived_status: 'dismissed' })]) }).findings
    expect(f).toEqual({ total: 4, breakdown: '1 critical · 1 high · 1 medium · 1 low', complete: true, note: null })
  })
  it('open findings: no number when nothing loaded', () => {
    expect(t({ accountFindings: ERROR, resourceFindings: ERROR }).findings).toEqual({ total: null, breakdown: null, complete: false, note: SECURITY_COPY.incomplete })
    expect(t({ accountFindings: LOADING }).findings).toBeNull()
  })
  it('anomalies: "None open" / "<n> open", nothing on error', () => {
    expect(t({}).anomalies).toBe('None open')
    expect(t({ anomalies: ready({ active: 3 }) }).anomalies).toBe('3 open')
    expect(t({ anomalies: ERROR }).anomalies).toBeNull()
    expect(t({ anomalies: ready({ active: NaN }) }).anomalies).toBeNull()
  })
})

// ── Compliance (M5, safeguard 2, decision 12) ──

describe('frameworks', () => {
  const one = (scans: ComplianceScan[]) => describeFramework(fw('fw-1', 'Baseline'), scans, NOW)

  it('current', () => {
    expect(one([scan('fw-1', 'completed', '0.00', 2 * DAY)])).toMatchObject({ state: 'current', text: 'Evaluated Oct 21 · 0%', score: '0', action: null })
  })
  it('stale at exactly 7 days, current at 6 days 23 hours', () => {
    expect(one([scan('fw-1', 'completed', 90, FRAMEWORK_STALE_AFTER_MS - 3_600_000)]).state).toBe('current')
    expect(one([scan('fw-1', 'completed', 90, FRAMEWORK_STALE_AFTER_MS)])).toMatchObject({
      state: 'out_of_date', text: 'Last evaluated Oct 16, over 7 days ago. Findings may have changed.', score: null,
    })
    expect(FRAMEWORK_STALE_AFTER_MS).toBe(7 * DAY)
  })
  it('running hides the previous score', () => {
    const v = one([scan('fw-1', 'completed', 95, 2 * DAY), scan('fw-1', 'running', null, 3_600_000)])
    expect(v).toMatchObject({ state: 'running', score: null, action: null, text: 'Started today, 2:00 PM UTC. The previous result is hidden until this run finishes.' })
    expect(JSON.stringify(v)).not.toContain('95')
    expect(one([scan('fw-1', 'completed', 95, 2 * DAY), scan('fw-1', 'pending', null, 60_000)]).state).toBe('running')
  })
  it('failed hides the previous score and offers Try again', () => {
    const v = one([scan('fw-1', 'completed', 95, 2 * DAY), scan('fw-1', 'failed', null, DAY)])
    expect(v).toMatchObject({ state: 'failed', score: null, text: 'The last run failed on Oct 22. No score is shown as current.', action: { kind: 'try_again', label: 'Try again' } })
    expect(JSON.stringify(v)).not.toContain('95')
  })
  it('never evaluated only when the scan list is the whole history', () => {
    for (const scans of [[], [scan('other', 'completed', 90, DAY)]]) {
      expect(describeFramework(fw('fw-1'), scans, NOW, true)).toMatchObject({ state: 'never', label: 'Never evaluated', text: 'No evaluation yet.', score: null, action: { kind: 'evaluate_now', label: 'Evaluate now' } })
    }
  })
  it('not in the list and the history may be cut off: "Last evaluation not found", no score', () => {
    const notFound = { state: 'not_found', label: 'Last evaluation not found', text: 'Last evaluation not found. Re-evaluate to refresh.', score: null, action: { kind: 're_evaluate', label: 'Re-evaluate now' } }
    expect(one([])).toMatchObject(notFound)
    expect(one([scan('other', 'completed', 90, DAY)])).toMatchObject(notFound)
    // A completed scan without a usable score was an evaluation: never "never".
    expect(describeFramework(fw('fw-1'), [scan('fw-1', 'completed', null, DAY)], NOW, true)).toMatchObject(notFound)
  })
  it('the page knows "never" only when the list came back shorter than its limit', () => {
    const others = (k: number) => Array.from({ length: k }, (_, i) => scan('other', 'completed', 90, DAY + i * 1000, `o-${i}`))
    const state = (k: number, scansLimit: number) =>
      describeSecurity(inputs({ frameworks: ready({ frameworks: [fw('fw-1')], scans: others(k), scansLimit }) }), NOW).frameworks.frameworks[0].state
    expect(state(49, 50)).toBe('never')
    expect(state(0, 50)).toBe('never')
    expect(state(50, 50)).toBe('not_found')
    expect(state(51, 50)).toBe('not_found')
    for (const bad of [0, -1, NaN, 2.5, undefined as unknown as number]) expect(state(0, bad), String(bad)).toBe('not_found')
    const tile = describeSecurity(inputs({ frameworks: ready({ frameworks: [fw('fw-1')], scans: others(50), scansLimit: 50 }) }), NOW).tiles.compliance
    expect(tile).toEqual({ label: 'Last evaluation not found', lastEvaluated: null })
    expect(describeSecurity(inputs({ frameworks: ready({ frameworks: [fw('fw-1')], scans: [], scansLimit: 50 }) }), NOW).tiles.compliance)
      .toEqual({ label: 'Never evaluated', lastEvaluated: null })
  })
  it('no framework at all: the tile says "No frameworks yet.", never an evaluation state', () => {
    const view = describeSecurity(inputs({ frameworks: ready({ frameworks: [], scans: [], scansLimit: 50 }) }), NOW)
    expect(view.tiles.compliance).toEqual({ label: 'No frameworks yet.', lastEvaluated: null })
    expect(view.frameworks).toMatchObject({ status: 'ready', frameworks: [] })
  })
  it('the not-found action reads "Re-evaluate now" (the mock), on the framework and through describeSecurity', () => {
    const view = describeSecurity(inputs({ frameworks: ready({ frameworks: [fw('fw-1')], scans: [scan('fw-1', 'completed', null, DAY)], scansLimit: 50 }) }), NOW)
    expect(view.frameworks.frameworks[0].action).toEqual({ kind: 're_evaluate', label: 'Re-evaluate now' })
  })
  it('below Enterprise: the plan note and See plans; every framework is listed (no cap)', () => {
    const plan = describeSecurity(inputs({ frameworks: PLAN }), NOW)
    expect(plan.frameworks).toMatchObject({ status: 'plan', note: 'Compliance frameworks are on the Enterprise plan.', action: { label: 'See plans' } })
    expect(plan.tiles.compliance).toEqual({ label: 'Compliance frameworks are on the Enterprise plan.', lastEvaluated: null })
    const many = describeSecurity(inputs({ frameworks: ready({ frameworks: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => fw(id)), scans: [], scansLimit: 50 }) }), NOW)
    expect(many.frameworks.frameworks).toHaveLength(6)
  })
  it('the tile shows the stalest framework, with the same date string as the list', () => {
    const view = describeSecurity(inputs({
      frameworks: ready({
        frameworks: [fw('a'), fw('b'), fw('c')],
        scans: [scan('a', 'completed', 90, DAY), scan('b', 'completed', 80, 9 * DAY), scan('c', 'completed', 70, 12 * DAY)],
        scansLimit: 50,
      }),
    }), NOW)
    expect(view.tiles.compliance).toEqual({ label: 'Out of date', lastEvaluated: 'Last evaluated Oct 11' })
    const c = view.frameworks.frameworks.find((f) => f.id === 'c')!
    expect(c.text).toContain(view.tiles.compliance!.lastEvaluated!.replace('Last evaluated ', ''))
    const a = view.frameworks.frameworks.find((f) => f.id === 'a')!
    const tileA = describeSecurity(inputs({ frameworks: ready({ frameworks: [fw('a')], scans: [scan('a', 'completed', 90, DAY)], scansLimit: 50 }) }), NOW).tiles.compliance!
    expect(tileA).toEqual({ label: 'Current', lastEvaluated: `Last evaluated ${a.lastEvaluated}` })
    expect(a.text).toBe(`Evaluated ${a.lastEvaluated} · 90%`)
  })
  it('a failed framework outranks an out-of-date one on the tile', () => {
    const view = describeSecurity(inputs({ frameworks: ready({ frameworks: [fw('a'), fw('b')], scans: [scan('a', 'completed', 90, 9 * DAY), scan('b', 'failed', null, DAY)], scansLimit: 50 }) }), NOW)
    expect(view.tiles.compliance?.label).toBe('Failed')
  })
})

// ── Trend ──

describe('trend', () => {
  const tr = (over: Partial<SecurityInputs>) => describeSecurity(inputs(over), NOW).trend
  it('a negative "stable" change prints with its sign', () => {
    expect(tr({})).toEqual({ note: null, points: [{ label: 'Oct 21', score: 89 }, { label: 'Oct 23', score: 86 }], delta: '-3 pts', caption: 'Daily, at 02:00 UTC.' })
  })
  it('positive, zero, and fewer than two points', () => {
    expect(tr({ trend: ready(trend([['2026-10-01', 80], ['2026-10-23', 84]])) })?.delta).toBe('+4 pts')
    expect(tr({ trend: ready(trend([['2026-10-01', 80], ['2026-10-23', 80]])) })?.delta).toBe('±0 pts')
    expect(tr({ trend: ready(trend([['2026-10-23', 80]])) })?.delta).toBeNull()
    expect(tr({ trend: ready(trend([])) })?.note).toBe('No score history yet')
  })
  it('orders points by date and uses the history, not the reported percentage', () => {
    expect(tr({ trend: ready({ ...trend([['2026-10-23', 70], ['2026-10-01', 80]]), trendPercentage: 5 }) })?.delta).toBe('-10 pts')
  })
  it('plan and error notes', () => {
    expect(tr({ trend: PLAN })?.note).toBe('Score history is on the Pro plan')
    expect(tr({ trend: ERROR })?.note).toBe("Couldn't load score history.")
    expect(tr({ trend: LOADING })).toBeNull()
  })
})

// ── What we checked ──

describe('checked lines', () => {
  it('after a finished scan with S3 in it', () => {
    expect(securityCheckedLines(ready(coverage())).map((l) => [l.label, l.status])).toEqual([
      ['Security groups (us-east-1)', 'checked'],
      ['S3 bucket policies (all regions)', 'checked'],
      ['IAM users: MFA, key age', 'checked'],
      ['IAM roles and policies', 'not_checked'],
      ['Other 16 regions', 'not_checked'],
    ])
  })
  it('S3 "all regions" only when it was in the last scan', () => {
    expect(securityCheckedLines(ready(coverage({}, false))).find((l) => l.key === 's3')?.status).toBe('not_checked')
  })
  it('nothing claimed checked before a scan finishes', () => {
    const lines = securityCheckedLines(ready(coverage({ last_completed_scan: null, last_successful_scan_at: null })))
    expect(lines.filter((l) => l.status === 'checked')).toEqual([])
  })
  it('region list not read, no account, coverage error', () => {
    expect(securityCheckedLines(ready(coverage({ region_status: undefined }))).at(-1)?.label).toBe('Other regions (region list not read yet)')
    expect(securityCheckedLines(ready(coverage({ account: { connected: false, status: null, home_region: null } })))).toEqual([{ key: 'nothing', label: 'Nothing has been checked yet.', status: null }])
    expect(securityCheckedLines(ERROR)[0].status).toBeNull()
    expect(securityCheckedLines(LOADING)).toEqual([])
  })
})

// ── Header scan line, "Not checked yet", empty lines (founder answers of Oct 26) ──

describe('header scan line (answer 12)', () => {
  it('a finished scan: "Last scan: today, <time>" or "<MMM d>, <time>", local time (UTC here), no zone', () => {
    expect(scanLine(ready(coverage()), NOW)).toEqual({ state: 'finished', text: 'Last scan: today, 9:00 AM' })
    const old = iso(3 * DAY)
    expect(scanLine(ready(coverage({ last_completed_scan: { started_at: old, completed_at: old, resource_types: [], warnings: [] }, last_scan: { status: 'completed', started_at: old, completed_at: old, warnings: [] } })), NOW))
      .toEqual({ state: 'finished', text: 'Last scan: Oct 20, 3:00 PM' })
    expect(formatScanWhen('not a date', NOW)).toBeNull()
  })
  it('running wins: "Scan running…"', () => {
    expect(scanLine(ready(coverage({ scan_in_progress: { since: iso(60_000) } })), NOW)).toEqual({ state: 'running', text: 'Scan running…' })
  })
  it('the latest attempt failed: "Last scan failed: <time>", even with an older finished scan', () => {
    const failed = { status: 'failed', started_at: iso(2 * 3_600_000), completed_at: iso(3_600_000), warnings: [] }
    expect(scanLine(ready(coverage({ last_scan: failed })), NOW)).toEqual({ state: 'failed', text: 'Last scan failed: today, 2:00 PM' })
  })
  it('a failed attempt with no time falls back, never an invented line', () => {
    const failed = { status: 'failed', started_at: null, completed_at: null, warnings: [] }
    expect(scanLine(ready(coverage({ last_scan: failed })), NOW)?.state).toBe('finished')
    expect(scanLine(ready(coverage({ last_scan: failed, last_completed_scan: null, last_successful_scan_at: null })), NOW)).toEqual({ state: 'none', text: 'No scan has finished yet.' })
  })
  it('nothing finished: "No scan has finished yet."; no line while coverage loads or failed', () => {
    expect(scanLine(ready(coverage({ last_completed_scan: null, last_successful_scan_at: null, last_scan: null })), NOW)).toEqual({ state: 'none', text: 'No scan has finished yet.' })
    expect(scanLine(LOADING, NOW)).toBeNull()
    expect(scanLine(ERROR, NOW)).toBeNull()
  })
})

describe('"Not checked yet" (banner, right)', () => {
  const regions = (n: number) => Array.from({ length: n }, (_, k) => ({ region: k === 0 ? 'us-east-1' : `xx-test-${k}`, home: k === 0, status: k === 0 ? 'ok' : 'never_scanned', last_scan_finished_at: k === 0 ? iso(DAY / 4) : null, last_success_at: null, last_error_code: null }) as never)
  it('regions and IAM roles, with the singular for one region (answer 11)', () => {
    expect(notCheckedText(ready(coverage()))).toBe('Not checked yet: 16 regions · IAM roles and policies')
    const two = coverage({ region_status: regions(2), scope: { ...coverage().scope, enabled_regions: { known: true, count: 2 } } })
    expect(notCheckedText(ready(two))).toBe('Not checked yet: 1 region · IAM roles and policies')
  })
  it('no region list yet', () => {
    expect(notCheckedText(ready(coverage({ region_status: [] })))).toBe('Not checked yet: other regions (region list not read yet) · IAM roles and policies')
  })
  it('nothing while loading, on error, or with no connected account', () => {
    expect(notCheckedText(LOADING)).toBeNull()
    expect(notCheckedText(ERROR)).toBeNull()
    expect(notCheckedText(ready(coverage({ account: { connected: false, status: null, home_region: null } })))).toBeNull()
  })
  it('the checked list says "Other 1 region" too', () => {
    const two = coverage({ region_status: regions(2), scope: { ...coverage().scope, enabled_regions: { known: true, count: 2 } } })
    expect(securityCheckedLines(ready(two)).find((l) => l.key === 'other-regions')?.label).toBe('Other 1 region')
  })
})

describe('empty lines per filter (e2 16)', () => {
  it('every source loaded after a finished scan: the decided lines', () => {
    expect(describeSecurity(inputs(), NOW).empty).toEqual({
      all: 'No findings in the areas we checked.',
      resources: 'No resource findings.',
      account: 'No account findings.',
      accepted: 'No accepted findings.',
      dismissed: 'No dismissed findings.',
    })
  })
  it('a failed source: the incomplete line on every filter, never "No … findings."', () => {
    for (const over of [{ accountFindings: ERROR }, { resourceFindings: ERROR }] as Partial<SecurityInputs>[]) {
      const empty = describeSecurity(inputs(over), NOW).empty!
      expect(Object.values(empty)).toEqual(Array(5).fill(SECURITY_COPY.incomplete))
    }
  })
  it('below Pro: All and Resources get the attention note; Account, Accepted, Dismissed keep theirs', () => {
    const empty = describeSecurity(inputs({ resourceFindings: ready({ kind: 'attention', services: [] }) }), NOW).empty!
    expect(empty.all).toBe(SECURITY_COPY.attentionOnly)
    expect(empty.resources).toBe(SECURITY_COPY.attentionOnly)
    expect(empty.account).toBe('No account findings.')
  })
  it('no finished scan: "No scan has finished yet." for All, Resources, Account; Accepted/Dismissed unaffected', () => {
    const empty = describeSecurity(inputs({ coverage: ready(coverage({ last_completed_scan: null, last_successful_scan_at: null })) }), NOW).empty!
    expect([empty.all, empty.resources, empty.account]).toEqual(Array(3).fill('No scan has finished yet.'))
    expect(empty.accepted).toBe('No accepted findings.')
    expect(describeSecurity(inputs({ coverage: ERROR }), NOW).empty!.all).toBe('No scan has finished yet.')
  })
  it('while a findings source loads: null', () => {
    expect(describeSecurity(inputs({ accountFindings: LOADING }), NOW).empty).toBeNull()
  })
})
