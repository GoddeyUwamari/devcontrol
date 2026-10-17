/**
 * Demo mode is switched off for everyone. These cases set both legacy demo flags
 * exactly as the old /demo page and avatar menu did (real localStorage +
 * 'demo-mode-changed' event, and the persisted 'sales-demo-mode' store shape) and
 * prove useSoc2Readiness() / useSoc2Evidence() ignore them: the real endpoint is
 * called and real rows come back, never the SOC 2 sample data. soc2Service's real
 * methods are spied on (never actually invoked over the network).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { soc2Service, Soc2ReadinessCriterion } from '@/lib/services/soc2.service'
import { useSoc2Readiness, useSoc2Evidence } from '../useSoc2Readiness'
import { DEMO_SOC2_READINESS, DEMO_SOC2_OBSERVATIONS } from '@/lib/demo-data/soc2-demo-data'

// useSoc2Readiness keys its query by the current organization and waits for it, so
// these hook-level tests supply one (no AuthProvider/network needed).
const TEST_ORG_ID = 'org-test'
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-test' } }),
}))

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

const REAL_FIXTURE: Soc2ReadinessCriterion[] = [
  { criterionId: 'CC6.1', name: 'real name', evidenceClaim: 'real claim', limitation: 'real limitation', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null },
]

describe('useSoc2Readiness — demo flag set (A: ignored)', () => {
  it('still calls the real endpoint and returns real criteria, never the six samples', async () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(true)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(result.current.data).not.toEqual(DEMO_SOC2_READINESS)
  })

  it('the real ["soc2-readiness", orgId] cache entry holds real rows, never sample rows', async () => {
    vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(true)
    renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => {
      expect(queryClient.getQueryData(['soc2-readiness', TEST_ORG_ID])).toEqual(REAL_FIXTURE)
    })
  })
})

describe('useSoc2Evidence — demo flag set (B: ignored)', () => {
  it('calls the real evidence endpoint for the criterion and caches real rows, never sample observations', async () => {
    const spy = vi.spyOn(soc2Service, 'getEvidence').mockResolvedValue([])
    setDemoMode(true)

    const { result } = renderHook(() => useSoc2Evidence('CC6.1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledWith('CC6.1')
    expect(result.current.data).toEqual([])
    expect(queryClient.getQueryData(['soc2-evidence', 'CC6.1'])).toEqual([])
  })

  it('with no criterionId, calls the real evidence endpoint, never returning all sample observations', async () => {
    const spy = vi.spyOn(soc2Service, 'getEvidence').mockResolvedValue([])
    setDemoMode(true)
    const { result } = renderHook(() => useSoc2Evidence(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(spy).toHaveBeenCalledWith(undefined)
    expect(result.current.data).not.toEqual(DEMO_SOC2_OBSERVATIONS)
  })
})

describe('useSoc2Readiness — real mode (E: real mode regression)', () => {
  it('calls the real endpoint and preserves the exact response mapping when demo mode is off', async () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(result.current.data).not.toEqual(DEMO_SOC2_READINESS)
  })
})

describe('useSoc2Readiness — demo flag toggled mid-session (D: ignored)', () => {
  it('turning the demo flag on and off never swaps the real rows for sample rows', async () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))

    act(() => setDemoMode(true))
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(result.current.data).not.toEqual(DEMO_SOC2_READINESS)

    act(() => setDemoMode(false))
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(spy).toHaveBeenCalled()
  })
})

describe('useSoc2Readiness / useSoc2Evidence — Sales Demo flag set after load (A: ignored at render time)', () => {
  it('the flag is ignored at render time: useSoc2Readiness calls the real endpoint and returns real criteria', async () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)
    setSalesDemo(true)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(result.current.data).not.toEqual(DEMO_SOC2_READINESS)
  })

  it('the flag is ignored at render time: useSoc2Evidence calls the real evidence endpoint for the criterion', async () => {
    const spy = vi.spyOn(soc2Service, 'getEvidence').mockResolvedValue([])
    setDemoMode(false)
    setSalesDemo(true)

    const { result } = renderHook(() => useSoc2Evidence('CC6.1'), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledWith('CC6.1')
    expect(result.current.data).toEqual([])
  })
})

describe('useSoc2Readiness — Sales Demo flag toggled mid-session (D: ignored at render time)', () => {
  it('the flag is ignored at render time: turning it on and off never swaps the real rows for sample rows', async () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)
    setSalesDemo(false)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))

    act(() => setSalesDemo(true))
    expect(result.current.data).toEqual(REAL_FIXTURE)

    act(() => setSalesDemo(false))
    expect(result.current.data).toEqual(REAL_FIXTURE)
    expect(spy).toHaveBeenCalled()
  })
})

describe('useSoc2Readiness — both flags false (C: real API behavior unchanged)', () => {
  it('demoMode=false, salesDemoMode=false calls the real endpoint exactly as before', async () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)
    setSalesDemo(false)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(result.current.data).toEqual(REAL_FIXTURE)
  })
})
