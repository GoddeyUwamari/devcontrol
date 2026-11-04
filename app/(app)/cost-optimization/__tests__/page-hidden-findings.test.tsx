/**
 * Cost Optimization PR 3b: hidden findings on the page (pr3-step1.md §5,
 * copy C1-C28 with the founder's Nov 3 edits, E1/E2 and decisions 1-7 of the
 * PR 3b pause, approved 2026-11-04). Real page and real React Query, mocked
 * services, placeholder data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { HiddenFinding, HiddenFindings } from '@/lib/services/cost-recommendations.service'
import { LEGACY_RUN, PRODUCTION_RESOLVED_ONLY, run } from './fixtures'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
const role = vi.hoisted(() => ({ value: 'member' as string | null }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => role.value }))

const svc = vi.hoisted(() => ({
  getAll: vi.fn(),
  getStats: vi.fn(),
  getAnalysisRuns: vi.fn(),
  getHidden: vi.fn(),
  getOptimizationRules: vi.fn(),
  reopen: vi.fn(),
  dismiss: vi.fn(),
  resolve: vi.fn(),
  analyze: vi.fn(),
  getAccounts: vi.fn(),
  getDiscoveryJobs: vi.fn(),
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: () => svc.getAll(),
    getStats: () => svc.getStats(),
    getOptimizationRules: () => svc.getOptimizationRules(),
    getAnalysisRuns: (...args: unknown[]) => svc.getAnalysisRuns(...args),
    getHidden: () => svc.getHidden(),
    reopen: (id: string) => svc.reopen(id),
    dismiss: (id: string) => svc.dismiss(id),
    resolve: (id: string) => svc.resolve(id),
    analyze: () => svc.analyze(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: () => svc.getAccounts() } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: () => svc.getDiscoveryJobs() } }))

const C7_TWO = "You marked these resolved, but the latest analysis still found them. They aren't in the totals above until you reopen them."
const C7_ONE = "You marked this resolved, but the latest analysis still found it. It isn't in the totals above until you reopen it."
const C14 = "Reopened. It's back in your active recommendations."
const C15 = "Reopened. It will appear after the next analysis if it's still detected."
const C16 = 'This finding was already reopened.'
const C17 = "Couldn't reopen this finding. Try again."
const C18 = 'Only members and above can reopen findings.'
const C26 = 'No resolved or dismissed findings are hidden.'
const C27 = "Couldn't load resolved and dismissed findings. Try again."
const EMPTY_HEADLINE = 'No active recommendations to review'
const PRODUCTION_BANNER = 'Nothing new to review. 2 findings you resolved were found again.'

function stats(overrides: Record<string, unknown> = {}) {
  return {
    totalRecommendations: 38, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
    potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 },
    ...overrides,
  }
}

const RULES = {
  rules: [
    { id: 'r1', name: 'Idle EC2 instances', status: 'implemented', detail: 'd', service: 'EC2' },
    { id: 'r2', name: 'S3 lifecycle', status: 'implemented', detail: 'd', service: 'S3' },
  ],
  summary: { totalRules: 2, implementedCount: 2, plannedCount: 0, services: [] },
}

function item(overrides: Partial<Omit<HiddenFinding, 'detection'>> & { detection?: Partial<HiddenFinding['detection']> } = {}): HiddenFinding {
  const { detection, ...rest } = overrides
  return {
    id: 'decision-idle',
    decision: 'RESOLVED',
    decidedAt: '2026-09-03T18:54:05.000Z',
    decidedBy: 'Placeholder Person',
    decisionCount: 37,
    issue: 'Idle Instance',
    resourceId: 'i-placeholder0001',
    resourceName: 'placeholder-instance',
    resourceType: 'EC2',
    awsRegion: 'us-east-1',
    ...rest,
    detection: {
      state: 'still_detected', reason: null, lastDetectedAt: '2026-11-04T00:00:03.000Z',
      potentialSavings: 12.5, savingsBasis: 'estimated:cloudwatch_cpu', severity: 'LOW', description: 'Idle',
      ...detection,
    },
  }
}

const IDLE = item()
const S3 = item({
  id: 'decision-s3', decisionCount: 1, issue: 'S3 Lifecycle Optimization', resourceId: 'placeholder-bucket', resourceName: null,
  resourceType: 'S3', awsRegion: null, decidedBy: null, decidedAt: '2026-10-04T15:48:25.000Z',
  detection: { potentialSavings: 5, savingsBasis: 'ceiling:s3_standard_storage' },
})

function hidden(items: HiddenFinding[], summary: Partial<HiddenFindings['summary']> = {}): HiddenFindings {
  const resolved = items.filter((i) => i.decision === 'RESOLVED')
  const still = resolved.filter((i) => i.detection.state === 'still_detected')
  return {
    latestRun: { id: 'run-placeholder', runState: 'completed', completedAt: '2026-11-04T00:00:03.000Z' },
    summary: {
      resolved: resolved.length,
      dismissed: items.length - resolved.length,
      stillDetected: { count: still.length, estimatedMonthlySavings: 12.5, ceilingMonthlySavings: 5, ceilingByResourceType: { S3: 5 } },
      notConfirmed: resolved.length - still.length,
      ...summary,
    },
    items,
  }
}

/** Production after the next scan: Idle (estimate) and S3 (ceiling), both still detected. */
const PRODUCTION = hidden([IDLE, S3])
const NOTHING_HIDDEN = hidden([], { stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} } })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let queryClient: QueryClient

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CostOptimizationPage />
    </QueryClientProvider>
  )
}

