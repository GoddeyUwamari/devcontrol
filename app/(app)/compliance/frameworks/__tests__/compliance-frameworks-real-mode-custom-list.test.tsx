/**
 * Coverage for the missing real-mode custom-framework list.
 *
 * Verified gap: `useComplianceFrameworks()` genuinely calls
 * GET /api/compliance-frameworks and stores the result in `frameworks`
 * state, but nothing in the real (non-demo) render branch ever mapped over
 * that array -- a framework created through the (now-fixed) Add Framework
 * flow was persisted correctly but stayed invisible on the page. The
 * existing detail/rule-management machinery (handleViewDetails ->
 * FrameworkDetailsModal -> CreateRuleModal) was already fully implemented
 * and already mounted in real mode; it simply had no trigger.
 *
 * This fix adds a "Your Custom Frameworks" list, rendered only when
 * `frameworks.length > 0`, with one row per real framework and a
 * "View / Manage Rules" button wired to the existing `handleViewDetails`.
 * No new modal, hook, or API call.
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

describe('real mode -- "Your Custom Frameworks" list', () => {
  it('does not render the section when there are no custom frameworks', () => {
    renderPage()
    expect(screen.queryByText('Your Custom Frameworks')).not.toBeInTheDocument()
  })

  it('renders one row per real framework once fetched', () => {
    frameworksState = {
      frameworks: [makeFramework({ id: 'fw-1', name: 'Production AWS Baseline' }), makeFramework({ id: 'fw-2', name: 'Second Framework' })],
      loading: false,
      error: null,
    }
    renderPage()

    expect(screen.getByText('Your Custom Frameworks')).toBeInTheDocument()
    expect(screen.getByText('Production AWS Baseline')).toBeInTheDocument()
    expect(screen.getByText('Second Framework')).toBeInTheDocument()
    expect(screen.getAllByText('View / Manage Rules')).toHaveLength(2)
  })

  it('shows a "Default" badge only for the framework with is_default true', () => {
    frameworksState = {
      frameworks: [makeFramework({ id: 'fw-1', name: 'Alpha Framework', is_default: true }), makeFramework({ id: 'fw-2', name: 'Beta Framework', is_default: false })],
      loading: false,
      error: null,
    }
    renderPage()

    // Exactly one "Default" badge exists (for Alpha), not two.
    expect(screen.getAllByText('Default')).toHaveLength(1)
    const alphaRow = screen.getByText('Alpha Framework').closest('div')!.parentElement!
    expect(alphaRow).toHaveTextContent('Default')
    const betaRow = screen.getByText('Beta Framework').closest('div')!.parentElement!
    expect(betaRow).not.toHaveTextContent('Default')
  })

  it('clicking "View / Manage Rules" opens the existing FrameworkDetailsModal for that framework', () => {
    frameworksState = { frameworks: [makeFramework({ id: 'fw-1', name: 'Production AWS Baseline' })], loading: false, error: null }
    renderPage()

    fireEvent.click(screen.getByText('View / Manage Rules'))

    // FrameworkDetailsModal renders the framework name as its dialog title
    // and a "Rules (N)" heading -- both prove the existing modal opened,
    // not a new one.
    expect(screen.getByRole('heading', { name: 'Production AWS Baseline' })).toBeInTheDocument()
    expect(screen.getByText(/Rules \(0\)/)).toBeInTheDocument()
  })

  it('does not introduce a second CreateFrameworkModal or a duplicate Add Framework control', () => {
    frameworksState = { frameworks: [makeFramework()], loading: false, error: null }
    renderPage()
    expect(screen.getAllByText('Add Framework')).toHaveLength(1)
  })
})

describe('demo mode -- unaffected by the real-mode custom-framework list', () => {
  beforeEach(() => {
    demoModeValue = true
  })

  it('never renders "Your Custom Frameworks" (real-mode-only section)', () => {
    frameworksState = { frameworks: [makeFramework()], loading: false, error: null }
    renderPage()
    expect(screen.queryByText('Your Custom Frameworks')).not.toBeInTheDocument()
  })
})
