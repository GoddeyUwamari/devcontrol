/**
 * /remediation shows why an action failed (FP PR 2a, founder decision U2):
 * the server's own fixed message for a refused Approve/Execute -- a refused
 * stop, or the dry-run kill-switch -- in an alert in the workflow panel, or a
 * fallback line when the response carries none. Nothing is hidden or
 * disabled: the buttons stay. Runs through the real remediation service
 * (axios stubbed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithKnownPlan } from '@/lib/contexts/__tests__/org-load-harness'
import { axiosError } from '@/lib/plan/__tests__/tier-required-fixture'
import RemediationPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/remediation',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const STOP_REFUSAL =
  "DevControl can't stop this instance. Stopping is only offered for low-activity findings confirmed by DevControl's current checks, and this one isn't. No change was made in AWS."
const FALLBACK = "This action couldn't be completed. Refresh to check the workflow's status."

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

function stubWorkflow(workflow: Record<string, unknown>) {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (/^\/api\/remediation\/[^/?]+$/.test(url)) return ok(workflow) as never
    if (url.startsWith('/api/remediation')) return ok([workflow]) as never
    throw new Error(`unexpected ${url}`)
  })
}

async function openAndPress(button: string) {
  await renderWithKnownPlan(<RemediationPage />, 'enterprise')
  fireEvent.click(await screen.findByText('i-0abc'))
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: button })) })
}

describe('/remediation: a failed action says why', () => {
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

  it('a refused Approve shows the server\'s stop refusal; Approve and Reject are still there', async () => {
    stubWorkflow(WORKFLOW)
    vi.spyOn(api, 'post').mockRejectedValue(axiosError(403, { success: false, error: STOP_REFUSAL }))

    await openAndPress('Approve')

    expect((await screen.findByRole('alert')).textContent).toBe(STOP_REFUSAL)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy()
  })

  it('a refused Execute shows the server\'s message (here the dry-run refusal, silent before); Execute is still there', async () => {
    const dryRun = 'DRY_RUN_MODE: Automated remediation is disabled. No AWS action was taken.'
    stubWorkflow({ ...WORKFLOW, status: 'approved' })
    vi.spyOn(api, 'post').mockRejectedValue(axiosError(400, { success: false, error: dryRun }))

    await openAndPress('Execute on AWS')

    expect((await screen.findByRole('alert')).textContent).toBe(dryRun)
    expect(screen.getByRole('button', { name: 'Execute on AWS' })).toBeTruthy()
  })

  it.each([
    ['no message in the response', axiosError(500, { success: false })],
    ['an empty message', axiosError(403, { success: false, error: '' })],
    ['no response at all (network)', new Error('Network Error')],
  ])('%s: the fallback line', async (_label, err) => {
    stubWorkflow(WORKFLOW)
    vi.spyOn(api, 'post').mockRejectedValue(err)

    await openAndPress('Approve')

    expect((await screen.findByRole('alert')).textContent).toBe(FALLBACK)
  })

  it('no alert before any action, and none after a successful one', async () => {
    stubWorkflow(WORKFLOW)
    vi.spyOn(api, 'post').mockResolvedValue(ok({ ...WORKFLOW, status: 'approved' }) as never)

    await renderWithKnownPlan(<RemediationPage />, 'enterprise')
    fireEvent.click(await screen.findByText('i-0abc'))
    await screen.findByRole('button', { name: 'Approve' })
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the next attempt clears the previous message', async () => {
    stubWorkflow(WORKFLOW)
    const post = vi.spyOn(api, 'post')
      .mockRejectedValueOnce(axiosError(403, { success: false, error: STOP_REFUSAL }))
      .mockReturnValueOnce(new Promise(() => {}) as never)

    await openAndPress('Approve')
    await screen.findByRole('alert')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Approve' })) })

    expect(post).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('the message shows only on the panel of the workflow it was about, not on another', async () => {
    const other = { ...WORKFLOW, id: 'wf-2', resource_id: 'i-0def' }
    vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
      const detail = url.match(/^\/api\/remediation\/([^/?]+)$/)
      if (detail) return ok(detail[1] === 'wf-2' ? other : WORKFLOW) as never
      if (url.startsWith('/api/remediation')) return ok([WORKFLOW, other]) as never
      throw new Error(`unexpected ${url}`)
    })
    vi.spyOn(api, 'post').mockRejectedValue(axiosError(403, { success: false, error: STOP_REFUSAL }))

    await openAndPress('Approve')
    expect((await screen.findByRole('alert')).textContent).toBe(STOP_REFUSAL)

    // Switch to the other workflow: its panel shows no message.
    await act(async () => { fireEvent.click(screen.getAllByText('i-0def')[0]) })
    // The panel now shows wf-2 (its resource id appears in the list and in the panel).
    await waitFor(() => expect(screen.getAllByText('i-0def').length).toBeGreaterThan(1))
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