const slot = () => screen.getByTestId('still-detected-slot')
const kpiCard = (label: string) => screen.getByText(label).parentElement as HTMLElement
const reopenButtons = () => screen.queryAllByRole('button', { name: /reopen/i })

async function loaded() {
  await waitFor(() => expect(screen.getByTestId('scan-status-banner').querySelector('[role="status"]')).not.toHaveAttribute('aria-busy'))
  await waitFor(() => expect(screen.queryByTestId('hidden-loading')).not.toBeInTheDocument())
}

async function openReview() {
  fireEvent.click(await screen.findByRole('button', { name: /Resolved and dismissed/ }))
}

beforeEach(() => {
  vi.clearAllMocks()
  role.value = 'member'
  svc.getAll.mockResolvedValue([])
  svc.getStats.mockResolvedValue(stats())
  svc.getAnalysisRuns.mockResolvedValue([PRODUCTION_RESOLVED_ONLY])
  svc.getHidden.mockResolvedValue(PRODUCTION)
  svc.getOptimizationRules.mockResolvedValue(RULES)
  svc.getAccounts.mockResolvedValue([{ id: 'account-placeholder' }])
  svc.getDiscoveryJobs.mockResolvedValue([])
  svc.reopen.mockResolvedValue({ reopened: true, rowsEnded: 37, activeNow: true })
  svc.dismiss.mockResolvedValue({ id: 'decision-idle' })
})

