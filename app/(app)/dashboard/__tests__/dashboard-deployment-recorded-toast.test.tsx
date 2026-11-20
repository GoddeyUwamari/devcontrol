/**
 * D2: the Dashboard's live-update toast for deployment:completed. That event
 * is sent only when someone records a finished deployment on the Deployments
 * page (the GitHub webhook sends no socket event), so the toast says it was
 * recorded -- not that DevControl deployed it -- and shows no duration and no
 * "check logs" (a hand record has neither).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostSummary } from '@/lib/types'

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
function summary(name: 'caseA'): CostSummary {
  return JSON.parse(fs.readFileSync(path.join(BACKEND, `${name}.summary.json`), 'utf8')).data
}

describe('Dashboard deployment:completed toast', () => {
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

  it.each([
    ['success', 'success', 'Succeeded'],
    ['failed', 'error', 'Failed'],
  ] as const)('%s: "Deployment recorded: {service}" / %s', async (status, kind, description) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
    await waitFor(() => expect(socketMock.handlers['deployment:completed']).toBeDefined())
    toastMock.calls.length = 0
    socketMock.handlers['deployment:completed']!({ deploymentId: 'd1', serviceName: 'api-gateway', status, timestamp: new Date().toISOString() })
    expect(toastMock.calls).toEqual([[kind, ['Deployment recorded: api-gateway', { description }]]])
    expect(JSON.stringify(toastMock.calls)).not.toMatch(/Duration|undefined|Check logs|succeeded:|failed:/)
  })
})
