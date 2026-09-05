/**
 * Coverage for the Compliance Frameworks page truthfulness fix.
 *
 * Confirmed issues addressed here:
 *
 * 1. All four framework buttons (CIS, SOC 2, NIST, PCI-DSS) opened the
 *    generic CreateFrameworkModal even though none of them actually scan
 *    anything. Fixed by replacing the action with a disabled, non-actionable
 *    "🔒 Not yet available" control that never opens a modal and never calls
 *    an API.
 *
 * 2. The KPI strip displayed hardcoded values (72%, 4, 11) for "Compliance
 *    Score" / "Critical Violations" / "High-Risk Violations" whenever any
 *    completed scan existed, regardless of what that scan's real fields
 *    actually were. Fixed by reading `compliance_score` / `critical_issues`
 *    / `high_issues` directly off the most recent completed
 *    `ComplianceScan`, with an explicit `no_evaluation` state (not a
 *    `hasScans ? fake : '—'` ternary) rendering "—" / "Not yet evaluated"
 *    when no completed scan exists.
 *
 * 3. A separate score/risk-visibility presentation ("N/A" /
 *    "Risk Visibility: Not Established") rendered unconditionally in real
 *    mode even when a real completed scan existed, contradicting the KPI
 *    strip. Fixed by removing that second presentation from real mode —
 *    the KPI strip is now the single source of truth for the score.
 *
 * 4. CIS/NIST/PCI-DSS cards implied DevControl currently evaluates them
 *    ("215/162/139 checks"). Fixed with explicit "Evaluated by AWS Security
 *    Hub" attribution (Security Hub not connected) and removal of the
 *    fabricated check counts; SOC 2 is attributed to DevControl instead.
 *
 * Demo mode is out of scope for this fix and must render exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ComplianceFrameworksPage from '../page'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

let demoModeValue = false
vi.mock('@/lib/services/demo-mode.service', () => ({
  demoModeService: { isEnabled: () => demoModeValue },
}))

let salesDemoValue = false
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: () => ({ enabled: salesDemoValue }),
}))

const mockCreateFramework = vi.fn()
const mockUpdateFramework = vi.fn()
const mockDeleteFramework = vi.fn()
const mockExecuteScan = vi.fn()
const mockFetchFrameworks = vi.fn()
const mockFetchScans = vi.fn()

let frameworksState: { frameworks: ComplianceFramework[]; loading: boolean; error: string | null } = {
  frameworks: [],
  loading: false,
  error: null,
}
let scansState: { scans: ComplianceScan[]; loading: boolean; error: string | null } = {
  scans: [],
  loading: false,
  error: null,
}

vi.mock('@/lib/hooks/useComplianceFrameworks', () => ({
  useComplianceFrameworks: () => ({
    frameworks: frameworksState.frameworks,
    loading: frameworksState.loading,
    error: frameworksState.error,
    fetchFrameworks: mockFetchFrameworks,
    createFramework: mockCreateFramework,
    updateFramework: mockUpdateFramework,
    deleteFramework: mockDeleteFramework,
    executeScan: mockExecuteScan,
  }),
  useComplianceScans: () => ({
    scans: scansState.scans,
    loading: scansState.loading,
    error: scansState.error,
    fetchScans: mockFetchScans,
  }),
  useFrameworkDetails: () => ({
    framework: null,
    rules: [],
    loading: false,
    error: null,
    fetchFramework: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
  }),
  useScanResults: () => ({
    scan: null,
    findings: [],
    loading: false,
    error: null,
    fetchResults: vi.fn(),
  }),
}))

function makeScan(overrides: Partial<ComplianceScan> = {}): ComplianceScan {
  return {
    id: overrides.id ?? 'scan-1',
    organization_id: 'org-1',
    framework_id: overrides.framework_id ?? 'fw-1',
    scan_type: 'manual',
    status: 'completed',
    total_resources: 10,
    compliant_resources: 8,
    non_compliant_resources: 2,
    compliance_score: 84,
    critical_issues: 2,
    high_issues: 7,
    medium_issues: 0,
    low_issues: 0,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    duration_seconds: 60,
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

function renderPage() {
  return render(<ComplianceFrameworksPage />)
}

beforeEach(() => {
  vi.clearAllMocks()
  demoModeValue = false
  salesDemoValue = false
  frameworksState = { frameworks: [], loading: false, error: null }
  scansState = { scans: [], loading: false, error: null }
})

describe('Test 1 — real mode, no completed evaluation', () => {
  it('shows "—" for all three score KPIs with "Not yet evaluated" subtext, never a fabricated value', () => {
    renderPage()

    expect(screen.getByText('Overall Compliance Score')).toBeInTheDocument()
    expect(screen.getByText('Critical Issues')).toBeInTheDocument()
    expect(screen.getByText('High Risk Issues')).toBeInTheDocument()

    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBe(3)

    expect(screen.getAllByText('Not yet evaluated').length).toBeGreaterThanOrEqual(3)

    expect(screen.queryByText('72%')).not.toBeInTheDocument()
    expect(screen.queryByText('4')).not.toBeInTheDocument()
    expect(screen.queryByText('11')).not.toBeInTheDocument()
  })

  it('shows 0 active evaluations for the Frameworks KPI', () => {
    renderPage()
    expect(screen.getByText('Frameworks')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getByText('Active evaluations')).toBeInTheDocument()
  })

  it('shows the honest empty state for Active Evaluations', () => {
    renderPage()
    expect(screen.getByText('No active compliance evaluations')).toBeInTheDocument()
    expect(screen.getByText('Start an evaluation when a supported framework becomes available.')).toBeInTheDocument()
  })
})

describe('Test 2 — real mode, completed evaluation', () => {
  it('displays the exact persisted compliance_score / critical_issues / high_issues values', () => {
    scansState = {
      scans: [makeScan({ compliance_score: 84, critical_issues: 2, high_issues: 7 })],
      loading: false,
      error: null,
    }
    renderPage()

    expect(screen.getAllByText('84%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.queryByText('—')).not.toBeInTheDocument()
  })

  it('agrees between the KPI strip and the Active Evaluations list for the same scan', () => {
    scansState = {
      scans: [makeScan({ compliance_score: 84, critical_issues: 2, high_issues: 7 })],
      loading: false,
      error: null,
    }
    renderPage()

    // 84% appears once in the KPI strip and once next to the evaluation row.
    expect(screen.getAllByText('84%').length).toBe(2)
  })

  it('picks the most recently completed scan when multiple exist', () => {
    scansState = {
      scans: [
        makeScan({ id: 'old', compliance_score: 50, critical_issues: 9, high_issues: 9, completed_at: new Date(Date.now() - 100000).toISOString() }),
        makeScan({ id: 'new', compliance_score: 91, critical_issues: 1, high_issues: 3, completed_at: new Date().toISOString() }),
      ],
      loading: false,
      error: null,
    }
    renderPage()

    const scoreCard = screen.getByText('Overall Compliance Score').closest('div')!
    expect(scoreCard.textContent).toContain('91%')
    expect(scoreCard.textContent).not.toContain('50%')
  })
})

/** The framework card name lives in a `<p>` — badges for NIST/PCI-DSS reuse the same text, so scope to the name paragraph specifically. */
function getFrameworkCard(name: string): HTMLElement {
  const nameEl = screen.getAllByText(name).find((el) => el.tagName === 'P')!
  return nameEl.closest('div')!.parentElement as HTMLElement
}