describe('Still detected group', () => {
  it('shows count, C7, C8 (estimate) and C9 (ceiling) directly under the KPI cards, with its items', async () => {
    renderPage()
    await loaded()
    const group = slot()
    expect(within(group).getByRole('heading', { name: 'Still detected' })).toBeInTheDocument()
    expect(within(group).getByTestId('still-detected-count')).toHaveTextContent('2')
    expect(within(group).getByText(C7_TWO)).toBeInTheDocument()
    expect(within(group).getByText('Estimated $13/mo if addressed')).toBeInTheDocument()
    expect(within(group).getByText('Plus up to $5/mo in estimated ceilings, not expected savings.')).toBeInTheDocument()
    expect(within(group).getAllByTestId('hidden-item').map((el) => el.dataset.itemId)).toEqual(['decision-idle', 'decision-s3'])
    // S3 is a ceiling, labelled as such (LIVE wording); Idle is an estimate.
    expect(within(group).getByText('Up to $5/mo')).toBeInTheDocument()
    expect(within(group).getByText('Estimated ceiling, not an expected saving')).toBeInTheDocument()

    // Placement: after the KPI grid, before the disclaimer.
    const kpi = screen.getByText('Active Opportunities')
    const disclaimer = screen.getByText(/Savings figures are estimated potential savings/)
    expect(kpi.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(group.compareDocumentPosition(disclaimer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('singular C7', async () => {
    svc.getHidden.mockResolvedValue(hidden([IDLE], { stillDetected: { count: 1, estimatedMonthlySavings: 12.5, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    expect(within(slot()).getByText(C7_ONE)).toBeInTheDocument()
    expect(within(slot()).queryByText(/estimated ceilings/)).not.toBeInTheDocument()
  })

  it('still-detected findings are NOT added to the ACTIVE KPI totals (they come from /stats only)', async () => {
    renderPage()
    await loaded()
    await waitFor(() => expect(within(kpiCard('Active Opportunities')).getByText('0')).toBeInTheDocument())
    expect(within(kpiCard('Estimated Monthly Savings')).getByText('$0')).toBeInTheDocument()
    expect(within(kpiCard('Estimated Monthly Savings')).queryByText(/\$13/)).not.toBeInTheDocument()
    expect(within(kpiCard('Estimated Annual Savings')).getByText('$0')).toBeInTheDocument()
  })

  it('takes the empty card\'s place: no "No active recommendations" card while items are still detected', async () => {
    renderPage()
    await loaded()
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    expect(screen.queryByText(EMPTY_HEADLINE)).not.toBeInTheDocument()
  })

  it('C8 is a muted "$0/mo" when only a ceiling exists (decision 5)', async () => {
    svc.getHidden.mockResolvedValue(hidden([S3], { stillDetected: { count: 1, estimatedMonthlySavings: 0, ceilingMonthlySavings: 5, ceilingByResourceType: { S3: 5 } } }))
    renderPage()
    await loaded()
    const c8 = within(slot()).getByText('Estimated $0/mo if addressed')
    expect(c8.className).toMatch(/text-slate-500/)
    expect(c8.className).not.toMatch(/green|success/)
    expect(within(slot()).getByText('Plus up to $5/mo in estimated ceilings, not expected savings.')).toBeInTheDocument()
  })

  it('renders only what /hidden says: never derives "still detected" itself', async () => {
    // A fresh-looking but not-confirmed item (recent lastDetectedAt, completed latest run) must not be in the group;
    // a still_detected item with no lastDetectedAt must be.
    const looksFresh = item({ id: 'decision-a', detection: { state: 'not_confirmed', reason: 'not_fully_checked', lastDetectedAt: '2026-11-04T00:00:03.000Z' } })
    const marked = item({ id: 'decision-b', issue: 'Unused Elastic IP', detection: { state: 'still_detected', lastDetectedAt: null } })
    svc.getHidden.mockResolvedValue(hidden([looksFresh, marked], { stillDetected: { count: 1, estimatedMonthlySavings: 12.5, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    expect(within(slot()).getAllByTestId('hidden-item').map((el) => el.dataset.itemId)).toEqual(['decision-b'])
    expect(within(slot()).getByTestId('still-detected-count')).toHaveTextContent('1')
  })

  it('the count is the server summary, not a client tally of items', async () => {
    svc.getHidden.mockResolvedValue(hidden([IDLE, S3], { stillDetected: { count: 3, estimatedMonthlySavings: 1, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    expect(within(slot()).getByTestId('still-detected-count')).toHaveTextContent('3')
  })

  it('a dismissed still-detected finding is never in the group', async () => {
    const dismissed = item({ id: 'decision-d', decision: 'DISMISSED' })
    svc.getHidden.mockResolvedValue(hidden([dismissed], { stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    // Nothing to show: no Still detected section at all (L3).
    expect(screen.queryByTestId('still-detected-slot')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Still detected' })).not.toBeInTheDocument()
  })

  it('C12 when nothing is fresh but some resolved findings could not be re-checked', async () => {
    const stale = (id: string) => item({ id, detection: { state: 'not_confirmed', reason: 'not_checked_since', lastDetectedAt: null, potentialSavings: null } })
    svc.getHidden.mockResolvedValue(hidden([stale('a'), stale('b')], { stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    expect(within(slot()).getByText("2 resolved findings couldn't be re-checked by the latest analysis.")).toBeInTheDocument()
    expect(within(slot()).queryByRole('heading', { name: 'Still detected' })).not.toBeInTheDocument()
  })

  it('the group summary sits in a polite live region', async () => {
    renderPage()
    await loaded()
    const live = screen.getByTestId('still-detected-live')
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(within(live).getByText(C7_TWO)).toBeInTheDocument()
  })
})

describe('review fix L2: status cards still show when items are still detected', () => {
  const card = () => screen.findByTestId('empty-state')

  it('not connected: the Connect AWS card stays', async () => {
    svc.getAccounts.mockResolvedValue([])
    renderPage()
    expect(within(await card()).getByText('Connect AWS to check for savings')).toBeInTheDocument()
  })

  it('never analyzed: its card stays', async () => {
    svc.getAnalysisRuns.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: 'Still detected' })).toBeInTheDocument())
    expect(within(await card()).getByText('No analysis has run yet')).toBeInTheDocument()
  })

  it('running: the Analysis in progress card stays', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'running', status: 'running', completed_at: null })])
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: 'Still detected' })).toBeInTheDocument())
    expect(within(await card()).getByText('Analysis in progress')).toBeInTheDocument()
  })

  it('failed: the failed card stays', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'failed', status: 'failed', error_message: 'None of the cost checks could complete. Try again.' })])
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: 'Still detected' })).toBeInTheDocument())
    expect(within(await card()).getByText("The last manual cost analysis didn't complete")).toBeInTheDocument()
  })

  it('7b legacy: the card and its caveat stay', async () => {
    svc.getAnalysisRuns.mockResolvedValue([LEGACY_RUN])
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: 'Still detected' })).toBeInTheDocument())
    const c = await card()
    expect(within(c).getByText(EMPTY_HEADLINE)).toBeInTheDocument()
    expect(within(c).getByTestId('legacy-caveat')).toHaveTextContent(/This list does not confirm that nothing can be saved/)
  })

  it('a completed run: only the plain empty card is replaced by the group', async () => {
    renderPage()
    await loaded()
    expect(within(slot()).getByRole('heading', { name: 'Still detected' })).toBeInTheDocument()
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
  })
})

