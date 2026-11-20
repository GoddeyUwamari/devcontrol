/**
 * Deployment detail page /deployments/[id] (d3-build.md §1.8).
 *
 * A deployment recorded by hand (metadata.source = 'manual', D2) never ran in
 * a pipeline: the page shows the version that was recorded, "Not recorded"
 * for the duration, who recorded it and when, and "Recorded by hand · no logs
 * attached" instead of the CloudWatch log viewer, which is never mounted.
 * A pipeline row is shown exactly as before (its "In progress..." / "N/A" are
 * backlog).
 *
 * The real page, service and shared axios client, with only the client's
 * transport stubbed; the log viewer is replaced by a marker that records
 * whether it was mounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import DeploymentDetailsPage from '../[id]/page'

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'dep-1' }) }))
const logViewer = vi.hoisted(() => ({ mounted: [] as Array<Record<string, unknown>> }))
vi.mock('@/components/deployments/LiveLogViewer', () => ({
  LiveLogViewer: (props: Record<string, unknown>) => {
    logViewer.mounted.push(props)
    return <div data-testid="live-log-viewer" />
  },
}))

const RECORDED_AT = '2026-11-20T10:15:00.000Z'

function row(over: Record<string, unknown>) {
  return {
    id: 'dep-1', service_id: 'svc-1', service_name: 'orders-api', environment: 'production', aws_region: 'eu-west-1',
    status: 'success', cost_estimate: null, deployed_by: 'member@example.test', deployed_at: RECORDED_AT,
    created_at: RECORDED_AT, updated_at: RECORDED_AT, resources: {}, metadata: {},
    ...over,
  }
}

const MANUAL = (over: Record<string, unknown> = {}) => row({ metadata: { source: 'manual' }, ...over })
const PIPELINE = row({
  deployed_by: 'octocat',
  metadata: { source: 'github_actions', github_run_id: 1, github_job_id: 2, head_sha: 'abc1234', conclusion: 'success' },
})

let reply: unknown
const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter
const adapter: AxiosAdapter = async (config) => {
  requests.push(config)
  return { data: { success: true, data: reply }, status: 200, statusText: 'OK', headers: {}, config }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DeploymentDetailsPage />
    </QueryClientProvider>
  )
}

const loaded = () => waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('orders-api'))

describe('Deployment detail page', () => {
  beforeEach(() => {
    requests.length = 0
    logViewer.mounted.length = 0
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it.each(['success', 'failed', 'deploying'])('a hand-recorded %s row: no log viewer, "Recorded by hand · no logs attached", duration "Not recorded"', async (status) => {
    reply = MANUAL({ status, resources: { version: 'v2.4.1' } })
    renderPage()
    await loaded()

    expect(screen.getByTestId('deployment-no-logs')).toHaveTextContent(/^Recorded by hand · no logs attached$/)
    expect(screen.queryByTestId('live-log-viewer')).not.toBeInTheDocument()
    expect(logViewer.mounted).toHaveLength(0)
    expect(screen.queryByText('Live Deployment Logs')).not.toBeInTheDocument()
    expect(screen.queryByText('View in AWS Console')).not.toBeInTheDocument()
    expect(document.querySelector('a[href*="console.aws.amazon.com"]')).toBeNull()

    expect(screen.getByTestId('deployment-duration')).toHaveTextContent(/^Not recorded$/)
    expect(document.body).not.toHaveTextContent(/In progress\.\.\./)
    // Only the deployment itself is requested.
    expect(requests.map(r => r.url)).toEqual(['/api/deployments/dep-1'])
  })

  it('a hand-recorded row shows the version that was recorded, not "N/A"', async () => {
    reply = MANUAL({ resources: { version: 'v2.4.1' } })
    renderPage()
    await loaded()

    expect(screen.getByTestId('deployment-version')).toHaveTextContent(/^v2\.4\.1$/)
    expect(document.body).not.toHaveTextContent(/N\/A/)
  })

  it.each([
    ['no resources', { resources: null }],
    ['no version', { resources: {} }],
    ['a blank version', { resources: { version: '   ' } }],
    ['a non-string version', { resources: { version: 7 } }],
  ])('a hand-recorded row with %s: version "Not recorded", never "N/A"', async (_name, over) => {
    reply = MANUAL(over)
    renderPage()
    await loaded()

    expect(screen.getByTestId('deployment-version')).toHaveTextContent(/^Not recorded$/)
    expect(document.body).not.toHaveTextContent(/N\/A/)
  })

  it('a hand-recorded row: "Recorded by" its recorder and "Recorded at", never "Deployed by" or "Started At" (D3-D6)', async () => {
    reply = MANUAL()
    renderPage()
    await loaded()

    expect(screen.getByText(/production • Recorded by member@example\.test/)).toBeInTheDocument()
    expect(screen.getByText('Recorded at')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Deployed by|Started At/)
    // No claim that DevControl or a pipeline ran it.
    expect(document.body).not.toHaveTextContent(/Live Deployment Logs|Connect your CI|pipeline/i)
  })

  it('a pipeline row is unchanged: log viewer, "View in AWS Console", "Deployed by", "Started At", and today\'s "N/A" / "In progress..."', async () => {
    reply = PIPELINE
    renderPage()
    await loaded()

    expect(screen.getByText('Live Deployment Logs')).toBeInTheDocument()
    expect(screen.getByText('View in AWS Console').closest('a')).toHaveAttribute('href', 'https://console.aws.amazon.com/cloudwatch/home?region=eu-west-1')
    expect(screen.getByTestId('live-log-viewer')).toBeInTheDocument()
    expect(logViewer.mounted[0]).toEqual({ deploymentId: 'dep-1', logGroupName: '/aws/ecs/deployments', logStreamName: 'dep-1' })
    expect(screen.queryByTestId('deployment-no-logs')).not.toBeInTheDocument()
    expect(screen.getByText(/production • Deployed by octocat/)).toBeInTheDocument()
    expect(screen.getByText('Started At')).toBeInTheDocument()
    expect(screen.getByTestId('deployment-version')).toHaveTextContent(/^N\/A$/)
    expect(screen.getByTestId('deployment-duration')).toHaveTextContent(/^In progress\.\.\.$/)
    expect(document.body).not.toHaveTextContent(/Recorded by|Recorded at|Not recorded/)
  })

  it('a row with no metadata (older rows) is treated as before, not as hand-recorded', async () => {
    reply = row({ metadata: null })
    renderPage()
    await loaded()

    expect(screen.getByTestId('live-log-viewer')).toBeInTheDocument()
    expect(screen.queryByTestId('deployment-no-logs')).not.toBeInTheDocument()
  })

  it('the status badge is the recorded status on both kinds of row', async () => {
    reply = MANUAL({ status: 'failed' })
    renderPage()
    await loaded()
    const header = screen.getByRole('heading', { level: 1 }).parentElement!.parentElement!
    expect(within(header).getByText('Failed')).toBeInTheDocument()
  })
})
