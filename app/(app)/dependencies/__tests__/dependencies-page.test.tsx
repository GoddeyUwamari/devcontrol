/**
 * /dependencies shows only what service_dependencies and the organization's
 * registered services hold -- no demo data, no generated trends or metrics, no
 * browser cache -- and never another organization's rows.
 *
 * Runs the REAL AuthProvider, the REAL page and the REAL service modules
 * (dependencies.service, services.service). The network is faked one level
 * lower, at the axios instance, answering with the JSON the backend routes
 * send (backend/src/controllers/dependencies.controller.ts,
 * backend/src/routes/services.routes.ts GET /registered), so the response
 * keys and snake_case transforms are exercised. Also faked: navigation, React
 * Flow's canvas, next/dynamic's loader and the file-producing export helpers.
 * The session's organization and role are the access token's claims, as the
 * backend scopes and authorizes by the JWT.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DependenciesPage, { LOADING_TIMEOUT_MS } from '../page'
import { AuthProvider, useAuth } from '@/lib/contexts/auth-context'
import api from '@/lib/api'
import { authService } from '@/lib/services/auth.service'
import { organizationsService } from '@/lib/services/organizations.service'
import { exportDependenciesToCSV } from '@/lib/export/csv-export'
import { exportDependencyReport } from '@/lib/export/pdf-export'

const push = vi.fn()
vi.mock('next/navigation', () => {
  const router = { push: (...a: unknown[]) => push(...a), replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return {
    useRouter: () => router,
    usePathname: () => '/dependencies',
    useSearchParams: () => new URLSearchParams(),
  }
})

// next/dynamic -> React.lazy, so the real graph, list, impact and dialog components render.
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

// The helpers that build and download files; their output is tested in lib/export/__tests__.
vi.mock('@/lib/export/csv-export', () => ({ exportDependenciesToCSV: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/export/pdf-export', () => ({ exportDependencyReport: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/export/graph-export', () => ({ exportGraphToPNG: vi.fn().mockResolvedValue(undefined) }))

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

// ── Backend rows, exactly as the routes return them ─────────────────────────

/** GET /api/services/registered rows. */
const REGISTERED = [
  { id: 'svc-api', name: 'Checkout API', owner: 'payments@example.invalid', team_id: null, team_name: null, github_url: null, created_at: '2026-10-01T00:00:00.000Z' },
  { id: 'svc-db', name: 'Orders DB', owner: 'data@example.invalid', team_id: null, team_name: null, github_url: null, created_at: '2026-10-01T00:00:00.000Z' },
  { id: 'svc-queue', name: 'Mail Queue', owner: 'ops@example.invalid', team_id: null, team_name: null, github_url: null, created_at: '2026-10-01T00:00:00.000Z' },
]
const nameOf = (id: string) => REGISTERED.find(s => s.id === id)?.name ?? null

/** GET /api/dependencies rows (DependenciesRepository.findAll). */
function depRow(id: string, source: string, target: string, type: string, isCritical: boolean, description: string | null = null, organizationId: string = ORG.a.id) {
  return {
    id,
    organization_id: organizationId,
    source_service_id: source,
    target_service_id: target,
    dependency_type: type,
    description,
    is_critical: isCritical,
    metadata: {},
    created_by: 'owner@example.invalid',
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    source_service_name: nameOf(source),
    target_service_name: nameOf(target),
    source_service_status: 'active',
    target_service_status: 'active',
  }
}

const DEP_ROWS = [
  depRow('d1', 'svc-api', 'svc-db', 'data', true, 'reads orders'),
  depRow('d2', 'svc-api', 'svc-queue', 'runtime', false),
  depRow('d3', 'svc-queue', 'svc-db', 'deployment', true),
]

