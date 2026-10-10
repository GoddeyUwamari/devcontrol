/**
 * The forecast is projected from AWS Cost Explorer daily totals, which the
 * backend builds with each cost category floored at $0 -- credits and refunds
 * are left out. A real forecast says so; the demo forecast does not claim a
 * Cost Explorer basis at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const getForecast = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true }),
}))
vi.mock('@/lib/services/forecast.service', () => ({ forecastService: { getForecast, generateScenario: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import ForecastPage from '../page'

function forecast(organizationId: string) {
  const day = (d: string, value: number) => ({ date: new Date(d), value, actual: true })
  return {
    id: 'f-1',
    organizationId,
    generatedAt: new Date('2026-10-01T00:00:00Z'),
    historicalData: [day('2026-09-29', 10), day('2026-09-30', 11)],
    historicalStartDate: new Date('2026-09-29T00:00:00Z'),
    historicalEndDate: new Date('2026-09-30T00:00:00Z'),
    historicalAverage: 10.5,
    historicalTotal: 21,
    predictions: [{ date: new Date('2026-10-01'), value: 12, actual: false }],
    predictionStartDate: new Date('2026-10-01T00:00:00Z'),
    predictionEndDate: new Date('2026-10-30T00:00:00Z'),
    forecastPeriod: '90d',
    forecastMethod: 'ensemble',
    predicted30Day: 330,
    predicted60Day: 660,
    predicted90Day: 990,
    predictedQuarter: 990,
    predictedYear: 3960,
    growthRate: 1,
    trend: 'stable',
    seasonality: false,
    volatility: 10,
    confidence: 80,
    confidenceInterval: { lower: 300, upper: 360 },
    aiSummary: 'Summary',
    aiRisks: [],
    aiRecommendations: [],
    modelVersion: 'test',
  }
}

beforeEach(() => {
  getForecast.mockReset()
})

describe('/forecast basis', () => {
  it('a real forecast says it is projected from Cost Explorer daily totals, credits/refunds excluded', async () => {
    getForecast.mockResolvedValue(forecast('00000000-0000-4000-8000-000000000001'))
    render(<ForecastPage />)
    const basis = await screen.findByTestId('forecast-basis')
    expect(basis.textContent).toBe('Projected from AWS Cost Explorer daily totals · Credits/refunds excluded')
  })

  it('the demo forecast makes no Cost Explorer claim', async () => {
    getForecast.mockResolvedValue(forecast('demo'))
    render(<ForecastPage />)
    await screen.findByText('Cost Forecasting')
    expect(screen.queryByTestId('forecast-basis')).toBeNull()
  })
})
