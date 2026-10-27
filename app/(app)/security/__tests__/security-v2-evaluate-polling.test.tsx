/**
 * Security V2 F3a: while a framework's evaluation runs, the scan list is read again every 5 s for the first
 * minute, then every 15 s, and not at all past the 15-minute ceiling, where "Re-evaluate now" shows again
 * (founder answers of Oct 27). Every timer is fake here, so no waitFor: time is moved by hand.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  return {
    h: { log: [] as string[], routes: {} as Record<string, unknown>, posts: [] as { path: string; body: unknown }[] },
    role: 'owner' as string | null,
  }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import SecurityOverviewV2 from '../overview/SecurityOverviewV2'
import { SCANS_PATH, connectedRoutes, failWith, installFetch, newClient, ok, renderWith, scan, type Harness } from './security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('./security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => m.role }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const h = m.h as unknown as Required<Harness>
Element.prototype.scrollIntoView = function scrollIntoView() {}

const DAY = 86_400_000
const SEC = 1000
const MIN = 60 * SEC
const DONE = scan('s-old', 'fw-1', 'completed', '90', 2 * DAY)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.posts.length = 0
  h.routes = connectedRoutes()
  m.role = 'owner'
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch(h)
})

/** Moves fake time, then 50 ms more in small steps so every answer and render that falls due settles. */
const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(10) })
}
const reads = () => h.log.filter((l) => l === `GET ${SCANS_PATH}`).length
const row = () => screen.getByTestId('security-framework')

async function show(scans: unknown[]) {
  h.routes[`GET ${SCANS_PATH}`] = ok(scans)
  renderWith(newClient(), <SecurityOverviewV2 />)
  await advance(0)
  await advance(0)
  expect(reads()).toBe(1)
}

describe('polling while a run is active', () => {
  it('every 5 s in the first minute; it stops once the run completes', async () => {
    await show([scan('s-run', 'fw-1', 'running', null, 10 * SEC), DONE])
    expect(row()).toHaveAttribute('data-state', 'running')
    await advance(5 * SEC)
    expect(reads()).toBe(2)
    await advance(5 * SEC)
    expect(reads()).toBe(3)
    h.routes[`GET ${SCANS_PATH}`] = ok([scan('s-run', 'fw-1', 'completed', '0.00', 0), DONE])
    await advance(5 * SEC)
    expect(reads()).toBe(4)
    expect(row()).toHaveAttribute('data-state', 'current')
    expect(row()).toHaveTextContent('Evaluated Oct 23 · 90%')
    await advance(2 * MIN)
    expect(reads()).toBe(4)
  })

  it('it stops when the run fails, and the failure shows no score', async () => {
    await show([scan('s-run', 'fw-1', 'running', null, 10 * SEC), DONE])
    h.routes[`GET ${SCANS_PATH}`] = ok([scan('s-run', 'fw-1', 'failed', null, 0), DONE])
    await advance(5 * SEC)
    expect(row()).toHaveAttribute('data-state', 'failed')
    expect(row()).not.toHaveTextContent('%')
    const after = reads()
    await advance(2 * MIN)
    expect(reads()).toBe(after)
  })

  it('every 15 s after the first minute', async () => {
    await show([scan('s-run', 'fw-1', 'running', null, 2 * MIN), DONE])
    await advance(10 * SEC)
    expect(reads()).toBe(1)
    await advance(5 * SEC)
    expect(reads()).toBe(2)
    await advance(15 * SEC)
    expect(reads()).toBe(3)
  })

  it('nothing running: no polling', async () => {
    await show([DONE])
    await advance(5 * MIN)
    expect(reads()).toBe(1)
  })
})

describe('the 15-minute ceiling (a run nothing ever ends)', () => {
  it('the read past the ceiling is the last; Running stays and "Re-evaluate now" shows again', async () => {
    await show([scan('s-stuck', 'fw-1', 'running', null, 14 * MIN + 50 * SEC), DONE])
    expect(within(row()).queryByRole('button')).toBeNull()
    await advance(15 * SEC)
    expect(reads()).toBe(2)
    expect(row()).toHaveAttribute('data-state', 'running')
    expect(row()).toHaveTextContent('Still running — started today, 2:45 PM, taking longer than usual.')
    expect(row()).not.toHaveTextContent('The previous result is hidden')
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled()
    await advance(10 * MIN)
    expect(reads()).toBe(2)
  })

  it('"Re-evaluate now" on the overdue run answered 409: the same text, no error, no new polling', async () => {
    h.routes['POST /api/compliance-frameworks/fw-1/scan'] = failWith(409, 'SCAN_IN_PROGRESS')
    await show([scan('s-stuck', 'fw-1', 'running', null, DAY), DONE])
    const before = row().textContent
    expect(before).toContain('Still running — started yesterday, 3:00 PM, taking longer than usual.')
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await advance(0)
    await advance(0)
    expect(h.posts).toHaveLength(1)
    expect(reads()).toBe(2)
    expect(row()).toHaveAttribute('data-state', 'running')
    expect(row().textContent).toBe(before)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled()
    await advance(10 * MIN)
    expect(reads()).toBe(2)
    expect(row().textContent).toBe(before)
  })

  it('a run already past the ceiling when the page opens: no polling, the action is there', async () => {
    await show([scan('s-stuck', 'fw-1', 'running', null, DAY), DONE])
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled()
    await advance(5 * MIN)
    expect(reads()).toBe(1)
  })

  it('a started run the list never shows: Running until the ceiling, then the action again', async () => {
    h.routes['POST /api/compliance-frameworks/fw-1/scan'] = ok({ scanId: 's-missing' })
    await show([scan('s-old', 'fw-1', 'completed', '90', 9 * DAY)])
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await advance(0)
    await advance(0)
    expect(row()).toHaveAttribute('data-state', 'running')
    expect(within(row()).queryByRole('button')).toBeNull()
    await advance(15 * MIN)
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled()
  })
})