describe('review fix L3: no empty Still detected region', () => {
  it('nothing hidden: no section, no region, no landmark named Still detected', async () => {
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    renderPage()
    await loaded()
    await screen.findByTestId('empty-state')
    expect(screen.queryByTestId('still-detected-slot')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Still detected' })).not.toBeInTheDocument()
  })

  it('loading: the section is shown as busy', async () => {
    svc.getHidden.mockReturnValue(new Promise(() => undefined))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('hidden-loading')).toBeInTheDocument())
    expect(screen.getByRole('region', { name: 'Still detected' })).toHaveAttribute('aria-busy', 'true')
  })

  it('C27 shows the section (C12 is covered above)', async () => {
    svc.getHidden.mockRejectedValue(new Error('x'))
    renderPage()
    await waitFor(() => expect(screen.getByRole('region', { name: 'Still detected' })).toHaveTextContent(C27))
  })
})

describe('review fix L1: "each check below" only when the check list is shown', () => {
  beforeEach(() => { svc.getAnalysisRuns.mockResolvedValue([LEGACY_RUN]) })

  it('/hidden failed (check list hidden): no "each check below" sentence; the LIVE first sentence stays', async () => {
    svc.getHidden.mockRejectedValue(new Error('x'))
    renderPage()
    const c = await screen.findByTestId('empty-state')
    expect(within(c).queryByTestId('checks-line')).not.toBeInTheDocument()
    expect(within(c).getByTestId('legacy-caveat')).toHaveTextContent(/^Previously identified items have been resolved or dismissed\.$/)
    expect(c.textContent).not.toMatch(/each check below/)
  })

  it('no checks in the catalog: no "each check below" sentence', async () => {
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    svc.getOptimizationRules.mockResolvedValue({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } })
    renderPage()
    await loaded()
    const c = await screen.findByTestId('empty-state')
    expect(c.textContent).not.toMatch(/each check below/)
  })

  it('check list shown: the full LIVE caveat, followed by the list', async () => {
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    renderPage()
    await loaded()
    const c = await screen.findByTestId('empty-state')
    await waitFor(() => expect(within(c).getByTestId('checks-line')).toBeInTheDocument())
    expect(within(c).getByTestId('legacy-caveat')).toHaveTextContent(
      'Previously identified items have been resolved or dismissed. This list does not confirm that nothing can be saved: DevControl does not yet record whether each check below completed with enough data.'
    )
    const caveat = within(c).getByTestId('legacy-caveat')
    expect(caveat.compareDocumentPosition(within(c).getByTestId('checks-line')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('/hidden failed: C27, never empty', () => {
  beforeEach(() => { svc.getHidden.mockRejectedValue(new Error('Request failed with status code 500')) })

  it('shows one C27 with Try again, no group, no count, no review list', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    expect(screen.getAllByText(C27)).toHaveLength(1)
    expect(within(slot()).queryByRole('heading', { name: 'Still detected' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-list')).not.toBeInTheDocument()
    expect(screen.queryByText(C26)).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Resolved and dismissed \(0\)|status code 500/)
  })

  it('the empty card keeps the LIVE headline only: no conclusion, no check list', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    const card = await screen.findByTestId('empty-state')
    expect(within(card).getByText(EMPTY_HEADLINE)).toBeInTheDocument()
    expect(within(card).queryByTestId('checks-line')).not.toBeInTheDocument()
  })

  it('Try again refetches /hidden and recovers', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    svc.getHidden.mockResolvedValue(PRODUCTION)
    fireEvent.click(within(slot()).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: 'Still detected' })).toBeInTheDocument())
    expect(screen.queryByText(C27)).not.toBeInTheDocument()
  })

  it('while /hidden is loading, nothing claims empty', async () => {
    svc.getHidden.mockReturnValue(new Promise(() => undefined))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('hidden-loading')).toBeInTheDocument())
    expect(screen.queryByText(EMPTY_HEADLINE)).not.toBeInTheDocument()
    expect(screen.queryByText(C26)).not.toBeInTheDocument()
  })
})

