/**
 * PR-UI-b (dashboard-step1.md §C, §F rows 1–9 and 20–26, §H UI; DB-D6, D7,
 * D9–D13): the header's Last scan / Last login, the DevControl service status
 * card, the Data freshness row, savings colours and per-type ceilings, the
 * mobile Recommendation button, P1 and S1 -- and that the four spend states
 * and everything else on the page are unchanged. Synthetic data only.
 *
 * Fixed clock: 2026-11-13T01:37:00Z = Thu Nov 12, 8:37 PM in America/New_York.
 */
process.env.TZ = 'America/New_York'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostSummary, SystemHealth } from '@/lib/types'

const authState = vi.hoisted(() => ({ user: { id: 'u' } as Record<string, unknown> }))

vi.mock('next/navigation', () => {
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return { useRouter: () => router, usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }
})
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null, isConnected: false }) }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test', displayName: 'Acme Labs' }, user: authState.user }),
}))

import DashboardPage from '../page'
import { computeDashboardSpendCard } from '../dashboardSpendCard'
import { dataFreshnessSegments, headerStatusLine, serviceStatusView, SCAN_CADENCE } from '../dashboardFreshness'
import { lastCompletedScanIso } from '@/lib/scan-time'
import { describeCeilings, describeCeilingsWithoutEstimate } from '@/lib/savings-basis'
import { getSystemHealth } from '@/lib/services/monitoring.service'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { accountSecurityFindingsService } from '@/lib/services/account-security-findings.service'
import { awsResourcesService } from '@/lib/services/aws-resources.service'
import awsServicesService, { type ServicesCoverage } from '@/lib/services/aws-services.service'
import { aiSummaryService } from '@/lib/services/ai-summary.service'
import { systemIntelligenceService } from '@/lib/services/system-intelligence.service'
import { activityFeedService } from '@/lib/services/activity-feed.service'
import { soc2Service } from '@/lib/services/soc2.service'
import { complianceFrameworksService } from '@/lib/services/compliance-frameworks.service'

const NOW = Date.parse('2026-11-13T01:37:00Z')
const SCAN_DONE = '2026-11-12T23:02:00Z' // today, 6:02 PM
const PREVIOUS_LOGIN = '2026-11-11T14:14:00Z' // yesterday, 9:14 AM
const CURRENT_LOGIN = '2026-11-13T01:30:00Z' // today, 8:30 PM -- must never appear as "Last login"
const COSTS_FETCHED = '2026-11-12T23:05:00Z' // today, 6:05 PM
const CLOUDWATCH_CAPTURED = '2026-11-13T01:36:00Z' // today, 8:36 PM
const HEALTH_CHECKED = '2026-11-13T01:37:00.000Z' // today, 8:37 PM

const coverage = (overrides: Partial<ServicesCoverage> = {}, stale = false): ServicesCoverage => ({
  account: { connected: true, status: 'active', home_region: 'us-east-1' },
  scope: {
    home_region: { region: 'us-east-1', count: 12 },
    s3: { in_last_scan: true, regions: [] },
    cloudfront: { in_last_scan: false, count: 0 },
    enabled_regions: { known: true, count: 17, listed_at: SCAN_DONE, stale },
  },
  region_status: [],
  scan_in_progress: null,
  last_completed_scan: { started_at: '2026-11-12T22:58:00Z', completed_at: SCAN_DONE, resource_types: ['ec2'], warnings: [] },
  last_successful_scan_at: SCAN_DONE,
  last_scan: { status: 'completed', started_at: '2026-11-12T22:58:00Z', completed_at: SCAN_DONE, warnings: [] },
  resource_types: ['ec2'],
  tags_unknown_by_type: {},
  regions: [{ region: 'us-east-1', count: 12 }],
  total: 12,
  ...overrides,
})
const COVERAGE = {
  finished: coverage(),
  running: coverage({ scan_in_progress: { since: '2026-11-13T01:30:00Z' }, last_scan: { status: 'running', started_at: '2026-11-13T01:30:00Z', completed_at: null, warnings: [] } }),
  failed: coverage({ last_scan: { status: 'failed', started_at: '2026-11-13T00:00:00Z', completed_at: '2026-11-13T00:04:00Z', warnings: [] } }),
  abandoned: coverage({ last_scan: { status: 'running', started_at: '2026-11-12T23:30:00Z', completed_at: null, warnings: [] } }),
  none: coverage({ last_completed_scan: null, last_successful_scan_at: null, last_scan: null }),
  stale: coverage({}, true),
}

