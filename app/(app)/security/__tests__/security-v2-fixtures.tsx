/**
 * Fixtures and a request harness for the Security Overview redesign's tests. Requests are answered at the
 * HTTP boundary (the axios instance and fetch, as security-flag-off.test.tsx), so the services and the
 * page's own query code run unmocked. vi.mock calls stay in each test file (they are hoisted per file).
 * Placeholders only: account 000000000000, sg-0123456789abcdef0, AKIAEXAMPLE000000001, example-* names.
 */
import { expect, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

export const NOW_ISO = '2026-10-23T15:00:00Z'
const NOW = Date.parse(NOW_ISO)
const DAY = 86_400_000
export const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

export type Route = { status: number; body?: unknown } | 'pending'
export interface Harness { log: string[]; routes: Record<string, Route> }

export const ok = (data: unknown): Route => ({ status: 200, body: { success: true, data } })
export const raw = (body: unknown): Route => ({ status: 200, body })
export const fail = (status: number): Route => ({ status })

/** Answers a logged request from the route table: 200 with its body, another status as an axios-style error, or never. */
export function answer(h: Harness, method: string, path: string): Promise<{ data: unknown }> {
  h.log.push(`${method} ${path}`)
  const route = h.routes[`${method} ${path}`] ?? { status: 404 }
  if (route === 'pending') return new Promise(() => {})
  if (route.status === 200) return Promise.resolve({ data: route.body })
  return Promise.reject(Object.assign(new Error(`Request failed with status code ${route.status}`), { response: { status: route.status, data: {} } }))
}

/** The '@/lib/api' module, answered by the harness. */
export function apiModule(h: Harness) {
  const api = {
    get: (path: string) => answer(h, 'GET', path),
    post: (path: string) => answer(h, 'POST', path),
    put: (path: string) => answer(h, 'PUT', path),
    delete: (path: string) => answer(h, 'DELETE', path),
  }
  return {
    default: api,
    api,
    handleApiResponse: (response: { data: { success: boolean; data: unknown; message?: string } }) => {
      if (!response.data.success) throw new Error(response.data.message || 'API request failed')
      return response.data.data
    },
  }
}

export function installFetch(h: Harness) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const { pathname, search } = new URL(url, 'http://localhost')
    const path = pathname + search
    h.log.push(`fetch ${path}`)
    const route = h.routes[`GET ${path}`] ?? { status: 404 }
    if (route === 'pending') return new Promise(() => {})
    const body = route.status === 200 ? route.body : { error: 'failed' }
    return Promise.resolve({ ok: route.status === 200, status: route.status, json: async () => body } as Response)
  }) as unknown as typeof fetch
}

// ── Data ──

export const ACCOUNT = '000000000000'
export const KEY = 'AKIAEXAMPLE000000001'
export const SG = 'sg-0123456789abcdef0'

export const SCORE = {
  score: 86, grade: 'B', color: '', factors: { encryption: 90, publicAccess: 80, backup: 70, compliance: 85, resourceManagement: 95 },
  complianceIssueCounts: { critical: 0, high: 0, medium: 0, low: 0 }, accountFindingsCounts: { critical: 0, high: 0, medium: 0, low: 0 },
  resourceComplianceCounts: { critical: 0, high: 0, medium: 0, low: 0 }, frameworksAtRisk: [], isPreliminary: false,
}
export const TREND = {
  current: SCORE, trend: 'stable', trendPercentage: -3,
  history: [
    { date: '2026-10-21', score: 89, grade: 'B', factors: SCORE.factors },
    { date: '2026-10-22', score: 87, grade: 'B', factors: SCORE.factors },
    { date: '2026-10-23', score: 86, grade: 'B', factors: SCORE.factors },
  ],
  period: { start: '2026-09-23', end: '2026-10-23', days: 30 },
}

let n = 0
export const finding = (over: Record<string, unknown>) => ({
  id: `af-${++n}`, organization_id: 'org-1', finding_key: `k-${n}`, category: 'iam', severity: 'high', title: 'A finding',
  recommendation: 'Review it.', resource_identifier: `arn:aws:iam::${ACCOUNT}:user/example-user`, region: null, status: 'active',
  detected_at: iso(10 * DAY), last_seen_at: iso(0), resolved_at: null, disposition: null, disposition_actor_id: null,
  disposition_at: null, disposition_note: null, evidence: null, created_at: iso(10 * DAY), updated_at: iso(0),
  derived_status: 'active', framework_mapping: null, ...over,
})
const sgEvidence = (protocol: string, from: number, to: number, name: string) => ({
  schema_version: 1, security_group_id: SG, security_group_name: name, region: 'us-east-1', direction: 'ingress',
  protocol, from_port: from, to_port: to, ip_version: 'v4', cidr: '0.0.0.0/0', detected_at: iso(0),
})