describe('truly empty (no active, nothing still detected)', () => {
  beforeEach(() => {
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    svc.getAnalysisRuns.mockResolvedValue([run()])
  })

  it('LIVE headline + E1 line, left-aligned; the banner sentence is not repeated', async () => {
    renderPage()
    await loaded()
    const card = await screen.findByTestId('empty-state')
    expect(within(card).getByText(EMPTY_HEADLINE)).toBeInTheDocument()
    expect(within(card).getByTestId('checks-line')).toHaveTextContent(/^What DevControl checks: Idle EC2 instances, S3 lifecycle\.$/)
    expect(card.className).not.toMatch(/text-center/)
    // The banner says it once.
    const bannerText = "All 9 checks ran and nothing was flagged. These checks don't cover every possible AWS saving."
    expect(screen.getAllByText(bannerText)).toHaveLength(1)
    expect(within(card).queryByText(bannerText)).not.toBeInTheDocument()
  })

  it('the check list is no longer a centred bullet list', async () => {
    renderPage()
    await loaded()
    const card = await screen.findByTestId('empty-state')
    expect(card.querySelector('.rounded-full.bg-slate-400')).toBeNull()
    expect(card.querySelector('.items-center.flex-col')).toBeNull()
    expect(within(card).queryAllByText(/^ ?Idle EC2 instances$/)).toHaveLength(0)
  })

  it('production banner sentence is not repeated in the card either (C1)', async () => {
    svc.getAnalysisRuns.mockResolvedValue([PRODUCTION_RESOLVED_ONLY])
    renderPage()
    await loaded()
    expect(screen.getAllByText(PRODUCTION_BANNER)).toHaveLength(1)
    expect(within(screen.getByTestId('scan-status-banner')).getByText(PRODUCTION_BANNER)).toBeInTheDocument()
  })

  it('a 0 count part is omitted from the banner ("0 dismissed" never shown)', async () => {
    svc.getAnalysisRuns.mockResolvedValue([PRODUCTION_RESOLVED_ONLY])
    const { container } = renderPage()
    await loaded()
    expect(container.textContent).not.toMatch(/\b0 findings? you dismissed|0 dismissed/)
  })

  it('the 7b legacy caveat (LIVE) stays', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: undefined, checks: undefined, new_count: undefined })])
    renderPage()
    await loaded()
    expect(await screen.findByText(/This list does not confirm that nothing can be saved/)).toBeInTheDocument()
  })
})

