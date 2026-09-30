/**
 * /status reports DevControl's own service health from its live /health
 * check -- never fabricated uptime, incidents, or regions, and never as the
 * status of the customer's AWS resources.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import StatusPage from '../page'

const mockGetSystemHealth = vi.fn()
vi.mock('@/lib/services/monitoring.service', () => ({
  monitoringService: { getSystemHealth: () => mockGetSystemHealth() },
}))

function health(ok: boolean, error?: string) {
  return {
    status: ok ? 'operational' : 'disrupted',
    servicesUp: ok ? 1 : 0,
    totalServices: 1,
    healthPercentage: ok ? 100 : 0,
    services: [{ name: 'Backend API', url: 'http://api/health', status: ok ? 'healthy' : 'unhealthy', responseTime: 42, uptime: 0, lastCheck: '2026-09-28T10:00:00.000Z', error }],
    lastUpdate: '2026-09-28T10:00:00.000Z',
  }
}

const FABRICATED = /\d{2}\.\d+%|uptime (stable|history:)|incidents? (resolved|in the last)|region|latency|within SLA|Elite tier/i

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><StatusPage /></QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('/status -- DevControl service status', () => {
  it('says what it is: DevControl, not your AWS resources', async () => {
    mockGetSystemHealth.mockResolvedValue(health(true))
    renderPage()

    expect(await screen.findByText('DevControl is operational')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/DevControl/)
    expect(document.body.textContent).toMatch(/does not report on your AWS resources/)
  })

  it('shows only what the health check measured, with no fabricated uptime, incidents, or regions', async () => {
    mockGetSystemHealth.mockResolvedValue(health(true))
    renderPage()

    await screen.findByText('DevControl is operational')
    expect(screen.getByText('42 ms')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(FABRICATED)
    expect(document.body.textContent).not.toMatch(/real[- ]?time/i)
  })

  it('a failed health check is reported as not responding, never healthy', async () => {
    mockGetSystemHealth.mockResolvedValue(health(false, 'Database disconnected'))
    renderPage()

    expect(await screen.findByText('DevControl is not responding normally')).toBeInTheDocument()
    expect(screen.getByText(/Database disconnected/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/is operational|healthy/i)
  })

  it('while checking, makes no claim either way', () => {
    mockGetSystemHealth.mockReturnValue(new Promise(() => {}))
    renderPage()

    expect(screen.getByText('Checking DevControl…')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/is operational|not responding/i)
  })
})
