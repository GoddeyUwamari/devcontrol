/**
 * Integration guard (G): demo mode is switched off for everyone. With the legacy
 * demo flag set, the REAL Soc2ObservedEvidenceList / Soc2CustomerEvidenceSection
 * components (the exact components the SOC2 detail page uses) still call the real
 * endpoints and render their real empty states -- never the sample evidence rows.
 * The hook-level guards live in useSoc2Readiness.demo.test.tsx /
 * useCustomerEvidence.demo.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

describe('SOC 2 with the demo flag set — AWS-Observed Evidence stays real', () => {
  it('calls the real evidence endpoint for CC6.1 and shows the real empty state, not sample rows', async () => {
    const spy = vi.spyOn(soc2Service, 'getEvidence').mockResolvedValue([])
    setDemoMode(true)

    render(<Soc2ObservedEvidenceList criterionId="CC6.1" />, { wrapper })

    expect(await screen.findByText('No AWS-observed evidence yet')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledWith('CC6.1')
  })
})

describe('SOC 2 with the demo flag set — Customer-Provided Evidence stays real', () => {
  it('calls the real customer-evidence endpoint and shows the real empty state, not sample rows', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue([])
    setDemoMode(true)

    render(
      <Soc2CustomerEvidenceSection criteria={DEMO_SOC2_READINESS} canManage />,
      { wrapper }
    )

    expect(await screen.findByText('No customer-provided evidence yet')).toBeInTheDocument()
    await waitFor(() => expect(spy).toHaveBeenCalled())
    for (const sample of DEMO_SOC2_CUSTOMER_EVIDENCE) {
      expect(screen.queryByText(sample.title)).not.toBeInTheDocument()
    }
  })
})
