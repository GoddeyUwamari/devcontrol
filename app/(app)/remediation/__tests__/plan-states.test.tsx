/**
 * /remediation waits for a known plan: no gate while the organization loads
 * or fails, and the workflow list (and its 10 s poll) and the workflow
 * detail query only for a known Enterprise plan.
 */
import { useEffect } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { useAuth } from '@/lib/contexts/auth-context'
import { authService } from '@/lib/services/auth.service'
import {
  advanceToAutoRetry, describePlanStates, fakeOrgSources, flush, org, renderWithAuth, seedSession, WORKSPACE_ERROR,
} from '@/lib/contexts/__tests__/org-load-harness'

const list = vi.hoisted(() => vi.fn(async () => [] as unknown[]))
const get = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/remediation.service', () => ({
  remediationService: { list, get, approve: vi.fn(), reject: vi.fn(), execute: vi.fn(), rollback: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import RemediationPage from '../page'

describePlanStates('/remediation', {
  render: () => <RemediationPage />,
  entitledTier: 'enterprise',
  notEntitledTier: 'pro',
  reset: () => { list.mockClear(); get.mockClear() },
  paidCalls: () => list.mock.calls.length + get.mock.calls.length,
  content: /Approval-based infrastructure remediation/,
  gate: 'Upgrade to Enterprise',
})

const POLL_MS = 10_000
const WORKFLOW = {
  id: 'wf-1', organization_id: 'org-1', recommendation_id: null,
  resource_id: 'i-0abc', resource_type: 'ec2', action_type: 'stop_instance', action_params: {},
  estimated_savings: 12, risk_level: 'low', status: 'pending_approval',
  approved_by: null, approved_by_email: null, approved_by_name: null, approved_at: null,
  rejected_at: null, rejection_reason: null, executed_by: null, executed_by_email: null,
  executed_by_name: null, executed_at: null, completed_at: null, execution_log: null,
  rollback_available: false, rollback_snapshot_id: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', audit_log: [],
}

let auth: ReturnType<typeof useAuth>
function Capture() {
  const value = useAuth()
  useEffect(() => { auth = value })
  return null
}

describe('/remediation: no list, poll or detail request unless the plan is known Enterprise', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    list.mockReset()
    list.mockResolvedValue([WORKFLOW])
    get.mockReset()
    get.mockResolvedValue(WORKFLOW)
    seedSession()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const pollTwice = () => act(async () => { vi.advanceTimersByTime(POLL_MS * 2 + 500) })

  it('while loading, two poll intervals pass with no request', async () => {
    fakeOrgSources()
    renderWithAuth(<RemediationPage />)
    await flush()
    await pollTwice()
    expect(screen.getByTestId('plan-loading')).toBeTruthy()
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('while errored, two poll intervals pass with no request', async () => {
    const src = fakeOrgSources()
    renderWithAuth(<RemediationPage />)
    await flush()
    await src.failBoth(0)
    await advanceToAutoRetry()
    await src.failBoth(1)
    await screen.findByText(WORKSPACE_ERROR)
    await pollTwice()
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })

  it('once the plan goes back to loading, the open detail and the poll stop requesting', async () => {
    const src = fakeOrgSources()
    vi.spyOn(authService, 'logout').mockResolvedValue(undefined as never)
    renderWithAuth(<><Capture /><RemediationPage /></>)
    await flush()
    await src.orgsOk(0, [org('enterprise')])

    // Entitled: the list loads, a row opens its detail.
    fireEvent.click(await screen.findByText('i-0abc'))
    await act(async () => {})
    expect(get).toHaveBeenCalledTimes(1)

    // The identity ends; the page (still mounted) is back to "loading".
    await act(async () => { await auth.logout() })
    expect(screen.getByTestId('plan-loading')).toBeTruthy()
    const listCalls = list.mock.calls.length
    await pollTwice()
    expect(list).toHaveBeenCalledTimes(listCalls)
    expect(get).toHaveBeenCalledTimes(1)
  })
})
