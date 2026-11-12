/**
 * Dashboard UI (PR-UI-b), pinned through the real DashboardPage with synthetic
 * data: the header, the DevControl service card in every state, the footer,
 * the savings cards (Recommended Action, Cost-Saving Opportunities, Estimated
 * savings) and the posture area. Each region is dumped as one line per text
 * node with its inline color, its nearest `text-*` classes, links and icons,
 * into __fixtures__/dashboard-ui/. A change in any of them shows up as a diff
 * of those files. To regenerate after an approved change:
 *   DASHBOARD_UI_FIXTURES=write npx vitest run dashboard-ui-baseline
 *
 * Fixed clock: 2026-11-13T01:37:00Z = Thu Nov 12, 8:37 PM in America/New_York
 * (the zone is pinned below). Synthetic data only.
 */
process.env.TZ = 'America/New_York'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import axios from 'axios'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostSummary } from '@/lib/types'

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

const DIR = path.join(__dirname, '__fixtures__', 'dashboard-ui')
const WRITE = process.env.DASHBOARD_UI_FIXTURES === 'write'

function pin(name: string, value: unknown): void {
  const file = path.join(DIR, name)
  const body = `${JSON.stringify(value, null, 2)}\n`
  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file, body)
  }
  expect(body).toBe(fs.readFileSync(file, 'utf8'))
}

// ── Synthetic inputs ──

const NOW = Date.parse('2026-11-13T01:37:00Z') // Nov 12, 8:37 PM EST
const SCAN_DONE = '2026-11-12T23:02:00Z' // today, 6:02 PM
const PREVIOUS_LOGIN = '2026-11-11T14:14:00Z' // yesterday, 9:14 AM
const CURRENT_LOGIN = '2026-11-13T01:30:00Z' // today, 8:30 PM: the current sign-in, never shown as "Last login"
const COSTS_FETCHED = '2026-11-12T23:05:00Z' // today, 6:05 PM
const CLOUDWATCH_CAPTURED = '2026-11-13T01:36:00Z' // today, 8:36 PM

const component = (label: string, score: number, status: 'good' | 'warning' | 'risk') =>
  ({ score, label, detail: '', severity: 'healthy', delta: null, status, ready: true, state: 'available', reason: null })
const INTELLIGENCE = {
  system_score: 71, status: 'Stable', composite_state: 'available', composite_reason: null,
  computed_at: '2026-11-12T23:00:00Z', top_action: null, top_drivers: [],
  components: { cost: component('Cost Efficiency', 96, 'good'), security: component('Security Posture', 57, 'risk'), observability: component('Observability', 60, 'warning') },
}

