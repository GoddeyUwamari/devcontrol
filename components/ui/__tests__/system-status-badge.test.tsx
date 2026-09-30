/**
 * The status badge reflects DevControl's live /health check -- not a
 * hardcoded "All Systems Operational · 99.9% uptime".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SystemStatusBadge } from '../system-status-badge'

const mockGetSystemHealth = vi.fn()
vi.mock('@/lib/services/monitoring.service', () => ({
  monitoringService: { getSystemHealth: () => mockGetSystemHealth() },
}))

function renderBadge() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SystemStatusBadge /></QueryClientProvider>)
}

beforeEach(() => vi.clearAllMocks())

describe('SystemStatusBadge', () => {
  it('shows DevControl as operational only when the health check says so', async () => {
    mockGetSystemHealth.mockResolvedValue({ status: 'operational', services: [], lastUpdate: '' })
    renderBadge()

    expect(await screen.findByText('DevControl operational')).toBeInTheDocument()
    expect(screen.getByTestId('system-status-badge').textContent).not.toMatch(/All Systems|%/)
  })

  it('shows DevControl as not responding when the health check fails', async () => {
    mockGetSystemHealth.mockResolvedValue({ status: 'disrupted', services: [], lastUpdate: '' })
    renderBadge()

    expect(await screen.findByText('DevControl not responding')).toBeInTheDocument()
    expect(screen.queryByText(/operational/i)).not.toBeInTheDocument()
  })
})