describe('review list (C19-C27)', () => {
  it('collapsed by default; the toggle counts resolved + dismissed and expands', async () => {
    const dismissed = item({ id: 'decision-d', decision: 'DISMISSED', decidedBy: 'Placeholder Person', decisionCount: 2 })
    svc.getHidden.mockResolvedValue(hidden([IDLE, S3, dismissed]))
    renderPage()
    await loaded()
    const toggle = screen.getByRole('button', { name: /Resolved and dismissed \(3\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('Show')
    expect(within(screen.getByTestId('review-list')).queryByTestId('hidden-item')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('Hide')
    expect(within(screen.getByTestId('review-list')).getAllByTestId('hidden-item')).toHaveLength(3)
  })

  it('badges, reasons, C10/E2 meta and C11 history', async () => {
    const notConfirmed = item({ id: 'decision-n', issue: 'Unused Elastic IP', decisionCount: 2, detection: { state: 'not_confirmed', reason: 'check_failed', potentialSavings: null } })
    const dismissed = item({ id: 'decision-d', issue: 'Unattached EBS Volume', decision: 'DISMISSED', decidedBy: null, decisionCount: 3, detection: { state: 'not_confirmed', reason: 'analysis_incomplete' } })
    svc.getHidden.mockResolvedValue(hidden([IDLE, S3, notConfirmed, dismissed]))
    renderPage()
    await loaded()
    await openReview()
    const list = screen.getByTestId('review-list')
    const row = (id: string) => list.querySelector(`[data-item-id="${id}"]`) as HTMLElement

    expect(within(row('decision-idle')).getByText('Still detected')).toBeInTheDocument()
    expect(within(row('decision-idle')).getByText(/^Resolved .+ ago by Placeholder Person$/)).toBeInTheDocument()
    expect(within(row('decision-idle')).getByText('36 earlier decisions on this finding')).toBeInTheDocument()

    // C10 founder edit: no actor → "· person not recorded" (never the obsolete "by: Not recorded").
    expect(within(row('decision-s3')).getByText(/^Resolved .+ ago · person not recorded$/)).toBeInTheDocument()
    expect(list.textContent).not.toMatch(/by: Not recorded|Not recorded/)
    expect(within(row('decision-s3')).queryByText(/earlier decisions/)).not.toBeInTheDocument()

    expect(within(row('decision-n')).getByText('Not confirmed')).toBeInTheDocument()
    expect(within(row('decision-n')).getByText("The latest analysis couldn't complete this check.")).toBeInTheDocument()
    // decisionCount 2 = 1 earlier decision: C11 only when more than 1.
    expect(within(row('decision-n')).queryByText(/earlier decisions/)).not.toBeInTheDocument()

    expect(within(row('decision-d')).getByText('Dismissed')).toBeInTheDocument()
    expect(within(row('decision-d')).getByText(/^Dismissed .+ ago · person not recorded$/)).toBeInTheDocument()
    expect(within(row('decision-d')).getByText("The latest analysis didn't finish.")).toBeInTheDocument()
    expect(within(row('decision-d')).getByText('2 earlier decisions on this finding')).toBeInTheDocument()
  })

  it('C21 and C23 reasons', async () => {
    svc.getHidden.mockResolvedValue(hidden([
      item({ id: 'x1', detection: { state: 'not_confirmed', reason: 'not_checked_since' } }),
      item({ id: 'x2', detection: { state: 'not_confirmed', reason: 'not_fully_checked' } }),
    ], { stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    await openReview()
    expect(screen.getByText('No analysis has checked this since your decision.')).toBeInTheDocument()
    expect(screen.getByText("The latest analysis couldn't fully check this resource.")).toBeInTheDocument()
  })

  it('E2 with an actor', async () => {
    svc.getHidden.mockResolvedValue(hidden([item({ id: 'd', decision: 'DISMISSED' })]))
    renderPage()
    await loaded()
    await openReview()
    expect(screen.getByText(/^Dismissed .+ ago by Placeholder Person$/)).toBeInTheDocument()
  })

  it('empty list shows C26 when opened', async () => {
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    renderPage()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: /Resolved and dismissed \(0\)/ }))
    expect(screen.getByText(C26)).toBeInTheDocument()
  })
})

describe('Reopen permissions (C13, C18)', () => {
  it('a viewer sees a disabled Reopen with C18', async () => {
    role.value = 'viewer'
    renderPage()
    await loaded()
    const buttons = within(slot()).getAllByRole('button', { name: /reopen/i })
    expect(buttons.length).toBe(2)
    for (const button of buttons) {
      expect(button).toBeDisabled()
      const note = document.getElementById(button.getAttribute('aria-describedby') ?? '')
      expect(note).toHaveTextContent(C18)
    }
    fireEvent.click(buttons[0])
    expect(svc.reopen).not.toHaveBeenCalled()
  })

  it.each(['member', 'admin', 'owner'])('%s can reopen', async (r) => {
    role.value = r
    renderPage()
    await loaded()
    const button = within(slot()).getAllByRole('button', { name: /reopen/i })[0]
    expect(button).toBeEnabled()
    expect(screen.queryByText(C18)).not.toBeInTheDocument()
  })

  it('an unknown role fails closed (disabled, no viewer text)', async () => {
    role.value = null
    renderPage()
    await loaded()
    expect(within(slot()).getAllByRole('button', { name: /reopen/i })[0]).toBeDisabled()
    expect(screen.queryByText(C18)).not.toBeInTheDocument()
  })
})

describe('Reopen and Dismiss', () => {
  it('C14, then /hidden, /stats and the recommendations list all refetch', async () => {
    renderPage()
    await loaded()
    const before = { hidden: svc.getHidden.mock.calls.length, stats: svc.getStats.mock.calls.length, all: svc.getAll.mock.calls.length }
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(C14))
    expect(svc.reopen).toHaveBeenCalledWith('decision-idle')
    await waitFor(() => {
      expect(svc.getHidden.mock.calls.length).toBeGreaterThan(before.hidden)
      expect(svc.getStats.mock.calls.length).toBeGreaterThan(before.stats)
      expect(svc.getAll.mock.calls.length).toBeGreaterThan(before.all)
    })
  })

  it('after a reopen the page shows the refreshed totals and groups together', async () => {
    renderPage()
    await loaded()
    svc.getHidden.mockResolvedValue(hidden([S3], { stillDetected: { count: 1, estimatedMonthlySavings: 0, ceilingMonthlySavings: 5, ceilingByResourceType: { S3: 5 } } }))
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 1, totalPotentialSavings: 12.5 }))
    svc.getAll.mockResolvedValue([{ id: 'active-new', issue: 'Idle Instance', resourceId: 'i-placeholder0001', status: 'ACTIVE', potentialSavings: 12.5, metadata: { savings_basis: 'estimated:cloudwatch_cpu' } }])
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(within(slot()).getByTestId('still-detected-count')).toHaveTextContent('1'))
    await waitFor(() => expect(within(kpiCard('Active Opportunities')).getByText('1')).toBeInTheDocument())
    expect(screen.getByText('1 active opportunity')).toBeInTheDocument()
  })

  it('C15 when reopened but not confirmed', async () => {
    svc.reopen.mockResolvedValue({ reopened: true, rowsEnded: 1, activeNow: false })
    renderPage()
    await loaded()
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(C15))
  })

  it('C16 when it was already reopened', async () => {
    svc.reopen.mockResolvedValue({ reopened: false, reason: 'already_open' })
    renderPage()
    await loaded()
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(C16))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('C17 on failure, and the page still refreshes', async () => {
    svc.reopen.mockRejectedValue(new Error('Request failed with status code 500'))
    renderPage()
    await loaded()
    const calls = svc.getHidden.mock.calls.length
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(C17))
    await waitFor(() => expect(svc.getHidden.mock.calls.length).toBeGreaterThan(calls))
  })

  it('a reopen from the review list works the same way', async () => {
    renderPage()
    await loaded()
    await openReview()
    fireEvent.click(within(screen.getByTestId('review-list')).getAllByRole('button', { name: /reopen/i })[1])
    await waitFor(() => expect(svc.reopen).toHaveBeenCalledWith('decision-s3'))
  })

  it('Dismiss on a still-detected item uses the LIVE dismiss endpoint and toast (C28)', async () => {
    renderPage()
    await loaded()
    const calls = svc.getStats.mock.calls.length
    fireEvent.click(within(slot()).getAllByRole('button', { name: /dismiss/i })[0])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Recommendation dismissed'))
    expect(svc.dismiss).toHaveBeenCalledWith('decision-idle')
    await waitFor(() => expect(svc.getStats.mock.calls.length).toBeGreaterThan(calls))
  })

  it('Dismiss failure shows the LIVE error toast', async () => {
    svc.dismiss.mockRejectedValue(new Error('x'))
    renderPage()
    await loaded()
    fireEvent.click(within(slot()).getAllByRole('button', { name: /dismiss/i })[0])
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to dismiss recommendation'))
  })
})

