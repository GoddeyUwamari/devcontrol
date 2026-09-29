/**
 * Active Alerts must not turn an empty or failed alert feed into a health
 * verdict. For real organizations the alert feed is currently always empty
 * (the only alert writer stores no organization), so "no alerts" is shown as
 * exactly that, with the reason, and a failed request as unavailable.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AlertsPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockGetAlertStats = vi.fn()
const mockGetAlertHistory = vi.fn()
vi.mock('@/lib/services/alert-history.service', () => ({
  alertHistoryService: {
    getAlertStats: () => mockGetAlertStats(),
    getAlertHistory: () => mockGetAlertHistory(),
    acknowledgeAlert: vi.fn(),
    resolveAlert: vi.fn(),
  },
}))

const HEALTH_CLAIMS = /healthy|all clear|actively monitoring|clean|real[- ]?time|no critical issues/i

function stats(total: number, active: number, criticalCount: number) {
  return { success: true, data: { total, active, criticalCount, avgResolutionTime: 0 } }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AlertsPage /></QueryClientProvider>)
}

/** Page text with the explanatory note removed, so "not ... healthy" in it doesn't count as a claim. */
function claimsText(): string {
  return (document.body.textContent ?? '').replaceAll(
    "DevControl's alert sync does not yet associate alerts with an organization, so an empty list here does not mean your services are healthy.",
    ''
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAlertStats.mockResolvedValue(stats(0, 0, 0))
  mockGetAlertHistory.mockResolvedValue({ success: true, data: [] })
})

describe('Active Alerts -- no alerts', () => {
  it('says no alerts are recorded and why, with no health or monitoring claim', async () => {
    renderPage()

    expect((await screen.findAllByText('No alerts recorded')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/does not yet associate alerts with an organization/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('None recorded').length).toBe(3)
    expect(claimsText()).not.toMatch(HEALTH_CLAIMS)
  })
})

describe('Active Alerts -- failed requests', () => {
  it('failed stats and history are unavailable, not zero and not healthy', async () => {
    mockGetAlertStats.mockRejectedValue(new Error('500'))
    mockGetAlertHistory.mockRejectedValue(new Error('500'))
    renderPage()

    expect(await screen.findByText('Alert data could not be retrieved.')).toBeInTheDocument()
    expect((await screen.findAllByText('Alerts could not be retrieved')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Could not be retrieved').length).toBe(3)
    expect(screen.queryByText('None recorded')).not.toBeInTheDocument()
    expect(claimsText()).not.toMatch(HEALTH_CLAIMS)
  })
})

describe('Active Alerts -- real alerts are still shown', () => {
  it('active and critical counts render with their call to action', async () => {
    mockGetAlertStats.mockResolvedValue(stats(4, 3, 1))
    mockGetAlertHistory.mockResolvedValue({
      success: true,
      data: [{ id: 'a1', alertName: 'High CPU', description: 'CPU above threshold', severity: 'critical', status: 'firing', serviceName: 'api', startedAt: '2026-09-27T08:00:00.000Z' }],
    })
    renderPage()

    expect(await screen.findByText('Requires immediate attention')).toBeInTheDocument()
    expect(screen.getByText('Immediate action required')).toBeInTheDocument()
    expect(screen.getAllByText('High CPU').length).toBeGreaterThan(0)
    expect(screen.getByText(/1 critical and 2 warning alerts active/)).toBeInTheDocument()
  })
})