/** GET /api/dependencies/graph (DependenciesRepository.getGraph). */
function graphFor(rows: ReturnType<typeof depRow>[]) {
  return {
    nodes: [
      { id: 'svc-api', type: 'default', position: { x: 0, y: 0 }, data: { label: 'Checkout API', status: 'active', owner: 'payments@example.invalid', template: 'api' } },
      { id: 'svc-db', type: 'default', position: { x: 250, y: 0 }, data: { label: 'Orders DB', status: 'active', owner: '', template: null } },
      { id: 'svc-queue', type: 'default', position: { x: 500, y: 0 }, data: { label: 'Mail Queue', status: 'active', owner: 'ops@example.invalid', template: 'worker' } },
    ],
    edges: rows.map(r => ({
      id: r.id, source: r.source_service_id, target: r.target_service_id,
      type: r.is_critical ? 'step' : 'smoothstep', label: r.dependency_type, animated: r.is_critical,
      data: { dependency_type: r.dependency_type, is_critical: r.is_critical, description: r.description },
    })),
  }
}

/** GET /api/dependencies/cycles items. */
const CYCLE = {
  cycle: [{ service_id: 'svc-api', service_name: 'Checkout API' }, { service_id: 'svc-queue', service_name: 'Mail Queue' }],
  path: 'Checkout API → Mail Queue → Checkout API',
  dependency_ids: [],
  severity: 'error',
}

/** GET /api/dependencies/impact/svc-api. */
const IMPACT = {
  service_id: 'svc-api',
  service_name: 'Checkout API',
  upstream_dependencies: [{ id: 'svc-db', name: 'Orders DB', dependency_type: 'data', is_critical: true }],
  downstream_dependencies: [],
  total_upstream: 1,
  total_downstream: 0,
  total_affected_if_fails: 0,
  critical_path: true,
}

// ── The fake server ─────────────────────────────────────────────────────────

type Handler = () => unknown | Promise<unknown>
interface ServerState {
  list: Handler
  graph: Handler
  cycles: Handler
  registered: Handler
  impact: (serviceId: string) => unknown | Promise<unknown>
}
let server: ServerState

/** An axios-style HTTP error. */
function httpError(status: number, error = 'Request failed') {
  return Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { success: false, error } } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function routeGet(url: string): Promise<{ data: unknown }> {
  if (url === '/api/services/registered') {
    const services = (await server.registered()) as unknown[]
    return { data: { success: true, services, total: services.length } }
  }
  if (url === '/api/dependencies') {
    const rows = (await server.list()) as unknown[]
    return { data: { success: true, data: rows, total: rows.length } }
  }
  if (url === '/api/dependencies/graph') return { data: { success: true, data: await server.graph() } }
  if (url === '/api/dependencies/cycles') return { data: { success: true, data: await server.cycles(), message: 'ok' } }
  const impact = url.match(/^\/api\/dependencies\/impact\/(.+)$/)
  if (impact) return { data: { success: true, data: await server.impact(impact[1]) } }
  throw httpError(404, `unexpected GET ${url}`)
}

const calls = (url: string) => vi.mocked(api.get).mock.calls.filter(([u]) => u === url).length

// What the retired page generated or hard-coded. None of it may come back.
const FABRICATED = /\d+\s?ms\b|\d+(\.\d+)?%|\/mo\b|req\/min|AI Analysis|AI Insight|Recommended Actions|confidence|Est\. impact|Combined latency|Email Queue|Auth Service|User Database|Healthy|Add Alert|Real-time|Demo Data|Demo Mode|vs last|Trend Tracking|Faster debugging|Fewer incidents|Coming soon|Interactive Preview/i

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

