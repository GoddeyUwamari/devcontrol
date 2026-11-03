/**
 * Flag-off page: a failed metrics request shows the error card, never a blank page or
 * rows held from an earlier answer. The body below is what the route really sends.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import MonitoringPage from '../page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/services/alert-history.service', () => ({
  alertHistoryService: { getAlertHistory: vi.fn().mockResolvedValue({ data: [] }) },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ERROR_TITLE = "Can't fetch CloudWatch metrics right now"
const FAILED_BODY = { success: false, error: 'Failed to fetch CloudWatch metrics' }

function metricsFor(range: string) {
  const name = `i-${range}`
  return {
    accountId: 'acct-1', nickname: null, region: 'us-east-1',
    uptime: 99.9, avgResponseTimeMs: 120, requestsPerMinute: 10, errorRate: 0, monthlyCost: 100, trendPercent: 0,
    responseTimeHistory: [],
    coverage: { ec2: true, loadBalancer: false, rds: false, lambda: false, dynamodb: false, ecs: false, eks: false, ebs: false, cloudfront: false, aurora: false },
    healthSummary: { total: 1, healthy: 1, degraded: 0, critical: 0, down: 0, monitored: 1 },
    systemStatus: 'healthy',
    pagination: { shown: 1, total: 1, hasMore: false, cursor: null },
    services: [{ resourceId: name, name, description: `EC2 · ${name}`, resourceType: 'ec2', status: 'healthy', uptime: 99.9, responseTimeMs: null, errorRate: null, critical: true, monitored: true }],
    capturedAt: new Date().toISOString(),
  }
}

let metricsStatus: 200 | 500 | 503
let metricsRequests: string[]

function installFetchMock() {
  global.fetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/api/cloudwatch/status')) {
      return { ok: true, json: async () => ({ success: true, data: { connected: true } }) }
    }
    if (url.includes('/api/cloudwatch/metrics')) {
      metricsRequests.push(url)
      const status = metricsStatus
      const range = new URL(url, 'http://localhost').searchParams.get('range') ?? ''
      await new Promise((resolve) => setTimeout(resolve, 5))
      return status === 200
        ? { ok: true, status, json: async () => ({ success: true, data: metricsFor(range) }) }
        : { ok: false, status, json: async () => FAILED_BODY }
    }
    return { ok: false, json: async () => ({}) }
  }) as unknown as typeof fetch
}

/** The page re-requests once the connection is known; wait for that to finish. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)) })
}

async function renderGoodLoad() {
  render(<MonitoringPage />)
  expect(await screen.findByText('i-1h')).toBeInTheDocument()
  await settle()
}

/** The 60 s timer, without waiting for it: its live callback is the last one registered. */
async function runPoll() {
  const calls = vi.mocked(setInterval).mock.calls.filter(([, ms]) => ms === 60000)
  const before = metricsRequests.length
  await act(async () => { (calls[calls.length - 1][0] as () => void)() })
  await waitFor(() => expect(metricsRequests.length).toBeGreaterThan(before))
  await settle()
}

function expectErrorState() {
  expect(screen.getByText(ERROR_TITLE)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(screen.queryByText(/^i-/)).not.toBeInTheDocument()
  expect(screen.queryByText('Resource Checks')).not.toBeInTheDocument()
  expect(screen.queryByText('CloudWatch connected')).not.toBeInTheDocument()
  expect(document.body.textContent).not.toContain('Last checked')
}

function expectNormalDisplay(row: string) {
  expect(screen.getByText(row)).toBeInTheDocument()
  expect(screen.getByText('CloudWatch connected')).toBeInTheDocument()
  expect(document.body.textContent).toContain('Last checked')
  expect(screen.queryByText(ERROR_TITLE)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
}

describe('Legacy monitoring page: failed metrics requests', () => {
  beforeEach(() => {
    metricsStatus = 200
    metricsRequests = []
    installFetchMock()
    vi.spyOn(globalThis, 'setInterval')
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('500 on first load: error card and Retry', async () => {
    metricsStatus = 500
    render(<MonitoringPage />)

    expect(await screen.findByText(ERROR_TITLE)).toBeInTheDocument()
    await settle()
    expectErrorState()
  })

  it.each([500, 503] as const)('%d on Refresh after a good load: error card, nothing held', async (status) => {
    await renderGoodLoad()
    expectNormalDisplay('i-1h')

    metricsStatus = status
    fireEvent.click(screen.getByRole('button', { name: 'Refresh metrics' }))

    expect(await screen.findByText(ERROR_TITLE)).toBeInTheDocument()
    await settle()
    expectErrorState()
  })

  it('500 on the poll after a good load: error card, nothing held', async () => {
    await renderGoodLoad()

    metricsStatus = 500
    await runPoll()

    expectErrorState()
  })

  it('held coverage does not outlive a failed request', async () => {
    await renderGoodLoad()
    expect(document.body.textContent).toContain('Discovered: EC2 ·')

    metricsStatus = 500
    await runPoll()

    expect(document.body.textContent).toContain('Discovered: EC2, Application Load Balancer ·')
  })

  it("500 on a range change: error card, never the old range's rows", async () => {
    await renderGoodLoad()

    metricsStatus = 500
    fireEvent.click(screen.getByRole('button', { name: 'Last 24h' }))

    expect(await screen.findByText(ERROR_TITLE)).toBeInTheDocument()
    await settle()
    expect(metricsRequests[metricsRequests.length - 1]).toContain('range=24h')
    expectErrorState()
  })

  it('the next good poll restores normal display', async () => {
    await renderGoodLoad()
    metricsStatus = 500
    await runPoll()
    expectErrorState()

    metricsStatus = 200
    await runPoll()

    expectNormalDisplay('i-1h')
  })

  it('a good poll after a failed range change shows the new range', async () => {
    await renderGoodLoad()
    metricsStatus = 500
    fireEvent.click(screen.getByRole('button', { name: 'Last 24h' }))
    expect(await screen.findByText(ERROR_TITLE)).toBeInTheDocument()
    await settle()

    metricsStatus = 200
    await runPoll()

    expectNormalDisplay('i-24h')
  })

  it('Retry after a failure restores normal display and forces a fresh read', async () => {
    await renderGoodLoad()
    metricsStatus = 500
    await runPoll()

    metricsStatus = 200
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('i-1h')).toBeInTheDocument()
    await settle()
    expect(metricsRequests[metricsRequests.length - 1]).toContain('refresh=true')
    expectNormalDisplay('i-1h')
  })
})
