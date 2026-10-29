/**
 * /remediation when the server refuses for the plan although the client
 * thinks Enterprise (a restricted or changed plan): the page's own gate
 * naming the plan, for the list, the detail and the actions -- never an
 * empty list -- and the 10 s poll stops. Any other failure shows
 * "Couldn't load workflows." with Try again, never an empty list or zero
 * counts. Runs through the real remediation service (axios stubbed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithKnownPlan } from '@/lib/contexts/__tests__/org-load-harness'
import { axiosError, resourceLimitBody, tierRequiredBody } from '@/lib/plan/__tests__/tier-required-fixture'
import RemediationPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/remediation',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const POLL_MS = 10_000
const WORKFLOW = {
  id: 'wf-1', organization_id: 'org-1', recommendation_id: null,
  resource_id: 'i-0abc', resource_type: 'ec2', action_type: 'stop_instance', action_params: {},
  estimated_savings: 12, risk_level: 'low', status: 'pending_approval',
  approved_by: null, approved_by_email: null, approved_by_name: null, approved_at: null,
  rejected_at: null, rejection_reason: null, executed_by: null, executed_by_email: null,
  executed_by_name: null, executed_at: null, completed_at: null, execution_log: null,
  rollback_available: false, rollback_snapshot_id: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
}

const ok = (data: unknown) => ({ data: { success: true, data } })
let listCalls = 0
let detailCalls = 0

/** list answers GET /api/remediation, detail answers GET /api/remediation/:id. */
function stubRemediation(list: () => unknown, detail: () => unknown = () => ok(WORKFLOW)) {
  listCalls = 0
  detailCalls = 0
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (/^\/api\/remediation\/[^/?]+$/.test(url)) {
      detailCalls += 1
      return detail() as never
    }
    if (url.startsWith('/api/remediation')) {
      listCalls += 1
      return list() as never
    }
    throw new Error(`unexpected ${url}`)
  })
}
const reject = (err: unknown) => () => { throw err }

const expectPlanGate = (planName: string) => {
  expect(screen.getByText(`This feature is on the ${planName} plan.`)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'See plans' }).getAttribute('href')).toBe('/settings/billing/upgrade')
  expect(screen.queryByText('No workflows yet')).toBeNull()
  expect(screen.queryByText('Pending Approval')).toBeNull()
  expect(screen.queryByText("Couldn't load workflows.")).toBeNull()
}

describe('/remediation: plan refusals and failed reads', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const pollTwice = () => act(async () => { vi.advanceTimersByTime(POLL_MS * 2 + 500) })

  it('list 402 TIER_REQUIRED → the gate, not an empty list; the poll stops', async () => {
    stubRemediation(reject(axiosError(402, tierRequiredBody('enterprise'))))
    await renderWithKnownPlan(<RemediationPage />, 'enterprise')
    await screen.findByText('This feature is on the Revenue Protection plan.')
    expectPlanGate('Revenue Protection')
    expect(listCalls).toBe(1)
    await pollTwice()
    expect(listCalls).toBe(1)
  })

  it('list 500 → "Couldn\'t load workflows." with Try again, never an empty list or zero counts; Try again recovers', async () => {
    let fail = true
    stubRemediation(() => {
      if (fail) throw axiosError(500, { success: false, error: 'Failed to list workflows' })
      return ok([WORKFLOW])
    })
    await renderWithKnownPlan(<RemediationPage />, 'enterprise')
    expect(await screen.findByText("Couldn't load workflows.")).toBeTruthy()
    expect(screen.queryByText('No workflows yet')).toBeNull()
    expect(screen.queryByText('Pending Approval')).toBeNull()
    expect(screen.queryByText(/This feature is on/)).toBeNull()

    fail = false
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    expect(await screen.findByText('i-0abc')).toBeTruthy()
    expect(screen.queryByText("Couldn't load workflows.")).toBeNull()
  })

  it('another 402 → "Couldn\'t load workflows.", never the gate', async () => {
    stubRemediation(reject(axiosError(402, resourceLimitBody())))
    await renderWithKnownPlan(<RemediationPage />, 'enterprise')
    expect(await screen.findByText("Couldn't load workflows.")).toBeTruthy()
    expect(screen.queryByText(/This feature is on/)).toBeNull()
  })

  it('detail 402 TIER_REQUIRED → the gate', async () => {
    stubRemediation(() => ok([WORKFLOW]), reject(axiosError(402, tierRequiredBody('enterprise'))))
    await renderWithKnownPlan(<RemediationPage />, 'enterprise')
    fireEvent.click(await screen.findByText('i-0abc'))
    await screen.findByText('This feature is on the Revenue Protection plan.')
    expectPlanGate('Revenue Protection')
    expect(detailCalls).toBe(1)
  })

  it('detail 500 → "Couldn\'t load workflows." in the panel with Try again; no gate', async () => {
    let fail = true
    stubRemediation(() => ok([WORKFLOW]), () => {
      if (fail) throw axiosError(500, { success: false })
      return ok(WORKFLOW)
    })
    await renderWithKnownPlan(<RemediationPage />, 'enterprise')
    fireEvent.click(await screen.findByText('i-0abc'))
    expect(await screen.findByText("Couldn't load workflows.")).toBeTruthy()
    expect(screen.getByText('Remediation Workflow')).toBeTruthy()
    expect(screen.queryByText(/This feature is on/)).toBeNull()

    fail = false
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })) })
    await act(async () => {})
    expect(screen.queryByText("Couldn't load workflows.")).toBeNull()
    expect(detailCalls).toBe(2)
  })

  it('an action refused for the plan → the gate', async () => {
    stubRemediation(() => ok([WORKFLOW]))
    vi.spyOn(api, 'post').mockRejectedValue(axiosError(402, tierRequiredBody('enterprise')))
    await renderWithKnownPlan(<RemediationPage />, 'enterprise')
    fireEvent.click(await screen.findByText('i-0abc'))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Approve' })) })
    await screen.findByText('This feature is on the Revenue Protection plan.')
    expectPlanGate('Revenue Protection')
  })
})