async function openMenu(trigger: HTMLElement) {
  await act(async () => { fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' }) })
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
  vi.mocked(exportDependenciesToCSV).mockClear()
  vi.mocked(exportDependencyReport).mockClear()
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {})
  vi.spyOn(authService, 'getCurrentUser').mockResolvedValue({ ...USER, organizations: [ORG.a, ORG.b] } as never)
  vi.spyOn(authService, 'logout').mockResolvedValue(undefined as never)
  vi.spyOn(organizationsService, 'getAll').mockResolvedValue([ORG.a, ORG.b] as never)
  server = {
    list: () => DEP_ROWS,
    graph: () => graphFor(DEP_ROWS),
    cycles: () => [],
    registered: () => REGISTERED,
    impact: () => IMPACT,
  }
  vi.spyOn(api, 'get').mockImplementation(((url: string) => routeGet(url)) as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('real data', () => {
  it('counts come from the rows the API returned; the original subtitle is back', async () => {
    signInAs(ORG.a)
    await mountPage()

    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()
    expect(stat('Total dependencies')).toBe('3')
    expect(stat('Critical')).toBe('2')
    expect(stat('Runtime')).toBe('1')
    await waitFor(() => expect(stat('Circular cycles')).toBe('0'))
    expect(screen.getByText('Analyze critical paths, detect bottlenecks, and understand system-wide impact.')).toBeInTheDocument()
    expect(calls('/api/dependencies')).toBeGreaterThan(0)
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
    expect(calls('/api/dependencies/graph')).toBeGreaterThan(0)
  })

  it('cycles from /api/dependencies/cycles raise the alert with its original sentence, the count and the list warning', async () => {
    signInAs(ORG.a)
    server.cycles = () => [CYCLE]
    await mountPage()

    const alert = await screen.findByText(/1 circular dependency cycle detected/)
    expect(alert).toHaveTextContent('This can cause deployment issues and runtime failures.')
    expect(stat('Circular cycles')).toBe('1')

    await click('View details')
    expect(await screen.findByText(CYCLE.path)).toBeInTheDocument()
  })

  it('a failed cycles request reads "Unavailable", not zero', async () => {
    signInAs(ORG.a)
    server.cycles = () => { throw httpError(500) }
    await mountPage()

    await waitFor(() => expect(stat('Circular cycles')).toBe('Unavailable'))
  })

  it('the impact selector lists the registered services from /api/services/registered and shows the API\'s analysis', async () => {
    signInAs(ORG.a)
    await mountPage()
    await screen.findByText('Total dependencies')

    await openTab(/Impact Analysis/)
    const trigger = await screen.findByRole('combobox')
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    const options = await screen.findAllByRole('option')
    expect(options.map(o => o.textContent)).toEqual(['Checkout API', 'Orders DB', 'Mail Queue'])
    fireEvent.click(screen.getByRole('option', { name: 'Checkout API' }))

    expect(await screen.findByText('Upstream Dependencies (1)')).toBeInTheDocument()
    expect(screen.getByText('Downstream Dependents (0)')).toBeInTheDocument()
    expect(screen.getByText('No downstream dependents')).toBeInTheDocument()
    expect(calls('/api/dependencies/impact/svc-api')).toBe(1)
    expect(calls('/api/services/registered')).toBeGreaterThan(0)
    expect(calls('/api/services')).toBe(0)
  })

  it('no registered services: the impact selector says so instead of an empty dropdown', async () => {
    signInAs(ORG.a)
    server.registered = () => []
    await mountPage()
    await screen.findByText('Total dependencies')

    await openTab(/Impact Analysis/)
    expect(await screen.findByText('No services yet.')).toBeInTheDocument()
  })
})

describe('header actions', () => {
  it('Refresh refetches this organization\'s dependency data', async () => {
    signInAs(ORG.a)
    await mountPage()
    await screen.findByText('node: Checkout API')
    await waitFor(() => expect(stat('Circular cycles')).toBe('0'))
    const before = { list: calls('/api/dependencies'), graph: calls('/api/dependencies/graph'), cycles: calls('/api/dependencies/cycles') }

    server.list = () => [...DEP_ROWS, depRow('d4', 'svc-db', 'svc-queue', 'runtime', false)]
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh dependencies' })) })

    await waitFor(() => expect(stat('Total dependencies')).toBe('4'))
    expect(calls('/api/dependencies')).toBe(before.list + 1)
    expect(calls('/api/dependencies/graph')).toBe(before.graph + 1)
    expect(calls('/api/dependencies/cycles')).toBe(before.cycles + 1)
  })

  it('Export as CSV exports the recorded rows and counts only', async () => {
    signInAs(ORG.a)
    server.cycles = () => [CYCLE]
    await mountPage()
    await screen.findByText(/1 circular dependency cycle detected/)

    await openMenu(screen.getByRole('button', { name: /Export/ }))
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: /Export as CSV/ })) })

    await waitFor(() => expect(exportDependenciesToCSV).toHaveBeenCalledTimes(1))
    const [rows, stats] = vi.mocked(exportDependenciesToCSV).mock.calls[0]
    expect(rows).toEqual([
      { serviceName: 'Checkout API', dependsOn: 'Orders DB', dependencyType: 'data', isCritical: true, description: 'reads orders' },
      { serviceName: 'Checkout API', dependsOn: 'Mail Queue', dependencyType: 'runtime', isCritical: false, description: '' },
      { serviceName: 'Mail Queue', dependsOn: 'Orders DB', dependencyType: 'deployment', isCritical: true, description: '' },
    ])
    expect(stats).toEqual(expect.objectContaining({ totalServices: 3, totalDependencies: 3, criticalDependencies: 2, circularDependencies: 1 }))
  })

  it('Export Report as PDF passes the detected cycle paths, and "Unavailable" cycles as null', async () => {
    signInAs(ORG.a)
    server.cycles = () => { throw httpError(500) }
    await mountPage()
    await waitFor(() => expect(stat('Circular cycles')).toBe('Unavailable'))

    await openMenu(screen.getByRole('button', { name: /Export/ }))
    await act(async () => { fireEvent.click(await screen.findByRole('menuitem', { name: /Export Report as PDF/ })) })

    await waitFor(() => expect(exportDependencyReport).toHaveBeenCalledTimes(1))
    const [, stats, , cyclePaths] = vi.mocked(exportDependencyReport).mock.calls[0]
    expect(stats.circularDependencies).toBeNull()
    expect(cyclePaths).toEqual([])
  })

  it('a first load still pending after the timeout says so and offers Refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    signInAs(ORG.a)
    server.list = () => new Promise(() => {})
    await mountPage()
    expect(await screen.findByText('Loading dependencies...')).toBeInTheDocument()
    expect(screen.queryByText('This is taking longer than usual')).not.toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(LOADING_TIMEOUT_MS) })

    expect(screen.getByText('This is taking longer than usual')).toBeInTheDocument()
    expect(screen.queryByText('No dependencies recorded yet.')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Refresh' }).length).toBeGreaterThan(0)
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

  it('a dependency shows its recorded type, priority, failure impact, description and author', async () => {
    signInAs(ORG.a)
    await mountPage()

    await click((await screen.findByText('edge: d1')).textContent!)
    const panel = await screen.findByRole('dialog', { name: 'Details: Checkout API → Orders DB' })

    expect(within(panel).getByText('Critical dependency')).toBeInTheDocument()
    expect(within(panel).getByText('Type').nextElementSibling).toHaveTextContent('Data')
    expect(within(panel).getByText('Priority').nextElementSibling).toHaveTextContent('Critical')
    expect(within(panel).getByText('Failure Impact').nextElementSibling).toHaveTextContent('Critical')
    expect(within(panel).getByText('Description').nextElementSibling).toHaveTextContent('reads orders')
    expect(within(panel).getByText('Recorded by').nextElementSibling).toHaveTextContent('owner@example.invalid')
    expect(within(panel).getByText('Traffic between services').nextElementSibling).toHaveTextContent('No data yet')
    expect(panel.textContent).not.toMatch(FABRICATED)
  })

  it('a standard dependency is labelled by its real type, with Moderate failure impact', async () => {
    signInAs(ORG.a)
    await mountPage()

    await click((await screen.findByText('edge: d2')).textContent!)
    const panel = await screen.findByRole('dialog', { name: 'Details: Checkout API → Mail Queue' })
    expect(within(panel).getByText('Runtime dependency')).toBeInTheDocument()
    expect(within(panel).getByText('Failure Impact').nextElementSibling).toHaveTextContent('Moderate')
  })

  it('"View Full Service" opens /services; "Analyze impact" opens impact analysis; Escape closes the panel', async () => {
    signInAs(ORG.a)
    await mountPage()

    await click((await screen.findByText('node: Checkout API')).textContent!)
    await screen.findByRole('dialog', { name: 'Details: Checkout API' })
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await click('node: Checkout API')
    await click('View Full Service')
    expect(push).toHaveBeenCalledWith('/services')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await click('node: Checkout API')
    await click('Analyze impact')
    expect(await screen.findByText('Upstream Dependencies (1)')).toBeInTheDocument()
    expect(calls('/api/dependencies/impact/svc-api')).toBe(1)
  })
})