const SPEND: CostSummary = {
  spend: {
    state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: COSTS_FETCHED,
    period: { kind: 'range', start: '2026-11-01', endExclusive: '2026-11-13' }, coverage: null, reason: null,
    data: { amount: 123.45, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: '2026-11-10' },
  },
  monthOverMonth: { state: 'unavailable', source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
}
const SPEND_UNAVAILABLE: CostSummary = {
  spend: { state: 'error', source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'Cost Explorer request failed', data: null },
  monthOverMonth: { state: 'error', source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
}

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
  none: coverage({ last_completed_scan: null, last_successful_scan_at: null, last_scan: null }),
  stale: coverage({}, true),
}

const rec = (id: string, resourceType: string, potentialSavings: number, basis: string | null) => ({
  id, resourceType, resourceId: `${resourceType.toLowerCase()}-${id}`, resourceName: id, potentialSavings, severity: 'LOW', status: 'ACTIVE',
  metadata: basis ? { savings_basis: basis } : {}, title: id, description: '', createdAt: '2026-11-12T00:00:00Z',
})
const stats = (s: { total: number; active: number; byType?: Record<string, number>; ceilingByType?: Record<string, number> }) => ({
  totalPotentialSavings: s.total, activeRecommendations: s.active, totalRecommendations: s.active,
  potentialSavingsByResourceType: s.byType ?? {},
  potentialSavingsCeilingByResourceType: s.ceilingByType ?? {},
  potentialSavingsCeiling: Object.values(s.ceilingByType ?? {}).reduce((a, b) => a + b, 0),
})
type SavingsCase = { recs: unknown[]; stats: unknown | 'fail' }
const SAVINGS: Record<string, SavingsCase> = {
  // An estimate plus S3 and DynamoDB ceilings (mock §7).
  estimateWithCeilings: {
    recs: [rec('ebs1', 'EBS', 5.17, 'estimated:gp2_to_gp3'), rec('s31', 'S3', 0.01, 'ceiling:s3_lifecycle'), rec('ddb1', 'DynamoDB', 0.02, 'ceiling:dynamodb_capacity')],
    stats: stats({ total: 5.17, active: 3, byType: { EBS: 5.17 }, ceilingByType: { S3: 0.01, DynamoDB: 0.02 } }),
  },
  // Only a ceiling: S3 lifecycle's $0.01 upper bound (F9).
  ceilingOnly: {
    recs: [rec('s31', 'S3', 0.01, 'ceiling:s3_lifecycle')],
    stats: stats({ total: 0, active: 1, ceilingByType: { S3: 0.01 } }),
  },
  // Only a DynamoDB ceiling (F10: never labelled S3).
  dynamoCeilingOnly: {
    recs: [rec('ddb1', 'DynamoDB', 0.02, 'ceiling:dynamodb_capacity')],
    stats: stats({ total: 0, active: 1, ceilingByType: { DynamoDB: 0.02 } }),
  },
  // Reserved Instance gaps only: no dollar figure.
  riOnly: {
    recs: [rec('ri1', 'EC2', 0, null), rec('ri2', 'EC2', 0, null)],
    stats: stats({ total: 0, active: 2 }),
  },
  // One type with an estimate and a ceiling.
  mixedType: {
    recs: [rec('s3e', 'S3', 1.2, 'estimated:s3_class'), rec('s3c', 'S3', 0.5, 'ceiling:s3_lifecycle')],
    stats: stats({ total: 1.2, active: 2, byType: { S3: 1.2 }, ceilingByType: { S3: 0.5 } }),
  },
  // The stats request failed.
  statsFailed: { recs: [rec('ebs1', 'EBS', 5.17, 'estimated:gp2_to_gp3')], stats: 'fail' },
}

const health = {
  ok: () => vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, data: { status: 'ok', timestamp: '2026-11-13T01:37:00Z', database: 'connected' } }),
  dbDown: () => vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), {
    isAxiosError: true, code: 'ERR_BAD_RESPONSE', response: { status: 500, data: { status: 'error', timestamp: '2026-11-13T01:37:00Z', database: 'disconnected' } },
  })),
  other500: () => vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), {
    isAxiosError: true, code: 'ERR_BAD_RESPONSE', response: { status: 500, data: { error: 'Internal Server Error' } },
  })),
  unreachable: () => vi.spyOn(axios, 'get').mockRejectedValue(Object.assign(new Error('timeout of 5000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED' })),
  checking: () => vi.spyOn(axios, 'get').mockImplementation(() => new Promise(() => {})),
}

let client: QueryClient

