/**
 * The Connect AWS page, AWS connect PR D1b: connection health, saved permission checks and policy
 * results after a reload, refused scan sources, the role-replaced notice, Check again, the title by
 * view and S1. The real aws-accounts service runs against a mocked HTTP layer, so the 409
 * NOT_CONNECTED and old-server (404) handling is exercised as the page sees it.
 *
 * Every expected string is written out here (§6 of connect-d1-step1.md), not imported from the copy
 * module, so a changed string fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConnectAwsPage from '../page'
import { formatScanTime } from '../../services/coverage'
import { formatAvailableTime } from '../ConnectionChecksParts'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { expectNoRemovedText } from './removedText'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/gtag', () => ({ trackLeadQualified: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))

const mockGet = vi.fn()
const mockPost = vi.fn()
vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  handleApiResponse: <T,>(response: { data: { success: boolean; data: T; message?: string } }): T => {
    if (!response.data.success) throw new Error(response.data.message || 'API request failed')
    return response.data.data
  },
}))

const mockGetCoverage = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: { getCoverage: (...args: unknown[]) => mockGetCoverage(...args) },
}))

// ---------------------------------------------------------------------------
// Fixtures (placeholders only)
// ---------------------------------------------------------------------------

const MIN = 60_000
const HOUR = 60 * MIN
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const at = (iso: string) => formatScanTime(iso, Date.now())

const ACCOUNT = { id: 1, org_id: 'org-1', account_id: '123456789012', role_arn: 'arn:aws:iam::123456789012:role/DevControlRole', nickname: null, external_id: 'ext-123', region: 'us-east-1', connected_at: ago(48 * HOUR), status: 'active' }
/** The row as GET /accounts sends it to a non-owner: no external_id. */
const MEMBER_ACCOUNT: Record<string, unknown> = { ...ACCOUNT }
delete MEMBER_ACCOUNT.external_id
const ACTIONS = ['ec2:DescribeRegions', 's3:ListAllMyBuckets', 'lambda:ListFunctions', 'cloudwatch:GetMetricData', 'ce:GetCostAndUsage', 'resource-explorer-2:Search']
const ALL_VERIFIED = ACTIONS.map((action) => ({ action, status: 'verified' }))
const CE_DENIED = ALL_VERIFIED.map((c) => (c.action === 'ce:GetCostAndUsage' ? { ...c, status: 'denied' } : c))

const COVERAGE: ServicesCoverage = {
  account: { connected: true, status: 'active', home_region: 'us-east-1' },
  scope: {
    home_region: { region: 'us-east-1', count: 7 },
    s3: { in_last_scan: true, regions: [{ region: 'us-east-1', count: 2 }] },
    cloudfront: { in_last_scan: true, count: 1 },
    enabled_regions: { known: false, count: null },
  },
  last_successful_scan_at: ago(5 * MIN),
  last_scan: { status: 'completed', started_at: ago(6 * MIN), completed_at: ago(5 * MIN), warnings: [] },
  resource_types: null,
  tags_unknown_by_type: {},
  regions: [],
  total: 10,
}

const POLICY_OK = { unreadable: false, securityAudit: 'attached', viewOnlyAccess: 'attached', readExtras: 'matches', readOnlyAccess: false, otherAwsManaged: [] as string[], otherCount: 0, contractVersion: 1, checkedAt: ago(3 * HOUR), trigger: 'connect' }

type Checks = Record<string, unknown>
function checks(over: Checks = {}): Checks {
  return {
    health: { state: 'ok', lastResult: 'ok', checkedAt: ago(2 * HOUR), failingSince: null, lostAt: null },
    roleReplacedAt: null,
    permissionCheck: { checks: ALL_VERIFIED, checkedAt: ago(3 * HOUR), trigger: 'connect' },
    policyCheck: POLICY_OK,
    refusedSources: { scannedAt: ago(HOUR), sources: [] },
    ...over,
  }
}
const OWNER = { checkAgain: { availableAt: null } }

/** An axios-shaped refusal. */
const httpError = (status: number, data: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { success: false, ...data }, headers } })

let accountsBody: Record<string, unknown>
let checksAnswer: () => Promise<unknown>

