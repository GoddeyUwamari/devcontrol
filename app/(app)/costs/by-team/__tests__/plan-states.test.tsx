/**
 * /costs/by-team waits for a known plan: no Starter gate while the
 * organization loads or fails, and its data loads only for a known
 * Starter-or-above plan.
 */
import { vi } from 'vitest'
import { describePlanStates } from '@/lib/contexts/__tests__/org-load-harness'

const getDashboardStats = vi.hoisted(() => vi.fn(async () => ({ monthlyAwsCost: 10, costSource: 'actual' })))
const getAccounts = vi.hoisted(() => vi.fn(async () => [{ id: 'acct-1' }]))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getDashboardStats } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import CostsByTeamPage from '../page'

describePlanStates('/costs/by-team', {
  render: () => <CostsByTeamPage />,
  entitledTier: 'starter',
  notEntitledTier: 'free',
  reset: () => { getDashboardStats.mockClear(); getAccounts.mockClear() },
  paidCalls: () => getDashboardStats.mock.calls.length + getAccounts.mock.calls.length,
  content: 'Cost attribution by team and service is not available yet',
  gate: 'Upgrade to Starter',
})
