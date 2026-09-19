/**
 * Demo-mode coverage for useSoc2Readiness() / useSoc2Evidence() (SOC 2 demo mode
 * implementation). Exercises the REAL useDemoMode() hook (real localStorage +
 * 'demo-mode-changed' event, jsdom provides both) rather than mocking it, so the
 * reactive toggle behavior is genuinely proven, not assumed. soc2Service's real
 * methods are spied on (never actually invoked over the network) so "no real request
 * is made" assertions are meaningful.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { soc2Service, Soc2ReadinessCriterion } from '@/lib/services/soc2.service'
import { useSoc2Readiness, useSoc2Evidence } from '../useSoc2Readiness'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'
import { DEMO_SOC2_READINESS, DEMO_SOC2_OBSERVATIONS } from '@/lib/demo-data/soc2-demo-data'

const DEMO_MODE_KEY = 'devcontrol_demo_mode'

function setDemoMode(enabled: boolean) {
  localStorage.setItem(DEMO_MODE_KEY, enabled ? 'true' : 'false')
  window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled } }))
}

// useSalesDemo is a real, persisted Zustand store (see lib/demo/sales-demo-data.ts) --
// independent of devcontrol_demo_mode/useDemoMode() entirely. Manipulated directly via
// its own setState, exactly the store's own public API, rather than mocked, so this
// suite proves the real reactive composition (isDemoActive = demoMode || salesDemoMode)
// actually works end to end.
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

const REAL_FIXTURE: Soc2ReadinessCriterion[] = [
  { criterionId: 'CC6.1', name: 'real name', evidenceClaim: 'real claim', limitation: 'real limitation', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null },
]

describe('useSoc2Readiness — demo mode (A: demo readiness)', () => {
  it('returns all six sample criteria, isLoading false, error null, when demo mode is active', () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([])
    setDemoMode(true)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })

    expect(result.current.data).toEqual(DEMO_SOC2_READINESS)
    expect(result.current.data).toHaveLength(6)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('demo sample data is never written into the real ["soc2-readiness"] query cache entry', async () => {
    setDemoMode(true)
    renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => {
      expect(queryClient.getQueryData(['soc2-readiness'])).toBeUndefined()
    })
  })
})

describe('useSoc2Evidence — demo mode (B: demo observations)', () => {
  it('returns sample observations filtered by criterionId, never calling the real evidence endpoint', () => {
    const spy = vi.spyOn(soc2Service, 'getEvidence').mockResolvedValue([])
    setDemoMode(true)

    const { result } = renderHook(() => useSoc2Evidence('CC6.1'), { wrapper })

    const expected = DEMO_SOC2_OBSERVATIONS.filter((o) => o.criterionId === 'CC6.1')
    expect(expected.length).toBeGreaterThan(0)
    expect(result.current.data).toEqual(expected)
    expect(result.current.data!.every((o) => o.criterionId === 'CC6.1')).toBe(true)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns all sample observations when no criterionId is given', () => {
    setDemoMode(true)
    const { result } = renderHook(() => useSoc2Evidence(), { wrapper })
    expect(result.current.data).toEqual(DEMO_SOC2_OBSERVATIONS)
  })

  it('demo data is never written into the real ["soc2-evidence", ...] query cache entry', async () => {
    setDemoMode(true)
    renderHook(() => useSoc2Evidence('CC6.1'), { wrapper })
    await waitFor(() => {
      expect(queryClient.getQueryData(['soc2-evidence', 'CC6.1'])).toBeUndefined()
    })
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

describe('useSoc2Readiness — demo ↔ real transition (D)', () => {
  it('DEMO ON shows demo data, DEMO OFF returns to real data, with no stale rows from either side leaking into the other', async () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))

    act(() => setDemoMode(true))
    await waitFor(() => expect(result.current.data).toEqual(DEMO_SOC2_READINESS))
    expect(result.current.data).not.toEqual(REAL_FIXTURE)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()

    act(() => setDemoMode(false))
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))
    expect(result.current.data).not.toEqual(DEMO_SOC2_READINESS)
    expect(spy).toHaveBeenCalled()
  })
})

describe('useSoc2Readiness / useSoc2Evidence — Sales Demo mode alone (A: demoMode=false, salesDemoMode=true)', () => {
  it('useSoc2Readiness returns sample data, isLoading false, error null, and never calls the real endpoint', () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([])
    setDemoMode(false)
    setSalesDemo(true)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })

    expect(result.current.data).toEqual(DEMO_SOC2_READINESS)
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('useSoc2Evidence returns sample observations filtered by criterionId, and never calls the real endpoint', () => {
    const spy = vi.spyOn(soc2Service, 'getEvidence').mockResolvedValue([])
    setDemoMode(false)
    setSalesDemo(true)

    const { result } = renderHook(() => useSoc2Evidence('CC6.1'), { wrapper })

    const expected = DEMO_SOC2_OBSERVATIONS.filter((o) => o.criterionId === 'CC6.1')
    expect(result.current.data).toEqual(expected)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('useSoc2Readiness — Sales Demo mode ↔ real transition (D)', () => {
  it('Sales Demo ON shows sample data, Sales Demo OFF returns to real data, with no stale rows either way', async () => {
    const spy = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(REAL_FIXTURE)
    setDemoMode(false)
    setSalesDemo(false)

    const { result } = renderHook(() => useSoc2Readiness(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))

    act(() => setSalesDemo(true))
    await waitFor(() => expect(result.current.data).toEqual(DEMO_SOC2_READINESS))
    expect(result.current.data).not.toEqual(REAL_FIXTURE)

    act(() => setSalesDemo(false))
    await waitFor(() => expect(result.current.data).toEqual(REAL_FIXTURE))
    expect(result.current.data).not.toEqual(DEMO_SOC2_READINESS)
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
