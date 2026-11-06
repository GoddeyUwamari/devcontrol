/**
 * /infrastructure with NEXT_PUBLIC_INFRA_OVERVIEW_V2 on (what Production serves):
 * the resource inventory export in the overview header's action column, under
 * Sync. The same existing ExportReportsDialog and POST /api/aws-resources/export
 * (requireTier('starter')) as on the legacy resource table.
 *
 *   - Starter and above: the button opens the dialog; its export calls the
 *     existing endpoint.
 *   - Free: the button stays; pressing it shows the plan text, opens no dialog
 *     and sends no export request.
 *   - No AWS account connected: the header has no action column, so no button.
 *
 * Same mocks as overview-render.test.tsx; every request is logged.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return {
    log: [] as string[],
    tier: 'starter' as string,
    responses: {} as Record<string, () => Promise<unknown>>,
  }
})

const call = vi.hoisted(() => (endpoint: string) => (...args: unknown[]) => {
  m.log.push(endpoint)
  const respond = m.responses[endpoint]
  if (!respond) return Promise.reject(new Error(`unexpected request: ${endpoint} ${JSON.stringify(args)}`))
  return respond()
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { renderInfrastructure, settled } from './overview-harness'
import {
  NOW, coverage, noAccountCoverage, STATS, attentionPage, ACCOUNT_FINDINGS, billedSummary, SAVINGS,
} from './overview-fixtures'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/infrastructure',
}))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => {
    const rank = (t: string) => ({ free: 0, starter: 1, pro: 2, enterprise: 3 } as Record<string, number>)[t] ?? 0
    return {
      tier: m.tier,
      isFree: m.tier === 'free',
      isStarter: rank(m.tier) >= 1,
      isPro: rank(m.tier) >= 2,
      isEnterprise: m.tier === 'enterprise',
      canAccess: (min: string) => rank(m.tier) >= rank(min),
      isKnown: true,
      status: 'known',
    }
  },
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: false }) }))
vi.mock('@/lib/services/aws-services.service', () => ({
  default: {
    getCoverage: call('GET /api/services/coverage'),
    getStats: call('GET /api/services/stats'),
    getServices: call('GET /api/services'),
    discoverServices: call('POST /api/services/discover'),
    getResource: call('GET /api/services/:id'),
  },
}))
vi.mock('@/lib/services/account-security-findings.service', () => ({
  accountSecurityFindingsService: { getActive: call('GET /api/security/account-findings'), getStats: call('GET /api/security/account-findings/stats') },
}))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: { getCostSummary: call('GET /api/platform/costs/summary'), getDashboardStats: call('GET /api/platform/stats/dashboard') },
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getStats: call('GET /api/cost-recommendations/stats'),
    getAll: call('GET /api/cost-recommendations'),
    getActiveCount: call('GET /api/cost-recommendations/stats (count)'),
  },
}))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: call('GET /api/infrastructure') } }))
// The shared API client (the export dialog posts through its named `api`).
vi.mock('@/lib/api', () => {
  const via = (method: string) => (url: string) => call(`${method} ${url}`)()
  const api = { get: via('GET'), post: via('POST'), put: via('PUT'), patch: via('PATCH'), delete: via('DELETE') }
  return { default: api, api, handleApiResponse: (r: unknown) => r }
})
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

const ok = (data: unknown) => () => Promise.resolve(data)
const EXPORT = 'POST /api/aws-resources/export'

function connected() {
  m.responses = {
    'GET /api/services/coverage': ok(coverage()),
    'GET /api/services/stats': ok(STATS),
    'GET /api/services': ok(attentionPage()),
    'GET /api/security/account-findings': ok(ACCOUNT_FINDINGS),
    'GET /api/platform/costs/summary': ok(billedSummary()),
    'GET /api/cost-recommendations/stats': ok(SAVINGS),
    'GET /api/infrastructure': ok([]),
    [EXPORT]: ok({ data: new Blob(['a,b']) }),
  }
}

beforeEach(() => {
  vi.setSystemTime(NOW)
  m.log.length = 0
  m.tier = 'starter'
  vi.stubEnv('NEXT_PUBLIC_INFRA_OVERVIEW_V2', 'true')
  connected()
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  window.URL.createObjectURL = vi.fn(() => 'blob:export')
  window.URL.revokeObjectURL = vi.fn()
})
afterEach(() => { vi.unstubAllEnvs() })

async function renderSettled() {
  const r = renderInfrastructure()
  await screen.findByRole('heading', { level: 1, name: 'Infrastructure Overview' })
  await settled(r.client)
  return r
}

describe('Infrastructure Overview — Export inventory', () => {
  it.each(['starter', 'pro', 'enterprise'])('on %s: the header button opens the existing dialog, whose export calls the existing endpoint', async (tier) => {
    m.tier = tier
    await renderSettled()

    const button = screen.getByTestId('overview-export-button')
    expect(button.textContent?.trim()).toBe('Export inventory')
    // In the header's action column, with Sync.
    const header = document.querySelector('main header') as HTMLElement
    expect(within(header).getByTestId('overview-export-button')).toBe(button)
    expect(within(header).getAllByRole('button', { name: /Sync now/ }).length).toBeGreaterThan(0)

    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Export inventory')
    expect(dialog).toHaveTextContent(`Export ${STATS.total} AWS resources to CSV or PDF`)
    expect(screen.queryByTestId('overview-export-plan-required')).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Export CSV/ }))
    await waitFor(() => expect(m.log).toContain(EXPORT))
    expect(m.log.filter((l) => l === EXPORT)).toHaveLength(1)
  })

  it('on free: the button stays; pressing it shows the plan text, opens no dialog and sends no export request', async () => {
    m.tier = 'free'
    await renderSettled()

    const button = screen.getByTestId('overview-export-button')
    expect(button.textContent?.trim()).toBe('Export inventory')
    expect(button).toBeEnabled()
    fireEvent.click(button)

    const notice = screen.getByTestId('overview-export-plan-required')
    expect(notice).toHaveTextContent('This feature is on the Cost Control plan.')
    expect(within(notice).getByText('See plans').closest('a')).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(m.log).not.toContain(EXPORT)
  })

  it('with no AWS account connected: no action column, so no export button', async () => {
    m.responses['GET /api/services/coverage'] = ok(noAccountCoverage())
    await renderSettled()

    expect(screen.queryByTestId('overview-export-button')).not.toBeInTheDocument()
    expect(m.log).not.toContain(EXPORT)
  })
})
