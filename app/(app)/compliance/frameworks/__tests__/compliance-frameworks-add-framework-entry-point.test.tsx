/**
 * Coverage for the missing real-mode "Add Framework" entry point.
 *
 * Verified defect: CreateFrameworkModal was imported and mounted in real
 * (non-demo) mode, but nothing in that render branch ever called
 * setCreateModalOpen(true) -- the only button that did so lived inside the
 * demo-mode branch, gated by `displayFrameworks.length === 0 && !isDemoActive`,
 * a condition that can never be true while already inside the isDemoActive
 * branch (isDemoActive is true there, so !isDemoActive is always false).
 * That branch was therefore unreachable dead code even in demo mode --
 * before this fix, no clickable "Add Framework" control existed anywhere in
 * the deployed app, in either mode. An authenticated real customer had no
 * way to open framework creation at all.
 *
 * The fix adds a real-mode header button using the existing createModalOpen
 * state, the existing handleCreateFramework handler, and the existing
 * CreateFrameworkModal instance -- no new modal, no new creation logic, no
 * change to demo mode's own (already-dead) button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ComplianceFrameworksPage from '../page'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'

// jsdom has no ResizeObserver; CreateFrameworkModal's Radix Checkbox needs one
// to mount. Scoped to this file only -- not a shared/global test setup change.
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

const mockCreateFramework = vi.fn().mockResolvedValue(undefined)

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
    createFramework: mockCreateFramework,
    updateFramework: vi.fn(),
    deleteFramework: vi.fn(),
    executeScan: vi.fn(),
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

describe('real mode -- "Add Framework" entry point', () => {
  it('renders exactly one "Add Framework" control', () => {
    renderPage()
    expect(screen.getAllByText('Add Framework')).toHaveLength(1)
  })

  it('clicking it opens CreateFrameworkModal (Framework Name field becomes visible)', () => {
    renderPage()
    expect(screen.queryByLabelText(/Framework Name/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Add Framework'))

    expect(screen.getByLabelText(/Framework Name/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Create Compliance Framework/i })).toBeInTheDocument()
  })

  it('submitting the modal calls the existing createFramework handler unchanged', async () => {
    renderPage()
    fireEvent.click(screen.getByText('Add Framework'))

    fireEvent.change(screen.getByLabelText(/Framework Name/i), { target: { value: 'Production AWS Baseline' } })
    fireEvent.click(screen.getByRole('button', { name: /Create Framework/i }))

    expect(mockCreateFramework).toHaveBeenCalledTimes(1)
    expect(mockCreateFramework).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Production AWS Baseline', framework_type: 'custom' })
    )
  })

  it('the button is not present anywhere outside the real-mode header (no second entry point introduced elsewhere)', () => {
    renderPage()
    // Exactly the one control from the assertion above -- this test exists
    // to make a future accidental second button an explicit regression,
    // not to re-derive a count already covered.
    const buttons = screen.getAllByText('Add Framework')
    expect(buttons).toHaveLength(1)
    expect(buttons[0].closest('button')).not.toBeNull()
  })
})

describe('demo mode -- unchanged (the demo-mode "Add Framework" branch remains unreachable, as before)', () => {
  beforeEach(() => {
    demoModeValue = true
  })

  it('never renders "Add Framework" text (the demo-mode condition was already unreachable and is untouched by this fix)', () => {
    renderPage()
    expect(screen.queryByText('Add Framework')).not.toBeInTheDocument()
  })

  it('still renders "Run Baseline Scan" exactly as before', () => {
    renderPage()
    expect(screen.getByText('Run Baseline Scan')).toBeInTheDocument()
  })
})
