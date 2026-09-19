/**
 * Integration coverage (G): proves sample AWS-Observed Evidence and sample
 * Customer-Provided Evidence actually render through the REAL Soc2ObservedEvidenceList
 * / Soc2CustomerEvidenceSection components (the exact components the SOC2 detail page
 * uses) when demo mode is active -- not just that the underlying hooks return the right
 * data in isolation (see useSoc2Readiness.demo.test.tsx / useCustomerEvidence.demo
 * .test.tsx for that). soc2Service is spied on to prove no real request is made.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { soc2Service } from '@/lib/services/soc2.service'
import { Soc2ObservedEvidenceList } from '../Soc2ObservedEvidenceList'
import { Soc2CustomerEvidenceSection } from '../Soc2CustomerEvidenceSection'
import { DEMO_SOC2_READINESS, DEMO_SOC2_CUSTOMER_EVIDENCE } from '@/lib/demo-data/soc2-demo-data'

const DEMO_MODE_KEY = 'devcontrol_demo_mode'

function setDemoMode(enabled: boolean) {
  localStorage.setItem(DEMO_MODE_KEY, enabled ? 'true' : 'false')
  window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled } }))
}

// Radix Select (used by Soc2CustomerEvidenceForm, rendered inside
// Soc2CustomerEvidenceSection) calls DOM APIs jsdom does not implement -- same
// workaround soc2-detail-page.test.tsx already uses.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
})

let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  localStorage.clear()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.restoreAllMocks()
})

describe('SOC 2 demo mode — sample AWS-Observed Evidence renders through the real component', () => {
  it('shows sample observation rows for CC6.1 and never calls the real evidence endpoint', () => {
    const spy = vi.spyOn(soc2Service, 'getEvidence').mockResolvedValue([])
    setDemoMode(true)

    render(<Soc2ObservedEvidenceList criterionId="CC6.1" />, { wrapper })

    expect(screen.queryByText('No AWS-observed evidence yet')).not.toBeInTheDocument()
    expect(screen.getAllByText('AWS-Observed').length).toBeGreaterThan(0)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('SOC 2 demo mode — sample Customer-Provided Evidence renders through the real component', () => {
  it('shows sample customer-evidence rows and never calls the real customer-evidence endpoint', () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue([])
    setDemoMode(true)

    render(
      <Soc2CustomerEvidenceSection criteria={DEMO_SOC2_READINESS} canManage />,
      { wrapper }
    )

    expect(screen.queryByText('No customer-provided evidence yet')).not.toBeInTheDocument()
    for (const sample of DEMO_SOC2_CUSTOMER_EVIDENCE) {
      expect(screen.getByText(sample.title)).toBeInTheDocument()
    }
    expect(screen.getAllByText('Self-Attested').length).toBeGreaterThanOrEqual(DEMO_SOC2_CUSTOMER_EVIDENCE.length)
    expect(spy).not.toHaveBeenCalled()
  })
})
