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

describe('Monitoring page — resource-count truncation disclosure', () => {
  beforeEach(() => {
    mockUseDemoMode.mockReturnValue(false)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('discloses when a resource type was truncated by the per-scan cap', async () => {
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

    expect(await screen.findByText(/EC2 instances: 15 of 40/)).toBeInTheDocument()
  })

  it('shows no disclosure when nothing was truncated', async () => {
    installFetchMock({ connected: true, metrics: cloudWatchMetricsFixture() })

    render(<MonitoringPage />)

    await screen.findByText('i-123')
    expect(screen.queryByText(/Showing a subset of resources/)).not.toBeInTheDocument()
  })
})
