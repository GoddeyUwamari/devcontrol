/**
 * Trend-lag round 2, the forecast page follow-ups (trend-lag-review.md):
 *   - R3-L4: GET /api/forecast's 422 INSUFFICIENT_FORECAST_HISTORY (fewer than
 *     7 finished days) is a friendly "not enough finished days yet" state, not
 *     the "Unable to Load Forecast" error card or an error toast;
 *   - R3-L2: days the backend filled with the average (actual: false) get
 *     their own legend entry ("Estimated (filled gap)");
 *   - R3-L3: the history ends on the last finished day; the page says so and
 *     that the next 30 days count from today (forecastStartDate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const getForecast = vi.hoisted(() => vi.fn())
const toastError = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true }),
}))
vi.mock('@/lib/services/forecast.service', () => ({ forecastService: { getForecast, generateScenario: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError, info: vi.fn() } }))

import ForecastPage from '../page'

const utc = (d: string) => new Date(`${d}T00:00:00.000Z`)
const point = (d: string, value: number, actual = true) => ({ date: utc(d), value, actual })

function forecast(history: ReturnType<typeof point>[], forecastStartDate?: string) {
  return {
    id: 'f-1',
    organizationId: '00000000-0000-4000-8000-000000000001',
    generatedAt: utc('2026-11-17'),
    historicalData: history,
    historicalStartDate: history[0].date,
    historicalEndDate: history[history.length - 1].date,
    historicalAverage: 1,
    historicalTotal: history.length,
    predictions: [point('2026-11-13', 1, false), point('2026-11-14', 1, false), point('2026-11-15', 1, false), point('2026-11-16', 1, false), point('2026-11-17', 1, false), point('2026-11-18', 1, false)],
    predictionStartDate: utc('2026-11-13'),
    predictionEndDate: utc('2026-11-18'),
    ...(forecastStartDate ? { forecastStartDate: utc(forecastStartDate) } : {}),
    forecastPeriod: '90d',
    forecastMethod: 'ensemble',
    predicted30Day: 30, predicted60Day: 60, predicted90Day: 90, predictedQuarter: 90, predictedYear: 360,
    growthRate: 0, trend: 'stable', seasonality: false, volatility: 10,
    confidence: 80, confidenceInterval: { lower: 20, upper: 40 },
    aiSummary: 'Summary', aiRisks: [], aiRecommendations: [], modelVersion: 'test',
  }
}

const SEVEN = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'].map((d) => point(d, 1))

beforeEach(() => {
  getForecast.mockReset()
  toastError.mockReset()
})

describe('R3-L4: fewer than 7 finished days', () => {
  it('the 422 shows "Not enough finished days yet" with the counts; no error card, no error toast', async () => {
    getForecast.mockRejectedValue(Object.assign(new Error('Failed to fetch forecast'), {
      status: 422, body: { success: false, code: 'INSUFFICIENT_FORECAST_HISTORY', finishedDays: 3, requiredDays: 7 },
    }))
    render(<ForecastPage />)
    const card = await screen.findByTestId('forecast-short-history')
    expect(card).toHaveTextContent('Not enough finished days yet')
    expect(card).toHaveTextContent('The forecast needs at least 7 days that AWS Cost Explorer has finished reporting. There are 3 so far. Check back in a few days.')
    expect(screen.queryByText('Unable to Load Forecast')).toBeNull()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('one finished day reads "There is 1 so far"', async () => {
    getForecast.mockRejectedValue(Object.assign(new Error('x'), { status: 422, body: { code: 'INSUFFICIENT_FORECAST_HISTORY', finishedDays: 1, requiredDays: 7 } }))
    render(<ForecastPage />)
    expect(await screen.findByTestId('forecast-short-history')).toHaveTextContent('There is 1 so far.')
  })

  it('any other failure (a 500, or a 422 without the code) is still the error card and toast', async () => {
    for (const err of [Object.assign(new Error('x'), { status: 500, body: { error: 'Failed to generate forecast' } }), Object.assign(new Error('x'), { status: 422, body: {} })]) {
      getForecast.mockRejectedValueOnce(err)
      const { unmount } = render(<ForecastPage />)
      expect(await screen.findByText('Unable to Load Forecast')).toBeInTheDocument()
      expect(screen.queryByTestId('forecast-short-history')).toBeNull()
      unmount()
    }
    expect(toastError).toHaveBeenCalledTimes(2)
  })
})

describe('R3-L2 / R3-L3 on a real forecast', () => {
  it('history ending Nov 12 with today Nov 17: says actual spend runs through Nov 12 and the next 30 days count from Nov 17', async () => {
    getForecast.mockResolvedValue(forecast(SEVEN, '2026-11-17'))
    render(<ForecastPage />)
    expect(await screen.findByTestId('forecast-history-end')).toHaveTextContent(
      'Actual spend through Nov 12, the last day AWS Cost Explorer has finished. Later days are predicted. Next 30 days counts from today (Nov 17).')
  })

  it('history ending yesterday: no note (nothing between the last finished day and today)', async () => {
    getForecast.mockResolvedValue(forecast([...SEVEN.slice(1), point('2026-11-16', 1)].map((p, i) => ({ ...p, date: utc(`2026-11-${String(10 + i).padStart(2, '0')}`) })), '2026-11-17'))
    render(<ForecastPage />)
    await screen.findByText('Cost Forecasting')
    expect(screen.queryByTestId('forecast-history-end')).toBeNull()
  })

  it('an older backend (no forecastStartDate): no note', async () => {
    getForecast.mockResolvedValue(forecast(SEVEN))
    render(<ForecastPage />)
    await screen.findByText('Cost Forecasting')
    expect(screen.queryByTestId('forecast-history-end')).toBeNull()
  })

  it('a filled gap day (actual: false) gets the "Estimated (filled gap)" legend entry; none without one', async () => {
    getForecast.mockResolvedValue(forecast([...SEVEN.slice(0, 3), point('2026-11-09', 1, false), ...SEVEN.slice(4)], '2026-11-17'))
    const { unmount } = render(<ForecastPage />)
    const legend = await screen.findByTestId('forecast-estimated-legend')
    expect(legend.textContent).toBe('Estimated (filled gap)')
    expect(document.body.textContent).not.toContain('Estimated (no data)')
    unmount()
    getForecast.mockResolvedValue(forecast(SEVEN, '2026-11-17'))
    render(<ForecastPage />)
    await screen.findByText('Cost Forecasting')
    expect(screen.queryByTestId('forecast-estimated-legend')).toBeNull()
  })
})
