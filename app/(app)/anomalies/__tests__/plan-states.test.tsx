/**
 * /anomalies waits for a known plan: no Pro gate while the organization
 * loads or fails, and anomalies and the last scan load only for a known
 * Pro-or-above plan (custom rules only for Enterprise).
 */
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import {
  describePlanStates, fakeOrgSources, flush, org, renderWithAuth, seedSession,
} from '@/lib/contexts/__tests__/org-load-harness'

const getAnomalies = vi.hoisted(() => vi.fn(async () => ({ anomalies: [], stats: { active: 0, critical: 0, warning: 0, info: 0 } })))
const getLastScan = vi.hoisted(() => vi.fn(async () => null))
const getRules = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/lib/services/anomaly.service', () => ({
  anomalyService: { getAnomalies, getLastScan, triggerScan: vi.fn(), acknowledge: vi.fn(), resolve: vi.fn(), markFalsePositive: vi.fn() },
}))
vi.mock('@/lib/services/custom-anomaly-rules.service', () => ({
  default: { getRules, createRule: vi.fn(), toggleRule: vi.fn(), deleteRule: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import AnomaliesPage from '../page'

const reset = () => { getAnomalies.mockClear(); getLastScan.mockClear(); getRules.mockClear() }

describePlanStates('/anomalies', {
  render: () => <AnomaliesPage />,
  entitledTier: 'pro',
  notEntitledTier: 'starter',
  reset,
  paidCalls: () => getAnomalies.mock.calls.length + getLastScan.mock.calls.length + getRules.mock.calls.length,
  content: /Anomaly detection on measured data isn/,
  gate: 'Pro Plan Required',
})

describe('/anomalies: custom rules are Enterprise-only', () => {
  it('a known Pro plan loads anomalies but never requests custom rules', async () => {
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    seedSession()
    reset()
    const src = fakeOrgSources()
    renderWithAuth(<AnomaliesPage />)
    await flush()
    await src.orgsOk(0, [org('pro')])
    await screen.findAllByText(/Anomaly detection on measured data isn/)
    expect(getAnomalies).toHaveBeenCalled()
    expect(getRules).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})