describe('Test 3 — framework buttons are non-actionable', () => {
  it.each(['CIS AWS Foundations', 'SOC 2 Type II', 'NIST', 'PCI-DSS'])('%s card renders a disabled control that opens no modal and calls no API on click', (name) => {
    renderPage()

    const card = getFrameworkCard(name)
    const button = card.querySelector('button')!
    expect(button).toBeDisabled()

    fireEvent.click(button)

    expect(mockCreateFramework).not.toHaveBeenCalled()
    expect(mockExecuteScan).not.toHaveBeenCalled()
    expect(screen.queryByText('Create Framework')).not.toBeInTheDocument()
  })

  it('renders the literal "Not yet available" lock affordance for every framework card', () => {
    renderPage()
    expect(screen.getAllByText(/Not yet available/).length).toBe(4)
  })
})

describe('Test 4 — framework attribution', () => {
  it('attributes CIS to AWS Security Hub', () => {
    renderPage()
    expect(getFrameworkCard('CIS AWS Foundations').textContent).toContain('Evaluated by AWS Security Hub')
  })

  it('attributes NIST to AWS Security Hub', () => {
    renderPage()
    expect(getFrameworkCard('NIST').textContent).toContain('Evaluated by AWS Security Hub')
  })

  it('attributes PCI-DSS to AWS Security Hub', () => {
    renderPage()
    expect(getFrameworkCard('PCI-DSS').textContent).toContain('Evaluated by AWS Security Hub')
  })

  it('attributes SOC 2 to DevControl using cloud security data', () => {
    renderPage()
    const card = getFrameworkCard('SOC 2 Type II')
    expect(card.textContent).toContain('Evaluated by DevControl')
    expect(card.textContent).toContain('Using cloud security data')
  })

  it('never implies CIS/NIST/PCI-DSS are currently being scanned by DevControl', () => {
    renderPage()
    expect(screen.queryByText(/CIS Scan/)).not.toBeInTheDocument()
    expect(screen.queryByText(/CIS evaluated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/PCI evaluated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/NIST evaluated/i)).not.toBeInTheDocument()
  })
})

describe('Test 6 — no fake framework check counts', () => {
  it('does not present 215/180/162/139 checks as DevControl coverage', () => {
    renderPage()
    expect(screen.queryByText(/215 checks/)).not.toBeInTheDocument()
    expect(screen.queryByText(/180 checks/)).not.toBeInTheDocument()
    expect(screen.queryByText(/162 checks/)).not.toBeInTheDocument()
    expect(screen.queryByText(/139 checks/)).not.toBeInTheDocument()
  })
})

describe('AWS Security Hub panel — real mode', () => {
  it('shows a "Not connected" status and never implies Security Hub is already integrated', () => {
    renderPage()
    expect(screen.getByText('AWS Security Hub')).toBeInTheDocument()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
    expect(screen.queryByText('Enable Security Hub')).not.toBeInTheDocument()
  })
})

describe('Test 5 — demo mode is unchanged', () => {
  it('still shows the fabricated demo KPI values inside demo mode', () => {
    demoModeValue = true
    renderPage()

    expect(screen.getAllByText('80%').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Partially Compliant')).toBeInTheDocument()
    expect(screen.getByText('Compliance Intelligence')).toBeInTheDocument()
  })

  it('sales demo mode also preserves the existing fabricated demo behavior', () => {
    salesDemoValue = true
    renderPage()
    expect(screen.getByText('Partially Compliant')).toBeInTheDocument()
  })

  it('real-mode logic does not leak into demo mode: the truthful "Not yet evaluated" KPI card never renders in demo', () => {
    demoModeValue = true
    renderPage()
    expect(screen.queryByText('Overall Compliance Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Not yet evaluated')).not.toBeInTheDocument()
  })

  it('demo mode never renders the real-mode "Not yet available" lock affordance', () => {
    demoModeValue = true
    renderPage()
    expect(screen.queryByText(/Not yet available/)).not.toBeInTheDocument()
  })
})
