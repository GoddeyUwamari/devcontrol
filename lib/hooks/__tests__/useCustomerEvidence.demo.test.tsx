/**
 * Demo mode is switched off for everyone. Same conventions as
 * useSoc2Readiness.demo.test.tsx: both legacy demo flags are set exactly as the old
 * /demo page and avatar menu did, and useCustomerEvidenceList() must ignore them --
 * real endpoint, real rows and the caller's real `enabled` gate, never sample data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { soc2Service, Soc2CustomerEvidence } from '@/lib/services/soc2.service'
import { useCustomerEvidenceList } from '../useCustomerEvidence'
import { DEMO_SOC2_CUSTOMER_EVIDENCE } from '@/lib/demo-data/soc2-demo-data'

const DEMO_MODE_KEY = 'devcontrol_demo_mode'
const SALES_DEMO_KEY = 'sales-demo-mode'

function setDemoMode(enabled: boolean) {
  localStorage.setItem(DEMO_MODE_KEY, enabled ? 'true' : 'false')
  window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled } }))
}

// useSalesDemo used to be a Zustand store persisted under 'sales-demo-mode'; this
// writes that persisted shape after the module has loaded, so the Sales Demo cases
// below check only that the flag is ignored at render time. The real leak, a flag
// already stored when the page loads, is guarded in app/__tests__/demo-kill-switch.test.tsx.
function setSalesDemo(enabled: boolean) {
  localStorage.setItem(SALES_DEMO_KEY, JSON.stringify({ state: { enabled }, version: 0 }))
}

let queryClient: QueryClient
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

beforeEach(() => {
  localStorage.clear()
  setSalesDemo(false)
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.restoreAllMocks()
})

const REAL_FIXTURE: Soc2CustomerEvidence[] = [
  {
    evidenceId: 'real-e1',
    criterionId: 'CC6.1',
    evidenceType: 'policy',
    title: 'Real customer policy',
    description: null,
    externalReference: null,
    provenance: 'SELF_ATTESTED',
    status: 'SUBMITTED',
    submittedBy: 'real-user-id',
    submittedAt: '2026-01-01T00:00:00.000Z',
    reviewDate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

describe('useCustomerEvidenceList — demo flag set (C: ignored)', () => {
  it('calls the real endpoint and returns real customer evidence, never the samples', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(true)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(result.current.data).not.toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE)
  })

  it('passes the criterionId to the real endpoint instead of filtering sample evidence', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(true)
    const targetCriterionId = DEMO_SOC2_CUSTOMER_EVIDENCE[0].criterionId
    const { result } = renderHook(() => useCustomerEvidenceList(targetCriterionId, true), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledWith(targetCriterionId)
    expect(result.current.data).toEqual(REAL_FIXTURE)
  })

  it('the real ["soc2-customer-evidence", ...] cache entry holds real rows, never sample rows', async () => {
    vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(true)
    renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => {
      expect(queryClient.getQueryData(['soc2-customer-evidence', null])).toEqual(REAL_FIXTURE)
    })
  })

  it('the caller-supplied `enabled` gate (real-mode Enterprise gate) still holds: enabled=false makes no call and returns no sample data', () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(true)
    const { result } = renderHook(() => useCustomerEvidenceList(undefined, false), { wrapper })
    expect(spy).not.toHaveBeenCalled()
    expect(result.current.data).toBeUndefined()
  })
})

describe('useCustomerEvidenceList — real mode (E: real mode regression, unchanged authorization semantics)', () => {
  it('calls the real endpoint and preserves the exact response mapping when demo mode is off', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(REAL_FIXTURE)
  })

  it('real mode still respects the caller-supplied `enabled` flag (e.g. non-Enterprise gate) exactly as before', () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)

    renderHook(() => useCustomerEvidenceList(undefined, false), { wrapper })

    expect(spy).not.toHaveBeenCalled()
  })
})

describe('useCustomerEvidenceList — demo flag toggled mid-session (D: ignored)', () => {
  it('turning the demo flag on and off never swaps the real rows for sample rows', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))

    act(() => setDemoMode(true))
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(result.current.data).not.toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE)

    act(() => setDemoMode(false))
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(spy).toHaveBeenCalled()
  })
})

describe('useCustomerEvidenceList — Sales Demo flag set after load (A: ignored at render time)', () => {
  it('the flag is ignored at render time: calls the real endpoint and returns real customer evidence, with and without a criterionId', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)
    setSalesDemo(true)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(result.current.data).not.toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE)

    const targetCriterionId = DEMO_SOC2_CUSTOMER_EVIDENCE[0].criterionId
    const filtered = renderHook(() => useCustomerEvidenceList(targetCriterionId, true), { wrapper })
    await waitFor(() => expect(filtered.result.current.isLoading).toBe(false))
    expect(spy).toHaveBeenCalledWith(targetCriterionId)
    expect(filtered.result.current.data).toEqual(REAL_FIXTURE)
  })
})

describe('useCustomerEvidenceList — Sales Demo flag toggled mid-session (D: ignored at render time)', () => {
  it('the flag is ignored at render time: turning it on and off never swaps the real rows for sample rows', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)
    setSalesDemo(false)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))

    act(() => setSalesDemo(true))
    expect(result.current.data).toEqual(REAL_FIXTURE)

    act(() => setSalesDemo(false))
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(spy).toHaveBeenCalled()
  })
})

describe('useCustomerEvidenceList — both flags false (C: real API behavior unchanged)', () => {
  it('demoMode=false, salesDemoMode=false calls the real endpoint exactly as before', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)
    setSalesDemo(false)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(REAL_FIXTURE)
  })
})
