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
import { HERO_FORBIDDEN, SAMPLE_PANEL_TITLE, expectApprovedSamplePanel, expectNoGeneratedContent, expectNoStylesheets, heroWords, withoutValidSamplePanel } from '@/components/dashboard/__tests__/sample-panel'

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
    // On the warning tint, the text is the -strong ink (typography plan T1).
    expect(screen.getByText(BILLING_SYNC_BANNER).style.color).toBe('var(--app-color-ink-warning-strong)')
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

/**
 * Hero copy an earlier version removed. "Setup takes" is allowed in exactly one
 * sentence, the trust line's "Setup takes a few minutes."
 */
const OLD_COPY = /Connect your AWS account|to get started|Setup takes(?! a few minutes\.)|2 minutes|Set up →|ask your organization owner to connect it/i
/** How many times the page says "not connected" in any casing: only ever the non-owner's pill. */
function notConnectedMentions(): number {
  return (document.body.textContent ?? '').match(/not connected/gi)?.length ?? 0
}

const HEADLINE = 'AI-Powered Cloud Operations & Infrastructure Intelligence'
const SUBHEADLINE = 'Operational visibility across cloud costs, security, observability, and infrastructure efficiency, so you can reduce waste, mitigate risk, and scale with confidence.'
const TRUST_LINE = 'Read-only access through a role you create and control. Delete it anytime and our access ends. Setup takes a few minutes.'
const ASK_OWNER = 'Ask your organization owner to connect AWS.'
const BAND_HEADLINE = 'See where your AWS money is going'
const BAND_LINE = 'Connect once. Your first scan runs automatically.'
/** The Cost optimization card's tag: the one place on this page allowed to use the word "savings". */
const SAVINGS_TAG = 'Savings'
/** The eight preview cards, exactly and in page order: tag, title, subtitle, check lines, and the plan label (if any). */
const PREVIEW_CARDS: Array<[string, string, string, string[], string | null]> = [
  ['Cost', 'Month-to-Date Spend', 'Your real AWS bill, straight from AWS.', ['See exactly what you have spent so far this month', 'Know right away if you are spending more or less than last month', 'Spot which service is driving your bill, day by day'], null],
  [SAVINGS_TAG, 'Cost optimization', 'Money you are paying for but not using.', ['Find idle servers and unattached storage you are still paying for', 'Switch old storage to cheaper, faster volumes', 'See the estimated monthly saving for each recommendation'], null],
  ['Security', 'Security Posture', 'Know where you are exposed before someone else does.', ['See your security risks ranked from most to least serious', 'Get one score out of 100, with the reasons behind it', 'Check your resources against security best practices'], null],
  ['Urgent', 'Top Risk', 'The one problem to address first.', ['Your most serious security finding, front and center', 'A direct link to the exact finding, so you can act on it'], null],
  ['Posture', 'Infrastructure Posture', 'One honest score for your connected account.', ['A single score that combines cost, security and alert coverage', 'See which area is pulling your score down', 'Clear notes wherever the data is only partial'], null],
  ['Uptime', 'Resource checks', 'Catch trouble before your customers do.', ['See which servers are failing their AWS status checks', 'Know when a resource crosses a CloudWatch alarm threshold'], null],
  ['Ask', 'AI assistant', 'Ask questions about your spend and security.', ['Ask in plain English, no dashboards to learn', 'Answers come from your own account data', 'It tells you plainly when the data is not available'], 'Pro'],
  ['Weekly', 'Weekly summary', 'Your AWS week in one email.', ['Spend compared with the previous week', 'New security findings and deployments at a glance', 'Sent to your workspace owner every week'], null],
]
const STEPS = [
  'Create a read-only IAM role in your AWS account using the policy we provide.',
  'Paste the role ARN into DevControl. We verify access before saving.',
  'Your first scan runs automatically. Cost data can take a day or two to arrive from AWS.',
]
/** Anything that would read as a figure, amount, share or placeholder. */
const FABRICATED_VALUE = /\d|\$|%|—|\bN\/A\b/
/** The one place the approved wording names a number: the scale of the score, not a score. */
const SCORE_SCALE = 'Get one score out of 100, with the reasons behind it'
/** Words this state must not use: it promises nothing the product does not measure or do. */
const FORBIDDEN = /health|operational signals|recommendations|prioriti[sz]ed|\bfix|savings|sample|example/i
/**
 * The page with the Savings tag removed: nowhere else may say "savings". At most one such tag exists.
 * The hero's sample panel is removed too, but only while it is labelled as sample data (see
 * components/dashboard/__tests__/sample-panel.ts); an unlabelled panel stays in and trips every guard.
 */
