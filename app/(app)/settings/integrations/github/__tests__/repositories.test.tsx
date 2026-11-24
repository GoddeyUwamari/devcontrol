/**
 * /settings/integrations/github, board 5's repository table (D8b-2), through
 * the real page and service code with the HTTP client stubbed.
 *
 * Truth: every row, count, environment and job comes from the server's answer;
 * a failed load shows an error, never sample rows. Security: selects only for
 * can_manage; the chip fills on a click, only for an exact name; nothing is
 * sent on load.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GitHubIntegrationPage from '../page'

vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/github-connection/navigate', () => ({ goToGitHub: vi.fn() }))
const servicesState: { data: { id: string; name: string }[] | undefined; isError: boolean } = { data: [], isError: false }
const servicesEnabled = vi.fn()
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: ({ enabled }: { enabled: boolean }) => {
    servicesEnabled(enabled)
    return enabled ? servicesState : { data: undefined, isError: false }
  },
}))

const mockGet = vi.fn()
const mockPut = vi.fn()
const mockPost = vi.fn()
const mockDelete = vi.fn()
vi.mock('@/lib/api', () => ({
  default: {
    get: (...a: unknown[]) => mockGet(...a),
    put: (...a: unknown[]) => mockPut(...a),
    post: (...a: unknown[]) => mockPost(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}))

const NOW = Date.parse('2026-11-24T10:04:00Z')
const INSTALLATION = {
  installation_id: '42', account_login: 'acme-inc', account_type: 'Organization', repository_selection: 'selected',
  permissions_state: 'expected', permission_differences: [], claimed_at: '2026-11-24T10:00:00.000Z', claimed_by_name: 'Sam Rivera',
  suspended_at: null, deleted_at: null,
}
const SERVICES = [
  { id: 'svc-pay', name: 'payments-api' },
  { id: 'svc-web', name: 'web-app' },
  { id: 'svc-worker', name: 'worker' },
  { id: 'svc-mobile', name: 'mobile-api' },
]
type Repo = Record<string, unknown>
const repo = (id: string, name: string, over: Repo = {}): Repo => ({
  id, github_repo_id: id, installation_id: '42', full_name: `acme-inc/${name}`, service_id: null, service_name: null, deploy_rule: null,
  access_state: 'accessible', removed_at: null, last_event_at: null, held_events: 0, environments_seen: [], jobs_seen: [],
  last_deployment_at: null, over_limit_this_month: 0, ...over,
})
// The mock's four rows (board 5).
const BOARD5 = (): Repo[] => [
  repo('r-pay', 'payments-api', {
    service_id: 'svc-pay', service_name: 'payments-api', deploy_rule: { v: 1, mode: 'github_deployments', environment_name: 'production', environment_map: {} },
    environments_seen: ['production'], last_deployment_at: '2026-11-24T08:04:00.000Z',
  }),
  repo('r-web', 'web-app', { held_events: 12 }),
  repo('r-worker', 'worker', {
    service_id: 'svc-worker', service_name: 'worker', held_events: 3, environments_seen: ['production', 'staging'],
    jobs_seen: [{ workflow_name: 'Deploy', job_name: 'deploy' }, { workflow_name: 'Release', job_name: 'release' }],
  }),
  repo('r-mobile', 'mobile-api', {
    service_id: 'svc-mobile', service_name: 'mobile-api', deploy_rule: { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy-prod', branch: 'default' },
    jobs_seen: [{ workflow_name: 'CI', job_name: 'deploy-prod' }], over_limit_this_month: 2,
  }),
]

let connection: Record<string, unknown>
let repositories: Repo[]
let heldDays: unknown
let repositoriesStatus: number

const on = (over: Record<string, unknown> = {}) => ({ configured: true, can_manage: true, demo: false, installations: [INSTALLATION], last_event_at: null, ...over })
const ok = (data: unknown) => Promise.resolve({ status: 200, data })
const answer = (status: number, data: unknown = {}) => Promise.resolve({ status, data })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  sessionStorage.clear()
  connection = on()
  repositories = BOARD5()
  heldDays = 7
  repositoriesStatus = 200
  servicesState.data = SERVICES
  servicesState.isError = false
  mockGet.mockImplementation((url: string) => {
    if (url === '/api/integrations/github') return ok({ success: true, data: connection })
    if (url === '/api/integrations/github/repositories') {
      if (repositoriesStatus !== 200) return Promise.reject(Object.assign(new Error('500'), { response: { status: repositoriesStatus } }))
      return ok({ success: true, data: { repositories, held_event_days: heldDays } })
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
  mockPut.mockRejectedValue(new Error('unexpected PUT'))
  mockPost.mockRejectedValue(new Error('unexpected POST'))
  mockDelete.mockRejectedValue(new Error('unexpected DELETE'))
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><GitHubIntegrationPage /></QueryClientProvider>)
}
const table = () => screen.findByTestId('github-repo-table')
const row = async (id: string) => within(await table()).getByTestId(`github-repo-row-${id}`)
const getsOf = (url: string) => mockGet.mock.calls.filter(([u]) => u === url).length

describe('board 5: each repository state, from the server row', () => {
  it('the four mock rows: Recording + last deployment; Waiting + held; No deploy rule + seen + held; Recording + over limit + See plans', async () => {
    renderPage()
    expect(await screen.findByText('Repositories (4)')).toBeInTheDocument()
    expect(screen.getByText('The repositories you chose on GitHub. Each needs a service and a deploy rule before anything is recorded.')).toBeInTheDocument()

    const pay = await row('r-pay')
    expect(within(pay).getByTestId('github-status-r-pay')).toHaveTextContent('Recording')
    expect(within(pay).getByTestId('github-last-deployment-r-pay')).toHaveTextContent('Last deployment 2 hours ago')
    expect((within(pay).getByLabelText('Deploy rule for payments-api') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Environment: production')

    const web = await row('r-web')
    expect(within(web).getByTestId('github-status-r-web')).toHaveTextContent('Waiting for a service')
    expect(within(web).getByTestId('github-held-r-web')).toHaveTextContent('12 events held')
    expect(within(web).getByTestId('github-rule-first-r-web')).toHaveTextContent('Choose a service first')
    expect((within(web).getByLabelText('Service for web-app') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Choose a service')

    const worker = await row('r-worker')
    expect(within(worker).getByTestId('github-status-r-worker')).toHaveTextContent('No deploy rule yet')
    expect(within(worker).getByTestId('github-held-r-worker')).toHaveTextContent('3 events held')
    expect(within(worker).getByTestId('github-seen-r-worker')).toHaveTextContent('Seen: environments production, staging · jobs deploy, release')

    const mobile = await row('r-mobile')
    expect(within(mobile).getByTestId('github-status-r-mobile')).toHaveTextContent('Recording')
    expect(within(mobile).getByTestId('github-last-deployment-r-mobile')).toHaveTextContent('No deployment recorded yet')
    const limit = within(mobile).getByTestId('github-over-limit-r-mobile')
    expect(limit).toHaveTextContent('2 deployments not recorded this month: plan limit reached · See plans')
    expect(within(limit).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')

    // Nothing is sent on load.
    expect(mockPut).not.toHaveBeenCalled()
  })

  it('counts pluralise from the number; zero shows no line; no plan-limit row without refusals', async () => {
    repositories = [
      repo('a', 'one', { held_events: 1 }),
      repo('b', 'two', { service_id: 'svc-web', service_name: 'web-app', held_events: 0 }),
      repo('c', 'three', { service_id: 'svc-pay', service_name: 'payments-api', deploy_rule: { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'x' }, over_limit_this_month: 1 }),
      repo('d', 'four', { service_id: 'svc-pay', service_name: 'payments-api', deploy_rule: { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'x' } }),
    ]
    renderPage()
    expect(within(await row('a')).getByTestId('github-held-a')).toHaveTextContent(/^1 event held$/)
    expect(within(await row('b')).queryByTestId('github-held-b')).toBeNull()
    expect(within(await row('c')).getByTestId('github-over-limit-c')).toHaveTextContent('1 deployment not recorded this month: plan limit reached · See plans')
    expect(within(await row('d')).queryByTestId('github-over-limit-d')).toBeNull()
  })

  it('the footer: three lines word for word, the held days from the server', async () => {
    heldDays = 5
    renderPage()
    const footer = await screen.findByTestId('github-repo-footer')
    const lines = within(footer).getAllByText((_, el) => el?.tagName === 'P').map((p) => p.textContent)
    expect(lines).toEqual([
      "Held events: held for 5 days. They're recorded once the repository has a service and deploy rule; after 5 days, they're dropped.",
      'Deploy rule: a deployment is recorded when GitHub reports a deployment to the environment you choose, or when the workflow job you choose finishes on the default branch.',
      "Plan limit: deployments over your plan's monthly limit aren't recorded.",
    ])
  })

  it('the footer falls back to the one shared constant (7) when the server does not say', async () => {
    heldDays = undefined
    renderPage()
    expect(await screen.findByTestId('github-repo-footer')).toHaveTextContent("held for 7 days. They're recorded once the repository has a service and deploy rule; after 7 days, they're dropped.")
  })

  it('Create a service → goes to the existing creation page and back here', async () => {
    renderPage()
    expect(await screen.findByTestId('github-create-service')).toHaveAttribute('href', '/services/new?returnTo=%2Fsettings%2Fintegrations%2Fgithub')
  })

  it('no repositories: says so and links to GitHub; no fabricated row', async () => {
    repositories = []
    renderPage()
    expect(await screen.findByTestId('github-repositories-none')).toHaveTextContent('No repositories yet. Choose repositories on GitHub.')
    expect(screen.getByRole('link', { name: 'Choose repositories on GitHub.' })).toHaveAttribute('href', 'https://github.com/organizations/acme-inc/settings/installations/42')
    expect(screen.getByText('Repositories (0)')).toBeInTheDocument()
  })

  it('repositories failed: an error and Try again, never sample rows', async () => {
    repositoriesStatus = 500
    renderPage()
    expect(await screen.findByTestId('github-repositories-failed')).toHaveTextContent("Couldn't load repositories.")
    expect(screen.queryByTestId('github-repo-table')).toBeNull()
    expect(document.body.textContent).not.toMatch(/payments-api|web-app|Demo data/)
  })
})

describe('the "Use “name”" chip (exact name only, one click, never on its own)', () => {
  it('shown only for an unmapped repository with a service of exactly that name; a click saves it', async () => {
    repositories = [
      repo('r-web', 'web-app'),
      repo('r-case', 'Web-App'),
      repo('r-fuzzy', 'web-app-v2'),
      repo('r-mapped', 'worker', { service_id: 'svc-pay', service_name: 'payments-api' }),
    ]
    mockPut.mockImplementation((url: string, body: unknown) => {
      repositories = [repo('r-web', 'web-app', { service_id: 'svc-web', service_name: 'web-app' })]
      return url === '/api/integrations/github/repositories/r-web/service' ? answer(200, { success: true, data: { replay: { considered: 0, recorded: 0 } } }) : Promise.reject(new Error(String(body)))
    })
    renderPage()
    const chip = within(await row('r-web')).getByTestId('github-use-service-r-web')
    expect(chip).toHaveTextContent('Use “web-app”')
    for (const id of ['r-case', 'r-fuzzy', 'r-mapped']) expect(within(await row(id)).queryByTestId(`github-use-service-${id}`)).toBeNull()
    expect(mockPut).not.toHaveBeenCalled()

    fireEvent.click(chip)
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1))
    expect(mockPut.mock.calls[0][1]).toEqual({ service_id: 'svc-web' })
    expect(await within(await row('r-web')).findByTestId('github-service-save-r-web')).toHaveTextContent('Saved')
    expect((within(await row('r-web')).getByLabelText('Service for web-app') as HTMLSelectElement).value).toBe('svc-web')
  })
})

describe('saving: Saving… then Saved; on failure the previous value comes back with the error (R6)', () => {
  it('service select: Saving… while the PUT runs, then Saved and the list read again', async () => {
    let resolve!: (v: unknown) => void
    mockPut.mockImplementation(() => new Promise((r) => { resolve = r }))
    renderPage()
    const before = getsOf('/api/integrations/github/repositories')
    fireEvent.change(within(await row('r-web')).getByLabelText('Service for web-app'), { target: { value: 'svc-worker' } })
    expect(await screen.findAllByText('Saving…')).not.toHaveLength(0)
    expect((within(await row('r-web')).getByLabelText('Service for web-app') as HTMLSelectElement).value).toBe('svc-worker')
    await act(async () => resolve({ status: 200, data: { success: true, data: { replay: { considered: 0, recorded: 0 } } } }))
    await waitFor(() => expect(within(screen.getByTestId('github-repo-table')).getByTestId('github-service-save-r-web')).toHaveTextContent('Saved'))
    expect(getsOf('/api/integrations/github/repositories')).toBeGreaterThan(before)
  })

  it('a failed save (500): the previous value comes back and "Couldn\'t save. Try again." shows', async () => {
    mockPut.mockImplementation(() => answer(500, { success: false }))
    renderPage()
    const select = within(await row('r-worker')).getByLabelText('Service for worker') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'svc-pay' } })
    expect(await within(await row('r-worker')).findByTestId('github-service-save-r-worker')).toHaveTextContent("Couldn't save. Try again.")
    expect((within(await row('r-worker')).getByLabelText('Service for worker') as HTMLSelectElement).value).toBe('svc-worker')
  })

  it('404: "This repository or service no longer exists." and the list is read again', async () => {
    mockPut.mockImplementation(() => answer(404, { success: false, error: 'not_found' }))
    renderPage()
    await row('r-worker')
    const before = getsOf('/api/integrations/github/repositories')
    fireEvent.change(within(await row('r-worker')).getByLabelText('Service for worker'), { target: { value: 'svc-pay' } })
    expect(await within(await row('r-worker')).findByTestId('github-service-save-r-worker')).toHaveTextContent('This repository or service no longer exists.')
    await waitFor(() => expect(getsOf('/api/integrations/github/repositories')).toBeGreaterThan(before))
  })

  it('504: "The save may still be processing. Refresh this list to check."', async () => {
    mockPut.mockImplementation(() => answer(504))
    renderPage()
    fireEvent.change(within(await row('r-worker')).getByLabelText('Deploy rule for worker'), { target: { value: 'env:staging' } })
    expect(await within(await row('r-worker')).findByTestId('github-rule-save-r-worker')).toHaveTextContent('The save may still be processing. Refresh this list to check.')
  })

  it('"No service" appears only once mapped, and sends null (going forward)', async () => {
    mockPut.mockImplementation(() => answer(200, { success: true, data: { replay: { considered: 0, recorded: 0 } } }))
    renderPage()
    const web = within(await row('r-web')).getByLabelText('Service for web-app') as HTMLSelectElement
    expect([...web.options].map((o) => o.textContent)).not.toContain('No service')
    const worker = within(await row('r-worker')).getByLabelText('Service for worker') as HTMLSelectElement
    expect([...worker.options].map((o) => o.textContent)).toEqual(['payments-api', 'web-app', 'worker', 'mobile-api', 'No service'])
    expect([...worker.options].map((o) => o.textContent)).not.toContain('Choose a service')
    fireEvent.change(worker, { target: { value: '__none__' } })
    await waitFor(() => expect(mockPut).toHaveBeenCalledWith('/api/integrations/github/repositories/r-worker/service', { service_id: null }, expect.anything()))
  })
})

describe('deploy rule options: only what DevControl has seen', () => {
  it('environments and jobs seen, nothing else; choosing one sends the server-default rule (job: default branch, R3)', async () => {
    mockPut.mockImplementation(() => answer(200, { success: true, data: {} }))
    renderPage()
    const select = within(await row('r-worker')).getByLabelText('Deploy rule for worker') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a deploy rule', 'Environment: production', 'Environment: staging', 'Job: deploy', 'Job: release'])
    fireEvent.change(select, { target: { value: 'env:staging' } })
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(1))
    expect(mockPut.mock.calls[0].slice(0, 2)).toEqual(['/api/integrations/github/repositories/r-worker/deploy-rule', { mode: 'github_deployments', environment_name: 'staging' }])
    await waitFor(() => expect(within(screen.getByTestId('github-repo-table')).getByTestId('github-rule-save-r-worker')).toHaveTextContent('Saved'))
    fireEvent.change(select, { target: { value: (select.options[3] as HTMLOptionElement).value } })
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(2))
    expect(mockPut.mock.calls[1][1]).toEqual({ mode: 'job', workflow_name: 'Deploy', job_name: 'deploy' })
  })

  it('nothing seen yet: a disabled select that says so', async () => {
    repositories = [repo('r', 'empty', { service_id: 'svc-pay', service_name: 'payments-api' })]
    renderPage()
    const select = within(await row('r')).getByLabelText('Deploy rule for empty') as HTMLSelectElement
    expect(select).toBeDisabled()
    expect(select.selectedOptions[0].textContent).toBe('Nothing seen from GitHub yet')
  })

  it('stored rules the select cannot send name themselves; "(any branch)" only for a stored any-branch rule; same job in two workflows names the workflow', async () => {
    const svc = { service_id: 'svc-pay', service_name: 'payments-api' }
    repositories = [
      repo('any', 'a', { ...svc, deploy_rule: { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy', branch: 'any' } }),
      repo('named', 'b', { ...svc, deploy_rule: { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy', branch: 'named', branch_name: 'release' } }),
      repo('envs', 'c', { ...svc, deploy_rule: { v: 1, mode: 'github_deployments', environment_map: {} } }),
      repo('def', 'd', { ...svc, deploy_rule: { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy', branch: 'default' }, jobs_seen: [{ workflow_name: 'CI', job_name: 'deploy' }] }),
      repo('dup', 'e', { ...svc, jobs_seen: [{ workflow_name: 'CI', job_name: 'deploy' }, { workflow_name: 'Release', job_name: 'deploy' }] }),
    ]
    renderPage()
    const label = async (id: string, name: string) => (within(await row(id)).getByLabelText(`Deploy rule for ${name}`) as HTMLSelectElement).selectedOptions[0].textContent
    expect(await label('any', 'a')).toBe('Job: deploy (any branch)')
    expect(await label('named', 'b')).toBe('Job: deploy (branch release)')
    expect(await label('envs', 'c')).toBe('Environments: any known name')
    expect(await label('def', 'd')).toBe('Job: deploy')
    const dup = within(await row('dup')).getByLabelText('Deploy rule for e') as HTMLSelectElement
    expect([...dup.options].map((o) => o.textContent)).toEqual(['Choose a deploy rule', 'Job: CI › deploy', 'Job: Release › deploy'])
    // Once per layout (the desktop table; the phone cards render the same rows).
    expect((await table()).textContent?.match(/\(any branch\)/g)).toHaveLength(1)
  })
})

describe('members and the demo workspace', () => {
  it('can_manage false: values as text, no select, no chip, no Create a service; services are not even fetched', async () => {
    connection = on({ can_manage: false })
    renderPage()
    const t = await table()
    expect(within(t).queryAllByRole('combobox')).toEqual([])
    expect(screen.queryByTestId('github-create-service')).toBeNull()
    expect(screen.queryByText(/Use “/)).toBeNull()
    expect(within(await row('r-web')).getByTestId('github-service-text-r-web')).toHaveTextContent('No service')
    expect(within(await row('r-worker')).getByTestId('github-rule-text-r-worker')).toHaveTextContent('No deploy rule')
    expect(within(await row('r-mobile')).getByTestId('github-rule-text-r-mobile')).toHaveTextContent('Job: deploy-prod')
    expect(servicesEnabled).not.toHaveBeenCalledWith(true)
  })

  it('demo workspace: the labelled sample table, every control disabled, no request but GET /', async () => {
    connection = on({ demo: true, can_manage: false, installations: [] })
    renderPage()
    await screen.findByTestId('github-demo')
    const t = await table()
    const controls = [...within(t).getAllByRole('combobox'), ...within(t).getAllByRole('button')]
    expect(controls.length).toBeGreaterThan(0)
    for (const c of controls) expect(c).toBeDisabled()
    expect(screen.getByTestId('github-create-service')).toHaveAttribute('aria-disabled', 'true')
    expect(within(t).getByText('Use “web-app”')).toBeDisabled()
    expect(mockGet.mock.calls.map(([u]) => u)).toEqual(['/api/integrations/github'])
    expect(mockPut).not.toHaveBeenCalled()
  })
})