export const FINDINGS = [
  finding({
    id: 'af-admin', category: 'networking', region: 'us-east-1', severity: 'critical',
    title: `Security group "example-admin-sg" (${SG}) allows SSH (port 22) from anywhere (0.0.0.0/0)`,
    resource_identifier: `arn:aws:ec2:us-east-1:${ACCOUNT}:security-group/${SG}`, evidence: sgEvidence('tcp', 22, 22, 'example-admin-sg'),
    framework_mapping: { framework: 'CIS AWS Foundations Benchmark', version: '5.0.0', control: '5.3', title: 'Example control', securityHubControlId: 'EC2.53' },
  }),
  finding({
    id: 'af-key', severity: 'medium', title: `IAM user "example-user" has an access key (${KEY}) that is 120 days old`,
    evidence: {
      schema_version: 1, resource_type: 'iam_access_key', resource_identifier: `arn:aws:iam::${ACCOUNT}:user/example-user`,
      resource_name: 'example-user', finding_type: 'access_key_stale',
      relevant_aws_attributes: { access_key_id: KEY, age_in_days: 120, key_status: 'Active' }, detected_at: iso(0),
    },
  }),
  finding({ id: 'af-ack', severity: 'high', title: 'IAM user "example-ack" does not have MFA enabled', derived_status: 'acknowledged', disposition: 'acknowledged' }),
  finding({ id: 'af-acc', severity: 'high', title: 'IAM user "example-accepted" does not have MFA enabled', derived_status: 'accepted_risk', disposition: 'accepted_risk' }),
  finding({ id: 'af-dis', severity: 'low', title: 'IAM user "example-dismissed" does not have MFA enabled', derived_status: 'dismissed', disposition: 'dismissed' }),
]

export const RESOURCES = [
  {
    id: 'res-1', resource_name: 'example-bucket', resource_arn: 'arn:aws:s3:::example-bucket', resource_type: 's3', region: 'eu-west-1',
    issues: [{ severity: 'medium', category: 'encryption', issue: 'Bucket accepts requests over HTTP', recommendation: 'Deny insecure transport.', findingKey: 's3.https_only' }],
  },
]

export const ATTENTION = {
  success: true,
  services: [{ id: 'svc-1', name: 'example-bucket', type: 's3', region: 'eu-west-1', aws_region: 'eu-west-1', priority_severity: 'high', attention_cause: 'finding', reason: 'Bucket policy allows public access', needs_attention: true }],
  pagination: { page: 1, limit: 100, total: 1, total_pages: 1, has_more: false },
  counts: { needs_attention: 1, no_flagged_issues: 0 },
}

export const coverage = (over: Record<string, unknown> = {}) => ({
  account: { connected: true, status: 'active', home_region: 'us-east-1' },
  scope: {
    home_region: { region: 'us-east-1', count: 10 },
    s3: { in_last_scan: true, regions: [] },
    cloudfront: { in_last_scan: false, count: 0 },
    enabled_regions: { known: true, count: 17 },
  },
  region_status: [{ region: 'us-east-1', home: true, status: 'ok', last_scan_finished_at: iso(DAY / 4), last_success_at: iso(DAY / 4), last_error_code: null }],
  scan_in_progress: null,
  last_completed_scan: { started_at: iso(DAY / 4), completed_at: iso(DAY / 4), resource_types: ['ec2', 's3'], warnings: [] },
  last_successful_scan_at: iso(DAY / 4),
  last_scan: { status: 'completed', started_at: iso(DAY / 4), completed_at: iso(DAY / 4), warnings: [] },
  resource_types: ['ec2', 's3'], tags_unknown_by_type: {}, regions: [], total: 10,
  ...over,
})

export const framework = (id: string, name: string) => ({
  id, organization_id: 'org-1', name, description: null, framework_type: 'custom', enabled: true, is_default: false,
  standard_name: null, version: null, created_at: iso(40 * DAY), updated_at: iso(40 * DAY),
})
export const scan = (id: string, framework_id: string, status: string, score: unknown, msAgo: number) => ({
  id, organization_id: 'org-1', framework_id, scan_type: 'manual', status, total_resources: 10, compliant_resources: 9,
  non_compliant_resources: 1, compliance_score: score, critical_issues: 0, high_issues: 0, medium_issues: 0, low_issues: 0,
  started_at: iso(msAgo), completed_at: status === 'completed' || status === 'failed' ? iso(msAgo) : null, duration_seconds: 1, created_at: iso(msAgo),
})

export const SCANS_PATH = '/api/compliance-frameworks/scans/list?limit=50'
export const ATTENTION_PATH = '/api/services?needs_attention=true&page=1&limit=100'

/** Pro + Enterprise, connected, a finished scan, every source loaded. */
export function connectedRoutes(): Record<string, Route> {
  return {
    'GET /api/risk-score/current': ok(SCORE),
    'GET /api/risk-score/trend?date_range=30d': ok(TREND),
    'GET /api/security/account-findings': ok(FINDINGS),
    'GET /api/aws-resources/compliance': ok(RESOURCES),
    [`GET ${ATTENTION_PATH}`]: raw(ATTENTION),
    'GET /api/services/coverage': raw({ success: true, coverage: coverage() }),
    'GET /api/compliance-frameworks': ok([framework('fw-1', 'Example baseline')]),
    [`GET ${SCANS_PATH}`]: ok([scan('s-1', 'fw-1', 'completed', '92.50', 2 * DAY)]),
    'GET /api/anomalies/stats': raw({ success: true, stats: { active: 2, total: 5 } }),
    'POST /api/services/discover': raw({ success: true, discovered: 12, updated: 0, errors: [], warnings: [], message: 'ok' }),
  }
}

export function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

export function renderWith(client: QueryClient, ui: React.ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Until no query is fetching (`pending` may stay open). */
export async function settled(client: QueryClient, pending = 0) {
  await waitFor(() => expect(client.isFetching()).toBe(pending))
}
