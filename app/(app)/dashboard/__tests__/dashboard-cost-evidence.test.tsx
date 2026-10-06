/**
 * The Dashboard's evidence-aware spend KPI, end to end through the real
 * DashboardPage:
 *   - the connection gates and the connection state still read only
 *     /api/aws/accounts and /api/platform/stats/dashboard (monthlyAwsCost et
 *     al.), so they behave identically whatever the Cost Explorer evidence
 *     says ($0, net credit, unavailable, error, failed request) -- including
 *     connected via only one of those signals;
 *   - an organization with no AWS account stays on the dashboard (no
 *     redirect) and sees what the dashboard will show and how connecting
 *     works, in words only, with no connected content; a failed accounts
 *     request is "unknown", never "not connected";
 *   - the AI Summary request carries nothing from the page (no MoM value);
 *   - a failed or empty cost trend reads as such, not as a $0 chart.
 * All figures are test fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from '../page'
import type { CostSummary, PlatformDashboardStats } from '@/lib/types'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { monitoringService } from '@/lib/services/monitoring.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { accountSecurityFindingsService } from '@/lib/services/account-security-findings.service'
import { awsResourcesService } from '@/lib/services/aws-resources.service'
import { aiSummaryService } from '@/lib/services/ai-summary.service'
import { systemIntelligenceService } from '@/lib/services/system-intelligence.service'
import { activityFeedService } from '@/lib/services/activity-feed.service'
import { soc2Service } from '@/lib/services/soc2.service'
import { complianceFrameworksService } from '@/lib/services/compliance-frameworks.service'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null, isConnected: false }) }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }),
}))

type SpendSection = CostSummary['spend']
type MomSection = CostSummary['monthOverMonth']
const actual = (amount: number): SpendSection => ({
  state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: null, coverage: null, reason: null,
  data: { amount, basis: 'billed_month_to_date', lastDayInProgress: false },
})
const noSpend = (state: 'unavailable' | 'error'): SpendSection =>
  ({ state, source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null })
const noMom = (state: 'unavailable' | 'error'): MomSection =>
  ({ state, source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null })

/** Cost Explorer evidence scenarios for one connected account. `null` = the summary request itself fails. */
const EVIDENCE: Array<[string, CostSummary | null, string]> = [
  ['actual $0', { spend: actual(0), monthOverMonth: noMom('unavailable') }, '$0.00'],
  ['net credit', { spend: actual(-12.34), monthOverMonth: noMom('unavailable') }, '-$12.34'],
  ['unavailable', { spend: noSpend('unavailable'), monthOverMonth: noMom('unavailable') }, '—'],
  ['error', { spend: noSpend('error'), monthOverMonth: noMom('error') }, '—'],
  ['failed request', null, '—'],
]

/**
 * What /api/platform/stats/dashboard (unchanged) returns: an account with
 * billing data, one whose legacy figure is 0 with services but no billing data
 * yet, and one with nothing at all yet.
 */
