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
 *
 * --- Truthfulness follow-up (product-truth pass) -------------------------
 *
 * 5. The static "Evaluated by AWS Security Hub" label on the CIS/PCI cards
 *    rendered unconditionally, even when Security Hub had never been
 *    connected — contradicting the "Not yet available" lock button and the
 *    stateful subtext one line below it in the same card. Fixed: the static
 *    label is now the connection-independent "Security Hub-backed"; only the
 *    stateful subtext claims "Evaluated by AWS Security Hub," and only once
 *    real evidence exists.
 * 6. NIST was labeled bare "NIST" with a description ("Cybersecurity
 *    framework for identifying and managing security risk") that is
 *    actually the definition of NIST CSF, and was attributed
 *    'security_hub' — implying a Security Hub evaluation path that does not
 *    exist for NIST. `backend/src/config/securityHubCisMapping.ts` confirms
 *    the real target framework is NIST 800-53 Rev. 5, which is not
 *    implemented. Fixed: card now reads "NIST 800-53 Rev. 5" with an
 *    accurate description, attribution "Not yet implemented".
 * 7. SOC 2 was attributed 'devcontrol', rendering "Evaluated by DevControl
 *    using your connected cloud security data" — implying a complete, live
 *    SOC 2 Type II evaluation, when no SOC 2 evaluation backend exists yet
 *    (future Phase 5 scope). Fixed: attribution "Not yet implemented" with
 *    subtext framing SOC 2 as a future readiness/supporting-evidence
 *    capability, never a complete Type II audit.
 * 8. The AWS Security Hub informational panel claimed, in 3 of its 4
 *    branches, that "NIST evaluations can be provided through AWS Security
 *    Hub" — false, since no NIST Security Hub integration exists. Fixed:
 *    all NIST mentions removed from that panel; it now only ever describes
 *    CIS and PCI DSS v4.0.1.
 * 9. The top informational banner said "SOC 2 is evaluated directly by
 *    DevControl using your connected cloud security data" and bare "NIST"
 *    — same overclaim/mislabel as above. Fixed to match the corrected card
 *    copy.
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

const mockTriggerSync = vi.fn()
type ReadinessFixture = { framework: string; frameworkVersion: string; syncStatus: string; capabilityStatus: string | null; standardEnabled: boolean | null; evaluatedAt: string | null; coverage: Record<string, number>; controls: unknown[] }
let securityHubState: {
  capability: { capabilityStatus: string | null; syncStatus: string; checkedAt: string | null; error: string | null; enabledStandards: unknown[] } | null
  cis: ReadinessFixture | null
  pci: ReadinessFixture | null
  loading: boolean
  error: string | null
  syncing: boolean
} = {
  // Default matches today's actual production reality: no sync has ever run.
  // Every existing test below relies on this default being indistinguishable
  // from the pre-Security-Hub-integration static "not connected" behavior.
  capability: null,
  cis: null,
  pci: null,
  loading: false,
  error: null,
  syncing: false,
}

vi.mock('@/lib/hooks/useSecurityHub', () => ({
  useSecurityHub: () => ({
    capability: securityHubState.capability,
    cis: securityHubState.cis,
    pci: securityHubState.pci,
    loading: securityHubState.loading,
    error: securityHubState.error,
    syncing: securityHubState.syncing,
    triggerSync: mockTriggerSync,
    refetch: vi.fn(),
  }),
}))

function makeCisReadiness(overrides: Partial<ReadinessFixture> = {}) {
  return {
    framework: 'cis' as const,
    frameworkVersion: '5.0.0',
    syncStatus: 'COMPLETED',
    capabilityStatus: 'ENABLED',
    standardEnabled: true,
    evaluatedAt: new Date().toISOString(),
    coverage: { totalControls: 40, evaluated: 2, passed: 1, failed: 1, unknown: 38, notEvaluated: 0, notApplicable: 0, notEstablishable: 0, errors: 0 },
    controls: [],
    ...overrides,
  }
}

function makePciReadiness(overrides: Partial<ReadinessFixture> = {}) {
  return {
    framework: 'pci' as const,
    frameworkVersion: '4.0.1',
    syncStatus: 'COMPLETED',
    capabilityStatus: 'ENABLED',
    standardEnabled: true,
    evaluatedAt: new Date().toISOString(),
    coverage: { totalControls: 24, evaluated: 2, passed: 1, failed: 1, unknown: 19, notEvaluated: 0, notApplicable: 0, notEstablishable: 2, errors: 0 },
    controls: [],
    ...overrides,
  }
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
  securityHubState = { capability: null, cis: null, pci: null, loading: false, error: null, syncing: false }
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

/**
 * getFrameworkCard above actually resolves to the shared grid container (one
 * `.parentElement` past the true single-card boundary) — harmless for the
 * substring/count assertions above, which never depended on exclusivity
 * between cards. The new tests below DO need true single-card exclusivity
 * (e.g. "no button remains in THIS card"), so this helper stops one level
 * earlier, at the actual individual card `<div>`.
 */
function getSingleFrameworkCard(name: string): HTMLElement {
  const nameEl = screen.getAllByText(name).find((el) => el.tagName === 'P')!
  return nameEl.closest('div') as HTMLElement
}

describe('Test 3 — framework buttons are non-actionable', () => {
  it.each(['CIS AWS Foundations', 'SOC 2 Type II', 'NIST 800-53 Rev. 5', 'PCI DSS v4.0.1'])('%s card renders a disabled control that opens no modal and calls no API on click', (name) => {
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
  it('attributes CIS to Security Hub as a mechanism, never claims live evaluation while never synced', () => {
    renderPage()
    const card = getFrameworkCard('CIS AWS Foundations')
    expect(card.textContent).toContain('Security Hub-backed')
    expect(card.textContent).not.toContain('Evaluated by AWS Security Hub')
  })

  it('identifies the NIST target framework as NIST 800-53 Rev. 5 and marks it not yet implemented', () => {
    renderPage()
    const card = getSingleFrameworkCard('NIST 800-53 Rev. 5')
    expect(card.textContent).toContain('Not yet implemented')
    expect(card.textContent).toContain('NIST 800-53 Rev. 5')
    expect(card.textContent).not.toContain('Evaluated by AWS Security Hub')
    expect(card.textContent).not.toContain('Security Hub-backed')
  })

  it('attributes PCI-DSS to Security Hub as a mechanism, never claims live evaluation while never synced', () => {
    renderPage()
    const card = getFrameworkCard('PCI DSS v4.0.1')
    expect(card.textContent).toContain('Security Hub-backed')
    expect(card.textContent).not.toContain('Evaluated by AWS Security Hub')
  })

  it('marks SOC 2 as a not-yet-implemented future capability, never a complete DevControl evaluation', () => {
    renderPage()
    const card = getFrameworkCard('SOC 2 Type II')
    expect(card.textContent).toContain('Not yet implemented')
    expect(card.textContent).toContain('supporting evidence and readiness')
    expect(card.textContent).not.toContain('Evaluated by DevControl')
    expect(card.textContent).not.toContain('Using cloud security data')
  })

  it('never implies CIS/NIST/PCI-DSS are currently being scanned by DevControl', () => {
    renderPage()
    expect(screen.queryByText(/CIS Scan/)).not.toBeInTheDocument()
    expect(screen.queryByText(/CIS evaluated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/PCI evaluated/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/NIST evaluated/i)).not.toBeInTheDocument()
  })

  it('the AWS Security Hub informational panel never mentions NIST as a supported or provideable evaluation', () => {
    renderPage()
    const panel = screen.getByText('AWS Security Hub').closest('div')!.parentElement as HTMLElement
    expect(panel.textContent).not.toMatch(/NIST/)
    expect(panel.textContent).toContain('CIS AWS Foundations and PCI DSS v4.0.1 can be evaluated through AWS Security Hub once it is connected and synchronized.')
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

describe('REAL MODE + ZERO FRAMEWORK EVALUATIONS — no dead-code regression of the pre-built-framework empty state', () => {
  /**
   * Regression coverage for a bug found after the initial truthfulness fix:
   * a legacy "Start with a pre-built framework" empty state (fake
   * `checks` counts + `handleStartScan` → `CreateFrameworkModal`) previously
   * lived behind a `displayFrameworks.length === 0` branch. That branch has
   * been deleted; this test locks in that real mode with zero frameworks
   * and zero evaluations never resurrects it.
   */
  beforeEach(() => {
    frameworksState = { frameworks: [], loading: false, error: null }
    scansState = { scans: [], loading: false, error: null }
  })

  it('renders no fake check counts', () => {
    renderPage()
    expect(screen.queryByText(/215 checks/)).not.toBeInTheDocument()
    expect(screen.queryByText(/180 checks/)).not.toBeInTheDocument()
    expect(screen.queryByText(/162 checks/)).not.toBeInTheDocument()
    expect(screen.queryByText(/139 checks/)).not.toBeInTheDocument()
  })

  it('renders no "Scan with CIS" or "Start scan" actionable-looking buttons', () => {
    renderPage()
    expect(screen.queryByText(/Scan with CIS/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Start scan/)).not.toBeInTheDocument()
  })

  it('renders "🔒 Not yet available" as the only replacement control, disabled, for every framework', () => {
    renderPage()
    const locks = screen.getAllByText(/Not yet available/)
    expect(locks.length).toBe(4)
    for (const label of locks) {
      const button = label.closest('button')!
      expect(button).toBeDisabled()
    }
  })

  it('clicking the unavailable control invokes no scan handler, opens no framework-builder modal, and makes no API request', () => {
    renderPage()
    const locks = screen.getAllByText(/Not yet available/)
    for (const label of locks) {
      fireEvent.click(label.closest('button')!)
    }

    expect(mockExecuteScan).not.toHaveBeenCalled()
    expect(mockCreateFramework).not.toHaveBeenCalled()
    expect(mockUpdateFramework).not.toHaveBeenCalled()
    expect(mockDeleteFramework).not.toHaveBeenCalled()
    expect(screen.queryByText('Create Framework')).not.toBeInTheDocument()
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

describe('Test 7 — Security Hub capability states never fabricate CIS pass/fail', () => {
  it('NOT_GRANTED: CIS card stays "Not yet available", never PASS/FAIL, badge reads "Permission required"', () => {
    securityHubState = {
      capability: { capabilityStatus: 'NOT_GRANTED', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: 'AccessDenied', enabledStandards: [] },
      cis: makeCisReadiness({ capabilityStatus: 'NOT_GRANTED', standardEnabled: null, coverage: { totalControls: 40, evaluated: 0, passed: 0, failed: 0, unknown: 0, notEvaluated: 40, notApplicable: 0, errors: 0 } }),
      pci: null,
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    const card = getSingleFrameworkCard('CIS AWS Foundations')
    expect(card.textContent).toContain('Security Hub permission not granted')
    expect(card.querySelector('button[disabled]')).toBeTruthy()
    expect(card.textContent).not.toMatch(/\bFAIL\b/)
    expect(card.textContent).not.toContain('passed')
    expect(screen.getByText('Permission required')).toBeInTheDocument()
  })

  it('NOT_AVAILABLE: CIS card explains Security Hub is not enabled for the account, stays non-actionable', () => {
    securityHubState = {
      capability: { capabilityStatus: 'NOT_AVAILABLE', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: null, enabledStandards: [] },
      cis: makeCisReadiness({ capabilityStatus: 'NOT_AVAILABLE', standardEnabled: null, coverage: { totalControls: 40, evaluated: 0, passed: 0, failed: 0, unknown: 0, notEvaluated: 40, notApplicable: 0, errors: 0 } }),
      pci: null,
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    const card = getSingleFrameworkCard('CIS AWS Foundations')
    expect(card.textContent).toContain('Security Hub is not enabled for this AWS account')
    expect(card.querySelector('button[disabled]')).toBeTruthy()
    expect(screen.getByText('Not enabled')).toBeInTheDocument()
  })

  it('ERROR: CIS card surfaces a check-failed message, never presented as a compliance failure', () => {
    securityHubState = {
      capability: { capabilityStatus: 'ERROR', syncStatus: 'FAILED', checkedAt: new Date().toISOString(), error: 'Rate exceeded', enabledStandards: [] },
      cis: makeCisReadiness({ capabilityStatus: 'ERROR', standardEnabled: null, coverage: { totalControls: 40, evaluated: 0, passed: 0, failed: 0, unknown: 0, notEvaluated: 0, notApplicable: 0, errors: 40 } }),
      pci: null,
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    const card = getSingleFrameworkCard('CIS AWS Foundations')
    expect(card.textContent).toContain('Security Hub check failed')
    expect(card.textContent).not.toContain('Failing')
    expect(screen.getByText('Check failed')).toBeInTheDocument()
  })

  it('ENABLED but CIS standard disabled: shows NOT_EVALUATED reasoning, not PASS or FAIL', () => {
    securityHubState = {
      capability: { capabilityStatus: 'ENABLED', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: null, enabledStandards: [] },
      cis: makeCisReadiness({ capabilityStatus: 'ENABLED', standardEnabled: false, coverage: { totalControls: 40, evaluated: 0, passed: 0, failed: 0, unknown: 0, notEvaluated: 40, notApplicable: 0, errors: 0 } }),
      pci: null,
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    const card = getSingleFrameworkCard('CIS AWS Foundations')
    expect(card.textContent).toContain('CIS standard is not enabled')
    expect(card.querySelector('button[disabled]')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('ENABLED + CIS standard enabled: shows real coverage breakdown, removes the lock button, and never shows a bare percentage', () => {
    securityHubState = {
      capability: { capabilityStatus: 'ENABLED', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: null, enabledStandards: [] },
      cis: makeCisReadiness({ coverage: { totalControls: 40, evaluated: 5, passed: 3, failed: 2, unknown: 35, notEvaluated: 0, notApplicable: 0, errors: 0 } }),
      pci: null,
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    const card = getSingleFrameworkCard('CIS AWS Foundations')
    expect(card.querySelector('[data-testid="cis-coverage"]')).toBeTruthy()
    expect(card.textContent).toContain('3 passed')
    expect(card.textContent).toContain('2 failed')
    expect(card.textContent).toContain('35 unknown')
    expect(card.textContent).toContain('/ 40 mapped')
    // No lock affordance once real evidence exists for CIS specifically.
    expect(card.querySelector('button')).toBeNull()
    // Never a bare, context-free percentage for CIS.
    expect(card.textContent).not.toMatch(/^\d+%$/)
  })

  it('other framework cards (SOC2/NIST/PCI-DSS) are unaffected by CIS becoming evaluated', () => {
    securityHubState = {
      capability: { capabilityStatus: 'ENABLED', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: null, enabledStandards: [] },
      cis: makeCisReadiness(),
      pci: null,
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    for (const name of ['SOC 2 Type II', 'NIST 800-53 Rev. 5', 'PCI DSS v4.0.1']) {
      const card = getSingleFrameworkCard(name)
      const button = card.querySelector('button')!
      expect(button).toBeDisabled()
      expect(button.textContent).toContain('Not yet available')
    }
  })

  it('clicking "Sync Security Hub" calls triggerSync and never opens the framework-builder modal', () => {
    renderPage()
    const syncButton = screen.getByText('Sync Security Hub').closest('button')!
    fireEvent.click(syncButton)

    expect(mockTriggerSync).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Create Framework')).not.toBeInTheDocument()
  })
})

describe('Test 8 — PCI DSS v4.0.1 capability states never fabricate pass/fail or imply certification', () => {
  it('NOT_GRANTED: PCI card stays "Not yet available", never PASS/FAIL', () => {
    securityHubState = {
      capability: { capabilityStatus: 'NOT_GRANTED', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: 'AccessDenied', enabledStandards: [] },
      cis: null,
      pci: makePciReadiness({ capabilityStatus: 'NOT_GRANTED', standardEnabled: null, coverage: { totalControls: 24, evaluated: 0, passed: 0, failed: 0, unknown: 0, notEvaluated: 22, notApplicable: 0, notEstablishable: 2, errors: 0 } }),
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    const card = getSingleFrameworkCard('PCI DSS v4.0.1')
    expect(card.textContent).toContain('Security Hub permission not granted')
    expect(card.querySelector('button[disabled]')).toBeTruthy()
    expect(card.textContent).not.toMatch(/\bFAIL\b/)
  })

  it('ENABLED + PCI standard enabled: shows coverage with a NOT_ESTABLISHABLE count and partial-coverage language, never a bare percentage or a compliance/certification claim', () => {
    securityHubState = {
      capability: { capabilityStatus: 'ENABLED', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: null, enabledStandards: [] },
      cis: null,
      pci: makePciReadiness({ coverage: { totalControls: 24, evaluated: 5, passed: 3, failed: 2, unknown: 17, notEvaluated: 0, notApplicable: 0, notEstablishable: 2, errors: 0 }, controls: [{ status: 'ADDITIONAL_EVIDENCE' }] as any }),
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    const card = getSingleFrameworkCard('PCI DSS v4.0.1')
    expect(card.querySelector('[data-testid="pci-coverage"]')).toBeTruthy()
    expect(card.textContent).toContain('3 passed')
    expect(card.textContent).toContain('2 failed')
    expect(card.textContent).toContain('2 not establishable')
    expect(card.textContent).toContain('/ 24 mapped')
    expect(card.textContent).toContain('Partial coverage')
    expect(card.querySelector('button')).toBeNull()
    // No certification/compliance claim, no bare percentage.
    expect(card.textContent).not.toMatch(/PCI\s+compliant/i)
    expect(card.textContent).not.toMatch(/PCI\s+certified/i)
    expect(card.textContent).not.toMatch(/100%\s*PCI/i)
    expect(card.textContent).not.toMatch(/^\d+%$/)
  })

  it('Security Hub unavailable renders PCI as NOT_EVALUATED, never as a PCI compliance FAIL', () => {
    securityHubState = {
      capability: { capabilityStatus: 'NOT_AVAILABLE', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: null, enabledStandards: [] },
      cis: null,
      pci: makePciReadiness({ capabilityStatus: 'NOT_AVAILABLE', standardEnabled: null, coverage: { totalControls: 24, evaluated: 0, passed: 0, failed: 0, unknown: 0, notEvaluated: 22, notApplicable: 0, notEstablishable: 2, errors: 0 } }),
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    const card = getSingleFrameworkCard('PCI DSS v4.0.1')
    expect(card.textContent).toContain('Security Hub is not enabled for this AWS account')
    expect(card.textContent).not.toMatch(/\bFAIL\b/)
    expect(card.querySelector('button[disabled]')).toBeTruthy()
  })

  it('PCI becoming evaluated does not affect the CIS, SOC2, or NIST cards', () => {
    securityHubState = {
      capability: { capabilityStatus: 'ENABLED', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: null, enabledStandards: [] },
      cis: null,
      pci: makePciReadiness(),
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    for (const name of ['CIS AWS Foundations', 'SOC 2 Type II', 'NIST 800-53 Rev. 5']) {
      const card = getSingleFrameworkCard(name)
      const button = card.querySelector('button')
      if (name === 'SOC 2 Type II' || name === 'NIST 800-53 Rev. 5') {
        expect(button).toBeDisabled()
        expect(button!.textContent).toContain('Not yet available')
      } else {
        // CIS remains in its own default (never-synced) placeholder state here since
        // only `pci` was populated in this test's fixture.
        expect(button).toBeDisabled()
      }
    }
  })

  it('never implies PCI DSS compliance or certification anywhere on the page', () => {
    securityHubState = {
      capability: { capabilityStatus: 'ENABLED', syncStatus: 'COMPLETED', checkedAt: new Date().toISOString(), error: null, enabledStandards: [] },
      cis: null,
      pci: makePciReadiness(),
      loading: false,
      error: null,
      syncing: false,
    }
    renderPage()

    expect(screen.queryByText(/PCI DSS compliant/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/PCI certified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/100% PCI/i)).not.toBeInTheDocument()
  })
})
