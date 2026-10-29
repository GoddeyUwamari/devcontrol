/**
 * /costs/efficiency waits for a known workspace before loading anything, and
 * requests /api/anomalies (Pro-only) only for a known Pro-or-above plan. A
 * non-Pro plan gets the page with the existing "not currently available"
 * anomalies text, never an absence claim. The page has no whole-page gate;
 * its Pro banner shows for a known plan below Pro (presentation only: no
 * request changes with it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import {
  advanceToAutoRetry, fakeOrgSources, flush, org, renderWithAuth, seedSession, WORKSPACE_ERROR,
} from '@/lib/contexts/__tests__/org-load-harness'

const getCostSummary = vi.hoisted(() => vi.fn())
const getAllResources = vi.hoisted(() => vi.fn(async () => []))
const getStats = vi.hoisted(() => vi.fn(async () => ({ totalPotentialSavings: 0, activeRecommendations: 0 })))
const getAnomalies = vi.hoisted(() => vi.fn(async () => ({ anomalies: [] })))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: { getCostSummary, getDashboardStats: vi.fn() },
}))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: getAllResources } }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({ costRecommendationsService: { getStats } }))
vi.mock('@/lib/services/anomaly.service', () => ({ anomalyService: { getAnomalies } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/costs/efficiency',
  useSearchParams: () => new URLSearchParams(),
}))

import EfficiencyPage from '../page'

let trendCalls = 0
const CONTENT = 'Efficiency score by service'
const NOT_AVAILABLE = 'Cost anomaly detection is not currently available.'
const BANNER = 'Full Efficiency Analysis — Pro Plan'

const freeReads = () =>
  getCostSummary.mock.calls.length + getAllResources.mock.calls.length + getStats.mock.calls.length + trendCalls

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getCostSummary.mockReset()
  getCostSummary.mockResolvedValue({
    spend: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
  })
  getAllResources.mockClear()
  getStats.mockClear()
  getAnomalies.mockClear()
  trendCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/platform/costs/trend')) trendCalls += 1
    return { ok: true, json: async () => ({ success: true, data: [] }) }
  }))
  seedSession()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function mount() {
  const src = fakeOrgSources()
  renderWithAuth(<EfficiencyPage />)
  await flush()
  return src
}

function expectLoadingOnly() {
  expect(screen.getByTestId('plan-loading')).toBeTruthy()
  expect(screen.queryByText(CONTENT)).toBeNull()
  expect(freeReads()).toBe(0)
  expect(getAnomalies).not.toHaveBeenCalled()
}

describe('/costs/efficiency: plan states', () => {
  it('loading → Pro: a skeleton and no request until known; then the page, with anomalies', async () => {
    const src = await mount()
    expectLoadingOnly()
    await src.orgsOk(0, [org('pro')])
    await screen.findByText(CONTENT)
    expect(freeReads()).toBeGreaterThan(0)
    expect(getAnomalies).toHaveBeenCalledTimes(1)
  })

  it('loading → not Pro: the page loads its free reads, never /api/anomalies, and makes no absence claim', async () => {
    const src = await mount()
    expectLoadingOnly()
    await src.meOk(0, [org('starter')])
    await screen.findByText(CONTENT)
    expect(freeReads()).toBeGreaterThan(0)
    expect(getAnomalies).not.toHaveBeenCalled()
    expect(screen.getByText(NOT_AVAILABLE)).toBeTruthy()
    expect(screen.queryByText('No cost anomalies detected')).toBeNull()
    expect(screen.getByText(BANNER)).toBeTruthy()
  })

  it('loading → org fetch error: the retry message, no request', async () => {
    const src = await mount()
    await src.failBoth(0)
    expectLoadingOnly()
    await advanceToAutoRetry()
    await src.failBoth(1)
    expect(await screen.findByText(WORKSPACE_ERROR)).toBeTruthy()
    expect(screen.queryByText(CONTENT)).toBeNull()
    expect(screen.queryByText(BANNER)).toBeNull()
    expect(freeReads()).toBe(0)
    expect(getAnomalies).not.toHaveBeenCalled()
  })

  it('error → Try again → Pro', async () => {
    const src = await mount()
    await src.failBoth(0)
    await advanceToAutoRetry()
    await src.failBoth(1)
    await screen.findByText(WORKSPACE_ERROR)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    })
    expect(freeReads()).toBe(0)
    await src.meOk(2, [org('enterprise')])
    await screen.findByText(CONTENT)
    expect(getAnomalies).toHaveBeenCalledTimes(1)
  })
})

describe('/costs/efficiency: the Pro banner', () => {
  it.each([
    ['free', true],
    ['starter', true],
    ['pro', false],
    ['enterprise', false],
  ] as const)('a known %s plan: banner shown = %s', async (tier, shown) => {
    const src = await mount()
    expect(screen.queryByText(BANNER)).toBeNull()
    await src.orgsOk(0, [org(tier)])
    await screen.findByText(CONTENT)
    if (shown) {
      expect(screen.getByText(BANNER)).toBeTruthy()
      expect(screen.getByText('Upgrade to unlock detailed resource efficiency scoring and quadrant drill-down.')).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Upgrade to Pro' }).getAttribute('href')).toBe('/settings/billing/upgrade')
    } else {
      expect(screen.queryByText(BANNER)).toBeNull()
    }
    expect(screen.queryByText(/and export/)).toBeNull()
  })

  it('the banner changes no request: a free plan makes the same free reads and no anomalies read', async () => {
    const src = await mount()
    await src.orgsOk(0, [org('free')])
    await screen.findByText(BANNER)
    expect(freeReads()).toBeGreaterThan(0)
    expect(getAnomalies).not.toHaveBeenCalled()
  })
})