describe('duplicate submissions', () => {
  it('a double click on Reopen sends one request; both buttons stay disabled until the refresh finishes', async () => {
    const reopen = deferred<{ reopened: true; rowsEnded: number; activeNow: boolean }>()
    svc.reopen.mockReturnValue(reopen.promise)
    renderPage()
    await loaded()
    const row = within(slot()).getAllByTestId('hidden-item')[0]
    const reopenButton = within(row).getByRole('button', { name: /reopen/i })
    fireEvent.click(reopenButton)
    fireEvent.click(reopenButton)
    expect(svc.reopen).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(reopenButton).toBeDisabled())
    expect(within(row).getByRole('button', { name: /dismiss/i })).toBeDisabled()
    fireEvent.click(within(row).getByRole('button', { name: /dismiss/i }))
    expect(svc.dismiss).not.toHaveBeenCalled()

    const refresh = deferred<HiddenFindings>()
    svc.getHidden.mockReturnValue(refresh.promise)
    await act(async () => reopen.resolve({ reopened: true, rowsEnded: 37, activeNow: true }))
    // The mutation answered, but its refresh hasn't: still guarded.
    expect(within(slot()).getAllByRole('button', { name: /reopen/i })[0]).toBeDisabled()
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    expect(svc.reopen).toHaveBeenCalledTimes(1)
    await act(async () => refresh.resolve(PRODUCTION))
    await waitFor(() => expect(within(slot()).getAllByRole('button', { name: /reopen/i })[0]).toBeEnabled())
  })

  it('two clicks in one batch, before React re-renders the disabled state, still send one request', async () => {
    svc.reopen.mockReturnValue(new Promise(() => undefined))
    renderPage()
    await loaded()
    const row = within(slot()).getAllByTestId('hidden-item')[0]
    const reopenButton = within(row).getByRole('button', { name: /reopen/i })
    const dismissButton = within(row).getByRole('button', { name: /dismiss/i })
    act(() => {
      reopenButton.click()
      reopenButton.click()
      dismissButton.click()
    })
    expect(svc.reopen).toHaveBeenCalledTimes(1)
    expect(svc.dismiss).not.toHaveBeenCalled()
  })

  it('a pending Dismiss guards Reopen on the same item; other items stay usable', async () => {
    svc.dismiss.mockReturnValue(new Promise(() => undefined))
    renderPage()
    await loaded()
    const [idle, s3] = within(slot()).getAllByTestId('hidden-item')
    fireEvent.click(within(idle).getByRole('button', { name: /dismiss/i }))
    fireEvent.click(within(idle).getByRole('button', { name: /reopen/i }))
    expect(svc.reopen).not.toHaveBeenCalled()
    await waitFor(() => expect(within(idle).getByRole('button', { name: /reopen/i })).toBeDisabled())
    expect(within(s3).getByRole('button', { name: /reopen/i })).toBeEnabled()
  })
})

/**
 * Stale-response safety, proven against the installed @tanstack/react-query
 * (5.90.12) rather than assumed: overlapping fetches where the OLDER one
 * answers last must not overwrite the newer data.
 */
