/**
 * /dependencies shows only what service_dependencies and the organization's
 * services hold, through /api/dependencies -- no demo data, no generated
 * trends or metrics, no browser cache -- and never another organization's
 * rows.
 *
 * Runs the REAL AuthProvider and the REAL page. Only the network (service
 * calls), navigation, React Flow's canvas and next/dynamic's loader are
 * faked. The session's organization and role are the access token's claims,
 * as the backend scopes and authorizes by the JWT.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DependenciesPage from '../page'
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context'
import { authService } from '@/lib/services/auth.service'
import { organizationsService } from '@/lib/services/organizations.service'
import { dependenciesService } from '@/lib/services/dependencies.service'
import { servicesService } from '@/lib/services/services.service'
import type { CircularDependency, DependencyGraph, ImpactAnalysis, ServiceDependency } from '@/lib/types'

const push = vi.fn()
vi.mock('next/navigation', () => {
  const router = { push: (...a: unknown[]) => push(...a), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return {
    useRouter: () => router,
    usePathname: () => '/dependencies',
    useSearchParams: () => new URLSearchParams(),
  }
})

// next/dynamic -> React.lazy, so the real graph, list and impact components render.
vi.mock('next/dynamic', async () => {
  const React = await import('react')
  return {
    default: (loader: () => Promise<React.ComponentType<any>>) => {
      const Lazy = React.lazy(async () => ({ default: await loader() }))
      return (props: any) => React.createElement(React.Suspense, { fallback: null }, React.createElement(Lazy, props))
    },
  }
})

// React Flow's canvas needs layout APIs jsdom lacks. Nodes and edges render as
// buttons that fire the same click callbacks.
vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  const useListState = (initial: unknown[]) => {
    const [state, setState] = React.useState(initial)
    return [state, setState, () => {}]
  }
  return {
    ReactFlowProvider: ({ children }: any) => children,
    ReactFlow: ({ nodes, edges, onNodeClick, onEdgeClick, children }: any) => (
      <div data-testid="flow">
        {nodes.map((n: any) => <button key={n.id} onClick={(e) => onNodeClick?.(e, n)}>node: {n.data.label}</button>)}
        {edges.map((e: any) => <button key={e.id} onClick={(ev) => onEdgeClick?.(ev, e)}>edge: {e.id}</button>)}
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    Panel: ({ children }: any) => <div>{children}</div>,
    useNodesState: useListState,
    useEdgesState: useListState,
    MarkerType: { ArrowClosed: 'arrowclosed' },
  }
})
vi.mock('@xyflow/react/dist/style.css', () => ({}))

const ORG = {
  a: { id: '00000000-0000-4000-8000-00000000000a', name: 'Org A', slug: 'org-a' },
  b: { id: '00000000-0000-4000-8000-00000000000b', name: 'Org B', slug: 'org-b' },
} as const
const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'user@example.invalid', fullName: 'User' }

/** An unsigned JWT-shaped access token scoped to `organizationId` with `role`. */
function accessTokenFor(organizationId: string, role = 'owner'): string {
  const payload = btoa(JSON.stringify({ userId: USER.id, organizationId, role, type: 'access' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`
}

/** Signed in to `org` as `role`, as a returning session restored from storage. */
function signInAs(org: { id: string }, role = 'owner') {
  localStorage.setItem('accessToken', accessTokenFor(org.id, role))
  localStorage.setItem('refreshToken', 'refresh-token')
  localStorage.setItem('user', JSON.stringify(USER))
}

const SERVICES = [
  { id: 'svc-api', name: 'Checkout API' },
  { id: 'svc-db', name: 'Orders DB' },
  { id: 'svc-queue', name: 'Mail Queue' },
]

function dep(id: string, source: string, target: string, type: ServiceDependency['dependencyType'], isCritical: boolean, description?: string): ServiceDependency {
  const name = (sid: string) => SERVICES.find(s => s.id === sid)?.name
  return {
    id,
    organizationId: ORG.a.id,
    sourceServiceId: source,
    targetServiceId: target,
    sourceServiceName: name(source),
    targetServiceName: name(target),
    dependencyType: type,
    isCritical,
    description,
    createdBy: 'owner@example.invalid',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }
}

const DEPS: ServiceDependency[] = [
  dep('d1', 'svc-api', 'svc-db', 'data', true, 'reads orders'),
  dep('d2', 'svc-api', 'svc-queue', 'runtime', false),
  dep('d3', 'svc-queue', 'svc-db', 'deployment', true),
]

const GRAPH: DependencyGraph = {
  nodes: [
    { id: 'svc-api', type: 'default', position: { x: 0, y: 0 }, data: { label: 'Checkout API', status: 'active', owner: 'payments@example.invalid', template: 'api' } },
    { id: 'svc-db', type: 'default', position: { x: 0, y: 0 }, data: { label: 'Orders DB', status: 'active', owner: '', template: undefined } },
    { id: 'svc-queue', type: 'default', position: { x: 0, y: 0 }, data: { label: 'Mail Queue', status: 'active', owner: 'ops@example.invalid', template: 'worker' } },
  ],
  edges: DEPS.map(d => ({ id: d.id, source: d.sourceServiceId, target: d.targetServiceId, data: { dependencyType: d.dependencyType, isCritical: d.isCritical, description: d.description } })),
}

const CYCLE: CircularDependency = {
  cycle: [{ serviceId: 'svc-api', serviceName: 'Checkout API' }, { serviceId: 'svc-queue', serviceName: 'Mail Queue' }],
  path: 'Checkout API → Mail Queue → Checkout API',
  dependencyIds: [],
  severity: 'error',
}

const IMPACT: ImpactAnalysis = {
  serviceId: 'svc-api',
  serviceName: 'Checkout API',
  upstreamDependencies: [{ id: 'svc-db', name: 'Orders DB', dependencyType: 'data', isCritical: true }],
  downstreamDependencies: [],
  totalUpstream: 1,
  totalDownstream: 0,
  totalAffectedIfFails: 0,
  criticalPath: true,
}

// What the retired page generated or hard-coded. None of it may come back.
const FABRICATED = /\d+\s?ms\b|\d+(\.\d+)?%|\/mo\b|req\/min|AI Analysis|AI Insight|Recommended Actions|confidence|Est\. impact|Combined latency|Email Queue|Auth Service|User Database|Healthy|Add Alert|Real-time sync|Demo Data|Demo Mode|vs last/i

/** Drives AuthProvider's real methods, as the app's menus and forms do. */
function AuthControls() {
  const { login, logout } = useAuth()
  return (
    <>
      <button onClick={() => login(USER.email, 'password')}>test: log in</button>
      <button onClick={() => logout()}>test: log out</button>
    </>
  )
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

async function click(label: string) {
  await act(async () => { fireEvent.click(screen.getByText(label)) })
}

async function openTab(name: RegExp) {
  await act(async () => { fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false }) })
}

function stat(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent
}

async function chooseOption(trigger: HTMLElement, label: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
  fireEvent.click(await screen.findByRole('option', { name: label }))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeAll(() => {
  // Radix Select needs these in jsdom.
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {}
  // Radix Checkbox (add dialog) measures itself.
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
  }
})

beforeEach(() => {
  localStorage.clear()
  push.mockReset()
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {})
  vi.spyOn(authService, 'getCurrentUser').mockResolvedValue({ ...USER, organizations: [ORG.a, ORG.b] } as never)
  vi.spyOn(authService, 'logout').mockResolvedValue(undefined as never)
  vi.spyOn(organizationsService, 'getAll').mockResolvedValue([ORG.a, ORG.b] as never)
  vi.spyOn(dependenciesService, 'getAll').mockResolvedValue(DEPS)
  vi.spyOn(dependenciesService, 'getGraph').mockResolvedValue(GRAPH)
  vi.spyOn(dependenciesService, 'detectCircularDependencies').mockResolvedValue([])
  vi.spyOn(dependenciesService, 'getImpactAnalysis').mockResolvedValue(IMPACT)
  vi.spyOn(servicesService, 'getAll').mockResolvedValue(SERVICES as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('real data', () => {
  it('counts come from the rows the API returned', async () => {
    signInAs(ORG.a)
    await mountPage()

    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()
    expect(stat('Total dependencies')).toBe('3')
    expect(stat('Critical')).toBe('2')
    expect(stat('Runtime')).toBe('1')
    await waitFor(() => expect(stat('Circular cycles')).toBe('0'))
    expect(dependenciesService.getAll).toHaveBeenCalled()
    expect(document.body.textContent).not.toMatch(FABRICATED)
  })

  it('list view shows every row with its real type, priority and description', async () => {
    signInAs(ORG.a)
    await mountPage()
    await screen.findByText('Total dependencies')

    await openTab(/List View/)

    const rows = (await screen.findAllByRole('row')).slice(1)
    expect(rows.map(r => r.textContent)).toEqual([
      'Checkout APIOrders DBDataCriticalreads orders',
      'Checkout APIMail QueueRuntimeStandard-',
      'Mail QueueOrders DBDeploymentCritical-',
    ])
    expect(screen.getByText('Showing 3 of 3 dependencies')).toBeInTheDocument()
  })

  it('graph view draws the services and dependencies from /api/dependencies/graph', async () => {
    signInAs(ORG.a)
    await mountPage()

    expect(await screen.findByText('node: Checkout API')).toBeInTheDocument()
    expect(screen.getByText('node: Orders DB')).toBeInTheDocument()
    expect(screen.getByText('edge: d1')).toBeInTheDocument()
    expect(screen.getByText('edge: d3')).toBeInTheDocument()
    expect(dependenciesService.getGraph).toHaveBeenCalled()
  })

  it('cycles from /api/dependencies/cycles raise the alert, the count and the list warning', async () => {
    signInAs(ORG.a)
    vi.mocked(dependenciesService.detectCircularDependencies).mockResolvedValue([CYCLE])
    await mountPage()

    expect(await screen.findByText(/1 circular dependency cycle detected/)).toBeInTheDocument()
    expect(stat('Circular cycles')).toBe('1')

    await click('View details')
    expect(await screen.findByText(CYCLE.path)).toBeInTheDocument()
  })

  it('a failed cycles request reads "Unavailable", not zero', async () => {
    signInAs(ORG.a)
    vi.mocked(dependenciesService.detectCircularDependencies).mockRejectedValue(new Error('boom'))
    await mountPage()

    await waitFor(() => expect(stat('Circular cycles')).toBe('Unavailable'))
  })

  it('impact analysis shows the API\'s upstream and downstream for the chosen service', async () => {
    signInAs(ORG.a)
    await mountPage()
    await screen.findByText('Total dependencies')

    await openTab(/Impact Analysis/)
    await chooseOption(await screen.findByRole('combobox'), 'Checkout API')

    expect(await screen.findByText('Upstream Dependencies (1)')).toBeInTheDocument()
    expect(screen.getByText('Downstream Dependents (0)')).toBeInTheDocument()
    expect(screen.getByText('No downstream dependents')).toBeInTheDocument()
    expect(dependenciesService.getImpactAnalysis).toHaveBeenCalledWith('svc-api')
  })
})

describe('side panel', () => {
  it('a service shows its stored fields and recorded dependencies; unrecorded data reads "No data yet"', async () => {
    signInAs(ORG.a)
    await mountPage()

    await click((await screen.findByText('node: Checkout API')).textContent!)
    const panel = await screen.findByRole('dialog', { name: 'Details: Checkout API' })

    expect(within(panel).getByText('Status').nextElementSibling).toHaveTextContent('active')
    expect(within(panel).getByText('Owner').nextElementSibling).toHaveTextContent('payments@example.invalid')
    expect(within(panel).getByText('Template').nextElementSibling).toHaveTextContent('api')
    expect(within(panel).getByText('In a circular dependency').nextElementSibling).toHaveTextContent('No')
    expect(within(panel).getByText('Depends on (2)')).toBeInTheDocument()
    expect(within(panel).getByText('→ Orders DB').nextElementSibling).toHaveTextContent('Data · Critical')
    expect(within(panel).getByText('→ Mail Queue').nextElementSibling).toHaveTextContent('Runtime')
    expect(within(panel).getByText('Depended on by (0)')).toBeInTheDocument()
    expect(within(panel).getByText('Latency, errors, traffic, cost').nextElementSibling).toHaveTextContent('No data yet')
    expect(panel.textContent).not.toMatch(FABRICATED)
  })

  it('a missing service field reads "No data yet", not a guess', async () => {
    signInAs(ORG.a)
    await mountPage()

    await click((await screen.findByText('node: Orders DB')).textContent!)
    const panel = await screen.findByRole('dialog', { name: 'Details: Orders DB' })

    expect(within(panel).getByText('Owner').nextElementSibling).toHaveTextContent('No data yet')
    expect(within(panel).getByText('Template').nextElementSibling).toHaveTextContent('No data yet')
    expect(within(panel).getByText('Depended on by (2)')).toBeInTheDocument()
  })

  it('a dependency shows its recorded type, priority, description and author', async () => {
    signInAs(ORG.a)
    await mountPage()

    await click((await screen.findByText('edge: d1')).textContent!)
    const panel = await screen.findByRole('dialog', { name: 'Details: Checkout API → Orders DB' })

    expect(within(panel).getByText('Type').nextElementSibling).toHaveTextContent('Data')
    expect(within(panel).getByText('Priority').nextElementSibling).toHaveTextContent('Critical')
    expect(within(panel).getByText('Description').nextElementSibling).toHaveTextContent('reads orders')
    expect(within(panel).getByText('Recorded by').nextElementSibling).toHaveTextContent('owner@example.invalid')
    expect(within(panel).getByText('Traffic between services').nextElementSibling).toHaveTextContent('No data yet')
    expect(panel.textContent).not.toMatch(FABRICATED)
  })

  it('"Analyze impact" opens impact analysis for that service; Escape closes the panel', async () => {
    signInAs(ORG.a)
    await mountPage()

    await click((await screen.findByText('node: Checkout API')).textContent!)
    await screen.findByRole('dialog', { name: 'Details: Checkout API' })
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await click('node: Checkout API')
    await click('Analyze impact')

    expect(await screen.findByText('Upstream Dependencies (1)')).toBeInTheDocument()
    expect(dependenciesService.getImpactAnalysis).toHaveBeenCalledWith('svc-api')
  })
})

describe('loading, empty and error are distinct', () => {
  it('loading: a status, not the empty state and not an error', async () => {
    signInAs(ORG.a)
    vi.mocked(dependenciesService.getAll).mockReturnValue(new Promise(() => {}))
    await mountPage()

    expect(await screen.findByRole('status')).toHaveTextContent('Loading dependencies...')
    expect(screen.queryByText('No dependencies recorded yet')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()
  })

  it('empty: says nothing is recorded and offers Add Dependency to an owner', async () => {
    signInAs(ORG.a, 'owner')
    vi.mocked(dependenciesService.getAll).mockResolvedValue([])
    await mountPage()

    expect(await screen.findByText('No dependencies recorded yet')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Add new dependency' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()
  })

  it('empty with no services: points an admin to adding a service first', async () => {
    signInAs(ORG.a, 'admin')
    vi.mocked(dependenciesService.getAll).mockResolvedValue([])
    vi.mocked(servicesService.getAll).mockResolvedValue([])
    await mountPage()

    expect(await screen.findByText('Add a service first, then record which services depend on each other.')).toBeInTheDocument()
    await click('Add a service')
    expect(push).toHaveBeenCalledWith('/services/new')
    expect(screen.queryByRole('button', { name: 'Add new dependency' })).not.toBeInTheDocument()
  })

  it('a failed request is an error with a retry, never an empty inventory', async () => {
    signInAs(ORG.a)
    vi.mocked(dependenciesService.getAll).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await mountPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('No dependencies recorded yet')).not.toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /try again|retry/i })) })

    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()
    expect(stat('Total dependencies')).toBe('3')
    expect(dependenciesService.getAll).toHaveBeenCalledTimes(2)
  })

  it('a failed graph request is an error in the graph view, not "No Dependencies Yet"', async () => {
    signInAs(ORG.a)
    vi.mocked(dependenciesService.getGraph).mockRejectedValue(new Error('Request failed with status code 500'))
    await mountPage()

    expect(await screen.findByText('Error Loading Graph')).toBeInTheDocument()
    expect(screen.queryByText('No Dependencies Yet')).not.toBeInTheDocument()
  })
})

describe('no demo data, no browser cache', () => {
  it('a leftover demo-mode flag in localStorage changes nothing: real (empty) data, no demo rows', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    signInAs(ORG.a)
    vi.mocked(dependenciesService.getAll).mockResolvedValue([])
    await mountPage()

    expect(await screen.findByText('No dependencies recorded yet')).toBeInTheDocument()
    expect(dependenciesService.getAll).toHaveBeenCalled()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/demo|sample/i)
  })

  it('nothing about dependencies is written to localStorage', async () => {
    signInAs(ORG.a)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await mountPage()
    await screen.findByText('Total dependencies')
    await openTab(/List View/)
    await screen.findByText('Showing 3 of 3 dependencies')

    const written = setItem.mock.calls.map(([key]) => key)
    expect(written.filter(key => key.startsWith('dependencies_cache'))).toEqual([])
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      expect(key.startsWith('dependencies_cache')).toBe(false)
      expect(localStorage.getItem(key)).not.toContain('reads orders')
    }
  })
})

describe('organization isolation', () => {
  it('every query this page makes is keyed by the session\'s organization', async () => {
    signInAs(ORG.a)
    const client = await mountPage()
    await screen.findByText('node: Checkout API')
    await waitFor(() => expect(stat('Circular cycles')).toBe('0'))

    const pageQueries = client.getQueryCache().getAll().filter(q => q.queryKey[0] === 'dependencies')
    // Before the token is read (first render) the keys carry null and stay
    // disabled: never fetched, never holding data.
    for (const q of pageQueries.filter(q => q.queryKey[1] === null)) {
      expect(q.state.data).toBeUndefined()
      expect(q.state.dataUpdatedAt).toBe(0)
      expect(q.state.fetchStatus).toBe('idle')
    }
    const fetched = pageQueries.filter(q => q.queryKey[1] !== null)
    expect(fetched.map(q => q.queryKey[2]).sort()).toEqual(['cycles', 'graph', 'list', 'services'])
    for (const q of fetched) expect(q.queryKey[1]).toBe(ORG.a.id)
    expect(client.getQueryData(['dependencies', ORG.a.id, 'list'])).toEqual(DEPS)
  })

  it('signing in as another organization: the previous organization\'s rows never render, while loading or after', async () => {
    signInAs(ORG.a)
    const client = await mountPage()
    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()

    const orgBRows = deferred<ServiceDependency[]>()
    vi.mocked(dependenciesService.getAll).mockReturnValue(orgBRows.promise)
    vi.mocked(dependenciesService.getGraph).mockReturnValue(new Promise(() => {}))
    vi.spyOn(authService, 'login').mockResolvedValue({
      accessToken: accessTokenFor(ORG.b.id),
      refreshToken: 'refresh-token',
      user: USER,
      organization: ORG.b,
    } as never)

    await click('test: log in')

    // Org A's entries are gone from the query cache and from the page.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading dependencies...'))
    expect(client.getQueryData(['dependencies', ORG.a.id, 'list'])).toBeUndefined()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()
    expect(screen.queryByText('node: Checkout API')).not.toBeInTheDocument()

    await act(async () => {
      orgBRows.resolve([{ ...DEPS[1], id: 'b1', organizationId: ORG.b.id }])
    })

    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()
    expect(stat('Total dependencies')).toBe('1')
    expect(client.getQueryData(['dependencies', ORG.b.id, 'list'])).toEqual([{ ...DEPS[1], id: 'b1', organizationId: ORG.b.id }])
    expect(client.getQueryData(['dependencies', ORG.a.id, 'list'])).toBeUndefined()
  })

  it('signing in as another organization whose load fails: an error, never the previous organization\'s rows', async () => {
    signInAs(ORG.a)
    await mountPage()
    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()

    vi.mocked(dependenciesService.getAll).mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(authService, 'login').mockResolvedValue({
      accessToken: accessTokenFor(ORG.b.id),
      refreshToken: 'refresh-token',
      user: USER,
      organization: ORG.b,
    } as never)

    await click('test: log in')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()
    expect(screen.queryByText('No dependencies recorded yet')).not.toBeInTheDocument()
  })

  it('logout drops the organization\'s rows from the query cache and the page', async () => {
    signInAs(ORG.a)
    const client = await mountPage()
    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()

    await click('test: log out')

    await waitFor(() => expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument())
    expect(client.getQueryData(['dependencies', ORG.a.id, 'list'])).toBeUndefined()
  })

  it('another tab signs in as a different organization: this tab\'s in-flight load is discarded, not stored or shown as the old organization\'s', async () => {
    signInAs(ORG.a)
    const client = await mountPage()
    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()

    // A refetch starts as org A; while it is in flight, another tab signs in
    // as org B (the access token in the shared localStorage changes), so the
    // response is org B's. Nothing in this tab re-renders in between.
    const inFlight = deferred<ServiceDependency[]>()
    vi.mocked(dependenciesService.getAll).mockReturnValue(inFlight.promise)
    let refetch!: Promise<unknown>
    await act(async () => {
      refetch = client.refetchQueries({ queryKey: ['dependencies', ORG.a.id, 'list'] }).catch(() => {})
    })
    localStorage.setItem('accessToken', accessTokenFor(ORG.b.id))
    await act(async () => {
      inFlight.resolve([{ ...DEPS[0], id: 'b1', description: 'org B row' }])
      await refetch
    })

    // Org A's entry still holds org A's rows; org B's never landed under it.
    expect(client.getQueryData(['dependencies', ORG.a.id, 'list'])).toEqual(DEPS)
    expect(client.getQueryState(['dependencies', ORG.a.id, 'list'])?.error?.name).toBe('SessionOrganizationChangedError')
    expect(await screen.findByText(/Your session switched to a different organization/)).toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('org B row')
  })
})

describe('Add Dependency is for owners and admins only', () => {
  it.each(['member', 'viewer'])('%s: no Add Dependency button', async (role) => {
    signInAs(ORG.a, role)
    await mountPage()
    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()
    await screen.findByText('node: Checkout API')
    expect(screen.queryByRole('button', { name: 'Add new dependency' })).not.toBeInTheDocument()
  })

  it('viewer with no dependencies: told to ask an owner or admin, no button', async () => {
    signInAs(ORG.a, 'viewer')
    vi.mocked(dependenciesService.getAll).mockResolvedValue([])
    await mountPage()

    expect(await screen.findByText(/Ask one to record which services depend on each other/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add new dependency' })).not.toBeInTheDocument()
  })

  it('admin: creates through the API and refreshes this organization\'s data', async () => {
    signInAs(ORG.a, 'admin')
    const create = vi.spyOn(dependenciesService, 'create').mockResolvedValue(DEPS[0])
    await mountPage()
    await screen.findByText('node: Checkout API')

    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Add new dependency' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Add Service Dependency' })
    const [source, target] = within(dialog).getAllByRole('combobox')
    await chooseOption(source, 'Checkout API')
    await chooseOption(target, 'Orders DB')
    const callsBefore = vi.mocked(dependenciesService.getAll).mock.calls.length
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create Dependency' })) })

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      sourceServiceId: 'svc-api',
      targetServiceId: 'svc-db',
      dependencyType: 'runtime',
      description: undefined,
      isCritical: false,
    }))
    await waitFor(() => expect(vi.mocked(dependenciesService.getAll).mock.calls.length).toBeGreaterThan(callsBefore))
  })
})

describe('search and filters (list view)', () => {
  async function listView() {
    signInAs(ORG.a)
    await mountPage()
    await screen.findByText('Total dependencies')
    await openTab(/List View/)
    await screen.findByText('Showing 3 of 3 dependencies')
  }

  it('search matches service names and descriptions literally, case-insensitively', async () => {
    await listView()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search dependencies' }), { target: { value: 'MAIL' } })
    expect(screen.getByText('Showing 2 of 3 dependencies')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search dependencies' }), { target: { value: 'reads orders' } })
    expect(screen.getByText('Showing 1 of 3 dependencies')).toBeInTheDocument()
  })

  it('type and priority filters use the recorded fields; no match offers a reset', async () => {
    await listView()

    await chooseOption(screen.getByRole('combobox', { name: 'Filter by type' }), 'Deployment')
    expect(screen.getByText('Showing 1 of 3 dependencies')).toBeInTheDocument()
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Mail QueueOrders DBDeployment')

    await chooseOption(screen.getByRole('combobox', { name: 'Filter by priority' }), 'Standard Only')
    expect(screen.getByText('No dependencies match your search or filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }))
    expect(screen.getByText('Showing 3 of 3 dependencies')).toBeInTheDocument()

    await chooseOption(screen.getByRole('combobox', { name: 'Filter by priority' }), 'Critical Only')
    expect(screen.getByText('Showing 2 of 3 dependencies')).toBeInTheDocument()
  })
})
