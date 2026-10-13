/**
 * Deployments page: statuses as recorded, and a summary from the windowed
 * counts.
 *
 * The CI deploy webhook records 'success' / 'failed'. The page recognised only
 * 'running', so every successful deployment read "Stopped" and the success
 * rate read 0%; its totals were counted from the 50-row list.
 *
 * The real page, service and shared axios client, with only the client's
 * transport stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import DeploymentsPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: false }),
}))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro' }) }))

const HOUR = 3_600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

function deployment(id: string, status: string, createdMsAgo: number) {
  return {
    id, service_id: `svc-${id}`, service_name: `service-${id}`, environment: 'production', aws_region: 'us-east-1',
    status, cost_estimate: '0.00', deployed_by: 'ci-bot', deployed_at: iso(createdMsAgo),
    created_at: iso(createdMsAgo), updated_at: iso(createdMsAgo),
  }
}

// Five listed rows; the organization has far more in the window.
const LIST = [
  deployment('ok', 'success', 2 * HOUR),
  deployment('bad', 'failed', 5 * HOUR),
  deployment('new', 'deploying', 0.25 * HOUR),
  deployment('old', 'deploying', 30 * HOUR),
  deployment('legacy', 'running', 48 * HOUR),
]

const STATS_BY_WINDOW: Record<string, unknown> = {
  '30d': {
    window_days: 30, total: 205, success: 196, failed: 4, in_progress: 1, no_completion_recorded: 3, unknown: 1,
    change_failure_rate: 2, total_cost: 0, last_deployment: { status: 'success', deployed_at: iso(2 * HOUR) },
  },
  '7d': {
    window_days: 7, total: 0, success: 0, failed: 0, in_progress: 0, no_completion_recorded: 0, unknown: 0,
    change_failure_rate: null, total_cost: 0, last_deployment: { status: 'failed', deployed_at: iso(9 * 24 * HOUR) },
  },
}

const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter
let listRows: unknown[] = LIST
let statsOverride: unknown = null

const adapter: AxiosAdapter = async (config) => {
  requests.push(config)
  const url = config.url ?? ''
  let data: unknown = { success: true }
  if (url.startsWith('/api/deployments/stats')) {
    const window = new URLSearchParams(url.split('?')[1] ?? '').get('date_range') ?? '30d'
    data = { success: true, stats: statsOverride ?? STATS_BY_WINDOW[window] }
  } else if (url.startsWith('/api/deployments')) {
    data = { success: true, data: listRows, total: listRows.length }
  }
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DeploymentsPage />
    </QueryClientProvider>
  )
}

const card = (name: string) => screen.getByTestId(`deployment-card-${name}`)

describe('Deployments page', () => {
  beforeEach(() => {
    requests.length = 0
    listRows = LIST
    statsOverride = null
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it('shows each deployment with the status that was recorded -- never "Stopped"', async () => {
    renderPage()
    await screen.findAllByText('service-ok')

    // Each row renders twice (mobile card and desktop row).
    expect(screen.getAllByText('Succeeded').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('In progress')).toHaveLength(2)
    expect(screen.getAllByText('No completion recorded')).toHaveLength(2)
    expect(screen.getAllByText('Unknown')).toHaveLength(2)
    expect(screen.queryByText('Stopped')).not.toBeInTheDocument()
    expect(screen.queryByText('Running')).not.toBeInTheDocument()
  })

  it('takes its totals, rate and last deployment from the windowed stats, not from the listed rows', async () => {
    renderPage()

    await waitFor(() => expect(within(card('succeeded')).getByText('196')).toBeInTheDocument())
    expect(within(card('failed')).getByText('4')).toBeInTheDocument()
    expect(within(card('change-failure-rate')).getByText('2%')).toBeInTheDocument()
    expect(within(card('change-failure-rate')).getByText('4 of 200 finished deployments failed')).toBeInTheDocument()
    expect(within(card('last-deployment')).getByText('Succeeded')).toBeInTheDocument()
    expect(screen.getByTestId('deployment-unfinished-note')).toHaveTextContent(
      'Not counted as succeeded or failed: 1 in progress · 3 with no completion recorded · 1 with an unrecognised status.'
    )

    const statsRequests = requests.filter(r => r.url?.startsWith('/api/deployments/stats'))
    expect(statsRequests.map(r => r.url)).toEqual(['/api/deployments/stats?date_range=30d'])
  })

  it('builds the summary from the real counts, without an "AI" label or the old wording', async () => {
    renderPage()

    const summary = screen.getByTestId('deployment-summary')
    await waitFor(() => expect(summary).toHaveTextContent(
      '196 of 200 finished deployments in the last 30 days succeeded and 4 failed (change failure rate 2%).'
    ))
    expect(summary).not.toHaveTextContent(/AI/)
    expect(document.body).not.toHaveTextContent(/AI Insight/i)
    expect(document.body).not.toHaveTextContent(/running successfully|success rate/i)
  })

  it('requests the selected window; with nothing finished in it the rate is a dash, not 0%', async () => {
    renderPage()
    await waitFor(() => expect(within(card('succeeded')).getByText('196')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '7d' }))

    await waitFor(() => expect(requests.some(r => r.url === '/api/deployments/stats?date_range=7d')).toBe(true))
    await waitFor(() => expect(within(card('change-failure-rate')).getByText('—')).toBeInTheDocument())
    expect(within(card('change-failure-rate')).getByText('No finished deployments in this window')).toBeInTheDocument()
    expect(within(card('change-failure-rate')).queryByText('0%')).not.toBeInTheDocument()
    expect(screen.getByTestId('deployment-summary')).toHaveTextContent('No deployments were recorded in the last 7 days.')
    // The last finished deployment is still reported, with its recorded status.
    expect(within(card('last-deployment')).getByText('Failed')).toBeInTheDocument()
  })
  it('with nothing ever recorded: says so and asks to connect CI -- no cards of zeros', async () => {
    listRows = []
    statsOverride = {
      window_days: 30, total: 0, success: 0, failed: 0, in_progress: 0, no_completion_recorded: 0, unknown: 0,
      change_failure_rate: null, total_cost: 0, last_deployment: null,
    }
    renderPage()

    const empty = await screen.findByTestId('deployments-empty-state')
    expect(empty).toHaveTextContent('No deployments recorded')
    expect(empty).toHaveTextContent('Connect your CI')
    expect(screen.queryByTestId('deployment-card-succeeded')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deployment-card-failed')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deployment-card-change-failure-rate')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deployment-summary')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/0%/)
  })

  it('an empty window is not "nothing recorded" when an earlier deployment exists', async () => {
    listRows = []
    statsOverride = STATS_BY_WINDOW['7d']
    renderPage()

    await waitFor(() => expect(within(card('last-deployment')).getByText('Failed')).toBeInTheDocument())
    expect(screen.queryByTestId('deployments-empty-state')).not.toBeInTheDocument()
  })

  it('does not show the empty state while the stats are still loading or have failed', async () => {
    listRows = []
    statsOverride = undefined
    api.defaults.adapter = async (config) => {
      requests.push(config)
      if (config.url?.startsWith('/api/deployments/stats')) {
        return { data: { success: false }, status: 200, statusText: 'OK', headers: {}, config }
      }
      return { data: { success: true, data: [], total: 0 }, status: 200, statusText: 'OK', headers: {}, config }
    }
    renderPage()

    await waitFor(() => expect(screen.getByTestId('deployment-summary')).toHaveTextContent('The deployment summary could not be loaded.'))
    expect(screen.queryByTestId('deployments-empty-state')).not.toBeInTheDocument()
    expect(within(card('succeeded')).getByText('—')).toBeInTheDocument()
  })
})
