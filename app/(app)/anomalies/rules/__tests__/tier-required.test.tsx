/**
 * /anomalies/rules when the server refuses for the plan although the client thinks
 * Enterprise (a restricted or changed plan): the page's own gate naming the
 * plan, never the failure toast or the "No custom rules yet" empty state.
 * Any other failure keeps its toast (its fall-through to the empty state is a
 * separate, known issue -- not asserted here).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithKnownPlan } from '@/lib/contexts/__tests__/org-load-harness'
import { axiosError, resourceLimitBody, tierRequiredBody } from '@/lib/plan/__tests__/tier-required-fixture'
import { toast } from 'sonner'
import Page from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/anomalies/rules',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const GATED = '/api/anomaly-rules'

/** The gated read answers with `gated`; any other read is empty. */
function stubApi(gated: () => unknown) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url.startsWith(GATED)) return gated() as never
    return { data: { success: true, data: [] } } as never
  })
}
const reject = (err: unknown) => () => { throw err }

describe('/anomalies/rules: the server requires a higher plan', () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear()
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('402 TIER_REQUIRED → the gate naming the plan, not the failure state', async () => {
    stubApi(reject(axiosError(402, tierRequiredBody('enterprise'))))
    await renderWithKnownPlan(<Page />, 'enterprise')
    expect(await screen.findByText('This feature is on the Revenue Protection plan.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See plans' }).getAttribute('href')).toBe('/settings/billing/upgrade')
    expect(screen.queryByText('No custom rules yet')).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it.each([
    ['another 402', axiosError(402, resourceLimitBody())],
    ['a 500', axiosError(500, { success: false })],
  ])('%s keeps the failure state, never the gate', async (_label, err) => {
    stubApi(reject(err))
    await renderWithKnownPlan(<Page />, 'enterprise')
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to load rules'))
    expect(screen.queryByText(/This feature is on/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  })
})
