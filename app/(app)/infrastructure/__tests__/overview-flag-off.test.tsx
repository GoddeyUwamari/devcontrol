/**
 * NEXT_PUBLIC_INFRA_OVERVIEW_V2 off: /infrastructure renders and requests
 * exactly what it did before the Infrastructure Overview redesign.
 *
 * `__snapshots__/infra-flag-off.<case>.html` and `.requests.txt` were written
 * by the page before the redesign (origin/main 53f2e69; the page and every
 * file it imports are byte-identical to 7f208bc, after PR C #242), in a commit
 * that adds only this test. Later commits must leave them unchanged: the
 * same cases run with the flag unset and with it set to 'false'.
 *
 * Determinism: the zone is pinned to UTC and the clock is frozen before the
 * page module loads (DEMO_RESOURCES calls new Date() at load; rows render
 * "Added {date}"; the posture strip renders "Calculated … ago"). Only Date is
 * faked: React Query and findBy* poll with real timers.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  const now = Date.parse('2026-10-23T15:00:00Z')
  vi.useFakeTimers({ toFake: ['Date'], now })
  return now
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'

const m = vi.hoisted(() => ({
  log: [] as string[],
  resourceParam: null as string | null,
  demo: false,
  salesDemo: false,
  plan: { isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true } as Record<string, unknown>,
  getAll: vi.fn(),
  recsGetAll: vi.fn(),
  recsGetStats: vi.fn(),
  getDashboardStats: vi.fn(),
  servicesGetStats: vi.fn(),
  discoverServices: vi.fn(),
  intel: undefined as unknown,
  intelPending: false,
  anomalies: [] as unknown[],
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const logged = (name: string, fn: (...a: any[]) => any) => (...args: unknown[]) => {
  m.log.push(`${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
  return fn(...args)
}

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (k: string) => (k === 'resource' ? m.resourceParam : null) }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/infrastructure',
}))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => m.plan }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: m.salesDemo }) }))
vi.mock('@/lib/services/infrastructure.service', () => ({
  infrastructureService: { getAll: (...a: unknown[]) => logged('infrastructureService.getAll', m.getAll)(...a) },
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: (...a: unknown[]) => logged('costRecommendationsService.getAll', m.recsGetAll)(...a),
    getStats: (...a: unknown[]) => logged('costRecommendationsService.getStats', m.recsGetStats)(...a),
    // As the real client: the count is read through getStats (a second request).
    getActiveCount: async () => {
      m.log.push('costRecommendationsService.getActiveCount()')
      const s = await logged('costRecommendationsService.getStats', m.recsGetStats)()
      return s?.activeRecommendations ?? 0
    },
  },
}))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: {
    getDashboardStats: (...a: unknown[]) => logged('platformStatsService.getDashboardStats', m.getDashboardStats)(...a),
    getCostSummary: (...a: unknown[]) => logged('platformStatsService.getCostSummary', async () => { throw new Error('not expected') })(...a),
  },
}))
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getStats: (...a: unknown[]) => logged('awsServicesService.getStats', m.servicesGetStats)(...a),
    discoverServices: (...a: unknown[]) => logged('awsServicesService.discoverServices', m.discoverServices)(...a),
    getServices: (...a: unknown[]) => logged('awsServicesService.getServices', async () => { throw new Error('not expected') })(...a),
    getCoverage: (...a: unknown[]) => logged('awsServicesService.getCoverage', async () => { throw new Error('not expected') })(...a),
  },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const iso = (h: number) => new Date(NOW - h * 3600_000).toISOString()

const resource = (id: string, resourceType: string, status: string | null, costPerMonth: number | null, serviceName = `name-${id}`) => ({
  id, serviceId: `svc-${id}`, serviceName, resourceType, awsId: `aws-${id}`, awsRegion: id.startsWith('w') ? 'us-west-2' : 'us-east-1',
  status, costPerMonth, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
})

const RESOURCES = [
  resource('ec2-run', 'ec2', 'running', 61.32, 'api-server'),
  resource('ec2-stop', 'ec2', 'stopped', 30.37, 'batch-worker'),
  resource('ebs-avail', 'ebs', 'available', 8, 'scratch-volume'),
  resource('ebs-inuse', 'ebs', 'in-use', 4, 'root-volume'),
  resource('ebs-err', 'ebs', 'error', null, 'broken-volume'),
  resource('s3-logs', 's3', null, null, 'logs-bucket'),
  resource('w-rds', 'rds', 'running', 124.1, 'orders-db'),
]

const SERVICES_STATS = {
  total: 7, healthy: 5, needs_attention: 2,
  findings_by_severity: { critical: 0, high: 1, medium: 2, low: 0 },
  attention_reasons: { failed: 1, stopped_or_degraded: 1, with_finding: 1, with_cost_recommendation: 0 },
}

const DASHBOARD_STATS = {
  totalServices: 3, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0,
  monthlyAwsCost: 1234.56, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual',
}

const INTEL_READY = {
  system_score: 72, status: 'Stable', composite_state: 'partial',
  composite_reason: 'Alert Coverage: Measures EC2 and RDS alert coverage only.',
  top_action: { message: 'Unattached EBS volumes', path: '/cost-optimization', severity: 'medium' },
  top_drivers: [{ type: 'observability', impact_score: 9 }],
  components: {
    cost: { score: 91, detail: '', status: 'good', state: 'available', reason: null },
    security: { score: 80, detail: '', status: 'good', state: 'available', reason: null },
    observability: { score: 70, detail: 'Alert coverage 70% · EC2/RDS only', status: 'warning', state: 'partial', reason: 'Measures EC2 and RDS alert coverage only.' },
  },
  computed_at: iso(0.2),
}

const rec = (id: string, issue: string, potentialSavings: number, savings_basis: string | undefined) => ({
  id, resourceId: id, resourceName: `res-${id}`, resourceType: 'EBS', issue, potentialSavings, severity: 'LOW', status: 'ACTIVE',
  awsRegion: 'us-east-1', metadata: savings_basis ? { savings_basis } : {}, createdAt: '', updatedAt: '',
})
const RECS = [
  rec('vol-a', 'Unattached EBS Volume', 12.4, 'estimated: list price'),
  rec('bucket-a', 'S3 Lifecycle Optimization', 41.27, 'ceiling: assumes 100% transitions'),
]
const RECS_STATS = { totalPotentialSavings: 12.4, activeRecommendations: 2 }

function installFetch() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const path = new URL(url).pathname
    m.log.push(`fetch(${path})`)
    if (path === '/api/observability/intelligence') {
      if (m.intelPending) return new Promise(() => {})
      return Promise.resolve(m.intel === undefined
        ? ({ ok: false } as Response)
        : ({ ok: true, json: async () => ({ data: m.intel }) } as Response))
    }
    if (path === '/api/anomalies') return Promise.resolve({ ok: true, json: async () => ({ anomalies: m.anomalies }) } as Response)
    return Promise.resolve({ ok: false } as Response)
  }) as unknown as typeof fetch
}

/** React's useId values differ between two separate renders; everything else must not. */
const normalizeIds = (html: string) => html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID')

