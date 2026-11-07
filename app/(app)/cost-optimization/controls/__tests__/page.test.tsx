/**
 * Enterprise Workstream 3B, Phase F frontend coverage for Optimization
 * Controls. Confirms: the Enterprise gate is real (never bypassed, never
 * calls the configuration endpoint for a non-Enterprise org), default and
 * organization-override values render with distinct, correct provenance,
 * the low-activity EC2 thresholds are shown fixed and read-only (FP PR 2b),
 * valid Lambda saves reach the PUT endpoint with the authenticated
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
    mockUsePlan.mockReturnValue({ status: 'known', isKnown: true, isEnterprise: false })

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Enterprise Feature')).toBeInTheDocument()
    expect(screen.queryByText('Idle EC2 instances')).not.toBeInTheDocument()
    expect(mockGetConfig).not.toHaveBeenCalled()
  })
})

describe('Optimization Controls page — real API-backed states for an Enterprise org', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePlan.mockReturnValue({ status: 'known', isKnown: true, isEnterprise: true })
  })

  const FIXED_LINE = 'Low-activity instances: peak CPU under 10% and network under 5 MB a day, every day for 30 days, and not behind a load balancer or in an Auto Scaling group. These thresholds are fixed.'

  // FP PR 2b (Q10 option A): the low-activity EC2 rule's thresholds are fixed. Its
  // adjustable control is gone; a read-only line stands in its place.
  it('shows the fixed low-activity thresholds as a read-only line in place of the EC2 control, and the Lambda control', async () => {
    mockGetConfig.mockResolvedValue([lambdaDefault()])

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Low-usage Lambda functions')).toBeInTheDocument()
    expect(screen.getByTestId('low-activity-fixed-thresholds')).toHaveTextContent(FIXED_LINE)
    expect(screen.getByTestId('low-activity-fixed-thresholds').tagName).toBe('P')
    expect(screen.queryByLabelText(/CPU utilization threshold/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Idle EC2 instances')).not.toBeInTheDocument()
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    expect(screen.getAllByText('Default')).toHaveLength(1)
    expect(screen.getByDisplayValue('10')).toBeInTheDocument()
  })

  it('the subtitle names one configurable threshold, keeping the original sentence otherwise', async () => {
    mockGetConfig.mockResolvedValue([lambdaDefault()])

    render(<OptimizationControlsPage />)

    await screen.findByText('Low-usage Lambda functions')
    const subtitle = screen.getByText(/Tune how DevControl identifies/)
    expect(subtitle.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Tune how DevControl identifies selected cost optimization opportunities for your organization. Only the threshold below is configurable — every other check uses its built-in default.'
    )
  })

  it('an older backend that still lists ec2_idle never gets an adjustable EC2 input', async () => {
    mockGetConfig.mockResolvedValue([ec2Default(), lambdaDefault()])

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Low-usage Lambda functions')).toBeInTheDocument()
    expect(screen.getByTestId('low-activity-fixed-thresholds')).toHaveTextContent(FIXED_LINE)
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1)
    expect(screen.queryByDisplayValue('5')).not.toBeInTheDocument()
    expect(screen.queryByText('ec2_idle')).not.toBeInTheDocument()
  })

  it('with no configurable rule, the fixed line still shows beside the empty state', async () => {
    mockGetConfig.mockResolvedValue([])

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('No configurable optimization rules are available right now.')).toBeInTheDocument()
    expect(screen.getByTestId('low-activity-fixed-thresholds')).toHaveTextContent(FIXED_LINE)
  })

  it('renders an organization override distinctly from a default value', async () => {
    mockGetConfig.mockResolvedValue([{ ...lambdaDefault(), value: 120, source: 'organization_override' }])

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Organization override')).toBeInTheDocument()
    expect(screen.queryByText('Default')).not.toBeInTheDocument()
    expect(screen.getByDisplayValue('120')).toBeInTheDocument()
  })

  it('saves a valid Lambda invocation threshold', async () => {
    mockGetConfig.mockResolvedValue([lambdaDefault()])
    mockUpdateConfig.mockResolvedValue({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 50, source: 'organization_override' })

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/Maximum invocations/i)
    fireEvent.change(input, { target: { value: '50' } })
    fireEvent.click(screen.getAllByText('Save')[0])

    await waitFor(() => expect(mockUpdateConfig).toHaveBeenCalledWith('lambda_low_usage', 'max_invocations', 50))
    expect(await screen.findByText('Organization override')).toBeInTheDocument()
  })

  it('rejects an out-of-range value client-side and never calls the API', async () => {
    mockGetConfig.mockResolvedValue([lambdaDefault()])

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/Maximum invocations/i)
    fireEvent.change(input, { target: { value: '1001' } })

    expect(await screen.findByText('Must be between 0 and 1000')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('Save')[0])
    expect(mockUpdateConfig).not.toHaveBeenCalled()
  })

  it('rejects a non-integer Lambda value client-side', async () => {
    mockGetConfig.mockResolvedValue([lambdaDefault()])

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/Maximum invocations/i)
    fireEvent.change(input, { target: { value: '10.5' } })

    expect(await screen.findByText('Must be a whole number')).toBeInTheDocument()
    expect(mockUpdateConfig).not.toHaveBeenCalled()
  })

  it('resets an organization override back to default via DELETE, idempotently reflected in the UI', async () => {
    mockGetConfig.mockResolvedValue([{ ...lambdaDefault(), value: 120, source: 'organization_override' }])
    mockResetConfig.mockResolvedValue(undefined)

    render(<OptimizationControlsPage />)
    await screen.findByText('Organization override')
    fireEvent.click(screen.getAllByText(/Reset to default/)[0])

    await waitFor(() => expect(mockResetConfig).toHaveBeenCalledWith('lambda_low_usage', 'max_invocations'))
    await waitFor(() => expect(screen.getAllByText('Default')).toHaveLength(1))
    expect(screen.getByDisplayValue('10')).toBeInTheDocument()
  })

  it('surfaces a load error without fabricating configuration data', async () => {
    mockGetConfig.mockRejectedValue(new Error('network error'))

    render(<OptimizationControlsPage />)

    expect(await screen.findByText('Failed to load optimization controls. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText('Low-usage Lambda functions')).not.toBeInTheDocument()
  })

  it('surfaces a server-side save rejection (e.g. non-Enterprise/validation failure) without applying it locally', async () => {
    mockGetConfig.mockResolvedValue([lambdaDefault()])
    mockUpdateConfig.mockRejectedValue({ response: { data: { error: 'max_invocations must be between 0 and 1000' } } })

    render(<OptimizationControlsPage />)
    const input = await screen.findByLabelText(/Maximum invocations/i)
    fireEvent.change(input, { target: { value: '15' } })
    fireEvent.click(screen.getAllByText('Save')[0])

    expect(await screen.findByText('max_invocations must be between 0 and 1000')).toBeInTheDocument()
    expect(screen.getAllByText('Default')).toHaveLength(1)
  })
})
