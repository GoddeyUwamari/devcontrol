/**
 * Dashboard Resource checks section: lazy request of the canonical
 * /api/cloudwatch/metrics (same range as /admin/monitoring, never
 * refresh=true), counts from healthSummary only, check-specific wording per
 * resourceType in the response, and one honest line for every non-result
 * state. All figures are fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ResourceChecksSection, checkedAgo, resourceChecksView, shortResourceId } from '../resource-checks-section'
import { checkCountsFrom, RESOURCE_CHECKS_DEFAULT_RANGE } from '@/lib/resource-checks'

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  constructor(private cb: IntersectionObserverCallback, public options?: IntersectionObserverInit) { MockIntersectionObserver.instances.push(this) }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
  enter() { act(() => this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)) }
}
const enterViewport = () => MockIntersectionObserver.instances.forEach((o) => o.enter())

const row = (resourceType: string, resourceId: string, status: string, extra: Record<string, unknown> = {}) => ({
  resourceId, name: resourceId, description: '', resourceType, status, uptime: null, responseTimeMs: null, errorRate: null, critical: false, monitored: true, ...extra,
})
const summary = (s: Partial<Record<'total' | 'healthy' | 'degraded' | 'critical' | 'down' | 'monitored', number>>) =>
  ({ total: 0, healthy: 0, degraded: 0, critical: 0, down: 0, monitored: 0, ...s })
const metrics = (overrides: Record<string, unknown> = {}) => ({
  healthSummary: summary({ total: 3, healthy: 3, monitored: 3 }),
  systemStatus: 'healthy',
  services: [
    row('ec2', 'i-0c3e1234567890c59', 'healthy', { uptime: 100 }),
    row('ebs', 'vol-0aa', 'healthy'),
    row('ebs', 'vol-0bb', 'healthy'),
  ],
  pagination: { shown: 3, total: 3, hasMore: false, cursor: null },
  capturedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  ...overrides,
})

let fetchMock: ReturnType<typeof vi.fn>
const respond = (body: unknown) => fetchMock.mockImplementation(async () => ({ ok: true, json: async () => body }))
const metricsCalls = () => fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/cloudwatch/metrics'))

beforeEach(() => {
  MockIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const renderSection = (props: Partial<{ isDemoActive: boolean; organizationId: string | null; aboveLoaded: boolean }> = {}) =>
  render(<ResourceChecksSection isDemoActive={props.isDemoActive ?? false} organizationId={props.organizationId === undefined ? 'org-1' : props.organizationId} aboveLoaded={props.aboveLoaded} />)
const loaded = async () => { enterViewport(); await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull()) }
const summaryCard = () => screen.getByTestId('resource-checks-summary')
const section = () => screen.getByTestId('resource-checks-section')

describe('lazy request', () => {
  it('makes no request before the section enters the viewport, and exactly one after', async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    await act(async () => {})
    expect(metricsCalls()).toHaveLength(0)
    expect(within(summaryCard()).getByTestId('resource-checks-state')).toHaveTextContent('Loading…')
    enterViewport()
    await waitFor(() => expect(screen.getByTestId('resource-checks-value')).toBeInTheDocument())
    enterViewport()
    await act(async () => {})
    expect(metricsCalls()).toHaveLength(1)
  })

  it('counts as in view only when a quarter of the section is visible', async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0)
    for (const o of MockIntersectionObserver.instances) expect(o.options?.threshold).toBe(0.25)
  })

  it('does not watch the viewport while the sections above are still loading', async () => {
    respond({ success: true, data: metrics() })
    const { rerender } = renderSection({ aboveLoaded: false })
    expect(MockIntersectionObserver.instances).toHaveLength(0)
    enterViewport()
    await act(async () => {})
    expect(metricsCalls()).toHaveLength(0)
    rerender(<ResourceChecksSection isDemoActive={false} organizationId="org-1" aboveLoaded />)
    expect(metricsCalls()).toHaveLength(0)
    await loaded()
    expect(metricsCalls()).toHaveLength(1)
  })

  it('without IntersectionObserver, requests only once the sections above have loaded', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    respond({ success: true, data: metrics() })
    const { rerender } = renderSection({ aboveLoaded: false })
    await act(async () => {})
    expect(metricsCalls()).toHaveLength(0)
    rerender(<ResourceChecksSection isDemoActive={false} organizationId="org-1" aboveLoaded />)
    await waitFor(() => expect(metricsCalls()).toHaveLength(1))
  })

  it("sends one request under StrictMode's double-invoked effects", async () => {
    respond({ success: true, data: metrics() })
    render(<StrictMode><ResourceChecksSection isDemoActive={false} organizationId="org-1" /></StrictMode>)
    await loaded()
    expect(screen.getByTestId('resource-checks-value')).toBeInTheDocument()
    expect(metricsCalls()).toHaveLength(1)
  })

  it("a different organization requests again, and the previous organization's late response is dropped", async () => {
    let releaseFirst: (v: unknown) => void = () => {}
    fetchMock
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = resolve }))
      .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ success: true, data: null, connected: false }) }))
    const { rerender } = renderSection({ organizationId: 'org-1' })
    enterViewport()
    await waitFor(() => expect(metricsCalls()).toHaveLength(1))
    rerender(<ResourceChecksSection isDemoActive={false} organizationId="org-2" />)
    await waitFor(() => expect(metricsCalls()).toHaveLength(2))
    await waitFor(() => expect(within(summaryCard()).getByTestId('resource-checks-state')).toHaveTextContent('Not connected'))
    await act(async () => { releaseFirst({ ok: true, json: async () => ({ success: true, data: metrics() }) }) })
    expect(within(summaryCard()).getByTestId('resource-checks-state')).toHaveTextContent('Not connected')
    expect(screen.queryByTestId('resource-checks-value')).toBeNull()
  })

  it("never shows the previous organization's results while the next one loads", async () => {
    fetchMock
      .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ success: true, data: metrics() }) }))
      .mockImplementationOnce(() => new Promise(() => {}))
    const { rerender } = renderSection({ organizationId: 'org-1' })
    await loaded()
    expect(screen.getByTestId('resource-checks-value')).toBeInTheDocument()
    rerender(<ResourceChecksSection isDemoActive={false} organizationId="org-2" />)
    expect(within(summaryCard()).getByTestId('resource-checks-state')).toHaveTextContent('Loading…')
    expect(screen.queryByTestId('resource-checks-value')).toBeNull()
  })

  it("uses /admin/monitoring's range and never refresh=true", async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    await loaded()
    const url = new URL(metricsCalls()[0])
    expect(url.searchParams.get('range')).toBe(RESOURCE_CHECKS_DEFAULT_RANGE)
    expect(RESOURCE_CHECKS_DEFAULT_RANGE).toBe('1h')
    expect(url.searchParams.has('refresh')).toBe(false)
  })

  it('makes no request in demo mode, and renders nothing', async () => {
    respond({ success: true, data: metrics() })
    const { container } = renderSection({ isDemoActive: true })
    enterViewport()
    await act(async () => {})
    expect(metricsCalls()).toHaveLength(0)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('counts come from healthSummary', () => {
  it('M is every resource reporting telemetry (as on /admin/monitoring); undetermined is never passing and is shown separately', async () => {
    // Only one row on this page; the summary covers the whole fleet.
    respond({ success: true, data: metrics({
      healthSummary: summary({ total: 9, healthy: 5, degraded: 1, down: 1, monitored: 8 }),
      services: [row('ec2', 'i-1', 'healthy', { uptime: 100 })],
      pagination: { shown: 1, total: 9, hasMore: true, cursor: 'c' },
    }) })
    renderSection()
    await loaded()
    expect(screen.getByTestId('resource-checks-value')).toHaveTextContent(/^5 of 8$/)
    expect(screen.getByTestId('resource-checks-chip')).toHaveTextContent('2 with issues detected')
    expect(screen.getByTestId('resource-checks-undetermined')).toHaveTextContent('1 undetermined')
    expect(screen.getByTestId('resource-checks-icon-issue')).toBeInTheDocument()
  })

  it('uses the same N and M as /admin/monitoring (checkCountsFrom)', async () => {
    const hs = summary({ total: 10, healthy: 6, degraded: 1, critical: 1, monitored: 9 })
    respond({ success: true, data: metrics({ healthSummary: hs }) })
    renderSection()
    await loaded()
    const c = checkCountsFrom(hs)
    expect(screen.getByTestId('resource-checks-value')).toHaveTextContent(new RegExp(`^${c.noIssues} of ${c.reporting}$`))
    expect(screen.getByTestId('resource-checks-value')).toHaveTextContent(/^6 of 9$/)
    expect(screen.getByTestId('resource-checks-undetermined')).toHaveTextContent(`${c.undetermined} undetermined`)
  })

  it('no issues but some undetermined → "No issues detected" plus the undetermined chip, neutral icon (N < M)', async () => {
    respond({ success: true, data: metrics({ healthSummary: summary({ total: 3, healthy: 2, monitored: 3 }) }) })
    renderSection()
    await loaded()
    expect(screen.getByTestId('resource-checks-value')).toHaveTextContent(/^2 of 3$/)
    expect(screen.getByTestId('resource-checks-chip')).toHaveTextContent(/^No issues detected$/)
    expect(screen.getByTestId('resource-checks-undetermined')).toHaveTextContent('1 undetermined')
    expect(screen.getByTestId('resource-checks-icon-neutral')).toBeInTheDocument()
  })

  it('all pass → "No issues detected", check icon, no undetermined chip', async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    await loaded()
    expect(screen.getByTestId('resource-checks-value')).toHaveTextContent(/^3 of 3$/)
    expect(screen.getByTestId('resource-checks-chip')).toHaveTextContent(/^No issues detected$/)
    expect(screen.queryByTestId('resource-checks-undetermined')).toBeNull()
    expect(screen.getByTestId('resource-checks-icon-pass')).toBeInTheDocument()
  })

  it('the summary card has no title of its own and is top-aligned, not stretched to the details panel', async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    await loaded()
    expect(summaryCard()).not.toHaveTextContent('Resource checks')
    expect(within(section()).getAllByText('Resource checks')).toHaveLength(1)
    expect(summaryCard().className).toContain('self-start')
    expect(screen.getByTestId('resource-checks-icon-pass')).toBeInTheDocument()
    expect(screen.getByTestId('resource-checks-value')).toBeInTheDocument()
    expect(screen.getByTestId('resource-checks-chip')).toBeInTheDocument()
  })

  it('progress bar is N/M', async () => {
    respond({ success: true, data: metrics({ healthSummary: summary({ total: 4, healthy: 3, degraded: 1, monitored: 4 }) }) })
    renderSection()
    await loaded()
    expect(within(summaryCard()).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3 of 4 with no issues detected')
  })
})

describe('caption', () => {
  it('names only the types present, in their own check wording, with counts when more than one', async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    await loaded()
    expect(screen.getByTestId('resource-checks-caption')).toHaveTextContent(/^EC2: status checks passing · EBS \(2\): status checks passing$/)
  })

  it('status-check types never say "within thresholds"; threshold types do; mixed results are counted', async () => {
    respond({ success: true, data: metrics({
      healthSummary: summary({ total: 4, healthy: 3, degraded: 1, monitored: 4 }),
      services: [
        row('ebs', 'vol-1', 'healthy'),
        row('load-balancer', 'arn:aws:elasticloadbalancing:us-east-1:1:loadbalancer/app/web/abc', 'healthy'),
        row('load-balancer', 'alb-2', 'degraded'),
        row('lambda', 'fn', 'healthy'),
      ],
      pagination: { shown: 4, total: 4, hasMore: false, cursor: null },
    }) })
    renderSection()
    await loaded()
    const caption = screen.getByTestId('resource-checks-caption').textContent!
    expect(caption).toBe('EBS: status checks passing · ALB (2): 1 within thresholds, 1 threshold exceeded · Lambda: within thresholds')
    expect(caption).not.toMatch(/EBS[^·]*within thresholds/)
    expect(caption).not.toContain('EC2')
  })

  it('is left out when the response page does not hold every checked resource', async () => {
    respond({ success: true, data: metrics({ pagination: { shown: 3, total: 30, hasMore: true, cursor: 'c' } }) })
    renderSection()
    await loaded()
    expect(screen.queryByTestId('resource-checks-caption')).toBeNull()
  })
})

describe('non-result states: one line, no counts', () => {
  it.each([
    ['request failed', () => fetchMock.mockRejectedValue(new Error('network')), 'Could not be retrieved'],
    ['server error (success: false)', () => respond({ success: false, error: 'Failed to fetch CloudWatch metrics' }), 'Could not be retrieved'],
    ['not connected', () => respond({ success: true, data: null, connected: false }), 'Not connected'],
    ['no resources', () => respond({ success: true, data: metrics({ healthSummary: summary({}), services: [] }) }), 'No check results yet'],
    ['all unknown', () => respond({ success: true, data: metrics({ healthSummary: summary({ total: 2, monitored: 2 }), services: [row('ec2', 'i-1', 'unknown'), row('ebs', 'v-1', 'unknown')] }) }), 'No check results yet'],
    ['only never-checked resources', () => respond({ success: true, data: metrics({ healthSummary: summary({ total: 1 }), services: [row('rds', 'db-1', 'healthy', { monitored: false })] }) }), 'No check results yet'],
  ])('%s', async (_name, setup, line) => {
    setup()
    renderSection()
    await loaded()
    expect(within(summaryCard()).getByTestId('resource-checks-state')).toHaveTextContent(line)
    expect(screen.getByTestId('resource-checks-details-state')).toHaveTextContent(line)
    for (const id of ['resource-checks-value', 'resource-checks-chip', 'resource-checks-undetermined', 'resource-checks-caption', 'resource-checks-rows', 'resource-checks-source']) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
    expect(within(summaryCard()).queryByRole('progressbar')).toBeNull()
    expect(section().textContent).not.toMatch(/\d+ of \d+/)
    expect(screen.getByText('What this checks')).toBeInTheDocument()
    expect(screen.getByText('Not checked')).toBeInTheDocument()
    expect(screen.queryByText('Open resource checks →')).toBeNull()
  })

  it('stays "Loading…" with no request while the organization is unknown', async () => {
    respond({ success: true, data: metrics() })
    renderSection({ organizationId: null })
    enterViewport()
    await act(async () => {})
    expect(metricsCalls()).toHaveLength(0)
    expect(within(summaryCard()).getByTestId('resource-checks-state')).toHaveTextContent('Loading…')
  })
})

describe('resource rows', () => {
  it('render type + short ID and the check-specific result; never-checked resources are not rows', async () => {
    respond({ success: true, data: metrics({
      healthSummary: summary({ total: 5, healthy: 2, critical: 1, monitored: 4 }),
      services: [
        row('ec2', 'i-0c3e1234567890c59', 'healthy', { uptime: 100 }),
        row('ec2', 'i-cpuonly', 'healthy'),
        row('aurora', 'cluster-a', 'critical'),
        row('ebs', 'vol-x', 'unknown'),
        row('rds', 'db-1', 'healthy', { monitored: false }),
      ],
      pagination: { shown: 5, total: 5, hasMore: false, cursor: null },
    }) })
    renderSection()
    await loaded()
    const rows = screen.getAllByTestId('resource-checks-row').map((r) => r.textContent)
    expect(rows).toEqual([
      'EC2 · i-0c3e…c59Status checks passing',
      'EC2 · i-cpuonlyWithin thresholds',
      'Aurora · cluster-aThreshold exceeded',
      'EBS · vol-xUndetermined',
    ])
    expect(screen.queryByText(/db-1/)).toBeNull()
    expect(screen.queryByTestId('resource-checks-more')).toBeNull()
    // The undetermined EBS row and the never-checked RDS resource are not in the caption.
    expect(screen.getByTestId('resource-checks-caption')).toHaveTextContent(/^EC2 \(2\): 1 status checks passing, 1 within thresholds · Aurora: threshold exceeded$/)
  })

  it('shows at most 6, then "+N more" linking to /admin/monitoring', async () => {
    const services = Array.from({ length: 8 }, (_, i) => row('lambda', `fn-${i}`, 'healthy'))
    respond({ success: true, data: metrics({
      healthSummary: summary({ total: 12, healthy: 10, monitored: 10 }),
      services,
      pagination: { shown: 8, total: 12, hasMore: true, cursor: 'c' },
    }) })
    renderSection()
    await loaded()
    expect(screen.getAllByTestId('resource-checks-row')).toHaveLength(6)
    const more = screen.getByTestId('resource-checks-more')
    expect(more).toHaveTextContent(/^\+4 more$/)
    expect(more).toHaveAttribute('href', '/admin/monitoring')
  })
})

describe('source line', () => {
  it('capturedAt drives "checked N min ago"', async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    await loaded()
    expect(screen.getByTestId('resource-checks-source')).toHaveTextContent(/^Amazon CloudWatch · checked 4 min ago$/)
  })

  it('omits the time part when capturedAt is absent', async () => {
    respond({ success: true, data: metrics({ capturedAt: undefined }) })
    renderSection()
    await loaded()
    expect(screen.getByTestId('resource-checks-source')).toHaveTextContent(/^Amazon CloudWatch$/)
  })

  it('checkedAgo wording', () => {
    const now = Date.parse('2026-10-02T12:00:00Z')
    expect(checkedAgo(new Date(now - 20_000), now)).toBe('checked just now')
    expect(checkedAgo(new Date(now + 60_000), now)).toBe('checked just now')
    expect(checkedAgo(new Date(now - 59 * 60_000), now)).toBe('checked 59 min ago')
    expect(checkedAgo(new Date(now - 125 * 60_000), now)).toBe('checked 2 h ago')
  })
})

describe('header and wording', () => {
  it('says it is not part of the posture score and links to /admin/monitoring', async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    await loaded()
    expect(within(section()).getByRole('heading', { name: 'Resource checks' })).toBeInTheDocument()
    expect(within(section()).getByText('Not included in the posture score')).toBeInTheDocument()
    expect(within(section()).getByText('View all checks →')).toHaveAttribute('href', '/admin/monitoring')
    expect(within(section()).getByText(/Open resource checks →/).closest('a')).toHaveAttribute('href', '/admin/monitoring')
    expect(within(section()).getByText('AWS status checks and configured CloudWatch thresholds for resources that report telemetry.')).toBeInTheDocument()
    expect(within(section()).getByText('Latency, error rates, application health, and resources not reporting telemetry.')).toBeInTheDocument()
  })

  it('section ⓘ explains resource checks, that they are separate from the posture score, and what is not checked', async () => {
    respond({ success: true, data: metrics() })
    renderSection()
    await loaded()
    fireEvent.click(within(section()).getByRole('button', { name: 'Resource checks section details' }))
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveTextContent('What resource checks are')
    expect(panel).toHaveTextContent('How results are counted')
    expect(panel).toHaveTextContent('not included in the Infrastructure Posture score')
    expect(panel).toHaveTextContent('Latency, error rates, application health, and resources not reporting telemetry.')
  })

  it('never says "Healthy", "monitored", "within expected ranges", or uses posture wording', async () => {
    respond({ success: true, data: metrics({
      healthSummary: summary({ total: 3, healthy: 2, degraded: 1, monitored: 3 }),
      services: [row('ec2', 'i-1', 'healthy', { uptime: 100 }), row('load-balancer', 'a', 'degraded'), row('ebs', 'v', 'healthy')],
    }) })
    renderSection()
    await loaded()
    const text = section().textContent!
    expect(text).not.toMatch(/healthy|monitored|within expected ranges|methodology|Strong|At Risk|Needs attention|\/ 100/i)
  })
})

describe('pure helpers', () => {
  it('shortResourceId', () => {
    expect(shortResourceId('i-0c3e1234567890c59')).toBe('i-0c3e…c59')
    expect(shortResourceId('vol-0aa')).toBe('vol-0aa')
    expect(shortResourceId('checkout-handler')).toBe('checkout-handler')
    expect(shortResourceId('arn:aws:lambda:us-east-1:123:function:checkout')).toBe('checkout')
    expect(shortResourceId('arn:aws:elasticloadbalancing:us-east-1:1:loadbalancer/app/web-prod/50dc6c495c0c9188', 'web-prod')).toBe('web-prod')
    expect(shortResourceId('arn:aws:elasticloadbalancing:us-east-1:1:loadbalancer/app/web-prod/50dc6c495c0c9188', 'arn:aws:x')).toBe('50dc6c495c0c9188')
  })

  it('a response without healthSummary is never shown as counts', () => {
    expect(resourceChecksView({ status: 'ok', data: { services: [] } })).toEqual({ kind: 'line', line: 'Could not be retrieved' })
  })
})
