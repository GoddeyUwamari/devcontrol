/**
 * The Connect AWS page (AWS connect PR E): it reads the server's connection state first, a
 * connected organization sees its connection (board 4) and never the setup form, and the setup
 * (boards 1-3, 6) shows only founder-approved copy. The CloudFormation card renders only when
 * connect-init returns a launchStack whose console link passes the L-6 check (PR D2).
 *
 * Also kept from before: a successful connect invalidates the dashboard's 4-hour
 * platform-dashboard-stats cache (Traffic Experiment #1 P0 fix).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ConnectAwsPage from '../page'
import {
  ACCOUNTS_ERROR,
  ALREADY_CONNECTED_TEXT,
  AMBIGUOUS_TEXT,
  CF_FAILED_BODY,
  CF_INTRO,
  CF_TITLE,
  CHECKING_BUTTON,
  CHECKING_NOTHING_SAVED,
  CHECKING_TITLE,
  CONTINUE_TO_DASHBOARD,
  COVERAGE_ERROR,
  COVERAGE_LOADING,
  GO_TO_DASHBOARD,
  MANUAL_SUMMARY,
  NOTHING_SENT,
  NOT_ASSUMABLE_FOOT,
  NOT_ASSUMABLE_TITLE,
  PAGE_SUBTITLE,
  PERMISSIONS_NOTE,
  ROLE_ARN_FORMAT,
  ROLE_ARN_REQUIRED,
  SCP_NOTE,
  SEC_CREDENTIALS,
  SEC_EXTERNAL_ID,
  SEC_REMOVE,
  SEC_REMOVE_STACK,
  SUPPORT_MAILTO,
  permissionFixText,
} from '../connectAwsCopy'
import { HOME_REGION_ONLY_NOTE, describeCoverage } from '../../services/coverage'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { toast } from 'sonner'
import { REMOVED_STRINGS, expectNoRemovedText } from './removedText'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/lib/gtag', () => ({
  trackLeadQualified: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-1' } }),
}))

const mockConnectInit = vi.fn()
const mockConnect = vi.fn()
const mockGetAccountsAndConnection = vi.fn()
const mockGetConnectionChecks = vi.fn()
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: {
    connectInit: (...args: unknown[]) => mockConnectInit(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
    getAccountsAndConnection: (...args: unknown[]) => mockGetAccountsAndConnection(...args),
    // PR D1 (connection-health.test.tsx covers it): null here is a server from before D1.
    getConnectionChecks: (...args: unknown[]) => mockGetConnectionChecks(...args),
  },
}))

const mockGetCoverage = vi.fn()
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getCoverage: (...args: unknown[]) => mockGetCoverage(...args),
  },
}))

const PLATFORM = '999999999999'
const CONNECT_INIT_DATA = {
  externalId: 'ext-123',
  platformAccountId: PLATFORM,
  trustPolicy: { Version: '2012-10-17', Statement: [] },
}
// PR D2: a link the L-6 check accepts (the PR E fixture, https://example.test/quickcreate, no longer renders).
const LAUNCH_URL = 'https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=x&stackName=DevControl&param_ExternalId=ext-123&param_RoleName=DevControlRole'
const TEMPLATE_URL = 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'
const WITH_LAUNCH_STACK = { ...CONNECT_INIT_DATA, launchStack: { url: LAUNCH_URL, templateVersion: '1', templateUrl: TEMPLATE_URL } }

const ACCOUNT = { id: 1, org_id: 'org-1', account_id: '123456789012', role_arn: 'arn:aws:iam::123456789012:role/DevControlRole', nickname: null, external_id: 'ext-123', region: 'us-east-1', connected_at: new Date().toISOString(), status: 'active' }
const ACTIONS = ['ec2:DescribeRegions', 's3:ListAllMyBuckets', 'lambda:ListFunctions', 'cloudwatch:GetMetricData', 'ce:GetCostAndUsage', 'resource-explorer-2:Search']
const ALL_VERIFIED = ACTIONS.map((action) => ({ action, status: 'verified' }))

const NOT_CONNECTED = { accounts: [], connection: 'not_connected' }
const CONNECTED = { accounts: [ACCOUNT], connection: 'connected' }

const COVERAGE: ServicesCoverage = {
  account: { connected: true, status: 'active', home_region: 'us-east-1' },
  scope: {
    home_region: { region: 'us-east-1', count: 7 },
    s3: { in_last_scan: true, regions: [{ region: 'us-east-1', count: 2 }, { region: 'eu-west-1', count: 3 }] },
    cloudfront: { in_last_scan: true, count: 1 },
    enabled_regions: { known: false, count: null },
  },
  last_successful_scan_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  last_scan: { status: 'completed', started_at: new Date(Date.now() - 6 * 60_000).toISOString(), completed_at: new Date(Date.now() - 5 * 60_000).toISOString(), warnings: [] },
  resource_types: null,
  tags_unknown_by_type: {},
  regions: [],
  total: 10,
}

describe('the removed-strings check itself', () => {
  it('covers every string PR E and PR D1 removed (so emptying the list fails)', () => {
    expect(REMOVED_STRINGS).toEqual(expect.arrayContaining([
      '✅ Connection verified — redirecting to your dashboard...',
      'Verifying connection...',
      'Our setup guide walks through the exact IAM role configuration step by step.',
      'Cost and usage reports',
      'or other stored data',
      'Disconnect it first',
      'Read-only by default',
      'AES-256 encrypted at rest',
      'SOC 2 readiness planning underway',
      'in Settings',
      'Connected and working',
    ]))
  })

  it('fails on any "verified" or ✅ in the page text', () => {
    document.body.innerHTML = '<p>All checks verified</p>'
    expect(() => expectNoRemovedText()).toThrow()
    document.body.innerHTML = '<p>✅ Done</p>'
    expect(() => expectNoRemovedText()).toThrow()
    document.body.innerHTML = '<p>Connected and working</p>'
    expect(() => expectNoRemovedText()).toThrow()
    document.body.innerHTML = ''
  })
})

const queryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderPage(client: QueryClient = queryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ConnectAwsPage />
    </QueryClientProvider>
  )
}

async function fillValidRoleArnAndGetButton() {
  // connect-init has answered (the External ID is shown), so the layout no longer changes.
  await screen.findAllByTestId('external-id-field')
  const input = screen.getByPlaceholderText(/arn:aws:iam::YOUR_ACCOUNT_ID/i)
  fireEvent.change(input, { target: { value: 'arn:aws:iam::123456789012:role/DevControlRole' } })
  const button = screen.getByRole('button', { name: 'Connect account' })
  // Disabled until connect-init resolves.
  await waitFor(() => expect(button).not.toBeDisabled())
  return button
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAccountsAndConnection.mockResolvedValue(NOT_CONNECTED)
  mockConnectInit.mockResolvedValue(CONNECT_INIT_DATA)
  mockGetCoverage.mockResolvedValue(COVERAGE)
  mockGetConnectionChecks.mockResolvedValue(null)
})

describe('Connect AWS page: Cost Explorer billing note (DB-D16)', () => {
  it.each([['connected', true], ['not connected', false]] as const)('%s: the sidebar states the founder-approved wording, once', async (_name, connected) => {
    if (connected) mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
    renderPage()
    const note = await screen.findByTestId('cost-explorer-billing-note')
    expect(note.textContent).toBe('Cost Explorer requests are billed at USD 0.01 per request. Results are cached for 4 hours, so a typical account makes only a few requests per day.')
    expect(screen.getAllByTestId('cost-explorer-billing-note')).toHaveLength(1)
  })
})

describe('Connect AWS page: which view opens', () => {
  it('T1 connected on mount: board 4, no setup form, connect-init and connect never called', async () => {
    mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
    renderPage()
    await screen.findByTestId('connected-view')
    expect(screen.getByTestId('connected-account-id').textContent).toBe('123456789012')
    expect(screen.queryByPlaceholderText(/arn:aws:iam/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect account' })).toBeNull()
    expect(mockConnectInit).not.toHaveBeenCalled()
    expect(mockConnect).not.toHaveBeenCalled()
    expectNoRemovedText()
  })

  it('T1 on a server from before PR D1 (no saved checks): nothing new, no Permission checks fact after a reload, no Health', async () => {
    // PR E expected the permission results to vanish on remount. Since PR D1 they are saved and come
    // back (connection-health.test.tsx); only a server without GET /accounts/checks still loses them.
    mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
    renderPage()
    await screen.findByTestId('connected-view')
    await waitFor(() => expect(mockGetConnectionChecks).toHaveBeenCalled())
    expect(screen.queryByTestId('fact-permissions')).toBeNull()
    expect(screen.queryByTestId('fact-health')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Health|Check again|Your role's policies/)
    expect(screen.queryByRole('alert')).toBeNull()
    expectNoRemovedText()
  })

  it('T2 not connected: connect-init once, the External ID as its own field, and Copy copies exactly it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    const field = await screen.findByTestId('external-id-field')
    expect(mockConnectInit).toHaveBeenCalledTimes(1)
    expect(within(field).getByTestId('external-id').textContent).toBe('ext-123')
    expect(field.textContent).toContain('Your External ID')
    expect(field.textContent).toContain('The same value every time you open this page. It never changes.')
    fireEvent.click(within(field).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('ext-123')
    expect(await within(field).findByRole('button', { name: '✓ Copied!' })).toBeInTheDocument()
    expectNoRemovedText()
  })

  it('T3 ambiguous: the ambiguous text with the contact link, and no form', async () => {
    mockGetAccountsAndConnection.mockResolvedValue({ accounts: [ACCOUNT, { ...ACCOUNT, id: 2 }], connection: 'ambiguous' })
    renderPage()
    const panel = await screen.findByTestId('connection-ambiguous')
    expect(panel.textContent).toBe(`${AMBIGUOUS_TEXT}To disconnect or change accounts, contact us.`)
    expect(within(panel).getByRole('link', { name: 'contact us' }).getAttribute('href')).toBe(SUPPORT_MAILTO)
    expect(screen.queryByPlaceholderText(/arn:aws:iam/i)).toBeNull()
    expect(mockConnectInit).not.toHaveBeenCalled()
  })

  it("T4 the state can't be read: the reused connection line, and the setup still renders", async () => {
    mockGetAccountsAndConnection.mockRejectedValue(new Error('boom'))
    renderPage()
    expect((await screen.findByTestId('aws-connection-line')).textContent).toBe(ACCOUNTS_ERROR)
    expect(await screen.findByPlaceholderText(/arn:aws:iam/i)).toBeInTheDocument()
  })

  it('T5 non-owner, not connected: the server authorization reason, no toast, button disabled', async () => {
    mockConnectInit.mockRejectedValue({
      response: { status: 403, data: { success: false, message: 'Only an organization owner can connect an AWS account' } },
    })
    renderPage()
    expect(
      await screen.findByText('Only an organization owner can connect an AWS account. Ask your owner to connect your account.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/Could not load your trust policy/)).not.toBeInTheDocument()
    expect(toast.error).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Connect account' })).toBeDisabled()
  })
})

describe('Connect AWS page: the CloudFormation card', () => {
  it('T6 flag off (no launchStack): no CloudFormation card, no Launch stack, the manual steps open and unwrapped', async () => {
    renderPage()
    await screen.findByTestId('external-id-field')
    expect(screen.queryByTestId('cloudformation-card')).toBeNull()
    expect(screen.queryByText(CF_TITLE)).toBeNull()
    expect(screen.queryByText(/Launch stack/)).toBeNull()
    expect(screen.queryByText(MANUAL_SUMMARY)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Create the IAM role' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Attach the permissions' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Enter your Role ARN' })).toBeInTheDocument()
    // No stack wording anywhere while the template doesn't exist.
    expect(document.body.textContent).not.toMatch(/stack|Outputs/i)
  })

  it('T7 launchStack present: the card with approved requirement 1, Launch links to the URL, manual setup folded', async () => {
    mockConnectInit.mockResolvedValue(WITH_LAUNCH_STACK)
    renderPage()
    const card = await screen.findByTestId('cloudformation-card')
    expect(card.textContent).toContain(CF_INTRO)
    expect(CF_INTRO).toBe('The stack creates one IAM role using the same recommended DevControl permission set as the manual setup below.')
    expect(within(card).getByRole('link', { name: 'Launch stack ↗' }).getAttribute('href')).toBe(LAUNCH_URL)
    expect(screen.getByText(MANUAL_SUMMARY).closest('details')?.hasAttribute('open')).toBe(false)
  })

  it('F3 S-1: "Template v1 · View template", View template opens the hosted template in a new tab', async () => {
    mockConnectInit.mockResolvedValue(WITH_LAUNCH_STACK)
    renderPage()
    const line = await screen.findByTestId('cloudformation-template')
    expect(line.textContent).toBe('Template v1 · View template')
    const link = within(line).getByRole('link', { name: 'View template' })
    expect(link.getAttribute('href')).toBe(TEMPLATE_URL)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    // S-1b (the checksum line) is not in D2.
    expect(document.body.textContent).not.toMatch(/checksum|SHA-256/i)
  })

  it.each([
    ['another host', 'https://example.test/quickcreate'],
    ['a look-alike host', 'https://console.aws.amazon.com.evil.test/cloudformation/home'],
    ['http', 'http://console.aws.amazon.com/cloudformation/home'],
    ['javascript:', 'javascript:alert(1)'],
    ['credentials', 'https://user@console.aws.amazon.com/cloudformation/home'],
    ['another console path', 'https://console.aws.amazon.com/s3/home'],
    ['an empty URL', ''],
  ])('F2 a Launch link with %s: no card, the manual setup open, no stack wording on the page', async (_label, url) => {
    mockConnectInit.mockResolvedValue({ ...CONNECT_INIT_DATA, launchStack: { ...WITH_LAUNCH_STACK.launchStack, url } })
    renderPage()
    await screen.findByTestId('external-id-field')
    expect(screen.queryByTestId('cloudformation-card')).toBeNull()
    expect(screen.queryByText(MANUAL_SUMMARY)).toBeNull()
    expect(screen.getByRole('heading', { level: 2, name: 'Enter your Role ARN' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(url || 'console.aws.amazon.com')
    expect(screen.queryByTestId('security-remove-stack')).toBeNull()
  })

  it('F4 an invalid template URL: the card and version stay, without the View template link', async () => {
    mockConnectInit.mockResolvedValue({ ...CONNECT_INIT_DATA, launchStack: { ...WITH_LAUNCH_STACK.launchStack, templateUrl: 'https://example.test/t.json' } })
    renderPage()
    const line = await screen.findByTestId('cloudformation-template')
    expect(line.textContent).toBe('Template v1')
    expect(within(line).queryByRole('link')).toBeNull()
  })

  it('F5 S-2: the failed-stack help says to delete the stack before launching again', async () => {
    mockConnectInit.mockResolvedValue(WITH_LAUNCH_STACK)
    renderPage()
    const card = await screen.findByTestId('cloudformation-card')
    expect(CF_FAILED_BODY).toBe('If the stack shows ROLLBACK_COMPLETE, open its Events tab to see why. AWS can only delete a stack in that state, so delete it before you launch again. A common cause is an existing role with the same name: launch again with another role name that starts with DevControlRole, or use that role under "Set it up by hand".')
    expect(card.textContent).toContain(CF_FAILED_BODY)
    expectNoRemovedText()
  })

  it('F6 S-3: board 7 names the stack only while the card is shown', async () => {
    mockConnectInit.mockResolvedValue(WITH_LAUNCH_STACK)
    renderPage()
    await screen.findByTestId('cloudformation-card')
    expect(SEC_REMOVE_STACK).toBe('If you created the role with the DevControl CloudFormation stack, you can delete the stack instead: that deletes the role.')
    const section = screen.getByTestId('security-explanation')
    expect(within(section).getByTestId('security-remove-stack').textContent).toBe(SEC_REMOVE_STACK)
    expect(section.textContent).toContain(`Remove access. ${SEC_REMOVE}${SEC_REMOVE_STACK}`)
  })
})

describe('Connect AWS page: checking and connected', () => {
  it('T8 checking: the checking panel, button "Checking…" disabled, no success wording', async () => {
    let resolve: (value: unknown) => void = () => {}
    mockConnect.mockReturnValue(new Promise((r) => { resolve = r }))
    renderPage()
    fireEvent.click(await fillValidRoleArnAndGetButton())
    const panel = await screen.findByTestId('connect-checking')
    expect(panel.textContent).toContain(CHECKING_TITLE)
    expect(panel.textContent).toContain(CHECKING_NOTHING_SAVED)
    expect(screen.getByRole('button', { name: CHECKING_BUTTON })).toBeDisabled()
    // No success wording while the check runs.
    expect(panel.textContent).not.toMatch(/connected|verified|✅/i)
    expect(document.body.textContent).not.toMatch(/verified|✅/i)
    resolve({ account: ACCOUNT, permissionCheck: { checks: ALL_VERIFIED } })
    await screen.findByTestId('connected-view')
  })

  it('T9 all six passed: board 4 with "6 of 6 passed", discovery from coverage, no redirect; Go to dashboard navigates', async () => {
    mockConnect.mockResolvedValue({ account: ACCOUNT, permissionCheck: { checks: ALL_VERIFIED } })
    renderPage()
    fireEvent.click(await fillValidRoleArnAndGetButton())
    const fact = await screen.findByTestId('fact-permissions')
    expect(fact.textContent).toMatch(/^Permission checks6 of 6 passed · checked .+/)
    expect(fact.textContent).toContain(PERMISSIONS_NOTE)
    expect(screen.queryByTestId('permission-warnings')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('AWS account connected successfully')
    await new Promise((r) => setTimeout(r, 1700))
    expect(mockPush).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: GO_TO_DASHBOARD }))
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
    expectNoRemovedText()
  })

  it('T10 some checks not passed: board 5 inside board 4, the exact fix text per action, the SCP note, Continue to dashboard', async () => {
    mockConnect.mockResolvedValue({
      account: ACCOUNT,
      permissionCheck: { checks: ALL_VERIFIED.map((c) =>
        c.action === 's3:ListAllMyBuckets' ? { ...c, status: 'denied' }
          : c.action === 'resource-explorer-2:Search' ? { ...c, status: 'not_verified' } : c) },
    })
    renderPage()
    fireEvent.click(await fillValidRoleArnAndGetButton())
    const panel = await screen.findByTestId('permission-warnings')
    expect(screen.getByTestId('connected-view').contains(panel)).toBe(true)
    expect(panel.textContent).toContain('Connected. Some permissions need attention.')
    expect(panel.textContent).toContain('This is not a full review of your role')
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      "List S3 buckets s3:ListAllMyBuckets — AWS refused this call. DevControl features that rely on it may not work until the role allows it.To fix: SecurityAudit and ViewOnlyAccess both allow this. Check that they're attached to the role.",
      "Search Resource Explorer resource-explorer-2:Search — Couldn't be checked. It may still work.To check: this permission comes from DevControlReadExtras. If it is attached, Resource Explorer may not be set up in this account.",
    ])
    expect(screen.getByTestId('permission-passed').textContent).toBe('List your AWS regions · List Lambda functions · Read CloudWatch metrics · Read Cost Explorer spend passed')
    expect(panel.textContent).toContain(SCP_NOTE)
    // An inline-policy action is listed, so the policy its fix text points to is on the page.
    expect(within(panel).getByText('DevControlReadExtras (JSON)')).toBeInTheDocument()
    expect(screen.getByTestId('fact-permissions').textContent).toMatch(/4 of 6 passed/)
    expect(screen.queryByRole('button', { name: GO_TO_DASHBOARD })).toBeNull()
    await new Promise((r) => setTimeout(r, 1700))
    expect(mockPush).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: CONTINUE_TO_DASHBOARD }))
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
    expectNoRemovedText()
  })

  it('T11 a server without the permission check: board 4 without the Permission checks fact', async () => {
    mockConnect.mockResolvedValue({ account: ACCOUNT, permissionCheck: null })
    renderPage()
    fireEvent.click(await fillValidRoleArnAndGetButton())
    await screen.findByTestId('connected-view')
    expect(screen.queryByTestId('fact-permissions')).toBeNull()
    expect(screen.queryByTestId('permission-warnings')).toBeNull()
  })

  it('T13 coverage: the Discovery fact and headline are describeCoverage output; the table and the home-region note', async () => {
    mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
    renderPage()
    const headline = await screen.findByTestId('coverage-headline')
    const expected = describeCoverage(COVERAGE, Date.now())
    expect(headline.textContent).toBe(expected.headline)
    expect(screen.getByTestId('fact-discovery').textContent).toBe(`Discovery${expected.lastScan}`)
    const rows = [...screen.getByTestId('coverage-table').querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    expect(rows).toEqual([
      ['All scanned resources', '10', '—'],
      ['Home region (us-east-1)', '7', '7 · home · complete'],
      ['S3 buckets in other regions', '3', '—'],
      ['CloudFront (global)', '1', '—'],
    ])
    expect(document.body.textContent).toContain(HOME_REGION_ONLY_NOTE.title)
    expect(document.body.textContent).toContain(HOME_REGION_ONLY_NOTE.body)
  })

  it('T13 coverage loading, then an error with Try again that refetches', async () => {
    mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
    mockGetCoverage.mockReturnValue(new Promise(() => {}))
    const { unmount } = renderPage()
    expect(await screen.findByText(COVERAGE_LOADING)).toBeInTheDocument()
    unmount()

    mockGetCoverage.mockRejectedValueOnce(new Error('down')).mockResolvedValue(COVERAGE)
    renderPage()
    expect(await screen.findByText(COVERAGE_ERROR)).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('fact-discovery')).getByRole('button', { name: 'Try again' }))
    await screen.findByTestId('coverage-headline')
    expect(mockGetCoverage).toHaveBeenCalledTimes(3)
  })

  // L-3: the query really uses coverageRefetchInterval (60 s while a scan runs or right after a connect).
  describe('coverage refetch timing is wired', () => {
    const RUNNING: ServicesCoverage = {
      ...COVERAGE,
      scan_in_progress: { since: new Date().toISOString() },
      last_scan: { status: 'running', started_at: new Date().toISOString(), completed_at: null, warnings: [] },
    }

    afterEach(() => {
      vi.useRealTimers()
    })

    it('re-reads coverage after 60 s while a scan is in progress', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
      mockGetCoverage.mockResolvedValue(RUNNING)
      renderPage()
      await screen.findByTestId('coverage-headline')
      expect(mockGetCoverage).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(59_000)
      expect(mockGetCoverage).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1_500)
      await waitFor(() => expect(mockGetCoverage).toHaveBeenCalledTimes(2))
    })

    it('right after a connect, re-reads coverage until the first scan has a job row', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockGetCoverage.mockResolvedValue({ ...COVERAGE, last_scan: null, last_successful_scan_at: null })
      mockConnect.mockResolvedValue({ account: ACCOUNT, permissionCheck: { checks: ALL_VERIFIED } })
      renderPage()
      fireEvent.click(await fillValidRoleArnAndGetButton())
      await screen.findByTestId('connected-view')
      await waitFor(() => expect(mockGetCoverage).toHaveBeenCalled())
      const before = mockGetCoverage.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_500)
      await waitFor(() => expect(mockGetCoverage.mock.calls.length).toBeGreaterThan(before))
    })

    it('does not re-read when no scan is running and nothing was just connected', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
      renderPage()
      await screen.findByTestId('coverage-headline')
      await vi.advanceTimersByTimeAsync(120_000)
      expect(mockGetCoverage).toHaveBeenCalledTimes(1)
    })
  })
})

describe('Connect AWS page: cache invalidation', () => {
  it('T14 success invalidates aws-accounts, platform-dashboard-stats, services-coverage and the saved checks (PR D1, review L-2), and nothing else', async () => {
    mockConnect.mockResolvedValue({ account: ACCOUNT, permissionCheck: { checks: ALL_VERIFIED } })
    const client = queryClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    renderPage(client)
    fireEvent.click(await fillValidRoleArnAndGetButton())
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledTimes(4))
    const keys = invalidateSpy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)
    expect(keys).toEqual([['aws-accounts'], ['platform-dashboard-stats'], ['services-coverage'], ['aws-connection-checks']])
  })

  it('T14 a failed connect invalidates nothing', async () => {
    mockConnect.mockRejectedValue({ response: { data: { message: 'Failed to assume role' } } })
    const client = queryClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    renderPage(client)
    fireEvent.click(await fillValidRoleArnAndGetButton())
    await screen.findByTestId('connect-error')
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

describe('Connect AWS page: errors by code (board 6)', () => {
  async function failWith(rejection: unknown) {
    mockConnect.mockRejectedValue(rejection)
    renderPage()
    fireEvent.click(await fillValidRoleArnAndGetButton())
  }

  it('6a client validation: required and format errors inline under the field, with "Nothing was sent to AWS."', async () => {
    renderPage()
    await screen.findByTestId('external-id-field')
    const button = screen.getByRole('button', { name: 'Connect account' })
    fireEvent.click(button)
    expect(screen.getByTestId('arn-error').textContent).toBe(`${ROLE_ARN_REQUIRED}${NOTHING_SENT}`)
    fireEvent.change(screen.getByPlaceholderText(/arn:aws:iam/i), { target: { value: 'arn:aws:iam::123456789012:role/Other' } })
    expect(screen.queryByTestId('arn-error')).toBeNull()
    fireEvent.click(button)
    expect(screen.getByTestId('arn-error').textContent).toBe(`${ROLE_ARN_FORMAT}${NOTHING_SENT}`)
    expect(mockConnect).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('6a server ROLE_NAME_PREFIX: its text inline under the field', async () => {
    await failWith({ response: { status: 422, data: { code: 'ROLE_NAME_PREFIX', message: 'Prefix text.' } } })
    expect((await screen.findByTestId('arn-error')).textContent).toBe(`Prefix text.${NOTHING_SENT}`)
    expect(screen.queryByTestId('connect-error')).toBeNull()
  })

  it('6b ROLE_NOT_ASSUMABLE: the possible-causes panel (manual variant), never the server text; Try again re-submits', async () => {
    await failWith({ response: { status: 422, data: { code: 'ROLE_NOT_ASSUMABLE', message: 'SERVER TEXT' } } })
    const panel = await screen.findByTestId('connect-error')
    expect(panel.getAttribute('data-kind')).toBe('not_assumable')
    expect(panel.textContent).not.toContain('SERVER TEXT')
    expect(panel.textContent).toContain(NOT_ASSUMABLE_TITLE)
    expect([...panel.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      "The role doesn't exist under this ARN, for example because of a typo in the role name.",
      'The ARN is from a different account than the one you set the role up in (this one names 123456789012).',
      `The role's trust policy doesn't name arn:aws:iam::${PLATFORM}:root.`,
      "Its External ID condition isn't exactly ext-123.",
      "The role was created moments ago and AWS hasn't made it usable yet.",
    ])
    expect(panel.textContent).toContain(NOT_ASSUMABLE_FOOT)
    expect(document.body.textContent).not.toMatch(/stack/i)
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(2))
  })

  it('6b with the CloudFormation card: the stack variant of bullet 1 and the ExternalId tail', async () => {
    mockConnectInit.mockResolvedValue(WITH_LAUNCH_STACK)
    await failWith({ response: { status: 422, data: { code: 'ROLE_NOT_ASSUMABLE', message: 'x' } } })
    const items = [...(await screen.findByTestId('connect-error')).querySelectorAll('li')].map((li) => li.textContent)
    expect(items[0]).toBe("The stack hasn't finished (CREATE_COMPLETE), or the ARN wasn't copied from its RoleArn output.")
    expect(items[3]).toBe("Its External ID condition isn't exactly ext-123. If you changed the stack's ExternalId parameter, set it back to this value.")
  })

  it.each([
    ['AWS_UNAVAILABLE', 'aws_unavailable', true],
    ['PLATFORM_AWS_UNAVAILABLE', 'platform', true],
    ['CONNECT_CHECK_IN_PROGRESS', 'general', false],
    ['CONNECT_CHECK_BUSY', 'general', false],
    ['CONNECT_STATE_UNAVAILABLE', 'general', false],
    ['SAVE_FAILED', 'general', false],
    ['ROLE_NOT_FOUND', 'general', false],
    ['ROLE_CHECK_FAILED', 'general', false],
  ])('6c-6d and the rest: %s shows the server text inline (%s)', async (code, kind, retry) => {
    await failWith({ response: { status: 503, data: { code, message: `Text for ${code}.` } } })
    const panel = await screen.findByTestId('connect-error')
    expect(panel.getAttribute('data-kind')).toBe(kind)
    expect(panel.textContent).toContain(`Text for ${code}.`)
    expect(within(panel).queryByRole('button', { name: 'Try again' }) !== null).toBe(retry)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('6e ALREADY_CONNECTED: the page text with the contact link, never "Disconnect it first"; refetches the state', async () => {
    const client = queryClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')
    mockConnect.mockRejectedValue({ response: { status: 409, data: { code: 'ALREADY_CONNECTED', message: 'This organisation already has a connected AWS account. Disconnect it first.' } } })
    renderPage(client)
    fireEvent.click(await fillValidRoleArnAndGetButton())
    const panel = await screen.findByTestId('connect-error')
    expect(panel.textContent).toBe(`${ALREADY_CONNECTED_TEXT}To disconnect or change accounts, contact us.`)
    expect(within(panel).getByRole('link', { name: 'contact us' }).getAttribute('href')).toBe(SUPPORT_MAILTO)
    expect(invalidateSpy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey)).toEqual([['aws-accounts']])
    expectNoRemovedText()
  })

  it('6e end to end: after the 409 the refetched state is connected, and the page switches to board 4', async () => {
    mockGetAccountsAndConnection.mockResolvedValueOnce(NOT_CONNECTED).mockResolvedValue(CONNECTED)
    mockConnect.mockRejectedValue({ response: { status: 409, data: { code: 'ALREADY_CONNECTED', message: 'x' } } })
    renderPage()
    fireEvent.click(await fillValidRoleArnAndGetButton())
    await screen.findByTestId('connected-view')
    expect(mockGetAccountsAndConnection).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('connected-account-id').textContent).toBe('123456789012')
    expect(screen.queryByPlaceholderText(/arn:aws:iam/i)).toBeNull()
    expect(mockConnect).toHaveBeenCalledTimes(1)
  })

  it('a network failure (no response) is not blamed on the Role ARN', async () => {
    await failWith(new Error('Network Error'))
    expect((await screen.findByTestId('connect-error')).textContent).toBe("We couldn't reach DevControl. Check your connection and try again.")
  })
})

describe('Connect AWS page: board 7 and the sidebar', () => {
  it('T15 board 7: approved requirements 2 and 3 verbatim, no CloudFormation wording, contact links to support', async () => {
    renderPage()
    const section = await screen.findByTestId('security-explanation')
    expect(SEC_EXTERNAL_ID).toContain('Together with the trust policy, it means DevControl can assume this role only for your organization.')
    expect(SEC_EXTERNAL_ID).not.toContain('This stops anyone else')
    expect(SEC_CREDENTIALS).toContain('with a configured maximum of one hour')
    expect(SEC_REMOVE).toContain('with a configured maximum of one hour')
    expect(section.textContent).toContain(`External ID. ${SEC_EXTERNAL_ID}`)
    expect(section.textContent).toContain(`Short-lived credentials. ${SEC_CREDENTIALS}`)
    expect(section.textContent).toContain("DevControl keeps the data it already collected. Contact us and we'll delete it.")
    expect(section.textContent).toContain("Deleting the role in AWS doesn't remove your connection in DevControl.")
    expect(section.textContent).not.toMatch(/CloudFormation stack|the DevControl stack/)
    for (const link of within(section).getAllByRole('link')) expect(link.getAttribute('href')).toBe(SUPPORT_MAILTO)
  })

  it('T16 sidebar: Cost Explorer data, the encrypted-disk line, Need help? to support, and anchors that exist', async () => {
    const { container } = renderPage()
    await screen.findByTestId('external-id-field')
    const text = document.body.textContent ?? ''
    expect(text).toContain('Cost Explorer data')
    expect(text).toContain('Database stored on an encrypted disk (AWS EBS encryption)')
    expect(screen.getByRole('link', { name: 'Need help?' }).getAttribute('href')).toBe(SUPPORT_MAILTO)
    for (const name of ['Set it up by hand →', "What DevControl can and can't do →"]) {
      const href = screen.getByRole('link', { name }).getAttribute('href') ?? ''
      expect(container.querySelector(href)).not.toBeNull()
    }
    expectNoRemovedText()
  })

  it('T16 connected: no "Set it up by hand" link (its section is not on the page)', async () => {
    mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
    renderPage()
    await screen.findByTestId('connected-view')
    expect(screen.queryByRole('link', { name: 'Set it up by hand →' })).toBeNull()
    expect(screen.getByRole('link', { name: "What DevControl can and can't do →" })).toBeInTheDocument()
  })

  // L-2 (PE-D2): every contact link is exactly the support address with the fixed subject, and never
  // carries the account ID, the role ARN or the External ID, in the setup, connected and 409 states.
  describe('every contact link is exactly the support mailto, with no account data', () => {
    const EXPECTED_MAILTO = 'mailto:support@getdevcontrol.com?subject=AWS%20connection'

    function expectContactLinks(minimum: number) {
      const links = [...document.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute('href') ?? '')
      expect(links.length).toBeGreaterThanOrEqual(minimum)
      for (const href of links) {
        expect(href).toBe(EXPECTED_MAILTO)
        const decoded = decodeURIComponent(href)
        for (const secret of ['123456789012', 'arn:aws', 'DevControlRole', 'ext-123', PLATFORM]) expect(decoded).not.toContain(secret)
      }
    }

    it('the constant is the literal', () => {
      expect(SUPPORT_MAILTO).toBe(EXPECTED_MAILTO)
    })

    it('setup: Need help?, board 7 data and disconnect links', async () => {
      renderPage()
      await screen.findByTestId('external-id-field')
      expectContactLinks(3)
    })

    it('connected: board 4 and board 7 links', async () => {
      mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
      renderPage()
      await screen.findByTestId('coverage-headline')
      expectContactLinks(4)
    })

    it('after a 409 ALREADY_CONNECTED, with the ARN typed in', async () => {
      mockConnect.mockRejectedValue({ response: { status: 409, data: { code: 'ALREADY_CONNECTED', message: 'x' } } })
      renderPage()
      fireEvent.click(await fillValidRoleArnAndGetButton())
      await screen.findByTestId('connect-error')
      expectContactLinks(4)
    })
  })
})

// Step 2 asks for SecurityAudit, ViewOnlyAccess and the inline policy from
// lib/aws/customer-role-inline-policy.json, the file the backend's IAM coverage
// test checks, instead of ReadOnlyAccess.
describe('Connect AWS page: customer role permissions', () => {
  const inlinePolicyFile = readFileSync(join(process.cwd(), 'lib/aws/customer-role-inline-policy.json'), 'utf-8')
  const denyCount = (JSON.parse(inlinePolicyFile).Statement as { Effect: string; Action: string[] }[])
    .filter((s) => s.Effect === 'Deny').reduce((n, s) => n + s.Action.length, 0)

  it('names the two managed policies and the inline policy, and asks for ReadOnlyAccess only in notes', async () => {
    const { container } = renderPage()
    await screen.findByTestId('external-id-field')
    const step = screen.getByRole('heading', { level: 2, name: 'Attach the permissions' }).parentElement as HTMLElement
    const items = [...step.querySelectorAll('ol > li')].map((li) => li.textContent ?? '')
    expect(items).toEqual([
      'The AWS managed policy SecurityAudit.',
      'The AWS managed policy ViewOnlyAccess (job-function/ViewOnlyAccess).',
      expect.stringMatching(/^An inline policy named DevControlReadExtras with the JSON below\./),
    ])
    // ReadOnlyAccess: the note for roles connected before (twice) and board 7's scope line (once).
    expect((container.textContent ?? '').match(/ReadOnlyAccess/g) ?? []).toHaveLength(3)
    expect(screen.getByText(/^Already connected with ReadOnlyAccess\?/).textContent).toBe(
      'Already connected with ReadOnlyAccess? It keeps working. To narrow it, attach the three policies above first, then detach ReadOnlyAccess.'
    )
    expect(screen.getByText(/^These policies let DevControl read/).textContent).toBe(
      'These policies let DevControl read configuration and metadata. They do not let it read the contents of your S3 objects or DynamoDB items, and they grant no write access.'
    )
    expect(screen.getByText(/actions is in the JSON above\.$/).textContent).toBe(`The full list of ${denyCount} actions is in the JSON above.`)
  })

  it('shows the inline policy file exactly, with the account placeholder and how to fill it in', async () => {
    renderPage()
    await screen.findByTestId('external-id-field')
    expect(screen.getByTestId('inline-policy').textContent).toBe(inlinePolicyFile.trimEnd())
    expect(screen.getByTestId('inline-policy').textContent).toContain('arn:aws:resource-explorer-2:*:<ACCOUNT_ID>:view/*')
    expect(screen.getByText(/with your 12-digit AWS account ID\.$/).textContent).toBe(
      'Replace <ACCOUNT_ID> with your 12-digit AWS account ID.'
    )
  })

  it('copies the inline policy JSON', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    await screen.findByTestId('external-id-field')
    fireEvent.click(screen.getByRole('button', { name: 'Copy inline policy →' }))
    expect(writeText).toHaveBeenCalledWith(inlinePolicyFile.trimEnd())
    expect(await screen.findByRole('button', { name: '✓ Copied!' })).toBeInTheDocument()
  })
})

describe('Connect AWS page: fix text per action', () => {
  it.each([
    ['ce:GetCostAndUsage', 'denied', "To fix: this permission comes from the DevControlReadExtras inline policy. Check that it's attached and that its JSON matches the policy on this page."],
    ['resource-explorer-2:Search', 'denied', "To fix: this permission comes from the DevControlReadExtras inline policy. Check that it's attached and that its JSON matches the policy on this page."],
    ['ce:GetCostAndUsage', 'not_verified', "To check: this permission comes from DevControlReadExtras. Check that it's attached."],
    ['resource-explorer-2:Search', 'not_verified', 'To check: this permission comes from DevControlReadExtras. If it is attached, Resource Explorer may not be set up in this account.'],
    ...['ec2:DescribeRegions', 's3:ListAllMyBuckets', 'lambda:ListFunctions', 'cloudwatch:GetMetricData'].flatMap((action) => [
      [action, 'denied', "To fix: SecurityAudit and ViewOnlyAccess both allow this. Check that they're attached to the role."],
      [action, 'not_verified', "To check: SecurityAudit and ViewOnlyAccess both allow this. Check that they're attached to the role."],
    ]),
  ] as [string, 'denied' | 'not_verified', string][])('%s %s', (action, status, text) => {
    expect(permissionFixText(action, status)).toBe(text)
  })
})

// The app type scale (typography plan, T1): the page's text uses only the app role tokens, its title is the
// shared PageHeader, and its top spacing is the app page-top token.
describe('Connect AWS page: app type scale', () => {
  const classTokens = (container: HTMLElement) =>
    [...container.querySelectorAll('[class]')].flatMap((node) => (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean))

  it('one h1 from PageHeader: the 28px title role, with the subtitle role under it', async () => {
    renderPage()
    await screen.findByTestId('external-id-field')
    const h1 = screen.getByRole('heading', { level: 1, name: 'Connect your AWS account' })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(h1.closest('[data-slot="page-header"]')).not.toBeNull()
    expect(h1.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-title', 'text-ink']))
    expect(screen.getByText(PAGE_SUBTITLE).className).toContain('text-subtitle')
    for (const h2 of screen.getAllByRole('heading', { level: 2 })) expect(h2.className).toContain('text-section')
  })

  it('top spacing is pt-page-top and nothing else sets the top padding', () => {
    const { container } = renderPage()
    const root = container.firstElementChild as HTMLElement
    const classes = root.className.split(/\s+/)
    expect(classes).toContain('pt-page-top')
    expect(classes.filter((c) => /^(?:[\w-]+:)?(?:p|py|pt)-/.test(c) && c !== 'pt-page-top')).toEqual([])
  })

  it('every size comes from the role tokens, in the setup and the connected view', async () => {
    const { container, unmount } = renderPage()
    await screen.findByText(/"Version"/)
    const input = screen.getByPlaceholderText(/arn:aws:iam/i)
    fireEvent.change(input, { target: { value: 'arn:aws:iam::123456789012:role/Other' } })
    expect(screen.getByText(/Expected format/).className).toContain('text-ink-warning')
    fireEvent.change(input, { target: { value: 'arn:aws:iam::123456789012:role/DevControlRole' } })
    expect(screen.getByText(/Valid ARN format/).className).toContain('text-ink-success')
    const check = (tokens: string[]) => {
      expect(tokens.filter((c) => /^(?:[\w-]+:)?text-(?:xs|sm|base|lg|xl|\dxl|\[\d[^\]]*\])$/.test(c))).toEqual([])
      expect(tokens.filter((c) => /^(?:[\w-]+:)?font-(?:bold|extrabold|black)$/.test(c))).toEqual([])
    }
    const tokens = classTokens(container)
    check(tokens)
    const roles = new Set(tokens.filter((c) => /^text-(?:title|subtitle|section|card-title|body|ui|meta|label|kpi)$/.test(c)))
    expect([...roles].sort()).toEqual(['text-body', 'text-label', 'text-meta', 'text-section', 'text-subtitle', 'text-title', 'text-ui'])
    unmount()

    mockGetAccountsAndConnection.mockResolvedValue(CONNECTED)
    const connected = renderPage()
    await screen.findByTestId('coverage-headline')
    check(classTokens(connected.container))
  })
})
