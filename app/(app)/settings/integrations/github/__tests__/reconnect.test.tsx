/**
 * I3 Reconnect on /settings/integrations/github (founder D1-D10), through the
 * real service code with the HTTP client stubbed.
 *
 * Security: the tab follows only GitHub's exact authorize URL; the claim is
 * sent once, only for a reconnect this tab started in this workspace, with
 * GitHub's echoed state equal to the stored one (required), the stored
 * installation id and the PKCE verifier. GitHub's error sends nothing.
 * Members, the demo workspace and the switched-off feature never send one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GitHubIntegrationPage from '../page'
import { GITHUB_INSTALL_START_KEY, parkCallback, saveInstallStart, saveReconnectStart } from '@/lib/github-connection/pending-claim'

vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
const goToGitHub = vi.fn()
vi.mock('@/lib/github-connection/navigate', () => ({ goToGitHub: (url: string) => goToGitHub(url) }))

const mockGet = vi.fn()
const mockPost = vi.fn()
vi.mock('@/lib/api', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: () => Promise.reject(new Error('unexpected DELETE')),
  },
}))

const STATE = 'T'.repeat(43)
const VERIFIER = 'V'.repeat(43)
const CHALLENGE = 'C'.repeat(43)
const CODE = 'plantedReconnectCode0123'
const CALLBACK = 'https%3A%2F%2Fgetdevcontrol.com%2Fauth%2Fgithub%2Fcallback'
const authorizeUrl = (over: { host?: string; path?: string; redirect?: string; state?: string; extra?: string } = {}) =>
  `https://${over.host ?? 'github.com'}${over.path ?? '/login/oauth/authorize'}?client_id=Iv1.abc123&redirect_uri=${over.redirect ?? CALLBACK}`
  + `&state=${over.state ?? STATE}&code_challenge=${CHALLENGE}&code_challenge_method=S256&prompt=select_account${over.extra ?? ''}`

const PREVIOUS = { installation_id: '42', account_login: 'acme-inc', account_type: 'Organization' }
const INSTALLATION = {
  installation_id: '42', account_login: 'acme-inc', account_type: 'Organization', repository_selection: 'selected',
  permissions_state: 'expected', permission_differences: [], claimed_at: '2026-11-24T10:00:00.000Z', claimed_by_name: 'Sam Rivera',
  suspended_at: null, deleted_at: null,
}
type Conn = Record<string, unknown>
let connectionBody: Conn
const on = (over: Conn = {}): Conn => ({ configured: true, can_manage: true, demo: false, installations: [], previous_installations: [PREVIOUS], last_event_at: null, ...over })
const reply = (status: number, data: unknown) => Promise.resolve({ status, data })
const posts = (url: string) => mockPost.mock.calls.filter(([u]) => u === url)
const startOk = (over: Record<string, unknown> = {}) => reply(200, {
  success: true,
  data: { authorize_url: authorizeUrl(), state: STATE, code_verifier: VERIFIER, expires_in_minutes: 15, installation_id: '42', account_login: 'acme-inc', suspended: false, ...over },
})

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  connectionBody = on()
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/integrations/github') return Promise.resolve({ status: 200, data: { success: true, data: connectionBody } })
    if (url === '/api/integrations/github/repositories') return Promise.resolve({ status: 200, data: { success: true, data: { repositories: [] } } })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
  mockPost.mockRejectedValue(new Error('unexpected POST'))
})
afterEach(() => vi.useRealTimers())

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><GitHubIntegrationPage /></QueryClientProvider>)
}

describe('which card (D1, D10)', () => {
  it('owner/admin with a previous installation: "Reconnect acme-inc", not the first-time setup; the secondary link is the install URL path', async () => {
    renderPage()
    const card = await screen.findByTestId('github-reconnect-card')
    expect(within(card).getByRole('heading', { name: 'Reconnect acme-inc' })).toBeInTheDocument()
    // Founder copy, exact: the body paragraph's whole text.
    expect(within(card).getByText('You connected acme-inc to this workspace before. Reconnect to resume recording deployments. Your repositories, services and deploy rules are kept.').tagName).toBe('P')
    expect(within(card).getByTestId('github-reconnect-button')).toHaveTextContent('Reconnect')
    expect(screen.queryByText('Connect GitHub in three steps')).toBeNull()
    expect(screen.queryByTestId('github-connect')).toBeNull()
    expect(screen.getByTestId('github-install-different')).toHaveTextContent('Install on a different GitHub account')

    const installUrl = `https://github.com/apps/devcontrol-deployments/installations/new?state=${STATE}`
    mockPost.mockImplementation((u: string) => u === '/api/integrations/github/install'
      ? reply(200, { success: true, data: { install_url: installUrl, state: STATE } }) : Promise.reject(new Error(u)))
    fireEvent.click(screen.getByTestId('github-install-different'))
    await waitFor(() => expect(goToGitHub).toHaveBeenCalledWith(installUrl))
    expect(posts('/api/integrations/github/reconnect')).toEqual([])
  })

  it('no previous installation: the first-time setup, no Reconnect card', async () => {
    connectionBody = on({ previous_installations: [] })
    renderPage()
    expect(await screen.findByText('Connect GitHub in three steps')).toBeInTheDocument()
    expect(screen.queryByTestId('github-reconnect-card')).toBeNull()
  })

  it('a member: the card with the ask-an-owner row and no button at all', async () => {
    connectionBody = on({ can_manage: false })
    renderPage()
    const card = await screen.findByTestId('github-reconnect-card')
    expect(within(card).getByTestId('github-member-row')).toHaveTextContent('Ask an owner or admin of this workspace to connect GitHub.')
    expect(screen.queryAllByRole('button')).toEqual([])
  })

  it('demo workspace and switched off: no Reconnect card, nothing sent', async () => {
    connectionBody = on({ demo: true, can_manage: false })
    const demo = renderPage()
    expect(await screen.findByTestId('github-demo')).toBeInTheDocument()
    expect(screen.queryByTestId('github-reconnect-card')).toBeNull()
    demo.unmount()
    connectionBody = { configured: false }
    renderPage()
    expect(await screen.findByTestId('github-off')).toBeInTheDocument()
    expect(screen.queryByTestId('github-reconnect-card')).toBeNull()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('connected: the connected view, never the Reconnect card', async () => {
    connectionBody = on({ installations: [INSTALLATION], previous_installations: [] })
    renderPage()
    expect(await screen.findByTestId('github-summary')).toBeInTheDocument()
    expect(screen.queryByTestId('github-reconnect-card')).toBeNull()
  })
})

describe('Reconnect: the start', () => {
  it('POST /reconnect with the installation id; state, installation id and verifier kept for this tab only; GitHub\'s authorize in the same tab', async () => {
    mockPost.mockImplementation((u: string) => (u === '/api/integrations/github/reconnect' ? startOk() : Promise.reject(new Error(u))))
    renderPage()
    fireEvent.click(await screen.findByTestId('github-reconnect-button'))
    await waitFor(() => expect(goToGitHub).toHaveBeenCalledWith(authorizeUrl()))
    expect(posts('/api/integrations/github/reconnect')[0][1]).toEqual({ installation_id: '42' })
    expect(JSON.parse(sessionStorage.getItem(GITHUB_INSTALL_START_KEY) ?? '{}')).toMatchObject({
      mode: 'reconnect', state: STATE, organizationId: 'org-1', installationId: '42', codeVerifier: VERIFIER,
    })
    expect(localStorage.length).toBe(0)
  })

  it.each([
    ['another host', { authorize_url: authorizeUrl({ host: 'evil.example' }) }],
    ['another path', { authorize_url: authorizeUrl({ path: '/login/oauth/authorize/../x' }) }],
    ['another redirect_uri', { authorize_url: authorizeUrl({ redirect: 'https%3A%2F%2Fevil.example%2Fauth%2Fgithub%2Fcallback' }) }],
    ['an extra parameter', { authorize_url: authorizeUrl({ extra: '&scope=repo' }) }],
    ['a URL state that differs from the returned one', { authorize_url: authorizeUrl({ state: 'U'.repeat(43) }) }],
    ['a malformed verifier', { code_verifier: 'short' }],
    ['another installation id', { installation_id: '43' }],
  ])('%s: never followed, nothing kept, "Couldn\'t start"', async (_label, over) => {
    mockPost.mockImplementation(() => startOk(over))
    renderPage()
    fireEvent.click(await screen.findByTestId('github-reconnect-button'))
    expect(await screen.findByTestId('github-install-failed')).toHaveTextContent("Couldn't start the GitHub connection. Try again.")
    expect(goToGitHub).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(GITHUB_INSTALL_START_KEY)).toBeNull()
  })

  it('uninstalled on GitHub (409): says so, offers Connect GitHub (the install URL), and no Reconnect card', async () => {
    mockPost.mockImplementation(() => reply(409, { success: false, error: 'installation_removed_on_github', data: { account_login: 'acme-inc' } }))
    renderPage()
    fireEvent.click(await screen.findByTestId('github-reconnect-button'))
    const card = await screen.findByTestId('github-claim-removed')
    expect(card).toHaveTextContent('DevControl Deployments is no longer installed on acme-inc. Install it again; your repository mappings come back.')
    expect(within(card).getByRole('button', { name: 'Connect GitHub' })).toBeInTheDocument()
    expect(screen.queryByTestId('github-reconnect-card')).toBeNull()
    expect(goToGitHub).not.toHaveBeenCalled()
  })
})

describe('Reconnect: back from GitHub', () => {
  /** This tab started a reconnect; GitHub sent `values` to the callback. */
  function back(values: Record<string, string>, start: { organizationId?: string } = {}) {
    saveReconnectStart({ state: STATE, organizationId: start.organizationId ?? 'org-1', installationId: '42', codeVerifier: VERIFIER })
    expect(parkCallback(values)).toBe(true)
  }
  const claimWith = (status: number, data: unknown, after?: () => void) => mockPost.mockImplementation((u: string) => {
    if (u !== '/api/integrations/github/claim') return Promise.reject(new Error(u))
    after?.()
    return reply(status, data)
  })

  it.each([[0, 'Reconnected to acme-inc.'], [1, 'Reconnected to acme-inc. 1 deployment from while you were disconnected was recorded.'],
    [3, 'Reconnected to acme-inc. 3 deployments from while you were disconnected were recorded.']])(
    'success with recorded_events %i: one claim with the stored installation id and verifier, then "%s"; single use', async (recorded, text) => {
      back({ code: CODE, state: STATE })
      claimWith(200, { success: true, data: { status: 'connected', installation: { account_login: 'acme-inc' }, released_events: 9, recorded_events: recorded } },
        () => { connectionBody = on({ installations: [INSTALLATION], previous_installations: [] }) })
      renderPage()
      const banner = await screen.findByTestId('github-connected-banner')
      expect(banner).toHaveTextContent('GitHub connected')
      // Founder copy, exact: the banner body's whole text (n = 0 has no count after it).
      expect(within(banner).getByText(text)).toBeInTheDocument()
      expect(within(banner).getByText(text).textContent).toBe(text)
      expect(posts('/api/integrations/github/claim')).toHaveLength(1)
      expect(posts('/api/integrations/github/claim')[0][1]).toEqual({ state: STATE, code: CODE, installation_id: '42', code_verifier: VERIFIER })
      expect(sessionStorage.length).toBe(0)
    })

  it('a suspended installation reconnected (D9): the suspended banner, not "recording" as healthy', async () => {
    back({ code: CODE, state: STATE })
    claimWith(200, { success: true, data: { status: 'connected', installation: { account_login: 'acme-inc' }, recorded_events: 0 } },
      () => { connectionBody = on({ installations: [{ ...INSTALLATION, suspended_at: '2026-11-20T08:30:00.000Z' }], previous_installations: [] }) })
    renderPage()
    expect(await screen.findByText('The app is suspended on GitHub')).toBeInTheDocument()
    expect(screen.getByTestId('github-summary-chip')).toHaveTextContent('Needs attention')
  })

  it.each([
    ['no echoed state', { code: CODE }],
    ['another echoed state', { code: CODE, state: 'U'.repeat(43) }],
  ])('%s: "expired", no claim (the echoed state is required and must match)', async (_label, values) => {
    back(values)
    renderPage()
    expect(await screen.findByTestId('github-claim-expired')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
    expect(screen.getByTestId('github-reconnect-card')).toBeInTheDocument()
  })

  it('started in another workspace: "expired", no claim', async () => {
    back({ code: CODE, state: STATE }, { organizationId: 'org-other' })
    renderPage()
    expect(await screen.findByTestId('github-claim-expired')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('the reconnect start expired (or this tab started none) but an authorize-shaped callback is parked: "expired", no claim', async () => {
    back({ code: CODE, state: STATE })
    const entry = JSON.parse(sessionStorage.getItem(GITHUB_INSTALL_START_KEY)!)
    sessionStorage.setItem(GITHUB_INSTALL_START_KEY, JSON.stringify({ ...entry, startedAt: Date.now() - 16 * 60_000 }))
    renderPage()
    expect(await screen.findByTestId('github-claim-expired')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('a reconnect start missing its verifier is malformed: "expired", no claim', async () => {
    back({ code: CODE, state: STATE })
    const entry = JSON.parse(sessionStorage.getItem(GITHUB_INSTALL_START_KEY)!)
    delete entry.codeVerifier
    sessionStorage.setItem(GITHUB_INSTALL_START_KEY, JSON.stringify(entry))
    renderPage()
    expect(await screen.findByTestId('github-claim-expired')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('an install-shaped callback (code + installation id) in a tab that started a reconnect: "expired", no claim', async () => {
    back({ code: CODE, installation_id: '42', setup_action: 'install', state: STATE })
    renderPage()
    expect(await screen.findByTestId('github-claim-expired')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it.each([
    ['access_denied', 'github-claim-cancelled', "GitHub didn't finish connecting", "You cancelled on GitHub. Nothing changed. Reconnect when you're ready."],
    ['redirect_uri_mismatch', 'github-claim-refused', "We couldn't finish connecting", 'GitHub refused the request. Try again later.'],
    ['application_suspended', 'github-claim-refused', "We couldn't finish connecting", 'GitHub refused the request. Try again later.'],
    ['something_else', 'github-claim-refused', "We couldn't finish connecting", 'GitHub refused the request. Try again later.'],
  ])('GitHub error %s: "%s" card, no claim, the Reconnect card below', async (error, testId, title, body) => {
    back({ error, state: STATE })
    renderPage()
    const card = await screen.findByTestId(testId)
    expect(within(card).getByText(title)).toBeInTheDocument()
    expect(within(card).getByText(body)).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
    expect(screen.getByTestId('github-reconnect-card')).toBeInTheDocument()
    // The outcome card offers no install-URL Connect of its own: Reconnect is below.
    expect(screen.queryByTestId('github-outcome-connect')).toBeNull()
  })

  it('a GitHub error with another state: "expired", not "cancelled"', async () => {
    back({ error: 'access_denied', state: 'U'.repeat(43) })
    renderPage()
    expect(await screen.findByTestId('github-claim-expired')).toBeInTheDocument()
  })

  it('a member with a parked reconnect: "Only owners and admins", no claim', async () => {
    connectionBody = on({ can_manage: false })
    back({ code: CODE, state: STATE })
    renderPage()
    expect(await screen.findByText('Only owners and admins can connect GitHub')).toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it.each([
    [403, { success: false, error: 'installation_not_accessible' }, 'github-claim-not-accessible', [
      "DevControl can't reach this installation",
      "The GitHub account you used can't see this installation. Reconnect signed in to GitHub as acme-inc or as the person who installed it."]],
    [403, { success: false, error: 'not_installer' }, 'github-claim-installer', [
      "We couldn't confirm who installed the app",
      'To connect, the person who installs DevControl Deployments on GitHub has to be the one who finishes here. Start again, signed in to GitHub as that person.',
      'If the GitHub installer has left the organization, an organization owner must uninstall DevControl Deployments from GitHub and install it again. Your repositories, services and deploy rules come back.']],
    [409, { success: false, error: 'installation_claimed_elsewhere' }, 'github-claim-elsewhere', ['This installation belongs to another DevControl workspace']],
    [502, { success: false, error: 'github_unavailable' }, 'github-claim-no-response', ["We couldn't finish connecting", "GitHub didn't respond. Reconnect again."]],
    [400, { success: false, error: 'invalid_state' }, 'github-claim-expired', ['This connection link has expired']],
    [403, { success: false, error: 'github_authorization_failed' }, 'github-claim-auth-failed', ["GitHub didn't confirm your sign-in"]],
  ] as const)('claim %i %j -> %s', async (status, body, testId, texts) => {
    back({ code: CODE, state: STATE })
    claimWith(status, body)
    renderPage()
    const card = await screen.findByTestId(testId)
    for (const text of texts) expect(within(card).getByText(text)).toBeInTheDocument()
    expect(posts('/api/integrations/github/claim')).toHaveLength(1)
    expect(screen.getByTestId('github-reconnect-card')).toBeInTheDocument()
    expect(screen.queryByTestId('github-claim-try-again')).toBeNull()
  })

  it('the first-install flow is unchanged in a tab that started an install: install-shaped claim, no verifier', async () => {
    connectionBody = on({ previous_installations: [] })
    saveInstallStart(STATE, 'org-1')
    parkCallback({ code: CODE, installation_id: '42', setup_action: 'install', state: STATE })
    claimWith(200, { success: true, data: { status: 'already_connected' } })
    renderPage()
    await waitFor(() => expect(posts('/api/integrations/github/claim')).toHaveLength(1))
    expect(posts('/api/integrations/github/claim')[0][1]).toEqual({ state: STATE, code: CODE, installation_id: '42', setup_action: 'install' })
  })
})
