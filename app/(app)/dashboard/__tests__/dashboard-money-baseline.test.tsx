/**
 * Dashboard money, frontend side: the spend card and the Infrastructure
 * "Spend this month" tile built from the backend's pinned cost summaries
 * (backend/src/controllers/__tests__/__fixtures__/dashboard-money/, cases A
 * and B of dashboard-step1.md §A.1), the trend chart's basis subtitle, and the
 * Dashboard's cost socket handler -- pinned in __fixtures__/dashboard-money/.
 * A change in any of them shows up as a diff of those files. To regenerate
 * after an approved change:
 *   DASHBOARD_MONEY_FIXTURES=write npx vitest run dashboard-money-baseline
 * Synthetic data only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostSummary } from '@/lib/types'
import { computeDashboardSpendCard } from '../dashboardSpendCard'
import { describeOverview } from '../../infrastructure/overview/overviewModel'
import { inputs, ready, NOW } from '../../infrastructure/__tests__/overview-fixtures'
import { TREND_TOTALS_NOTE } from '@/lib/cost-trend-basis'
import { CostTrendChart } from '@/components/dashboard/cost-trend-chart'

const socketMock = vi.hoisted(() => {
  const handlers: Record<string, ((data: unknown) => void) | undefined> = {}
  const socket = {
    on: (event: string, fn: (data: unknown) => void) => { handlers[event] = fn },
    off: (event: string) => { delete handlers[event] },
  }
  return { handlers, socket }
})
const toastMock = vi.hoisted(() => ({ calls: [] as Array<[string, unknown[]]> }))

vi.mock('next/navigation', () => {
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return { useRouter: () => router, usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }
})
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: socketMock.socket, isConnected: true }) }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }),
}))
vi.mock('sonner', () => {
  const record = (kind: string) => (...args: unknown[]) => { toastMock.calls.push([kind, args]) }
  return { toast: { info: record('info'), error: record('error'), success: record('success'), warning: record('warning') }, Toaster: () => null }
})

import DashboardPage from '../page'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { monitoringService } from '@/lib/services/monitoring.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { accountSecurityFindingsService } from '@/lib/services/account-security-findings.service'
import { awsResourcesService } from '@/lib/services/aws-resources.service'
import { aiSummaryService } from '@/lib/services/ai-summary.service'
import { systemIntelligenceService } from '@/lib/services/system-intelligence.service'
import { activityFeedService } from '@/lib/services/activity-feed.service'
import { soc2Service } from '@/lib/services/soc2.service'
import { complianceFrameworksService } from '@/lib/services/compliance-frameworks.service'

const BACKEND = path.resolve(__dirname, '../../../../backend/src/controllers/__tests__/__fixtures__/dashboard-money')
const DIR = path.join(__dirname, '__fixtures__', 'dashboard-money')
const WRITE = process.env.DASHBOARD_MONEY_FIXTURES === 'write'

function summary(name: 'caseA' | 'caseB'): CostSummary {
  return JSON.parse(fs.readFileSync(path.join(BACKEND, `${name}.summary.json`), 'utf8')).data
}

function pin(name: string, value: unknown): void {
  const file = path.join(DIR, name)
  const body = `${JSON.stringify(value, null, 2)}\n`
  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file, body)
  }
  expect(body).toBe(fs.readFileSync(file, 'utf8'))
}

describe('spend at 2026-11-01T00:37Z (Oct 31 8:37 PM EDT)', () => {
  it.each(['caseA', 'caseB'] as const)('%s: Dashboard card and Infrastructure tile', (name) => {
    const s = summary(name)
    const card = computeDashboardSpendCard({ costSummary: s, isLoading: false, isError: false })
    const tile = describeOverview(inputs({ costSummary: ready(s) }), NOW).tiles?.spend ?? null
    pin(`${name}.views.json`, { dashboardCard: card, infrastructureSpendTile: tile })
  })
})

describe('trend basis', () => {
  it('constant and chart subtitle per range', () => {
    const subtitles: Record<string, string> = {}
    for (const range of ['7d', '6mo', '1yr'] as const) {
      const { unmount } = render(<CostTrendChart data={[{ date: '2026-10-01', compute: 1, storage: 0, database: 0, network: 0, other: 0, total: 1 }]} dateRange={range} onDateRangeChange={() => {}} />)
      subtitles[range] = screen.getByText(/cost breakdown/).textContent ?? ''
      unmount()
    }
    pin('basis.json', { TREND_TOTALS_NOTE, chartSubtitle: subtitles })
  })
})

describe('Dashboard cost socket handler', () => {
  beforeEach(() => {
    toastMock.calls.length = 0
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue({
      totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 100, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual',
    } as never)
    vi.spyOn(platformStatsService, 'getCostSummary').mockResolvedValue(summary('caseA') as never)
    vi.spyOn(monitoringService, 'getSystemHealth').mockResolvedValue({ status: 'operational' } as never)
    vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue([] as never)
    vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue({ totalPotentialSavings: 0, activeRecommendations: 0 } as never)
    vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([] as never)
    vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } } as never)
    vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null } as never)
    vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: null, topRiskStatus: 'none_identified' } as never)
    vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
    vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([] as never)
    vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never)
    vi.spyOn(systemIntelligenceService, 'getIntelligence').mockResolvedValue(null as never)
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('/api/aws/accounts') ? { data: [{ id: 'acct', status: 'active' }], connection: { state: 'connected' } } : { data: [] }),
    })))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('registered events, and what a cross-organization metrics:costs payload does', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
    await waitFor(() => expect(Object.keys(socketMock.handlers).length).toBeGreaterThan(0))
    const registered = Object.keys(socketMock.handlers).sort()
    const handler = socketMock.handlers['metrics:costs']
    if (handler) handler({ totalCost: 1234.56, monthToDate: 1234.56, trend: 'stable', timestamp: '2026-11-01T00:37:00.000Z' })
    pin('socket.json', { registered, metricsCostsHandler: handler ? 'registered' : 'not registered', toastsAfterMetricsCosts: toastMock.calls })
  })

  it('F12: the Dashboard has no metrics:costs handler and no "AWS costs updated" toast', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
    await waitFor(() => expect(Object.keys(socketMock.handlers).length).toBeGreaterThan(0))
    expect(socketMock.handlers['metrics:costs']).toBeUndefined()
    expect(toastMock.calls.filter(([, args]) => String(args[0]).includes('AWS costs updated'))).toEqual([])
  })
})
