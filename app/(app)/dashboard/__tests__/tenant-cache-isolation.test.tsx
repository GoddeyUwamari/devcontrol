/**
 * Frontend tenant cache isolation -- the cross-user cache-bleed regression.
 *
 * The vulnerability: the app's QueryClient is a module-level singleton, and
 * logout/login are soft (client-side) navigations, so user B logging in after
 * user A in the same tab was served A's cached dashboard data under the query
 * keys that carried no organization.
 *
 * Everything here runs the REAL AuthProvider (login/logout/register/refreshUser)
 * and the REAL DashboardPage against one QueryClient. Only the network is faked:
 * every data service answers for whichever organization the bearer token in
 * localStorage belongs to *at request time* -- the same way the backend scopes by
 * JWT -- and any request can be held open with a gate, so in-flight and
 * not-yet-resolved states are reproduced deterministically (no sleeps, no timers).
 *
 * Navigation is soft: router.push only swaps the rendered route and calls
 * history.pushState, like Next's client router. Nothing ever reloads the document,
 * and login's 100ms `window.location.href` fallback is captured and never run, so
 * no assertion here can be satisfied by a hard reload clearing memory.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import DashboardPage from '../page'
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context'
import { authService, tokenManager } from '@/lib/services/auth.service'
import { organizationsService } from '@/lib/services/organizations.service'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { monitoringService } from '@/lib/services/monitoring.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { accountSecurityFindingsService } from '@/lib/services/account-security-findings.service'
import { awsResourcesService } from '@/lib/services/aws-resources.service'
import { aiSummaryService } from '@/lib/services/ai-summary.service'
import { systemIntelligenceService } from '@/lib/services/system-intelligence.service'
import { activityFeedService } from '@/lib/services/activity-feed.service'
import { soc2Service } from '@/lib/services/soc2.service'
import { complianceFrameworksService } from '@/lib/services/compliance-frameworks.service'

// ── Soft-navigation router ────────────────────────────────────────────────────
const nav = vi.hoisted(() => ({
  go: null as unknown as (path: string) => void,
  log: [] as Array<{ path: string; tenantDataEntries: number }>,
  snapshot: (): number => 0,
}))
vi.mock('next/navigation', () => {
  const push = (path: string) => {
    // Record what the cache holds at the exact moment of navigation, then navigate softly.
    nav.log.push({ path, tenantDataEntries: nav.snapshot() })
    window.history.pushState({}, '', path)
    nav.go(path)
  }
  const router = { push, replace: push, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return {
    useRouter: () => router,
    usePathname: () => window.location.pathname,
    useSearchParams: () => new URLSearchParams(),
  }
})
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null, isConnected: false }) }))

// ── Tenants ───────────────────────────────────────────────────────────────────
type Tenant = 'a' | 'b'
const ORG = { a: { id: 'org-a', name: 'Org A', slug: 'org-a' }, b: { id: 'org-b', name: 'Org B', slug: 'org-b' } } as const
const USER = {
  a: { id: 'user-a', email: 'a@tenant-a.test', fullName: 'User A' },
  b: { id: 'user-b', email: 'b@tenant-b.test', fullName: 'User B' },
} as const
const TOKEN = { a: 'token-a', b: 'token-b' } as const
// Distinctive per-tenant values, so any leak is visible in the cache and on screen.
const SPEND = { a: 1111, b: 2222 } as const
// Formatted exactly as the Monthly Spend card renders it.
const money = (t: Tenant) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(SPEND[t])

function tenantOfToken(): Tenant | null {
  const token = localStorage.getItem('accessToken')
  return token === TOKEN.a ? 'a' : token === TOKEN.b ? 'b' : null
}

// The seven previously-unscoped tenant-data queries, as the dashboard now keys them.
const SEVEN_PREFIXES = [
  ['platform-dashboard-stats'],
  ['cost-trend'],
  ['cost-recommendations'],
  ['cost-recommendations-stats'],
  ['cost-analysis-runs'],
  ['aws-accounts'],
  ['soc2-readiness'],
] as const
const scopedKeys = (orgId: string) => [
  ['platform-dashboard-stats', orgId],
  ['cost-trend', '7d', orgId],
  ['cost-recommendations', orgId],
  ['cost-recommendations-stats', orgId],
  ['cost-analysis-runs', orgId],
  ['aws-accounts', orgId],
  ['soc2-readiness', orgId],
]

// ── Network doubles: answer for the token's tenant at request time; gate-able ─
type Gate = { promise: Promise<void>; open: () => void }
let gates: Map<string, Gate>
function gate(name: string) {
  let open!: () => void
  const promise = new Promise<void>((r) => { open = r })
  const g = { promise, open }
  gates.set(name, g)
  return g
}
const calls: Record<string, number> = {}
function respond<T>(name: string, build: (t: Tenant) => T): Promise<T> {
  calls[name] = (calls[name] ?? 0) + 1
  const tenant = tenantOfToken()
  if (!tenant) return Promise.reject(Object.assign(new Error('unauthenticated'), { response: { status: 401 } }))
  const held = gates.get(name)
  return held ? held.promise.then(() => build(tenant)) : Promise.resolve(build(tenant))
}

function installNetworkDoubles() {
  vi.spyOn(authService, 'getCurrentUser').mockImplementation(() =>
    respond('me', (t) => ({ ...USER[t], organizations: [ORG[t]] }) as never))
  vi.spyOn(authService, 'logout').mockResolvedValue(undefined)
  vi.spyOn(organizationsService, 'getAll').mockImplementation(() => respond('orgs', (t) => [ORG[t]] as never))

  vi.spyOn(platformStatsService, 'getDashboardStats').mockImplementation(() =>
    respond('platform-dashboard-stats', (t) => ({
      owner: ORG[t].id, totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0,
      monthlyAwsCost: SPEND[t], costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual',
    }) as never))
  vi.spyOn(costRecommendationsService, 'getAll').mockImplementation(() => respond('cost-recommendations', () => [] as never))
  vi.spyOn(costRecommendationsService, 'getStats').mockImplementation(() =>
    respond('cost-recommendations-stats', (t) => ({ owner: ORG[t].id, totalPotentialSavings: 0, activeRecommendations: 0 }) as never))
  vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockImplementation(() =>
    respond('cost-analysis-runs', (t) => [{ id: `run-${t}`, owner: ORG[t].id, status: 'completed' }] as never))
  vi.spyOn(soc2Service, 'getReadiness').mockImplementation(() =>
    respond('soc2-readiness', (t) => [{ criterionId: `CC6.1-${t}`, owner: ORG[t].id, name: 'n', evidenceClaim: 'c', limitation: 'l', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null }] as never))

  // Not among the seven, but rendered by the page -- answered so the page settles.
  vi.spyOn(monitoringService, 'getSystemHealth').mockImplementation(() => respond('system-health', () => ({ status: 'operational' }) as never))
  vi.spyOn(accountSecurityFindingsService, 'getStats').mockImplementation(() =>
    respond('account-findings', () => ({ bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } }) as never))
  vi.spyOn(awsResourcesService, 'getStats').mockImplementation(() => respond('aws-resources', () => ({ compliance_stats: null }) as never))
  vi.spyOn(aiSummaryService, 'getSummary').mockImplementation(() => respond('ai-summary', () => ({ topRisk: null }) as never))
  vi.spyOn(systemIntelligenceService, 'getIntelligence').mockImplementation(() => respond('system-intelligence', () => null as never))
  vi.spyOn(activityFeedService, 'getActivity').mockImplementation(() => respond('activity-feed', () => [] as never))
  vi.spyOn(complianceFrameworksService, 'getFrameworks').mockImplementation(() => respond('frameworks', () => [] as never))

  // aws-accounts and cost-trend call fetch() directly.
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const name = String(url).includes('/api/aws/accounts') ? 'aws-accounts' : String(url).includes('/api/platform/costs/trend') ? 'cost-trend' : 'other'
    return respond(name, (t) => ({
      ok: true,
      json: async () => ({
        data: name === 'aws-accounts'
          ? [{ id: `acct-${t}`, owner: ORG[t].id }]
          : name === 'cost-trend'
            ? [{ date: '2026-09-01', owner: ORG[t].id, compute: 1, storage: 0, database: 0, network: 0, other: 0, total: SPEND[t] }]
            : [],
      }),
    }))
  }))
}

// ── Harness ───────────────────────────────────────────────────────────────────
let client: QueryClient
let auth: ReturnType<typeof useAuth>
let capturedHardReloadFallbacks: number

function AuthGrab() {
  const value = useAuth()
  useEffect(() => { auth = value })
  return null
}
function Shell({ start }: { start: string }) {
  const [path, setPath] = useState(start)
  useEffect(() => { nav.go = setPath }, [])
  return path === '/dashboard' ? <DashboardPage /> : <div data-testid="route">{path}</div>
}
function mount(start: string) {
  window.history.pushState({}, '', start)
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <AuthGrab />
        <Shell start={start} />
      </AuthProvider>
    </QueryClientProvider>,
  )
}
function signInAs(t: Tenant) {
  tokenManager.setAccessToken(TOKEN[t])
  tokenManager.setRefreshToken(`refresh-${t}`)
  tokenManager.setUser(USER[t] as never)
}

/** Every cached entry that actually holds data (disabled/empty entries don't expose anything). */
const tenantDataEntries = () => client.getQueryCache().getAll().filter((q) => q.state.data !== undefined)
const keysMentioning = (orgId: string) =>
  client.getQueryCache().getAll().filter((q) => q.queryKey.includes(orgId)).map((q) => q.queryKey)