type Spend = CostSummary['spend']
const NO_MOM: CostSummary['monthOverMonth'] = { state: 'unavailable', source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null }
const billed = (o: { amount: number; endExclusive: string; finishedThrough: string | null; asOf?: string | null }): Spend => ({
  state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: o.asOf === undefined ? COSTS_FETCHED : o.asOf,
  period: { kind: 'range', start: '2026-11-01', endExclusive: o.endExclusive }, coverage: null, reason: null,
  data: { amount: o.amount, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: o.finishedThrough, topServices: [], previousMonth: { start: '2026-10-01', endExclusive: '2026-11-01', amount: 412.3 } },
})
const SPEND = {
  billed: billed({ amount: 123.45, endExclusive: '2026-11-13', finishedThrough: '2026-11-10' }),
  measuredZero: billed({ amount: 0, endExclusive: '2026-11-13', finishedThrough: '2026-11-10' }),
  noDataYet: billed({ amount: 0, endExclusive: '2026-11-02', finishedThrough: '2026-10-30' }),
  estimated: { state: 'available', source: 'DevControl inventory cost estimate', provenance: 'estimated', asOf: COSTS_FETCHED, coverage: null, reason: null, data: { amount: 80, basis: 'estimated_monthly_run_rate', lastDayInProgress: false } } as Spend,
  unavailable: { state: 'error', source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'the Cost Explorer request failed', data: null } as unknown as Spend,
  notConnected: { state: 'unavailable', source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'no AWS Cost Explorer result (no connected AWS account) and no inventory estimate', data: null } as unknown as Spend,
}
const summary = (spend: Spend): CostSummary => ({ spend, monthOverMonth: NO_MOM })

// ── 1. Header: Last scan · Last login ──

describe('header line (§F row 1, DB-D8)', () => {
  const line = (cov: ServicesCoverage | undefined, previousLoginAt?: string | null) => headerStatusLine({ coverage: cov, previousLoginAt, now: NOW })

  it('finished scan and a previous sign-in, formatted like Security and Infrastructure', () => {
    expect(line(COVERAGE.finished, PREVIOUS_LOGIN)).toBe('Last scan: today, 6:02 PM · Last login: yesterday, 9:14 AM')
  })

  it("running / failed / none reuse Security's own wording", () => {
    expect(line(COVERAGE.running, PREVIOUS_LOGIN)).toBe('Scan running… · Last login: yesterday, 9:14 AM')
    expect(line(COVERAGE.failed, PREVIOUS_LOGIN)).toBe('Last scan failed: today, 7:04 PM · Last login: yesterday, 9:14 AM')
    expect(line(COVERAGE.none, PREVIOUS_LOGIN)).toBe('No scan has finished yet. · Last login: yesterday, 9:14 AM')
  })

  it('previousLoginAt null and absent both omit "Last login"', () => {
    expect(line(COVERAGE.finished, null)).toBe('Last scan: today, 6:02 PM')
    expect(line(COVERAGE.finished, undefined)).toBe('Last scan: today, 6:02 PM')
    expect(line(COVERAGE.finished, 'not a date')).toBe('Last scan: today, 6:02 PM')
  })

  it('coverage loading or failed omits "Last scan"; with neither part there is no line', () => {
    expect(line(undefined, PREVIOUS_LOGIN)).toBe('Last login: yesterday, 9:14 AM')
    expect(line(undefined, null)).toBeNull()
  })

  it('"Last scan" is the shared helper: last completed job, else the last successful scan', () => {
    expect(lastCompletedScanIso(COVERAGE.finished)).toBe(SCAN_DONE)
    // The completed job's own time wins over the account's last-successful timestamp.
    expect(lastCompletedScanIso(coverage({ last_successful_scan_at: '2026-11-10T12:00:00Z' }))).toBe(SCAN_DONE)
    expect(lastCompletedScanIso(coverage({ last_completed_scan: null, last_successful_scan_at: '2026-11-10T12:00:00Z' }))).toBe('2026-11-10T12:00:00Z')
    expect(lastCompletedScanIso(COVERAGE.none)).toBeNull()
  })

  it('Security, Infrastructure and the Dashboard read it from the one shared helper (no private copies left)', () => {
    const root = path.resolve(__dirname, '../../../..')
    for (const file of ['app/(app)/security/overview/securityModel.ts', 'app/(app)/infrastructure/overview/overviewModel.ts']) {
      const src = fs.readFileSync(path.join(root, file), 'utf8')
      expect(src).toContain("import { lastCompletedScanIso as lastCompletedIso } from '@/lib/scan-time'")
      expect(src).not.toMatch(/last_completed_scan\?\.completed_at \?\? c\.last_successful_scan_at/)
    }
    expect(fs.readFileSync(path.join(root, 'app/(app)/dashboard/dashboardFreshness.ts'), 'utf8')).toContain("from '@/lib/scan-time'")
  })
})

