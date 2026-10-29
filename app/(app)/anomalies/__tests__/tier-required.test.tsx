/**
 * /anomalies when the server refuses for the plan although the client thinks
 * Pro (a restricted or changed plan): the page's own gate naming the plan --
 * no longer a hard-coded "requires the Pro plan" banner over an empty page --
 * and the 5-minute reload stops. Any other 402 is not a plan answer. Runs
 * through the real anomaly service (fetch stubbed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithKnownPlan } from '@/lib/contexts/__tests__/org-load-harness'
import { resourceLimitBody, tierRequiredBody } from '@/lib/plan/__tests__/tier-required-fixture'
import AnomaliesPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/anomalies',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** GET /api/anomalies answers with `list`; last-scan and anything else are empty. */
function stubAnomalies(list: () => Response) {
  let listCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(String(url)).pathname
    if (path === '/api/anomalies') {
      listCalls += 1
      return list()
    }
    return json(200, { success: true, data: null })
  }))
  return () => listCalls
}

describe('/anomalies: the server requires a higher plan', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('402 TIER_REQUIRED → the gate naming the plan; no banner; the reload stops', async () => {
    const listCalls = stubAnomalies(() => json(402, tierRequiredBody('pro')))
    await renderWithKnownPlan(<AnomaliesPage />, 'pro')
    expect(await screen.findByText('This feature is on the Optimization Engine plan.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See plans' }).getAttribute('href')).toBe('/settings/billing/upgrade')
    expect(screen.queryByText('This feature requires the Pro plan.')).toBeNull()
    expect(screen.queryByText('Anomaly Detection')).toBeNull()
    expect(listCalls()).toBe(1)
    await act(async () => { vi.advanceTimersByTime(300_000 * 2 + 1000) })
    expect(listCalls()).toBe(1)
  })

  it('another 402 → no gate and no plan banner', async () => {
    stubAnomalies(() => json(402, resourceLimitBody()))
    await renderWithKnownPlan(<AnomaliesPage />, 'pro')
    expect(await screen.findByText('Anomaly Detection')).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByText(/This feature is on/)).toBeNull()
    expect(screen.queryByText('This feature requires the Pro plan.')).toBeNull()
  })
})
