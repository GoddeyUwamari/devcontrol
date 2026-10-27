/**
 * Security V2 F3a: compliance evaluations started in place from the framework panel, with the existing
 * POST /api/compliance-frameworks/:id/scan, rendered from responses at the HTTP boundary. Wording and rules
 * are pinned to review-logs/security-v2-f3/founder-decisions.md (Part A, D1, D5, and the F3a follow-up
 * answers). Polling with timers: security-v2-evaluate-polling.test.tsx.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return {
    h: { log: [] as string[], routes: {} as Record<string, unknown>, posts: [] as { path: string; body: unknown }[] },
    role: 'owner' as string | null,
  }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { QueryClient } from '@tanstack/react-query'
import SecurityOverviewV2 from '../overview/SecurityOverviewV2'
import {
  SCANS_PATH, connectedRoutes, failWith, installFetch, newClient, ok, renderWith, scan, settled, type Harness, type Route,
} from './security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('./security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => m.role }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const h = m.h as unknown as Required<Harness>
Element.prototype.scrollIntoView = function scrollIntoView() {}

const DAY = 86_400_000
const START = 'POST /api/compliance-frameworks/fw-1/scan'
const RUNNING_TEXT = 'Started today, 3:00 PM UTC. The previous result is hidden until this run finishes.'
const STALE = scan('s-old', 'fw-1', 'completed', '90', 9 * DAY)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.posts.length = 0
  h.routes = { ...connectedRoutes(), [`GET ${SCANS_PATH}`]: ok([STALE]) }
  m.role = 'owner'
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch(h)
})

async function show(routes: Partial<Record<string, Route>> = {}) {
  Object.assign(h.routes, routes)
  const client = newClient()
  renderWith(client, <SecurityOverviewV2 />)
  await settled(client)
  return client
}

const row = () => screen.getByTestId('security-framework')
const startPosts = () => h.posts.filter((p) => p.path === '/api/compliance-frameworks/fw-1/scan')
/** A response held open until `release()`. */
function held(route: Route) {
  let release!: () => void
  const wait = new Promise<void>((resolve) => { release = resolve })
  return { route: { ...(route as object), wait } as Route, release }
}
async function refetch(client: QueryClient) {
  await act(async () => { await client.refetchQueries() })
  await settled(client)
}

describe('a start in place (Part A)', () => {
  it('posts once to the existing endpoint; Running hides the previous result; the next read shows Current', async () => {
    const post = held(ok({ scanId: 's-new' }))
    const client = await show({ [START]: post.route })
    expect(row()).toHaveAttribute('data-state', 'out_of_date')
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))

    // In flight: disabled and busy, and a second click sends nothing.
    const button = within(row()).getByRole('button', { name: 'Re-evaluate now' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(startPosts()).toEqual([{ path: '/api/compliance-frameworks/fw-1/scan', body: {} }])

    // A 200 is "started", never "completed": Running until the list says otherwise.
    h.routes[`GET ${SCANS_PATH}`] = ok([scan('s-new', 'fw-1', 'pending', null, 0), STALE])
    await act(async () => { post.release() })
    await settled(client)
    expect(row()).toHaveAttribute('data-state', 'running')
    expect(row()).toHaveTextContent(RUNNING_TEXT)
    expect(row()).not.toHaveTextContent('%')
    expect(row()).not.toHaveTextContent('Last evaluated')
    expect(within(row()).queryByRole('button')).toBeNull()

    h.routes[`GET ${SCANS_PATH}`] = ok([scan('s-new', 'fw-1', 'completed', '0.00', 0), STALE])
    await refetch(client)
    expect(row()).toHaveAttribute('data-state', 'current')
    expect(row()).toHaveTextContent('Evaluated Oct 23 · 90%')
    expect(startPosts()).toHaveLength(1)
  })

  it('a 200 shows Running even before the list has the new run', async () => {
    const client = await show({ [START]: ok({ scanId: 's-new' }) })
    const reads = h.log.filter((l) => l === `GET ${SCANS_PATH}`).length
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    // After the list was read again without the new run.
    await waitFor(() => expect(h.log.filter((l) => l === `GET ${SCANS_PATH}`).length).toBe(reads + 1))
    await settled(client)
    expect(row()).toHaveAttribute('data-state', 'running')
    expect(row()).toHaveTextContent(RUNNING_TEXT)
    expect(row()).not.toHaveTextContent('Last evaluated')
  })

  it.each([
    ['Try again', [scan('s-f', 'fw-1', 'failed', null, DAY)]],
    ['Evaluate now', []],
  ])('"%s" posts too', async (label, scans) => {
    const client = await show({ [`GET ${SCANS_PATH}`]: ok(scans), [START]: ok({ scanId: 's-new' }) })
    fireEvent.click(within(row()).getByRole('button', { name: label as string }))
    await waitFor(() => expect(row()).toHaveAttribute('data-state', 'running'))
    await settled(client)
    expect(startPosts()).toHaveLength(1)
  })

  it('a failed retry after an earlier success: Failed, with no score anywhere in the row', async () => {
    const client = await show({ [START]: ok({ scanId: 's-new' }) })
    h.routes[`GET ${SCANS_PATH}`] = ok([scan('s-new', 'fw-1', 'failed', null, 0), STALE])
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(row()).toHaveAttribute('data-state', 'failed'))
    await settled(client)
    expect(row()).toHaveTextContent('The last run failed on Oct 23. No score is shown as current.')
    expect(row()).not.toHaveTextContent('%')
    expect(screen.getByTestId('security-tile-compliance')).toHaveTextContent('Failed')
  })
})