// ── 2. Service status (§F rows 2–7, DB-D7) ──

describe('DevControl service status mapping', () => {
  const view = (status: SystemHealth['status'] | undefined, lastUpdate = HEALTH_CHECKED) =>
    serviceStatusView(status ? { status, lastUpdate } : undefined, NOW)

  it('operational: the new caption plus "Checked <time>" from the check itself', () => {
    expect(view('operational')).toMatchObject({ state: 'operational', value: 'Operational', caption: "DevControl's API and database are responding. This is our service, not your AWS resources. · Checked today, 8:37 PM" })
  })
  it('operational without a check time: no "Checked" (never the page-load time)', () => {
    expect(view('operational', '').caption).toBe("DevControl's API and database are responding. This is our service, not your AWS resources.")
  })
  it('degraded / unavailable / checking', () => {
    expect(view('degraded')).toMatchObject({ value: 'Degraded', caption: 'Some DevControl services are slow or failing. Figures on this page may be delayed.' })
    expect(view('disrupted')).toMatchObject({ value: 'Unavailable', caption: "Can't reach DevControl's API right now. Figures on this page may be out of date." })
    expect(view(undefined)).toMatchObject({ value: 'Checking…', caption: "Checking DevControl's own service status." })
  })
})

describe('monitoring.service: Degraded only for a 500 whose database is disconnected', () => {
  afterEach(() => vi.restoreAllMocks())
  const reject = (response?: unknown, code = 'ERR_BAD_RESPONSE') =>
    vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('failed'), { isAxiosError: true, code, response }))

  it('200 ok → operational', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { status: 'ok', database: 'connected' } })
    expect((await getSystemHealth()).status).toBe('operational')
  })
  it('500 {database: "disconnected"} → degraded', async () => {
    reject({ status: 500, data: { status: 'error', database: 'disconnected' } })
    expect((await getSystemHealth()).status).toBe('degraded')
  })
  it.each([
    ['500 without a database field', { status: 500, data: { error: 'Internal Server Error' } }],
    ['503 with database disconnected', { status: 503, data: { status: 'error', database: 'disconnected' } }],
    ['502 from a proxy', { status: 502, data: '<html>Bad gateway</html>' }],
  ])('%s → disrupted', async (_, response) => {
    reject(response)
    expect((await getSystemHealth()).status).toBe('disrupted')
  })
  it('timeout / network error → disrupted', async () => {
    reject(undefined, 'ECONNABORTED')
    expect((await getSystemHealth()).status).toBe('disrupted')
  })
})

// ── 3. Data freshness (§F row 9, DB-D6/D9/D10) ──

