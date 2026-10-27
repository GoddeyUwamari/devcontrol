/**
 * The Security Overview redesign's account-finding decisions (F2b): Acknowledge, Accept risk… and Dismiss through
 * the existing endpoints, the role rules of account-security-findings.routes.ts, the note dialog, and the failure
 * states. Success is only what the server confirms (the same finding with the requested decision); copy is pinned
 * to the founder's decisions (review log security-v2-f2/founder-decisions.md §1 decision 3, §2 e2 10–13, §7).
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return {
    h: { log: [] as string[], routes: {} as Record<string, unknown>, posts: [] as { path: string; body: unknown }[] },
    role: 'owner' as string | null,
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import SecurityOverviewV2 from '../overview/SecurityOverviewV2'
import { connectedRoutes, fail, failWith, installFetch, newClient, ok, renderWith, settled, FINDINGS, type Harness, type Route } from './security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('./security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => m.role }))
vi.mock('sonner', () => ({ toast: m.toast }))

const h = m.h as unknown as Harness & { posts: { path: string; body: unknown }[] }
Element.prototype.scrollIntoView = function scrollIntoView() {}

const LIST = 'GET /api/security/account-findings'
const BASE = '/api/security/account-findings/af-admin'
const ADMIN = 'account:af-admin'
const DESCRIPTION = 'This records your decision — it does not change anything in AWS. Only a future scan can mark it Verified Resolved.'
const SCORE_NOTE = "Accepting or dismissing records your decision. It doesn't change anything in AWS, and the score still counts this finding until a complete scan shows it's fixed."

/** The admin-port finding after the server applied a decision. */
const decided = (disposition: string, over: Record<string, unknown> = {}) => ({ ...FINDINGS[0], disposition, derived_status: disposition, ...over })
const withDecision = (disposition: string) => FINDINGS.map((f) => (f.id === 'af-admin' ? decided(disposition) : f))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.posts.length = 0
  h.routes = connectedRoutes()
  m.role = 'owner'
  m.toast.success.mockReset(); m.toast.error.mockReset()
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch(h)
  window.location.hash = ''
})

async function show(routes: Partial<Record<string, Route>> = {}) {
  Object.assign(h.routes, routes)
  const client = newClient()
  const utils = renderWith(client, <SecurityOverviewV2 />)
  await settled(client)
  return { ...utils, client }
}

const findings = () => document.getElementById('findings') as HTMLElement
const rowOf = (id: string) => findings().querySelector(`[data-row-id="${id}"]`) as HTMLElement
function expand(id: string) {
  const toggle = within(rowOf(id)).getByRole('button', { name: /^Show details for / })
  fireEvent.click(toggle)
  return document.getElementById(toggle.getAttribute('aria-controls')!)!
}
const button = (panel: HTMLElement, name: string) => within(panel).getByRole('button', { name })
const listReads = () => h.log.filter((l) => l === LIST).length
const statusOf = (id: string) => within(rowOf(id)).queryByTestId('security-row-status')?.textContent ?? null
const count = (key: string) => screen.getByTestId(`security-filter-${key}`).textContent
const deferred = () => {
  let release!: () => void
  const wait = new Promise<void>((r) => { release = r })
  return { wait, release }
}

describe('roles (decision 3; route rules)', () => {
  it.each(['owner', 'admin'])('%s: all three enabled, no reason', async (role) => {
    m.role = role
    await show()
    const panel = expand(ADMIN)
    for (const name of ['Acknowledge', 'Accept risk…', 'Dismiss']) expect(button(panel, name)).toBeEnabled()
    expect(panel).not.toHaveTextContent(/Admins only|Viewers can't change findings/)
  })
  it('member: Accept risk disabled with "Admins only" exposed as its description; Acknowledge and Dismiss enabled', async () => {
    m.role = 'member'
    await show()
    const panel = expand(ADMIN)
    expect(button(panel, 'Acknowledge')).toBeEnabled()
    expect(button(panel, 'Dismiss')).toBeEnabled()
    const accept = button(panel, 'Accept risk…')
    expect(accept).toBeDisabled()
    expect(accept).toHaveAccessibleDescription('Admins only')
    expect(within(panel).getByText('Admins only')).toBeVisible()
  })
  it('viewer: all three shown disabled, each described by "Viewers can\'t change findings"; nothing is sent', async () => {
    m.role = 'viewer'
    await show()
    const panel = expand(ADMIN)
    for (const name of ['Acknowledge', 'Accept risk…', 'Dismiss']) {
      expect(button(panel, name)).toBeDisabled()
      expect(button(panel, name)).toHaveAccessibleDescription("Viewers can't change findings")
      fireEvent.click(button(panel, name))
    }
    expect(within(panel).getAllByText("Viewers can't change findings")).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.posts).toEqual([])
  })
  it('unknown role (first render): fails closed, all three disabled', async () => {
    m.role = null
    await show()
    const panel = expand(ADMIN)
    for (const name of ['Acknowledge', 'Accept risk…', 'Dismiss']) expect(button(panel, name)).toBeDisabled()
  })
  it('D1: all three on every active account row, decided ones included', async () => {
    await show()
    for (const filter of ['all', 'accepted', 'dismissed']) {
      fireEvent.click(screen.getByTestId(`security-filter-${filter}`))
      for (const row of within(findings()).getAllByTestId('security-row').filter((r) => r.dataset.rowId!.startsWith('account:'))) {
        const panel = expand(row.dataset.rowId!)
        for (const name of ['Acknowledge', 'Accept risk…', 'Dismiss']) expect(button(panel, name)).toBeInTheDocument()
      }
    }
  })
})