const LEGACY_STATS: Record<'billing' | 'servicesOnly' | 'zero', PlatformDashboardStats> = {
  billing: { totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 100, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual' },
  servicesOnly: { totalServices: 3, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0, monthlyAwsCost: 0, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'estimated' },
  zero: { totalServices: 0, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0, monthlyAwsCost: 0, costChange: 0, totalTeams: 0, teamsChange: 0, costSource: 'estimated' },
}
const SYNCING_BANNER = /Historical billing data is still syncing/
const BILLING_SYNC_BANNER = /Billing sync in progress/
const CONNECTED_ACCOUNTS = [{ id: 'acct' }]

let client: QueryClient
let trendResponse: { ok: boolean; data: unknown[] }
/** What /api/aws/accounts returns (the other connection signal besides the legacy stats). */
let awsAccounts: unknown[]
/** HTTP status of /api/aws/accounts, or 'pending' for a request that never settles. */
let awsAccountsStatus: number | 'pending'

/** The role claim of the stored access token, which is where the page reads the caller's role. */
function signInAs(role: string | null) {
  if (role === null) localStorage.removeItem('accessToken')
  else localStorage.setItem('accessToken', `header.${btoa(JSON.stringify({ role }))}.signature`)
}

function setup(stats: PlatformDashboardStats, summary: CostSummary | null) {
  vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue(stats)
  if (summary) vi.spyOn(platformStatsService, 'getCostSummary').mockResolvedValue(summary)
  else vi.spyOn(platformStatsService, 'getCostSummary').mockRejectedValue(new Error('HTTP 500'))
}

beforeEach(() => {
  localStorage.clear()
  router.replace.mockClear()
  router.push.mockClear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(monitoringService, 'getSystemHealth').mockResolvedValue({ status: 'operational' } as never)
  vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue([] as never)
  vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue({ totalPotentialSavings: 0, activeRecommendations: 0 } as never)
  vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([] as never)
  vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: null } as never)
  vi.spyOn(systemIntelligenceService, 'getIntelligence').mockResolvedValue(null as never)
  vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
  vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } } as never)
  vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null } as never)
  vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([] as never)
  vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never)
  trendResponse = { ok: true, data: [{ date: '2026-09-26', compute: 1, storage: 0, database: 0, network: 0, other: 0, total: 1 }, { date: '2026-09-27', compute: 2, storage: 0, database: 0, network: 0, other: 0, total: 2 }] }
  // aws-accounts and cost-trend call fetch() directly: a connected account unless a test says otherwise.
  awsAccounts = CONNECTED_ACCOUNTS
  awsAccountsStatus = 200
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (!String(url).includes('/api/aws/accounts')) {
      return Promise.resolve({ ok: trendResponse.ok, json: async () => (trendResponse.ok ? { success: true, data: trendResponse.data } : { success: false }) })
    }
    if (awsAccountsStatus === 'pending') return new Promise(() => {})
    const ok = awsAccountsStatus === 200
    // A failed response carries an error body, as the backend's do -- not a list.
    return Promise.resolve({ ok, status: awsAccountsStatus, json: async () => (ok ? { success: true, data: awsAccounts } : { success: false, error: 'fixture' }) })
  }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderDashboard() {
  return render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
}
/** The spend KPI card (the one whose title links to /costs) showing `value`. */
function spendCard(value: string): HTMLElement | undefined {
  return screen.getAllByText(value)
    .map((el) => el.closest('[data-testid="kpi-card"]') as HTMLElement | null)
    .find((card): card is HTMLElement => !!card?.querySelector('a[href="/costs"]'))
}
/** The spend KPI card's face, once its figure has settled (not loading). */
async function spendCardText(expectedValue: string) {
  await waitFor(() => expect(spendCard(expectedValue)).toBeDefined())
  return spendCard(expectedValue)!.textContent ?? ''
}
/** The spend card's face plus its info panel, where provenance now lives. */
async function spendCardEvidenceText(expectedValue: string) {
  const face = await spendCardText(expectedValue)
  fireEvent.click(within(spendCard(expectedValue)!).getByRole('button', { name: /^About / }))
  return `${face} ${(await screen.findByRole('dialog')).textContent ?? ''}`
}
/**
 * Waits until every input the connection decision depends on has settled --
 * the accounts request, the legacy stats, and the cost evidence -- so an
 * assertion can't pass merely because the accounts hadn't loaded yet.
 */
async function gateInputsSettled() {
  await waitFor(() => {
    expect(client.getQueryState(['aws-accounts', 'org-test'])?.status).not.toBe('pending')
    expect(client.getQueryState(['platform-dashboard-stats', 'org-test'])?.status).toBe('success')
    expect(client.getQueryState(['platform-cost-summary', 'org-test'])?.status).not.toBe('pending')
  })
}