const dataUnderPrefix = (prefix: readonly string[]) =>
  client.getQueriesData({ queryKey: [...prefix] }).filter(([, data]) => data !== undefined)

async function loadDashboardAs(t: Tenant) {
  signInAs(t)
  mount('/dashboard')
  await waitFor(() => {
    for (const key of scopedKeys(ORG[t].id)) expect(client.getQueryData(key), JSON.stringify(key)).toBeDefined()
  })
  expect(screen.getByText(money(t))).toBeInTheDocument()
}

beforeEach(() => {
  localStorage.clear()
  gates = new Map()
  for (const k of Object.keys(calls)) delete calls[k]
  nav.log = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  nav.snapshot = () => tenantDataEntries().length
  installNetworkDoubles()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // login()/register() schedule a 100ms `window.location.href` hard-reload fallback.
  // Capture it and never run it: every assertion below must hold on the soft path alone.
  capturedHardReloadFallbacks = 0
  const realSetTimeout = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...args: unknown[]) => {
    if (ms === 100) { capturedHardReloadFallbacks++; return 0 as never }
    return realSetTimeout(fn, ms, ...args)
  }) as typeof setTimeout)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('cross-user cache bleed: user A (org A) → soft logout → user B (org B) soft login, same tab', () => {
  it('B can never read A\'s cached or in-flight tenant data, before or after B\'s own queries resolve', async () => {
    // ── User A: all seven tenant queries cached, plus one A request still in flight.
    await loadDashboardAs('a')
    const aRefetch = gate('cost-analysis-runs')
    await act(async () => { void client.refetchQueries({ queryKey: ['cost-analysis-runs', ORG.a.id] }) })
    expect(client.getQueryState(['cost-analysis-runs', ORG.a.id])?.fetchStatus).toBe('fetching')
    expect(tenantDataEntries().length).toBeGreaterThanOrEqual(7)

    // ── Soft logout through the real AuthProvider.logout().
    await act(async () => { await auth.logout() })

    // Soft navigation to /login happened, and the cache was already empty at that moment.
    expect(nav.log).toEqual([{ path: '/login', tenantDataEntries: 0 }])
    expect(window.location.pathname).toBe('/login')
    expect(screen.getByTestId('route')).toHaveTextContent('/login')
    // (1) No cached A tenant data remains -- under any key, org-scoped or legacy unscoped.
    expect(tenantDataEntries()).toEqual([])
    for (const prefix of SEVEN_PREFIXES) expect(dataUnderPrefix(prefix)).toEqual([])

    // (3) A's in-flight request completes only now -- and cannot repopulate the shared cache.
    await act(async () => { aRefetch.open(); await aRefetch.promise })
    expect(tenantDataEntries()).toEqual([])
    expect(keysMentioning(ORG.a.id)).toEqual([])

    // ── User B soft-logs-in through the real AuthProvider.login(); hold every B tenant request open.
    gates = new Map()
    const bGates = SEVEN_PREFIXES.map(([name]) => gate(name))
    vi.spyOn(authService, 'login').mockResolvedValue({
      data: { accessToken: TOKEN.b, refreshToken: 'refresh-b', user: USER.b, organization: ORG.b },
    } as never)
    await act(async () => { await auth.login(USER.b.email, 'pw') })

    expect(nav.log.at(-1)).toEqual({ path: '/dashboard', tenantDataEntries: 0 })
    expect(window.location.pathname).toBe('/dashboard')
    await waitFor(() => expect(calls['platform-dashboard-stats']).toBeGreaterThanOrEqual(2))

    // (2)+(4) B's own queries are in flight and unresolved: nothing from A is readable under
    // any of the seven keys, scoped or legacy, and A's figures are not on screen.
    for (const prefix of SEVEN_PREFIXES) expect(dataUnderPrefix(prefix)).toEqual([])
    for (const key of scopedKeys(ORG.a.id)) expect(client.getQueryData(key)).toBeUndefined()
    expect(keysMentioning(ORG.a.id)).toEqual([])
    expect(screen.queryByText(money('a'))).not.toBeInTheDocument()

    // (5) B's queries resolve: only B's data exists, only under B's organization.
    await act(async () => { bGates.forEach((g) => g.open()) })
    await waitFor(() => {
      for (const key of scopedKeys(ORG.b.id)) expect(client.getQueryData(key), JSON.stringify(key)).toBeDefined()
    })
    expect(keysMentioning(ORG.a.id)).toEqual([])
    const owners = tenantDataEntries()
      .map((q) => q.state.data as { owner?: string } | Array<{ owner?: string }>)
      .flatMap((d) => (Array.isArray(d) ? d : [d]))
      .map((d) => d?.owner)
      .filter(Boolean)
    expect(new Set(owners)).toEqual(new Set([ORG.b.id]))
    expect(screen.getByText(money('b'))).toBeInTheDocument()
    expect(screen.queryByText(money('a'))).not.toBeInTheDocument()

    // (6)+(7) All of this happened on the soft path: the hard-reload fallback was scheduled
    // by login() but never executed.
    expect(capturedHardReloadFallbacks).toBe(1)
  })
})