describe('stale responses never overwrite newer data', () => {
  it('overlapping /hidden, /stats and list refetches: the older answer, arriving last, is ignored', async () => {
    renderPage()
    await loaded()
    await waitFor(() => expect(within(slot()).getByTestId('still-detected-count')).toHaveTextContent('2'))

    // Fetch #1 (older), started by a refresh, is still in flight...
    const oldHidden = deferred<HiddenFindings>()
    const oldStats = deferred<ReturnType<typeof stats>>()
    const oldList = deferred<unknown[]>()
    svc.getHidden.mockReturnValueOnce(oldHidden.promise)
    svc.getStats.mockReturnValueOnce(oldStats.promise)
    svc.getAll.mockReturnValueOnce(oldList.promise)
    act(() => {
      void queryClient.refetchQueries({ queryKey: ['cost-recommendations-hidden'] })
      void queryClient.refetchQueries({ queryKey: ['cost-recommendations-stats'] })
      void queryClient.refetchQueries({ queryKey: ['cost-recommendations'] })
    })
    await waitFor(() => expect(svc.getHidden).toHaveBeenCalledTimes(2))

    // ...when a reopen succeeds and its refresh (#2, newer) answers first.
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 2, totalPotentialSavings: 12.5 }))
    svc.getAll.mockResolvedValue([
      { id: 'a1', issue: 'Idle Instance', resourceId: 'i-1', status: 'ACTIVE', potentialSavings: 12.5, metadata: { savings_basis: 'estimated:x' } },
      { id: 'a2', issue: 'S3 Lifecycle Optimization', resourceId: 'b-1', status: 'ACTIVE', potentialSavings: 5, metadata: { savings_basis: 'ceiling:x' } },
    ])
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(within(kpiCard('Active Opportunities')).getByText('2')).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Still detected' })).not.toBeInTheDocument())
    expect(screen.getByText('2 active opportunities')).toBeInTheDocument()

    // The older responses now arrive, carrying the pre-reopen state.
    await act(async () => {
      oldHidden.resolve(PRODUCTION)
      oldStats.resolve(stats())
      oldList.resolve([])
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('heading', { name: 'Still detected' })).not.toBeInTheDocument()
    expect(within(kpiCard('Active Opportunities')).getByText('2')).toBeInTheDocument()
    expect(screen.getByText('2 active opportunities')).toBeInTheDocument()
    expect(queryClient.getQueryData(['cost-recommendations-hidden'])).toEqual(NOTHING_HIDDEN)
  })

  it('an older failed /hidden fetch arriving last does not turn newer data into C27', async () => {
    renderPage()
    await loaded()
    const old = deferred<HiddenFindings>()
    svc.getHidden.mockReturnValueOnce(old.promise)
    act(() => { void queryClient.refetchQueries({ queryKey: ['cost-recommendations-hidden'] }) })
    await waitFor(() => expect(svc.getHidden).toHaveBeenCalledTimes(2))
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Still detected' })).not.toBeInTheDocument())
    await act(async () => old.reject(new Error('late failure')))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(C27)).not.toBeInTheDocument()
  })
})

describe('mutation succeeds but a refresh fails', () => {
  it('/hidden refresh fails: C27 replaces the stale group (never presented as refreshed)', async () => {
    renderPage()
    await loaded()
    svc.getHidden.mockRejectedValue(new Error('Request failed with status code 500'))
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(C14))
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    expect(within(slot()).queryByRole('heading', { name: 'Still detected' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-list')).not.toBeInTheDocument()
    // The buttons are released once the refresh has settled (failed).
    expect(within(slot()).queryAllByRole('button', { name: /reopen/i })).toHaveLength(0)
  })

  it('/stats refresh fails: the KPIs say Unavailable, never the old totals', async () => {
    renderPage()
    await loaded()
    await waitFor(() => expect(within(kpiCard('Active Opportunities')).getByText('0')).toBeInTheDocument())
    svc.getStats.mockRejectedValue(new Error('x'))
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(within(kpiCard('Active Opportunities')).getByText('Unavailable')).toBeInTheDocument())
    expect(screen.getByText("Totals couldn't load. This doesn't mean there are no savings.")).toBeInTheDocument()
  })

  it('list refresh fails: the LIVE list error, not an empty state', async () => {
    renderPage()
    await loaded()
    svc.getAll.mockRejectedValue(new Error('x'))
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(screen.getByText("Couldn't load recommendations. Try again.")).toBeInTheDocument())
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
  })
})

describe('mobile and accessibility', () => {
  it('buttons are real, labelled buttons; long IDs wrap', async () => {
    renderPage()
    await loaded()
    for (const button of reopenButtons()) expect(button.tagName).toBe('BUTTON')
    const chip = within(slot()).getByText('i-placeholder0001')
    expect(chip.className).toMatch(/break-all/)
  })
})