describe('success: only after the server confirms, then a refetch', () => {
  it('Acknowledge: POST with {}, nothing shown while in flight, then the toast, the chip and a refetch', async () => {
    const d = deferred()
    await show({ [`POST ${BASE}/acknowledge`]: { ...ok(decided('acknowledged')) as object, wait: d.wait } as Route })
    const panel = expand(ADMIN)
    const reads = listReads()
    h.routes[LIST] = ok(withDecision('acknowledged'))
    fireEvent.click(button(panel, 'Acknowledge'))
    await waitFor(() => expect(h.posts).toEqual([{ path: `${BASE}/acknowledge`, body: {} }]))
    expect(button(panel, 'Acknowledge')).toBeDisabled()
    expect(m.toast.success).not.toHaveBeenCalled()
    expect(statusOf(ADMIN)).toBeNull()
    await act(async () => { d.release() })
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Finding acknowledged', { description: DESCRIPTION }))
    await waitFor(() => expect(listReads()).toBe(reads + 1))
    expect(statusOf(ADMIN)).toBe('Acknowledged')
    expect(m.toast.error).not.toHaveBeenCalled()
  })
  it('Dismiss: the dialog, the trimmed note in the body, then the chip and filter counts move', async () => {
    const d = deferred()
    await show({ [`POST ${BASE}/dismiss`]: { ...ok(decided('dismissed')) as object, wait: d.wait } as Route })
    expect(count('all')).toBe('All 4')
    expect(count('dismissed')).toBe('Dismissed 1')
    h.routes[LIST] = ok(withDecision('dismissed'))
    fireEvent.click(button(expand(ADMIN), 'Dismiss'))
    const dialog = screen.getByRole('dialog', { name: 'Dismiss finding' })
    const submit = within(dialog).getByRole('button', { name: 'Dismiss' })
    expect(submit).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: '   ' } })
    expect(submit).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: '  test-only reason  ' } })
    fireEvent.click(submit)
    await waitFor(() => expect(h.posts).toEqual([{ path: `${BASE}/dismiss`, body: { note: 'test-only reason' } }]))
    expect(m.toast.success).not.toHaveBeenCalled()
    expect(count('dismissed')).toBe('Dismissed 1')
    await act(async () => { d.release() })
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Finding dismissed', { description: DESCRIPTION }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(count('all')).toBe('All 3')
    expect(count('dismissed')).toBe('Dismissed 2')
  })
  it('Accept risk: the confirm button is "Accept risk"; then "Risk accepted" and the Accepted count', async () => {
    await show({ [`POST ${BASE}/accept-risk`]: ok(decided('accepted_risk')) })
    h.routes[LIST] = ok(withDecision('accepted_risk'))
    fireEvent.click(button(expand(ADMIN), 'Accept risk…'))
    const dialog = screen.getByRole('dialog', { name: 'Accept risk' })
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'test-only reason' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept risk' }))
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Risk accepted', { description: DESCRIPTION }))
    expect(h.posts).toEqual([{ path: `${BASE}/accept-risk`, body: { note: 'test-only reason' } }])
    expect(count('accepted')).toBe('Accepted 2')
  })
})

