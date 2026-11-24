/**
 * CAT-3 (CAT-D7, C3-D3/D4/D5): API keys and webhooks are "Coming soon". The
 * page makes no request for them, offers no action that would fail, and no
 * integration tile can be "connected" by a click unless it really connects
 * (only AWS). Every tile stays listed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const demo = vi.hoisted(() => ({ on: false }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demo.on }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: true, isEnterprise: false }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/services/developers.service', () => ({
  default: {
    getKeys: vi.fn(async () => []),
    generateKey: vi.fn(),
    revokeKey: vi.fn(),
    getWebhooks: vi.fn(async () => []),
    addWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
  },
}))

// D8b-2 (board 7): the GitHub tile reads GET /api/integrations/github. Switched off by default here,
// so every test above it keeps proving today's page; the switched-on tile is tested at the end.
const github = vi.hoisted(() => ({ state: { configured: false } as Record<string, unknown> }))
vi.mock('@/lib/services/github-connection.service', () => ({
  githubConnectionService: { get: vi.fn(async () => github.state), repositories: vi.fn(async () => ({ repositories: [], held_event_days: 7 })) },
}))

import DevelopersPage from '../page'
import { githubConnectionService } from '@/lib/services/github-connection.service'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><DevelopersPage /></QueryClientProvider>)
}
import developersService from '@/lib/services/developers.service'

const ALL_TILES = ['AWS', 'Kubernetes', 'Terraform', 'CloudWatch', 'Datadog', 'Grafana', 'Prometheus', 'New Relic', 'Slack', 'PagerDuty', 'OpsGenie', 'Email', 'GitHub', 'Jira', 'GitLab', 'Linear']
const COMING_SOON_TILES = ['Kubernetes', 'Terraform', 'Datadog', 'Grafana', 'Prometheus', 'New Relic', 'PagerDuty', 'OpsGenie', 'GitHub', 'Jira', 'GitLab', 'Linear']

const tile = (name: string) => screen.getByText(name, { selector: 'p.text-sm' }).closest('div.rounded-xl') as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  demo.on = false
  github.state = { configured: false }
})

describe.each([false, true])('/developers (demo mode %s)', (demoOn) => {
  beforeEach(() => { demo.on = demoOn })

  it('makes no request for keys or webhooks', () => {
    renderPage()
    for (const fn of Object.values(developersService)) expect(fn).not.toHaveBeenCalled()
  })

  it('shows API keys and webhooks as "Coming soon", with no button or modal', () => {
    renderPage()
    const keys = screen.getByTestId('api-keys-coming-soon')
    expect(keys.textContent).toContain('API keys')
    expect(keys.textContent).toContain('Coming soon')
    expect(keys.textContent).toContain('Programmatic read access to DevControl is being built. It will be on the Optimization Engine plan.')
    const hooks = screen.getByTestId('webhooks-coming-soon')
    expect(hooks.textContent).toContain('Webhooks')
    expect(hooks.textContent).toContain('Coming soon')
    expect(hooks.textContent).toContain('Send DevControl events to your own systems. Up to 5 endpoints on Optimization Engine.')
    expect(within(keys).queryByRole('button')).toBeNull()
    expect(within(hooks).queryByRole('button')).toBeNull()
    expect(document.body.textContent).not.toMatch(/Generate (API )?Key|Add Endpoint|No API keys yet|No webhooks configured|requests this month|Upgrade to Enterprise for unlimited webhooks/)
  })

  it('every integration tile is still listed', () => {
    renderPage()
    for (const name of ALL_TILES) expect(tile(name)).toBeInTheDocument()
  })

  it('tiles that do not exist yet say "Coming soon" and have no button', async () => {
    renderPage()
    // GitHub's tile waits for GET /api/integrations/github (switched off here); fix round 3: no "Coming soon" before it answers.
    await waitFor(() => expect(tile('GitHub').textContent).toContain('Coming soon'))
    for (const name of COMING_SOON_TILES) {
      expect(tile(name).textContent).toContain('Coming soon')
      expect(within(tile(name)).queryByRole('button')).toBeNull()
      expect(tile(name).textContent).not.toMatch(/Connected|Recommended/)
    }
  })

  it('CloudWatch is included with AWS; Slack and email are test-only with a link to alert settings', () => {
    renderPage()
    expect(tile('CloudWatch').textContent).toContain('Included with AWS')
    expect(tile('CloudWatch').textContent).toContain('Metrics are read through your AWS connection.')
    expect(within(tile('CloudWatch')).queryByRole('button')).toBeNull()
    for (const name of ['Slack', 'Email']) {
      expect(tile(name).textContent).toContain('Test messages only. Alert delivery is coming soon.')
      expect(tile(name).textContent).toContain('Coming soon')
      expect(within(tile(name)).queryByRole('button')).toBeNull()
      expect(within(tile(name)).getByText('Alert settings →').getAttribute('href')).toBe('/settings/alerts')
    }
  })

  it('no click anywhere produces a fake "Connected"', () => {
    renderPage()
    const connectedBefore = screen.queryAllByText('Connected').length
    for (const button of screen.getAllByRole('button')) {
      if (within(tile('AWS')).queryAllByRole('button').includes(button)) continue
      fireEvent.click(button)
    }
    expect(screen.queryAllByText('Connected')).toHaveLength(connectedBefore)
    for (const name of ALL_TILES.filter((n) => n !== 'AWS')) expect(tile(name).textContent).not.toContain('Connected')
  })

  it('the setup steps: observability is "Coming soon" (not a button); alert channels open alert settings', () => {
    renderPage()
    expect(document.body.textContent).toContain('Datadog, Grafana and others are coming soon.')
    expect(screen.queryByRole('button', { name: /Connect Datadog|Connect Slack/ })).toBeNull()
    expect(document.body.textContent).toContain('Set up email and Slack and send a test message. Alert delivery is coming soon.')
    fireEvent.click(screen.getByRole('button', { name: 'Open alert settings →' }))
    expect(push).toHaveBeenCalledWith('/settings/alerts')
  })

  it('the subtitle says only AWS connects today', () => {
    renderPage()
    expect(document.body.textContent).toContain('Connect AWS today. API keys, webhooks and more integrations are coming soon.')
    expect(document.body.textContent).not.toMatch(/real-time/i)
  })
})

describe('AWS stays a real connection', () => {
  it('not connected: "Connect →" opens /connect-aws', () => {
    renderPage()
    fireEvent.click(within(tile('AWS')).getByRole('button', { name: 'Connect →' }))
    expect(push).toHaveBeenCalledWith('/connect-aws')
  })

  it('demo: only AWS shows as connected', () => {
    demo.on = true
    renderPage()
    expect(tile('AWS').textContent).toContain('Connected')
    expect(screen.getAllByText('Connected')).toHaveLength(1)
  })
})

describe('the GitHub tile while the GitHub App is switched on (D8b-2, board 7)', () => {
  const INSTALLATION = { installation_id: '42', account_login: 'acme-inc', account_type: 'Organization', permissions_state: 'expected', suspended_at: null, deleted_at: null }
  const on = (installations: unknown[]) => ({ configured: true, can_manage: true, demo: false, installations, last_event_at: null })

  it('not connected: "Connect GitHub →" to the GitHub page instead of "Coming soon"', async () => {
    github.state = on([])
    renderPage()
    const link = await screen.findByTestId('developers-github-link')
    expect(link).toHaveTextContent('Connect GitHub →')
    expect(link).toHaveAttribute('href', '/settings/integrations/github')
    expect(tile('GitHub').textContent).not.toContain('Coming soon')
  })

  it('connected: "Manage GitHub connection →"', async () => {
    github.state = on([INSTALLATION])
    renderPage()
    expect(await screen.findByTestId('developers-github-link')).toHaveTextContent('Manage GitHub connection →')
  })

  it.each([[[]], [[INSTALLATION]]])('a member (can_manage false): "View GitHub →" to the GitHub page, never Connect or Manage (installations: %j)', async (installations) => {
    github.state = { ...on(installations), can_manage: false }
    renderPage()
    const link = await screen.findByTestId('developers-github-link')
    expect(link).toHaveTextContent('View GitHub →')
    expect(link).toHaveAttribute('href', '/settings/integrations/github')
    expect(document.body.textContent).not.toMatch(/Connect GitHub →|Manage GitHub connection →/)
  })

  it('fix round 2 (N-3): the status request fails -> "View GitHub →" to the GitHub page, never "Coming soon"', async () => {
    vi.mocked(githubConnectionService.get).mockRejectedValueOnce(new Error('Network Error'))
    renderPage()
    const link = await screen.findByTestId('developers-github-link')
    expect(link).toHaveTextContent('View GitHub →')
    expect(link).toHaveAttribute('href', '/settings/integrations/github')
    expect(tile('GitHub').textContent).not.toContain('Coming soon')
    expect(document.body.textContent).not.toMatch(/Connect GitHub →|Manage GitHub connection →/)
  })

  it('fix round 3 (founder): while the status request is loading, a neutral placeholder: never "Coming soon", no link', async () => {
    let answer!: (v: unknown) => void
    vi.mocked(githubConnectionService.get).mockImplementationOnce(() => new Promise((r) => { answer = r }) as never)
    github.state = on([])
    renderPage()
    expect(await screen.findByTestId('developers-github-loading')).toBeInTheDocument()
    expect(tile('GitHub').textContent).not.toMatch(/Coming soon/i)
    expect(tile('GitHub')).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByTestId('developers-github-link')).toBeNull()
    // Once it answers, the placeholder goes: switched on -> the link.
    await act(async () => answer(github.state))
    expect(await screen.findByTestId('developers-github-link')).toHaveTextContent('Connect GitHub →')
    expect(screen.queryByTestId('developers-github-loading')).toBeNull()
  })

  it('switched off: "Coming soon" and no link, as before', async () => {
    renderPage()
    await vi.waitFor(() => expect(githubConnectionService.get).toHaveBeenCalled())
    // Fix round 3: the answer (not just the request) decides; the loading placeholder comes first.
    await waitFor(() => expect(tile('GitHub').textContent).toContain('Coming soon'))
    expect(screen.queryByTestId('developers-github-link')).toBeNull()
  })

  it('demo mode: "Coming soon" and no request at all', async () => {
    demo.on = true
    github.state = on([INSTALLATION])
    renderPage()
    expect(tile('GitHub').textContent).toContain('Coming soon')
    expect(screen.queryByTestId('developers-github-link')).toBeNull()
    expect(githubConnectionService.get).not.toHaveBeenCalled()
  })

  it('the demo workspace: "Coming soon", never its sample as a connection', async () => {
    github.state = { ...on([INSTALLATION]), demo: true }
    renderPage()
    await vi.waitFor(() => expect(githubConnectionService.get).toHaveBeenCalled())
    // Fix round 3: the answer (not just the request) decides; the loading placeholder comes first.
    await waitFor(() => expect(tile('GitHub').textContent).toContain('Coming soon'))
  })
})