describe('data freshness segments', () => {
  const ALL: Parameters<typeof dataFreshnessSegments>[0] = { costSummary: summary(SPEND.billed), costSummaryError: false, coverage: COVERAGE.finished, cloudwatchCapturedAt: Date.parse(CLOUDWATCH_CAPTURED), serviceCheckedAt: HEALTH_CHECKED, now: NOW }
  const seg = (o: Partial<typeof ALL> = {}) => dataFreshnessSegments({ ...ALL, ...o })
  const keys = (o: Partial<typeof ALL> = {}) => seg(o).map((s) => s.key)

  it('every source: the four segments of the mock, each from real data', () => {
    expect(seg().map((s) => `${s.label}: ${s.text}`)).toEqual([
      'Costs: AWS Cost Explorer, billed through Nov 10 · refreshed today, 6:05 PM',
      'Resources and security: last scan today, 6:02 PM · every 6 hours',
      'Alerts: CloudWatch · checked today, 8:36 PM',
      'DevControl service: checked today, 8:37 PM',
    ])
  })

  it('costs, alerts and the service carry no cadence; only the scan does', () => {
    const [costs, resources, alerts, service] = seg()
    for (const s of [costs, alerts, service]) expect(s.text).not.toMatch(/every|hourly|daily|hours/)
    expect(resources.text).toContain(SCAN_CADENCE)
  })

  it('"every 6 hours" is omitted when coverage is stale, the last attempt failed, or it was abandoned', () => {
    for (const cov of [COVERAGE.stale, COVERAGE.failed, COVERAGE.abandoned]) {
      expect(seg({ coverage: cov })[1]).toEqual({ key: 'resources', label: 'Resources and security', text: 'last scan today, 6:02 PM' })
    }
    expect(seg({ coverage: COVERAGE.running })[1].text).toBe('last scan today, 6:02 PM · every 6 hours')
  })

  it('costs: only billed Cost Explorer spend; omitted for an estimate, an error, a failed request or no time', () => {
    expect(keys({ costSummary: summary(SPEND.estimated) })).not.toContain('costs')
    expect(keys({ costSummary: summary(SPEND.unavailable) })).not.toContain('costs')
    expect(keys({ costSummary: summary(SPEND.notConnected) })).not.toContain('costs')
    expect(keys({ costSummary: undefined, costSummaryError: true })).not.toContain('costs')
    expect(keys({ costSummary: summary(billed({ amount: 1, endExclusive: '2026-11-13', finishedThrough: null, asOf: null })) })).not.toContain('costs')
    expect(seg({ costSummary: summary(billed({ amount: 1, endExclusive: '2026-11-13', finishedThrough: null })) })[0].text).toBe('AWS Cost Explorer · refreshed today, 6:05 PM')
    expect(seg({ costSummary: summary(billed({ amount: 1, endExclusive: '2026-11-13', finishedThrough: '2026-11-10', asOf: null })) })[0].text).toBe('AWS Cost Explorer, billed through Nov 10')
  })

  it('DB-D6: on days 1–2 "billed through" is the previous month, shown as-is', () => {
    expect(seg({ costSummary: summary(SPEND.noDataYet) })[0].text).toBe('AWS Cost Explorer, billed through Oct 30 · refreshed today, 6:05 PM')
  })

  it('resources: omitted while coverage loads or failed, and when no scan has finished', () => {
    expect(keys({ coverage: undefined })).not.toContain('resources')
    expect(keys({ coverage: COVERAGE.none })).not.toContain('resources')
  })

  it('alerts: omitted until Resource checks has loaded (DB-D9); service: omitted until a check returned', () => {
    expect(keys({ cloudwatchCapturedAt: null })).toEqual(['costs', 'resources', 'service'])
    expect(keys({ serviceCheckedAt: undefined })).toEqual(['costs', 'resources', 'alerts'])
  })

  it('nothing with a source: no segments', () => {
    expect(seg({ costSummary: undefined, costSummaryError: true, coverage: undefined, cloudwatchCapturedAt: null, serviceCheckedAt: undefined })).toEqual([])
  })
})

// ── 5. Ceiling wording (DB-D13: the weekly email's describeCeilings) ──

describe('per-type ceiling wording', () => {
  const fmt = (n: number) => `$${n.toFixed(2)}`
  it('with an estimate: one "Plus up to" line per type, S3 then DynamoDB; DynamoDB never called S3', () => {
    expect(describeCeilings({ DynamoDB: 0.02, S3: 0.01 }, fmt, 'month')).toEqual([
      'Plus up to $0.01/month if S3 data qualifies for Standard-IA (upper bound, not included above)',
      'Plus up to $0.02/month if DynamoDB provisioned capacity were cut to its observed peak (upper bound, not included above)',
    ])
  })
  it('without an estimate: "Up to … (upper bound)" per type', () => {
    expect(describeCeilingsWithoutEstimate({ DynamoDB: 0.02 }, fmt, 'month')).toEqual(['Up to $0.02/month if DynamoDB provisioned capacity were cut to its observed peak (upper bound)'])
    expect(describeCeilingsWithoutEstimate({ S3: 0 }, fmt, 'month')).toEqual([])
  })
  it('the Cost Optimization page default (/mo) is unchanged', () => {
    expect(describeCeilings({ S3: 1 }, fmt)).toEqual(['Plus up to $1.00/mo if S3 data qualifies for Standard-IA (upper bound, not included above)'])
  })
})