describe('409: a run is already active (D5)', () => {
  it('shows Running, never "Couldn\'t start", and reads the list again', async () => {
    const client = await show({ [START]: failWith(409, 'SCAN_IN_PROGRESS') })
    const refresh = held(ok([scan('s-run', 'fw-1', 'running', null, 60_000), STALE]))
    h.routes[`GET ${SCANS_PATH}`] = refresh.route
    const reads = h.log.filter((l) => l === `GET ${SCANS_PATH}`).length
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(row()).toHaveAttribute('data-state', 'running'))
    expect(row()).not.toHaveTextContent("Couldn't start the evaluation. Try again.")
    await act(async () => { refresh.release() })
    await settled(client)
    expect(h.log.filter((l) => l === `GET ${SCANS_PATH}`).length).toBe(reads + 1)
    expect(row()).toHaveAttribute('data-state', 'running')
    expect(row()).toHaveTextContent('Started today, 2:59 PM UTC.')
  })
  it('when the refreshed list shows no active run, the list is the truth again', async () => {
    const client = await show({ [START]: failWith(409, 'SCAN_IN_PROGRESS') })
    const reads = h.log.filter((l) => l === `GET ${SCANS_PATH}`).length
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(h.log.filter((l) => l === `GET ${SCANS_PATH}`).length).toBe(reads + 1))
    await settled(client)
    await waitFor(() => expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled())
    expect(row()).toHaveAttribute('data-state', 'out_of_date')
  })
})

describe('a start that didn\'t happen keeps the previous state', () => {
  it.each([
    [500, "Couldn't start the evaluation. Try again."],
    [404, "Couldn't start the evaluation. Try again."],
    [403, "Viewers can't start an evaluation"],
  ])('%i → %s', async (status, text) => {
    const client = await show({ [START]: failWith(status, 'Failed to execute scan') })
    const before = row().textContent
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(row()).toHaveTextContent(text))
    await settled(client)
    expect(row()).toHaveAttribute('data-state', 'out_of_date')
    expect(row()).not.toHaveTextContent('Started')
    expect(row()).toHaveTextContent(text)
    expect(row()).not.toHaveTextContent('Failed to execute scan')
    expect(row().textContent).toBe(`${before}${text}`)
    // The action is still there to try again.
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled()
  })
  it('402 → the Enterprise plan sentence, then "See plans" to the upgrade page', async () => {
    const client = await show({ [START]: failWith(402, 'TIER_REQUIRED') })
    const before = row().textContent
    expect(within(row()).queryByRole('link', { name: 'See plans' })).toBeNull()
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(row()).toHaveTextContent('Compliance frameworks are on the Enterprise plan.'))
    await settled(client)
    expect(row()).toHaveAttribute('data-state', 'out_of_date')
    expect(row().textContent).toBe(`${before}Compliance frameworks are on the Enterprise plan.See plans`)
    expect(within(row()).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled()
  })
  it('only a 402 shows "See plans"', async () => {
    await show({ [START]: failWith(500, 'Failed to execute scan') })
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(row()).toHaveTextContent("Couldn't start the evaluation. Try again."))
    expect(within(row()).queryByRole('link', { name: 'See plans' })).toBeNull()
  })
  it('a network error (no response) is a failed start', async () => {
    await show({ [START]: { status: 0 } })
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(row()).toHaveTextContent("Couldn't start the evaluation. Try again."))
    expect(row()).toHaveAttribute('data-state', 'out_of_date')
  })
})

describe('roles (the server\'s member floor)', () => {
  it('a viewer sees the action disabled with "Viewers can\'t start an evaluation", and a click sends nothing', async () => {
    m.role = 'viewer'
    await show({ [START]: ok({ scanId: 's-new' }) })
    const button = within(row()).getByRole('button', { name: 'Re-evaluate now' })
    expect(button).toBeDisabled()
    expect(row()).toHaveTextContent("Viewers can't start an evaluation")
    expect(button).toHaveAccessibleDescription("Viewers can't start an evaluation")
    fireEvent.click(button)
    expect(startPosts()).toHaveLength(0)
  })
  it('a role not read yet fails closed: disabled, no reason', async () => {
    m.role = null
    await show({ [START]: ok({ scanId: 's-new' }) })
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeDisabled()
    expect(row()).not.toHaveTextContent("Viewers can't")
  })
  it.each(['owner', 'admin', 'member'])('%s can start', async (role) => {
    m.role = role
    await show()
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled()
  })
})

describe('the score (D1)', () => {
  it('comes from the counts; the stored "0.00" is never printed', async () => {
    await show({ [`GET ${SCANS_PATH}`]: ok([scan('s-1', 'fw-1', 'completed', '0.00', DAY)]) })
    expect(row()).toHaveTextContent('Evaluated Oct 22 · 90%')
    expect(document.body).not.toHaveTextContent('0.00')
  })
  it('nothing counted: "—" and "No rules applied to your resources.", never 0% or 100%', async () => {
    await show({ [`GET ${SCANS_PATH}`]: ok([{ ...scan('s-1', 'fw-1', 'completed', '100.00', DAY), compliant_resources: 0, non_compliant_resources: 0 }]) })
    expect(row()).toHaveTextContent('Evaluated Oct 22 · —')
    expect(row()).toHaveTextContent('No rules applied to your resources.')
    expect(row()).not.toHaveTextContent('%')
  })
})
