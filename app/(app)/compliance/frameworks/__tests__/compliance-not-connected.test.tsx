/**
 * PR4c empty states, /compliance/frameworks (Compliance). With no AWS account connected, on every plan:
 *   - the card below the header (and below the score tiles, where the plan has them);
 *   - a saved custom framework stays listed, without Re-evaluate now, which needs AWS data (founder ruling);
 *     the same for the out-of-date banner and the evaluation history rows, and Try again in the failed-run
 *     banner and a failed run's history row, whose text stays;
 *   - hidden: Add Framework, the custom-frameworks plan notice, the three Optimization Engine locks in the
 *     CIS / NIST / PCI cards, the three "Not yet available" buttons, the NOT CHECKED YET pill, Sync Security Hub;
 *   - kept: the four framework cards (name and description), SOC 2 "0 of 6 criteria evaluated" and View
 *     Readiness, the Security Hub explanation and Learn more, the footer line.
 * Connected (or when the check fails) the page is today's. Until the check answers, the plan-loading skeleton.
 *
 * The real page, usePlan, useSecurityHub and services, with the shared api client answering as the backend
 * does for a new org: GET /api/aws/accounts (aws.routes.ts); /api/compliance-frameworks and its scans list
 * (requireEntitlement complianceFrameworks: 402 TIER_REQUIRED below Revenue Protection, else no rows);
 * /api/security-hub/capability and /frameworks/:fw (Optimization Engine and above; no stored state: NEVER_RUN).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ComplianceFrameworksPage from '../page'

;(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }

const m = vi.hoisted(() => ({ tier: 'free' as string, connection: 'not_connected' as string, gets: [] as string[], frameworks: [] as unknown[], scans: [] as unknown[] }))

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  const wire = await import('@/components/aws/__tests__/accounts-wire')
  const ORDER: Record<string, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 }
  const gate = (min: string, then: () => unknown) => (ORDER[m.tier] >= ORDER[min] ? Promise.resolve(then()) : Promise.reject(wire.tierRequiredError(min, m.tier)))
  const neverRun = (framework: string) => ({
    framework, frameworkVersion: 'v', syncStatus: 'NEVER_RUN', capabilityStatus: null, standardEnabled: null, evaluatedAt: null,
    coverage: { totalControls: 0, evaluated: 0, passed: 0, failed: 0, unknown: 0, notEvaluated: 0, notApplicable: 0, notEstablishable: 0, errors: 0 },
    controls: [],
  })
  const get = (url: string) => {
    m.gets.push(url)
    if (url === '/api/aws/accounts') return wire.accountsResponse(m.connection as never)
    if (url === '/api/compliance-frameworks') return gate('enterprise', () => ({ data: { success: true, data: m.frameworks } }))
    if (url.startsWith('/api/compliance-frameworks/scans/list')) return gate('enterprise', () => ({ data: { success: true, data: m.scans } }))
    if (url === '/api/security-hub/capability') return gate('pro', () => ({ data: { success: true, capabilityStatus: null, syncStatus: 'NEVER_RUN', checkedAt: null, error: null, enabledStandards: [] } }))
    const fw = url.match(/^\/api\/security-hub\/frameworks\/(cis|pci|nist)$/)
    if (fw) return gate('pro', () => ({ data: { success: true, result: neverRun(fw[1]) } }))
    return Promise.reject(new Error('unexpected GET ' + url))
  }
  const api = { ...actual.api, get, post: vi.fn(), put: vi.fn(), delete: vi.fn() }
  return { ...actual, default: api, api }
})
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-1', subscriptionTier: m.tier, effectiveTier: m.tier }, organizationStatus: 'ready' }),
}))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
// soc2.routes.ts GET /readiness for a new org: the six criteria, none evaluated.
vi.mock('@/lib/hooks/useSoc2Readiness', () => ({
  useSoc2Readiness: () => ({
    data: ['CC6.1', 'CC6.6', 'CC6.2', 'CC6.3', 'CC9.1', 'CC7.1'].map((criterionId) => ({ criterionId, evaluated: false, evidenceSummary: null, computedAt: null })),
    isLoading: false, error: null, refetch: vi.fn(),
  }),
}))

beforeEach(() => {
  m.tier = 'free'
  m.connection = 'not_connected'
  m.gets.length = 0
  m.frameworks = []
  m.scans = []
})

// A custom framework the user saved (compliance_frameworks row, compliance-frameworks.routes.ts GET /).
const DAY = 24 * 60 * 60 * 1000
/** A completed evaluation of the saved framework 8 days ago (compliance_scans row): past FRAMEWORK_STALE_AFTER_MS (7 days), so out of date. */
const outOfDateScan = () => {
  const at = new Date(Date.now() - 8 * DAY).toISOString()
  return {
    id: 'scan-1', organization_id: 'org-1', framework_id: 'fw-1', scan_type: 'manual', status: 'completed', total_resources: 10, compliant_resources: 9,
    non_compliant_resources: 1, compliance_score: 90, critical_issues: 0, high_issues: 1, medium_issues: 0, low_issues: 0,
    started_at: at, completed_at: at, duration_seconds: 4, created_at: at,
  }
}
/** The saved framework's newest evaluation failed yesterday (compliance_scans row, status failed). */
const failedScan = () => {
  const at = new Date(Date.now() - DAY).toISOString()
  return { ...outOfDateScan(), id: 'scan-2', status: 'failed', compliance_score: null, started_at: at, completed_at: at, created_at: at }
}
const failedBanner = () => screen.findByTestId('compliance-failed-banner')
const staleBanner = () => screen.findByTestId('compliance-stale-banner')
const historyRow = () => screen.findByTestId('evaluation-history-row')

