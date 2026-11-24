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
import { LEGACY_RUN, PRODUCTION_RESOLVED_ONLY, run, waitForLastAnalysis } from './fixtures'

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
    // The scan result banner: nothing waiting to be seen.
    getMyRunResult: async () => null,
    acknowledgeRunResult: async () => undefined,
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
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => { const accounts = await (svc.getAccounts()); return { accounts, connection: accounts.length > 0 ? 'connected' : 'not_connected' } } } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: () => svc.getDiscoveryJobs() } }))

// C7, tidy mock wording (Nov 19).
const C7_TWO = "You marked these resolved, but the latest analysis found them again. They aren't counted in the totals above until you reopen them."
const C7_ONE = "You marked this resolved, but the latest analysis found it again. It isn't counted in the totals above until you reopen it."
/** The group's heading carries its count: "Still detected (2)". */
const STILL_HEADING = /^Still detected \(\d+\)$/
const C14 = "Reopened. It's back in your active recommendations."
const C15 = "Reopened. It will appear after the next analysis if it's still detected."
const C16 = 'This finding was already reopened.'
const C17 = "Couldn't reopen this finding. Try again."
const C18 = 'Only members and above can reopen findings.'
const C26 = 'No resolved or dismissed findings are hidden.'
const C27 = "Couldn't load resolved and dismissed findings. Try again."
const EMPTY_HEADLINE = 'No active recommendations to review'

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
  await waitForLastAnalysis()
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
  it('shows "Still detected (n)", C7, C8 (estimate) and C9 (ceiling) in the left column, open, with its items', async () => {
    renderPage()
    await loaded()
    const group = slot()
    expect(within(group).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument()
    expect(within(group).getByTestId('still-detected-heading')).toHaveTextContent(/^Still detected \(2\)$/)
    expect(within(group).getByText(C7_TWO)).toBeInTheDocument()
    expect(within(group).getByText('Estimated $13/mo if addressed')).toBeInTheDocument()
    expect(within(group).getByText('Plus up to $5/mo in estimated ceilings, not expected savings.')).toBeInTheDocument()
    expect(within(group).getAllByTestId('hidden-item').map((el) => el.dataset.itemId)).toEqual(['decision-idle', 'decision-s3'])
    // S3 is a ceiling, labelled as such (LIVE wording); Idle is an estimate.
    expect(within(group).getByText('Up to $5/mo')).toBeInTheDocument()
    expect(within(group).getByText('Estimated ceiling, not an expected saving')).toBeInTheDocument()

    // Placement (tidy mock): the left column, after the disclaimer, never collapsed; the review list follows it.
    expect(screen.getByTestId('findings-column')).toContainElement(group)
    expect(screen.getByTestId('summary-column')).not.toContainElement(group)
    const disclaimer = screen.getByText(/Savings figures are estimated potential savings/)
    expect(disclaimer.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(group.compareDocumentPosition(screen.getByTestId('review-list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Not collapsed: no disclosure around it, no toggle in it.
    expect(group.closest('details')).toBeNull()
    expect(within(group).queryByRole('button', { expanded: false })).not.toBeInTheDocument()
  })

  it('each card (tidy mock): name, severity, STILL DETECTED chip, decision line, chips, amount, not counted, Reopen', async () => {
    renderPage()
    await loaded()
    const card = within(slot()).getAllByTestId('hidden-item')[0]
    const c = within(card)
    expect(c.getByText('Idle Instance')).toBeInTheDocument()
    expect(c.getByText('Low')).toBeInTheDocument()
    const chip = c.getByTestId('still-detected-chip')
    expect(chip).toHaveTextContent('Still detected')
    expect(chip.className).toMatch(/\buppercase\b/)
    expect(c.getByTestId('still-detected-meta')).toHaveTextContent(/^Resolved by Placeholder Person on Sep 3, 2026 · found again in the analysis .+ ago\.$/)
    for (const text of ['i-placeholder0001', 'placeholder-instance', 'EC2', 'us-east-1']) expect(c.getByText(text)).toBeInTheDocument()
    expect(c.getByText('$13/mo')).toBeInTheDocument()
    expect(c.getByTestId('not-counted')).toHaveTextContent('Not counted while resolved')
    expect(c.getByRole('button', { name: 'Reopen' })).toBeEnabled()
    // The review list's C10 line is not repeated in the group.
    expect(c.queryByText(/^Resolved .+ ago by Placeholder Person$/)).not.toBeInTheDocument()
  })

  it('no recorded actor: "Resolved on {date} · person not recorded"', async () => {
    renderPage()
    await loaded()
    const s3 = within(slot()).getAllByTestId('hidden-item')[1]
    expect(within(s3).getByTestId('still-detected-meta')).toHaveTextContent(/^Resolved on Oct 4, 2026 · person not recorded · found again in the analysis .+ ago\.$/)
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
    // The KPI value itself: the card also holds the High / Medium / Low chips, whose counts are 0 here.
    await waitFor(() => expect(kpiCard('Open opportunities').querySelector('.text-kpi')).toHaveTextContent(/^0$/))
    expect(within(kpiCard('Estimated monthly savings')).getByText('$0')).toBeInTheDocument()
    expect(within(kpiCard('Estimated monthly savings')).queryByText(/\$13/)).not.toBeInTheDocument()
  })

  it('nothing open: "Nothing to act on right now", with the group below it (no "No active recommendations" headline)', async () => {
    renderPage()
    await loaded()
    const empty = screen.getByTestId('empty-state')
    expect(within(empty).getByRole('heading', { name: 'Nothing to act on right now' })).toBeInTheDocument()
    // The run (PRODUCTION_RESOLVED_ONLY) has unknown_resource_count 1: never "passed all 9 active checks" (C2, founder ruling 2).
    expect(within(empty).getByText("No opportunities found in the resources DevControl could check. 1 resource couldn't be fully checked. DevControl runs the checks again on a schedule and lists anything new here.")).toBeInTheDocument()
    expect(empty.textContent).not.toMatch(/passed all/)
    expect(screen.queryByText(EMPTY_HEADLINE)).not.toBeInTheDocument()
    expect(empty.compareDocumentPosition(slot()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('KPI note: "+ n still detected (below)" under Open opportunities, from the /hidden summary', async () => {
    renderPage()
    await loaded()
    expect(within(kpiCard('Open opportunities')).getByTestId('kpi-still-detected')).toHaveTextContent(/^\+ 2 still detected \(below\)$/)
  })

  it('KPI note is absent when nothing is still detected, and while /hidden is loading or failed', async () => {
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    const first = renderPage()
    await loaded()
    expect(screen.queryByTestId('kpi-still-detected')).not.toBeInTheDocument()
    first.unmount()
    svc.getHidden.mockRejectedValue(new Error('x'))
    renderPage()
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    expect(screen.queryByTestId('kpi-still-detected')).not.toBeInTheDocument()
  })

  it('round 3: a group of ceilings only shows C9, never "Estimated" (the card says "Up to")', async () => {
    svc.getHidden.mockResolvedValue(hidden([S3], { stillDetected: { count: 1, estimatedMonthlySavings: 0, ceilingMonthlySavings: 5, ceilingByResourceType: { S3: 5 } } }))
    renderPage()
    await loaded()
    expect(within(slot()).queryByTestId('still-detected-estimate')).not.toBeInTheDocument()
    expect(within(slot()).queryByText(/Estimated \$/)).not.toBeInTheDocument()
    expect(within(slot()).getByTestId('still-detected-ceiling')).toHaveTextContent('Plus up to $5/mo in estimated ceilings, not expected savings.')
    const card = within(slot()).getByTestId('hidden-item')
    expect(within(card).getByText('Up to $5/mo')).toBeInTheDocument()
    expect(within(card).getByText('Estimated ceiling, not an expected saving')).toBeInTheDocument()
  })

  it('round 3: a group of estimates says "Estimated", and no card says "Up to" (low-activity included)', async () => {
    const lowActivity = item({ issueLabel: 'Low-activity instance', detection: { potentialSavings: 30.37, savingsBasis: 'estimated: compute cost from the list-price table' } })
    svc.getHidden.mockResolvedValue(hidden([lowActivity], { stillDetected: { count: 1, estimatedMonthlySavings: 30.37, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    expect(within(slot()).getByTestId('still-detected-estimate')).toHaveTextContent('Estimated $30/mo if addressed')
    expect(within(slot()).queryByTestId('still-detected-ceiling')).not.toBeInTheDocument()
    const card = within(slot()).getByTestId('hidden-item')
    expect(within(card).getByText('$30/mo')).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/Up to/)
  })

  it('round 3: no amount at all keeps C8\'s muted "$0/mo" (decision 5)', async () => {
    svc.getHidden.mockResolvedValue(hidden([item({ detection: { potentialSavings: null, savingsBasis: null } })], { stillDetected: { count: 1, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    const c8 = within(slot()).getByTestId('still-detected-estimate')
    expect(c8).toHaveTextContent('Estimated $0/mo if addressed')
    expect(c8.className).toMatch(/text-slate-500/)
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
    expect(within(slot()).getByTestId('still-detected-heading')).toHaveTextContent(/^Still detected \(1\)$/)
  })

  it('the count is the server summary, not a client tally of items', async () => {
    svc.getHidden.mockResolvedValue(hidden([IDLE, S3], { stillDetected: { count: 3, estimatedMonthlySavings: 1, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    expect(within(slot()).getByTestId('still-detected-heading')).toHaveTextContent(/^Still detected \(3\)$/)
  })

  it('a dismissed still-detected finding is never in the group', async () => {
    const dismissed = item({ id: 'decision-d', decision: 'DISMISSED' })
    svc.getHidden.mockResolvedValue(hidden([dismissed], { stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    // Nothing to show: no Still detected section at all (L3).
    expect(screen.queryByTestId('still-detected-slot')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: STILL_HEADING })).not.toBeInTheDocument()
  })

  it('C12 when nothing is fresh but some resolved findings could not be re-checked', async () => {
    const stale = (id: string) => item({ id, detection: { state: 'not_confirmed', reason: 'not_checked_since', lastDetectedAt: null, potentialSavings: null } })
    svc.getHidden.mockResolvedValue(hidden([stale('a'), stale('b')], { stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} } }))
    renderPage()
    await loaded()
    expect(within(slot()).getByText("2 resolved findings couldn't be re-checked by the latest analysis.")).toBeInTheDocument()
    expect(within(slot()).queryByRole('heading', { name: STILL_HEADING })).not.toBeInTheDocument()
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

  it('not connected: the shared NotConnectedCard, and no Still detected from an earlier connection (PR2)', async () => {
    svc.getAccounts.mockResolvedValue([])
    renderPage()
    const notConnected = await screen.findByTestId('not-connected-card')
    expect(within(notConnected).getByRole('heading', { name: 'No AWS account connected' })).toBeInTheDocument()
    expect(screen.queryByTestId('empty-state')).toBeNull()
    expect(screen.queryByRole('heading', { name: STILL_HEADING })).toBeNull()
  })

  it('never analyzed: its card stays', async () => {
    svc.getAnalysisRuns.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
    expect(within(await card()).getByText('No analysis has run yet')).toBeInTheDocument()
  })

  it('running: the Analysis in progress card stays', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'running', status: 'running', completed_at: null })])
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
    expect(within(await card()).getByText('Analysis in progress')).toBeInTheDocument()
  })

  it('failed: the failed card stays', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'failed', status: 'failed', error_message: 'None of the cost checks could complete. Try again.' })])
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
    expect(within(await card()).getByText("The last manual cost analysis didn't complete")).toBeInTheDocument()
  })

  it('7b legacy: the card and its caveat stay', async () => {
    svc.getAnalysisRuns.mockResolvedValue([LEGACY_RUN])
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
    const c = await card()
    expect(within(c).getByText(EMPTY_HEADLINE)).toBeInTheDocument()
    expect(within(c).getByTestId('legacy-caveat')).toHaveTextContent(/This list does not confirm that nothing can be saved/)
  })

  it('a completed run: the tidy empty sentence and the group, one after the other', async () => {
    renderPage()
    await loaded()
    expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument()
    expect(screen.getByTestId('empty-all-checks')).toBeInTheDocument()
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

describe('review fix L1: "each listed check" only when the rail lists the checks', () => {
  beforeEach(() => { svc.getAnalysisRuns.mockResolvedValue([LEGACY_RUN]) })

  it('/hidden failed: no checks sentence; the LIVE first sentence stays', async () => {
    svc.getHidden.mockRejectedValue(new Error('x'))
    renderPage()
    const c = await screen.findByTestId('empty-state')
    expect(within(c).getByTestId('legacy-caveat')).toHaveTextContent(/^Previously identified items have been resolved or dismissed\.$/)
    expect(c.textContent).not.toMatch(/each (listed )?check/)
  })

  it('no checks in the catalog: no checks sentence, and no checks card', async () => {
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    svc.getOptimizationRules.mockResolvedValue({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } })
    renderPage()
    await loaded()
    const c = await screen.findByTestId('empty-state')
    expect(c.textContent).not.toMatch(/each (listed )?check/)
    expect(screen.queryByTestId('checks-card')).not.toBeInTheDocument()
  })

  it('checks listed in the rail: the full caveat, naming "each listed check"', async () => {
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    renderPage()
    await loaded()
    const c = await screen.findByTestId('empty-state')
    await waitFor(() => expect(within(c).getByTestId('legacy-caveat')).toHaveTextContent(
      'Previously identified items have been resolved or dismissed. This list does not confirm that nothing can be saved: DevControl does not yet record whether each listed check completed with enough data.'
    ))
    expect(within(screen.getByTestId('check-names')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Idle EC2 instances', 'S3 lifecycle'])
  })
})

describe('/hidden failed: C27, never empty', () => {
  beforeEach(() => { svc.getHidden.mockRejectedValue(new Error('Request failed with status code 500')) })

  it('shows one C27 with Try again, no group, no count, no review list', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    expect(screen.getAllByText(C27)).toHaveLength(1)
    expect(within(slot()).queryByRole('heading', { name: STILL_HEADING })).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-list')).not.toBeInTheDocument()
    expect(screen.queryByText(C26)).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Resolved and dismissed \(0\)|status code 500/)
  })

  it('the empty card states the run only: no pointer to resolved or dismissed findings below', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    const card = await screen.findByTestId('empty-state')
    // unknown_resource_count 1 on the run: the truthful body, not "passed all 9 active checks" (C2, founder ruling 2).
    expect(within(card).getByTestId('empty-all-checks')).toHaveTextContent(/^Nothing to act on right nowNo opportunities found in the resources DevControl could check\. 1 resource couldn't be fully checked\. DevControl runs the checks again on a schedule and lists anything new here\.See what's checkedView costs →$/)
    expect(card.textContent).not.toMatch(/below/)
  })

  it('Try again refetches /hidden and recovers', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    svc.getHidden.mockResolvedValue(PRODUCTION)
    fireEvent.click(within(slot()).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
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

  it('"Nothing to act on right now" (light-lane layout), left-aligned, count from the run; no "below" pointer; the banner is not repeated', async () => {
    renderPage()
    await loaded()
    const card = await screen.findByTestId('empty-state')
    expect(within(card).getByTestId('empty-all-checks')).toHaveTextContent(/^Nothing to act on right nowYour resources passed all 9 active checks in the last analysis\. DevControl runs the checks again on a schedule and lists anything new here\.See what's checkedView costs →$/)
    expect(within(card).queryByText(EMPTY_HEADLINE)).not.toBeInTheDocument()
    expect(card.className).not.toMatch(/text-center/)
    // No banner for a run the user didn't start here (scan result banner PR); the card doesn't add one.
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(within(card).queryByText(/nothing new to review/)).not.toBeInTheDocument()
  })

  it('the count is the run\'s own: a run with 3 checks says 3', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ checks: run().checks!.slice(0, 3) })])
    renderPage()
    await loaded()
    expect(await screen.findByTestId('empty-all-checks')).toHaveTextContent(/passed all 3 active checks/)
  })

  it('a partial run, or one that found something new since resolved, never says "ran all … found nothing new"', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'partial', status: 'failed', failed_detector_count: 1, checks: run().checks!.map((c, i) => (i === 0 ? { ...c, outcome: 'failed' } : c)) })])
    const first = renderPage()
    await loaded()
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(EMPTY_HEADLINE)
    expect(screen.queryByTestId('empty-all-checks')).not.toBeInTheDocument()
    first.unmount()
    svc.getAnalysisRuns.mockResolvedValue([run({ detected_count: 1, new_count: 1, persisted_count: 1 })])
    renderPage()
    await loaded()
    expect(await screen.findByTestId('empty-state')).toHaveTextContent(EMPTY_HEADLINE)
    expect(screen.queryByTestId('empty-all-checks')).not.toBeInTheDocument()
  })

  it('the check list is no longer a centred bullet list', async () => {
    renderPage()
    await loaded()
    const card = await screen.findByTestId('empty-state')
    expect(card.querySelector('.rounded-full.bg-slate-400')).toBeNull()
    expect(card.querySelector('.items-center.flex-col')).toBeNull()
    expect(within(card).queryAllByText(/^ ?Idle EC2 instances$/)).toHaveLength(0)
  })

  it('truth fix: the run counted 2 resolved found again but /hidden has none still detected: the page claims no "found again"', async () => {
    svc.getAnalysisRuns.mockResolvedValue([PRODUCTION_RESOLVED_ONLY])
    const { container } = renderPage()
    await loaded()
    expect(container.textContent).not.toMatch(/found again/)
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
    await waitFor(() => expect(within(slot()).getByTestId('still-detected-heading')).toHaveTextContent(/^Still detected \(1\)$/))
    await waitFor(() => expect(within(kpiCard('Open opportunities')).getByText('1')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Opportunities (1)' })).toBeInTheDocument()
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
    await waitFor(() => expect(within(slot()).getByTestId('still-detected-heading')).toHaveTextContent(/^Still detected \(2\)$/))

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
    await waitFor(() => expect(within(kpiCard('Open opportunities')).getByText('2')).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('heading', { name: STILL_HEADING })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Opportunities (2)' })).toBeInTheDocument()

    // The older responses now arrive, carrying the pre-reopen state.
    await act(async () => {
      oldHidden.resolve(PRODUCTION)
      oldStats.resolve(stats())
      oldList.resolve([])
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('heading', { name: STILL_HEADING })).not.toBeInTheDocument()
    expect(within(kpiCard('Open opportunities')).getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Opportunities (2)' })).toBeInTheDocument()
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
    await waitFor(() => expect(screen.queryByRole('heading', { name: STILL_HEADING })).not.toBeInTheDocument())
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
    expect(within(slot()).queryByRole('heading', { name: STILL_HEADING })).not.toBeInTheDocument()
    expect(screen.queryByTestId('review-list')).not.toBeInTheDocument()
    // The buttons are released once the refresh has settled (failed).
    expect(within(slot()).queryAllByRole('button', { name: /reopen/i })).toHaveLength(0)
  })

  it('/stats refresh fails: the KPIs say Unavailable, never the old totals', async () => {
    renderPage()
    await loaded()
    // The KPI value itself: the card also holds the High / Medium / Low chips, whose counts are 0 here.
    await waitFor(() => expect(kpiCard('Open opportunities').querySelector('.text-kpi')).toHaveTextContent(/^0$/))
    svc.getStats.mockRejectedValue(new Error('x'))
    fireEvent.click(within(slot()).getAllByRole('button', { name: /reopen/i })[0])
    await waitFor(() => expect(within(kpiCard('Open opportunities')).getByText('Unavailable')).toBeInTheDocument())
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

// ── PR 4 (founder decisions Nov 4): the EC2 default price, and C27's pending retry ──

const S1 = "Estimate. This instance type's price is unknown, so a default of $50/mo is used."

function activeRec(id: string, metadata: Record<string, unknown>) {
  return {
    id, resourceId: `i-placeholder${id}`, issue: 'Idle Instance', severity: 'LOW', status: 'ACTIVE', potentialSavings: 50,
    metadata: { savings_basis: 'estimated: placeholder', ...metadata },
  }
}

describe('PR 4: S1 on a default-price row and still-detected item only', () => {
  it('a default-price ACTIVE row shows S1 under its estimate; a genuine $50 list price and a legacy row do not', async () => {
    svc.getAll.mockResolvedValue([
      activeRec('default', { price_source: 'default_unlisted_type' }),
      activeRec('listed', { price_source: 'list_table' }),
      activeRec('legacy', {}),
    ])
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 3, totalPotentialSavings: 150, bySeverity: { high: 0, medium: 0, low: 3 } }))
    svc.getHidden.mockResolvedValue(NOTHING_HIDDEN)
    renderPage()
    await waitFor(() => expect(screen.getByText(S1)).toBeInTheDocument())
    expect(screen.getAllByText(S1)).toHaveLength(1)
    // It sits on the default row, beside its "$50/mo" figure.
    const row = screen.getByText('i-placeholderdefault').closest('.rounded-xl') as HTMLElement
    expect(within(row).getByText(S1)).toBeInTheDocument()
    expect(within(row).getByText('$50/mo')).toBeInTheDocument()
    for (const id of ['listed', 'legacy']) {
      const other = screen.getByText(`i-placeholder${id}`).closest('.rounded-xl') as HTMLElement
      expect(within(other).getByText('$50/mo')).toBeInTheDocument()
      expect(within(other).queryByText(S1)).not.toBeInTheDocument()
    }
  })

  it('a still-detected item with the default price shows S1; one with a list price does not', async () => {
    svc.getHidden.mockResolvedValue(hidden([
      item({ detection: { potentialSavings: 50, priceSource: 'default_unlisted_type' } }),
      item({ id: 'decision-listed', resourceId: 'i-placeholder0002', detection: { potentialSavings: 50, priceSource: 'list_table' } }),
    ]))
    renderPage()
    await waitFor(() => expect(within(slot()).getByText(S1)).toBeInTheDocument())
    const items = within(slot()).getAllByTestId('hidden-item')
    expect(within(items[0]).getByText(S1)).toBeInTheDocument()
    expect(within(items[1]).queryByText(S1)).not.toBeInTheDocument()
  })

  it('an item from before PR 4 (no priceSource) shows no S1', async () => {
    svc.getHidden.mockResolvedValue(hidden([item({ detection: { potentialSavings: 50 } })]))
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
    expect(screen.queryByText(S1)).not.toBeInTheDocument()
  })
})

describe('PR 4: C27 "Try again" shows a pending state while retrying (D8)', () => {
  const retryButton = () => within(slot()).getByRole('button', { name: 'Try again' })

  /** /hidden loaded once, then a refetch failed: C27 over cached data (React Query keeps status 'error' while it retries). */
  async function c27OverCachedData() {
    renderPage()
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
    svc.getHidden.mockRejectedValue(new Error('Request failed with status code 500'))
    await act(async () => { await queryClient.refetchQueries({ queryKey: ['cost-recommendations-hidden'] }) })
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    expect(retryButton()).not.toBeDisabled()
    expect(retryButton()).not.toHaveAttribute('aria-busy')
    expect(retryButton().querySelector('.animate-spin')).toBeNull()
  }

  it('pending: disabled, aria-busy, spinner, same label; repeat clicks send nothing; recovers on success', async () => {
    await c27OverCachedData()
    const pending = deferred<HiddenFindings>()
    svc.getHidden.mockReturnValue(pending.promise)
    const callsBefore = svc.getHidden.mock.calls.length
    fireEvent.click(retryButton())

    await waitFor(() => expect(retryButton()).toBeDisabled())
    expect(retryButton()).toHaveAttribute('aria-busy', 'true')
    expect(retryButton().querySelector('.animate-spin')).not.toBeNull()
    expect(retryButton()).toHaveTextContent(/^Try again$/)
    expect(screen.getAllByText(C27)).toHaveLength(1)
    fireEvent.click(retryButton())
    fireEvent.click(retryButton())
    expect(svc.getHidden.mock.calls.length).toBe(callsBefore + 1)

    await act(async () => { pending.resolve(PRODUCTION) })
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
    expect(screen.queryByText(C27)).not.toBeInTheDocument()
  })

  it('a failed retry returns the button to normal', async () => {
    await c27OverCachedData()
    const pending = deferred<HiddenFindings>()
    svc.getHidden.mockReturnValue(pending.promise)
    fireEvent.click(retryButton())
    await waitFor(() => expect(retryButton()).toBeDisabled())

    await act(async () => { pending.reject(new Error('Request failed with status code 500')) })
    await waitFor(() => expect(retryButton()).not.toBeDisabled())
    expect(retryButton()).not.toHaveAttribute('aria-busy')
    expect(retryButton().querySelector('.animate-spin')).toBeNull()
    expect(screen.getAllByText(C27)).toHaveLength(1)
  })

  it('with nothing cached, a retry already shows the busy section (no C27, no button) and sends one request', async () => {
    svc.getHidden.mockRejectedValue(new Error('Request failed with status code 500'))
    renderPage()
    await waitFor(() => expect(screen.getByText(C27)).toBeInTheDocument())
    const pending = deferred<HiddenFindings>()
    svc.getHidden.mockReturnValue(pending.promise)
    const callsBefore = svc.getHidden.mock.calls.length
    fireEvent.click(retryButton())
    await waitFor(() => expect(slot()).toHaveAttribute('aria-busy', 'true'))
    expect(screen.getByTestId('hidden-loading')).toBeInTheDocument()
    expect(screen.queryByText(C27)).not.toBeInTheDocument()
    expect(svc.getHidden.mock.calls.length).toBe(callsBefore + 1)
    await act(async () => { pending.resolve(PRODUCTION) })
    await waitFor(() => expect(within(slot()).getByRole('heading', { name: STILL_HEADING })).toBeInTheDocument())
  })
})