describe('loading, empty and error are distinct', () => {
  it('loading: a status, not the empty state and not an error', async () => {
    signInAs(ORG.a)
    server.list = () => new Promise(() => {})
    await mountPage()

    expect(await screen.findByRole('status')).toHaveTextContent('Loading dependencies...')
    expect(screen.queryByText('No dependencies recorded yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()
  })

  it('empty: the enhanced empty state, with no fabricated claims; an owner can add the first dependency', async () => {
    signInAs(ORG.a, 'owner')
    server.list = () => []
    await mountPage()

    expect(await screen.findByText('No dependencies recorded yet.')).toBeInTheDocument()
    expect(screen.getByText('Map Your Service Architecture')).toBeInTheDocument()
    expect(screen.getByText('Example')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(FABRICATED)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()

    const add = await screen.findByRole('button', { name: /Add First Dependency/ })
    await waitFor(() => expect(add).toBeEnabled())
    await act(async () => { fireEvent.click(add) })
    expect(await screen.findByRole('dialog', { name: 'Add Service Dependency' })).toBeInTheDocument()
  })

  it('empty with no registered services: points an admin to adding a service first', async () => {
    signInAs(ORG.a, 'admin')
    server.list = () => []
    server.registered = () => []
    await mountPage()

    expect(await screen.findByText('Add a service first, then record which services depend on each other.')).toBeInTheDocument()
    await click('Add a service')
    expect(push).toHaveBeenCalledWith('/services/new')
    expect(screen.queryByRole('button', { name: /Add First Dependency/ })).not.toBeInTheDocument()
  })

  it('a failed request is an error with a retry, never an empty inventory', async () => {
    signInAs(ORG.a)
    let failOnce = true
    server.list = () => {
      if (failOnce) { failOnce = false; throw new TypeError('Failed to fetch') }
      return DEP_ROWS
    }
    await mountPage()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('No dependencies recorded yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /try again|retry/i })) })

    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()
    expect(stat('Total dependencies')).toBe('3')
    expect(calls('/api/dependencies')).toBe(2)
  })

  it('a failed graph request is an error in the graph view, not "No Dependencies Yet"', async () => {
    signInAs(ORG.a)
    server.graph = () => { throw httpError(500) }
    await mountPage()

    expect(await screen.findByText('Error Loading Graph')).toBeInTheDocument()
    expect(screen.queryByText('No Dependencies Yet')).not.toBeInTheDocument()
  })
})

describe('no demo data, no browser cache', () => {
  it('a leftover demo-mode flag in localStorage changes nothing: real (empty) data, no demo rows', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    signInAs(ORG.a)
    server.list = () => []
    await mountPage()

    expect(await screen.findByText('No dependencies recorded yet.')).toBeInTheDocument()
    expect(calls('/api/dependencies')).toBeGreaterThan(0)
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
    // Before the token is read the keys carry null and stay disabled:
    // never fetched, never holding data.
    for (const q of pageQueries.filter(q => q.queryKey[1] === null)) {
      expect(q.state.data).toBeUndefined()
      expect(q.state.dataUpdatedAt).toBe(0)
      expect(q.state.fetchStatus).toBe('idle')
    }
    const fetched = pageQueries.filter(q => q.queryKey[1] !== null)
    expect(fetched.map(q => q.queryKey[2]).sort()).toEqual(['cycles', 'graph', 'list', 'services'])
    for (const q of fetched) expect(q.queryKey[1]).toBe(ORG.a.id)
    expect((client.getQueryData(['dependencies', ORG.a.id, 'list']) as { id: string }[]).map(d => d.id)).toEqual(['d1', 'd2', 'd3'])
  })

  it('signing in as another organization: the previous organization\'s rows never render, while loading or after', async () => {
    signInAs(ORG.a)
    const client = await mountPage()
    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()

    const orgBRows = deferred<unknown[]>()
    server.list = () => orgBRows.promise
    server.graph = () => new Promise(() => {})
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
      orgBRows.resolve([depRow('b1', 'svc-api', 'svc-queue', 'runtime', false, null, ORG.b.id)])
    })

    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()
    expect(stat('Total dependencies')).toBe('1')
    expect((client.getQueryData(['dependencies', ORG.b.id, 'list']) as { id: string }[]).map(d => d.id)).toEqual(['b1'])
    expect(client.getQueryData(['dependencies', ORG.a.id, 'list'])).toBeUndefined()
  })

  it('signing in as another organization whose load fails: an error, never the previous organization\'s rows', async () => {
    signInAs(ORG.a)
    await mountPage()
    expect(await screen.findByText('Total dependencies')).toBeInTheDocument()

    server.list = () => { throw new TypeError('Failed to fetch') }
    vi.spyOn(authService, 'login').mockResolvedValue({
      accessToken: accessTokenFor(ORG.b.id),
      refreshToken: 'refresh-token',
      user: USER,
      organization: ORG.b,
    } as never)

    await click('test: log in')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('Total dependencies')).not.toBeInTheDocument()
    expect(screen.queryByText('No dependencies recorded yet.')).not.toBeInTheDocument()
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
    const inFlight = deferred<unknown[]>()
    server.list = () => inFlight.promise
    let refetch!: Promise<unknown>
    await act(async () => {
      refetch = client.refetchQueries({ queryKey: ['dependencies', ORG.a.id, 'list'] }).catch(() => {})
    })
    localStorage.setItem('accessToken', accessTokenFor(ORG.b.id))
    await act(async () => {
      inFlight.resolve([depRow('b1', 'svc-api', 'svc-db', 'data', true, 'org B row', ORG.b.id)])
      await refetch
    })

    // Org A's entry still holds org A's rows; org B's never landed under it.
    expect((client.getQueryData(['dependencies', ORG.a.id, 'list']) as { id: string }[]).map(d => d.id)).toEqual(['d1', 'd2', 'd3'])
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
    server.list = () => []
    await mountPage()

    expect(await screen.findByText(/Ask one to record which services depend on each other/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add First Dependency/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add new dependency' })).not.toBeInTheDocument()
  })

  it('admin: picks registered services and posts the body POST /api/dependencies expects', async () => {
    signInAs(ORG.a, 'admin')
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: depRow('d9', 'svc-api', 'svc-db', 'runtime', false), message: 'Dependency created successfully' },
    } as never)
    await mountPage()
    await screen.findByText('node: Checkout API')

    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Add new dependency' })) })
    const dialog = await screen.findByRole('dialog', { name: 'Add Service Dependency' })
    const [source, target] = within(dialog).getAllByRole('combobox')
    await chooseOption(source, 'Checkout API')
    await chooseOption(target, 'Orders DB')
    const listCallsBefore = calls('/api/dependencies')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Create Dependency' })) })

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/dependencies', {
      source_service_id: 'svc-api',
      target_service_id: 'svc-db',
      dependency_type: 'runtime',
      description: undefined,
      is_critical: false,
      metadata: undefined,
    }))
    await waitFor(() => expect(calls('/api/dependencies')).toBeGreaterThan(listCallsBefore))
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

  it('type and priority filters use the recorded fields, show removable chips, and no match offers a reset', async () => {
    await listView()
    expect(screen.queryByText('Active filters:')).not.toBeInTheDocument()

    await chooseOption(screen.getByRole('combobox', { name: 'Filter by type' }), 'Deployment')
    expect(screen.getByText('Showing 1 of 3 dependencies')).toBeInTheDocument()
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('Mail QueueOrders DBDeployment')
    expect(screen.getByText('Type: Deployment')).toBeInTheDocument()

    await chooseOption(screen.getByRole('combobox', { name: 'Filter by priority' }), 'Standard Only')
    expect(screen.getByText('Priority: Standard Only')).toBeInTheDocument()
    expect(screen.getByText('No dependencies match your search or filters')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Type: Deployment filter' }))
    expect(screen.queryByText('Type: Deployment')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 3 dependencies')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove Priority: Standard Only filter' }))
    expect(screen.queryByText('Active filters:')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 3 of 3 dependencies')).toBeInTheDocument()

    await chooseOption(screen.getByRole('combobox', { name: 'Filter by priority' }), 'Critical Only')
    expect(screen.getByText('Showing 2 of 3 dependencies')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Showing 3 of 3 dependencies')).toBeInTheDocument()
  })
})