const scrollIntoView = vi.fn()

beforeEach(() => {
  vi.setSystemTime(NOW)
  m.log.length = 0
  m.resourceParam = null
  m.demo = false
  m.salesDemo = false
  m.plan = { isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true }
  m.getAll.mockReset().mockResolvedValue(RESOURCES)
  m.recsGetAll.mockReset().mockResolvedValue(RECS)
  m.recsGetStats.mockReset().mockResolvedValue(RECS_STATS)
  m.getDashboardStats.mockReset().mockResolvedValue(DASHBOARD_STATS)
  m.servicesGetStats.mockReset().mockResolvedValue(SERVICES_STATS)
  m.discoverServices.mockReset().mockResolvedValue({ discovered: 7, warnings: [] })
  m.intel = INTEL_READY
  m.intelPending = false
  m.anomalies = [{ id: 'anomaly-1', severity: 'critical', title: 'Reliability issue on orders-db', resourceName: 'orders-db' }]
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  scrollIntoView.mockReset()
  Element.prototype.scrollIntoView = scrollIntoView
  installFetch()
})
afterEach(() => { vi.unstubAllEnvs() })

/** Renders the page, waits until every request has settled (`pending` may stay open), and returns the DOM and the request log. */
async function capture(opts: { pending?: number; after?: () => Promise<void> } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container, unmount } = render(<QueryClientProvider client={client}><InfrastructurePage /></QueryClientProvider>)
  await waitFor(() => expect(client.isFetching()).toBe(opts.pending ?? 0))
  await opts.after?.()
  const html = normalizeIds(container.innerHTML)
  const requests = [...m.log].sort().join('\n') + '\n'
  unmount()
  client.clear()
  return { html, requests }
}

