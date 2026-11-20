/**
 * D2 "Record a deployment" (copy approved in review-logs/deployments/d2-build.md §1).
 *
 *   - The Deployments page's form is the only one that creates rows. It
 *     records a deployment that already happened: a registered service, the
 *     environment and a result. The result has no default and the form can't
 *     be sent until a service and a result are chosen.
 *   - Copy as approved: "Record a deployment", "Record deployment",
 *     "Succeeded" / "Failed", "Deployment recorded: …". Never "Deploy",
 *     "Deploying", "started" or "Connect your CI".
 *   - Errors: the server's 4xx message ("Choose an existing service."), a
 *     fixed sentence for a viewer, a fixed fallback otherwise. axios's
 *     "Request failed with status code …" and 5xx bodies are never shown.
 *   - ?record=1 opens the form; /deployments/new redirects there.
 *   - A failure recorded by hand shows "Recorded by hand · no logs attached"
 *     and no logs link; a pipeline failure keeps its banner and link.
 *
 * The real page, modal, service, hook, AuthProvider and shared axios client;
 * only the client's transport is stubbed (an in-memory API answering as the
 * routes do).
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import { AuthProvider } from '@/lib/contexts/auth-context'
import { authService } from '@/lib/services/auth.service'
import { organizationsService } from '@/lib/services/organizations.service'
import { deploymentsService } from '@/lib/services/deployments.service'
import { quickActions } from '@/lib/navigation-config'
import { recordErrorMessage } from '@/lib/deployments/record'

const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  redirect: vi.fn((url: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { url }) }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => '/deployments',
  useSearchParams: () => nav.params,
  redirect: nav.redirect,
}))
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: false }),
}))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', lacksEntitlement: () => false }) }))

import DeploymentsPage from '../page'
import NewDeploymentPage from '../new/page'

const ROOT = path.resolve(__dirname, '../../../..')
const ORG = { id: '00000000-0000-4000-8000-00000000000a', name: 'Org A', slug: 'org-a' }
const USER = { id: '00000000-0000-4000-8000-0000000000aa', email: 'user@example.invalid', fullName: 'User' }
const SVC = { id: '00000000-0000-4000-8000-000000000001', name: 'api-gateway', owner: 'o@example.invalid', team_id: null, team_name: null, github_url: null, created_at: '2026-10-01T00:00:00.000Z' }
const AXIOS_GENERIC = /Request failed with status code/

function signIn() {
  const payload = btoa(JSON.stringify({ userId: USER.id, organizationId: ORG.id, role: 'member', type: 'access' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  localStorage.setItem('accessToken', `eyJhbGciOiJIUzI1NiJ9.${payload}.c2lnbmF0dXJl`)
  localStorage.setItem('refreshToken', 'refresh-token')
  localStorage.setItem('user', JSON.stringify(USER))
}

type Reply = { status: number; data: unknown } | 'network'
let registered: unknown[] = [SVC]
let listRows: Record<string, unknown>[] = []
let postReply: () => Reply = () => ({ status: 201, data: { success: true, data: { id: 'new' } } })
const posts: Record<string, unknown>[] = []
const originalAdapter = api.defaults.adapter

const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const [p] = (config.url ?? '').split('?')
  const respond = (status: number, data: unknown) => ({ data, status, statusText: '', headers: {}, config })
  if (config.method === 'post' && p === '/api/deployments') {
    posts.push(JSON.parse(String(config.data)))
    const reply = postReply()
    if (reply === 'network') throw new AxiosError('Network Error', 'ERR_NETWORK', config)
    if (reply.status >= 400) {
      throw new AxiosError(`Request failed with status code ${reply.status}`, 'ERR_BAD_REQUEST', config, null, respond(reply.status, reply.data) as never)
    }
    return respond(reply.status, reply.data)
  }
  if (p === '/api/services/registered') return respond(200, { success: true, services: registered, total: registered.length })
  if (p === '/api/deployments/stats') {
    const success = listRows.filter(r => r.status === 'success').length
    const failed = listRows.filter(r => r.status === 'failed').length
    return respond(200, {
      success: true,
      stats: {
        window_days: 30, total: listRows.length, success, failed, in_progress: 0, no_completion_recorded: 0, unknown: 0,
        change_failure_rate: success + failed ? (failed / (success + failed)) * 100 : null,
        organization_has_deployments: listRows.length > 0, last_deployment: null,
      },
    })
  }
  if (p === '/api/deployments') {
    return respond(200, { success: true, data: listRows, total: listRows.length, pagination: { limit: 25, offset: 0, total: listRows.length } })
  }
  return respond(200, { success: true })
}

function deploymentRow(id: string, status: string, metadata: Record<string, unknown>) {
  const at = new Date(Date.now() - 3_600_000).toISOString()
  return {
    id, service_id: SVC.id, service_name: SVC.name, environment: 'production', aws_region: 'us-east-1', status,
    cost_estimate: null, deployed_by: 'someone@example.invalid', deployed_at: at, created_at: at, updated_at: at, metadata,
  }
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {}
})

beforeEach(() => {
  localStorage.clear()
  signIn()
  for (const m of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(() => {})
  vi.spyOn(authService, 'getCurrentUser').mockResolvedValue({ ...USER, organizations: [ORG] } as never)
  vi.spyOn(organizationsService, 'getAll').mockResolvedValue([ORG] as never)
  api.defaults.adapter = adapter
  nav.params = new URLSearchParams()
  nav.push.mockClear(); nav.replace.mockClear(); nav.redirect.mockClear()
  registered = [SVC]
  listRows = [deploymentRow('ok', 'success', { source: 'github_actions' })]
  postReply = () => ({ status: 201, data: { success: true, data: { id: 'new' } } })
  posts.length = 0
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
  localStorage.clear()
})

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><AuthProvider><DeploymentsPage /></AuthProvider></QueryClientProvider>)
  await act(async () => {})
}

async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Record deployment' }))
  return screen.findByTestId('record-deployment-modal')
}

async function chooseService(dialog: HTMLElement) {
  await within(dialog).findByRole('option', { name: SVC.name })
  fireEvent.change(within(dialog).getByLabelText('Service'), { target: { value: SVC.id } })
}

const submitButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Record deployment' })

async function recordWith(result: 'Succeeded' | 'Failed', extra: (dialog: HTMLElement) => void = () => {}) {
  await renderPage()
  const dialog = await openForm()
  await chooseService(dialog)
  fireEvent.click(within(dialog).getByLabelText(result))
  extra(dialog)
  fireEvent.click(submitButton(dialog))
  return dialog
}

describe('the form', () => {
  it('copy as approved; no result chosen; submit disabled until a service and a result are chosen; nothing posted before', async () => {
    await renderPage()
    const dialog = await openForm()

    expect(within(dialog).getByRole('heading', { name: 'Record a deployment' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent("Record a deployment that has already happened. DevControl keeps the record; it doesn't deploy anything.")
    expect(within(dialog).getByText('Result')).toBeInTheDocument()
    expect(within(dialog).getByText('Recorded with the current time.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    const succeeded = within(dialog).getByLabelText('Succeeded') as HTMLInputElement
    const failed = within(dialog).getByLabelText('Failed') as HTMLInputElement
    expect([succeeded.checked, failed.checked]).toEqual([false, false])
    expect(within(dialog).getByTestId('record-deployment-result-hint')).toHaveTextContent('Choose whether the deployment succeeded or failed.')

    const regions = within(within(dialog).getByLabelText('Region')).getAllByRole('option').map(o => o.textContent)
    expect(regions).toEqual([
      'us-east-1 (N. Virginia)', 'us-east-2 (Ohio)', 'us-west-1 (N. California)', 'us-west-2 (Oregon)',
      'eu-west-1 (Ireland)', 'eu-central-1 (Frankfurt)', 'ap-southeast-1 (Singapore)', 'ap-northeast-1 (Tokyo)',
    ])

    expect(submitButton(dialog)).toBeDisabled()
    await chooseService(dialog)
    expect(submitButton(dialog)).toBeDisabled()
    // Even a forced submit with no result sends nothing.
    fireEvent.submit(dialog.querySelector('form')!)
    expect(posts).toEqual([])

    fireEvent.click(succeeded)
    expect(submitButton(dialog)).toBeEnabled()
    expect(within(dialog).queryByTestId('record-deployment-result-hint')).not.toBeInTheDocument()

    expect(dialog.textContent).not.toMatch(/\bDeploy\b|Deploying|started|Deploy your service|DevControl deployed/)
  })

  it('Succeeded: posts the service, environment, region and status (no deployed_by, no time) and confirms exactly', async () => {
    const dialog = await recordWith('Succeeded')
    expect(await within(dialog).findByTestId('record-deployment-success')).toHaveTextContent(/^Deployment recorded: api-gateway in production · Succeeded$/)
    expect(posts).toEqual([{ service_id: SVC.id, environment: 'production', aws_region: 'us-east-1', status: 'success' }])
  })

  it('Failed: confirms exactly, with the environment, region and version chosen', async () => {
    const dialog = await recordWith('Failed', (d) => {
      fireEvent.change(within(d).getByLabelText('Environment'), { target: { value: 'staging' } })
      fireEvent.change(within(d).getByLabelText('Region'), { target: { value: 'us-east-2' } })
      fireEvent.change(within(d).getByLabelText(/Version/), { target: { value: 'v2.4.1' } })
    })
    expect(await within(dialog).findByTestId('record-deployment-success')).toHaveTextContent(/^Deployment recorded: api-gateway in staging · Failed$/)
    expect(posts).toEqual([{ service_id: SVC.id, environment: 'staging', aws_region: 'us-east-2', status: 'failed', version: 'v2.4.1' }])
  })

  it('no registered services: says who can add one, and nothing can be sent', async () => {
    registered = []
    await renderPage()
    const dialog = await openForm()
    expect(await within(dialog).findByTestId('record-deployment-no-services'))
      .toHaveTextContent('No services are registered yet. An owner or admin can add one in Services & Ownership.')
    expect(within(dialog).getByLabelText('Service')).toBeDisabled()
    fireEvent.click(within(dialog).getByLabelText('Succeeded'))
    expect(submitButton(dialog)).toBeDisabled()
  })
})

describe('errors', () => {
  it.each<[string, Reply, string]>([
    ['the server\'s 400 for an unknown service', { status: 400, data: { success: false, error: 'Choose an existing service.' } }, 'Choose an existing service.'],
    ['a viewer\'s 403', { status: 403, data: { success: false, error: 'Insufficient permissions', required: ['owner'], current: 'viewer' } }, "Viewers can't record deployments. Ask an owner, admin or member."],
    ['a 500, whatever its body says', { status: 500, data: { success: false, error: 'relation "services" does not exist at SELECT id FROM services' } }, 'The deployment could not be recorded. Try again.'],
    ['a 4xx with no message', { status: 400, data: {} }, 'The deployment could not be recorded. Try again.'],
    ['a network error', 'network', 'The deployment could not be recorded. Try again.'],
  ])('%s: shows exactly what the person should see, never axios text or internals', async (_label, reply, shown) => {
    postReply = () => reply
    const dialog = await recordWith('Succeeded')
    expect(await within(dialog).findByTestId('record-deployment-error')).toHaveTextContent(new RegExp(`^${shown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    expect(document.body.textContent).not.toMatch(AXIOS_GENERIC)
    expect(document.body.textContent).not.toMatch(/relation|SELECT|Insufficient permissions|Network Error/)
    expect(within(dialog).queryByTestId('record-deployment-success')).not.toBeInTheDocument()
  })

  it('recordErrorMessage never returns axios\'s generic message', () => {
    const err = new AxiosError('Request failed with status code 418', 'ERR_BAD_REQUEST')
    expect(recordErrorMessage(err)).toBe('The deployment could not be recorded. Try again.')
    expect(recordErrorMessage(new Error('boom'))).toBe('The deployment could not be recorded. Try again.')
  })
})

describe('entry points', () => {
  it('?record=1 opens the form on load and drops the parameter (keeping the others)', async () => {
    nav.params = new URLSearchParams('environment=staging&record=1')
    await renderPage()
    expect(await screen.findByTestId('record-deployment-modal')).toBeInTheDocument()
    expect(nav.replace).toHaveBeenCalledWith('/deployments?environment=staging')
  })

  it('without ?record=1 the form is closed', async () => {
    await renderPage()
    await screen.findByRole('button', { name: 'Record deployment' })
    expect(screen.queryByTestId('record-deployment-modal')).not.toBeInTheDocument()
    expect(nav.replace).not.toHaveBeenCalled()
  })

  it('/deployments/new redirects to /deployments?record=1 and renders no form', () => {
    expect(() => NewDeploymentPage()).toThrow('NEXT_REDIRECT')
    expect(nav.redirect).toHaveBeenCalledWith('/deployments?record=1')
    const source = fs.readFileSync(path.join(ROOT, 'app/(app)/deployments/new/page.tsx'), 'utf8')
    expect(source).not.toMatch(/<form|deploymentsService|api\.post/)
  })

  it('"+ New → Record Deployment" and the command palette open the form', () => {
    expect(quickActions.find(a => a.label === 'Record Deployment')?.href).toBe('/deployments?record=1')
    const palette = fs.readFileSync(path.join(ROOT, 'components/command-palette.tsx'), 'utf8')
    expect(palette).toMatch(/router\.push\('\/deployments\?record=1'\)\)\}>\s*<Rocket[^>]*\/>\s*Record Deployment/)
  })

  it('header and empty-state buttons, subtitle and empty-state copy', async () => {
    listRows = []
    await renderPage()
    expect(await screen.findByText('Track all service deployments across environments · Status as recorded by your pipeline or by hand.')).toBeInTheDocument()
    const empty = await screen.findByTestId('deployment-log-empty')
    fireEvent.click(within(empty).getByRole('button', { name: 'Record first deployment' }))
    expect(await screen.findByTestId('record-deployment-modal')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/New Deployment|Create First Deployment|Connect your CI/)
  })

  it('only one implementation can create deployment rows', () => {
    // The service has a single writer, record(); create / createFromModal are gone.
    expect(Object.keys(deploymentsService).sort()).toEqual(['delete', 'getAll', 'getById', 'getPage', 'getStats', 'record'])
    const files: string[] = []
    for (const dir of ['app', 'components', 'lib']) {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { recursive: true }) as string[]) {
        if (/\.(tsx?|jsx?)$/.test(entry) && !entry.includes('__tests__')) files.push(path.join(dir, entry))
      }
    }
    const posting = files.filter(f => /\.post(<[^(]*>)?\(\s*['"`]\/api\/deployments['"`]/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    expect(posting).toEqual(['lib/services/deployments.service.ts'])
    const recording = files.filter(f => /deploymentsService\.record\(/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')))
    expect(recording).toEqual(['components/deployments/record-deployment-modal.tsx'])
  })
})

describe('failed rows', () => {
  it('recorded by hand: "Recorded by hand · no logs attached", no logs link, no Rollback; a pipeline failure keeps its banner, links and Rollback', async () => {
    listRows = [
      deploymentRow('manual-fail', 'failed', { source: 'manual' }),
      deploymentRow('pipe-fail', 'failed', { source: 'github_actions', github_job_id: 1 }),
    ]
    await renderPage()
    await waitFor(() => expect(screen.getAllByText('Recorded by hand · no logs attached')).toHaveLength(2)) // phone + desktop

    const links = screen.getAllByRole('link').map(a => a.getAttribute('href'))
    expect(links).not.toContain('/deployments/manual-fail')
    expect(links.filter(h => h === '/deployments/pipe-fail')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'View Logs' })).toHaveAttribute('href', '/deployments/pipe-fail')
    expect(screen.getByRole('link', { name: 'Logs' })).toHaveAttribute('href', '/deployments/pipe-fail')
    expect(screen.getByText('Deployment failed · Check logs and consider rolling back to previous version')).toBeInTheDocument()
    expect(screen.getByText('Deployment failed · Check logs')).toBeInTheDocument()
    // Rollback (disabled, "Coming soon"): only on the pipeline row, phone + desktop.
    const rollbacks = screen.getAllByRole('button', { name: 'Rollback · Coming soon' })
    expect(rollbacks).toHaveLength(2)
    const manualBanners = screen.getAllByText('Recorded by hand · no logs attached').map(el => el.closest('div.bg-red-50')!)
    for (const banner of manualBanners) expect(within(banner as HTMLElement).queryByRole('button', { name: /Rollback/ })).toBeNull()
    for (const button of rollbacks) expect(button.closest('div.bg-red-50')).toHaveTextContent(/Deployment failed · Check logs/)
  })
})