// ── Full page ──

const health = {
  ok: () => vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { status: 'ok', database: 'connected' } }),
  dbDown: () => vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('500'), { isAxiosError: true, response: { status: 500, data: { status: 'error', database: 'disconnected' } } })),
  unreachable: () => vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('timeout'), { isAxiosError: true, code: 'ECONNABORTED' })),
  checking: () => vi.spyOn(axios, 'get').mockImplementation(() => new Promise(() => {})),
}

const component = (label: string, score: number, status: 'good' | 'warning' | 'risk') =>
  ({ score, label, detail: '', severity: 'healthy', delta: null, status, ready: true, state: 'available', reason: null })
const INTELLIGENCE = {
  system_score: 71, status: 'Stable', composite_state: 'available', composite_reason: null, computed_at: '2026-11-12T23:00:00Z', top_action: null, top_drivers: [],
  components: { cost: component('Cost Efficiency', 96, 'good'), security: component('Security Posture', 57, 'risk'), observability: component('Observability', 60, 'warning') },
}
const rec = (id: string, resourceType: string, potentialSavings: number, basis: string | null) => ({
  id, resourceType, resourceId: id, resourceName: id, potentialSavings, severity: 'LOW', status: 'ACTIVE', metadata: basis ? { savings_basis: basis } : {}, title: id, description: '', createdAt: '2026-11-12T00:00:00Z',
})
const stats = (total: number, active: number, byType: Record<string, number>, ceilingByType: Record<string, number>) => ({
  totalPotentialSavings: total, activeRecommendations: active, totalRecommendations: active, potentialSavingsByResourceType: byType,
  potentialSavingsCeilingByResourceType: ceilingByType, potentialSavingsCeiling: Object.values(ceilingByType).reduce((a, b) => a + b, 0),
})

let client: QueryClient
function setup(o: { recs?: unknown[]; stats?: unknown; spend?: Spend; coverage?: ServicesCoverage; connected?: boolean; user?: Record<string, unknown> } = {}) {
  authState.user = o.user ?? { id: 'u', lastLoginAt: CURRENT_LOGIN, previousLoginAt: PREVIOUS_LOGIN }
  vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue({ totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 123.45, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual' } as never)
  vi.spyOn(platformStatsService, 'getCostSummary').mockResolvedValue(summary(o.spend ?? SPEND.billed) as never)
  vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue((o.recs ?? [rec('ebs1', 'EBS', 5.17, 'estimated:x')]) as never)
  vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue((o.stats ?? stats(5.17, 1, { EBS: 5.17 }, {})) as never)
  vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([{ status: 'completed', completed_at: '2026-11-12T23:03:00Z', error_message: null, created_at: '2026-11-12T23:00:00Z' }] as never)
  vi.spyOn(awsResourcesService, 'getDiscoveryJobs').mockResolvedValue([] as never)
  vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 0, high: 1, medium: 2, low: 0 } } as never)
  vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null } as never)
  vi.spyOn(awsServicesService, 'getCoverage').mockResolvedValue(o.coverage ?? COVERAGE.finished)
  vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: null, topRiskStatus: 'none_identified' } as never)
  vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
  vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([] as never)
  vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never)
  vi.spyOn(systemIntelligenceService, 'getIntelligence').mockResolvedValue(INTELLIGENCE as never)
  const connected = o.connected ?? true
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/aws/accounts')) return { ok: true, json: async () => (connected ? { data: [{ id: 'acct', status: 'active' }], connection: { state: 'connected' } } : { data: [], connection: { state: 'not_connected' } }) }
    if (u.includes('/api/cloudwatch/metrics')) {
      return { ok: true, json: async () => ({ success: true, data: {
        healthSummary: { total: 1, healthy: 1, degraded: 0, critical: 0, down: 0, monitored: 1 }, systemStatus: 'healthy',
        services: [{ resourceId: 'i-0abc', name: 'i-0abc', description: '', resourceType: 'ec2', status: 'healthy', uptime: 100, responseTimeMs: null, errorRate: null, critical: false, monitored: true }],
        pagination: { shown: 1, total: 1, hasMore: false, cursor: null }, capturedAt: CLOUDWATCH_CAPTURED,
      } }) }
    }
    return { ok: true, json: async () => ({ data: [] }) }
  }))
}

beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Whole-page renders: under a loaded machine one can exceed the 5 s default.
vi.setConfig({ testTimeout: 15_000 })

const renderDashboard = () => render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
const kpi = (href: string) => screen.getAllByTestId('kpi-card').find((c) => c.querySelector(`a[href="${href}"]`)) as HTMLElement
const serviceCard = () => screen.getByTestId('system-health-card')
async function settled(o: { checking?: boolean } = {}) {
  await waitFor(() => {
    expect(within(kpi('/infrastructure')).getByText(/^\d+$/)).toBeInTheDocument()
    expect(within(screen.getByTestId('resource-checks-section')).queryByText('Loading…')).toBeNull()
    if (!o.checking) expect(serviceCard().textContent).not.toMatch(/Checking/)
  }, { timeout: 4000 })
  await act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })
}

describe('page: service status card', () => {
  it.each([
    ['200 ok', health.ok, 'Operational', false],
    ['500 database disconnected', health.dbDown, 'Degraded', false],
    ['timeout', health.unreachable, 'Unavailable', false],
    ['still checking', health.checking, 'Checking…', true],
  ] as const)('%s → %s; titled "DevControl service status", info panel kept, no /status link', async (_, mock, value, checking) => {
    setup()
    mock()
    renderDashboard()
    await settled({ checking })
    const card = serviceCard()
    expect(within(card).getByText('DevControl service status')).toBeInTheDocument()
    expect(within(card).getByText(value)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'About DevControl service status' })).toBeInTheDocument()
    expect(card.querySelector('a')).toBeNull()
    expect(document.querySelector('a[href="/status"]')).toBeNull()
    expect(card.textContent).not.toMatch(/System Health|Open DevControl status|Not responding/)
    if (value === 'Operational') expect(within(card).getByTestId('system-health-caption').textContent).toMatch(/· Checked today, 8:37 PM$/)
    else expect(within(card).getByTestId('system-health-caption').textContent).not.toContain('Checked')
  })
})

describe('page: header', () => {
  it('shows Last scan and the previous sign-in', async () => {
    setup()
    health.ok()
    renderDashboard()
    await settled()
    expect(screen.getByTestId('dashboard-header-status').textContent).toBe('Last scan: today, 6:02 PM · Last login: yesterday, 9:14 AM')
  })
  it.each([
    ['null', { id: 'u', lastLoginAt: CURRENT_LOGIN, previousLoginAt: null }],
    ['absent (backend without PR-UI-a)', { id: 'u', lastLoginAt: CURRENT_LOGIN }],
  ])('previousLoginAt %s: no "Last login", and never the current sign-in', async (_, user) => {
    setup({ user })
    health.ok()
    renderDashboard()
    await settled()
    expect(screen.getByTestId('dashboard-header-status').textContent).toBe('Last scan: today, 6:02 PM')
    expect(document.body.textContent).not.toContain('Last login')
    expect(document.body.textContent).not.toContain('8:30 PM')
  })
})

describe('page: data freshness row', () => {
  it('replaces the old note; one segment per source', async () => {
    setup()
    health.ok()
    renderDashboard()
    await settled()
    expect(document.body.textContent).not.toContain('Each data source refreshes on its own schedule.')
    const row = screen.getByTestId('data-freshness')
    expect(row.className).toContain('text-meta')
    expect(row.className).toContain('text-ink-muted')
    expect(within(row).getByText('Data freshness')).toBeInTheDocument()
    expect(['costs', 'resources', 'alerts', 'service'].map((k) => within(row).getByTestId(`freshness-${k}`).textContent)).toEqual([
      'Costs: AWS Cost Explorer, billed through Nov 10 · refreshed today, 6:05 PM',
      'Resources and security: last scan today, 6:02 PM · every 6 hours',
      'Alerts: CloudWatch · checked today, 8:36 PM',
      'DevControl service: checked today, 8:37 PM',
    ])
  })
  it('stale coverage: no cadence; estimated spend: no Costs segment', async () => {
    setup({ coverage: COVERAGE.stale, spend: SPEND.estimated })
    health.ok()
    renderDashboard()
    await settled()
    expect(screen.queryByTestId('freshness-costs')).toBeNull()
    expect(screen.getByTestId('freshness-resources').textContent).toBe('Resources and security: last scan today, 6:02 PM')
  })
})

