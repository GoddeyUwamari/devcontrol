/**
 * PR4a (empty states): /forecast with no AWS account connected.
 *
 * The page reads the server's connection state first (GET /api/aws/accounts, the
 * ['aws-accounts'] query Costs and Cost Optimization share). Not connected, on any
 * plan: the page title and subtitle and the shared NotConnectedCard; GET /api/forecast
 * is never requested, and there is no plan lock, no "Unable to Load Forecast", no toast
 * and no "Generating AI-powered forecast..." screen. Until the check answers: grey
 * blocks only, and no request.
 *
 * Connected: unchanged (the forecast for Pro, the plan lock for free). A failed or
 * ambiguous check is today's page too. A 409 NOT_CONNECTED from /api/forecast (the
 * account went after the check) shows the not-connected state and refreshes the
 * connection query, with no toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

type Connection = 'connected' | 'not_connected' | 'ambiguous'

const getForecast = vi.hoisted(() => vi.fn())
const getConnection = vi.hoisted(() => vi.fn<() => Promise<Connection | 'FAIL' | 'PENDING'>>())
const accountsCalls = vi.hoisted(() => ({ n: 0 }))
const toastFns = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn() }))
const planTier = vi.hoisted(() => ({ value: 'pro' as 'free' | 'pro' }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => {
    const pro = planTier.value === 'pro'
    return { status: 'known', isKnown: true, isFree: !pro, isStarter: pro, isPro: pro, isEnterprise: false, tier: planTier.value, canAccess: () => pro }
  },
}))
vi.mock('@/lib/services/forecast.service', () => ({ forecastService: { getForecast, generateScenario: vi.fn() } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: {
    getAccountsAndConnection: async () => {
      accountsCalls.n += 1
      // FAIL and PENDING are answered here, not by the spy (a rejected or never-settling
      // spy result is reported by vitest as the test's own error).
      const r = await getConnection()
      if (r === 'FAIL') throw new Error('500')
      if (r === 'PENDING') return new Promise(() => {})
      const active = r === 'connected' ? 1 : r === 'ambiguous' ? 2 : 0
      return { accounts: Array.from({ length: active }, (_, i) => ({ id: `a${i}`, status: 'active' })), connection: r }
    },
  },
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), toastFns) }))

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

const TITLE = 'Cost Forecasting'
const SUBTITLE = 'AI-powered predictions and scenario planning for your AWS costs'
const LOCK = 'On the Optimization Engine plan'
const LOCK_TEXT = 'AI-powered forecasting is on the Optimization Engine plan.'

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ForecastPage />
    </QueryClientProvider>
  )
}

/** Lets pending promises and effects settle. */
const settle = () => new Promise((r) => setTimeout(r, 30))

/** Nothing of the paid page, the lock, the error state or the loading screen. */
function expectOnlyNotConnected() {
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(TITLE)
  expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
  const card = screen.getByTestId('not-connected-card')
  expect(card).toHaveTextContent('No AWS account connected')
  expect(screen.getByTestId('not-connected-card-button').getAttribute('href')).toBe('/connect-aws')
  expect(screen.queryByText(LOCK)).toBeNull()
  expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  expect(screen.queryByText('Unable to Load Forecast')).toBeNull()
  expect(screen.queryByText('Generating AI-powered forecast...')).toBeNull()
  expect(screen.queryByTestId('plan-loading')).toBeNull()
  expect(screen.queryByTestId('forecast-basis')).toBeNull()
  expect(toastFns.error).not.toHaveBeenCalled()
}

beforeEach(() => {
  getForecast.mockReset()
  getForecast.mockResolvedValue(forecast())
  getConnection.mockReset()
  accountsCalls.n = 0
  toastFns.error.mockReset()
  planTier.value = 'pro'
})

