/**
 * Demo-mode coverage for useCustomerEvidenceList() (SOC 2 demo mode implementation).
 * Same conventions as useSoc2Readiness.demo.test.tsx: exercises the real useDemoMode()
 * hook (real localStorage + 'demo-mode-changed' event), spies on the real soc2Service
 * method to prove it is never called while demo mode is active.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { soc2Service, Soc2CustomerEvidence } from '@/lib/services/soc2.service'
import { useCustomerEvidenceList } from '../useCustomerEvidence'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { DEMO_SOC2_CUSTOMER_EVIDENCE } from '@/lib/demo-data/soc2-demo-data'

const DEMO_MODE_KEY = 'devcontrol_demo_mode'

function setDemoMode(enabled: boolean) {
  localStorage.setItem(DEMO_MODE_KEY, enabled ? 'true' : 'false')
  window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled } }))
}

// Real, persisted Zustand store (lib/demo/sales-demo-data.ts) -- independent of
// devcontrol_demo_mode/useDemoMode() entirely. Manipulated via its own public setState.
function setSalesDemo(enabled: boolean) {
  useSalesDemo.setState({ enabled })
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

describe('useCustomerEvidenceList — demo mode (C: demo customer evidence)', () => {
  it('returns sample customer evidence, SELF_ATTESTED provenance, never calling the real endpoint', () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue([])
    setDemoMode(true)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })

    expect(result.current.data).toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE)
    expect(result.current.data!.length).toBeGreaterThanOrEqual(1)
    expect(result.current.data!.length).toBeLessThanOrEqual(2)
    expect(result.current.data!.every((e) => e.provenance === 'SELF_ATTESTED')).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('filters sample customer evidence by criterionId exactly as the real implementation expects', () => {
    setDemoMode(true)
    const targetCriterionId = DEMO_SOC2_CUSTOMER_EVIDENCE[0].criterionId
    const { result } = renderHook(() => useCustomerEvidenceList(targetCriterionId, true), { wrapper })

    const expected = DEMO_SOC2_CUSTOMER_EVIDENCE.filter((e) => e.criterionId === targetCriterionId)
    expect(result.current.data).toEqual(expected)
    expect(result.current.data!.every((e) => e.criterionId === targetCriterionId)).toBe(true)
  })

  it('demo data is never written into the real ["soc2-customer-evidence", ...] query cache entry', async () => {
    setDemoMode(true)
    renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => {
      expect(queryClient.getQueryData(['soc2-customer-evidence', null])).toBeUndefined()
    })
  })

  it('does not call the real endpoint even when the caller-supplied `enabled` (real-mode Enterprise gate) is true', () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue([])
    setDemoMode(true)
    renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    expect(spy).not.toHaveBeenCalled()
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

describe('useCustomerEvidenceList — demo ↔ real transition (D)', () => {
  it('DEMO ON shows demo data, DEMO OFF returns to real data, with no stale rows leaking either way', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))

    act(() => setDemoMode(true))
    await waitFor(() => expect(result.current.data).toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE))
    expect(result.current.data).not.toEqual(REAL_FIXTURE)

    act(() => setDemoMode(false))
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))
    expect(result.current.data).not.toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE)
    expect(spy).toHaveBeenCalled()
  })
})

describe('useCustomerEvidenceList — Sales Demo mode alone (A: demoMode=false, salesDemoMode=true)', () => {
  it('returns sample customer evidence, SELF_ATTESTED provenance, filtered by criterionId, never calling the real endpoint', () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue([])
    setDemoMode(false)
    setSalesDemo(true)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })

    expect(result.current.data).toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE)
    expect(result.current.data!.every((e) => e.provenance === 'SELF_ATTESTED')).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(spy).not.toHaveBeenCalled()

    const targetCriterionId = DEMO_SOC2_CUSTOMER_EVIDENCE[0].criterionId
    const filtered = renderHook(() => useCustomerEvidenceList(targetCriterionId, true), { wrapper })
    expect(filtered.result.current.data).toEqual(
      DEMO_SOC2_CUSTOMER_EVIDENCE.filter((e) => e.criterionId === targetCriterionId)
    )
  })
})

describe('useCustomerEvidenceList — Sales Demo mode ↔ real transition (D)', () => {
  it('Sales Demo ON shows sample data, Sales Demo OFF returns to real data, with no stale rows either way', async () => {
    const spy = vi.spyOn(soc2Service, 'getCustomerEvidence').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)
    setSalesDemo(false)

    const { result } = renderHook(() => useCustomerEvidenceList(undefined, true), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))

    act(() => setSalesDemo(true))
    await waitFor(() => expect(result.current.data).toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE))
    expect(result.current.data).not.toEqual(REAL_FIXTURE)

    act(() => setSalesDemo(false))
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))
    expect(result.current.data).not.toEqual(DEMO_SOC2_CUSTOMER_EVIDENCE)
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
