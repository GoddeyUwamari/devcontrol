/**
 * Coverage for the missing real-mode "Run Scan" entry point.
 *
 * Verified gap: handleRunScan (-> handleExecuteScan -> executeScan ->
 * complianceFrameworksService.executeScan) was fully implemented and
 * functional, but wired only to demo-mode buttons -- a real custom
 * framework had no way to trigger POST /api/compliance-frameworks/:id/scan
 * at all. FrameworkDetailsModal has no scan control of its own.
 *
 * This fix adds a "Run Scan" button to each row of the real-mode "Your
 * Custom Frameworks" list (added in a prior PR), reusing the existing
 * handleRunScan handler and the existing RefreshCw/button styling already
 * used for this exact purpose in demo mode. No new handler, service call,
 * or component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ComplianceFrameworksPage from '../page'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver ??= ResizeObserverStub

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

let demoModeValue = false
vi.mock('@/components/demo/demo-mode-toggle', () => ({
  useDemoMode: () => demoModeValue,
}))

let salesDemoValue = false
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: () => ({ enabled: salesDemoValue }),
}))

const mockExecuteScan = vi.fn().mockResolvedValue(undefined)

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

vi.mock('@/lib/hooks/useSecurityHub', () => ({
  useSecurityHub: () => ({
    capability: null, cis: null, pci: null, nist: null,
    loading: false, error: null, syncing: false,
    triggerSync: vi.fn(), refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useSoc2Readiness', () => ({
  useSoc2Readiness: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}))

vi.mock('@/lib/hooks/useComplianceFrameworks', () => ({
  useComplianceFrameworks: () => ({
    frameworks: frameworksState.frameworks,
    loading: frameworksState.loading,
    error: frameworksState.error,
    fetchFrameworks: vi.fn(),
    createFramework: vi.fn(),
    updateFramework: vi.fn(),
    deleteFramework: vi.fn(),
    executeScan: mockExecuteScan,
  }),
  useComplianceScans: () => ({
    scans: scansState.scans,
    loading: scansState.loading,
    error: scansState.error,
    fetchScans: vi.fn(),
  }),
  useFrameworkDetails: () => ({
    framework: null, rules: [], loading: false, error: null,
    fetchFramework: vi.fn(), createRule: vi.fn(), updateRule: vi.fn(), deleteRule: vi.fn(),
  }),
  useScanResults: () => ({ scan: null, findings: [], loading: false, error: null, fetchResults: vi.fn() }),
}))

function makeFramework(overrides: Partial<ComplianceFramework> = {}): ComplianceFramework {
  return {
    id: 'fw-1',
    organization_id: 'org-1',
    name: 'Production AWS Baseline',
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

describe('real mode -- "Run Scan" entry point on the custom framework list', () => {
  it('renders exactly one Run Scan control per real custom framework', () => {
    frameworksState = {
      frameworks: [makeFramework({ id: 'fw-1', name: 'Production AWS Baseline' }), makeFramework({ id: 'fw-2', name: 'Second Framework' })],
      loading: false,
      error: null,
    }
    renderPage()
    expect(screen.getAllByText('Run Scan')).toHaveLength(2)
  })

  it('clicking Run Scan calls the existing executeScan chain with that framework\'s actual ID', async () => {
    frameworksState = { frameworks: [makeFramework({ id: 'fw-42', name: 'Production AWS Baseline' })], loading: false, error: null }
    renderPage()

    fireEvent.click(screen.getByText('Run Scan'))

    expect(mockExecuteScan).toHaveBeenCalledTimes(1)
    expect(mockExecuteScan).toHaveBeenCalledWith('fw-42')
  })

  it('does not introduce a Run Scan control for the official framework cards', () => {
    frameworksState = { frameworks: [makeFramework()], loading: false, error: null }
    renderPage()
    // The one Run Scan control belongs to the custom-framework row, not the
    // static CIS/SOC2/NIST/PCI-DSS cards, which never render this text at all.
    expect(screen.getAllByText('Run Scan')).toHaveLength(1)
    expect(screen.queryByText('CIS AWS Foundations')).toBeInTheDocument()
    expect(screen.queryByText('SOC 2 Readiness')).toBeInTheDocument()
  })

  it('no scan is triggered automatically when a framework is present but no button is clicked', () => {
    frameworksState = { frameworks: [makeFramework()], loading: false, error: null }
    renderPage()
    expect(mockExecuteScan).not.toHaveBeenCalled()
  })

  it('does not render a duplicate Run Scan control per row', () => {
    frameworksState = { frameworks: [makeFramework({ id: 'fw-1' })], loading: false, error: null }
    renderPage()
    const buttons = screen.getAllByText('Run Scan')
    expect(buttons).toHaveLength(1)
  })
})

describe('demo mode -- unaffected by the real-mode Run Scan wiring', () => {
  beforeEach(() => {
    demoModeValue = true
  })

  it('still renders its own "Run Baseline Scan" control unchanged, and no "Your Custom Frameworks" section', () => {
    frameworksState = { frameworks: [makeFramework()], loading: false, error: null }
    renderPage()
    expect(screen.getByText('Run Baseline Scan')).toBeInTheDocument()
    expect(screen.queryByText('Your Custom Frameworks')).not.toBeInTheDocument()
  })
})
