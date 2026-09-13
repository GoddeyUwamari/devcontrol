/**
 * Enterprise Workstream 3B, Phase F frontend coverage for Optimization
 * Controls. Confirms: the Enterprise gate is real (never bypassed, never
 * calls the configuration endpoint for a non-Enterprise org), default and
 * organization-override values render with distinct, correct provenance,
 * valid EC2/Lambda saves reach the PUT endpoint with the authenticated
 * org's scoping left entirely to the backend, an out-of-range value is
 * rejected client-side before ever calling the API, reset invokes DELETE
 * and reverts the UI to Default, and a load failure surfaces an honest
 * error state rather than fabricated configuration data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import OptimizationControlsPage from '../page'

const mockUsePlan = vi.fn()
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => mockUsePlan() }))

const mockGetConfig = vi.fn()
const mockUpdateConfig = vi.fn()
const mockResetConfig = vi.fn()
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getOptimizationRuleConfiguration: (...args: any[]) => mockGetConfig(...args),
    updateOptimizationRuleConfiguration: (...args: any[]) => mockUpdateConfig(...args),
    resetOptimizationRuleConfiguration: (...args: any[]) => mockResetConfig(...args),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function ec2Default() {
  return {
    ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent',
    value: 5, source: 'default' as const,
    default: 5, min: 1, max: 20, unit: 'percent', type: 'number' as const,
  }
}

function lambdaDefault() {
  return {
    ruleId: 'lambda_low_usage', parameterId: 'max_invocations',
    value: 10, source: 'default' as const,
    default: 10, min: 0, max: 1000, unit: 'invocations_per_30d', type: 'integer' as const,
  }
}

describe('Optimization Controls page — Enterprise gate is real, not a client-side bypass', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the upgrade paywall for a non-Enterprise org and never calls the configuration endpoint', async () => {
    mockUsePlan.mockReturnValue({ isEnterprise: false })

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Enterprise Feature')).toBeInTheDocument()
    expect(screen.queryByText('Idle EC2 instances')).not.toBeInTheDocument()
    expect(mockGetConfig).not.toHaveBeenCalled()
  })
})

describe('Optimization Controls page — real API-backed states for an Enterprise org', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePlan.mockReturnValue({ isEnterprise: true })
  })

  it('renders default values and source for both configurable rules', async () => {
    mockGetConfig.mockResolvedValue([ec2Default(), lambdaDefault()])

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Idle EC2 instances')).toBeInTheDocument()
    expect(screen.getByText('Low-usage Lambda functions')).toBeInTheDocument()
    expect(screen.getAllByText('Default')).toHaveLength(2)
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10')).toBeInTheDocument()
  })

  it('renders an organization override distinctly from a default value', async () => {
    mockGetConfig.mockResolvedValue([{ ...ec2Default(), value: 12, source: 'organization_override' }, lambdaDefault()])

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Organization override')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByDisplayValue('12')).toBeInTheDocument()
  })

  it('saves a valid EC2 CPU threshold and reflects the new organization-override source', async () => {
    mockGetConfig.mockResolvedValue([ec2Default(), lambdaDefault()])
    mockUpdateConfig.mockResolvedValue({ ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 12, source: 'organization_override' })

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/CPU utilization threshold/i)
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.click(screen.getAllByText('Save')[0])

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith('ec2_idle', 'cpu_threshold_percent', 12))
    expect(await screen.findByText('Organization override')).toBeInTheDocument()
  })

  it('saves a valid Lambda invocation threshold', async () => {
    mockGetConfig.mockResolvedValue([ec2Default(), lambdaDefault()])
    mockUpdateConfig.mockResolvedValue({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 50, source: 'organization_override' })

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/Maximum invocations/i)
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.click(screen.getAllByText('Save')[1])

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith('lambda_low_usage', 'max_invocations', 50))
  })

  it('rejects an out-of-range value client-side and never calls the API', async () => {
    mockGetConfig.mockResolvedValue([ec2Default(), lambdaDefault()])

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/CPU utilization threshold/i)
    fireEvent.change(input, { target: { value: '999' } })

    expect(await screen.findByText('Must be between 1 and 20')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Save')[0])
    expect(mockUpdateConfig).not.toHaveBeenCalled()
  })

  it('rejects a non-integer Lambda value client-side', async () => {
    mockGetConfig.mockResolvedValue([ec2Default(), lambdaDefault()])

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/Maximum invocations/i)
    fireEvent.change(input, { target: { value: '10.5' } })

    expect(await screen.findByText('Must be a whole number')).toBeInTheDocument()
    expect(mockUpdateConfig).not.toHaveBeenCalled()
  })

  it('resets an organization override back to default via DELETE, idempotently reflected in the UI', async () => {
    mockGetConfig.mockResolvedValue([{ ...ec2Default(), value: 12, source: 'organization_override' }, lambdaDefault()])
    mockResetConfig.mockResolvedValue(undefined)

    render(<OptimizationControlsPage />)
    await screen.findByText('Organization override')
    fireEvent.click(screen.getAllByText(/Reset to default/)[0])

    await waitFor(() => expect(mockResetConfig).toHaveBeenCalledWith('ec2_idle', 'cpu_threshold_percent'))
    await waitFor(() => expect(screen.getAllByText('Default')).toHaveLength(2))
    expect(screen.getByDisplayValue('5')).toBeInTheDocument()
  })

  it('surfaces a load error without fabricating configuration data', async () => {
    mockGetConfig.mockRejectedValue(new Error('network error'))

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Failed to load optimization controls. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText('Idle EC2 instances')).not.toBeInTheDocument()
  })

  it('surfaces a server-side save rejection (e.g. non-Enterprise/validation failure) without applying it locally', async () => {
    mockGetConfig.mockResolvedValue([ec2Default(), lambdaDefault()])
    mockUpdateConfig.mockRejectedValue({ response: { data: { error: 'cpu_threshold_percent must be between 1 and 20' } } })

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/CPU utilization threshold/i)
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.click(screen.getAllByText('Save')[0])

    expect(await screen.findByText('cpu_threshold_percent must be between 1 and 20')).toBeInTheDocument()
    expect(screen.getAllByText('Default')).toHaveLength(2)
  })
})