describe('connection gates and the connection state ignore the cost evidence', () => {
  for (const legacy of ['billing', 'servicesOnly'] as const) {
    it.each(EVIDENCE)(`legacy stats "${legacy}", evidence %s: never redirects, and the billing banner follows only the legacy stats`, async (_name, summary, value) => {
      setup(LEGACY_STATS[legacy], summary)
      renderDashboard()

      await spendCardText(value)
      await gateInputsSettled()
      expect(router.replace).not.toHaveBeenCalled()
      // hasServicesOnly comes from computeDashboardAwsGates(stats) alone.
      if (legacy === 'servicesOnly') expect(screen.getByText(SYNCING_BANNER)).toBeInTheDocument()
      else expect(screen.queryByText(SYNCING_BANNER)).not.toBeInTheDocument()
      // The primary KPI row renders (isAwsConnected) in every case.
      expect(screen.getByText('Security Posture')).toBeInTheDocument()
    })
  }

  // Connected through only one of the two legacy signals: the other can't mask
  // the evidence leaking into the connection decision.
  it.each(EVIDENCE)('accounts connected, all legacy stats zero, evidence %s: never redirects, and the billing-sync banner shows', async (_name, summary, value) => {
    setup(LEGACY_STATS.zero, summary)
    renderDashboard()

    await spendCardText(value)
    await gateInputsSettled()
    expect(router.replace).not.toHaveBeenCalled()
    // isBillingSyncing comes from computeDashboardAwsGates(stats) alone.
    expect(screen.getByText(BILLING_SYNC_BANNER)).toBeInTheDocument()
    expect(screen.queryByText(SYNCING_BANNER)).not.toBeInTheDocument()
  })

  it.each(EVIDENCE)('no accounts, legacy billing stats present, evidence %s: never redirects', async (_name, summary, value) => {
    awsAccounts = []
    setup(LEGACY_STATS.billing, summary)
    renderDashboard()

    await spendCardText(value)
    await gateInputsSettled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.queryByText(BILLING_SYNC_BANNER)).not.toBeInTheDocument()
    expect(screen.getByText('Security Posture')).toBeInTheDocument()
  })

  it.each(EVIDENCE)('no accounts and all legacy stats zero, evidence %s: stays on the dashboard, unconnected, with no connected content', async (_name, summary) => {
    awsAccounts = []
    setup(LEGACY_STATS.zero, summary)
    renderDashboard()

    await gateInputsSettled()
    expect(await screen.findByTestId('dashboard-preview')).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
    // Even actual Cost Explorer spend ($0 or a credit) does not make the account "connected".
    expectNoConnectedContent()
  })
})

/** Hero copy and the slim line this work removed: connecting is offered once, in the preview header. */
const OLD_COPY = /Connect your AWS account|to get started|Setup takes|2 minutes|Set up →|ask your organization owner to connect it/i
/** How many times the page says "not connected" in any casing: only ever the non-owner's hero pill. */
function notConnectedMentions(): number {
  return (document.body.textContent ?? '').match(/not connected/gi)?.length ?? 0
}

/** What the Cost optimization feature card says: the one sentence on this page allowed to use the word "savings". */
const COST_OPTIMIZATION_COPY = 'Savings opportunities found in your AWS account.'
/** The three feature cards, in order: title, description, check lines, and the plan label beside the title (if any). */
const FEATURE_CARDS: Array<[string, string, string[], string | null]> = [
  ['Cost optimization', COST_OPTIMIZATION_COPY, ['Idle EC2 instances and unattached EBS volumes', 'gp2-to-gp3 volume upgrades', 'An estimated monthly saving for each'], null],
  ['AI assistant', 'Ask questions about your spend and security.', ["Answers drawn from your account's data", "Says plainly when data isn't available"], 'Pro'],
  ['Weekly summary', 'A weekly email to your workspace owner.', ['Spend compared with the previous week', 'Security findings and deployments'], null],
]
/** The eight preview cards, exactly and in page order: title, description, and what the connected card adds. */
const PREVIEW_CARDS: Array<[string, string, string[]]> = [
  ['Month-to-Date Spend', 'Actual spend from AWS Cost Explorer.', ['Compared with the same days last month', 'Daily cost trend by service']],
  ['Security Posture', 'Account findings and resource compliance checks.', ['Findings by severity', 'A score out of 100, with its reasons']],
  ['Infrastructure Posture', 'A composite of cost, security and alert coverage.', ['Each component scored separately', 'Clear notes where evidence is partial']],
  ...FEATURE_CARDS.map(([title, description, shows]): [string, string, string[]] => [title, description, shows]),
  ['Top Risk', 'The most serious security finding in your account, with a link to the finding.', []],
  ['Resource checks', 'AWS status checks and CloudWatch thresholds for your resources.', []],
]
const STEPS = [
  'Create a read-only IAM role in your AWS account using the policy we provide.',
  "Paste the role's ARN into DevControl. We verify access before saving.",
  'The first scan runs automatically. Cost data can take a day or two to arrive from AWS.',
]
const STEPS_FOOTER = "You control the role: deleting it in AWS removes DevControl's access."
const PREVIEW_SUBCOPY = 'DevControl reads your account through a read-only IAM role you create and control.'
/** Anything that would read as a figure, amount, share or placeholder. */
const FABRICATED_VALUE = /\d|\$|%|—|\bN\/A\b/
/** The one place the spec's own wording names a number: the scale of the score, not a score. */
const SCORE_SCALE = 'A score out of 100, with its reasons'
/** The only product terms in the preview that contain a digit, each allowed once: an AWS service and a volume-type upgrade. */
const NAMES_WITH_DIGITS = ['EC2', 'gp2-to-gp3']
/** Words this state must not use: it promises nothing the product does not measure or do. */
const FORBIDDEN = /health|operational signals|recommendations|prioriti[sz]ed|\bfix|savings|sample|example/i
/** The page text with the Cost optimization card's sentence removed, once: nowhere else may say "savings". */
function textOutsideCostOptimizationCopy(): string {
  return (document.body.textContent ?? '').replace(COST_OPTIMIZATION_COPY, '')
}