const SAVED_FRAMEWORK = {
  id: 'fw-1', organization_id: 'org-1', name: 'Internal baseline', description: 'Our own S3 and IAM checks.', framework_type: 'custom',
  enabled: true, is_default: false, standard_name: null, version: null, created_at: '2026-11-21T09:00:00.000Z', updated_at: '2026-11-21T09:00:00.000Z',
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><ComplianceFrameworksPage /></QueryClientProvider>)
}

const PLAN_NOTICE = 'Custom compliance frameworks are on the Revenue Protection plan.'
const FOOTER = 'DevControl uses read-only access by default. Remediation actions need separate permission and your approval.'
const SH_EXPLANATION = 'CIS, PCI DSS v4.0.1 and NIST SP 800-53 Rev. 5 can be evaluated through AWS Security Hub once it is connected and synchronized.'
const STANDARDS: Array<[string, string, string]> = [
  ['cis', 'CIS AWS Foundations', 'AWS security configuration guidelines.'],
  ['soc2', 'SOC 2 Readiness', 'Technical and customer-provided supporting evidence for SOC 2 criteria — not a certification or Type II audit.'],
  ['nist', 'NIST 800-53 Rev. 5', 'Federal security and privacy controls. Partial coverage, through Security Hub.'],
  ['pci', 'PCI DSS v4.0.1', 'Card-data security standard. Readiness only, from partial evidence.'],
]

function expectHiddenAndKept() {
  // Hidden.
  expect(screen.queryByRole('button', { name: /Add Framework/ })).toBeNull()
  expect(screen.queryByText(PLAN_NOTICE)).toBeNull()
  expect(screen.queryByTestId('compliance-plan')).toBeNull()
  for (const key of ['cis', 'nist', 'pci']) expect(screen.queryByTestId(`standard-${key}-plan-required`)).toBeNull()
  expect(screen.queryByText(/Not yet available/)).toBeNull()
  expect(screen.queryByTestId('security-hub-pill')).toBeNull()
  expect(screen.queryByText('Not checked yet')).toBeNull()
  expect(screen.queryByRole('button', { name: /Sync Security Hub/ })).toBeNull()
  expect(screen.queryByText(/Security Hub is not currently connected to DevControl/)).toBeNull()
  // Kept.
  for (const [key, name, desc] of STANDARDS) {
    const card = screen.getByTestId(`standard-${key}`)
    expect(within(card).getByText(name)).toBeInTheDocument()
    expect(within(card).getByText(desc)).toBeInTheDocument()
  }
  const soc2 = screen.getByTestId('standard-soc2')
  expect(within(soc2).getByText('0 of 6 criteria evaluated')).toBeInTheDocument()
  expect(within(soc2).getByRole('button', { name: 'View Readiness →' })).toBeInTheDocument()
  expect(within(screen.getByTestId('security-hub-card')).getByText(SH_EXPLANATION)).toBeInTheDocument()
  expect(screen.getByTestId('security-hub-body')).toHaveTextContent('AWS Security Hub continuously evaluates supported security standards')
  expect(within(screen.getByTestId('security-hub-card')).getByRole('link', { name: /Learn more/ })).toHaveAttribute('href', '/docs')
  expect(screen.getByText(FOOTER)).toBeInTheDocument()
}

