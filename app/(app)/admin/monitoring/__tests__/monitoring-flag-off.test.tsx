/**
 * NEXT_PUBLIC_OBSERVABILITY_V2 off (or demo mode): /admin/monitoring renders and
 * requests exactly what it did before the Operational Health page.
 *
 * `__snapshots__/monitoring-flag-off.<case>.html` and `.requests.txt` were written
 * by the page at a93daef (plus the backend-only OB2.1 commit), in a commit that
 * adds only this test. Later commits must leave them unchanged: every case runs
 * with the flag unset and with each value that must not turn the new page on,
 * and the demo cases also with the flag on (demo mode keeps the legacy page
 * until O4).
 *
 * Determinism: the zone is pinned to UTC, the clock is frozen before the page
 * module loads, and Math.random is fixed (the demo chart reads it). Only Date
 * is faked; the page's own timers run for real and are stopped by unmounting.
 * Requests are logged at the fetch boundary, so the page's services run
 * unmocked.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  const now = Date.parse('2026-10-29T15:00:00Z')
  vi.useFakeTimers({ toFake: ['Date'], now })
  return now
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import MonitoringPage from '../page'

type Route = { status: number; data?: unknown }

const m = vi.hoisted(() => ({
  log: [] as string[],
  demo: false,
  salesDemo: false,
  routes: {} as Record<string, { status: number; data?: unknown }>,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector?: (state: { enabled: boolean }) => unknown) => (selector ? selector({ enabled: m.salesDemo }) : { enabled: m.salesDemo }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const CAPTURED_AT = new Date(NOW - 60_000).toISOString()

const ec2Row = (over: Record<string, unknown> = {}) => ({
  resourceId: 'i-1234567890abcdef0', name: 'web-1', description: 'EC2 · i-1234567890abcdef0', resourceType: 'ec2',
  status: 'healthy', uptime: 99.9, responseTimeMs: null, errorRate: null, critical: true, monitored: true, ...over,
})

const metrics = (over: Record<string, unknown> = {}) => ({
  accountId: 'acct-1', nickname: null, region: 'us-east-1',
  uptime: 99.9, avgResponseTimeMs: 120, requestsPerMinute: 10, errorRate: 0, monthlyCost: 100, trendPercent: 0,
  responseTimeHistory: [],
  coverage: { ec2: true, loadBalancer: false, rds: false, lambda: false, dynamodb: false, ecs: false, eks: false, ebs: false, cloudfront: false, aurora: false },
  healthSummary: { total: 2, healthy: 1, degraded: 1, critical: 0, down: 0, monitored: 2 },
  systemStatus: 'degraded',
  pagination: { shown: 2, total: 2, hasMore: false, cursor: null },
  services: [ec2Row(), ec2Row({ resourceId: 'i-0bbbbbbbbbbbbbbbb', name: 'web-2', description: 'EC2 · i-0bbbbbbbbbbbbbbbb', status: 'degraded' })],
  capturedAt: CAPTURED_AT,
  ...over,
})

const FIRING = [{ id: 'a-1', alertName: 'High CPU', description: 'CPU above threshold', severity: 'warning', serviceName: 'web-1', startedAt: new Date(NOW - 600_000).toISOString() }]

const ok = (data: unknown): Route => ({ status: 200, data })
const fail = (status: number): Route => ({ status })

function connectedRoutes(): Record<string, Route> {
  return {
    '/api/cloudwatch/status': ok({ success: true, data: { connected: true } }),
    '/api/cloudwatch/metrics?range=1h': ok({ success: true, data: metrics() }),
    '/api/alerts/history?status=firing&limit=20': ok({ success: true, data: FIRING }),
    '/api/prometheus/snapshot': ok({ success: false }),
  }
}

function installFetch() {
  global.fetch = vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
    const { pathname, search } = new URL(url, 'http://localhost')
    const path = pathname + search
    m.log.push(`${init?.method ?? 'GET'} ${path}`)
    const route = m.routes[path] ?? { status: 404 }
    const body = route.status === 200 ? route.data : { error: 'failed' }
    return Promise.resolve({ ok: route.status === 200, status: route.status, statusText: String(route.status), json: async () => body } as Response)
  }) as unknown as typeof fetch
}

/** React's useId values differ between two separate renders; everything else must not. */
const normalizeIds = (html: string) => html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID')

beforeEach(() => {
  vi.setSystemTime(NOW)
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
  m.log.length = 0
  m.demo = false
  m.salesDemo = false
  m.routes = connectedRoutes()
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

/** Renders the page, lets its request chains settle, and returns the DOM and request log. */
async function capture() {
  const { container, unmount } = render(<MonitoringPage />)
  for (let i = 0; i < 25; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
  const html = normalizeIds(container.innerHTML)
  const requests = [...m.log].sort().join('\n') + '\n'
  unmount()
  return { html, requests }
}

const CASES: Record<string, () => void> = {
  // 1. Connected: two EC2 rows (one degraded), one firing alert, Prometheus unreachable.
  connected: () => {},
  // 2. Connected, more rows than one page.
  paginated: () => {
    m.routes['/api/cloudwatch/metrics?range=1h'] = ok({
      success: true,
      data: metrics({ healthSummary: { total: 30, healthy: 30, degraded: 0, critical: 0, down: 0, monitored: 30 }, systemStatus: 'healthy', services: [ec2Row()], pagination: { shown: 1, total: 30, hasMore: true, cursor: 'c1' } }),
    })
  },
  // 3. AWS not connected.
  not_connected: () => {
    m.routes['/api/cloudwatch/status'] = ok({ success: true, data: { connected: false } })
    delete m.routes['/api/cloudwatch/metrics?range=1h']
  },
  // 4. Connected, but the CloudWatch metrics request fails.
  cloudwatch_failed: () => {
    m.routes['/api/cloudwatch/metrics?range=1h'] = fail(500)
  },
  // 5. Connected, the alert request fails.
  alerts_failed: () => {
    m.routes['/api/alerts/history?status=firing&limit=20'] = fail(500)
  },
  // 6. Prometheus reachable with no data.
  prometheus_up: () => {
    m.routes['/api/prometheus/health'] = ok({})
  },
  // 7. Demo mode (useDemoMode) and 8. sales demo: the page's own fixtures.
  demo: () => { m.demo = true },
  sales_demo: () => { m.salesDemo = true },
}

/** The flag unset, and every value that must not turn the new page on (only the exact string 'true' does). */
const OFF_VALUES = ['unset', '', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']
const DEMO_CASES = new Set(['demo', 'sales_demo'])

const runs = Object.keys(CASES).flatMap((name) => [...OFF_VALUES, ...(DEMO_CASES.has(name) ? ['true'] : [])].map((flag) => [name, flag]))

describe('flag off (or demo mode): /admin/monitoring exactly as before Operational Health', () => {
  it.each(runs)('%s (flag %j)', async (name, flag) => {
    vi.stubEnv('NEXT_PUBLIC_OBSERVABILITY_V2', flag === 'unset' ? (undefined as unknown as string) : flag)
    CASES[name]()
    const { html, requests } = await capture()
    await expect(html).toMatchFileSnapshot(`./__snapshots__/monitoring-flag-off.${name}.html`)
    await expect(requests).toMatchFileSnapshot(`./__snapshots__/monitoring-flag-off.${name}.requests.txt`)
  })
})