/** The preview section and the "How connecting works" strip, word for word, with nothing interactive in them. */
function expectPreviewAndSteps() {
  const preview = screen.getByTestId('dashboard-preview')
  expect(within(preview).getByText(PREVIEW_SUBCOPY)).toBeInTheDocument()

  const cards = within(preview).getAllByTestId('preview-card')
  expect(cards.map((card) => [
    within(card).getByTestId('preview-title').textContent,
    within(card).getByTestId('preview-description').textContent,
    within(card).queryAllByTestId('preview-shows').map((line) => line.textContent),
  ])).toEqual(PREVIEW_CARDS)
  expect(within(within(preview).getByTestId('preview-primary-row')).getAllByTestId('preview-card')).toHaveLength(3)
  expect(within(within(preview).getByTestId('preview-secondary-row')).getAllByTestId('preview-card')).toHaveLength(2)
  expectFeatureRow(preview)
  for (const card of cards) {
    // Not a link, not a button, nothing focusable, and no bar or chart.
    expect(card.closest('a, button, [role="button"], [role="link"]')).toBeNull()
    expect(card.querySelector('a, button, [role="button"], [role="link"], [tabindex], [role="progressbar"], svg:not(.lucide)')).toBeNull()
    expect(card.className).not.toMatch(/hover:|cursor-pointer|focus|opacity/)
    expect(within(card).getByRole('heading', { level: 3 })).toBe(within(card).getByTestId('preview-title'))
  }

  const steps = screen.getByTestId('connecting-steps')
  expect(within(steps).getByRole('heading', { level: 2, name: 'How connecting works' })).toBeInTheDocument()
  const items = within(steps).getAllByTestId('connecting-step')
  expect(items.map((item) => item.textContent)).toEqual(STEPS.map((step, i) => `${i + 1}${step}`))
  expect(within(steps).getByTestId('connecting-footer').textContent).toBe(STEPS_FOOTER)
  expect(steps.querySelector('a, button, [role="button"], [role="link"], [tabindex], [role="progressbar"], svg:not(.lucide)')).toBeNull()

  // No figure anywhere: only the step numbers, the named score scale and two product names contain a digit.
  const previewText = NAMES_WITH_DIGITS.reduce((text, name) => text.replace(name, ''), (preview.textContent ?? '').replace(SCORE_SCALE, ''))
  expect(previewText).not.toMatch(FABRICATED_VALUE)
  const stepsClone = steps.cloneNode(true) as HTMLElement
  stepsClone.querySelectorAll('[data-testid="connecting-step-number"]').forEach((n) => n.remove())
  expect(stepsClone.textContent).not.toMatch(FABRICATED_VALUE)
  expect([...steps.querySelectorAll('[data-testid="connecting-step-number"]')].map((n) => n.textContent)).toEqual(['1', '2', '3'])

  // Decorative icons are hidden from assistive technology.
  for (const icon of [...preview.querySelectorAll('svg'), ...steps.querySelectorAll('svg')]) expect(icon).toHaveAttribute('aria-hidden', 'true')
}
/**
 * The middle row: exactly the three feature cards, between the KPI row and the
 * Top Risk / Resource checks row, on the KPI row's own grid, with a plan label
 * only where the product enforces a plan.
 */
