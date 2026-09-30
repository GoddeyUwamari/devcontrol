/**
 * Alert History wiring of GET /api/observability/readiness: connected:false is
 * "not connected", a failed request is an error (never "not connected" and
 * never 0/100), the demo fixture is the evidence-section shape, and the old
 * template "AI Insight" / "Top Priority" copy is gone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AlertHistoryPage from '../page'

let demo = false
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/services/alert-history.service', () => ({
  alertHistoryService: {
    getAlertHistory: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getAlertStats: vi.fn().mockResolvedValue({ success: true, data: { total: 0, criticalCount: 0, avgResolutionTime: 0 } }),
  },
}))

function mockReadiness(response: { ok: boolean; body?: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: response.ok, status: response.ok ? 200 : 500, json: async () => response.body })))
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AlertHistoryPage /></QueryClientProvider>)
}

const REMOVED_COPY = /AI Insight|team will not be notified|Restore metric reporting for 2 services|Top Priority|Critical Coverage/i

beforeEach(() => {
  demo = false
  localStorage.setItem('accessToken', 'fake-token')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Alert History -- readiness states', () => {
  it('connected:false renders the not-connected prompt', async () => {
    mockReadiness({ ok: true, body: { success: true, data: null, connected: false } })
    renderPage()
    expect(await screen.findByTestId('readiness-not-connected')).toBeInTheDocument()
    expect(screen.queryByTestId('readiness-request-error')).not.toBeInTheDocument()
  })

  it('a failed request renders an error -- not "not connected", not 0/100', async () => {
    mockReadiness({ ok: false })
    renderPage()
    expect(await screen.findByTestId('readiness-request-error')).toBeInTheDocument()
    expect(screen.queryByTestId('readiness-not-connected')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\/100/)
  })

  it('an evidence error (connected, score null) renders "—" and the reason, never "at risk (0/100)"', async () => {
    const failed = { state: 'error', source: 's', asOf: null, coverage: null, reason: 'the connected AWS role could not be assumed', data: null }
    const ns = { ...failed, state: 'not_supported', reason: 'not supported' }
    mockReadiness({
      ok: true,
      body: {
        success: true, connected: true,
        data: {
          connected: true, state: 'error', reason: 'the connected AWS role could not be assumed', readiness_score: null, status: null,
          discovery_run: null, scope: null,
          components: {
            alert_coverage: { ec2: failed, rds: failed, alb: ns, lambda: ns },
            monitoring_coverage: ns, signal_freshness: ns, response_config: ns,
          },
          alarms: failed, top_gaps: [],
        },
      },
    })
    renderPage()
    expect(await screen.findByTestId('readiness-panel')).toBeInTheDocument()
    expect(screen.getByTestId('readiness-reason')).toHaveTextContent('the connected AWS role could not be assumed')
    expect(document.body.textContent).not.toMatch(/\/100|at risk \(0/i)
    expect(document.body.textContent).not.toMatch(REMOVED_COPY)
  })

  it('demo mode renders the evidence-shaped fixture as partial, with none of the removed copy', async () => {
    demo = true
    mockReadiness({ ok: false })
    renderPage()
    expect(await screen.findByTestId('readiness-panel')).toBeInTheDocument()
    expect(screen.getByTestId('readiness-state')).toHaveTextContent('Partial')
    expect(screen.getByTestId('readiness-score')).toHaveTextContent('86%')
    expect(screen.getByTestId('not-supported')).toHaveTextContent('Response setup — Not supported')
    expect(document.body.textContent).not.toMatch(REMOVED_COPY)
  })
})
