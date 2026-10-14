/**
 * Dashboard Engineering Health card.
 *
 * Real mode shows the organization's own deployment figures, read through the
 * endpoints the Deployments and DORA pages use: deploys per day, change
 * failure rate and the last finished deployment. Lead time and time to
 * restore are "not tracked". A value that has not loaded or could not be
 * loaded is a dash -- never a zero -- and "No deployments recorded · Connect
 * your CI" appears only when the API says the organization has none.
 *
 * The real card, services and shared axios client, with only the client's
 * transport stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import { EngineeringHealthCard } from '../engineering-health-card'

const auth = vi.hoisted(() => ({ organization: { id: 'org-a' } as { id: string } | null }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: auth.organization }) }))

const HOUR = 3_600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

function doraBody(successful: number, failed: number, perDay: number, rate: number | null) {
  return {
    success: true,
    data: {
      deploymentFrequency: { tracked: true, value: perDay, unit: 'per day', benchmark: null, isCustomBenchmark: false },
      leadTime: { tracked: false, reason: 'no commit timestamps' },
      changeFailureRate: { tracked: true, value: rate, unit: 'percentage', benchmark: null, isCustomBenchmark: false },
      mttr: { tracked: false, reason: 'no incident records' },
      deployments: { successful, failed, finished: successful + failed },
      period: { start: iso(30 * 24 * HOUR), end: iso(0), days: 30 },
    },
  }
}

function statsBody(over: Record<string, unknown> = {}) {
  return {
    success: true,
    stats: {
      window_days: 30, total: 50, success: 45, failed: 5, in_progress: 0, no_completion_recorded: 0, unknown: 0,
      change_failure_rate: 10, organization_has_deployments: true,
      last_deployment: { status: 'success', deployed_at: iso(3 * HOUR) },
      ...over,
    },
  }
}

type Reply = unknown | (() => Promise<unknown>)
let dora: Reply
let stats: Reply
const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter

const adapter: AxiosAdapter = async (config) => {
  requests.push(config)
  const url = config.url ?? ''
  const reply = url.startsWith('/api/metrics/dora') ? dora : url.startsWith('/api/deployments/stats') ? stats : { success: true }
  const data = typeof reply === 'function' ? await (reply as () => Promise<unknown>)() : reply
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

const never = () => new Promise<unknown>(() => {})
const fail = () => Promise.reject(new Error('Network Error'))

function renderCard(props: { isDemoActive?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EngineeringHealthCard
        isDemoActive={props.isDemoActive ?? false}
        doraRows={[{ label: 'Deployment Frequency', value: '4.2/day', delta: { direction: 'up', label: '12%', good: true } }]}
      />
    </QueryClientProvider>
  )
}

const cell = (name: string) => screen.getByTestId(`engineering-health-${name}`)
const cardText = () => screen.getByTestId('engineering-health-card').textContent ?? ''

describe('Engineering Health card', () => {
  beforeEach(() => {
    requests.length = 0
    auth.organization = { id: 'org-a' }
    dora = doraBody(45, 5, 1.5, 10)
    stats = statsBody()
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it('shows deploys per day, change failure rate and the last deploy from the two existing APIs', async () => {
    renderCard()

    await waitFor(() => expect(screen.getByTestId('engineering-health-metrics')).toHaveAttribute('data-state', 'loaded'))
    expect(within(cell('deploys-per-day')).getByText('1.5')).toBeInTheDocument()
    expect(cell('deploys-per-day')).toHaveTextContent('45 successful · last 30 days')
    expect(within(cell('change-failure-rate')).getByText('10%')).toBeInTheDocument()
    expect(cell('change-failure-rate')).toHaveTextContent('5 of 50 finished failed')
    expect(cell('last-deploy')).toHaveTextContent('about 3 hours ago')
    expect(cell('last-deploy')).toHaveTextContent('Succeeded')

    expect(requests.map(r => r.url).sort()).toEqual([
      '/api/deployments/stats?date_range=30d',
      '/api/metrics/dora?date_range=30d',
    ])
  })

  it('says lead time and time to restore are not tracked, and never shows a value for them', async () => {
    renderCard()

    await waitFor(() => expect(screen.getByTestId('engineering-health-metrics')).toHaveAttribute('data-state', 'loaded'))
    expect(screen.getByTestId('engineering-health-note')).toHaveTextContent(/^Lead time and time to restore: not tracked$/)
    expect(cardText()).not.toMatch(/MTTR|Mean Time|hours$|\d+ min/i)
  })

  it('carries no "AI" label', async () => {
    renderCard()
    await waitFor(() => expect(screen.getByTestId('engineering-health-metrics')).toHaveAttribute('data-state', 'loaded'))
    expect(cardText()).not.toMatch(/\bAI\b|AI-powered|insight/i)
  })

  it('with no deployment in the organization at all: "No deployments recorded · Connect your CI", and no numbers', async () => {
    dora = doraBody(0, 0, 0, null)
    stats = statsBody({ total: 0, success: 0, failed: 0, change_failure_rate: null, organization_has_deployments: false, last_deployment: null })
    renderCard()

    const empty = await screen.findByTestId('engineering-health-empty')
    expect(empty).toHaveTextContent(/^No deployments recorded · Connect your CI$/)
    expect(screen.queryByTestId('engineering-health-metrics')).not.toBeInTheDocument()
    expect(cardText()).not.toMatch(/\d/)
  })

  it('a quiet window is not "no deployments": zero successes is shown as measured, the rate as a dash', async () => {
    dora = doraBody(0, 0, 0, null)
    stats = statsBody({
      total: 0, success: 0, failed: 0, change_failure_rate: null, organization_has_deployments: true,
      last_deployment: { status: 'failed', deployed_at: iso(45 * 24 * HOUR) },
    })
    renderCard()

    await waitFor(() => expect(screen.getByTestId('engineering-health-metrics')).toHaveAttribute('data-state', 'loaded'))
    expect(screen.queryByTestId('engineering-health-empty')).not.toBeInTheDocument()
    expect(within(cell('deploys-per-day')).getByText('0')).toBeInTheDocument()
    expect(within(cell('change-failure-rate')).getByText('—')).toBeInTheDocument()
    expect(cell('change-failure-rate')).toHaveTextContent('No finished deployments in this window')
    expect(cell('change-failure-rate')).not.toHaveTextContent('0%')
    expect(cell('last-deploy')).toHaveTextContent('Failed')
  })

  it('while loading: dashes, never zeros, and no empty-state claim', () => {
    dora = never
    stats = never
    renderCard()

    expect(screen.getByTestId('engineering-health-metrics')).toHaveAttribute('data-state', 'loading')
    for (const name of ['deploys-per-day', 'change-failure-rate', 'last-deploy']) {
      expect(within(cell(name)).getByText('—')).toBeInTheDocument()
    }
    expect(cardText()).not.toMatch(/\b0\b|0%/)
    expect(cardText()).not.toMatch(/No deployments recorded|Connect your CI/)
  })

  it('before the organization is known: dashes, and nothing is requested', () => {
    auth.organization = null
    renderCard()

    for (const name of ['deploys-per-day', 'change-failure-rate', 'last-deploy']) {
      expect(within(cell(name)).getByText('—')).toBeInTheDocument()
    }
    expect(requests).toHaveLength(0)
    expect(cardText()).not.toMatch(/No deployments recorded/)
  })

  it('when both requests fail: dashes and a plain error line -- not zeros, not "Connect your CI"', async () => {
    dora = fail
    stats = fail
    renderCard()

    await waitFor(() => expect(screen.getByTestId('engineering-health-metrics')).toHaveAttribute('data-state', 'error'))
    for (const name of ['deploys-per-day', 'change-failure-rate', 'last-deploy']) {
      expect(within(cell(name)).getByText('—')).toBeInTheDocument()
    }
    expect(screen.getByTestId('engineering-health-note')).toHaveTextContent('Deployment metrics could not be loaded.')
    expect(cardText()).not.toMatch(/\b0\b|0%|No deployments recorded|Connect your CI/)
  })

  it('when only one request fails: what loaded is shown, the rest stays a dash', async () => {
    dora = fail
    renderCard()

    await waitFor(() => expect(screen.getByTestId('engineering-health-metrics')).toHaveAttribute('data-state', 'error'))
    expect(within(cell('deploys-per-day')).getByText('—')).toBeInTheDocument()
    expect(within(cell('change-failure-rate')).getByText('—')).toBeInTheDocument()
    expect(cell('last-deploy')).toHaveTextContent('about 3 hours ago')
  })

  it('links to the DORA page with the text arrow, and keeps its own compact height', async () => {
    const { container } = renderCard()

    expect(screen.getByText('View details →').closest('a')).toHaveAttribute('href', '/app/dora-metrics')
    expect(container.querySelectorAll('svg.lucide-arrow-right')).toHaveLength(0)
    const card = screen.getByTestId('engineering-health-card')
    expect(card.className).toContain('self-start')
    expect(card.className).not.toContain('h-full')
  })

  it('demo mode keeps the demonstration metrics, fills the row and requests nothing', () => {
    renderCard({ isDemoActive: true })

    expect(screen.getByTestId('engineering-health-card').className).toContain('h-full')
    expect(screen.getByText('4.2/day')).toBeInTheDocument()
    expect(screen.queryByTestId('engineering-health-metrics')).not.toBeInTheDocument()
    expect(requests).toHaveLength(0)
  })
})
