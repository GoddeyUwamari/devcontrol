/**
 * NEXT_PUBLIC_SECURITY_V2 off: /security renders and requests exactly what it
 * did before the Security Overview redesign.
 *
 * `__snapshots__/security-flag-off.<case>.html` and `.requests.txt` were written
 * by the page at af3262e, in a commit that adds only this test. Later commits
 * must leave them unchanged: every case runs with the flag unset and with each
 * value that must not turn the redesign on.
 *
 * Determinism: the zone is pinned to UTC and the clock is frozen before the
 * page module loads (the demo trend and the framework dates read the clock).
 * Only Date is faked: React Query and waitFor poll with real timers. Requests
 * are logged at the HTTP boundary (the axios instance and fetch), so the hooks
 * and services between them and the page run unmocked.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  const now = Date.parse('2026-10-23T15:00:00Z')
  vi.useFakeTimers({ toFake: ['Date'], now })
  return now
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SecurityPage from '../page'

type Route = { status: number; data?: unknown } | 'pending'

const m = vi.hoisted(() => ({
  log: [] as string[],
  demo: false,
  routes: {} as Record<string, { status: number; data?: unknown } | 'pending'>,
}))

/** Answers a logged request from the route table: 200 with a body, another status as an error, or never. */
function answer(method: string, path: string): Promise<{ data: unknown }> {
  m.log.push(`${method} ${path}`)
  const route = m.routes[path] ?? { status: 404 }
  if (route === 'pending') return new Promise(() => {})
  if (route.status === 200) return Promise.resolve({ data: { success: true, data: route.data } })
  return Promise.reject(Object.assign(new Error(`Request failed with status code ${route.status}`), { response: { status: route.status, data: {} } }))
}

vi.mock('@/lib/api', () => {
  const api = {
    get: (path: string) => answer('GET', path),
    post: (path: string) => answer('POST', path),
    put: (path: string) => answer('PUT', path),
    delete: (path: string) => answer('DELETE', path),
  }
  return {
    default: api,
    api,
    handleApiResponse: (response: { data: { success: boolean; data: unknown; message?: string } }) => {
      if (!response.data.success) throw new Error(response.data.message || 'API request failed')
      return response.data.data
    },
  }
})
vi.mock('@/lib/services/demo-mode.service', () => ({ demoModeService: { isEnabled: () => m.demo } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString()

const SCORE = {
  score: 86, grade: 'B', color: '#000000',
  factors: { encryption: 90, publicAccess: 80, backup: 70, compliance: 85, resourceManagement: 95 },
  complianceIssueCounts: { critical: 1, high: 2, medium: 1, low: 0 },
  accountFindingsCounts: { critical: 1, high: 1, medium: 1, low: 0 },
  resourceComplianceCounts: { critical: 0, high: 1, medium: 0, low: 0 },
  frameworksAtRisk: [],
  isPreliminary: false,
}
const TREND = {
  current: SCORE,
  trend: 'stable',
  trendPercentage: -3,
  history: [
    { date: '2026-10-21', score: 89, grade: 'B', factors: SCORE.factors },
    { date: '2026-10-22', score: 87, grade: 'B', factors: SCORE.factors },
    { date: '2026-10-23', score: 86, grade: 'B', factors: SCORE.factors },
  ],
  period: { start: '2026-09-23', end: '2026-10-23', days: 30 },
}
const FRAMEWORKS = [
  { id: 'fw-1', organization_id: 'org-1', name: 'Baseline A', description: null, framework_type: 'custom', enabled: true, is_default: false, standard_name: null, version: null, created_at: iso(40), updated_at: iso(40) },
  { id: 'fw-2', organization_id: 'org-1', name: 'Baseline B', description: null, framework_type: 'custom', enabled: true, is_default: false, standard_name: null, version: null, created_at: iso(40), updated_at: iso(40) },
]
const scan = (id: string, framework_id: string, status: string, score: unknown, createdDaysAgo: number) => ({
  id, organization_id: 'org-1', framework_id, scan_type: 'manual', status,
  total_resources: 10, compliant_resources: 0, non_compliant_resources: 10, compliance_score: score,
  critical_issues: 1, high_issues: 2, medium_issues: 0, low_issues: 0,
  started_at: iso(createdDaysAgo), completed_at: status === 'completed' ? iso(createdDaysAgo) : null, duration_seconds: 5, created_at: iso(createdDaysAgo),
})
const SCANS = [scan('s-1', 'fw-1', 'completed', '0.00', 34), scan('s-2', 'fw-2', 'running', null, 0.1)]

const finding = (over: Record<string, unknown>) => ({
  organization_id: 'org-1', recommendation: 'Restrict access.', region: 'us-east-1', status: 'active',
  detected_at: iso(12), last_seen_at: iso(0.2), resolved_at: null, disposition: null, disposition_actor_id: null,
  disposition_at: null, disposition_note: null, evidence: null, created_at: iso(12), updated_at: iso(0.2),
  derived_status: 'active', framework_mapping: null, ...over,
})
const FINDINGS = [
  finding({ id: 'af-1', finding_key: 'k1', category: 'networking', severity: 'critical', title: 'Security group "admin-sg" (sg-00000000000000001) allows SSH (port 22) from anywhere (0.0.0.0/0)', resource_identifier: 'arn:aws:ec2:us-east-1:000000000000:security-group/sg-00000000000000001' }),
  finding({ id: 'af-2', finding_key: 'k2', category: 'iam', severity: 'high', region: null, title: 'IAM user "example-user" has an access key (AKIAEXAMPLE000000001) that is 200 days old', resource_identifier: 'arn:aws:iam::000000000000:user/example-user' }),
  finding({ id: 'af-3', finding_key: 'k3', category: 'iam', severity: 'medium', region: null, title: 'IAM user "other-user" has no MFA device, and console access could not be verified', resource_identifier: 'arn:aws:iam::000000000000:user/other-user', derived_status: 'acknowledged', disposition: 'acknowledged', disposition_at: iso(1) }),
  finding({ id: 'af-4', finding_key: 'k4', category: 'networking', severity: 'high', title: 'Security group "web-sg" (sg-00000000000000002) allows port 443 from anywhere (0.0.0.0/0)', resource_identifier: 'arn:aws:ec2:us-east-1:000000000000:security-group/sg-00000000000000002', derived_status: 'accepted_risk', disposition: 'accepted_risk', disposition_at: iso(2), disposition_note: 'Public web server.' }),
]
const ANOMALIES = [{ id: 'an-1', organizationId: 'org-1', type: 'cpu_spike', severity: 'critical', resourceName: 'example-worker', resourceType: 'EC2', metric: 'cpu', currentValue: 92, expectedValue: 45, deviation: 104, historicalAverage: 45, historicalStdDev: 5, detectedAt: iso(1), timeWindow: '1h', title: 'Example anomaly', description: '', aiExplanation: '', impact: '', recommendation: '', confidence: 90, status: 'active' }]

const ok = (data: unknown): Route => ({ status: 200, data })
const fail = (status: number): Route => ({ status })

function connectedRoutes(): Record<string, Route> {
  return {
    '/api/risk-score/current': ok(SCORE),
    '/api/risk-score/trend?date_range=30d': ok(TREND),
    '/api/compliance-frameworks': ok(FRAMEWORKS),
    '/api/compliance-frameworks/scans/list?limit=50': ok(SCANS),
    '/api/security/account-findings': ok(FINDINGS),
    '/api/anomalies': ok({ anomalies: ANOMALIES }),
    '/api/anomalies/stats': ok({ active: 1, total: 3 }),
  }
}

function installFetch() {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const { pathname, search } = new URL(url, 'http://localhost')
    const path = pathname + search
    m.log.push(`fetch ${path}`)
    const route = m.routes[path] ?? { status: 404 }
    if (route === 'pending') return new Promise(() => {})
    const body = route.status === 200 ? route.data : { error: 'failed' }
    return Promise.resolve({ ok: route.status === 200, status: route.status, json: async () => body } as Response)
  }) as unknown as typeof fetch
}

/** React's useId values differ between two separate renders; everything else must not. */
const normalizeIds = (html: string) => html.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID')

beforeEach(() => {
  vi.setSystemTime(NOW)
  m.log.length = 0
  m.demo = false
  m.routes = connectedRoutes()
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch()
})
afterEach(() => { vi.unstubAllEnvs() })

/** Renders the page, lets every request settle (the framework hooks are plain state, not React Query), and returns the DOM and request log. */
async function capture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { container, unmount } = render(<QueryClientProvider client={client}><SecurityPage /></QueryClientProvider>)
  await waitFor(() => expect(client.isFetching()).toBe(0))
  for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
  await waitFor(() => expect(client.isFetching()).toBe(0))
  const html = normalizeIds(container.innerHTML)
  const requests = [...m.log].sort().join('\n') + '\n'
  unmount()
  client.clear()
  return { html, requests }
}