function expectFeatureRow(preview: HTMLElement) {
  const rows = [...preview.children].map((child) => child.getAttribute('data-testid')).filter((id) => id?.endsWith('-row'))
  expect(rows).toEqual(['preview-primary-row', 'preview-feature-row', 'preview-secondary-row'])

  const kpiRow = within(preview).getByTestId('preview-primary-row')
  const featureRow = within(preview).getByTestId('preview-feature-row')
  const cards = within(featureRow).getAllByTestId('preview-card')
  expect(cards.map((card) => [
    within(card).getByTestId('preview-title').textContent,
    within(card).getByTestId('preview-description').textContent,
    within(card).queryAllByTestId('preview-shows').map((line) => line.textContent),
    within(card).queryByTestId('preview-plan-label')?.textContent ?? null,
  ])).toEqual(FEATURE_CARDS)
  // Nothing in the row but the three cards: no heading, label or extra card.
  expect(featureRow.children).toHaveLength(3)
  expect(within(preview).getAllByRole('heading', { level: 2 })).toHaveLength(1)
  expect(preview.textContent).not.toMatch(/Also included/i)

  // "Pro" appears once in the whole preview: beside the AI assistant title, outside the heading.
  const labels = within(preview).getAllByTestId('preview-plan-label')
  expect(labels.map((label) => label.textContent)).toEqual(['Pro'])
  expect(labels[0].closest('[data-testid="preview-card"]')).toBe(cards[1])
  expect(labels[0].closest('h3')).toBeNull()
  // No plan is named anywhere else in the preview: not in a title, a description or a checklist line.
  for (const node of preview.querySelectorAll('[data-testid="preview-title"], [data-testid="preview-description"], [data-testid="preview-shows"], h2, p')) {
    expect(node.textContent).not.toMatch(/\b(Free|Starter|Pro|Enterprise)\b/)
  }

  // Check lines are the KPI cards' own: the same list, the same line classes and the same check icon.
  const kpiLine = within(kpiRow).getAllByTestId('preview-shows')[0]
  for (const line of within(featureRow).getAllByTestId('preview-shows')) {
    expect(line.tagName).toBe('LI')
    expect(line.className).toBe(kpiLine.className)
    expect(line.parentElement?.tagName).toBe('UL')
    expect(line.parentElement?.className).toBe(kpiLine.parentElement?.className)
    expect(line.querySelector('svg')?.getAttribute('class')).toBe(kpiLine.querySelector('svg')?.getAttribute('class'))
    expect(line.querySelector('svg.lucide-check')).not.toBeNull()
  }

  // Same grid and same card classes as the KPI row, so both rows are three across on
  // desktop and stack identically below it (two columns with the third card spanning, then one).
  expect(featureRow.className).toBe(kpiRow.className)
  const kpiCards = within(kpiRow).getAllByTestId('preview-card')
  expect(cards.map((card) => card.className)).toEqual(kpiCards.map((card) => card.className))
  expect(featureRow.className).toMatch(/\bgrid-cols-1\b.*\bsm:grid-cols-2\b.*\blg:grid-cols-3\b/)
  // Nothing sets a fixed or minimum width that could force horizontal scrolling on a phone.
  for (const node of [featureRow, ...featureRow.querySelectorAll('*')]) {
    expect(node.getAttribute('class') ?? '').not.toMatch(/(^|\s)(min-w-\[|w-\[|whitespace-nowrap|overflow-x)/)
  }
}
/** The whole unconnected page: nothing forbidden, nothing left over from the earlier versions. */
function expectUnconnectedPageWording() {
  const text = textOutsideCostOptimizationCopy()
  expect(text).not.toMatch(OLD_COPY)
  expect(text).not.toMatch(FORBIDDEN)
  expect(screen.queryByTestId('aws-connection-line')).not.toBeInTheDocument()
  // The hero is as designed; whether its AWS pill is a link depends on the role (asserted per role).
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  expect(screen.getByTestId('provider-pill-aws')).toHaveAttribute('data-state', 'not-connected')
  expect(screen.getByTestId('provider-pill-gcp')).toHaveTextContent('GCP soon')
  expect(screen.getByTestId('provider-pill-azure')).toHaveTextContent('Azure soon')
  expect(screen.getByText('Org Test')).toBeInTheDocument()
}
function expectNoPreview() {
  expect(screen.queryByTestId('dashboard-preview')).not.toBeInTheDocument()
  expect(screen.queryByTestId('preview-card')).not.toBeInTheDocument()
  expect(screen.queryByTestId('preview-feature-row')).not.toBeInTheDocument()
  expect(screen.queryByTestId('preview-plan-label')).not.toBeInTheDocument()
  for (const [title, description, shows] of FEATURE_CARDS) {
    expect(screen.queryByRole('heading', { level: 3, name: title })).not.toBeInTheDocument()
    for (const text of [description, ...shows]) expect(document.body.textContent).not.toContain(text)
  }
  expect(screen.queryByTestId('connecting-steps')).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(/What you'll see|What your team will see|How connecting works/)
}
/** How many times /api/aws/accounts was requested. */
function accountsRequests(): number {
  return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/api/aws/accounts')).length
}
/** Long enough for the accounts query's one retry (about a second after the first failure). */
const AFTER_RETRY = { timeout: 5000 }

/** Nothing the connected dashboard shows: no KPI row, no figures, no scores, no sections. */
function expectNoConnectedContent() {
  expect(screen.queryByTestId('kpi-row')).not.toBeInTheDocument()
  expect(screen.queryByTestId('kpi-card')).not.toBeInTheDocument()
  expect(screen.queryByTestId('kpi-title')).not.toBeInTheDocument()
  expect(document.querySelector('[role="progressbar"]')).toBeNull()
  for (const text of [SYNCING_BANNER, BILLING_SYNC_BANNER]) {
    expect(screen.queryByText(text)).not.toBeInTheDocument()
  }
  expect(textOutsideCostOptimizationCopy()).not.toMatch(/\$\d|\/100|savings/i)
}
function expectNoNavigation() {
  expect(router.replace).not.toHaveBeenCalled()
  expect(router.push).not.toHaveBeenCalled()
}

describe('an organization with no AWS account stays on the dashboard', () => {
  beforeEach(() => {
    awsAccounts = []
    setup(LEGACY_STATS.zero, { spend: noSpend('unavailable'), monthOverMonth: noMom('unavailable') })
  })

  it('owner: the preview with its heading and the one primary button to /connect-aws, the strip, and nothing else', async () => {
    signInAs('owner')
    renderDashboard()

    const preview = await screen.findByTestId('dashboard-preview')
    expect(within(preview).getByRole('heading', { level: 2, name: "What you'll see after connecting AWS" })).toBeInTheDocument()
    const action = within(preview).getByTestId('preview-action')
    expect(action.textContent).toBe('Takes a few minutes' + 'Connect AWS' + '→')
    const button = within(action).getByRole('link', { name: 'Connect AWS' })
    expect(button).toHaveAttribute('href', '/connect-aws')
    expect(screen.getByTestId('provider-pill-aws').tagName).toBe('A')
    expect(screen.getByTestId('provider-pill-aws').textContent).toBe('Connect AWS')
    expect(notConnectedMentions()).toBe(0)
    expect(button.className).toContain('bg-[var(--text-accent)]')
    expect(button.className).toContain('min-h-[44px]')
    await gateInputsSettled()
    expectPreviewAndSteps()
    expectUnconnectedPageWording()
    expectNoNavigation()
    expectNoConnectedContent()
    // The only ways to /connect-aws are the hero pill and the button; the button is the only filled control.
    expect([...document.querySelectorAll('a[href="/connect-aws"]')].map((a) => a.getAttribute('data-testid'))).toEqual(['provider-pill-aws', 'preview-connect'])
    expect([...document.querySelectorAll('[class*="bg-[var(--text-accent)]"]')]).toEqual([button])
  })

  it.each([
    ['member', 'member'],
    ['viewer', 'viewer'],
    ['admin', 'admin'],
    ['no role available', null],
    ['an unrecognised role', 'superuser'],
  ])('%s: the non-owner heading and text, with no button or link in the section', async (_name, role) => {
    signInAs(role)
    renderDashboard()

    const preview = await screen.findByTestId('dashboard-preview')
    expect(within(preview).getByRole('heading', { level: 2, name: 'What your team will see once AWS is connected' })).toBeInTheDocument()
    expect(within(preview).getByTestId('preview-action').textContent).toBe('Ask your organization owner to connect AWS.')
    expect(preview.querySelector('a, button, [role="button"]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/What you'll see after connecting|Takes a few minutes/)
    await gateInputsSettled()
    expectPreviewAndSteps()
    expectUnconnectedPageWording()
    expectNoNavigation()
    expectNoConnectedContent()
    // Nothing on the page leads to /connect-aws: the hero pill is plain text too, and nothing is filled.
    const pill = screen.getByTestId('provider-pill-aws')
    expect(pill.tagName).toBe('SPAN')
    expect(pill.textContent).toBe('AWS not connected')
    expect(pill.closest('a, button')).toBeNull()
    // Said once, by the pill; "Connect AWS" appears only where the owner is named as the one to do it.
    expect(notConnectedMentions()).toBe(1)
    expect(screen.queryByText('Connect AWS')).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/connect-aws"]')).toBeNull()
    expect(screen.queryByRole('link', { name: /Connect AWS/ })).not.toBeInTheDocument()
    expect(document.querySelector('[class*="bg-[var(--text-accent)]"]')).toBeNull()
  })

  it('the AI Summary is not requested (the backend would call the model to summarise nothing)', async () => {
    signInAs('owner')
    renderDashboard()

    await screen.findByTestId('dashboard-preview')
    await gateInputsSettled()
    expect(aiSummaryService.getSummary).not.toHaveBeenCalled()
    expect(client.getQueryState(['ai-summary', 'org-test'])?.fetchStatus ?? 'idle').toBe('idle')
  })
})

describe('while the accounts request is unresolved', () => {
  it('there is no connection line, no AWS pill, no connected content, and no AI Summary request', async () => {
    signInAs('owner')
    awsAccountsStatus = 'pending'
    setup(LEGACY_STATS.zero, { spend: noSpend('unavailable'), monthOverMonth: noMom('unavailable') })
    renderDashboard()

    // The stats and the cost evidence have settled; only the accounts are outstanding.
    await waitFor(() => {
      expect(client.getQueryState(['platform-dashboard-stats', 'org-test'])?.status).toBe('success')
      expect(client.getQueryState(['platform-cost-summary', 'org-test'])?.status).not.toBe('pending')
    })
    expect(client.getQueryState(['aws-accounts', 'org-test'])?.status).toBe('pending')
    expect(screen.queryByTestId('aws-connection-line')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Couldn't check/)
    expect(screen.queryByTestId('provider-pill-aws')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expectNoNavigation()
    expectNoConnectedContent()
    expectNoPreview()
    expect(aiSummaryService.getSummary).not.toHaveBeenCalled()
  })
})

describe('a failed accounts request is unknown, never "not connected"', () => {
  it.each([401, 500])('HTTP %s: one neutral line, no AWS pill, no redirect, no connected content', async (status) => {
    signInAs('owner')
    awsAccountsStatus = status
    setup(LEGACY_STATS.zero, { spend: noSpend('unavailable'), monthOverMonth: noMom('unavailable') })
    renderDashboard()

    const line = await screen.findByTestId('aws-connection-line', undefined, AFTER_RETRY)
    expect(line).toHaveAttribute('data-state', 'unknown')
    // The first attempt plus exactly one retry.
    expect(accountsRequests()).toBe(2)
    expect(line.textContent).toBe("Couldn't check your AWS connection. Refresh to try again.")
    expect(within(line).queryByRole('link')).not.toBeInTheDocument()
    await gateInputsSettled()
    expect(client.getQueryState(['aws-accounts', 'org-test'])?.status).toBe('error')
    expect(document.body.textContent).not.toMatch(OLD_COPY)
    expect(notConnectedMentions()).toBe(0)
    expect(screen.getAllByTestId('aws-connection-line')).toHaveLength(1)
    // No AWS pill either way; the other providers' pills are untouched.
    expect(screen.queryByTestId('provider-pill-aws')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Connect AWS' })).not.toBeInTheDocument()
    expect(screen.getByTestId('provider-pill-gcp')).toHaveTextContent('GCP soon')
    expect(screen.getByTestId('provider-pill-azure')).toHaveTextContent('Azure soon')
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expectNoNavigation()
    expectNoConnectedContent()
    expectNoPreview()
    expect(aiSummaryService.getSummary).not.toHaveBeenCalled()
  })

  it('a single failure followed by a success is not reported: the retry settles it as unconnected', async () => {
    signInAs('owner')
    awsAccounts = []
    awsAccountsStatus = 500
    setup(LEGACY_STATS.zero, { spend: noSpend('unavailable'), monthOverMonth: noMom('unavailable') })
    renderDashboard()

    await waitFor(() => expect(accountsRequests()).toBe(1))
    // While the retry is outstanding nothing is claimed either way.
    expect(screen.queryByTestId('aws-connection-line')).not.toBeInTheDocument()
    awsAccountsStatus = 200

    expect(screen.queryByTestId('dashboard-preview')).not.toBeInTheDocument()
    await screen.findByTestId('dashboard-preview', undefined, AFTER_RETRY)
    expect(accountsRequests()).toBe(2)
    expect(screen.queryByTestId('aws-connection-line')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Couldn't check/)
    expectNoNavigation()
  })

  it('with legacy stats that already show AWS data, the dashboard still renders as connected', async () => {
    awsAccountsStatus = 500
    setup(LEGACY_STATS.billing, { spend: actual(3), monthOverMonth: noMom('unavailable') })
    renderDashboard()

    await spendCardText('$3.00')
    await waitFor(() => expect(client.getQueryState(['aws-accounts', 'org-test'])?.status).toBe('error'), AFTER_RETRY)
    await gateInputsSettled()
    expect(screen.queryByTestId('aws-connection-line')).not.toBeInTheDocument()
    expect(screen.getByTestId('provider-pill-aws')).toHaveAttribute('data-state', 'connected')
    expectNoNavigation()
  })
})

describe('demo mode is unchanged', () => {
  it('with no AWS account it still shows the demo dashboard, never the preview or its feature cards', async () => {
    signInAs('owner')
    localStorage.setItem('devcontrol_demo_mode', 'true')
    awsAccounts = []
    setup(LEGACY_STATS.zero, { spend: noSpend('unavailable'), monthOverMonth: noMom('unavailable') })
    renderDashboard()

    expect(await screen.findByTestId('kpi-row')).toBeInTheDocument()
    expectNoPreview()
    expectNoNavigation()
  })
})

describe('a connected organization is unchanged', () => {
  it.each(['owner', 'member', 'viewer'])('%s: the connected dashboard, the AWS pill, no connection line, and the AI Summary requested', async (role) => {
    signInAs(role)
    setup(LEGACY_STATS.zero, { spend: actual(3), monthOverMonth: noMom('unavailable') })
    renderDashboard()

    await spendCardText('$3.00')
    await gateInputsSettled()
    expect(screen.getByTestId('kpi-row')).toBeInTheDocument()
    expect(screen.getByText('Security Posture')).toBeInTheDocument()
    expect(screen.getByTestId('provider-pill-aws')).toHaveAttribute('data-state', 'connected')
    expect(screen.queryByTestId('aws-connection-line')).not.toBeInTheDocument()
    expectNoPreview()
    expect(document.body.textContent).not.toMatch(/Connect your AWS account|to get started|Setup takes|AWS not connected/i)
    expectNoNavigation()
    await waitFor(() => expect(aiSummaryService.getSummary).toHaveBeenCalled())
  })
})

describe('the spend card reads the evidence', () => {
  it.each(EVIDENCE)('%s', async (name, summary, value) => {
    setup(LEGACY_STATS.billing, summary)
    renderDashboard()

    const text = await spendCardEvidenceText(value)
    expect(text).not.toMatch(/Syncing…|flat|stable|no change/i)
    // The legacy monthlyAwsCost (fixture $100) is never shown as the spend figure.
    expect(text).not.toContain('$100.00')
    if (name === 'failed request' || name === 'error') expect(text).toMatch(/Could not be retrieved/)
    if (name === 'unavailable') expect(text).toMatch(/Not available/)
    if (name.startsWith('actual') || name === 'net credit') expect(text).toMatch(/Actual · AWS Cost Explorer/)
  })
})

describe('AI Summary input', () => {
  it('the page sends the AI Summary request nothing -- no month-over-month value in any state', async () => {
    for (const [, summary, value] of EVIDENCE) {
      vi.mocked(aiSummaryService.getSummary).mockClear()
      setup(LEGACY_STATS.billing, summary)
      const { unmount } = renderDashboard()
      await spendCardText(value)
      await waitFor(() => expect(aiSummaryService.getSummary).toHaveBeenCalled())
      for (const call of vi.mocked(aiSummaryService.getSummary).mock.calls) expect(call).toEqual([])
      unmount()
      client.clear()
    }
  })
})

describe('cost trend states', () => {
  it('a failed trend request reads as a failure, not an empty chart', async () => {
    setup(LEGACY_STATS.billing, { spend: actual(3), monthOverMonth: noMom('unavailable') })
    trendResponse = { ok: false, data: [] }
    renderDashboard()

    expect(await screen.findByText('The cost trend could not be retrieved from AWS Cost Explorer.')).toBeInTheDocument()
  })

  it('a successful empty trend says there is no data for the range', async () => {
    setup(LEGACY_STATS.billing, { spend: actual(3), monthOverMonth: noMom('unavailable') })
    trendResponse = { ok: true, data: [] }
    renderDashboard()

    expect(await screen.findByText('No AWS Cost Explorer data is available for this range.')).toBeInTheDocument()
    expect(screen.queryByText('The cost trend could not be retrieved from AWS Cost Explorer.')).not.toBeInTheDocument()
  })
})
