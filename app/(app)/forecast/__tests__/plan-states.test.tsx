/**
 * /forecast waits for a known plan: no Pro gate while the organization loads
 * or fails, and GET /api/forecast only for a known Pro-or-above plan
 * (formerly requested on every mount, for every plan).
 */
import { StrictMode } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/lib/contexts/auth-context'
import {
  describePlanStates, fakeOrgSources, flush, org, renderWithAuth, seedSession,
} from '@/lib/contexts/__tests__/org-load-harness'

const getForecast = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/forecast.service', () => ({ forecastService: { getForecast, generateScenario: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import ForecastPage from '../page'

function forecast() {
  const day = (d: string, value: number) => ({ date: new Date(d), value, actual: true })
  return {
    id: 'f-1', organizationId: '00000000-0000-4000-8000-000000000001', generatedAt: new Date('2026-10-01T00:00:00Z'),
    historicalData: [day('2026-09-29', 10), day('2026-09-30', 11)],
    historicalStartDate: new Date('2026-09-29T00:00:00Z'), historicalEndDate: new Date('2026-09-30T00:00:00Z'),
    historicalAverage: 10.5, historicalTotal: 21,
    predictions: [{ date: new Date('2026-10-01'), value: 12, actual: false }],
    predictionStartDate: new Date('2026-10-01T00:00:00Z'), predictionEndDate: new Date('2026-10-30T00:00:00Z'),
    forecastPeriod: '90d', forecastMethod: 'ensemble',
    predicted30Day: 330, predicted60Day: 660, predicted90Day: 990, predictedQuarter: 990, predictedYear: 3960,
    growthRate: 1, trend: 'stable', seasonality: false, volatility: 10, confidence: 80,
    confidenceInterval: { lower: 300, upper: 360 },
    aiSummary: 'Summary', aiRisks: [], aiRecommendations: [], modelVersion: 'test',
  }
}
const resetForecast = () => { getForecast.mockReset(); getForecast.mockResolvedValue(forecast()) }

describePlanStates('/forecast', {
  render: () => <ForecastPage />,
  entitledTier: 'pro',
  notEntitledTier: 'starter',
  reset: resetForecast,
  paidCalls: () => getForecast.mock.calls.length,
  content: 'Cost Forecasting',
  gate: 'Upgrade to Pro',
})

describe('/forecast: unmounting while the plan loads', () => {
  it('never calls /api/forecast', async () => {
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    seedSession()
    resetForecast()
    const src = fakeOrgSources()
    const view = renderWithAuth(<ForecastPage />)
    await flush()
    expect(screen.getByTestId('plan-loading')).toBeTruthy()
    view.unmount()
    await src.meOk(0, [org('enterprise')])
    expect(getForecast).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

describe('/forecast under React StrictMode', () => {
  it('opened with a known Pro plan, shows the forecast -- not a spinner that never ends', async () => {
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    seedSession()
    resetForecast()
    const src = fakeOrgSources()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // The page mounts once the plan is already known (a client-side
    // navigation), so StrictMode's mount → cleanup → mount hits it directly.
    const tree = (page: boolean) => (
      <StrictMode>
        <QueryClientProvider client={client}>
          <AuthProvider>{page ? <ForecastPage /> : <div>elsewhere</div>}</AuthProvider>
        </QueryClientProvider>
      </StrictMode>
    )
    const view = render(tree(false))
    await flush()
    await src.orgsOk(0, [org('pro')])
    view.rerender(tree(true))

    expect(await screen.findByText('Cost Forecasting')).toBeTruthy()
    expect(screen.queryByText('Generating AI-powered forecast...')).toBeNull()
    expect(screen.queryByTestId('plan-loading')).toBeNull()
    expect(getForecast).toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
