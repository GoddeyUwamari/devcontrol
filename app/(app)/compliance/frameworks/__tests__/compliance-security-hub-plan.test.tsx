/**
 * Compliance page and the plan: Security Hub status, sync and the CIS / PCI DSS
 * / NIST views are on Pro and above (lib/plan/entitlements.ts).
 *
 *   - Free / Starter: no Security Hub request at all. Each of the three
 *     standard cards shows the upgrade state in place of its status line; the
 *     Sync button stays, and pressing it shows the upgrade state instead of
 *     sending anything.
 *   - Pro / Enterprise: the reads and the sync go to the server as before.
 *   - Plan still loading: nothing is read, and no upgrade state is shown.
 *   - Custom frameworks (Enterprise) are read as before on every plan.
 *
 * The real page and the real useSecurityHub / security-hub.service, with the
 * shared api client mocked at its methods.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import ComplianceFrameworksPage from '../page'
import { renderSeeded } from './seeded-render'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).ResizeObserver ??= ResizeObserverStub

const calls = vi.hoisted(() => ({ get: [] as string[], post: [] as string[] }))
vi.mock('@/lib/api', () => {
  const answer = (url: string) => {
    if (url === '/api/security-hub/capability') {
      return Promise.resolve({ data: { success: true, capabilityStatus: 'ENABLED', syncStatus: 'COMPLETED', checkedAt: null, error: null, enabledStandards: [] } })
    }
    if (url.startsWith('/api/security-hub/frameworks/')) return Promise.resolve({ data: { success: true, result: null } })
    return new Promise(() => {})
  }
  const api = {
    get: (url: string) => { calls.get.push(url); return answer(url) },
    post: (url: string) => { calls.post.push(url); return Promise.resolve({ data: { success: true } }) },
    put: vi.fn(),
    delete: vi.fn(),
  }
  return { default: api, api, handleApiResponse: (r: { data: { data: unknown } }) => r.data.data }
})

// effective: the tier the server enforces (organization.effectiveTier); null = the same as the stored tier.
const auth = vi.hoisted(() => ({ tier: 'free' as string, effective: null as string | null, status: 'ready' as string }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({
    organization: { id: 'org-1', subscriptionTier: auth.tier, effectiveTier: auth.effective ?? auth.tier },
    organizationStatus: auth.status,
  }),
}))
const BELOW_PRO: Array<[string, string, string]> = [
  ['free', 'free', 'free'],
  ['starter', 'starter', 'starter'],
  ['pro, restricted', 'pro', 'free'],
  ['enterprise, grace period ended', 'enterprise', 'free'],
]
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('@/lib/hooks/useSoc2Readiness', () => ({
  useSoc2Readiness: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }),
}))

const securityHubGets = () => calls.get.filter((url) => url.startsWith('/api/security-hub'))
const tick = () => new Promise((resolve) => setTimeout(resolve, 20))
const render = () => renderSeeded(<ComplianceFrameworksPage />, null)

describe('Compliance page — Security Hub and the plan', () => {
  beforeEach(() => {
    calls.get.length = 0
    calls.post.length = 0
    auth.status = 'ready'
    auth.effective = null
  })

  it.each(BELOW_PRO)('on %s: no Security Hub request; the CIS, PCI DSS and NIST cards show the upgrade state', async (_name, stored, enforced) => {
    auth.tier = stored
    auth.effective = enforced
    render()
    await tick()

    expect(securityHubGets()).toEqual([])
    for (const key of ['cis', 'pci', 'nist']) {
      const notice = within(screen.getByTestId(`standard-${key}`)).getByTestId(`standard-${key}-plan-required`)
      expect(notice).toHaveTextContent('This feature is on the Optimization Engine plan.')
      expect(within(notice).getByText('See plans').closest('a')).toHaveAttribute('href', '/settings/billing/upgrade')
    }
    // SOC 2 is not a Security Hub view: its card is unchanged.
    expect(within(screen.getByTestId('standard-soc2')).queryByTestId(/plan-required/)).not.toBeInTheDocument()
    // Custom frameworks are still read (their own Enterprise rule is unchanged).
    expect(calls.get).toContain('/api/compliance-frameworks')
  })

  it.each(BELOW_PRO)('on %s: Sync Security Hub stays, and pressing it shows the upgrade state and sends nothing', async (_name, stored, enforced) => {
    auth.tier = stored
    auth.effective = enforced
    render()

    const sync = screen.getByRole('button', { name: /Sync Security Hub/ })
    expect(sync).toBeEnabled()
    expect(screen.queryByTestId('security-hub-sync-plan-required')).not.toBeInTheDocument()
    fireEvent.click(sync)
    expect(screen.getByTestId('security-hub-sync-plan-required')).toHaveTextContent('This feature is on the Optimization Engine plan.')
    await tick()
    expect(calls.post).toEqual([])
  })

  it.each(['pro', 'enterprise'])('on %s: status and the three standards are read; the sync is sent', async (tier) => {
    auth.tier = tier
    render()

    await waitFor(() =>
      expect(securityHubGets().sort()).toEqual([
        '/api/security-hub/capability',
        '/api/security-hub/frameworks/cis',
        '/api/security-hub/frameworks/nist',
        '/api/security-hub/frameworks/pci',
      ])
    )
    expect(screen.queryByTestId(/standard-(cis|pci|nist)-plan-required/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Sync Security Hub/ }))
    await waitFor(() => expect(calls.post).toEqual(['/api/security-hub/sync']))
    expect(screen.queryByTestId('security-hub-sync-plan-required')).not.toBeInTheDocument()
  })

  it('while the plan is loading: nothing is read and no upgrade state is shown', async () => {
    auth.tier = 'free'
    auth.status = 'loading'
    render()
    await tick()

    expect(securityHubGets()).toEqual([])
    expect(screen.queryByTestId(/plan-required/)).not.toBeInTheDocument()
  })

  it('while the plan is loading with a leftover Enterprise organization: still nothing is read and no upgrade state', async () => {
    auth.tier = 'enterprise'
    auth.status = 'loading'
    render()
    await tick()

    expect(securityHubGets()).toEqual([])
    expect(screen.queryByTestId(/plan-required/)).not.toBeInTheDocument()
  })
})
