/**
 * /settings/integrations/github (D8b-1): every state of boards 2-4 and 6 and
 * board 5's header, summary card and disconnect row, through the real service
 * code with the HTTP client stubbed.
 *
 * Security: who may connect or disconnect comes from the server's can_manage;
 * members and the demo workspace never send a change; the claim is run once,
 * with the state this tab started, and fails closed when the echoed state
 * differs; the callback values are single use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GitHubIntegrationPage from '../page'
import { GITHUB_INSTALL_START_KEY, GITHUB_PARKED_CALLBACK_KEY, parkCallback, saveInstallStart } from '@/lib/github-connection/pending-claim'

vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
const goToGitHub = vi.fn()
vi.mock('@/lib/github-connection/navigate', () => ({ goToGitHub: (url: string) => goToGitHub(url) }))

const mockGet = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}))

const STATE = 'T'.repeat(43)
const CODE = 'plantedCode0123456789'
const NOW = Date.parse('2026-11-24T10:04:00Z')

const INSTALLATION = {
  installation_id: '42', account_login: 'acme-inc', account_type: 'Organization', repository_selection: 'selected',
  permissions_state: 'expected', permission_differences: [], claimed_at: '2026-11-24T10:00:00.000Z', claimed_by_name: 'Sam Rivera',
  suspended_at: null, deleted_at: null,
}
type Conn = Record<string, unknown>
let connectionBody: Conn
let repositories: unknown[]

const on = (over: Conn = {}): Conn => ({ configured: true, can_manage: true, demo: false, installations: [], last_event_at: null, ...over })
const reply = (status: number, data: unknown) => Promise.resolve({ status, data })

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  connectionBody = on()
  repositories = []
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/integrations/github') return Promise.resolve({ status: 200, data: { success: true, data: connectionBody } })
    if (url === '/api/integrations/github/repositories') return Promise.resolve({ status: 200, data: { success: true, data: { repositories } } })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
  mockPost.mockRejectedValue(new Error('unexpected POST'))
  mockDelete.mockRejectedValue(new Error('unexpected DELETE'))
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><GitHubIntegrationPage /></QueryClientProvider>)
}

const posts = (url: string) => mockPost.mock.calls.filter(([u]) => u === url)

describe('loading, failure, switched off, demo', () => {
  it('loading: grey blocks only, no button and no "not connected" text', () => {
    mockGet.mockImplementation(() => new Promise(() => undefined))
    renderPage()
    expect(screen.getByTestId('github-loading')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(document.body.textContent).not.toMatch(/Connect GitHub|Not connected/)
  })

  it('GET failed: says so, never "not connected"', async () => {
    mockGet.mockRejectedValue(new Error('down'))
    renderPage()
    expect(await screen.findByTestId('github-load-failed')).toHaveTextContent("Couldn't load the GitHub connection.")
    expect(screen.queryByText('Connect GitHub')).toBeNull()
  })

  it('switched off (board 2): no Connect anywhere, the hand-record link, any parked callback dropped unused', async () => {
    connectionBody = { configured: false }
    parkCallback({ code: CODE, installation_id: '42', state: STATE })
    renderPage()
    expect(await screen.findByText("The GitHub connection isn't available yet")).toBeInTheDocument()
    expect(screen.getByText('Record deployments from GitHub Actions.')).toBeInTheDocument()
    expect(screen.getByText('Until it is, you can record deployments by hand. They count toward Deployment History and Engineering Intelligence the same way.')).toBeInTheDocument()
    expect(screen.getByTestId('github-off-record')).toHaveAttribute('href', '/deployments/new')
    expect(screen.queryByText('Connect GitHub')).toBeNull()
    expect(mockPost).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(GITHUB_PARKED_CALLBACK_KEY)).toBeNull()
  })

  it('demo workspace (Q9): the fixed sample, every control disabled, no request but GET / (not even repositories)', async () => {
    connectionBody = on({ demo: true, can_manage: false })
    parkCallback({ code: CODE, installation_id: '42', state: STATE })
    renderPage()
    expect(await screen.findByTestId('github-demo')).toHaveTextContent('Demo dataA sample of the connected screen. Nothing here can be changed.')
    expect(screen.getByTestId('github-disconnect')).toBeDisabled()
    expect(screen.getByTestId('github-manage')).toBeDisabled()
    fireEvent.click(screen.getByTestId('github-disconnect'))
    expect(screen.queryByTestId('github-disconnect-dialog')).toBeNull()
    expect(mockGet.mock.calls.map(([u]) => u)).toEqual(['/api/integrations/github'])
    expect(mockPost).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })
})

describe('not connected (board 3)', () => {
  it('owner/admin: the three steps, Connect GitHub, what it reads, plan limits', async () => {
    renderPage()
    expect(await screen.findByText('Connect GitHub in three steps')).toBeInTheDocument()
    for (const text of [
      'Install DevControl Deployments on GitHub', 'Choose all repositories or only the ones you want.',
      'Come back here', 'GitHub sends you back to DevControl to finish connecting.',
      'Pick a service and a deploy rule for each repository', 'Nothing is recorded for a repository until you do.',
      'Only owners and admins of this workspace can connect.',
      'What DevControl can read', 'Read-only access to Actions, Deployments, Pull requests and repository metadata.',
      "What it can't", "Your code, secrets or settings. It can't change anything on GitHub.",
      'Plan limits', "Deployments from GitHub count toward your plan's monthly deployment limit, together with any you record by hand. Deployments over the limit aren't recorded.",
    ]) expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.getByTestId('github-connect')).toHaveTextContent('Connect GitHub')
  })

  it('a member: the ask-an-owner row, no button at all, even if the token says owner', async () => {
    connectionBody = on({ can_manage: false })
    renderPage()
    expect(await screen.findByTestId('github-member-row')).toHaveTextContent('Ask an owner or admin of this workspace to connect GitHub.')
    expect(screen.queryByTestId('github-connect')).toBeNull()
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('Connect GitHub: POST /install, the state kept for this tab, then GitHub in the same tab', async () => {
    const url = `https://github.com/apps/devcontrol-deployments/installations/new?state=${STATE}`
    mockPost.mockImplementation((u: string) => u === '/api/integrations/github/install'
      ? reply(200, { success: true, data: { install_url: url, state: STATE, expires_in_minutes: 15 } })
      : Promise.reject(new Error(u)))
    renderPage()
    fireEvent.click(await screen.findByTestId('github-connect'))
    await waitFor(() => expect(goToGitHub).toHaveBeenCalledWith(url))
    expect(JSON.parse(sessionStorage.getItem(GITHUB_INSTALL_START_KEY) ?? '{}')).toMatchObject({ state: STATE, organizationId: 'org-1' })
    expect(localStorage.length).toBe(0)
  })

  it('an install link that is not GitHub\'s is never followed', async () => {
    mockPost.mockImplementation(() => reply(200, { success: true, data: { install_url: `https://evil.example/apps/x/installations/new?state=${STATE}`, state: STATE } }))
    renderPage()
    fireEvent.click(await screen.findByTestId('github-connect'))
    expect(await screen.findByTestId('github-install-failed')).toBeInTheDocument()
    expect(goToGitHub).not.toHaveBeenCalled()
  })

  it('POST /install refused for the role -> "Only owners and admins can connect GitHub"', async () => {
    mockPost.mockImplementation(() => reply(403, { success: false, error: 'Insufficient permissions' }))
    renderPage()
    fireEvent.click(await screen.findByTestId('github-connect'))
    expect(await screen.findByText('Only owners and admins can connect GitHub')).toBeInTheDocument()
    expect(goToGitHub).not.toHaveBeenCalled()
  })
})

describe('the claim (board 4)', () => {
  /** Values parked by the callback: `state` null = GitHub echoed none; `startState` null = this tab saved none. */
  function parked(state: string | null = STATE, startState: string | null = STATE) {
    if (startState) saveInstallStart(startState, 'org-1')
    parkCallback({ code: CODE, installation_id: '42', setup_action: 'install', ...(state ? { state } : {}) })
  }
  const claimWith = (status: number, data: unknown) => mockPost.mockImplementation((u: string) =>
    u === '/api/integrations/github/claim' ? reply(status, data) : Promise.reject(new Error(u)))

  it('success: one POST /claim with the parked values, then the connected screen with the banner; the values are single use', async () => {
    parked()
    mockPost.mockImplementation((u: string) => {
      if (u !== '/api/integrations/github/claim') return Promise.reject(new Error(u))
      connectionBody = on({ installations: [INSTALLATION] })
      return reply(200, { success: true, data: { status: 'connected', installation: { account_login: 'acme-inc' }, repositories: 4, released_events: 0 } })
    })
    renderPage()
    const banner = await screen.findByTestId('github-connected-banner')
    expect(banner).toHaveTextContent('GitHub connected')
    expect(banner).toHaveTextContent('DevControl Deployments is installed on acme-inc. Pick a service for each repository to start recording deployments.')
    expect(posts('/api/integrations/github/claim')).toHaveLength(1)
    expect(posts('/api/integrations/github/claim')[0][1]).toEqual({ state: STATE, code: CODE, installation_id: '42', setup_action: 'install' })
    expect(sessionStorage.length).toBe(0)
    await screen.findByTestId('github-summary')
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('github-connected-banner')).toBeNull()
  })

  it('no state echoed by GitHub: the one this tab saved at Connect is used (V1)', async () => {
    parked(null, STATE)
    claimWith(200, { success: true, data: { status: 'already_connected' } })
    renderPage()
    await waitFor(() => expect(posts('/api/integrations/github/claim')).toHaveLength(1))
    expect(posts('/api/integrations/github/claim')[0][1]).toMatchObject({ state: STATE })
  })

  it('the echoed state differs from the one this tab started: "expired", and no claim is sent (fails closed)', async () => {
    parked('U'.repeat(43), STATE)
    renderPage()
    expect(await screen.findByText('This connection link has expired')).toBeInTheDocument()
    expect(screen.getByText("Start again from DevControl. The app stays installed on GitHub, so you won't need to reinstall it.")).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('no state at all: "expired", no claim', async () => {
    parked(null, null)
    renderPage()
    expect(await screen.findByText('This connection link has expired')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('a member with parked values: "Only owners and admins can connect GitHub", no claim', async () => {
    connectionBody = on({ can_manage: false })
    parked()
    renderPage()
    expect(await screen.findByText('Only owners and admins can connect GitHub')).toBeInTheDocument()
    expect(screen.getByText('Ask an owner or admin of this DevControl workspace to finish the connection.')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it.each([
    [400, { success: false, error: 'invalid_state' }, 'This connection link has expired', "Start again from DevControl. The app stays installed on GitHub, so you won't need to reinstall it."],
    [409, { success: false, error: 'installation_claimed_elsewhere' }, 'This installation belongs to another DevControl workspace', 'Disconnect it in that workspace first, or install DevControl Deployments on a different GitHub account or organization.'],
    [403, { success: false, error: 'not_installer' }, "We couldn't confirm who installed the app", 'To connect, the person who installs DevControl Deployments on GitHub has to be the one who finishes here. Start again, signed in to GitHub as that person.'],
    [200, { success: true, data: { status: 'pending_github_approval' } }, 'Waiting for an owner of the GitHub organization', "Your request to install DevControl Deployments went to the organization's owners. Once one of them approves it, they need to connect it from this page while signed in to DevControl."],
    [403, { success: false, error: 'Insufficient permissions' }, 'Only owners and admins can connect GitHub', 'Ask an owner or admin of this DevControl workspace to finish the connection.'],
    [502, { success: false, error: 'github_unavailable' }, "We couldn't finish connecting", "GitHub didn't respond in time. Nothing was changed."],
    [409, { success: false, error: 'install_event_not_received', message: "We didn't receive the install event from GitHub. Uninstall the DevControl app from your GitHub settings, reinstall it, then try again." }, "We couldn't finish connecting", "We didn't receive the install event from GitHub. Uninstall the DevControl app from your GitHub settings, reinstall it, then try again."],
  ])('%i %j -> "%s"', async (status, body, title, text) => {
    parked()
    claimWith(status, body)
    renderPage()
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByText(text)).toBeInTheDocument()
    expect(posts('/api/integrations/github/claim')).toHaveLength(1)
  })

  // D8b-1 fix round, founder copy: the four cards that end with the outlined Connect GitHub (owners and admins only).
  const FOUNDER_CARDS = [
    [400, { success: false, error: 'missing_code_or_installation' }, 'github-claim-cancelled', "GitHub didn't finish connecting", "The GitHub step was cancelled or didn't complete. Start again from DevControl."],
    [400, { success: false, error: 'invalid_request' }, 'github-claim-cancelled', "GitHub didn't finish connecting", "The GitHub step was cancelled or didn't complete. Start again from DevControl."],
    [403, { success: false, error: 'installation_not_accessible' }, 'github-claim-not-accessible', "DevControl can't reach this installation", 'The app may have been uninstalled, suspended or installed on a different account. Check it on GitHub, then start again.'],
    [403, { success: false, error: 'github_authorization_failed' }, 'github-claim-auth-failed', "GitHub didn't confirm your sign-in", 'GitHub declined the sign-in step. Start again and approve access when GitHub asks.'],
    [500, { success: false, error: 'Internal server error' }, 'github-claim-failed', "We couldn't finish connecting", 'Something went wrong on our side. Try connecting again in a few minutes.'],
    [400, { success: false, error: 'something_new' }, 'github-claim-failed', "We couldn't finish connecting", 'Something went wrong on our side. Try connecting again in a few minutes.'],
  ] as const

  it.each(FOUNDER_CARDS)('%i %j -> %s: heading, body word for word, outlined Connect GitHub', async (status, body, testId, title, text) => {
    parked()
    claimWith(status, body)
    renderPage()
    const card = await screen.findByTestId(testId)
    expect(within(card).getByText(title)).toBeInTheDocument()
    expect(within(card).getByText(text)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Connect GitHub' })).toBe(screen.getByTestId('github-outcome-connect'))
    expect(posts('/api/integrations/github/claim')).toHaveLength(1)
  })

  it('a network error on the claim: the fallback card with its body', async () => {
    parked()
    mockPost.mockImplementation(() => Promise.reject(new Error('network down')))
    renderPage()
    const card = await screen.findByTestId('github-claim-failed')
    expect(card).toHaveTextContent("We couldn't finish connectingSomething went wrong on our side. Try connecting again in a few minutes.")
  })

  it('the four founder cards show no Connect GitHub when the server says the user may not manage', async () => {
    const { ClaimOutcomeCard } = await import('../_components/NotConnected')
    for (const kind of ['cancelled', 'not_accessible', 'github_auth_failed', 'failed'] as const) {
      const { unmount } = render(<ClaimOutcomeCard outcome={{ kind }} canManage={false} onConnect={() => undefined} onTryAgain={() => undefined} starting={false} />)
      expect(screen.queryByRole('button', { name: 'Connect GitHub' })).toBeNull()
      unmount()
      const managed = render(<ClaimOutcomeCard outcome={{ kind }} canManage onConnect={() => undefined} onTryAgain={() => undefined} starting={false} />)
      expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
      managed.unmount()
    }
  })

  it('Connect was started in another workspace (N-3): "expired", and no claim is sent', async () => {
    saveInstallStart(STATE, 'org-other')
    parkCallback({ code: CODE, installation_id: '42', setup_action: 'install', state: STATE })
    renderPage()
    expect(await screen.findByText('This connection link has expired')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
    expect(sessionStorage.length).toBe(0)
  })

  it('202 waiting: "Finishing…", POST /claim/retry every 3 s with the state, until it connects', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    parked()
    let retries = 0
    mockPost.mockImplementation((u: string, body: unknown) => {
      if (u === '/api/integrations/github/claim') return reply(202, { success: true, data: { status: 'waiting_for_github' } })
      if (u === '/api/integrations/github/claim/retry') {
        expect(body).toEqual({ state: STATE })
        retries += 1
        if (retries < 2) return reply(202, { success: true, data: { status: 'waiting_for_github' } })
        connectionBody = on({ installations: [INSTALLATION] })
        return reply(200, { success: true, data: { status: 'connected', installation: { account_login: 'acme-inc' } } })
      }
      return Promise.reject(new Error(u))
    })
    renderPage()
    expect(await screen.findByText('Finishing your GitHub connection…')).toBeInTheDocument()
    expect(screen.getByText('This usually takes a few seconds.')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(await screen.findByTestId('github-connected-banner')).toBeInTheDocument()
    expect(posts('/api/integrations/github/claim/retry')).toHaveLength(2)
  })

  it('a 502 after waiting: Try again goes through /claim/retry with the same state (RC-O2)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    parked()
    let retried = 0
    mockPost.mockImplementation((u: string) => {
      if (u === '/api/integrations/github/claim') return reply(202, { success: true, data: { status: 'waiting_for_github' } })
      retried += 1
      if (retried === 1) return reply(502, { success: false, error: 'github_unavailable' })
      connectionBody = on({ installations: [INSTALLATION] })
      return reply(200, { success: true, data: { status: 'connected', installation: { account_login: 'acme-inc' } } })
    })
    renderPage()
    await screen.findByText('Finishing your GitHub connection…')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    fireEvent.click(await screen.findByTestId('github-claim-try-again'))
    expect(await screen.findByTestId('github-connected-banner')).toBeInTheDocument()
    expect(posts('/api/integrations/github/claim/retry').map(([, b]) => b)).toEqual([{ state: STATE }, { state: STATE }])
  })

  it('a 502 on the first claim spent the state: Try again answers "expired" without a request', async () => {
    parked()
    claimWith(502, { success: false, error: 'github_unavailable' })
    renderPage()
    fireEvent.click(await screen.findByTestId('github-claim-try-again'))
    expect(await screen.findByText('This connection link has expired')).toBeInTheDocument()
    expect(posts('/api/integrations/github/claim/retry')).toHaveLength(0)
  })

  it('a server that keeps answering 202: the client itself stops after 10 retries (never an 11th)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    parked()
    mockPost.mockImplementation(() => reply(202, { success: true, data: { status: 'waiting_for_github' } }))
    renderPage()
    await screen.findByText('Finishing your GitHub connection…')
    for (let i = 0; i < 15; i++) await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(posts('/api/integrations/github/claim/retry')).toHaveLength(10)
    expect(await screen.findByText("GitHub didn't respond in time. Nothing was changed.")).toBeInTheDocument()
  })

  it('polling stops at the server\'s 10 retries; a 409 install_event_not_received ends it with the API\'s message', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    parked()
    let retries = 0
    mockPost.mockImplementation((u: string) => {
      if (u === '/api/integrations/github/claim') return reply(202, { success: true, data: { status: 'waiting_for_github' } })
      retries += 1
      return retries < 10
        ? reply(202, { success: true, data: { status: 'waiting_for_github' } })
        : reply(409, { success: false, error: 'install_event_not_received', message: 'Reinstall, then try again.' })
    })
    renderPage()
    await screen.findByText('Finishing your GitHub connection…')
    for (let i = 0; i < 12; i++) await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(await screen.findByText('Reinstall, then try again.')).toBeInTheDocument()
    expect(posts('/api/integrations/github/claim/retry')).toHaveLength(10)
  })
})

describe('connected (board 5 header, summary, disconnect; board 6 banners)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
  })

  it('header with "Manage on GitHub ↗", the summary card, the plan-limit sentence', async () => {
    connectionBody = on({ installations: [INSTALLATION], last_event_at: '2026-11-24T10:00:00.000Z' })
    renderPage()
    const summary = await screen.findByTestId('github-summary')
    expect(within(summary).getByTestId('github-summary-chip')).toHaveTextContent('Connected')
    for (const text of ['acme-inc', 'GitHub organization', 'Permissions: read-only, as expected', 'Last event from GitHub: 4 minutes ago', 'Connected by Sam R. on Nov 24']) {
      expect(within(summary).getByText(text)).toBeInTheDocument()
    }
    const manage = screen.getByTestId('github-manage')
    expect(manage).toHaveTextContent('Manage on GitHub ↗')
    expect(manage).toHaveAttribute('href', 'https://github.com/organizations/acme-inc/settings/installations/42')
    expect(manage).toHaveAttribute('target', '_blank')
    expect(manage).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByTestId('github-plan-limit')).toHaveTextContent("Deployments over your plan's monthly limit aren't recorded.")
    expect(screen.getByTestId('github-disconnect-row')).toHaveTextContent('Disconnect GitHubStops recording. Your repositories, services, rules and past deployments are kept.Disconnect')
  })

  it('permissions mismatch: the banner names the actual differences; the chip says Needs attention', async () => {
    connectionBody = on({ installations: [{ ...INSTALLATION, permissions_state: 'mismatch', permission_differences: [{ permission: 'contents', granted: 'read', expected: null }] }] })
    renderPage()
    const banner = await screen.findByTestId('github-banner-mismatch')
    expect(banner).toHaveTextContent("GitHub permissions don't match what DevControl expects")
    expect(banner).toHaveTextContent("On GitHub the app now has: Contents (read). Expected: Actions, Deployments, Pull requests and Metadata, read-only. Review the app's permissions on GitHub.")
    expect(within(banner).getByText('Review on GitHub ↗')).toHaveAttribute('href', 'https://github.com/organizations/acme-inc/settings/installations/42')
    expect(screen.getByTestId('github-summary-chip')).toHaveTextContent('Needs attention')
  })

  it('suspended: the ruled sentence and "Unsuspend on GitHub ↗"', async () => {
    connectionBody = on({ installations: [{ ...INSTALLATION, suspended_at: '2026-11-24T09:00:00Z' }] })
    renderPage()
    const banner = await screen.findByTestId('github-banner-suspended')
    expect(banner).toHaveTextContent('The app is suspended on GitHub')
    expect(banner).toHaveTextContent("GitHub doesn't send events while the app is suspended, so deploys that finish in that time aren't recorded and won't be added later. You can record them by hand on the Deployments page.")
    expect(within(banner).getByText('Unsuspend on GitHub ↗')).toBeInTheDocument()
  })

  it('uninstalled: the red banner with Connect GitHub (owners and admins only); no "Manage on GitHub"', async () => {
    connectionBody = on({ installations: [{ ...INSTALLATION, deleted_at: '2026-11-24T09:00:00Z' }] })
    renderPage()
    const banner = await screen.findByTestId('github-banner-uninstalled')
    expect(banner).toHaveTextContent('DevControl Deployments was uninstalled from acme-inc')
    expect(banner).toHaveTextContent('Nothing is being recorded. Your repositories, services and past deployments are kept. Connect again to pick up where you left off.')
    expect(within(banner).getByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
    expect(screen.queryByTestId('github-manage')).toBeNull()
  })

  it('uninstalled, seen by a member (N-5): the banner without Connect GitHub', async () => {
    connectionBody = on({ can_manage: false, installations: [{ ...INSTALLATION, deleted_at: '2026-11-24T09:00:00Z' }] })
    renderPage()
    const banner = await screen.findByTestId('github-banner-uninstalled')
    expect(banner).toHaveTextContent('DevControl Deployments was uninstalled from acme-inc')
    expect(within(banner).queryByRole('button', { name: 'Connect GitHub' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect GitHub' })).toBeNull()
  })

  it('a repository removed on GitHub: its greyed row; repositories of a disconnected installation are not shown', async () => {
    connectionBody = on({ installations: [INSTALLATION] })
    repositories = [
      { id: 'r1', github_repo_id: '1', installation_id: '42', full_name: 'acme-inc/legacy-billing', service_id: null, service_name: null, deploy_rule: null, access_state: 'removed', removed_at: '2026-11-20T00:00:00Z', last_event_at: null },
      { id: 'r2', github_repo_id: '2', installation_id: null, full_name: 'acme-inc/old-detached', service_id: null, service_name: null, deploy_rule: null, access_state: 'removed', removed_at: '2026-11-20T00:00:00Z', last_event_at: null },
      { id: 'r3', github_repo_id: '3', installation_id: '42', full_name: 'acme-inc/payments-api', service_id: null, service_name: null, deploy_rule: null, access_state: 'active', removed_at: null, last_event_at: null },
    ]
    renderPage()
    const list = await screen.findByTestId('github-removed-repositories')
    expect(list).toHaveTextContent('acme-inc/legacy-billingRemoved from the app on GitHub · past deployments kept · nothing new is recorded')
    expect(list).not.toHaveTextContent('old-detached')
    expect(list).not.toHaveTextContent('payments-api')
  })

  it('a member: no disconnect row, no change request possible', async () => {
    connectionBody = on({ can_manage: false, installations: [INSTALLATION] })
    renderPage()
    await screen.findByTestId('github-summary')
    expect(screen.queryByTestId('github-disconnect-row')).toBeNull()
    expect(screen.queryByTestId('github-disconnect')).toBeNull()
  })

  it('disconnect: the dialog word for word with "Uninstall on GitHub ↗"; Cancel sends nothing; Disconnect sends one DELETE and the page refetches', async () => {
    connectionBody = on({ installations: [INSTALLATION] })
    mockDelete.mockImplementation((u: string) => {
      connectionBody = on({ installations: [] })
      return u === '/api/integrations/github/installations/42' ? reply(200, { success: true, data: { disconnected: true, repositories: 4 } }) : Promise.reject(new Error(u))
    })
    renderPage()
    fireEvent.click(await screen.findByTestId('github-disconnect'))
    const dialog = await screen.findByTestId('github-disconnect-dialog')
    expect(within(dialog).getByText('Disconnect GitHub?')).toBeInTheDocument()
    expect(within(dialog).getByText('DevControl stops recording deployments from acme-inc. Your repositories, services, deploy rules and past deployments are kept, and connecting again picks them back up.')).toBeInTheDocument()
    expect(within(dialog).getByText('The app stays installed on GitHub until you uninstall it there.')).toBeInTheDocument()
    expect(within(dialog).getByTestId('github-uninstall-link')).toHaveTextContent('Uninstall on GitHub ↗')
    expect(within(dialog).getByTestId('github-uninstall-link')).toHaveAttribute('href', 'https://github.com/organizations/acme-inc/settings/installations/42')
    fireEvent.click(within(dialog).getByTestId('github-disconnect-cancel'))
    await waitFor(() => expect(screen.queryByTestId('github-disconnect-dialog')).toBeNull())
    expect(mockDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('github-disconnect'))
    fireEvent.click(within(await screen.findByTestId('github-disconnect-dialog')).getByTestId('github-disconnect-confirm'))
    expect(await screen.findByText('Connect GitHub in three steps')).toBeInTheDocument()
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  it('disconnect refused (409 try_again): the dialog stays open and says so', async () => {
    connectionBody = on({ installations: [INSTALLATION] })
    mockDelete.mockImplementation(() => reply(409, { success: false, error: 'try_again' }))
    renderPage()
    fireEvent.click(await screen.findByTestId('github-disconnect'))
    fireEvent.click(within(await screen.findByTestId('github-disconnect-dialog')).getByTestId('github-disconnect-confirm'))
    expect(await screen.findByTestId('github-disconnect-failed')).toHaveTextContent("Couldn't disconnect. Try again.")
    expect(screen.getByTestId('github-disconnect-dialog')).toBeInTheDocument()
  })
})
