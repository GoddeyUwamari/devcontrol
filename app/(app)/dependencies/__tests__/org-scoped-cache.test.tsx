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
import { authService } from '@/lib/services/auth.service'
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

/** Drives AuthProvider's real logout and organization switch, as the app's menus do. */
function AuthControls() {
  const { logout, switchOrganization } = useAuth()
  return (
    <>
      <button onClick={() => logout()}>test: log out</button>
      <button onClick={() => switchOrganization(ORG.b.id)}>test: switch to org B</button>
    </>
  )
}

async function click(label: string) {
  await act(async () => { fireEvent.click(screen.getByText(label)) })
}

async function mountPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <AuthControls />
        <DependenciesPage />
      </AuthProvider>
    </QueryClientProvider>
  )
  await act(async () => {})
  return client
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

  it("organization switch clears the caches, and the previous organization's data is no longer shown", async () => {
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
