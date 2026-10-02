/**
 * Monitoring Truthfulness Phase 1 regression coverage.
 *
 * Confirmed issues being fixed:
 * 1. When AWS was not connected (or connection state hadn't resolved yet), the page could
 *    populate the AWS "Service Health" table with DevControl's own Prometheus-backed
 *    infrastructure rows ("DevControl API", "PostgreSQL", "Node Exporter") -- a category
 *    confusion between the customer's AWS infrastructure and DevControl's own backend.
 * 2. That same fallback fabricated a `45ms` default latency and hardcoded uptime-history
 *    sparkline arrays when Prometheus genuinely had no data.
 * 3. `checkAwsConnection()` and the metrics fetch ran without sequencing, so
 *    `awsConnected === null` could let the fallback run before connection state was known.
 * 4. `ServiceHealthTable` hardcoded "Uptime (30d)" (no 30-day window exists anywhere in
 *    cloudwatch.service.ts's RANGE_CONFIG) and "p95 Latency" (every latency figure is an
 *    Average, never a percentile).
 *
 * Fixed by: removing the Prometheus fallback from the AWS Service Health data path
 * entirely (DevControl's own status now lives in a separate <DevControlPlatformStatus>
 * component/state, never touching `services`), sequencing the AWS connection check before
 * any CloudWatch fetch and passing its resolved value explicitly into fetchMetrics()
 * rather than relying on a state closure, and making ServiceHealthTable's labels
 * prop-driven instead of hardcoded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import MonitoringPage from '../page'
import { alertHistoryService } from '@/lib/services/alert-history.service'
import type { AlertHistoryResponse } from '@/lib/types'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

const mockUseDemoMode = vi.fn()
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => mockUseDemoMode() }))

vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

vi.mock('@/lib/services/alert-history.service', () => ({
  alertHistoryService: { getAlertHistory: vi.fn().mockResolvedValue({ data: [] }) },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function ec2ServiceRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    resourceId: 'i-123', name: 'i-123', description: 'EC2 · i-123', resourceType: 'ec2',
    status: 'healthy', uptime: 99.9, responseTimeMs: null, errorRate: null, critical: true, monitored: true,
    ...overrides,
  }
}

function cloudWatchMetricsFixture(overrides: Partial<Record<string, any>> = {}) {
  return {
    accountId: 'acct-1', nickname: null, region: 'us-east-1',
    uptime: 99.9, avgResponseTimeMs: 120, requestsPerMinute: 10, errorRate: 0, monthlyCost: 100, trendPercent: 0,
    responseTimeHistory: [],
    coverage: { ec2: true, loadBalancer: false, rds: false, dynamodb: false, ecs: false, eks: false },
    resourceCounts: {
      ec2: { shown: 1, total: 1 }, loadBalancer: { shown: 0, total: 0 }, rds: { shown: 0, total: 0 },
      lambda: { shown: 0, total: 0 }, dynamodb: { shown: 0, total: 0 }, ecs: { shown: 0, total: 0 }, eks: { shown: 0, total: 0 },
    },
    // CloudWatch Scalability Phase 2D: complete-fleet aggregate + pagination metadata,
    // now required on every real API response -- defaulted here to match the single
    // ec2ServiceRow() fixture below (1 healthy, monitored resource, fully shown, no
    // further page) so existing tests in this file get realistic values without each
    // needing to specify them individually.
    healthSummary: { total: 1, healthy: 1, degraded: 0, critical: 0, down: 0, monitored: 1 },
    systemStatus: 'healthy',
    pagination: { shown: 1, total: 1, hasMore: false, cursor: null },
    services: [ec2ServiceRow()],
    capturedAt: new Date().toISOString(),
    ...overrides,
  }
}

// Configurable per-test controller for the two AWS endpoints, so a test can independently
// delay/order the /status and /metrics responses to exercise the sequencing fix.
function installFetchMock(opts: {
  connected: boolean
  metrics?: ReturnType<typeof cloudWatchMetricsFixture> | null
  statusDelayMs?: number
  metricsDelayMs?: number
  prometheusHealthOk?: boolean
  prometheusQueryResult?: (query: string) => any
}) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const delay = (ms: number, value: any) => new Promise((resolve) => setTimeout(() => resolve(value), ms))

    if (url.includes('/api/cloudwatch/status')) {
      return delay(opts.statusDelayMs ?? 0, {
        ok: true,
        json: async () => ({ success: true, data: { connected: opts.connected } }),
      })
    }
    if (url.includes('/api/cloudwatch/metrics')) {
      return delay(opts.metricsDelayMs ?? 0, {
        ok: true,
        json: async () => ({ success: opts.metrics != null, data: opts.metrics ?? null }),
      })
    }
    if (url.includes('/api/prometheus/health')) {
      return Promise.resolve({ ok: opts.prometheusHealthOk ?? false })
    }
    if (url.includes('/api/prometheus/query')) {
      const query = decodeURIComponent(new URL(url, 'http://localhost').searchParams.get('query') ?? '')
      const result = opts.prometheusQueryResult?.(query) ?? null
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success', data: result }) })
    }
    if (url.includes('/api/prometheus/snapshot')) {
      return Promise.resolve({ ok: true, json: async () => ({ success: false }) })
    }
    return Promise.resolve({ ok: false, json: async () => ({}) })
  }) as unknown as typeof fetch
}

describe('Monitoring page — AWS Service Health never contains DevControl self-monitoring data', () => {
  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('AWS connected with real CloudWatch data: renders only the real AWS resource, never DevControl-named rows', async () => {
    installFetchMock({ connected: true, metrics: cloudWatchMetricsFixture() })

    render(<MonitoringPage />)

    expect(await screen.findByText('i-123')).toBeInTheDocument()
    expect(screen.queryByText('DevControl API')).not.toBeInTheDocument()
    expect(screen.queryByText('PostgreSQL')).not.toBeInTheDocument()
    expect(screen.queryByText('Node Exporter')).not.toBeInTheDocument()
  })

  it('AWS not connected: shows no AWS service rows at all -- never substitutes Prometheus/DevControl data', async () => {
    installFetchMock({ connected: false, prometheusHealthOk: true, prometheusQueryResult: () => ({ result: [{ value: [0, '1'] }] }) })

    render(<MonitoringPage />)

    await waitFor(() => expect(screen.getByText('Stop Flying Blind on AWS')).toBeInTheDocument())
    // The AWS Service Health table must never have been populated from Prometheus.
    expect(screen.queryByText('i-123')).not.toBeInTheDocument()
  })

  it('AWS not connected: shows only one connect-AWS prompt, not a duplicate generic empty state underneath it', async () => {
    // Regression: making `services` honestly [] for the not-connected case (instead of
    // the removed Prometheus fallback's always-non-empty fabricated rows) made the
    // page's other, generic "services.length === 0" empty-state block newly reachable
    // here too, stacking a second "connect AWS" prompt under the specific one above.
    installFetchMock({ connected: false, prometheusHealthOk: false })

    render(<MonitoringPage />)

    await waitFor(() => expect(screen.getByText('Stop Flying Blind on AWS')).toBeInTheDocument())
    expect(screen.queryByText('Enterprise-Grade System Monitoring')).not.toBeInTheDocument()
  })

  it('sequencing regression: /api/cloudwatch/metrics resolving BEFORE /api/cloudwatch/status still never shows the not-connected fallback as AWS data', async () => {
    // This ordering used to be exactly what let the race manifest: the metrics fetch
    // finishing first, before awsConnected had been set, previously risked the Prometheus
    // path running under a stale/unknown connected value.
    installFetchMock({
      connected: false,
      metrics: null,
      statusDelayMs: 50,
      metricsDelayMs: 0,
      prometheusHealthOk: true,
      prometheusQueryResult: () => ({ result: [{ value: [0, '1'] }] }),
    })

    render(<MonitoringPage />)

    await waitFor(() => expect(screen.getByText('Stop Flying Blind on AWS')).toBeInTheDocument())
    expect(screen.queryByText('i-123')).not.toBeInTheDocument()
    // The bug this guards against would have shown DevControl's own Prometheus-derived
    // services as if they were the customer's monitored AWS services, inside
    // ServiceHealthTable. That table's `services` array must be empty here -- it's fine
    // (and correct, per the new design) for the *separate* DevControl Platform Status
    // section to legitimately show "DevControl API" from its own independent fetch.
    expect(screen.getByText('No services found')).toBeInTheDocument()
  })

  it('AWS connected but CloudWatch fetch fails: shows the honest CloudWatch-unavailable message, not a Prometheus error', async () => {
    installFetchMock({ connected: true, metrics: null })

    render(<MonitoringPage />)

    expect(await screen.findByText("Can't fetch CloudWatch metrics right now")).toBeInTheDocument()
    expect(screen.queryByText(/Unable to connect to Prometheus/)).not.toBeInTheDocument()
    // With no CloudWatch data there is no evidence about the customer's resources.
    expect(document.body.textContent).not.toMatch(/still running normally|not an outage/i)
  })
})

describe('Monitoring page — DevControl Platform Status is separate and never fabricates data', () => {
  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders real platform status separately from AWS Service Health when Prometheus is reachable', async () => {
    installFetchMock({
      connected: true,
      metrics: cloudWatchMetricsFixture(),
      prometheusHealthOk: true,
      prometheusQueryResult: (query) => {
        if (query.includes('up{job="devcontrol-api"}')) return { result: [{ value: [0, '1'] }] }
        if (query.includes('up{job="postgres-exporter"}')) return { result: [{ value: [0, '1'] }] }
        if (query.includes('up{job="node-exporter"}')) return { result: [{ value: [0, '1'] }] }
        return null
      },
    })

    render(<MonitoringPage />)

    expect(await screen.findByText('DevControl Platform Status')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('DevControl API').length).toBeGreaterThan(0))
    // The real AWS resource must still render distinctly in Service Health.
    expect(screen.getByText('i-123')).toBeInTheDocument()
  })

  it('never fabricates a default latency or fake history when Prometheus has no data', async () => {
    installFetchMock({
      connected: false,
      prometheusHealthOk: true,
      prometheusQueryResult: () => null, // no datapoints for any query
    })

    render(<MonitoringPage />)

    await screen.findByText('DevControl Platform Status')
    expect(screen.queryByText('45ms')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Main application server$/)).not.toBeInTheDocument()
  })

  it('shows an honest unavailable state when Prometheus itself cannot be reached', async () => {
    installFetchMock({ connected: false, prometheusHealthOk: false })

    render(<MonitoringPage />)

    await screen.findByText('DevControl Platform Status')
    expect(await screen.findByText('Status temporarily unavailable')).toBeInTheDocument()
  })
})

describe('Monitoring page — truthful labels', () => {
  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('never renders "Uptime (30d)" or "p95 Latency", and labels the actual selected window', async () => {
    installFetchMock({ connected: true, metrics: cloudWatchMetricsFixture() })

    render(<MonitoringPage />)

    await screen.findByText('i-123')
    expect(screen.queryByText('Uptime (30d)')).not.toBeInTheDocument()
    expect(screen.queryByText('p95 Latency')).not.toBeInTheDocument()
    expect(screen.getByText('Uptime (1h)')).toBeInTheDocument()
    expect(screen.getByText('Avg Latency')).toBeInTheDocument()
  })
})

describe('Monitoring page — Phase 2D detail pagination disclosure', () => {
  // CloudWatch Scalability Phase 2D: the per-scan evaluation cap this page used to
  // honestly disclose ("Showing a subset of resources for some types...", driven by
  // resourceCounts) no longer exists -- aggregate evaluation is now always complete, so
  // that banner was removed rather than left to silently never fire. It's replaced by a
  // pagination disclosure driven by the new `pagination` field, which answers a
  // different question ("how many of the evaluated resources are loaded/rendered right
  // now", not "were some resources never evaluated at all").
  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('discloses shown-vs-total and offers "Load more" when the backend reports more pages', async () => {
    installFetchMock({
      connected: true,
      metrics: cloudWatchMetricsFixture({
        healthSummary: { total: 40, healthy: 40, degraded: 0, critical: 0, down: 0, monitored: 40 },
        pagination: { shown: 1, total: 40, hasMore: true, cursor: 'opaque-cursor' },
      }),
    })

    render(<MonitoringPage />)

    expect(await screen.findByText(/Showing 1 of 40 resources/)).toBeInTheDocument()
    expect(screen.getByText('Load more resources')).toBeInTheDocument()
  })

  it('shows the shown/total line but no "Load more" control once the backend reports hasMore: false', async () => {
    installFetchMock({ connected: true, metrics: cloudWatchMetricsFixture() })

    render(<MonitoringPage />)

    expect(await screen.findByText(/Showing 1 of 1 resources/)).toBeInTheDocument()
    expect(screen.queryByText('Load more resources')).not.toBeInTheDocument()
    // The removed evaluation-cap banner must never reappear.
    expect(screen.queryByText(/Showing a subset of resources/)).not.toBeInTheDocument()
  })

  it('the never-fired-again old truncation banner text is gone for good, even with a resourceCounts shape that would have triggered it pre-2D', async () => {
    installFetchMock({
      connected: true,
      metrics: cloudWatchMetricsFixture({
        resourceCounts: {
          ec2: { shown: 15, total: 40 }, loadBalancer: { shown: 0, total: 0 }, rds: { shown: 0, total: 0 },
          lambda: { shown: 0, total: 0 }, dynamodb: { shown: 0, total: 0 }, ecs: { shown: 0, total: 0 }, eks: { shown: 0, total: 0 },
        },
      }),
    })

    render(<MonitoringPage />)

    await screen.findByText('i-123')
    expect(screen.queryByText(/EC2 instances: 15 of 40/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Showing a subset of resources/)).not.toBeInTheDocument()
  })

  it('clicking "Load more" requests the next page using the server-provided cursor', async () => {
    installFetchMock({
      connected: true,
      metrics: cloudWatchMetricsFixture({
        healthSummary: { total: 2, healthy: 2, degraded: 0, critical: 0, down: 0, monitored: 2 },
        pagination: { shown: 1, total: 2, hasMore: true, cursor: 'next-page-cursor' },
      }),
    })

    render(<MonitoringPage />)
    const loadMoreButton = await screen.findByText('Load more resources')
    loadMoreButton.click()

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, ...unknown[]]>
      const secondMetricsCall = calls.filter(([url]) => url.includes('/api/cloudwatch/metrics')).at(-1)
      expect(secondMetricsCall?.[0]).toContain('cursor=next-page-cursor')
    })
  })
})

describe('Monitoring page — the healthy summary claims only what CloudWatch shows', () => {
  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('an empty alert list is not reported as "no anomalies detected"', async () => {
    installFetchMock({ connected: true, metrics: cloudWatchMetricsFixture() })

    render(<MonitoringPage />)

    expect(await screen.findByText(/No issues detected in the latest resource checks: 1 of 1 resource reporting telemetry\./)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/anomal(y|ies) (were|was) detected|No reliability anomalies/i)
  })
})

describe('Monitoring page — resource check terminology', () => {
  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 1 EC2 (status checks), 2 EBS (status checks) -- today's production shape -- plus one
  // EBS whose check returned no result.
  const mixedFleet = () => cloudWatchMetricsFixture({
    healthSummary: { total: 5, healthy: 3, degraded: 0, critical: 0, down: 0, monitored: 4 },
    systemStatus: 'healthy',
    pagination: { shown: 1, total: 5, hasMore: false, cursor: null },
  })

  it('reports a factual count, never an "Overall Health" percentage or "Healthy" verdict', async () => {
    installFetchMock({ connected: true, metrics: mixedFleet() })
    render(<MonitoringPage />)

    // The KPI card (the section and table below share the "Resource Checks" title).
    const card = (await screen.findByText('3 of 4')).parentElement as HTMLElement
    expect(card).toHaveTextContent('Resource Checks')
    expect(card).toHaveTextContent('with no issues detected · 1 undetermined')
    expect(screen.queryByText('Overall Health')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/\b\d+% healthy|Infrastructure is healthy|no active health violations/i)
    expect(screen.getByTestId('check-summary')).toHaveTextContent(/^No issues detected\s*· 4 resources reporting telemetry · 3 with no issues detected · 0 with issues · 1 undetermined$/)
  })

  it('never counts an undetermined (unknown) result as passing', async () => {
    installFetchMock({ connected: true, metrics: mixedFleet() })
    render(<MonitoringPage />)

    expect(await screen.findByTestId('check-summary-text')).toHaveTextContent('No issues detected in the latest resource checks: 3 of 4 resources reporting telemetry (1 undetermined).')
  })

  it('when every reporting resource is undetermined, it says no check has a result -- not "no issues" or "healthy"', async () => {
    installFetchMock({
      connected: true,
      metrics: cloudWatchMetricsFixture({
        healthSummary: { total: 2, healthy: 0, degraded: 0, critical: 0, down: 0, monitored: 2 },
        systemStatus: 'healthy',
        services: [ec2ServiceRow({ status: 'unknown', uptime: null })],
      }),
    })
    render(<MonitoringPage />)

    expect(await screen.findByTestId('check-summary-text')).toHaveTextContent('2 resources are reporting telemetry, but no check has produced a result yet.')
    expect(screen.getByTestId('check-summary')).toHaveTextContent('No check results yet')
    expect(document.body.textContent).not.toMatch(/No issues detected|no active health violations|Infrastructure is healthy/)
  })

  it('uses "reporting telemetry" instead of the ambiguous "monitored"', async () => {
    installFetchMock({ connected: true, metrics: mixedFleet() })
    render(<MonitoringPage />)

    const card = (await screen.findByText('Reporting Telemetry', { selector: 'p' })).parentElement as HTMLElement
    expect(card).toHaveTextContent('4')
    expect(card).toHaveTextContent('of 5 discovered resources')
    expect(screen.queryByText('Monitored Resources')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/resources? monitored|currently monitored/i)
  })

  it('labels the fixed summary template as a check summary, not "AI Insight"', async () => {
    installFetchMock({ connected: true, metrics: mixedFleet() })
    render(<MonitoringPage />)

    expect(await screen.findByText('Check Summary')).toBeInTheDocument()
    expect(screen.queryByText('AI Insight')).not.toBeInTheDocument()
  })

  it('a degraded result is described as a resource check issue, not a "System Degraded" outage', async () => {
    installFetchMock({
      connected: true,
      metrics: cloudWatchMetricsFixture({
        healthSummary: { total: 1, healthy: 0, degraded: 1, critical: 0, down: 0, monitored: 1 },
        systemStatus: 'degraded',
        services: [ec2ServiceRow({ status: 'degraded' })],
      }),
    })
    render(<MonitoringPage />)

    expect(await screen.findByTestId('check-summary-text')).toHaveTextContent('One or more resources have a check issue.')
    expect(document.body.textContent).not.toMatch(/System Degraded|System is down/)
  })
})

describe('Monitoring page — Active Alerts only counts alerts it can actually see', () => {
  const getAlertHistory = vi.mocked(alertHistoryService.getAlertHistory)
  const emptyAlertHistory: AlertHistoryResponse = {
    success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  }
  // The KPI card (the section below it shares the "Active Alerts" title).
  const activeAlertsCard = () =>
    screen.getAllByText('Active Alerts', { selector: 'p' })
      .map((el) => el.parentElement as HTMLElement)
      .find((el) => /Needs attention|Not available|Could not be retrieved|Loading/.test(el.textContent ?? ''))!

  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
    installFetchMock({ connected: true, metrics: cloudWatchMetricsFixture() })
  })
  afterEach(() => {
    getAlertHistory.mockResolvedValue({ data: [] } as any)
    vi.restoreAllMocks()
  })

  it('an empty (organization-less) alert feed is not "no active alerts" or "all operational"', async () => {
    getAlertHistory.mockResolvedValue({ data: [] } as any)
    render(<MonitoringPage />)

    await waitFor(() => expect(activeAlertsCard().textContent).toMatch(/Not available for this organization/))
    expect(activeAlertsCard().textContent).toContain('—')
    expect(document.body.textContent).not.toMatch(/No active alerts|All Systems Operational/i)
  })

  it('a failed alert request is unavailable, not zero', async () => {
    getAlertHistory.mockRejectedValue(new Error('500'))
    render(<MonitoringPage />)

    await waitFor(() => expect(activeAlertsCard().textContent).toMatch(/Could not be retrieved/))
    expect(activeAlertsCard().textContent).toContain('—')
    expect(document.body.textContent).not.toMatch(/No active alerts|All Systems Operational/i)
  })

  it('AWS not connected: the alert state resolves instead of staying on "Loading…"', async () => {
    installFetchMock({ connected: false, prometheusHealthOk: false })
    getAlertHistory.mockClear()
    getAlertHistory.mockResolvedValue(emptyAlertHistory)
    render(<MonitoringPage />)

    await waitFor(() => expect(activeAlertsCard().textContent).toMatch(/Not available for this organization/))
    expect(getAlertHistory).toHaveBeenCalled()
    expect(activeAlertsCard().textContent).not.toMatch(/Loading/)
    expect(activeAlertsCard().textContent).toContain('—')
  })

  it('AWS not connected and the alert request fails: unavailable, not loading and not zero', async () => {
    installFetchMock({ connected: false, prometheusHealthOk: false })
    getAlertHistory.mockRejectedValue(new Error('500'))
    render(<MonitoringPage />)

    await waitFor(() => expect(activeAlertsCard().textContent).toMatch(/Could not be retrieved/))
    expect(activeAlertsCard().textContent).not.toMatch(/Loading/)
    expect(document.body.textContent).not.toMatch(/0 critical • 0 warnings/)
  })

  it('CloudWatch fetch fails: alerts are still fetched, so their state does not stay "loading"', async () => {
    // The CloudWatch error card replaces the KPI cards and alert panel, so the state
    // is observable only through the fetch that resolves it.
    installFetchMock({ connected: true, metrics: null })
    getAlertHistory.mockClear()
    getAlertHistory.mockResolvedValue(emptyAlertHistory)
    render(<MonitoringPage />)

    expect(await screen.findByText("Can't fetch CloudWatch metrics right now")).toBeInTheDocument()
    await waitFor(() => expect(getAlertHistory).toHaveBeenCalled())
    expect(document.body.textContent).not.toMatch(/Loading…|\d+ critical • \d+ warnings/)
  })

  it('unavailable alert data does not render severity counts in the Active Alerts panel', async () => {
    getAlertHistory.mockResolvedValue(emptyAlertHistory)
    render(<MonitoringPage />)

    await waitFor(() => expect(activeAlertsCard().textContent).toMatch(/Not available for this organization/))
    expect(document.body.textContent).not.toMatch(/\d+ critical • \d+ warnings/)
  })

  it('real firing alerts are counted', async () => {
    getAlertHistory.mockResolvedValue({
      data: [{ id: 'a1', alertName: 'High CPU', description: 'CPU above threshold', severity: 'critical', status: 'firing', serviceName: 'api', startedAt: '2026-09-27T08:00:00.000Z' }],
    } as any)
    render(<MonitoringPage />)

    await waitFor(() => expect(activeAlertsCard().textContent).toMatch(/Needs attention/))
    expect(activeAlertsCard().textContent).toContain('1')
    expect(screen.getAllByText('High CPU').length).toBeGreaterThan(0)
    // A confirmed result shows its counts, including a genuine zero.
    expect(screen.getByText('1 critical • 0 warnings')).toBeInTheDocument()
  })
})

describe('Monitoring page — "Last checked" is when the checks ran, not when the page loaded', () => {
  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const capturedAt = '2026-01-15T03:04:05.000Z'
  const expected = `Last checked ${new Date(capturedAt).toLocaleTimeString()}`

  it('header and status banner show capturedAt', async () => {
    installFetchMock({
      connected: true,
      metrics: cloudWatchMetricsFixture({
        capturedAt,
        systemStatus: 'degraded',
        healthSummary: { total: 1, healthy: 0, degraded: 1, critical: 0, down: 0, monitored: 1 },
        services: [ec2ServiceRow({ status: 'degraded', uptime: 98 })],
      }),
    })
    render(<MonitoringPage />)

    await waitFor(() => expect(screen.getAllByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toHaveLength(2))
    expect(document.body.textContent).not.toContain('Last synced')
  })

  it('omits "Last checked" when the response has no capturedAt', async () => {
    installFetchMock({ connected: true, metrics: cloudWatchMetricsFixture({ capturedAt: undefined }) })
    render(<MonitoringPage />)

    expect(await screen.findByText('i-123')).toBeInTheDocument()
    expect(screen.getByText('CloudWatch connected')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Last checked|Last synced/)
  })
})
