/**
 * /infrastructure resource inventory export: the existing ExportReportsDialog
 * and POST /api/aws-resources/export, mounted on the resource table. The
 * endpoint is Starter and above (PLAN_ENTITLEMENTS.resourceInventoryExport,
 * awsResources.routes.ts), decided on the tier the server enforces.
 *
 *   - Starter and above: the button opens the dialog, and the dialog's export
 *     calls the existing endpoint.
 *   - Free, and a restricted or lapsed paid organization (the server enforces
 *     free): the button stays; pressing it shows the upgrade state and
 *     nothing is sent.
 *   - Plan not known yet: the button opens the dialog, as the server decides.
 *   - Demo mode: no export button (demo data is not the organization's).
 *   - A TIER_REQUIRED answer from the server shows the plan's own sentence.
 *
 * Same harness as infrastructure-savings-basis.test.tsx, with the sales demo
 * switch and the organization each test sets. The real usePlan reads it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'

// The organization as /api/auth/me reports it: the stored tier and the tier the server enforces.
const plan = vi.hoisted(() => ({ tier: 'starter' as string, effective: 'starter' as string, known: true }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({
    organization: { id: 'org-1', subscriptionTier: plan.tier, effectiveTier: plan.effective },
    organizationStatus: plan.known ? 'ready' : 'loading',
    retryOrganizationLoad: vi.fn(),
  }),
}))

/** [state, stored tier, enforced tier, export included] */
const STATES: Array<[string, string, string, boolean]> = [
  ['free', 'free', 'free', false],
  ['starter', 'starter', 'starter', true],
  ['pro', 'pro', 'pro', true],
  ['enterprise', 'enterprise', 'enterprise', true],
  ['starter, restricted', 'starter', 'free', false],
  ['pro, grace period ended', 'pro', 'free', false],
]
const setPlan = (stored: string, enforced: string) => { plan.tier = stored; plan.effective = enforced }

vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => null }) }))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getAll: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: vi.fn().mockResolvedValue([]),
    getStats: vi.fn().mockResolvedValue({ totalPotentialSavings: 0 }),
    getActiveCount: vi.fn().mockResolvedValue(0),
  },
}))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: { getDashboardStats: vi.fn().mockResolvedValue({ monthlyAwsCost: 0, activeDeployments: 0, totalServices: 0 }) },
}))
vi.mock('@/lib/services/aws-services.service', () => ({
  default: { getStats: vi.fn().mockResolvedValue({ total: 3, healthy: 3, needs_attention: 0 }), discoverServices: vi.fn() },
}))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const demo = vi.hoisted(() => ({ enabled: false }))
vi.mock('@/lib/demo/sales-demo-data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/demo/sales-demo-data')>()),
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: demo.enabled }),
}))

const post = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>()
  const api = { ...actual.default, post: (...args: unknown[]) => post(...args) }
  return { ...actual, default: api, api }
})

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <InfrastructurePage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('devcontrol_demo_mode', 'false')
  localStorage.setItem('accessToken', 'fake-token')
  plan.known = true
  demo.enabled = false
  post.mockReset().mockResolvedValue({ data: new Blob(['a,b']) })
  global.fetch = vi.fn().mockResolvedValue({ ok: false } as Response) as unknown as typeof fetch
  window.URL.createObjectURL = vi.fn(() => 'blob:export')
  window.URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('/infrastructure resource inventory export', () => {
  it.each(STATES.filter((s) => s[3]))('on %s: the button opens the existing dialog, which calls the existing endpoint', async (_name, stored, enforced) => {
    setPlan(stored, enforced)
    renderPage()

    const button = await screen.findByTestId('inventory-export-button')
    expect(button.textContent?.trim()).toBe('Export inventory')
    fireEvent.click(button)
    // The existing dialog, titled as the button.
    expect(await screen.findByRole('dialog')).toHaveTextContent('Export inventory')
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Export Resources')
    expect(screen.queryByTestId('inventory-export-plan-required')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][0]).toBe('/api/aws-resources/export')
    expect(post.mock.calls[0][1]).toMatchObject({ format: 'csv' })
  })

  it.each(STATES.filter((s) => !s[3]))('on %s: the button stays; pressing it shows the upgrade state, opens no dialog and sends nothing', async (_name, stored, enforced) => {
    setPlan(stored, enforced)
    renderPage()

    const button = await screen.findByTestId('inventory-export-button')
    expect(button.textContent?.trim()).toBe('Export inventory')
    expect(button).toBeEnabled()
    fireEvent.click(button)

    const notice = screen.getByTestId('inventory-export-plan-required')
    expect(notice).toHaveTextContent('This feature is on the Cost Control plan.')
    expect(within(notice).getByText('See plans').closest('a')).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('while the plan is not known: the button opens the dialog (the server decides)', async () => {
    setPlan('free', 'free')
    plan.known = false
    renderPage()

    fireEvent.click(await screen.findByTestId('inventory-export-button'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('inventory-export-plan-required')).not.toBeInTheDocument()
  })

  it("a TIER_REQUIRED answer is shown with the plan's own sentence", async () => {
    setPlan('starter', 'starter')
    const body = {
      success: false, error: 'Subscription tier insufficient', code: 'TIER_REQUIRED',
      details: { currentTier: 'free', requiredTier: 'starter', message: '' },
      upgrade: { cta: '', url: '/settings/billing?upgrade=starter', nextTier: 'starter' },
    }
    post.mockRejectedValue({ response: { status: 402, data: new Blob([JSON.stringify(body)]) } })
    renderPage()

    fireEvent.click(await screen.findByTestId('inventory-export-button'))
    fireEvent.click(await screen.findByRole('button', { name: /Export CSV/ }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Export failed', { description: 'This feature is on the Cost Control plan.' })
    )
  })

  it('demo mode: no export button', async () => {
    demo.enabled = true
    setPlan('enterprise', 'enterprise')
    renderPage()

    await screen.findByText('AWS System Intelligence')
    expect(screen.queryByTestId('inventory-export-button')).not.toBeInTheDocument()
  })
})