describe('page: savings (F9, F10, DB-D13) and S1', () => {
  const figure = (type: string) => screen.getByTestId(`opportunity-savings-${type}`)
  const tones = (type: string) => [...figure(type).querySelectorAll('[data-tone]')].map((el) => [el.textContent, el.getAttribute('data-tone'), (el as HTMLElement).style.color])

  it('estimate green; ceiling neutral with "· upper bound"; one ceiling line per type; DynamoDB never S3', async () => {
    setup({
      recs: [rec('ebs1', 'EBS', 5.17, 'estimated:x'), rec('s31', 'S3', 0.01, 'ceiling:s3'), rec('ddb1', 'DynamoDB', 0.02, 'ceiling:ddb')],
      stats: stats(5.17, 3, { EBS: 5.17 }, { S3: 0.01, DynamoDB: 0.02 }),
    })
    health.ok()
    renderDashboard()
    await settled()
    expect(tones('EBS')).toEqual([['$5.17/mo', 'success', 'var(--text-success)']])
    expect(tones('S3')).toEqual([['Up to $0.01/mo · upper bound', 'neutral', '']])
    expect(screen.getAllByTestId('savings-ceiling-line').map((l) => l.textContent)).toEqual([
      'Plus up to $0.01/month if S3 data qualifies for Standard-IA (upper bound, not included above).',
      'Plus up to $0.02/month if DynamoDB provisioned capacity were cut to its observed peak (upper bound, not included above).',
    ])
    expect(document.body.textContent).not.toContain('S3 lifecycle')
    // S1: one card, keeping the monthly estimate, every ceiling line and the annual figure.
    const opportunities = screen.getByRole('heading', { name: 'Cost-Saving Opportunities' }).closest('.rounded-2xl') as HTMLElement
    expect(within(opportunities).getByTestId('savings-summary').textContent).toContain('$5.17')
    expect(within(opportunities).getByTestId('savings-annual').textContent).toContain('$62.04')
    expect(within(opportunities).getAllByTestId('savings-ceiling-line')).toHaveLength(2)
    expect(screen.queryByRole('heading', { name: 'Estimated savings' })).toBeNull()
    expect(screen.queryByText('View findings →')).toBeNull()
  })

  it('ceiling-only and RI-only cards are neutral, never --text-success', async () => {
    setup({
      recs: [rec('s31', 'S3', 0.01, 'ceiling:s3'), rec('ri1', 'EC2', 0, null)],
      stats: stats(0, 2, {}, { S3: 0.01 }),
    })
    health.ok()
    renderDashboard()
    await settled()
    expect(tones('S3')).toEqual([['Up to $0.01/mo · upper bound', 'neutral', '']])
    expect(tones('EC2')).toEqual([['No dollar estimate', 'neutral', '']])
    for (const type of ['S3', 'EC2']) expect(figure(type).innerHTML).not.toContain('text-success')
    expect(screen.getAllByTestId('savings-ceiling-line').map((l) => l.textContent)).toEqual(['Up to $0.01/month if S3 data qualifies for Standard-IA (upper bound).'])
  })

  it('an estimate of $0.00 is not green', async () => {
    setup({ recs: [rec('ebs0', 'EBS', 0, 'estimated:x')], stats: stats(0, 1, { EBS: 0 }, {}) })
    health.ok()
    renderDashboard()
    await settled()
    expect(tones('EBS')).toEqual([['$0.00/mo', 'neutral', '']])
  })
})