function serveChecks(body: Checks) {
  checksAnswer = () => Promise.resolve({ data: { success: true, data: body } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCoverage.mockResolvedValue(COVERAGE)
  accountsBody = { success: true, data: [ACCOUNT], connection: { state: 'connected', health: { state: 'ok', since: ago(2 * HOUR) } } }
  serveChecks({ ...checks(), ...OWNER })
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/aws/accounts') return Promise.resolve({ data: accountsBody })
    if (url === '/api/aws/accounts/checks') return checksAnswer()
    if (url === '/api/aws/accounts/connect-init') {
      return Promise.resolve({ data: { success: true, data: { externalId: 'ext-123', platformAccountId: '999999999999', trustPolicy: { Version: '2012-10-17', Statement: [] } } } })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
})

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderPage(client: QueryClient = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ConnectAwsPage />
    </QueryClientProvider>
  )
}

async function healthFact() {
  return screen.findByTestId('fact-health')
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

const F7 = "DevControl couldn't assume your role during its scans. If the role, its trust policy or its External ID changed in AWS, fix it there, then use Check again. DevControl keeps this connection until you ask us to remove it."
const F8 = "DevControl hasn't been able to finish a check for a while. This isn't necessarily a problem with your role."

describe('Health: the five states, exact strings', () => {
  const checkedAt = ago(2 * HOUR)
  const staleAt = ago(30 * HOUR)
  const failingSince = ago(26 * HOUR)

  it.each([
    ['ok', { state: 'ok', lastResult: 'ok', checkedAt, failingSince: null }, (): string => `OK · checked ${at(checkedAt)}`, null],
    ['failing', { state: 'failing', lastResult: 'failing', checkedAt, failingSince }, (): string => `Failing since ${at(failingSince)}`, F7],
    ['lost', { state: 'lost', lastResult: 'lost', checkedAt, failingSince }, (): string => `Lost · failing since ${at(failingSince)}`, F7],
    ['stale after ok', { state: 'not_checked_recently', lastResult: 'ok', checkedAt: staleAt, failingSince: null }, (): string => `Not checked recently · last result OK on ${at(staleAt)}`, F8],
    ['stale after failing', { state: 'not_checked_recently', lastResult: 'failing', checkedAt: staleAt, failingSince }, (): string => `Not checked recently · last result Failing on ${at(staleAt)}`, F8],
    ['stale after lost', { state: 'not_checked_recently', lastResult: 'lost', checkedAt: staleAt, failingSince }, (): string => `Not checked recently · last result Lost on ${at(staleAt)}`, F8],
    ['not checked yet', { state: 'not_checked_yet', lastResult: null, checkedAt: null, failingSince: null }, (): string => 'Not checked yet. DevControl checks at each scan.', null],
  ] as const)('%s', async (_name, health, value, help) => {
    serveChecks({ ...checks({ health: { ...health, lostAt: null } }), ...OWNER })
    renderPage()
    const fact = await healthFact()
    expect(within(fact).getByText('Health')).toBeInTheDocument()
    expect(within(fact).getByTestId('health-value').textContent).toBe(value())
    if (help) expect(within(fact).getByTestId('health-help').textContent).toBe(help)
    else expect(within(fact).queryByTestId('health-help')).toBeNull()
    // F7 only under failing or lost.
    expect(document.body.textContent?.includes(F7)).toBe(health.state === 'failing' || health.state === 'lost')
    expectNoRemovedText()
  })

  it.each(['ok', 'failing', 'lost'] as const)('stale never shows "OK" as current (stored %s, last check 30 h ago)', async (lastResult) => {
    serveChecks({ ...checks({ health: { state: 'not_checked_recently', lastResult, checkedAt: staleAt, failingSince: lastResult === 'ok' ? null : failingSince, lostAt: null } }), ...OWNER })
    renderPage()
    const value = (await healthFact()).querySelector('[data-testid="health-value"]')!.textContent!
    expect(value.startsWith('Not checked recently')).toBe(true)
    expect(value).not.toMatch(/^OK/)
    expect(document.body.textContent).not.toContain('OK · checked')
    expect(document.body.textContent).not.toMatch(/Failing since|Lost · failing since/)
  })

  it('failing and lost are shown in the warning ink; ok is not', async () => {
    serveChecks({ ...checks({ health: { state: 'failing', lastResult: 'failing', checkedAt, failingSince, lostAt: null } }), ...OWNER })
    const failing = renderPage()
    expect((await healthFact()).querySelector('[data-testid="health-value"]')!.className).toContain('text-ink-warning')
    failing.unmount()
    serveChecks({ ...checks(), ...OWNER })
    renderPage()
    expect((await healthFact()).querySelector('[data-testid="health-value"]')!.className).not.toContain('text-ink-warning')
  })
})

// ---------------------------------------------------------------------------
// Saved permission checks and board 5 after a reload
// ---------------------------------------------------------------------------

describe('saved permission checks', () => {
  it('after a remount the Permission checks fact and board 5 come from the saved result', async () => {
    const savedAt = ago(3 * HOUR)
    serveChecks({ ...checks({ permissionCheck: { checks: CE_DENIED, checkedAt: savedAt, trigger: 'check_again' } }), ...OWNER })
    const first = renderPage()
    expect((await screen.findByTestId('fact-permissions')).textContent).toBe(`Permission checks5 of 6 passed · checked ${at(savedAt)}`)
    first.unmount()

    // A reload: a new client, nothing in memory.
    renderPage(newClient())
    const fact = await screen.findByTestId('fact-permissions')
    expect(fact.textContent).toBe(`Permission checks5 of 6 passed · checked ${at(savedAt)}`)
    const panel = await screen.findByTestId('permission-warnings')
    expect(panel.textContent).toContain('Connected. Some permissions need attention.')
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      "Read Cost Explorer spend ce:GetCostAndUsage — AWS refused this call. DevControl features that rely on it may not work until the role allows it.To fix: this permission comes from the DevControlReadExtras inline policy. Check that it's attached and that its JSON matches the policy on this page.",
    ])
    expect(within(panel).getByText('DevControlReadExtras (JSON)')).toBeInTheDocument()
    expectNoRemovedText()
  })

  it('all six saved as passed: the fact with the note, no board 5 panel', async () => {
    renderPage()
    const fact = await screen.findByTestId('fact-permissions')
    expect(fact.textContent).toMatch(/^Permission checks6 of 6 passed · checked /)
    expect(fact.textContent).toContain('Six of the permissions DevControl uses. Not a full review of your role.')
    expect(screen.queryByTestId('permission-warnings')).toBeNull()
  })

  it.each([
    ['owner', OWNER, 'Not saved for this connection yet. Use Check again to run them.'],
    ['member', {}, 'Not saved for this connection yet.'],
  ] as const)('none saved yet (%s): F10', async (_who, role, text) => {
    serveChecks({ ...checks({ permissionCheck: null }), ...role })
    renderPage()
    expect((await screen.findByTestId('fact-permissions')).textContent).toBe(`Permission checks${text}`)
    expect(screen.queryByTestId('permission-warnings')).toBeNull()
  })

  it('right after a connect: the connect result until the saved checks arrive, then the saved one', async () => {
    // Made before the page mounts: its relative time is read once, at mount.
    const savedAt = ago(1 * MIN)
    accountsBody = { success: true, data: [], connection: { state: 'not_connected' } }
    let release: (value: unknown) => void = () => {}
    checksAnswer = () => new Promise((resolve) => { release = resolve })
    mockPost.mockResolvedValue({ data: { success: true, data: ACCOUNT, permissionCheck: { checks: ALL_VERIFIED }, message: 'AWS account connected successfully' } })
    renderPage()
    await screen.findAllByTestId('external-id-field')
    fireEvent.change(screen.getByPlaceholderText(/arn:aws:iam::YOUR_ACCOUNT_ID/i), { target: { value: 'arn:aws:iam::123456789012:role/DevControlRole' } })
    const button = screen.getByRole('button', { name: 'Connect account' })
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    // The GET is pending: the connect response's result.
    expect((await screen.findByTestId('fact-permissions')).textContent).toMatch(/^Permission checks6 of 6 passed · checked /)
    expect(screen.queryByTestId('fact-health')).toBeNull()
    // The saved result arrives.
    release({ data: { success: true, data: { ...checks({ permissionCheck: { checks: CE_DENIED, checkedAt: savedAt, trigger: 'connect' } }), ...OWNER } } })
    await waitFor(() => expect(screen.getByTestId('fact-permissions').textContent).toBe(`Permission checks5 of 6 passed · checked ${at(savedAt)}`))
    expect(await healthFact()).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Board 5: the role's policies (P1-P11)
// ---------------------------------------------------------------------------

describe("the role's policies", () => {
  const policyAt = ago(3 * HOUR)
  const lines = (section: HTMLElement) => [...section.querySelectorAll('li')].map((li) => li.textContent)

  it.each([
    ['all attached and matching', {}, ['✓SecurityAudit attached', '✓ViewOnlyAccess attached', '✓DevControlReadExtras matches the current version']],
    ['managed missing, inline differs', { securityAudit: 'missing', viewOnlyAccess: 'missing', readExtras: 'differs' }, ['✕SecurityAudit not attached', '✕ViewOnlyAccess not attached', '✕DevControlReadExtras differs from the current version']],
    ['no inline policy', { readExtras: 'missing' }, ['✓SecurityAudit attached', '✓ViewOnlyAccess attached', '✕No inline policy named DevControlReadExtras']],
    ['inline policy unreadable', { securityAudit: 'missing', readExtras: 'unreadable' }, ['✕SecurityAudit not attached', '✓ViewOnlyAccess attached', "?DevControlReadExtras couldn't be read. Reading it needs SecurityAudit."]],
  ] as const)('%s', async (_name, over, expected) => {
    serveChecks({ ...checks({ policyCheck: { ...POLICY_OK, checkedAt: policyAt, ...over } }), ...OWNER })
    renderPage()
    const section = await screen.findByTestId('role-policies')
    expect(within(section).getByRole('heading', { level: 3 }).textContent).toBe(`Your role's policies · checked ${at(policyAt)}`)
    expect(lines(section)).toEqual(expected)
    expect(screen.queryByTestId('policy-read-only-access')).toBeNull()
    expect(screen.queryByTestId('policy-also-attached')).toBeNull()
    expectNoRemovedText()
  })

  it('ReadOnlyAccess attached: P8', async () => {
    serveChecks({ ...checks({ policyCheck: { ...POLICY_OK, readOnlyAccess: true, securityAudit: 'missing', viewOnlyAccess: 'missing', readExtras: 'missing' } }), ...OWNER })
    renderPage()
    expect((await screen.findByTestId('policy-read-only-access')).textContent).toBe(
      'ReadOnlyAccess attached: it works, but allows more than DevControl needs. To narrow it, attach the three policies above, then detach ReadOnlyAccess.'
    )
  })

  it.each([
    [['AmazonS3ReadOnlyAccess', 'AWSSupportAccess'], 2, 'Also attached: AmazonS3ReadOnlyAccess, AWSSupportAccess, and 2 other policies'],
    [['AmazonS3ReadOnlyAccess'], 1, 'Also attached: AmazonS3ReadOnlyAccess, and 1 other policy'],
    [['AmazonS3ReadOnlyAccess', 'AWSSupportAccess'], 0, 'Also attached: AmazonS3ReadOnlyAccess, AWSSupportAccess'],
    [[], 3, 'Also attached: 3 other policies'],
    [[], 1, 'Also attached: 1 other policy'],
  ] as const)('P9: %j and %i others', async (names, otherCount, text) => {
    serveChecks({ ...checks({ policyCheck: { ...POLICY_OK, otherAwsManaged: names, otherCount } }), ...OWNER })
    renderPage()
    expect((await screen.findByTestId('policy-also-attached')).textContent).toBe(text)
  })

  it('unreadable: P10 and no verdict lines', async () => {
    serveChecks({ ...checks({ policyCheck: { unreadable: true, contractVersion: 1, checkedAt: policyAt, trigger: 'connect' } }), ...OWNER })
    renderPage()
    const section = await screen.findByTestId('role-policies')
    expect(section.textContent).toBe(
      `Your role's policies · checked ${at(policyAt)}DevControl couldn't read this role's policies. AWS refused the IAM calls SecurityAudit and ViewOnlyAccess allow, so they may not be attached.`
    )
    expect(section.querySelectorAll('li')).toHaveLength(0)
  })

  it.each([
    ['owner', OWNER, "Your role's policiesNot compared yet. Use Check again."],
    ['member', {}, "Your role's policiesNot compared yet."],
  ] as const)('not compared yet (%s): P11', async (_who, role, text) => {
    serveChecks({ ...checks({ policyCheck: null }), ...role })
    renderPage()
    expect((await screen.findByTestId('role-policies')).textContent).toBe(text)
  })
})

// ---------------------------------------------------------------------------
// Refused sources, role replaced
// ---------------------------------------------------------------------------

describe('refused sources (R1-R3)', () => {
  it('lists each refused listing with its label and action, under the scan date', async () => {
    const scannedAt = ago(HOUR)
    serveChecks({
      ...checks({
        refusedSources: {
          scannedAt,
          sources: [
            { source: 'ec2', action: 'ec2:DescribeInstances' },
            { source: 'load-balancer', action: 'elasticloadbalancing:DescribeLoadBalancers' },
            { source: 'resource-explorer', action: 'resource-explorer-2:Search' },
            // A source the page has no label for is not shown.
            { source: 'something-new', action: 'x:Y' },
          ],
        },
      }),
      ...OWNER,
    })
    renderPage()
    const list = await screen.findByTestId('refused-sources')
    expect(list.querySelector('p')!.textContent).toBe(`Refused during the scan on ${at(scannedAt)}`)
    expect([...list.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      "EC2 instances (ec2:DescribeInstances): AWS refused this listing, so DevControl couldn't read these resources.",
      "Load balancers (elasticloadbalancing:DescribeLoadBalancers): AWS refused this listing, so DevControl couldn't read these resources.",
      "Resource Explorer search (resource-explorer-2:Search): AWS refused this listing, so DevControl couldn't read these resources.",
    ])
  })

  it('has a label for each of the 8 saved listings', async () => {
    const all = [
      ['ec2', 'EC2 instances'], ['ebs', 'EBS volumes'], ['rds', 'RDS databases'], ['s3', 'S3 buckets'],
      ['lambda', 'Lambda functions'], ['load-balancer', 'Load balancers'], ['cloudfront', 'CloudFront distributions'],
      ['resource-explorer', 'Resource Explorer search'],
    ]
    serveChecks({ ...checks({ refusedSources: { scannedAt: ago(HOUR), sources: all.map(([source]) => ({ source, action: 'a:B' })) } }), ...OWNER })
    renderPage()
    const list = await screen.findByTestId('refused-sources')
    expect([...list.querySelectorAll('li')].map((li) => li.textContent!.split(' (')[0])).toEqual(all.map(([, label]) => label))
  })

  it('nothing refused, or no scan saved yet: no list', async () => {
    renderPage()
    await healthFact()
    expect(screen.queryByTestId('refused-sources')).toBeNull()
    expect(document.body.textContent).not.toContain('Refused during the scan')
  })
})

describe('role replaced (F12)', () => {
  it('shows the notice when the role ID changed', async () => {
    serveChecks({ ...checks({ roleReplacedAt: ago(HOUR) }), ...OWNER })
    renderPage()
    expect((await screen.findByTestId('role-replaced')).textContent).toBe(
      'The role at this ARN was replaced in AWS after it was connected: it has a new role ID. DevControl can assume it. Use Check again to review its permissions.'
    )
  })

  it('no notice otherwise', async () => {
    renderPage()
    await healthFact()
    expect(screen.queryByTestId('role-replaced')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Check again
// ---------------------------------------------------------------------------

const C3 = 'Runs the six checks and the policy comparison again. One check is a Cost Explorer request, which AWS bills to your account at USD 0.01.'

describe('Check again', () => {
  const button = () => screen.findByRole('button', { name: 'Check again' })

  it('owner: the button and the billed-call note', async () => {
    renderPage()
    expect(await button()).not.toBeDisabled()
    expect(screen.getByText(C3)).toBeInTheDocument()
  })

  it('member: no button, no note', async () => {
    serveChecks(checks())
    renderPage()
    await healthFact()
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(screen.queryByTestId('check-again')).toBeNull()
    expect(document.body.textContent).not.toContain(C3)
  })

  it('pending: "Checking…" and disabled', async () => {
    mockPost.mockReturnValue(new Promise(() => {}))
    renderPage()
    fireEvent.click(await button())
    expect(await screen.findByRole('button', { name: 'Checking…' })).toBeDisabled()
    expect(mockPost).toHaveBeenCalledWith('/api/aws/accounts/check-again')
  })

  it('429 with availableAt: "Available again at {time}" and the button disabled', async () => {
    const availableAt = new Date(Date.now() + 4 * MIN).toISOString()
    mockPost.mockRejectedValue(httpError(429, { code: 'CHECK_COOLDOWN', message: 'DevControl checked this connection a few minutes ago. Try again after 12:00 UTC.', availableAt }, { 'retry-after': '240' }))
    renderPage()
    fireEvent.click(await button())
    expect((await screen.findByTestId('check-again-cooldown')).textContent).toBe(`Available again at ${formatAvailableTime(availableAt)}`)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('429 with only Retry-After: the time from the header', async () => {
    mockPost.mockRejectedValue(httpError(429, { code: 'CHECK_COOLDOWN' }, { 'retry-after': '300' }))
    renderPage()
    fireEvent.click(await button())
    const before = Date.now()
    const text = (await screen.findByTestId('check-again-cooldown')).textContent
    const expected = [0, 1, 2].map((s) => `Available again at ${formatAvailableTime(new Date(before + 300_000 + s * 1000).toISOString())}`)
    expect(expected.concat(`Available again at ${formatAvailableTime(new Date(before + 299_000).toISOString())}`)).toContain(text)
    expect(screen.getByRole('button', { name: 'Check again' })).toBeDisabled()
  })

  it('a cooldown from the saved checks: disabled with the time, before any click', async () => {
    const availableAt = new Date(Date.now() + 3 * MIN).toISOString()
    serveChecks({ ...checks(), checkAgain: { availableAt } })
    renderPage()
    expect(await button()).toBeDisabled()
    expect(screen.getByTestId('check-again-cooldown').textContent).toBe(`Available again at ${formatAvailableTime(availableAt)}`)
  })

  it('the cooldown ends: the button is enabled again', async () => {
    const availableAt = new Date(Date.now() + 150).toISOString()
    serveChecks({ ...checks(), checkAgain: { availableAt } })
    renderPage()
    expect(await button()).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check again' })).not.toBeDisabled(), { timeout: 2000 })
    expect(screen.queryByTestId('check-again-cooldown')).toBeNull()
  })

  it.each(['ROLE_NOT_ASSUMABLE', 'ROLE_NOT_FOUND', 'ROLE_CHECK_FAILED'])('%s: B7 and the causes panel C5-C9, with the External ID for the owner; health refreshed', async (code) => {
    mockPost.mockRejectedValue(httpError(422, { code, message: "DevControl couldn't assume your role. Its health on this page now shows the failure." }))
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderPage(client)
    fireEvent.click(await button())
    const panel = await screen.findByTestId('check-again-refused')
    expect(panel.getAttribute('role')).toBe('alert')
    expect(panel.querySelector('p')!.textContent).toBe("DevControl couldn't assume your role. Its health on this page now shows the failure.")
    expect(panel.textContent).toContain("AWS didn't allow DevControl to assume the role. Possible causes include:")
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'The role was deleted or renamed in IAM.',
      "Its trust policy no longer allows DevControl's AWS account.",
      "Its External ID condition isn't exactly ext-123 anymore.",
    ])
    expect(panel.textContent).toContain("AWS gives DevControl the same answer for each of these, so DevControl can't tell which one applies. Your connection stays as it is.")
    const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
    expect(keys).toEqual(expect.arrayContaining([['aws-connection-checks'], ['aws-accounts']]))
    expectNoRemovedText()
  })

  it('C8 is owner-only: without the External ID (absent from GET /accounts for a non-owner) the cause is not listed', async () => {
    accountsBody = { ...accountsBody, data: [MEMBER_ACCOUNT] }
    mockPost.mockRejectedValue(httpError(422, { code: 'ROLE_NOT_ASSUMABLE' }))
    renderPage()
    fireEvent.click(await button())
    const panel = await screen.findByTestId('check-again-refused')
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'The role was deleted or renamed in IAM.',
      "Its trust policy no longer allows DevControl's AWS account.",
    ])
    expect(document.body.textContent).not.toMatch(/External ID condition/)
  })

  it.each([
    ['AWS_UNAVAILABLE', 503, "AWS didn't respond while we checked your role. Nothing was changed. Please try again in a minute."],
    ['CONNECTION_CHANGED', 409, 'Your AWS connection changed while DevControl was checking it. Nothing was saved. Refresh the page.'],
    ['FORBIDDEN', 403, 'Only an organization owner can check the AWS connection again.'],
    ['CONNECT_CHECK_IN_PROGRESS', 409, 'A connection check is already running for this workspace. Try again in a minute.'],
  ])('%s: the server\'s fixed message inline, no causes panel', async (code, status, message) => {
    mockPost.mockRejectedValue(httpError(status, { code, message }))
    renderPage()
    fireEvent.click(await button())
    expect((await screen.findByTestId('check-again-error')).textContent).toBe(message)
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(screen.queryByTestId('check-again-refused')).toBeNull()
    expect(screen.getByRole('button', { name: 'Check again' })).not.toBeDisabled()
  })

  it('no response (network): the reused network text', async () => {
    mockPost.mockRejectedValue(new Error('Network Error'))
    renderPage()
    fireEvent.click(await button())
    expect((await screen.findByTestId('check-again-error')).textContent).toBe("We couldn't reach DevControl. Check your connection and try again.")
  })

  it('success: invalidates the checks and the accounts queries, and the page shows the new saved results', async () => {
    const newAt = ago(0)
    mockPost.mockImplementation(async () => {
      serveChecks({ ...checks({ permissionCheck: { checks: CE_DENIED, checkedAt: newAt, trigger: 'check_again' } }), checkAgain: { availableAt: new Date(Date.now() + 5 * MIN).toISOString() } })
      return { data: { success: true, data: { ...checks(), ...OWNER } } }
    })
    const client = newClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    renderPage(client)
    fireEvent.click(await button())
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2))
    expect(invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)).toEqual([['aws-connection-checks'], ['aws-accounts']])
    await waitFor(() => expect(screen.getByTestId('fact-permissions').textContent).toBe(`Permission checks5 of 6 passed · checked ${at(newAt)}`))
    expect(await screen.findByTestId('check-again-cooldown')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 409 NOT_CONNECTED, old servers, and what is never rendered
// ---------------------------------------------------------------------------

describe('what the checks endpoint can answer', () => {
  it('409 NOT_CONNECTED means "no checks yet", not an error', async () => {
    checksAnswer = () => Promise.reject(httpError(409, { code: 'NOT_CONNECTED', message: 'No AWS account is connected.' }))
    renderPage()
    expect((await healthFact()).querySelector('[data-testid="health-value"]')!.textContent).toBe('Not checked yet. DevControl checks at each scan.')
    expect(screen.getByTestId('fact-permissions').textContent).toBe('Permission checksNot saved for this connection yet.')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toContain('No AWS account is connected.')
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it.each([
    ['404 (a server without the endpoint)', () => Promise.reject(httpError(404, { message: 'Not Found' }))],
    ['500', () => Promise.reject(httpError(500, { message: 'Failed to retrieve the AWS connection checks.' }))],
    ['409 AWS_ACCOUNT_AMBIGUOUS', () => Promise.reject(httpError(409, { code: 'AWS_ACCOUNT_AMBIGUOUS', message: 'ambiguous' }))],
    ['a network failure', () => Promise.reject(new Error('Network Error'))],
    ['a body without a recognized health', () => Promise.resolve({ data: { success: true, data: { health: { state: 'great' } } } })],
  ])('%s: nothing new is shown, and never an error', async (_name, answer) => {
    checksAnswer = answer
    renderPage()
    await screen.findByTestId('fact-discovery')
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/api/aws/accounts/checks'))
    // Let the failed request settle.
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('fact-health')).toBeNull()
    expect(screen.queryByTestId('fact-permissions')).toBeNull()
    expect(screen.queryByTestId('role-policies')).toBeNull()
    expect(screen.queryByTestId('check-again')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Failed to retrieve|Not Found|ambiguous/)
  })

  it('a server without connection.health on GET /accounts still opens the connected view', async () => {
    accountsBody = { success: true, data: [ACCOUNT], connection: { state: 'connected' } }
    renderPage()
    expect(await screen.findByTestId('connected-view')).toBeInTheDocument()
    expect(await healthFact()).toBeInTheDocument()
  })

  it('never renders a role ID, a policy document, inline policy names or customer-managed ARNs, even if a body carried them', async () => {
    serveChecks({
      ...checks({
        roleUniqueId: 'AROAEXAMPLEROLEID0001',
        roleId: 'AROAEXAMPLEROLEID0002',
        policyCheck: { ...POLICY_OK, policyDocument: '{"Statement":[{"Effect":"Deny","Action":"secret:Thing"}]}', inlinePolicyNames: ['SecretInlinePolicy'], customerManagedArns: ['arn:aws:iam::123456789012:policy/CustomerPolicy'], otherCount: 2 },
      }),
      ...OWNER,
    })
    renderPage()
    await screen.findByTestId('role-policies')
    const text = document.body.textContent ?? ''
    for (const leaked of ['AROAEXAMPLEROLEID', 'secret:Thing', 'SecretInlinePolicy', 'policy/CustomerPolicy', 'CustomerPolicy']) {
      expect(text, leaked).not.toContain(leaked)
    }
    expect(screen.getByTestId('policy-also-attached').textContent).toBe('Also attached: 2 other policies')
  })
})

// ---------------------------------------------------------------------------
// Title by view (T1-T3), S1, type scale
// ---------------------------------------------------------------------------

const T2 = 'DevControl reads this AWS account through the IAM role you created in it. You control the role and can delete it at any time.'
const SETUP_SUBTITLE = 'DevControl reads your AWS account through an IAM role you create in it. You control the role and can delete it at any time.'

describe('the page title by view', () => {
  const subtitle = () => document.querySelector('[data-slot="page-header"] p')?.textContent ?? null

  it('connected: "AWS connection" with T2', async () => {
    renderPage()
    await screen.findByTestId('connected-view')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('AWS connection')
    expect(subtitle()).toBe(T2)
  })

  it('ambiguous: "AWS connection", no subtitle', async () => {
    accountsBody = { success: true, data: [ACCOUNT, { ...ACCOUNT, id: 2 }], connection: { state: 'ambiguous' } }
    renderPage()
    await screen.findByTestId('connection-ambiguous')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('AWS connection')
    expect(subtitle()).toBeNull()
  })

  it('loading: "AWS connection", no subtitle', async () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    renderPage()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('AWS connection')
    expect(subtitle()).toBeNull()
  })

  it('setup: unchanged, "Connect your AWS account" with its subtitle', async () => {
    accountsBody = { success: true, data: [], connection: { state: 'not_connected' } }
    renderPage()
    await screen.findAllByTestId('external-id-field')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Connect your AWS account')
    expect(subtitle()).toBe(SETUP_SUBTITLE)
  })
})

describe('board 7 (S1)', () => {
  it('the role-deleted line names the health it moves to', async () => {
    renderPage()
    const board = await screen.findByTestId('security-explanation')
    expect(within(board).getByText("Deleting the role in AWS doesn't remove your connection in DevControl. This page then shows its health as failing, then lost.")).toBeInTheDocument()
  })
})

describe('type scale in the D1 parts', () => {
  it('every size comes from the role tokens (failing health, policies, refused sources, Check again failure)', async () => {
    serveChecks({
      ...checks({
        health: { state: 'failing', lastResult: 'failing', checkedAt: ago(HOUR), failingSince: ago(2 * HOUR), lostAt: null },
        roleReplacedAt: ago(HOUR),
        policyCheck: { ...POLICY_OK, readOnlyAccess: true, otherAwsManaged: ['AWSSupportAccess'], otherCount: 1 },
        refusedSources: { scannedAt: ago(HOUR), sources: [{ source: 'ec2', action: 'ec2:DescribeInstances' }] },
      }),
      ...OWNER,
    })
    mockPost.mockRejectedValue(httpError(422, { code: 'ROLE_NOT_ASSUMABLE' }))
    const { container } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }))
    await screen.findByTestId('check-again-refused')
    const tokens = [...container.querySelectorAll('[class]')].flatMap((node) => (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean))
    expect(tokens.filter((c) => /^(?:[\w-]+:)?text-(?:xs|sm|base|lg|xl|\dxl|\[\d[^\]]*\])$/.test(c))).toEqual([])
    expect(tokens.filter((c) => /^(?:[\w-]+:)?font-(?:bold|extrabold|black)$/.test(c))).toEqual([])
    expectNoRemovedText()
  })
})