function setup(opts: {
  savings?: SavingsCase
  coverage?: ServicesCoverage | 'fail'
  costSummary?: CostSummary
  cloudwatch?: 'results' | 'fail'
  user?: Record<string, unknown>
} = {}) {
  authState.user = opts.user ?? { id: 'u', lastLoginAt: CURRENT_LOGIN, previousLoginAt: PREVIOUS_LOGIN }
  const savings = opts.savings ?? SAVINGS.estimateWithCeilings
  vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue({
    totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 123.45, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual',
  } as never)
  vi.spyOn(platformStatsService, 'getCostSummary').mockResolvedValue((opts.costSummary ?? SPEND) as never)
  vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue(savings.recs as never)
  if (savings.stats === 'fail') vi.spyOn(costRecommendationsService, 'getStats').mockRejectedValue(new Error('stats failed'))
  else vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue(savings.stats as never)
  vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([{ status: 'completed', completed_at: '2026-11-12T23:03:00Z', error_message: null, created_at: '2026-11-12T23:00:00Z' }] as never)
  vi.spyOn(awsResourcesService, 'getDiscoveryJobs').mockResolvedValue([] as never)
  vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 0, high: 1, medium: 2, low: 0 } } as never)
  vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null } as never)
  const cov = opts.coverage ?? COVERAGE.finished
  if (cov === 'fail') vi.spyOn(awsServicesService, 'getCoverage').mockRejectedValue(new Error('coverage failed'))
  else vi.spyOn(awsServicesService, 'getCoverage').mockResolvedValue(cov)
  vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: null, topRiskStatus: 'none_identified' } as never)
  vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
  vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([] as never)
  vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never)
  vi.spyOn(systemIntelligenceService, 'getIntelligence').mockResolvedValue(INTELLIGENCE as never)
  const cloudwatch = opts.cloudwatch ?? 'results'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes('/api/aws/accounts')) return { ok: true, json: async () => ({ data: [{ id: 'acct', status: 'active' }], connection: { state: 'connected' } }) }
    if (u.includes('/api/cloudwatch/metrics')) {
      return {
        ok: true,
        json: async () => (cloudwatch === 'fail' ? { success: false } : {
          success: true,
          data: {
            healthSummary: { total: 1, healthy: 1, degraded: 0, critical: 0, down: 0, monitored: 1 }, systemStatus: 'healthy',
            services: [{ resourceId: 'i-0abc', name: 'i-0abc', description: '', resourceType: 'ec2', status: 'healthy', uptime: 100, responseTimeMs: null, errorRate: null, critical: false, monitored: true }],
            pagination: { shown: 1, total: 1, hasMore: false, cursor: null },
            capturedAt: CLOUDWATCH_CAPTURED,
          },
        }),
      }
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

// ── Region dumps ──

/** The nearest inline color and `text-*` classes at or above `node` (inside `root`). */
function styleOf(node: Element, root: Element): string {
  let color = ''
  const classes: string[] = []
  for (let el: Element | null = node; el; el = el === root ? null : el.parentElement) {
    if (!color && (el as HTMLElement).style?.color) color = (el as HTMLElement).style.color
    if (classes.length === 0) {
      const own = (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => /^(sm:|lg:)?text-/.test(c))
      if (own.length) classes.push(...own)
    }
    if (color && classes.length) break
  }
  return [color && `color=${color}`, classes.length ? `class=${classes.join(' ')}` : ''].filter(Boolean).join(' ')
}

/** One line per element with its own text (plus links and icons), in document order. */
function dump(root: Element | null): string[] | null {
  if (!root) return null
  const out: string[] = []
  const visit = (node: Element) => {
    if (node.tagName.toLowerCase() === 'svg') { out.push('[icon]'); return }
    const own = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').replace(/\s+/g, ' ').trim()
    const extra: string[] = []
    if (node.tagName === 'A') extra.push(`href=${node.getAttribute('href')}`)
    if (node.tagName === 'BUTTON') extra.push('button')
    if (own || extra.length) {
      const style = own ? styleOf(node, root) : ''
      out.push([own, ...(style ? [`{${style}}`] : []), ...extra.map((e) => `[${e}]`)].join(' '))
    }
    for (const child of node.children) visit(child)
  }
  visit(root)
  return out
}

// Each pin renders the whole page once per state; under a loaded machine that exceeds the 5 s default.
const LOOP_TIMEOUT_MS = 30_000

const renderDashboard = () => render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
const kpi = (href: string) => screen.getAllByTestId('kpi-card').find((c) => c.querySelector(`a[href="${href}"]`)) as HTMLElement
const card = (title: string) => screen.queryAllByText(title).map((el) => el.closest('.rounded-2xl')).find(Boolean) ?? null

/** Everything above the fold has loaded, the savings cards have data and Resource checks has answered. */
async function settled(opts: { checking?: boolean } = {}) {
  await waitFor(() => {
    expect(within(kpi('/infrastructure')).getByText(/^\d+$/)).toBeInTheDocument()
    expect(within(kpi('/costs')).queryByText('Loading…')).toBeNull()
    const checks = screen.getByTestId('resource-checks-section')
    expect(within(checks).queryByText('Loading…')).toBeNull()
    if (!opts.checking) expect(screen.getByTestId('system-health-card').textContent).not.toMatch(/Checking/)
  }, { timeout: 4000 })
  // Let every other already-resolved query (and its re-render) land.
  await act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) })
}

const header = () => dump(screen.getByRole('heading', { level: 1 }).parentElement)
// The old note's or the new row's own element; null when the page renders neither (the row is omitted).
const footer = (container: HTMLElement) => dump(container.querySelector('[data-testid="data-refresh-note"], [data-testid="data-freshness"]'))

// ── Pins ──