function pageOutsideSavingsTag(): HTMLElement {
  const body = withoutValidSamplePanel(document.body)
  const tags = [...body.querySelectorAll('[data-testid="preview-tag"]')].filter((tag) => tag.textContent === SAVINGS_TAG)
  expect(tags.length).toBeLessThanOrEqual(1)
  tags.forEach((tag) => tag.remove())
  return body
}
function textOutsideSavingsTag(): string {
  return pageOutsideSavingsTag().textContent ?? ''
}
/**
 * The same text with a space between elements, as a reader sees it. textContent
 * runs adjacent elements together ("...each recommendation" + "Security"), which
 * would both invent words and hide word boundaries from the word guards.
 */
function wordsOutsideSavingsTag(): string {
  const root = pageOutsideSavingsTag()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  while (walker.nextNode()) parts.push(walker.currentNode.textContent ?? '')
  return parts.join(' ').replace(/\s+/g, ' ')
}

/** The preview (header, eight cards, band) and the "How connecting works" strip, word for word, in either role. */
function expectPreviewAndSteps() {
  const preview = screen.getByTestId('dashboard-preview')
  // The preview is the page's hero in this state: the one h1, and no workspace label above it.
  expect(within(preview).queryByTestId('preview-workspace')).not.toBeInTheDocument()
  expect(preview.textContent).not.toContain('Org Test')
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(within(preview).getByRole('heading', { level: 1, name: HEADLINE })).toBeInTheDocument()
  expect(within(preview).getByText(SUBHEADLINE)).toBeInTheDocument()
  expect(within(preview).getByTestId('preview-trust').textContent).toBe(TRUST_LINE)
  expect(screen.queryByTestId('provider-pills')).not.toBeInTheDocument()
  expect(withoutValidSamplePanel(document.body).textContent).not.toMatch(/What you'll see|What your team will see/)

  // The hero: the copy, then the sample panel (shown to every role), exactly as approved.
  const hero = within(preview).getByTestId('preview-hero')
  expect([...hero.children].map((child) => child.getAttribute('data-testid'))).toEqual(['preview-hero-copy', 'sample-panel'])
  expect(hero.nextElementSibling).toBe(within(preview).getByTestId('preview-cards'))
  expectApprovedSamplePanel(document.body)
  expect(heroWords(hero)).not.toMatch(HERO_FORBIDDEN)
  // No ::before / ::after or CSS content anywhere in the preview: no text the word guards cannot see.
  expectNoGeneratedContent(preview)
  // And no stylesheet anywhere in the preview or the steps: nothing that could hide the panel's label.
  expectNoStylesheets(preview)
  expectNoStylesheets(screen.getByTestId('connecting-steps'))

  // GCP and Azure are plain text: not links, not buttons, not focusable.
  for (const [id, text] of [['preview-pill-gcp', 'GCP soon'], ['preview-pill-azure', 'Azure soon']]) {
    const pill = within(preview).getByTestId(id)
    expect(pill.textContent).toBe(text)
    expect(pill.tagName).toBe('SPAN')
    expect(pill.closest('a, button, [role="button"], [role="link"]')).toBeNull()
    expect(pill).not.toHaveAttribute('tabindex')
    expect(pill.className).not.toMatch(/hover:|cursor-pointer|focus/)
  }

  // Eight cards in one grid: one column, then two. Never three.
  const grid = within(preview).getByTestId('preview-cards')
  const cards = within(preview).getAllByTestId('preview-card')
  expect([...grid.children]).toEqual(cards)
  expect(grid.className).toMatch(/\bgrid-cols-1\b.*\bmd:grid-cols-2\b/)
  expect(grid.className).not.toMatch(/grid-cols-3/)
  expect(cards.map((card) => [
    within(card).getByTestId('preview-tag').textContent,
    within(card).getByTestId('preview-title').textContent,
    within(card).getByTestId('preview-subtitle').textContent,
    within(card).queryAllByTestId('preview-shows').map((line) => line.textContent),
    within(card).queryByTestId('preview-plan-label')?.textContent ?? null,
  ])).toEqual(PREVIEW_CARDS)
  for (const card of cards) {
    // Not a link, not a button, nothing focusable, and no bar or chart.
    expect(card.closest('a, button, [role="button"], [role="link"]')).toBeNull()
    expect(card.querySelector('a, button, [role="button"], [role="link"], [tabindex], [role="progressbar"], svg:not(.lucide)')).toBeNull()
    expect(card.className).not.toMatch(/hover:|cursor-pointer|focus|opacity/)
    expect(within(card).getByRole('heading', { level: 2 })).toBe(within(card).getByTestId('preview-title'))
    // Nothing sets a fixed or minimum width that could force horizontal scrolling on a phone.
    for (const node of [card, ...card.querySelectorAll('*')]) {
      expect(node.getAttribute('class') ?? '').not.toMatch(/(^|\s)(min-w-\[|w-\[|whitespace-nowrap|overflow-x)/)
    }
  }

  // "Pro" appears once in the whole preview: the badge on the AI assistant card.
  const labels = within(preview).getAllByTestId('preview-plan-label')
  expect(labels.map((label) => label.textContent)).toEqual(['Pro'])
  expect(labels[0].closest('[data-testid="preview-card"]')).toBe(cards[6])
  // No plan is named anywhere else in the preview: not in a tag, a title, a subtitle or a checklist line.
  for (const node of preview.querySelectorAll('[data-testid="preview-tag"], [data-testid="preview-title"], [data-testid="preview-subtitle"], [data-testid="preview-shows"], h1, h2, p')) {
    expect(node.textContent).not.toMatch(/\b(Free|Starter|Pro|Enterprise)\b/)
  }

  const band = within(preview).getByTestId('preview-band')
  expect(within(band).getByRole('heading', { level: 2, name: BAND_HEADLINE })).toBeInTheDocument()
  expect(within(band).getByText(BAND_LINE)).toBeInTheDocument()

  const steps = screen.getByTestId('connecting-steps')
  expect(within(steps).getByRole('heading', { level: 2, name: 'How connecting works' })).toBeInTheDocument()
  const items = within(steps).getAllByTestId('connecting-step')
  expect(items.map((item) => item.textContent)).toEqual(STEPS.map((step, i) => `${i + 1}${step}`))
  expect(items[0].parentElement?.className).toMatch(/\bgrid-cols-1\b.*\bmd:grid-cols-3\b/)
  expect(steps.querySelector('a, button, [role="button"], [role="link"], [tabindex], [role="progressbar"], svg:not(.lucide)')).toBeNull()

  // Heading order: the h1, then the sample panel, every card, the band and the strip as h2 -- no level skipped.
  expect(screen.getAllByRole('heading').map((h) => [h.tagName, h.textContent])).toEqual([
    ['H1', HEADLINE],
    ['H2', SAMPLE_PANEL_TITLE],
    ...PREVIEW_CARDS.map(([, title]) => ['H2', title]),
    ['H2', BAND_HEADLINE],
    ['H2', 'How connecting works'],
  ])

  // No figure anywhere outside the labelled sample panel: only the step numbers and the named score scale contain a digit.
  expect((withoutValidSamplePanel(preview).textContent ?? '').replace(SCORE_SCALE, '')).not.toMatch(FABRICATED_VALUE)
  const stepsClone = steps.cloneNode(true) as HTMLElement
  stepsClone.querySelectorAll('[data-testid="connecting-step-number"]').forEach((n) => n.remove())
  expect(stepsClone.textContent).not.toMatch(FABRICATED_VALUE)
  expect([...steps.querySelectorAll('[data-testid="connecting-step-number"]')].map((n) => n.textContent)).toEqual(['1', '2', '3'])

  // Decorative icons are hidden from assistive technology.
  for (const icon of [...preview.querySelectorAll('svg'), ...steps.querySelectorAll('svg')]) expect(icon).toHaveAttribute('aria-hidden', 'true')
}
/** The whole unconnected page: nothing forbidden, nothing left over from the earlier versions. */
function expectUnconnectedPageWording() {
  expect(textOutsideSavingsTag()).not.toMatch(OLD_COPY)
  expect(wordsOutsideSavingsTag()).not.toMatch(FORBIDDEN)
  // And block by block, unspaced: a forbidden word split across text nodes inside one element is still caught.
  const BLOCKS = 'section, div, ul, ol, li, p, h1, h2, h3, h4, h5, h6'
  for (const block of pageOutsideSavingsTag().querySelectorAll(BLOCKS)) {
    if (!block.querySelector(BLOCKS)) expect(block.textContent).not.toMatch(FORBIDDEN)
  }
  expect((document.body.textContent ?? '').match(/Setup takes/gi)).toHaveLength(1)
  expect(screen.queryByTestId('aws-connection-line')).not.toBeInTheDocument()
}
function expectNoPreview() {
  for (const id of ['dashboard-preview', 'sample-panel', 'preview-card', 'preview-cards', 'preview-band', 'preview-plan-label', 'preview-connect', 'preview-band-connect', 'connecting-steps']) {
    expect(screen.queryByTestId(id)).not.toBeInTheDocument()
  }
  for (const [, , subtitle, shows] of PREVIEW_CARDS) {
    for (const text of [subtitle, ...shows]) expect(document.body.textContent).not.toContain(text)
  }
  expect(document.body.textContent).not.toContain(BAND_HEADLINE)
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
  expect(textOutsideSavingsTag()).not.toMatch(/\$\d|\/100|savings/i)
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

  it('owner: the preview as the hero, with two Connect AWS buttons to /connect-aws, the strip, and nothing else', async () => {
    signInAs('owner')
    renderDashboard()

    const preview = await screen.findByTestId('dashboard-preview')
    const action = within(preview).getByTestId('preview-action')
    expect(action.textContent).toBe('Connect AWS' + 'GCP soon' + 'Azure soon')
    // Two ways to /connect-aws, both in the preview, both named "Connect AWS", and nothing else interactive.
    const buttons = within(preview).getAllByRole('link', { name: 'Connect AWS' })
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual(['preview-connect', 'preview-band-connect'])
    expect(buttons[0].parentElement).toBe(action)
    expect(buttons[1].closest('[data-testid="preview-band"]')).not.toBeNull()
    for (const button of buttons) {
      expect(button).toHaveAttribute('href', '/connect-aws')
      expect(button.textContent).toBe('Connect AWS')
      expect(button.className).toContain('min-h-[44px]')
      expect(button.className).toContain('focus-visible:ring-2')
    }
    expect([...document.querySelectorAll('a[href="/connect-aws"]')]).toEqual(buttons)
    expect([...preview.querySelectorAll('a, button, [role="button"]')]).toEqual(buttons)
    // The primary button is the only accent-filled control, and keeps the brand purple in dark mode.
    expect([...document.querySelectorAll('[class*="bg-[var(--text-accent)]"]')]).toEqual([buttons[0]])
    expect(buttons[0].className).toContain('dark:bg-[#7C3AED]')
    expect(notConnectedMentions()).toBe(0)
    expect(document.body.textContent).not.toContain(ASK_OWNER)
    await gateInputsSettled()
    expectPreviewAndSteps()
    expectUnconnectedPageWording()
    expectNoNavigation()
    expectNoConnectedContent()
  })

  it.each([
    ['member', 'member'],
    ['viewer', 'viewer'],
    ['admin', 'admin'],
    ['no role available', null],
    ['an unrecognised role', 'superuser'],
  ])('%s: told to ask the owner, with no button or link anywhere', async (_name, role) => {
    signInAs(role)
    renderDashboard()

    const preview = await screen.findByTestId('dashboard-preview')
    expect(preview.querySelector('a, button, [role="button"]')).toBeNull()
    // The button row states the fact as plain text; the owner is named under it and in the band.
    const pill = within(preview).getByTestId('preview-pill-aws')
    expect(pill.tagName).toBe('SPAN')
    expect(pill.textContent).toBe('AWS not connected')
    expect(pill.closest('a, button')).toBeNull()
    expect(within(preview).getByTestId('preview-action').textContent).toBe('AWS not connected' + 'GCP soon' + 'Azure soon')
    expect(within(preview).getByTestId('preview-ask-owner').textContent).toBe(ASK_OWNER)
    expect(within(within(preview).getByTestId('preview-band')).getByTestId('preview-band-ask-owner').textContent).toBe(ASK_OWNER)
    await gateInputsSettled()
    expectPreviewAndSteps()
    expectUnconnectedPageWording()
    expectNoNavigation()
    expectNoConnectedContent()
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

describe('demo mode is off', () => {
  it('with both legacy demo flags set and no AWS account, the owner gets the real preview, never a demo dashboard', async () => {
    signInAs('owner')
    localStorage.setItem('devcontrol_demo_mode', 'true')
    localStorage.setItem('sales-demo-mode', JSON.stringify({ state: { enabled: true }, version: 0 }))
    awsAccounts = []
    setup(LEGACY_STATS.zero, { spend: noSpend('unavailable'), monthOverMonth: noMom('unavailable') })
    renderDashboard()

    expect(await screen.findByTestId('dashboard-preview')).toBeInTheDocument()
    await gateInputsSettled()
    expectPreviewAndSteps()
    expectNoConnectedContent()
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
