/**
 * SLO 3A frontend coverage. Confirms the fabricated-demo-data path is genuinely gone
 * (the page has zero import of useDemoMode/useSalesDemo — see the source assertion
 * below — so flipping the devcontrol_demo_mode localStorage flag has no effect at
 * all), and that the page correctly renders real-API states: Enterprise gate,
 * loading, error, empty, and a real evaluated SLO (healthy + breached), without ever
 * collapsing those into one generic status.
 */
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import SLODashboardPage from '../page'

const mockUsePlan = vi.fn()
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => mockUsePlan() }))

const mockEvaluateAll = vi.fn()
const mockListSlos = vi.fn()
vi.mock('@/lib/services/slo.service', () => ({
  default: {
    evaluateAll: (...args: any[]) => mockEvaluateAll(...args),
    listSlos: (...args: any[]) => mockListSlos(...args),
    createSlo: vi.fn(),
    updateSlo: vi.fn(),
    deleteSlo: vi.fn(),
    getOptions: vi.fn().mockResolvedValue({ slis: ['ec2_availability'], windows: ['24h', '7d'] }),
  },
  SLI_RESOURCE_TYPE: { ec2_availability: 'ec2', alb_latency_avg: 'load-balancer', alb_error_rate: 'load-balancer', lambda_error_rate: 'lambda' },
  SLI_LABEL: { ec2_availability: 'EC2 Availability', alb_latency_avg: 'ALB Average Latency', alb_error_rate: 'ALB Error Rate', lambda_error_rate: 'Lambda Error Rate' },
}))

vi.mock('@/lib/services/aws-resources.service', () => ({
  awsResourcesService: { getAll: vi.fn().mockResolvedValue({ resources: [] }) },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function healthySlo() {
  return {
    definition: {
      id: 's1', organizationId: 'org1', name: 'Checkout API availability',
      resourceType: 'ec2', resourceId: 'i-123', sli: 'ec2_availability',
      targetValue: 99.9, evaluationWindow: '7d', enabled: true,
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    },
    evaluation: {
      status: 'healthy', observedValue: 99.98, targetValue: 99.9, unit: 'percent',
      errorBudget: { applicable: true, allowedFailureRate: 0.001, observedFailureRate: 0.0002, consumedFraction: 0.2, remainingFraction: 0.8 },
    },
  }
}

function breachedSlo() {
  return {
    definition: {
      id: 's2', organizationId: 'org1', name: 'Payments latency', resourceType: 'load-balancer',
      resourceId: 'alb-1', sli: 'alb_latency_avg', targetValue: 500, evaluationWindow: '24h', enabled: true,
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
    },
    evaluation: { status: 'breached', observedValue: 812, targetValue: 500, unit: 'ms', errorBudget: { applicable: false, allowedFailureRate: null, observedFailureRate: null, consumedFraction: null, remainingFraction: null } },
  }
}

describe('SLO Dashboard page — source no longer depends on demo/localStorage data', () => {
  it('imports neither useDemoMode nor useSalesDemo nor any DEMO_SLOS fixture', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')
    expect(source).not.toMatch(/useDemoMode/)
    expect(source).not.toMatch(/useSalesDemo/)
    expect(source).not.toMatch(/DEMO_SLOS/)
    expect(source).not.toMatch(/devcontrol_demo_mode/)
  })
})

describe('SLO Dashboard page — Enterprise gate is real, not a client-side demo bypass', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.clearAllMocks() })

  it('shows the upgrade paywall for a non-Enterprise org, even with the demo flag set', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    mockUsePlan.mockReturnValue({ isEnterprise: false })

    render(<SLODashboardPage />)

    expect(await screen.findByText('Enterprise Feature')).toBeInTheDocument()
    expect(screen.queryByText('SLOs Defined')).not.toBeInTheDocument()
    expect(mockEvaluateAll).not.toHaveBeenCalled()
  })
})

describe('SLO Dashboard page — real API-backed states for an Enterprise org', () => {
  beforeEach(() => {
    localStorage.clear()
    mockUsePlan.mockReturnValue({ isEnterprise: true })
  })
  afterEach(() => { vi.clearAllMocks() })

  it('renders an honest empty state when no SLOs are configured — never fabricated data', async () => {
    mockEvaluateAll.mockResolvedValue([])

    render(<SLODashboardPage />)

    expect(await screen.findByText('No SLOs configured')).toBeInTheDocument()
    expect(screen.getByText('Create an SLO to begin monitoring service reliability.')).toBeInTheDocument()
  })

  it('renders a load error distinctly, without silently showing an empty or fabricated state', async () => {
    mockEvaluateAll.mockRejectedValue(new Error('network error'))

    render(<SLODashboardPage />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load SLOs. Please try again.')).toBeInTheDocument()
    })
    expect(screen.queryByText('No SLOs configured')).not.toBeInTheDocument()
  })

  it('renders a healthy SLO with its real observed value and error budget', async () => {
    mockEvaluateAll.mockResolvedValue([healthySlo()])

    render(<SLODashboardPage />)

    expect(await screen.findByText('Checkout API availability')).toBeInTheDocument()
    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0)
    expect(screen.getByText('99.98%')).toBeInTheDocument()
    expect(screen.getByText('20.0% used')).toBeInTheDocument()
  })

  it('renders a breached latency SLO with no error-budget claim (latency has none)', async () => {
    mockEvaluateAll.mockResolvedValue([breachedSlo()])

    render(<SLODashboardPage />)

    expect(await screen.findByText('Payments latency')).toBeInTheDocument()
    expect(screen.getAllByText('Breached').length).toBeGreaterThan(0)
    expect(screen.getByText('812ms avg')).toBeInTheDocument()
    expect(screen.getByText('No error budget for latency SLIs.')).toBeInTheDocument()
  })

  it('renders healthy and breached SLOs distinctly in the same list, never collapsed to one status', async () => {
    mockEvaluateAll.mockResolvedValue([healthySlo(), breachedSlo()])

    render(<SLODashboardPage />)

    await waitFor(() => {
      expect(screen.getByText('Checkout API availability')).toBeInTheDocument()
      expect(screen.getByText('Payments latency')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Healthy').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Breached').length).toBeGreaterThan(0)
  })
})