const CASES: Record<string, () => void> = {
  // 1. Connected, everything loaded: final score, trend, one framework at "0.00", one running, four findings in each disposition state, one anomaly.
  connected: () => {},
  // 2. Connected, nothing found: empty lists, no frameworks, no anomalies.
  empty: () => {
    m.routes['/api/compliance-frameworks'] = ok([])
    m.routes['/api/compliance-frameworks/scans/list?limit=50'] = ok([])
    m.routes['/api/security/account-findings'] = ok([])
    m.routes['/api/anomalies'] = ok({ anomalies: [] })
    m.routes['/api/anomalies/stats'] = ok({ active: 0, total: 0 })
  },
  // 3. Every request fails.
  error: () => {
    for (const path of Object.keys(m.routes)) m.routes[path] = fail(500)
  },
  // 4. Demo mode: the page's own fixtures, no score/trend/findings requests.
  demo: () => { m.demo = true },
  // 5. Free plan: the score and trend are Pro, the frameworks Enterprise.
  free: () => {
    m.routes['/api/risk-score/current'] = fail(402)
    m.routes['/api/risk-score/trend?date_range=30d'] = fail(402)
    m.routes['/api/compliance-frameworks'] = fail(403)
    m.routes['/api/compliance-frameworks/scans/list?limit=50'] = fail(403)
  },
}

/** The flag unset, and every value that must not enable the redesign (only the exact string 'true' does). */
const OFF_VALUES = ['unset', '', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']

describe('flag off: /security exactly as before the redesign', () => {
  it.each(Object.keys(CASES).flatMap((name) => OFF_VALUES.map((flag) => [name, flag])))('%s (flag %j)', async (name, flag) => {
    vi.stubEnv('NEXT_PUBLIC_SECURITY_V2', flag === 'unset' ? (undefined as unknown as string) : flag)
    CASES[name]()
    const { html, requests } = await capture()
    await expect(html).toMatchFileSnapshot(`./__snapshots__/security-flag-off.${name}.html`)
    await expect(requests).toMatchFileSnapshot(`./__snapshots__/security-flag-off.${name}.requests.txt`)
  })
})
