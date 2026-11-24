/**
 * Multi-region flag-on prep, item 6 (X6; founder ruling Nov 19, N6): under "What DevControl checks",
 * an organization with multi-region scanning switched on (`multi_region` in the coverage response)
 * reads where the cost checks run, with the region from the server's savings_regions. Switched off,
 * or with coverage unread, the card is as before. Fixture data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import { run } from './fixtures'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

const svc = vi.hoisted(() => ({ getCoverage: vi.fn() }))
const RULES = {
  rules: [{ id: 's3_lifecycle', service: 'S3', name: 'Lifecycle optimization', detail: 'Buckets without a lifecycle rule.', status: 'implemented' }],
  summary: { totalRules: 1, implementedCount: 1, plannedCount: 0, services: [{ service: 'S3', implementedCount: 1, totalRules: 1 }] },
}
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    // The scan result banner: nothing waiting to be seen.
    getMyRunResult: async () => null,
    acknowledgeRunResult: async () => undefined,
    getAll: async () => [],
    getStats: async () => ({
      totalRecommendations: 0, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
      potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 },
    }),
    getOptimizationRules: async () => RULES,
    getAnalysisRuns: async () => [run({ detected_count: 0, new_count: 0, persisted_count: 0 })],
    getHidden: async () => ({ latestRun: null, summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 }, items: [] }),
    analyze: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'a', status: 'active' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))
// FAIL is answered here, not by the spy (a spy returning a rejected promise is reported as the test's own error).
vi.mock('@/lib/services/aws-services.service', () => ({ default: { getCoverage: async () => {
  const r = await svc.getCoverage()
  if (r === 'FAIL') throw new Error('500')
  return r
} } }))

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CostOptimizationPage /></QueryClientProvider>)
}

const LINE = 'Cost checks run in your home region, eu-central-1. S3 lifecycle checks cover buckets in every region.'

beforeEach(() => svc.getCoverage.mockReset())

describe('Cost Optimization: where the cost checks run (switched-on organizations only)', () => {
  it('switched on: the line in What DevControl checks, region from savings_regions', async () => {
    svc.getCoverage.mockResolvedValue({ account: { connected: true, home_region: 'eu-central-1' }, multi_region: { savings_regions: ['eu-central-1'] } })
    renderPage()
    const card = await screen.findByTestId('checks-card')
    expect(await within(card).findByTestId('checks-region-line')).toHaveTextContent(LINE)
  })
  it.each([
    ['switched off (no multi_region)', () => svc.getCoverage.mockResolvedValue({ account: { connected: true, home_region: 'eu-central-1' } })],
    ['coverage failed', () => svc.getCoverage.mockResolvedValue('FAIL')],
  ])('%s: no line, the card as before', async (_n, arrange) => {
    arrange()
    renderPage()
    const card = await screen.findByTestId('checks-card')
    await vi.waitFor(() => expect(svc.getCoverage).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(within(card).queryByTestId('checks-region-line')).toBeNull()
    expect(document.body.textContent).not.toContain('Cost checks run in your home region')
  })
})
