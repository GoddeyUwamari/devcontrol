/**
 * /ai-reports when the server refuses for the plan although the client thinks
 * Pro (a restricted or changed plan): the page's own gate naming the plan --
 * no longer a hard-coded "requires the Pro plan" banner -- for the history
 * read and for generating. Any other 402 is not a plan answer. Runs through
 * the real useAIReports hook and service (fetch stubbed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { renderWithKnownPlan } from '@/lib/contexts/__tests__/org-load-harness'
import { resourceLimitBody, tierRequiredBody } from '@/lib/plan/__tests__/tier-required-fixture'
import { toast } from 'sonner'
import AIReportsPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/ai-reports',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function stubReports(history: () => Response, generate: () => Response = () => json(500, { error: 'x' })) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = new URL(String(url)).pathname
    if (path === '/api/ai-reports/history') return history()
    if (path === '/api/ai-reports/generate') return generate()
    return json(404, {})
  }))
}
const CONTENT = /Generate executive-ready AI reports/

describe('/ai-reports: the server requires a higher plan', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(toast.error).mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('history 402 TIER_REQUIRED → the gate naming the plan, no banner', async () => {
    stubReports(() => json(402, tierRequiredBody('pro')))
    await renderWithKnownPlan(<AIReportsPage />, 'pro')
    expect(await screen.findByText('This feature is on Pro.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See plans' }).getAttribute('href')).toBe('/settings/billing/upgrade')
    expect(screen.queryByText('This feature requires the Pro plan.')).toBeNull()
    expect(screen.queryByText(CONTENT)).toBeNull()
  })

  it('history: another 402 → no gate and no plan banner', async () => {
    stubReports(() => json(402, resourceLimitBody()))
    await renderWithKnownPlan(<AIReportsPage />, 'pro')
    expect(await screen.findByText(CONTENT)).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByText(/This feature is on/)).toBeNull()
    expect(screen.queryByText('This feature requires the Pro plan.')).toBeNull()
  })

  it('generating refused for the plan → the gate, no failure toast', async () => {
    stubReports(() => json(200, { success: true, data: [] }), () => json(402, tierRequiredBody('pro')))
    await renderWithKnownPlan(<AIReportsPage />, 'pro')
    await screen.findByText(CONTENT)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Generate Executive Summary/ })) })
    expect(await screen.findByText('This feature is on Pro.')).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('generating: another 402 → the failure toast, no gate', async () => {
    stubReports(() => json(200, { success: true, data: [] }), () => json(402, resourceLimitBody()))
    await renderWithKnownPlan(<AIReportsPage />, 'pro')
    await screen.findByText(CONTENT)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Generate Executive Summary/ })) })
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to generate report'))
    expect(screen.queryByText(/This feature is on/)).toBeNull()
  })
})