describe('header', () => {
  const cases: Array<[string, Parameters<typeof setup>[0]]> = [
    ['finished scan, previous sign-in', { coverage: COVERAGE.finished }],
    ['scan running, previousLoginAt null', { coverage: COVERAGE.running, user: { id: 'u', lastLoginAt: CURRENT_LOGIN, previousLoginAt: null } }],
    ['last scan failed, previousLoginAt absent', { coverage: COVERAGE.failed, user: { id: 'u', lastLoginAt: CURRENT_LOGIN } }],
    ['no scan finished yet', { coverage: COVERAGE.none }],
    ['coverage request failed', { coverage: 'fail' }],
  ]
  it('every state', async () => {
    const result: Record<string, unknown> = {}
    for (const [name, opts] of cases) {
      setup(opts)
      const { unmount } = renderDashboard()
      await settled()
      result[name] = header()
      unmount()
      vi.restoreAllMocks()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    }
    pin('header.json', result)
  }, LOOP_TIMEOUT_MS)
})

describe('DevControl service card', () => {
  const cases: Array<[string, () => unknown, boolean]> = [
    ['200 ok', health.ok, false],
    ['500 database disconnected', health.dbDown, false],
    ['500 without a database field', health.other500, false],
    ['timeout / network', health.unreachable, false],
    ['still checking', health.checking, true],
  ]
  it('every state', async () => {
    const result: Record<string, unknown> = {}
    for (const [name, mockHealth, checking] of cases) {
      setup()
      mockHealth()
      const { unmount } = renderDashboard()
      await settled({ checking })
      result[name] = dump(screen.getByTestId('system-health-card'))
      unmount()
      vi.restoreAllMocks()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    }
    pin('service-card.json', result)
  }, LOOP_TIMEOUT_MS)
})

describe('footer', () => {
  const cases: Array<[string, Parameters<typeof setup>[0], () => unknown, boolean]> = [
    ['every source', {}, health.ok, false],
    ['coverage stale', { coverage: COVERAGE.stale }, health.ok, false],
    ['last scan attempt failed', { coverage: COVERAGE.failed }, health.ok, false],
    ['no sources: costs unavailable, coverage failed, CloudWatch failed, service still checking', { costSummary: SPEND_UNAVAILABLE, coverage: 'fail', cloudwatch: 'fail' }, health.checking, true],
  ]
  it('every state', async () => {
    const result: Record<string, unknown> = {}
    for (const [name, opts, mockHealth, checking] of cases) {
      setup(opts)
      mockHealth()
      const { container, unmount } = renderDashboard()
      await settled({ checking })
      result[name] = footer(container)
      unmount()
      vi.restoreAllMocks()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    }
    pin('footer.json', result)
  }, LOOP_TIMEOUT_MS)
})

describe('savings cards', () => {
  it('every state', async () => {
    const result: Record<string, unknown> = {}
    for (const [name, savings] of Object.entries(SAVINGS)) {
      setup({ savings })
      health.ok()
      const { unmount } = renderDashboard()
      await settled()
      await waitFor(() => expect(within(card('Cost-Saving Opportunities') as HTMLElement).queryByText('Loading…')).toBeNull())
      const action = card('Recommended action')
      result[name] = {
        recommendedAction: dump(action),
        recommendedActionCtaClass: action?.querySelector('a')?.getAttribute('class') ?? null,
        opportunities: dump(card('Cost-Saving Opportunities')),
        estimatedSavingsCard: dump(screen.queryAllByRole('heading', { level: 3 }).find((h) => h.textContent === 'Estimated savings')?.closest('.rounded-2xl') ?? null),
      }
      unmount()
      vi.restoreAllMocks()
      vi.spyOn(console, 'error').mockImplementation(() => {})
      client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    }
    pin('savings.json', result)
  }, LOOP_TIMEOUT_MS)
})

describe('posture area', () => {
  it('KPI card and the Infrastructure Posture section', async () => {
    setup()
    health.ok()
    renderDashboard()
    await settled()
    pin('posture.json', { kpi: dump(kpi('/infrastructure')), section: dump(screen.getByTestId('posture-section')) })
  }, LOOP_TIMEOUT_MS)
})

it('the fixture clock and zone are what the pins assume', () => {
  expect(Date.now()).toBe(NOW)
  expect(new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(NOW).replace(/[  ]/g, ' ')).toBe('8:37 PM')
})