describe('each identity transition resets the cache on its own (not relying on logout having run first)', () => {
  function seedTenantA() {
    // Both the org-scoped keys and the legacy unscoped shapes the old code used.
    for (const key of scopedKeys(ORG.a.id)) client.setQueryData(key, { owner: ORG.a.id })
    for (const [name] of SEVEN_PREFIXES) client.setQueryData([name], { owner: ORG.a.id })
    expect(tenantDataEntries().length).toBe(14)
  }

  it('login(): a new identity starts from an empty cache even if the previous one never logged out', async () => {
    mount('/login')
    await act(async () => {})
    seedTenantA()
    vi.spyOn(authService, 'login').mockResolvedValue({
      data: { accessToken: TOKEN.b, refreshToken: 'refresh-b', user: USER.b, organization: ORG.b },
    } as never)
    gates = new Map()
    SEVEN_PREFIXES.forEach(([name]) => gate(name))

    await act(async () => { await auth.login(USER.b.email, 'pw') })

    expect(nav.log).toEqual([{ path: '/dashboard', tenantDataEntries: 0 }])
    expect(keysMentioning(ORG.a.id)).toEqual([])
    for (const prefix of SEVEN_PREFIXES) expect(dataUnderPrefix(prefix)).toEqual([])
    expect(capturedHardReloadFallbacks).toBe(1)
  })

  it('login(): a failed login leaves the existing session\'s cache untouched', async () => {
    mount('/login')
    await act(async () => {})
    seedTenantA()
    vi.spyOn(authService, 'login').mockRejectedValue(Object.assign(new Error('bad'), { response: { status: 401 } }))

    await act(async () => { await expect(auth.login('x@y.test', 'wrong')).rejects.toThrow() })

    expect(tenantDataEntries().length).toBe(14)
    expect(nav.log).toEqual([])
  })

  it('register(): a newly registered identity starts from an empty cache', async () => {
    mount('/register')
    await act(async () => {})
    seedTenantA()
    vi.spyOn(authService, 'register').mockResolvedValue({
      data: { accessToken: TOKEN.b, refreshToken: 'refresh-b', user: USER.b, organization: ORG.b },
    } as never)
    gates = new Map()
    SEVEN_PREFIXES.forEach(([name]) => gate(name))

    await act(async () => { await auth.register(USER.b.email, 'pw', 'User B') })

    expect(nav.log).toEqual([{ path: '/dashboard', tenantDataEntries: 0 }])
    expect(keysMentioning(ORG.a.id)).toEqual([])
    for (const prefix of SEVEN_PREFIXES) expect(dataUnderPrefix(prefix)).toEqual([])
    expect(capturedHardReloadFallbacks).toBe(1)
  })

  it('session expiry (refreshUser 401, no refresh token): the ended identity\'s cache is cleared before redirecting to /login', async () => {
    await loadDashboardAs('a')
    localStorage.removeItem('refreshToken')
    vi.mocked(authService.getCurrentUser).mockRejectedValue(Object.assign(new Error('expired'), { response: { status: 401 } }))

    await act(async () => { await auth.refreshUser() })

    expect(nav.log).toEqual([{ path: '/login', tenantDataEntries: 0 }])
    expect(tenantDataEntries()).toEqual([])
    expect(keysMentioning(ORG.a.id)).toEqual([])
  })
})