describe('/forecast with no AWS account connected', () => {
  it('Pro: title, subtitle and the NotConnectedCard; no forecast request', async () => {
    getConnection.mockResolvedValue('not_connected')
    renderPage()
    await screen.findByTestId('not-connected-card')
    await settle()
    expectOnlyNotConnected()
    expect(getForecast).not.toHaveBeenCalled()
  })

  it('free: the NotConnectedCard, NOT the plan lock; no forecast request', async () => {
    planTier.value = 'free'
    getConnection.mockResolvedValue('not_connected')
    renderPage()
    await screen.findByTestId('not-connected-card')
    await settle()
    expectOnlyNotConnected()
    expect(getForecast).not.toHaveBeenCalled()
  })

  it('while the connection check runs: grey blocks only, no request, no lock, no card', async () => {
    getConnection.mockResolvedValue('PENDING')
    for (const tier of ['pro', 'free'] as const) {
      planTier.value = tier
      const { unmount } = renderPage()
      await settle()
      expect(screen.getByTestId('plan-loading')).toBeInTheDocument()
      expect(screen.queryByTestId('not-connected-card')).toBeNull()
      expect(screen.queryByText(LOCK)).toBeNull()
      expect(screen.queryByText('Generating AI-powered forecast...')).toBeNull()
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
      unmount()
    }
    expect(getForecast).not.toHaveBeenCalled()
  })
})

describe('/forecast with an AWS account connected: unchanged', () => {
  it('Pro: requests and shows the forecast', async () => {
    getConnection.mockResolvedValue('connected')
    renderPage()
    expect(await screen.findByTestId('forecast-basis')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(TITLE)
    expect(getForecast).toHaveBeenCalledTimes(1)
    expect(getForecast).toHaveBeenCalledWith('90d')
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it('free: the plan lock exactly as today (Forecast header, lock heading, sentence, See plans); no card, no request', async () => {
    planTier.value = 'free'
    getConnection.mockResolvedValue('connected')
    renderPage()
    expect(await screen.findByText(LOCK)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Forecast')
    expect(screen.getByText('Predictive budget forecasting powered by AI.')).toBeInTheDocument()
    expect(screen.getByText(LOCK_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See plans' }).getAttribute('href')).toBe('/settings/billing/upgrade')
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    await settle()
    expect(getForecast).not.toHaveBeenCalled()
  })
})

describe('a failed or ambiguous connection check: today\'s page, unchanged', () => {
  it.each(['FAIL', 'ambiguous'] as const)('%s, Pro: the forecast is requested and shown, no card', async (answer) => {
    getConnection.mockResolvedValue(answer)
    renderPage()
    expect(await screen.findByTestId('forecast-basis')).toBeInTheDocument()
    expect(getForecast).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it.each(['FAIL', 'ambiguous'] as const)('%s, free: the plan lock, no card', async (answer) => {
    planTier.value = 'free'
    getConnection.mockResolvedValue(answer)
    renderPage()
    expect(await screen.findByText(LOCK)).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(getForecast).not.toHaveBeenCalled()
  })
})

describe('the account went after the check: 409 NOT_CONNECTED from /api/forecast', () => {
  it('shows the not-connected state and refreshes the connection query; no toast, no error card', async () => {
    getConnection.mockResolvedValueOnce('connected').mockResolvedValue('not_connected')
    getForecast.mockRejectedValue(Object.assign(new Error('Failed to fetch forecast'), {
      status: 409, body: { success: false, code: 'NOT_CONNECTED', error: 'Connect an AWS account before generating a forecast.' },
    }))
    renderPage()
    await screen.findByTestId('not-connected-card')
    await waitFor(() => expect(accountsCalls.n).toBe(2))
    await settle()
    expectOnlyNotConnected()
    expect(getForecast).toHaveBeenCalledTimes(1)
  })

  it('a 409 without the NOT_CONNECTED code is still the error card and toast', async () => {
    getConnection.mockResolvedValue('connected')
    getForecast.mockRejectedValue(Object.assign(new Error('x'), { status: 409, body: { success: false, error: 'Busy' } }))
    renderPage()
    expect(await screen.findByText('Unable to Load Forecast')).toBeInTheDocument()
    expect(toastFns.error).toHaveBeenCalledWith('Failed to load forecast data')
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(accountsCalls.n).toBe(1)
  })
})