describe('page: Recommended Action', () => {
  it('no icon on the savings line (text stays green); the CTA is full width and ≥44 px below 640 px, unchanged from sm: up', async () => {
    setup()
    health.ok()
    renderDashboard()
    await settled()
    const line = screen.getByTestId('recommended-action-savings')
    expect(line.textContent).toBe('Estimated potential savings: $5.17/month')
    expect(line.querySelector('svg')).toBeNull()
    expect(line.style.color).toBe('var(--text-success)')
    const cta = screen.getByTestId('recommended-action-cta')
    const classes = cta.className.split(/\s+/)
    for (const c of ['w-full', 'min-h-11', 'justify-center', 'text-center', 'sm:w-auto', 'sm:min-h-0', 'sm:whitespace-nowrap', 'sm:self-center']) expect(classes).toContain(c)
    // Below sm: no nowrap and no self-start (it was intrinsic width, left-aligned).
    expect(classes).not.toContain('whitespace-nowrap')
    expect(classes).not.toContain('self-start')
    expect(cta.textContent).toBe('Review 1 recommendation →')
  })
})

describe('page: P1 and nothing else removed', () => {
  it('the posture KPI has no component caption, and each component score is still on the page', async () => {
    setup()
    health.ok()
    renderDashboard()
    await settled()
    expect(kpi('/infrastructure').textContent).not.toMatch(/Composite ·|Cost 96|Alert coverage 60/)
    expect(within(kpi('/infrastructure')).getByText('71')).toBeInTheDocument()
    for (const [key, score] of [['cost', '96'], ['security', '57'], ['observability', '60']]) {
      expect(screen.getByTestId(`posture-score-${key}`).textContent).toContain(score)
    }
  })

  it('every other section and link is still there', async () => {
    setup()
    health.ok()
    renderDashboard()
    await settled()
    expect(screen.getAllByTestId('kpi-card').map((c) => within(c).getByTestId('kpi-title').textContent)).toEqual(['Month-to-Date Spend', 'Security Posture', 'Infrastructure Posture'])
    for (const id of ['top-risk-card', 'system-health-card', 'posture-section', 'resource-checks-section']) expect(screen.getByTestId(id)).toBeInTheDocument()
    for (const text of ['Recommended action', 'Cost-Saving Opportunities', 'Engineering Health', 'Recent Activity']) expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    for (const href of ['/costs', '/security', '/infrastructure', '/cost-optimization']) expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull()
    expect(screen.getAllByTestId('posture-score-cost')).toHaveLength(1)
  })
})

describe('regression: the four spend states are unchanged (PR-MONEY owns them)', () => {
  it.each(['measuredZero', 'noDataYet', 'unavailable'] as const)('%s: the card face is exactly computeDashboardSpendCard', async (name) => {
    const expected = computeDashboardSpendCard({ costSummary: summary(SPEND[name]), isLoading: false, isError: false })
    setup({ spend: SPEND[name] })
    health.ok()
    renderDashboard()
    await settled()
    const card = kpi('/costs')
    expect(within(card).getByTestId('kpi-title').textContent).toBe(expected.label)
    expect(within(card).getByText(expected.value)).toBeInTheDocument()
    expect(card.textContent).toContain(expected.caption!)
    if (expected.previousMonth) expect(within(card).getByTestId('kpi-secondary-caption').textContent).toBe(expected.previousMonth)
    else expect(within(card).queryByTestId('kpi-secondary-caption')).toBeNull()
  })

  it('the three connected faces stay distinct, and measured $0 is never "—"', () => {
    const face = (s: Spend) => { const c = computeDashboardSpendCard({ costSummary: summary(s), isLoading: false, isError: false }); return `${c.value} | ${c.caption}` }
    expect(face(SPEND.measuredZero)).toBe('$0.00 | Nov 1–12 (UTC) · Actual · AWS Cost Explorer · today still billing')
    expect(face(SPEND.noDataYet)).toBe('— | Nov 1 (UTC) · Actual · AWS Cost Explorer · no billed days yet this month')
    expect(face(SPEND.unavailable)).toBe('— | Could not be retrieved')
    expect(new Set([face(SPEND.measuredZero), face(SPEND.noDataYet), face(SPEND.unavailable), face(SPEND.notConnected)]).size).toBe(4)
  })

  it('not connected: no KPI row, no header line, no freshness row', async () => {
    setup({ connected: false })
    health.ok()
    renderDashboard()
    await waitFor(() => expect(screen.getAllByTestId('preview-card').length).toBeGreaterThan(0))
    await act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.queryByTestId('kpi-row')).toBeNull()
    expect(screen.queryByTestId('data-freshness')).toBeNull()
    expect(screen.queryByTestId('dashboard-header-status')).toBeNull()
  })
})