const CASES: Record<string, () => Promise<{ html: string; requests: string }>> = {
  // 1. Connected, everything loaded: billed spend, posture ready, cost + reliability actions, EC2 running/stopped, EBS available/in-use/error, S3 with no estimate.
  connected: () => capture(),
  // 2. Posture not ready, then still loading (two renders, one file).
  'intel-not-ready': async () => {
    m.intel = undefined
    const notReady = await capture()
    m.log.length = 0
    m.intelPending = true
    const loading = await capture({ pending: 1, after: async () => { await screen.findByText('Calculating…') } })
    return { html: `${notReady.html}\n<!-- posture still loading -->\n${loading.html}`, requests: `${notReady.requests}-- posture still loading --\n${loading.requests}` }
  },
  // 3. Empty inventory.
  empty: () => {
    m.getAll.mockResolvedValue([])
    m.recsGetAll.mockResolvedValue([])
    m.recsGetStats.mockResolvedValue({ totalPotentialSavings: 0, activeRecommendations: 0 })
    m.servicesGetStats.mockResolvedValue({ total: 0, healthy: 0, needs_attention: 0 })
    m.anomalies = []
    m.intel = undefined
    return capture()
  },
  // 4. GET /api/infrastructure answers 402: the resource-limit prompt.
  'limit-402': () => {
    m.getAll.mockRejectedValue(Object.assign(new Error('Payment Required'), { response: { status: 402 } }))
    return capture({ after: async () => { await screen.findByText(/reached your resource limit/) } })
  },
  // 5. Free plan banner.
  free: () => {
    m.plan = { isFree: true, isStarter: false, isPro: false, isEnterprise: false, tier: 'free', canAccess: () => false }
    return capture()
  },
  // 6. Starter plan banner.
  starter: () => {
    m.plan = { isFree: false, isStarter: true, isPro: false, isEnterprise: false, tier: 'starter', canAccess: () => false }
    return capture()
  },
  // 7. /api/services/stats and /api/platform/stats/dashboard both fail.
  'stats-error': () => {
    m.servicesGetStats.mockRejectedValue(new Error('500'))
    m.getDashboardStats.mockRejectedValue(new Error('500'))
    return capture()
  },
  // 8. Demo mode: fixtures, no requests.
  demo: () => {
    m.demo = true
    return capture()
  },
  // 9. Sales demo: the same fixtures, no requests.
  'sales-demo': () => {
    m.salesDemo = true
    return capture()
  },
  // 10. ?resource=<id> from the command palette: the row is scrolled to and highlighted.
  'resource-param': () => {
    m.resourceParam = 'ec2-stop'
    return capture({ after: async () => { await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1)) } })
  },
  // 11. After a successful sync, before the 3-second reset: "Sync Complete" / "Done".
  'sync-complete': () => capture({
    after: async () => {
      // The mobile and desktop buttons share one state; the mobile one comes first.
      fireEvent.click(screen.getAllByRole('button', { name: /Sync AWS/ })[0])
      await screen.findByText('Sync Complete')
      await screen.findByText('Done')
    },
  }),
}

describe('flag off: /infrastructure exactly as before the redesign', () => {
  it.each(Object.keys(CASES).flatMap((name) => [[name, 'unset'], [name, 'false']]))('%s (flag %s)', async (name, flag) => {
    vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', flag === 'unset' ? (undefined as unknown as string) : 'false')
    const { html, requests } = await CASES[name]()
    await expect(html).toMatchFileSnapshot(`./__snapshots__/infra-flag-off.${name}.html`)
    await expect(requests).toMatchFileSnapshot(`./__snapshots__/infra-flag-off.${name}.requests.txt`)
  })
})
