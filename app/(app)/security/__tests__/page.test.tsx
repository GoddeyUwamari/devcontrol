/**
 * Coverage for the Security Overview compliance-framework truthfulness fix.
 *
 * Prior behavior (fabricated): `complianceScore = framework.enabled ? 80 : 55`,
 * `status = framework.enabled ? 'passing' : 'failing'` — invented from a
 * user-set toggle with no backend relationship to any scan outcome, and
 * never checked against `compliance_scans` at all.
 *
 * Current behavior: per-framework evaluation state is derived only from
 * `compliance_scans` rows for that `framework_id` (via `useComplianceScans`),
 * using the framework's single most-recently-created scan to decide between
 * no_evaluation / in_progress / failed / completed. Only 'completed' (with a
 * non-null `compliance_score`) ever renders a percentage; no state renders a
 * Passing/Failing judgment for real-mode custom frameworks.
 *
 * All other page dependencies (risk score, anomalies, account findings,
 * services) are mocked to safe empty/loading-free defaults so the tests can
 * isolate the compliance-framework rendering path without asserting on
 * unrelated sections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SecurityPage from '../page'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'

let demoModeValue = false
vi.mock('@/lib/services/demo-mode.service', () => ({
  demoModeService: { isEnabled: () => demoModeValue },
}))

const mockUseComplianceFrameworks = vi.fn()
const mockUseComplianceScans = vi.fn()
vi.mock('@/lib/hooks/useComplianceFrameworks', () => ({
  useComplianceFrameworks: () => mockUseComplianceFrameworks(),
  useComplianceScans: () => mockUseComplianceScans(),
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

function makeFramework(overrides: Partial<ComplianceFramework> = {}): ComplianceFramework {
  return {
    id: 'fw-1',
    organization_id: 'org-1',
    name: 'My Custom Framework',
    description: null,
    framework_type: 'custom',
    enabled: true,
    is_default: false,
    standard_name: null,
    version: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function makeScan(overrides: Partial<ComplianceScan> = {}): ComplianceScan {
  return {
    id: 'scan-1',
    organization_id: 'org-1',
    framework_id: 'fw-1',
    scan_type: 'manual',
    status: 'completed',
    total_resources: 10,
    compliant_resources: 9,
    non_compliant_resources: 1,
    compliance_score: 90,
    critical_issues: 0,
    high_issues: 1,
    medium_issues: 0,
    low_issues: 0,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_seconds: 10,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

describe('Security Overview — compliance framework truthfulness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    demoModeValue = false
    mockUseComplianceScans.mockReturnValue({ scans: [], loading: false })
  })

  it('A. no framework data renders the existing neutral empty state, never a fabricated score', () => {
    mockUseComplianceFrameworks.mockReturnValue({ frameworks: [], loading: false })

    renderSecurityPage()

    expect(screen.getByText('Risk Visibility: Not Established')).toBeInTheDocument()
    expect(screen.getByText('Run a baseline scan to see your compliance posture.')).toBeInTheDocument()
    expect(screen.queryByText('87%')).not.toBeInTheDocument()
    expect(screen.queryByText('80%')).not.toBeInTheDocument()
    expect(screen.queryByText('55%')).not.toBeInTheDocument()
    expect(screen.queryByText('CIS AWS Benchmark')).not.toBeInTheDocument()
  })

  it('A(2). empty framework data never claims a failing-framework count or "all passing" — only "Not yet evaluated"', () => {
    mockUseComplianceFrameworks.mockReturnValue({ frameworks: [], loading: false })

    renderSecurityPage()

    expect(screen.queryByText(/framework.*failing/i)).not.toBeInTheDocument()
    expect(screen.queryByText('All frameworks passing')).not.toBeInTheDocument()
    expect(screen.getAllByText('Not yet evaluated').length).toBeGreaterThan(0)
  })

  it('B. framework exists, no completed scan: shows the framework name with "Not yet evaluated", never a score or Passing/Failing', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [makeFramework({ id: 'fw-1', name: 'My Custom Framework', enabled: true })],
      loading: false,
    })
    mockUseComplianceScans.mockReturnValue({ scans: [], loading: false })

    renderSecurityPage()

    expect(screen.getByText('My Custom Framework')).toBeInTheDocument()
    expect(screen.getAllByText('Not yet evaluated').length).toBeGreaterThan(0)
    expect(screen.queryByText('80%')).not.toBeInTheDocument()
    expect(screen.queryByText('55%')).not.toBeInTheDocument()
    expect(screen.queryByText('Passing')).not.toBeInTheDocument()
    expect(screen.queryByText('Failing')).not.toBeInTheDocument()
  })

  it('C. framework with a completed scan renders the real compliance_score and issue counts, not a Passing/Failing label', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [makeFramework({ id: 'fw-1', name: 'My Custom Framework', enabled: true })],
      loading: false,
    })
    mockUseComplianceScans.mockReturnValue({
      scans: [makeScan({ framework_id: 'fw-1', status: 'completed', compliance_score: 91, critical_issues: 1, high_issues: 3 })],
      loading: false,
    })

    renderSecurityPage()

    expect(screen.getByText('91%')).toBeInTheDocument()
    expect(screen.getByText(/1 critical/)).toBeInTheDocument()
    expect(screen.getByText(/3 high/)).toBeInTheDocument()
    expect(screen.queryByText('80%')).not.toBeInTheDocument()
    expect(screen.queryByText('55%')).not.toBeInTheDocument()
    expect(screen.queryByText('Passing')).not.toBeInTheDocument()
    expect(screen.queryByText('Failing')).not.toBeInTheDocument()
  })

  it('D. framework with a pending/running scan shows "Evaluation in progress", never a fabricated result', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [makeFramework({ id: 'fw-1', name: 'My Custom Framework', enabled: true })],
      loading: false,
    })
    mockUseComplianceScans.mockReturnValue({
      scans: [makeScan({ framework_id: 'fw-1', status: 'running', compliance_score: null, completed_at: null })],
      loading: false,
    })

    renderSecurityPage()

    expect(screen.getByText('Evaluation in progress')).toBeInTheDocument()
    expect(screen.queryByText('80%')).not.toBeInTheDocument()
    expect(screen.queryByText('55%')).not.toBeInTheDocument()
  })

  it('E. framework with a failed scan shows "Evaluation failed", never treated as non-compliance', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [makeFramework({ id: 'fw-1', name: 'My Custom Framework', enabled: true })],
      loading: false,
    })
    mockUseComplianceScans.mockReturnValue({
      scans: [makeScan({ framework_id: 'fw-1', status: 'failed', compliance_score: null, completed_at: null })],
      loading: false,
    })

    renderSecurityPage()

    expect(screen.getByText('Evaluation failed')).toBeInTheDocument()
    expect(screen.queryByText('Failing')).not.toBeInTheDocument()
    expect(screen.queryByText('80%')).not.toBeInTheDocument()
    expect(screen.queryByText('55%')).not.toBeInTheDocument()
  })

  it('F. multiple completed scans: the newest completed scan is selected, not an older one and not array order', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [makeFramework({ id: 'fw-1', name: 'My Custom Framework', enabled: true })],
      loading: false,
    })
    mockUseComplianceScans.mockReturnValue({
      // Older scan listed FIRST in the array — proves selection isn't "first element".
      scans: [
        makeScan({ id: 'scan-old', framework_id: 'fw-1', status: 'completed', compliance_score: 50, critical_issues: 9, high_issues: 9, created_at: new Date(Date.now() - 100000).toISOString(), completed_at: new Date(Date.now() - 100000).toISOString() }),
        makeScan({ id: 'scan-new', framework_id: 'fw-1', status: 'completed', compliance_score: 91, critical_issues: 1, high_issues: 2, created_at: new Date().toISOString(), completed_at: new Date().toISOString() }),
      ],
      loading: false,
    })

    renderSecurityPage()

    expect(screen.getByText('91%')).toBeInTheDocument()
    expect(screen.queryByText('50%')).not.toBeInTheDocument()
  })

  it('F(2). a newer pending scan supersedes an older completed one — shows "Evaluation in progress", not the stale score', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [makeFramework({ id: 'fw-1', name: 'My Custom Framework', enabled: true })],
      loading: false,
    })
    mockUseComplianceScans.mockReturnValue({
      scans: [
        makeScan({ id: 'scan-old', framework_id: 'fw-1', status: 'completed', compliance_score: 84, created_at: new Date(Date.now() - 100000).toISOString(), completed_at: new Date(Date.now() - 100000).toISOString() }),
        makeScan({ id: 'scan-new', framework_id: 'fw-1', status: 'running', compliance_score: null, completed_at: null, created_at: new Date().toISOString() }),
      ],
      loading: false,
    })

    renderSecurityPage()

    expect(screen.getByText('Evaluation in progress')).toBeInTheDocument()
    expect(screen.queryByText('84%')).not.toBeInTheDocument()
  })

  it('G. explicit demo mode preserves the existing FALLBACK_FRAMEWORKS demo behavior, never production scan data', () => {
    demoModeValue = true
    // In demo mode the page never uses the real hooks' data for display — but
    // both are still invoked (see follow-up: useComplianceFrameworks/useComplianceScans
    // aren't gated by !demoMode on this page), so give them harmless empty returns.
    mockUseComplianceFrameworks.mockReturnValue({ frameworks: [], loading: false })
    mockUseComplianceScans.mockReturnValue({ scans: [], loading: false })

    renderSecurityPage()

    expect(screen.getByText('CIS AWS Benchmark')).toBeInTheDocument()
    expect(screen.getByText('87%')).toBeInTheDocument()
    expect(screen.getAllByText(/1 framework failing/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Risk Visibility: Not Established')).not.toBeInTheDocument()
  })

  it('regression guard: enabled=true with no completed scan still shows "Not yet evaluated", never the old fabricated 80%', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [makeFramework({ id: 'fw-1', name: 'Enabled No Scan', enabled: true })],
      loading: false,
    })
    mockUseComplianceScans.mockReturnValue({ scans: [], loading: false })

    renderSecurityPage()

    expect(within(screen.getByText('Compliance Status').closest('div')!).getByText('Not yet evaluated')).toBeInTheDocument()
    expect(screen.queryByText('80%')).not.toBeInTheDocument()
    expect(screen.queryByText('Passing')).not.toBeInTheDocument()
  })

  it('regression guard: enabled=false with a completed 91% scan shows 91%, never the old fabricated 55% — proves the score comes from the scan, not from enabled', () => {
    mockUseComplianceFrameworks.mockReturnValue({
      frameworks: [makeFramework({ id: 'fw-2', name: 'Disabled With Scan', enabled: false })],
      loading: false,
    })
    mockUseComplianceScans.mockReturnValue({
      scans: [makeScan({ framework_id: 'fw-2', status: 'completed', compliance_score: 91 })],
      loading: false,
    })

    renderSecurityPage()

    expect(screen.getByText('91%')).toBeInTheDocument()
    expect(screen.queryByText('55%')).not.toBeInTheDocument()
    expect(screen.queryByText('Failing')).not.toBeInTheDocument()
  })
})

describe('Dashboard compliance placeholder — unaffected by this fix (regression guard)', () => {
  it('Dashboard still renders the unconditional "—" placeholder for Compliance Frameworks, unchanged by this fix', async () => {
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
