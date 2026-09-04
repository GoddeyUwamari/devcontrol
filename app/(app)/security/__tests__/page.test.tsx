/**
 * Coverage for the Security Overview compliance-framework fallback fix:
 * a real account with zero added frameworks must render an honest
 * "not yet evaluated" state, never FALLBACK_FRAMEWORKS's demo-shaped
 * percentages (87% Passing / "1 framework failing") — see the production
 * audit that found this inconsistent with /compliance/frameworks' own
 * "Risk Visibility: Not Established" state for the same account.
 *
 * All other page dependencies (risk score, anomalies, account findings,
 * services) are mocked to safe empty/loading-free defaults so the test can
 * isolate the compliance-framework rendering path without asserting on
 * unrelated sections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SecurityPage from '../page'

let demoModeValue = false
vi.mock('@/lib/services/demo-mode.service', () => ({
  demoModeService: { isEnabled: () => demoModeValue },
}))

const mockUseComplianceFrameworks = vi.fn()
vi.mock('@/lib/hooks/useComplianceFrameworks', () => ({
  useComplianceFrameworks: () => mockUseComplianceFrameworks(),
}))

vi.mock('@/lib/hooks/useRiskScore', () => ({
  useCurrentRiskScore: () => ({ data: undefined, isLoading: false }),
  useRiskScoreTrend: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('@/lib/hooks/useAccountSecurityFindings', () => ({
  useAccountSecurityFindings: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/lib/services/anomaly.service', () => ({
  anomalyService: {
    getAnomalies: vi.fn().mockResolvedValue({ anomalies: [] }),
    getStats: vi.fn().mockResolvedValue({ active: 0 }),
    acknowledge: vi.fn(),
    triggerScan: vi.fn().mockResolvedValue({}),
  },
}))

vi.mock('@/lib/services/aws-services.service', () => ({
  default: { discoverServices: vi.fn() },
}))

vi.mock('@/lib/services/account-security-findings.service', () => ({
  accountSecurityFindingsService: {
    acknowledge: vi.fn(),
    dismiss: vi.fn(),
    acceptRisk: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function renderSecurityPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SecurityPage />
    </QueryClientProvider>
  )
}

describe('Security Overview — compliance framework fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    demoModeValue = false
  })

  it('A. real framework data (frameworks.length > 0) renders the real framework names, not the fallback set', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [{ id: 'fw-1', name: 'My Custom Framework', enabled: true }],
      loading: false,
    })

    renderSecurityPage()

    expect(screen.getByText('My Custom Framework')).toBeInTheDocument()
    expect(screen.queryByText('CIS AWS Benchmark')).not.toBeInTheDocument()
    expect(screen.queryByText('Not yet evaluated')).not.toBeInTheDocument()
  })

  it('B. empty framework data for a real account renders an honest unevaluated state, no fallback percentages', () => {
    mockUseComplianceFrameworks.mockReturnValue({ frameworks: [], loading: false })

    renderSecurityPage()

    expect(screen.getByText('Risk Visibility: Not Established')).toBeInTheDocument()
    expect(screen.getByText('Run a baseline scan to see your compliance posture.')).toBeInTheDocument()
    expect(screen.queryByText('87%')).not.toBeInTheDocument()
    expect(screen.queryByText('74%')).not.toBeInTheDocument()
    expect(screen.queryByText('91%')).not.toBeInTheDocument()
    expect(screen.queryByText('68%')).not.toBeInTheDocument()
    expect(screen.queryByText('CIS AWS Benchmark')).not.toBeInTheDocument()
    expect(screen.queryByText('SOC 2 Type II')).not.toBeInTheDocument()
  })

  it('C. empty framework data never claims a failing-framework count or "all passing" — only "Not yet evaluated"', () => {
    mockUseComplianceFrameworks.mockReturnValue({ frameworks: [], loading: false })

    renderSecurityPage()

    expect(screen.queryByText(/framework.*failing/i)).not.toBeInTheDocument()
    expect(screen.queryByText('All frameworks passing')).not.toBeInTheDocument()
    // "Compliance Status" KPI card shows the honest placeholder instead
    expect(screen.getAllByText('Not yet evaluated').length).toBeGreaterThan(0)
  })

  it('D. explicit demo mode preserves the existing FALLBACK_FRAMEWORKS demo behavior', () => {
    demoModeValue = true
    // In demo mode the page never calls the real hook's data — but it's still
    // invoked, so give it an empty, harmless return.
    mockUseComplianceFrameworks.mockReturnValue({ frameworks: [], loading: false })

    renderSecurityPage()

    expect(screen.getByText('CIS AWS Benchmark')).toBeInTheDocument()
    expect(screen.getByText('87%')).toBeInTheDocument()
    expect(screen.getAllByText(/1 framework failing/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Risk Visibility: Not Established')).not.toBeInTheDocument()
  })
})

describe('Dashboard compliance placeholder — unaffected by this fix (regression guard)', () => {
  it('E. Dashboard still renders the unconditional "—" placeholder for Compliance Frameworks, unchanged by this fix', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const dashboardSource = fs.readFileSync(
      path.join(__dirname, '../../dashboard/page.tsx'),
      'utf8'
    )
    expect(dashboardSource).toContain(
      "{ label: 'Compliance Frameworks',    value: isDemoActive ? '4/4' : '—',                    status: 'good' }"
    )
  })
})
