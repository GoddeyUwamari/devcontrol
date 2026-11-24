/**
 * Board 7 (D8b-2): the Deployment History chip. Only the server's answers;
 * nothing while loading, failed, switched off, in the demo workspace or in
 * demo mode; "Connect →" for owners and admins only (R14).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GitHubStatusChip } from '../github-status-chip'

const svc = vi.hoisted(() => ({
  conn: null as unknown,
  connFails: false,
  repos: [] as unknown[],
  reposFail: false,
  reposPending: false,
}))
vi.mock('@/lib/services/github-connection.service', () => ({
  githubConnectionService: {
    get: vi.fn(async () => { if (svc.connFails) throw new Error('down'); return svc.conn }),
    repositories: vi.fn(() => {
      if (svc.reposPending) return new Promise(() => undefined)
      return svc.reposFail ? Promise.reject(new Error('down')) : Promise.resolve({ repositories: svc.repos, held_event_days: 7 })
    }),
  },
}))
import { githubConnectionService } from '@/lib/services/github-connection.service'

const INSTALLATION = { installation_id: '42', account_login: 'acme-inc', account_type: 'Organization', permissions_state: 'expected', permission_differences: [], suspended_at: null, deleted_at: null }
const on = (over: Record<string, unknown> = {}) => ({ configured: true, can_manage: true, demo: false, installations: [INSTALLATION], last_event_at: null, ...over })
const RULE = { v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy' }
const repo = (id: string, over: Record<string, unknown> = {}) => ({
  id, github_repo_id: id, installation_id: '42', full_name: `acme-inc/${id}`, service_id: 's', service_name: 'svc', deploy_rule: RULE,
  access_state: 'accessible', removed_at: null, last_event_at: null, held_events: 0, environments_seen: [], jobs_seen: [], last_deployment_at: null, over_limit_this_month: 0, ...over,
})

function renderChip(enabled = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><GitHubStatusChip enabled={enabled} /></QueryClientProvider>)
}
const settled = () => waitFor(() => expect(githubConnectionService.get).toHaveBeenCalled())

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(svc, { conn: on(), connFails: false, repos: [], reposFail: false, reposPending: false })
})

describe('GitHubStatusChip', () => {
  it.each([
    [2, 'GitHub · 2 repositories recording'],
    [1, 'GitHub · 1 repository recording'],
  ])('%s recording -> "%s", linking to the GitHub page', async (n, text) => {
    svc.repos = [...Array.from({ length: n }, (_, i) => repo(`r${i}`)), repo('no-rule', { deploy_rule: null }), repo('gone', { access_state: 'removed' })]
    renderChip()
    const chip = await screen.findByTestId('github-status-chip')
    expect(chip).toHaveTextContent(text)
    expect(chip).toHaveAttribute('href', '/settings/integrations/github')
  })

  it('connected with none recording -> "GitHub · Setup incomplete" (R14)', async () => {
    svc.repos = [repo('a', { service_id: null }), repo('b', { deploy_rule: null })]
    renderChip()
    expect(await screen.findByTestId('github-status-chip')).toHaveTextContent('GitHub · Setup incomplete')
  })

  it('an installation needing attention -> "GitHub · Needs attention"', async () => {
    svc.conn = on({ installations: [{ ...INSTALLATION, suspended_at: '2026-11-20T00:00:00Z' }] })
    svc.repos = [repo('a')]
    renderChip()
    expect(await screen.findByTestId('github-status-chip')).toHaveTextContent('GitHub · Needs attention')
  })

  it('not connected: "GitHub · Connect →" for owners and admins; nothing for members', async () => {
    svc.conn = on({ installations: [] })
    const owner = renderChip()
    expect(await screen.findByTestId('github-status-chip')).toHaveTextContent('GitHub · Connect →')
    owner.unmount()
    svc.conn = on({ installations: [], can_manage: false })
    renderChip()
    await settled()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('github-status-chip')).toBeNull()
  })

  it.each([
    ['switched off', () => { svc.conn = { configured: false } }],
    ['the demo workspace', () => { svc.conn = on({ demo: true }) }],
    ['the connection request failed', () => { svc.connFails = true }],
    ['the repositories request failed', () => { svc.reposFail = true }],
    ['the repositories are still loading', () => { svc.reposPending = true }],
  ])('%s: no chip, nothing invented', async (_, arrange) => {
    arrange()
    renderChip()
    await settled()
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByTestId('github-status-chip')).toBeNull()
  })

  it('demo mode (enabled false): no request, no chip', async () => {
    renderChip(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(githubConnectionService.get).not.toHaveBeenCalled()
    expect(screen.queryByTestId('github-status-chip')).toBeNull()
  })
})
