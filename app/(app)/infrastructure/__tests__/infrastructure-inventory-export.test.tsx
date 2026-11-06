/**
 * /infrastructure resource inventory export: the existing ExportReportsDialog
 * and POST /api/aws-resources/export, mounted on the resource table. The
 * endpoint is Starter and above (requireTier('starter'), awsResources.routes.ts).
 *
 *   - Starter and above: the button opens the dialog, and the dialog's export
 *     calls the existing endpoint.
 *   - Free: the button stays; pressing it shows the upgrade state and nothing
 *     is sent.
 *   - Plan not known yet: the button opens the dialog, as the server decides.
 *   - Demo mode: no export button (demo data is not the organization's).
 *   - A TIER_REQUIRED answer from the server shows the plan's own sentence.
 *
 * Same harness as infrastructure-savings-basis.test.tsx, with a plan (and the
 * sales demo switch) that each test sets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import InfrastructurePage from '../page'

type Tier = 'free' | 'starter' | 'pro' | 'enterprise'
const plan = vi.hoisted(() => ({ tier: 'starter' as string, known: true }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => {
    const rank = (t: string) => ({ free: 0, starter: 1, pro: 2, enterprise: 3 } as Record<string, number>)[t] ?? 0
    return {
      tier: plan.tier,
      isFree: plan.tier === 'free',
      isStarter: rank(plan.tier) >= 1,
      isPro: rank(plan.tier) >= 2,
      isEnterprise: plan.tier === 'enterprise',
      canAccess: (min: string) => rank(plan.tier) >= rank(min),
      isKnown: plan.known,
      status: plan.known ? 'known' : 'loading',
    }
  },
}))

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
  it.each(['starter', 'pro', 'enterprise'] as Tier[])('on %s: the button opens the existing dialog, which calls the existing endpoint', async (tier) => {
    plan.tier = tier
    renderPage()

    const button = await screen.findByTestId('inventory-export-button')
    expect(button.textContent?.trim()).toBe('Export inventory')
    fireEvent.click(button)
    // The existing dialog, with its own title.
    expect(await screen.findByRole('dialog')).toHaveTextContent('Export Resources')
    expect(screen.queryByTestId('inventory-export-plan-required')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post.mock.calls[0][0]).toBe('/api/aws-resources/export')
    expect(post.mock.calls[0][1]).toMatchObject({ format: 'csv' })
  })

  it('on free: the button stays; pressing it shows the upgrade state, opens no dialog and sends nothing', async () => {
    plan.tier = 'free'
    renderPage()

    const button = await screen.findByTestId('inventory-export-button')
    expect(button.textContent?.trim()).toBe('Export inventory')
    expect(button).toBeEnabled()
    fireEvent.click(button)

    const notice = screen.getByTestId('inventory-export-plan-required')
    expect(notice).toHaveTextContent('This feature is on the Cost Control plan.')
    expect(screen.getByText('See plans').closest('a')).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('while the plan is not known: the button opens the dialog (the server decides)', async () => {
    plan.tier = 'free'
    plan.known = false
    renderPage()

    fireEvent.click(await screen.findByTestId('inventory-export-button'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('inventory-export-plan-required')).not.toBeInTheDocument()
  })

  it("a TIER_REQUIRED answer is shown with the plan's own sentence", async () => {
    plan.tier = 'starter'
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
    plan.tier = 'enterprise'
    renderPage()

    await screen.findByText('AWS System Intelligence')
    expect(screen.queryByTestId('inventory-export-button')).not.toBeInTheDocument()
  })
})
