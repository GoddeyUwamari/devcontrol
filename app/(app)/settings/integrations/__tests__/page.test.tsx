/**
 * /settings/integrations (D8b-1, board 1): the AWS card and the GitHub card in
 * each state. A card waits for its own answer (grey chip) and never says
 * "Not connected" before the server does. The user menu's "Integrations"
 * opens this page; Alerts keeps its own item.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import IntegrationsPage from '../page'
import { userNavSections } from '@/lib/navigation-config'

const mockGet = vi.fn()
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  default: { get: (...args: unknown[]) => mockGet(...args), post: vi.fn(), delete: vi.fn() },
}))

const AWS_ACCOUNT = { id: 'a1', account_id: '123456789012', account_name: 'prod', region: 'us-east-1', status: 'active', role_arn: 'arn:aws:iam::123456789012:role/x' }
const INSTALLATION = {
  installation_id: '42', account_login: 'acme-inc', account_type: 'Organization', repository_selection: 'selected',
  permissions_state: 'expected', permission_differences: [], claimed_at: '2026-11-24T10:00:00Z', claimed_by_name: null, suspended_at: null, deleted_at: null,
}
const repo = (id: string, over: Record<string, unknown> = {}) => ({
  id, github_repo_id: id, installation_id: '42', full_name: `acme-inc/${id}`, service_id: 's', service_name: 'svc', deploy_rule: { mode: 'job' },
  access_state: 'active', removed_at: null, last_event_at: null, ...over,
})

let aws: unknown
let github: unknown
let repos: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  aws = { success: true, data: [AWS_ACCOUNT], connection: { state: 'connected' } }
  github = { configured: false }
  repos = []
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/aws/accounts') return Promise.resolve({ data: aws })
    if (url === '/api/integrations/github') return Promise.resolve({ data: { success: true, data: github } })
    if (url === '/api/integrations/github/repositories') return Promise.resolve({ data: { success: true, data: { repositories: repos } } })
    return Promise.reject(new Error(url))
  })
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><IntegrationsPage /></QueryClientProvider>)
}

const card = async (id: 'aws' | 'github') => screen.findByTestId(`integration-${id}`)

describe('Integrations index', () => {
  it('heading, subtitle, AWS connected (board 1)', async () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Integrations' })).toBeInTheDocument()
    expect(screen.getByText('Connect the accounts DevControl reads from.')).toBeInTheDocument()
    const c = await card('aws')
    expect(await within(c).findByTestId('integration-aws-chip')).toHaveTextContent('Connected')
    expect(within(c).getByText('Amazon Web Services')).toBeInTheDocument()
    expect(within(c).getByText('Cost, resources, security findings and health checks, through a read-only role in your account.')).toBeInTheDocument()
    expect(within(c).getByTestId('integration-aws-line')).toHaveTextContent('1 account · home region us-east-1')
    expect(within(c).getByTestId('integration-aws-link')).toHaveTextContent('Manage AWS connection →')
    expect(within(c).getByTestId('integration-aws-link')).toHaveAttribute('href', '/connect-aws')
  })

  it('while loading: grey chips, no "Not connected"', () => {
    mockGet.mockImplementation(() => new Promise(() => undefined))
    renderPage()
    expect(screen.getByTestId('integration-aws-chip-loading')).toBeInTheDocument()
    expect(screen.getByTestId('integration-github-chip-loading')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Not connected|Connected/)
  })

  it('GitHub switched off: "Not available yet", "Learn more →" to the GitHub page', async () => {
    renderPage()
    const c = await card('github')
    expect(await within(c).findByTestId('integration-github-chip')).toHaveTextContent('Not available yet')
    expect(within(c).getByText('Deployments from GitHub Actions, for Deployment History and Engineering Intelligence. Read-only, no access to your code.')).toBeInTheDocument()
    expect(within(c).getByTestId('integration-github-link')).toHaveTextContent('Learn more →')
    expect(within(c).getByTestId('integration-github-link')).toHaveAttribute('href', '/settings/integrations/github')
  })

  it('GitHub not connected: "Not connected", by-hand line, "Set up GitHub →"', async () => {
    github = { configured: true, can_manage: true, demo: false, installations: [], last_event_at: null }
    renderPage()
    const c = await card('github')
    expect(await within(c).findByText('Set up GitHub →')).toBeInTheDocument()
    expect(within(c).getByTestId('integration-github-chip')).toHaveTextContent('Not connected')
    expect(within(c).getByText('You can still record deployments by hand.')).toBeInTheDocument()
  })

  it('GitHub connected: "{account} · 4 repositories · 3 recording"', async () => {
    github = { configured: true, can_manage: true, demo: false, installations: [INSTALLATION], last_event_at: null }
    repos = [repo('a'), repo('b'), repo('c'), repo('d', { deploy_rule: null })]
    renderPage()
    const c = await card('github')
    expect(await within(c).findByText('acme-inc · 4 repositories · 3 recording')).toBeInTheDocument()
    expect(within(c).getByTestId('integration-github-chip')).toHaveTextContent('Connected')
  })

  it.each([
    ['permissions changed', { permissions_state: 'mismatch' }],
    ['suspended', { suspended_at: '2026-11-24T00:00:00Z' }],
    ['uninstalled', { deleted_at: '2026-11-24T00:00:00Z' }],
  ])('GitHub needs attention (%s): the amber chip', async (_name, over) => {
    github = { configured: true, can_manage: true, demo: false, installations: [{ ...INSTALLATION, ...over }], last_event_at: null }
    renderPage()
    const c = await card('github')
    expect(await within(c).findByText('Needs attention')).toBeInTheDocument()
  })

  it('AWS not connected: the neutral chip and the connect link', async () => {
    aws = { success: true, data: [], connection: { state: 'not_connected' } }
    renderPage()
    const c = await card('aws')
    expect(await within(c).findByTestId('integration-aws-chip')).toHaveTextContent('Not connected')
    expect(within(c).getByTestId('integration-aws-link')).toHaveAttribute('href', '/connect-aws')
  })
})

describe('user menu', () => {
  it('"Integrations" opens the index; Alerts keeps its own item', () => {
    const items = userNavSections.flatMap((s) => s.items)
    expect(items.find((i) => i.label === 'Integrations')?.href).toBe('/settings/integrations')
    expect(items.find((i) => i.label === 'Alerts')?.href).toBe('/settings/alerts')
  })
})