describe('PR4c: /compliance/frameworks with no AWS account connected', () => {
  it('free: the card directly below the header; locks, actions and Security Hub status hidden; the rest kept', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(card.previousElementSibling).toBe(screen.getByRole('heading', { level: 1, name: 'Compliance' }).parentElement!.parentElement)
    expect(screen.getByText('Track your compliance posture across industry standards and frameworks.')).toBeInTheDocument()
    await waitFor(() => expect(m.gets).toContain('/api/compliance-frameworks'))
    expectHiddenAndKept()
  })

  it('Revenue Protection: the score tiles stay ("—", frameworks a real 0), the card below them; the same hidden and kept', async () => {
    m.tier = 'enterprise'
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    await waitFor(() => expect(screen.getAllByTestId('compliance-tile')).toHaveLength(4))
    const tiles = screen.getAllByTestId('compliance-tile')
    expect(card.previousElementSibling).toBe(tiles[0].parentElement)
    expect(tiles[3]).toHaveTextContent('Frameworks0')
    await waitFor(() => expect(m.gets).toContain('/api/security-hub/capability'))
    expectHiddenAndKept()
  })

  it('Revenue Protection, a saved custom framework: listed with View / Manage Rules, without Re-evaluate now', async () => {
    m.tier = 'enterprise'
    m.frameworks = [SAVED_FRAMEWORK]
    renderPage()
    const row = await screen.findByTestId('compliance-custom-framework')
    expect(within(row).getByText('Internal baseline')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /View \/ Manage Rules/ })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Re-evaluate now/ })).toBeNull()
    expect(screen.getByTestId('not-connected-card')).toBeInTheDocument()
  })

  it('Revenue Protection, an out-of-date evaluation: the banner and history text stay, without Re-evaluate now', async () => {
    m.tier = 'enterprise'
    m.frameworks = [SAVED_FRAMEWORK]
    m.scans = [outOfDateScan()]
    renderPage()
    const banner = await staleBanner()
    expect(banner).toHaveTextContent(/^Results are out of date — Internal baseline was last evaluated /)
    expect(within(banner).queryByRole('button', { name: /Re-evaluate now/ })).toBeNull()
    const row = await historyRow()
    expect(row.textContent).toMatch(/Internal baseline/)
    expect(within(row).queryByRole('button', { name: /Re-evaluate now/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Re-evaluate now/ })).toBeNull()
    expect(screen.getByTestId('not-connected-card')).toBeInTheDocument()
  })

  it('Revenue Protection, a failed evaluation: the failed banner and history text stay, without Try again', async () => {
    m.tier = 'enterprise'
    m.frameworks = [SAVED_FRAMEWORK]
    m.scans = [failedScan()]
    renderPage()
    const banner = await failedBanner()
    expect(banner).toHaveTextContent(/^The last evaluation of Internal baseline failed/)
    expect(within(banner).queryByRole('button', { name: /Try again/ })).toBeNull()
    const row = await historyRow()
    expect(row).toHaveAttribute('data-status', 'failed')
    expect(row.textContent).toMatch(/Internal baseline/)
    expect(within(row).queryByRole('button', { name: /Try again/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Try again|Re-evaluate now/ })).toBeNull()
    expect(screen.getByTestId('not-connected-card')).toBeInTheDocument()
  })

  it('connection loading: the skeleton only', async () => {
    m.connection = 'PENDING'
    renderPage()
    await waitFor(() => expect(m.gets).toContain('/api/aws/accounts'))
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByText(PLAN_NOTICE)).toBeNull()
  })
})

describe('PR4c: /compliance/frameworks connected is unchanged', () => {
  it.each(['connected', 'FAIL'])('free, %s: Add Framework, the plan notice and locks, Not yet available, the pill and Sync; no card', async (connection) => {
    m.connection = connection
    renderPage()
    expect(await screen.findByText(PLAN_NOTICE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add Framework/ })).toBeInTheDocument()
    for (const key of ['cis', 'nist', 'pci']) expect(screen.getByTestId(`standard-${key}-plan-required`)).toBeInTheDocument()
    expect(screen.getAllByText(/Not yet available/)).toHaveLength(3)
    expect(screen.getByTestId('security-hub-pill')).toHaveTextContent('Not checked yet')
    expect(screen.getByRole('button', { name: /Sync Security Hub/ })).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it('Revenue Protection, connected: the Security Hub status lines, no card', async () => {
    m.tier = 'enterprise'
    m.connection = 'connected'
    renderPage()
    await waitFor(() => expect(screen.getAllByText('Security Hub is not currently connected to DevControl')).toHaveLength(3))
    expect(screen.getByRole('button', { name: /Add Framework/ })).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it('Revenue Protection, connected, an out-of-date evaluation: Re-evaluate now in the banner and the history row', async () => {
    m.tier = 'enterprise'
    m.connection = 'connected'
    m.frameworks = [SAVED_FRAMEWORK]
    m.scans = [outOfDateScan()]
    renderPage()
    const banner = await staleBanner()
    expect(banner).toHaveTextContent(/^Results are out of date — Internal baseline was last evaluated /)
    expect(within(banner).getByRole('button', { name: /Re-evaluate now/ })).toBeInTheDocument()
    expect(within(await historyRow()).getByRole('button', { name: /Re-evaluate now/ })).toBeInTheDocument()
  })

  it('Revenue Protection, connected, a failed evaluation: Try again in the failed banner and the history row', async () => {
    m.tier = 'enterprise'
    m.connection = 'connected'
    m.frameworks = [SAVED_FRAMEWORK]
    m.scans = [failedScan()]
    renderPage()
    const banner = await failedBanner()
    expect(banner).toHaveTextContent(/^The last evaluation of Internal baseline failed/)
    expect(within(banner).getByRole('button', { name: /Try again/ })).toBeInTheDocument()
    expect(within(await historyRow()).getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('Revenue Protection, connected, a saved custom framework: Re-evaluate now stays', async () => {
    m.tier = 'enterprise'
    m.connection = 'connected'
    m.frameworks = [SAVED_FRAMEWORK]
    renderPage()
    const row = await screen.findByTestId('compliance-custom-framework')
    expect(within(row).getByRole('button', { name: /Re-evaluate now/ })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /View \/ Manage Rules/ })).toBeInTheDocument()
  })
})
