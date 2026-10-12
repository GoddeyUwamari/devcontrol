/**
 * /dependencies' offline/error fallback cache is scoped to the session's
 * organization.
 *
 * The page used to keep the last successful dependency list in one
 * unscoped localStorage key and show it whenever a later fetch failed or the
 * browser was offline -- so after a logout, a different sign-in, or an
 * organization switch on the same browser, a failed fetch rendered the
 * previous organization's dependencies as the current one's.
 *
 * Runs the REAL AuthProvider and the REAL DependenciesPage. Only the network
 * (service calls), navigation, retry backoff and the client-only graph/list
 * views are faked. The session's organization is the access token's
 * `organizationId` claim, as the backend scopes by JWT.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DependenciesPage from '../page'
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context'
import { authService, tokenManager } from '@/lib/services/auth.service'
import { organizationsService } from '@/lib/services/organizations.service'
import { dependenciesService } from '@/lib/services/dependencies.service'
import { servicesService } from '@/lib/services/services.service'

vi.mock('next/navigation', () => {
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return {
    useRouter: () => router,
    usePathname: () => '/dependencies',
    useSearchParams: () => new URLSearchParams(),
  }
})
// Client-only React Flow views; not under test here.
vi.mock('next/dynamic', () => ({ default: () => () => null }))
// No backoff delays: one attempt, its error surfaces immediately.
vi.mock('@/lib/utils/retry', () => ({ retryApiCall: (fn: () => Promise<unknown>) => fn() }))

const ORG = {
  a: { id: '00000000-0000-4000-8000-00000000000a', name: 'Org A', slug: 'org-a' },
  b: { id: '00000000-0000-4000-8000-00000000000b', name: 'Org B', slug: 'org-b' },
  c: { id: '00000000-0000-4000-8000-00000000000c', name: 'Org C', slug: 'org-c' },
} as const
const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'user@example.invalid', fullName: 'User' }

/** An unsigned JWT-shaped access token scoped to `organizationId`. */
function accessTokenFor(organizationId: string): string {
  const payload = btoa(JSON.stringify({ userId: USER.id, organizationId, role: 'owner', type: 'access' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`
}

function dependency(id: string, label: string) {
  return {
    id,
    sourceServiceId: `${id}-src`,
    targetServiceId: `${id}-tgt`,
    sourceServiceName: `${label} source`,
    targetServiceName: `${label} target`,
    dependencyType: 'runtime',
    isCritical: false,
    description: label,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

/** A cache entry as the page writes it, for `organizationId`. */
function seedCache(organizationId: string, deps: unknown[], savedAt = new Date(Date.now() - 5 * 60_000)) {
  localStorage.setItem(
    `dependencies_cache:${organizationId}`,
    JSON.stringify({ organizationId, savedAt: savedAt.toISOString(), data: deps })
  )
}

/** Signed in to `org`, as a returning session restored from storage. */
function signInAs(org: { id: string }) {
  localStorage.setItem('accessToken', accessTokenFor(org.id))
  localStorage.setItem('refreshToken', 'refresh-token')
  localStorage.setItem('user', JSON.stringify(USER))
}

/** Drives AuthProvider's real methods, as the app's menus and forms do. */
function AuthControls() {
  const { login, logout, switchOrganization, createOrganization } = useAuth()
  return (
    <>
      <button onClick={() => login(USER.email, 'password')}>test: log in</button>
      <button onClick={() => logout()}>test: log out</button>
      <button onClick={() => switchOrganization(ORG.b.id)}>test: switch to org B</button>
      <button onClick={() => createOrganization(ORG.c.name)}>test: create org C</button>
    </>
  )
}

async function click(label: string) {
  await act(async () => { fireEvent.click(screen.getByText(label)) })
}

async function mountPage({ page = true }: { page?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <AuthControls />
        {page && <DependenciesPage />}
      </AuthProvider>
    </QueryClientProvider>
  )
  await act(async () => {})
  return client
}

function cachedIds(organizationId: string): string[] | null {
  const raw = localStorage.getItem(`dependencies_cache:${organizationId}`)
  return raw ? JSON.parse(raw).data.map((d: { id: string }) => d.id) : null
}

const fetchFails = () =>
  vi.spyOn(dependenciesService, 'getAll').mockRejectedValue(new TypeError('Failed to fetch'))

beforeEach(() => {
  localStorage.clear()
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {})
  vi.spyOn(authService, 'getCurrentUser').mockResolvedValue({ ...USER, organizations: [ORG.a, ORG.b] } as never)
  vi.spyOn(authService, 'logout').mockResolvedValue(undefined as never)
  vi.spyOn(organizationsService, 'getAll').mockResolvedValue([ORG.a, ORG.b] as never)
  vi.spyOn(organizationsService, 'switch').mockResolvedValue(undefined)
  vi.spyOn(dependenciesService, 'detectCircularDependencies').mockResolvedValue([] as never)
  vi.spyOn(servicesService, 'getAll').mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/dependencies offline/error fallback cache', () => {
  it("same organization: a failed fetch falls back to that organization's own cache", async () => {
    signInAs(ORG.a)
    seedCache(ORG.a.id, [dependency('dep-a', 'Org A dependency')])
    fetchFails()

    await mountPage()

    expect(await screen.findByText('Showing cached data')).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Dependency view options' })).toBeInTheDocument()
  })

  it("fetch failure with a stale cache from another organization: shows the error, never that cache", async () => {
    signInAs(ORG.a)
    seedCache(ORG.b.id, [dependency('dep-b', 'Org B dependency')])
    // The pre-scoping key, unattributable to any organization.
    localStorage.setItem('dependencies_cache', JSON.stringify([dependency('dep-x', 'Unknown org dependency')]))
    localStorage.setItem('dependencies_cache_timestamp', new Date().toISOString())
    fetchFails()

    await mountPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Showing cached data')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Dependency view options' })).not.toBeInTheDocument()
    expect(localStorage.getItem('dependencies_cache')).toBeNull()
  })

  it("a successful fetch is cached under the session's organization only", async () => {
    signInAs(ORG.a)
    vi.spyOn(dependenciesService, 'getAll').mockResolvedValue([dependency('dep-a', 'Org A dependency')] as never)

    await mountPage()

    await waitFor(() => expect(localStorage.getItem(`dependencies_cache:${ORG.a.id}`)).not.toBeNull())
    const entry = JSON.parse(localStorage.getItem(`dependencies_cache:${ORG.a.id}`)!)
    expect(entry.organizationId).toBe(ORG.a.id)
    expect(entry.data.map((d: { id: string }) => d.id)).toEqual(['dep-a'])
    expect(localStorage.getItem(`dependencies_cache:${ORG.b.id}`)).toBeNull()
    expect(localStorage.getItem('dependencies_cache')).toBeNull()
  })

  it("logout clears every organization's cache", async () => {
    signInAs(ORG.a)
    seedCache(ORG.a.id, [dependency('dep-a', 'Org A dependency')])
    seedCache(ORG.b.id, [dependency('dep-b', 'Org B dependency')])
    localStorage.setItem('announcement-dismissed', 'true')
    fetchFails()
    await mountPage()
    expect(await screen.findByText('Showing cached data')).toBeInTheDocument()

    await click('test: log out')

    expect(localStorage.getItem(`dependencies_cache:${ORG.a.id}`)).toBeNull()
    expect(localStorage.getItem(`dependencies_cache:${ORG.b.id}`)).toBeNull()
    expect(localStorage.getItem('announcement-dismissed')).toBe('true')
    expect(screen.queryByText('Showing cached data')).not.toBeInTheDocument()
  })

  // SIMULATED FUTURE FLOW, not the app's behavior today. organizationsService.switch
  // is mocked to succeed (beforeEach); the real call posts to
  // /api/organizations/switch, which has no backend route, so in the app
  // switchOrganization always fails into its catch before the reset. This
  // pins what the reset does once a switch can succeed. It does not verify
  // organization-switch isolation.
  it("simulated future flow -- if an organization switch succeeded, it would clear the caches and stop showing the previous organization's data", async () => {
    signInAs(ORG.a)
    seedCache(ORG.a.id, [dependency('dep-a', 'Org A dependency')])
    fetchFails()
    const client = await mountPage()
    expect(await screen.findByText('Showing cached data')).toBeInTheDocument()

    await click('test: switch to org B')

    expect(organizationsService.switch).toHaveBeenCalledWith(ORG.b.id)
    expect(localStorage.getItem(`dependencies_cache:${ORG.a.id}`)).toBeNull()
    // Nothing of org A's survives in the query cache either; the page refetches
    // (and here fails), so it shows the error, not org A's dependencies.
    await waitFor(() => expect(screen.queryByText('Showing cached data')).not.toBeInTheDocument())
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(client.getQueryData(['dependencies'])).toBeUndefined()
  })

  it("today's organization switch fails (no backend route) and resets nothing", async () => {
    signInAs(ORG.a)
    seedCache(ORG.a.id, [dependency('dep-a', 'Org A dependency')])
    fetchFails()
    // What the real call does without a backend route: reject.
    vi.spyOn(organizationsService, 'switch').mockRejectedValue(new Error('Request failed with status code 404'))
    await mountPage()
    expect(await screen.findByText('Showing cached data')).toBeInTheDocument()

    await click('test: switch to org B')

    expect(cachedIds(ORG.a.id)).toEqual(['dep-a'])
    expect(screen.getByText('Showing cached data')).toBeInTheDocument()
  })

  it("another tab signs in as a different organization: this tab's refetch is not stored under the organization it captured", async () => {
    // This tab: org A, on /dependencies, with org A's rows cached.
    signInAs(ORG.a)
    const getAll = vi.spyOn(dependenciesService, 'getAll')
      .mockResolvedValue([dependency('dep-a', 'Org A dependency')] as never)
    const client = await mountPage()
    await waitFor(() => expect(cachedIds(ORG.a.id)).toEqual(['dep-a']))

    // Another tab signs in as org B: the access token in the shared
    // localStorage is now org B's, and this tab's next request returns org
    // B's rows (lib/api.ts reads the token per request). Nothing in this tab
    // re-renders, so it still holds org A as the session's organization.
    localStorage.setItem('accessToken', accessTokenFor(ORG.b.id))
    getAll.mockResolvedValue([dependency('dep-b', 'Org B dependency')] as never)
    const tokenReads = vi.spyOn(tokenManager, 'getCurrentOrganizationId')
    await act(async () => { await client.refetchQueries({ queryKey: ['dependencies'], exact: true }) })
    expect(client.getQueryData<{ id: string }[]>(['dependencies'])?.map((d) => d.id)).toEqual(['dep-b'])
    // React Query notifies the page on a later tick; let it render org B's
    // rows and run its save effect before looking at what was stored.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })

    // Org B's rows were not written under org A's key (or any key) ...
    expect(cachedIds(ORG.a.id)).toEqual(['dep-a'])
    expect(cachedIds(ORG.b.id)).toBeNull()
    // ... because the save re-read the token, not because no save was attempted.
    expect(tokenReads).toHaveBeenCalled()
  })

  it("an empty successful fetch replaces the cache, so a later failure cannot show dependencies since deleted", async () => {
    signInAs(ORG.a)
    seedCache(ORG.a.id, [dependency('dep-a', 'Org A dependency')])
    vi.spyOn(dependenciesService, 'getAll').mockResolvedValue([] as never)

    await mountPage()

    await waitFor(() => expect(cachedIds(ORG.a.id)).toEqual([]))
  })

  it("login clears a previous session's caches that no logout removed", async () => {
    // Org A's cache outlived its session (tab closed, tokens expired); nobody is signed in.
    seedCache(ORG.a.id, [dependency('dep-a', 'Org A dependency')])
    seedCache(ORG.b.id, [dependency('dep-b', 'Org B dependency')])
    vi.spyOn(authService, 'login').mockResolvedValue({
      accessToken: accessTokenFor(ORG.b.id),
      refreshToken: 'refresh-token',
      user: USER,
      organization: ORG.b,
    } as never)
    const client = await mountPage({ page: false })
    client.setQueryData(['dependencies'], [dependency('dep-a', 'Org A dependency')])

    await click('test: log in')

    expect(authService.login).toHaveBeenCalled()
    expect(localStorage.getItem('accessToken')).toBe(accessTokenFor(ORG.b.id))
    expect(localStorage.getItem(`dependencies_cache:${ORG.a.id}`)).toBeNull()
    expect(localStorage.getItem(`dependencies_cache:${ORG.b.id}`)).toBeNull()
    expect(client.getQueryData(['dependencies'])).toBeUndefined()
  })

  it("creating an organization clears the caches before the new organization becomes current", async () => {
    signInAs(ORG.a)
    seedCache(ORG.a.id, [dependency('dep-a', 'Org A dependency')])
    fetchFails()
    vi.spyOn(organizationsService, 'create').mockResolvedValue(ORG.c as never)
    await mountPage()
    expect(await screen.findByText('Showing cached data')).toBeInTheDocument()

    await click('test: create org C')

    expect(organizationsService.create).toHaveBeenCalled()
    expect(localStorage.getItem(`dependencies_cache:${ORG.a.id}`)).toBeNull()
    await waitFor(() => expect(screen.queryByText('Showing cached data')).not.toBeInTheDocument())
  })

  it("a session whose token and current organization disagree gets no cache at all", async () => {
    // Token scoped to org A while AuthContext's current organization is org B.
    signInAs(ORG.a)
    vi.spyOn(authService, 'getCurrentUser').mockResolvedValue({ ...USER, organizations: [ORG.b] } as never)
    vi.spyOn(organizationsService, 'getAll').mockResolvedValue([ORG.b] as never)
    seedCache(ORG.a.id, [dependency('dep-a', 'Org A dependency')])
    seedCache(ORG.b.id, [dependency('dep-b', 'Org B dependency')])
    fetchFails()

    await mountPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Showing cached data')).not.toBeInTheDocument()
  })
})
