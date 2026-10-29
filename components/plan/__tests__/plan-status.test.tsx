/**
 * WorkspaceLoadError on every plan-gated page: "You're not a member of any
 * workspace yet." with Sign out only after a successful response confirmed
 * zero memberships; a failed load keeps "Couldn't load your workspace." with
 * Try again; loading shows neither. Real AuthProvider over fake
 * /api/auth/me and /api/organizations (org-load-harness), on /tenants.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { api } from '@/lib/api'
import { authService } from '@/lib/services/auth.service'
import {
  advanceToAutoRetry, fakeOrgSources, flush, renderWithAuth, seedSession, WORKSPACE_ERROR,
} from '@/lib/contexts/__tests__/org-load-harness'
import TenantsPage from '@/app/(app)/tenants/page'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push, refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/tenants',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const NO_WORKSPACE = "You're not a member of any workspace yet."
const INVITE_HINT = 'If someone invited you, open the invitation link in your email.'
let paidCalls = 0

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  localStorage.clear()
  push.mockReset()
  paidCalls = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(api, 'get').mockImplementation(async () => { paidCalls += 1; return { data: { success: true, data: [] } } as never })
  seedSession()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount() {
  const src = fakeOrgSources()
  renderWithAuth(<TenantsPage />)
  await flush()
  return src
}

describe('WorkspaceLoadError', () => {
  it('zero memberships (confirmed, after the one retry) → the no-workspace message, the invite hint and Sign out; no gate, no paid call', async () => {
    const src = await mount()
    await src.meOk(0, [])
    await src.orgsOk(0, [])
    expect(screen.getByTestId('plan-loading')).toBeTruthy()
    expect(screen.queryByText(NO_WORKSPACE)).toBeNull()
    await advanceToAutoRetry()
    await src.meOk(1, [])
    await src.orgsOk(1, [])
    expect(await screen.findByText(NO_WORKSPACE)).toBeTruthy()
    expect(screen.getByText(INVITE_HINT)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    expect(screen.queryByText(WORKSPACE_ERROR)).toBeNull()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    expect(screen.queryByText('Upgrade to Enterprise')).toBeNull()
    expect(screen.queryByText('Enterprise Feature')).toBeNull()
    expect(paidCalls).toBe(0)
  })

  it('a failed load → "Couldn\'t load your workspace." with Try again, never the no-workspace message', async () => {
    const src = await mount()
    await src.failBoth(0)
    await advanceToAutoRetry()
    await src.failBoth(1)
    expect(await screen.findByText(WORKSPACE_ERROR)).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    expect(screen.queryByText(NO_WORKSPACE)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('while loading → the skeleton, neither message', async () => {
    await mount()
    expect(screen.getByTestId('plan-loading')).toBeTruthy()
    expect(screen.queryByText(NO_WORKSPACE)).toBeNull()
    expect(screen.queryByText(WORKSPACE_ERROR)).toBeNull()
  })

  it('Sign out uses the existing logout: the API call, signed-out state, and /login', async () => {
    const logout = vi.spyOn(authService, 'logout').mockResolvedValue(undefined as never)
    const src = await mount()
    await src.meOk(0, [])
    await src.orgsOk(0, [])
    await advanceToAutoRetry()
    await src.meOk(1, [])
    await src.orgsOk(1, [])
    await screen.findByText(NO_WORKSPACE)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign out' })) })
    expect(logout).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(push).toHaveBeenCalledWith('/login')
  })
})
