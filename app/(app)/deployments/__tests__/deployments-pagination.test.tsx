/**
 * Deployments page: the paged log, the cost column and the two empty states.
 *
 *   - The log is paged by the server. The page sends the environment filter,
 *     the window, the page size and the offset, and shows "1–25 of N" from the
 *     total the server counted with those same filters.
 *   - Nothing records a deployment cost, so "$0.00" is never shown: the Cost
 *     column is hidden unless a row in view has a recorded cost, and a row
 *     without one shows a dash.
 *   - "No deployments recorded · Connect your CI" is only for an organization
 *     with no deployment at all. A filter or window that selects nothing says
 *     exactly that.
 *
 * The real page, service and shared axios client, with only the client's
 * transport stubbed by a small in-memory server that filters and pages the
 * way the API does.
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

const DAY = 24 * 3_600_000
const WINDOW_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 }

interface Row {
  id: string; service_id: string; service_name: string; environment: string; aws_region: string
  status: string; cost_estimate: string | null; deployed_by: string; deployed_at: string
  created_at: string; updated_at: string
}

function row(n: number, over: Partial<Row> & { daysAgo?: number } = {}): Row {
  const at = new Date(Date.now() - (over.daysAgo ?? 1) * DAY - n * 60_000).toISOString()
  return {
    id: `d-${n}`, service_id: `svc-${n}`, service_name: `service-${String(n).padStart(3, '0')}`,
    environment: 'production', aws_region: 'us-east-1', status: 'success', cost_estimate: null,
    deployed_by: 'ci-bot', deployed_at: at, created_at: at, updated_at: at, ...over,
  }
}

let rows: Row[] = []
let listFails = false
const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter

function select(params: URLSearchParams): Row[] {
  const environment = params.get('environment')
  const days = WINDOW_DAYS[params.get('date_range') ?? '']
  return rows.filter(r =>
    (!environment || r.environment === environment) &&
    (!days || Date.parse(r.deployed_at) >= Date.now() - days * DAY)
  )
}

const adapter: AxiosAdapter = async (config) => {
  requests.push(config)
  const [path, query = ''] = (config.url ?? '').split('?')
  const params = new URLSearchParams(query)
  let data: unknown = { success: true }
  if (path === '/api/deployments/stats') {
    const selected = select(new URLSearchParams({ ...Object.fromEntries(params), date_range: params.get('date_range') ?? '30d' }))
    const success = selected.filter(r => r.status === 'success').length
    const failed = selected.filter(r => r.status === 'failed').length
    data = {
      success: true,
      stats: {
        window_days: WINDOW_DAYS[params.get('date_range') ?? '30d'], total: selected.length, success, failed,
        in_progress: 0, no_completion_recorded: 0, unknown: selected.length - success - failed,
        change_failure_rate: success + failed > 0 ? Math.round((failed / (success + failed)) * 1000) / 10 : null,
        organization_has_deployments: rows.length > 0,
        last_deployment: null,
      },
    }
  } else if (path === '/api/deployments') {
    if (listFails) throw new Error('Network Error')
    const selected = select(params)
    const limit = Number(params.get('limit'))
    const offset = Number(params.get('offset'))
    data = {
      success: true,
      data: selected.slice(offset, offset + limit),
      total: selected.length,
      pagination: { limit, offset, total: selected.length },
    }
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

const listRequests = () => requests.filter(r => r.url?.startsWith('/api/deployments?')).map(r => r.url)
const range = () => screen.getByTestId('deployment-range')
const shownRows = () => screen.getAllByTestId('deployment-row')
const columns = () => Array.from(screen.getByTestId('deployment-log-columns').children).map(c => c.textContent)
const card = (name: string) => screen.getByTestId(`deployment-card-${name}`)

describe('Deployments page — paged log', () => {
  beforeEach(() => {
    requests.length = 0
    listFails = false
    rows = Array.from({ length: 60 }, (_, i) => row(i + 1))
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it('asks the server for the first 25 of the 30-day window and shows "1–25 of N"', async () => {
    renderPage()

    await waitFor(() => expect(range()).toHaveTextContent('1–25 of 60'))
    expect(shownRows()).toHaveLength(25)
    expect(listRequests()).toEqual(['/api/deployments?date_range=30d&limit=25&offset=0'])
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Page 3' })).toBeInTheDocument()
  })

  it('the count in the log matches the summary cards for the same filters', async () => {
    rows = [
      ...Array.from({ length: 28 }, (_, i) => row(i + 1)),
      ...Array.from({ length: 4 }, (_, i) => row(100 + i, { status: 'failed' })),
      ...Array.from({ length: 9 }, (_, i) => row(200 + i, { daysAgo: 60 })), // outside 30 days
    ]
    renderPage()

    await waitFor(() => expect(range()).toHaveTextContent('1–25 of 32'))
    expect(within(card('succeeded')).getByText('28')).toBeInTheDocument()
    expect(within(card('failed-deploys')).getByText('4')).toBeInTheDocument()
    expect(screen.getByTestId('deployment-log-count')).toHaveTextContent('Last 30 days · 32 deployments')
  })

  it('Next, a page number and Previous each request that page; the last page shows the remainder', async () => {
    renderPage()
    await waitFor(() => expect(range()).toHaveTextContent('1–25 of 60'))

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(range()).toHaveTextContent('26–50 of 60'))

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    await waitFor(() => expect(range()).toHaveTextContent('51–60 of 60'))
    expect(shownRows()).toHaveLength(10)
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Previous/ }))
    await waitFor(() => expect(range()).toHaveTextContent('26–50 of 60'))

    expect(listRequests()).toEqual([
      '/api/deployments?date_range=30d&limit=25&offset=0',
      '/api/deployments?date_range=30d&limit=25&offset=25',
      '/api/deployments?date_range=30d&limit=25&offset=50',
      '/api/deployments?date_range=30d&limit=25&offset=25',
    ])
  })

  it('changing the page size starts again at page 1 with that size', async () => {
    renderPage()
    await waitFor(() => expect(range()).toHaveTextContent('1–25 of 60'))
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(range()).toHaveTextContent('26–50 of 60'))

    const size = screen.getByRole('combobox', { name: /Rows per page/ })
    expect(within(size).getAllByRole('option').map(o => o.textContent)).toEqual(['25', '50', '100'])
    fireEvent.change(size, { target: { value: '50' } })

    await waitFor(() => expect(range()).toHaveTextContent('1–50 of 60'))
    expect(shownRows()).toHaveLength(50)
    expect(listRequests().at(-1)).toBe('/api/deployments?date_range=30d&limit=50&offset=0')

    fireEvent.change(size, { target: { value: '100' } })
    await waitFor(() => expect(range()).toHaveTextContent('1–60 of 60'))
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
  })

  it('the environment filter and the window are sent to the server, and reset the page', async () => {
    rows = [
      ...Array.from({ length: 40 }, (_, i) => row(i + 1)),
      ...Array.from({ length: 30 }, (_, i) => row(100 + i, { environment: 'staging', daysAgo: 3 })),
      ...Array.from({ length: 5 }, (_, i) => row(200 + i, { environment: 'staging', daysAgo: 20 })),
    ]
    renderPage()
    await waitFor(() => expect(range()).toHaveTextContent('1–25 of 75'))
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(range()).toHaveTextContent('26–50 of 75'))

    fireEvent.click(screen.getByRole('button', { name: 'staging' }))
    await waitFor(() => expect(range()).toHaveTextContent('1–25 of 35'))
    expect(listRequests().at(-1)).toBe('/api/deployments?environment=staging&date_range=30d&limit=25&offset=0')
    expect(screen.getByTestId('deployment-log-count')).toHaveTextContent('Last 30 days · 35 deployments in staging')

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(range()).toHaveTextContent('26–35 of 35'))

    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    await waitFor(() => expect(range()).toHaveTextContent('1–25 of 30'))
    expect(listRequests().at(-1)).toBe('/api/deployments?environment=staging&date_range=7d&limit=25&offset=0')
    expect(requests.some(r => r.url === '/api/deployments/stats?environment=staging&date_range=7d')).toBe(true)
  })

  it('a single page shows its range and no way forward', async () => {
    rows = [row(1), row(2), row(3)]
    renderPage()

    await waitFor(() => expect(range()).toHaveTextContent('1–3 of 3'))
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Page 2' })).not.toBeInTheDocument()
  })

  it('when the list cannot be loaded it says so -- no empty state, no pager, no count', async () => {
    listFails = true
    renderPage()

    expect(await screen.findByTestId('deployment-log-error')).toHaveTextContent('Deployments could not be loaded.')
    expect(screen.queryByTestId('deployment-log-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('deployment-pagination')).not.toBeInTheDocument()
    expect(screen.getByTestId('deployment-log-count')).toHaveTextContent('count unavailable')
  })
})

describe('Deployments page — cost column', () => {
  beforeEach(() => {
    requests.length = 0
    listFails = false
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it('is hidden when no row in view has a recorded cost -- NULL and the legacy 0.00 alike -- and "$0.00" never appears', async () => {
    rows = [row(1, { cost_estimate: null }), row(2, { cost_estimate: '0.00' }), row(3, { cost_estimate: '0' })]
    renderPage()

    await waitFor(() => expect(shownRows()).toHaveLength(3))
    expect(columns()).toEqual(['Service', 'Environment', 'Region', 'Deployed By', 'Status'])
    expect(document.body).not.toHaveTextContent('$0.00')
    expect(document.body).not.toHaveTextContent(/\$\d/)
  })

  it('is shown when a row in view has a recorded cost; rows without one show a dash, not "$0.00"', async () => {
    rows = [row(1, { cost_estimate: '12.50' }), row(2, { cost_estimate: '0.00' }), row(3, { cost_estimate: null })]
    renderPage()

    await waitFor(() => expect(shownRows()).toHaveLength(3))
    expect(columns()).toEqual(['Service', 'Environment', 'Region', 'Deployed By', 'Status', 'Cost'])
    const [recorded, zero, missing] = shownRows()
    expect(recorded).toHaveTextContent('$12.50')
    for (const unrecorded of [zero, missing]) {
      expect(within(unrecorded).getByTitle('Not recorded')).toHaveTextContent(/^—$/)
      expect(unrecorded).not.toHaveTextContent('$')
    }
    expect(document.body).not.toHaveTextContent('$0.00')
  })

  it('is decided by the rows in view: a recorded cost on another page does not show the column here', async () => {
    rows = [
      ...Array.from({ length: 25 }, (_, i) => row(i + 1)),
      row(100, { cost_estimate: '40.00' }),
    ]
    renderPage()

    await waitFor(() => expect(range()).toHaveTextContent('1–25 of 26'))
    expect(columns()).not.toContain('Cost')

    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    await waitFor(() => expect(range()).toHaveTextContent('26–26 of 26'))
    expect(columns()).toContain('Cost')
    expect(shownRows()[0]).toHaveTextContent('$40.00')
  })
})

describe('Deployments page — empty states', () => {
  beforeEach(() => {
    requests.length = 0
    listFails = false
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it('an organization with no deployment at all: "No deployments recorded" and "Connect your CI"', async () => {
    rows = []
    renderPage()

    const top = await screen.findByTestId('deployments-empty-state')
    expect(top).toHaveTextContent('No deployments recorded')
    expect(top).toHaveTextContent('Connect your CI')
    const log = screen.getByTestId('deployment-log-empty')
    expect(log).toHaveAttribute('data-reason', 'none-recorded')
    expect(log).toHaveTextContent('Connect your CI to record deployments.')
    expect(screen.queryByTestId('deployment-pagination')).not.toBeInTheDocument()
  })

  it('an environment with nothing in the window, in an organization that has deployments: names the environment and the window, and never says "Connect your CI"', async () => {
    rows = Array.from({ length: 4 }, (_, i) => row(i + 1)) // production only
    renderPage()
    await waitFor(() => expect(shownRows()).toHaveLength(4))

    fireEvent.click(screen.getByRole('button', { name: 'staging' }))

    await waitFor(() => expect(screen.getByTestId('deployment-log-empty')).toHaveAttribute('data-reason', 'no-match'))
    expect(screen.getByTestId('deployment-log-empty')).toHaveTextContent('No deployments in staging in the last 30 days')
    expect(screen.queryByTestId('deployments-empty-state')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Connect your CI/)
    expect(document.body).not.toHaveTextContent('No deployments recorded')
    // The summary cards stay, with the filter's real (zero) counts.
    expect(within(card('succeeded')).getByText('0')).toBeInTheDocument()
    expect(within(card('change-failure-rate')).getByText('—')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '90d' }))
    await waitFor(() => expect(screen.getByTestId('deployment-log-empty')).toHaveTextContent('No deployments in staging in the last 90 days'))
  })

  it('a window with nothing in it, across all environments: names the window only', async () => {
    rows = [row(1, { daysAgo: 20 })]
    renderPage()
    await waitFor(() => expect(shownRows()).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: '7d' }))

    await waitFor(() => expect(screen.getByTestId('deployment-log-empty')).toHaveTextContent('No deployments in the last 7 days'))
    expect(screen.getByTestId('deployment-log-empty')).toHaveAttribute('data-reason', 'no-match')
    expect(document.body).not.toHaveTextContent(/Connect your CI/)
  })
})

describe('Deployments page — Failed deploys card', () => {
  beforeEach(() => {
    requests.length = 0
    listFails = false
    rows = [row(1), row(2, { status: 'failed' })]
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it('is labelled "Failed deploys" and says what is not counted', async () => {
    renderPage()

    await waitFor(() => expect(within(card('failed-deploys')).getByText('1')).toBeInTheDocument())
    expect(within(card('failed-deploys')).getByText('Failed deploys')).toBeInTheDocument()
    expect(card('failed-deploys')).toHaveTextContent("Last 30 days · pipeline runs stopped by tests before deploying aren't counted")

    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    await waitFor(() => expect(card('failed-deploys')).toHaveTextContent("Last 7 days · pipeline runs stopped by tests before deploying aren't counted"))
  })
})