describe('failure: "Action failed" + a plain message, or "Action failed. Try again."; never a success', () => {
  async function acknowledgeWith(route: Route) {
    await show({ [`POST ${BASE}/acknowledge`]: route })
    const rows = within(findings()).getAllByTestId('security-row').length
    const reads = listReads()
    fireEvent.click(button(expand(ADMIN), 'Acknowledge'))
    await waitFor(() => expect(m.toast.error).toHaveBeenCalled())
    expect(m.toast.success).not.toHaveBeenCalled()
    expect(statusOf(ADMIN)).toBeNull()
    expect(within(findings()).getAllByTestId('security-row')).toHaveLength(rows)
    expect(listReads()).toBe(reads)
  }
  it('a 500 with no body', async () => {
    await acknowledgeWith(fail(500))
    expect(m.toast.error).toHaveBeenCalledWith('Action failed. Try again.', undefined)
  })
  it('a plain server message (D2): shown after "Action failed"', async () => {
    await acknowledgeWith(failWith(403, 'Insufficient permissions'))
    expect(m.toast.error).toHaveBeenCalledWith('Action failed', { description: 'Insufficient permissions' })
  })
  it('a server message not on the list: "Action failed. Try again."', async () => {
    await acknowledgeWith(failWith(500, 'Failed to acknowledged finding'))
    expect(m.toast.error).toHaveBeenCalledWith('Action failed. Try again.', undefined)
  })
  it('a 200 whose finding has another decision is not a success', async () => {
    await acknowledgeWith(ok(decided('dismissed')))
    expect(m.toast.error).toHaveBeenCalledWith('Action failed. Try again.', undefined)
    expect(count('dismissed')).toBe('Dismissed 1')
  })
  it('a 200 for another finding is not a success', async () => {
    await acknowledgeWith(ok(decided('acknowledged', { id: 'af-other' })))
    expect(m.toast.error).toHaveBeenCalledWith('Action failed. Try again.', undefined)
  })
  it('a 200 with success:false is not a success', async () => {
    await acknowledgeWith({ status: 200, body: { success: false, error: 'Finding not found' } })
    expect(m.toast.error).toHaveBeenCalledWith('Action failed. Try again.', undefined)
  })

  it('Dismiss failing: the dialog stays open with the reason kept and the failure inside it; counts unchanged', async () => {
    await show({ [`POST ${BASE}/dismiss`]: failWith(409, 'This finding is already verified resolved and cannot be dispositioned') })
    fireEvent.click(button(expand(ADMIN), 'Dismiss'))
    const dialog = screen.getByRole('dialog', { name: 'Dismiss finding' })
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'test-only reason' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Dismiss' }))
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Action failed')
    expect(alert).toHaveTextContent('This finding is already verified resolved and cannot be dispositioned')
    expect(screen.getByRole('dialog', { name: 'Dismiss finding' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Reason (required)')).toHaveValue('test-only reason')
    expect(m.toast.success).not.toHaveBeenCalled()
    expect(count('all')).toBe('All 4')
    expect(count('dismissed')).toBe('Dismissed 1')
  })
  it('Accept risk failing with an unlisted message: "Action failed. Try again." in the dialog', async () => {
    await show({ [`POST ${BASE}/accept-risk`]: failWith(500, 'Failed to accept risk for finding') })
    fireEvent.click(button(expand(ADMIN), 'Accept risk…'))
    const dialog = screen.getByRole('dialog', { name: 'Accept risk' })
    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'test-only reason' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept risk' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Action failed\. Try again\.$/)
    expect(m.toast.success).not.toHaveBeenCalled()
    expect(count('accepted')).toBe('Accepted 1')
  })
})

describe('the note dialog (e2 10; S1, S2, D3; accessibility)', () => {
  it('legacy title, the mock\'s score note in place of the legacy AWS sentence, a visible label and the hint', async () => {
    await show()
    fireEvent.click(button(expand(ADMIN), 'Dismiss'))
    const dialog = screen.getByRole('dialog', { name: 'Dismiss finding' })
    expect(dialog).toHaveAccessibleDescription(`${SCORE_NOTE} A justification is required.`)
    expect(dialog.textContent!.match(/change anything in AWS/g)).toHaveLength(1)
    expect(within(dialog).getByText('Reason (required)').tagName).toBe('LABEL')
    expect(within(dialog).getByLabelText('Reason (required)')).toHaveAttribute('placeholder', 'Why? (required)')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })
  it('focus moves in, Tab stays inside, Esc closes and focus returns to the button that opened it', async () => {
    await show()
    const opener = button(expand(ADMIN), 'Accept risk…')
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Accept risk' })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    const tabbables = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), textarea')]
    tabbables[tabbables.length - 1].focus()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })
  it('Cancel also returns focus to the opener, and sends nothing', async () => {
    await show()
    const opener = button(expand(ADMIN), 'Dismiss')
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(h.posts).toEqual([])
  })
})
