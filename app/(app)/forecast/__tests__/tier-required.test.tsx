/**
 * /forecast when the server refuses for the plan although the client thinks
 * Pro (a restricted or changed plan): the page's own gate naming the plan,
 * never "Unable to Load Forecast" or a failure toast. Runs through the real
 * forecast service (fetch stubbed), so the 402 body must reach the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithKnownPlan } from '@/lib/contexts/__tests__/org-load-harness'
import { resourceLimitBody, tierRequiredBody } from '@/lib/plan/__tests__/tier-required-fixture'
import { toast } from 'sonner'
import ForecastPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/forecast',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const forecastJson = {
  id: 'f-1', organizationId: '00000000-0000-4000-8000-000000000001', generatedAt: '2026-10-01T00:00:00Z',
  historicalData: [{ date: '2026-09-29', value: 10, actual: true }, { date: '2026-09-30', value: 11, actual: true }],
  historicalStartDate: '2026-09-29T00:00:00Z', historicalEndDate: '2026-09-30T00:00:00Z',
  historicalAverage: 10.5, historicalTotal: 21,
  predictions: [{ date: '2026-10-01', value: 12, actual: false }],
  predictionStartDate: '2026-10-01T00:00:00Z', predictionEndDate: '2026-10-30T00:00:00Z',
  forecastPeriod: '90d', forecastMethod: 'ensemble',
  predicted30Day: 330, predicted60Day: 660, predicted90Day: 990, predictedQuarter: 990, predictedYear: 3960,
  growthRate: 1, trend: 'stable', seasonality: false, volatility: 10, confidence: 80,
  confidenceInterval: { lower: 300, upper: 360 },
  aiSummary: 'Summary', aiRisks: [], aiRecommendations: [], modelVersion: 'test',
}

const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Answers /api/forecast GET and POST /scenario; everything else is not this test's concern. */
function stubForecastFetch(get: () => Response, scenario: () => Response = () => json(500, {})) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url))
    if (String(url).includes('/api/forecast/scenario')) return scenario()
    if (String(url).includes('/api/forecast')) return get()
    return json(404, {})
  }))
  return calls
}

const expectPlanGate = (planName: string) => {
  expect(screen.getByText(`This feature is on the ${planName} plan.`)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'See plans' }).getAttribute('href')).toBe('/settings/billing/upgrade')
  expect(screen.queryByText('Unable to Load Forecast')).toBeNull()
  expect(screen.queryByText('Cost Forecasting')).toBeNull()
}

describe('/forecast: the server requires a higher plan', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(toast.error).mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('GET 402 TIER_REQUIRED → the gate naming the plan, no error card, no toast', async () => {
    stubForecastFetch(() => json(402, tierRequiredBody('pro', '/settings/billing?upgrade=starter')))
    await renderWithKnownPlan(<ForecastPage />, 'pro')
    await screen.findByText('This feature is on the Optimization Engine plan.')
    expectPlanGate('Optimization Engine')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['another 402', () => json(402, resourceLimitBody())],
    ['a 500', () => json(500, { success: false, error: 'Failed to generate forecast' })],
    ['a non-JSON 502', () => json(502, '<html>Bad gateway</html>')],
  ])('%s keeps "Unable to Load Forecast" and the toast', async (_label, get) => {
    stubForecastFetch(get)
    await renderWithKnownPlan(<ForecastPage />, 'pro')
    expect(await screen.findByText('Unable to Load Forecast')).toBeTruthy()
    expect(toast.error).toHaveBeenCalledWith('Failed to load forecast data')
    expect(screen.queryByText(/This feature is on/)).toBeNull()
  })

  it('a scenario refused for the plan → the gate, no "Failed to generate scenario" toast', async () => {
    stubForecastFetch(() => json(200, { forecast: forecastJson }), () => json(402, tierRequiredBody('pro')))
    await renderWithKnownPlan(<ForecastPage />, 'pro')
    await screen.findByText('Cost Forecasting')
    fireEvent.click(screen.getAllByRole('button', { name: /Scenario/i })[0])
    await act(async () => {
      fireEvent.click(await screen.findByText('Traffic Increase'))
    })
    await screen.findByText('This feature is on the Optimization Engine plan.')
    expectPlanGate('Optimization Engine')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a scenario failing otherwise → the toast, no gate', async () => {
    stubForecastFetch(() => json(200, { forecast: forecastJson }), () => json(500, {}))
    await renderWithKnownPlan(<ForecastPage />, 'pro')
    await screen.findByText('Cost Forecasting')
    fireEvent.click(screen.getAllByRole('button', { name: /Scenario/i })[0])
    await act(async () => {
      fireEvent.click(await screen.findByText('Traffic Increase'))
    })
    expect(toast.error).toHaveBeenCalledWith('Failed to generate scenario')
    expect(screen.queryByText(/This feature is on/)).toBeNull()
  })
})