describe('defense in depth: the seven tenant queries are keyed by organization', () => {
  it('uses [existingKey..., organizationId] for all seven, and never the legacy unscoped keys', async () => {
    await loadDashboardAs('a')
    for (const key of scopedKeys(ORG.a.id)) expect(client.getQueryData(key)).toBeDefined()
    for (const [name] of SEVEN_PREFIXES) {
      expect(client.getQueryCache().find({ queryKey: [name], exact: true })).toBeUndefined()
      for (const q of client.getQueryCache().findAll({ queryKey: [name] })) {
        if (q.queryKey.at(-1) === undefined) {
          // The disabled placeholder observed before the organization was known:
          // never fetched, never holds data.
          expect(q.state.data).toBeUndefined()
          expect(q.state.dataUpdateCount).toBe(0)
        } else {
          expect(q.queryKey.at(-1)).toBe(ORG.a.id)
        }
      }
    }
  })

  it('org A and org B get distinct keys: even WITHOUT a cache reset, B never reads A\'s entries', async () => {
    await loadDashboardAs('a')
    // Change organization with no reset at all (setCurrentOrganization does not touch the cache).
    gates = new Map()
    const bGates = SEVEN_PREFIXES.map(([name]) => gate(name))
    signInAs('b')
    await act(async () => { auth.setCurrentOrganization(ORG.b as never) })
    await waitFor(() => expect(calls['platform-dashboard-stats']).toBe(2))

    // A's entries are still cached (nothing was cleared)...
    for (const key of scopedKeys(ORG.a.id)) expect(client.getQueryData(key)).toBeDefined()
    // ...but B's keys are different, so B reads nothing of A's while B's requests are pending.
    for (const key of scopedKeys(ORG.b.id)) expect(client.getQueryData(key)).toBeUndefined()
    expect(screen.queryByText(money('a'))).not.toBeInTheDocument()

    await act(async () => { bGates.forEach((g) => g.open()) })
    await waitFor(() => expect(screen.getByText(money('b'))).toBeInTheDocument())
    for (const key of scopedKeys(ORG.b.id)) expect((client.getQueryData(key) as never as { owner?: string }[] | { owner?: string })).toBeDefined()
    expect((client.getQueryData(['platform-dashboard-stats', ORG.a.id]) as { owner: string }).owner).toBe(ORG.a.id)
    expect((client.getQueryData(['platform-dashboard-stats', ORG.b.id]) as { owner: string }).owner).toBe(ORG.b.id)
  })

  it('none of the seven queries runs until the organization is known', async () => {
    signInAs('a')
    const me = gate('me')
    const orgs = gate('orgs')
    mount('/dashboard')
    await act(async () => {})

    expect(auth.user).not.toBeNull()
    expect(auth.organization).toBeNull()
    for (const [name] of SEVEN_PREFIXES) expect(calls[name] ?? 0).toBe(0)
    for (const prefix of SEVEN_PREFIXES) expect(dataUnderPrefix(prefix)).toEqual([])

    await act(async () => { me.open(); orgs.open() })
    await waitFor(() => {
      for (const key of scopedKeys(ORG.a.id)) expect(client.getQueryData(key)).toBeDefined()
    })
  })
})

describe('same-user caching is unchanged by the new key shape', () => {
  it('leaving and returning to the dashboard within staleTime refetches none of the seven queries', async () => {
    await loadDashboardAs('a')
    const before = Object.fromEntries(SEVEN_PREFIXES.map(([name]) => [name, calls[name]]))
    for (const [name] of SEVEN_PREFIXES) expect(before[name]).toBe(1)

    await act(async () => { nav.go('/settings') })
    expect(screen.getByTestId('route')).toHaveTextContent('/settings')
    await act(async () => { nav.go('/dashboard') })
    expect(screen.getByText(money('a'))).toBeInTheDocument()
    await act(async () => {})

    for (const [name] of SEVEN_PREFIXES) expect(calls[name], name).toBe(before[name])
  })
})
