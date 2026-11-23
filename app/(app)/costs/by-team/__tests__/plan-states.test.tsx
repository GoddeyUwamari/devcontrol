/**
 * /costs/by-team waits for a known plan: no Starter gate while the
 * organization loads or fails, and its data loads only for a known
 * Starter-or-above plan.
 */
import { vi } from 'vitest'
import { describePlanStates } from '@/lib/contexts/__tests__/org-load-harness'

const getCostSummary = vi.hoisted(() => vi.fn(async () => ({ spend: { state: 'unavailable', source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null }, monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null } })))
const getAccounts = vi.hoisted(() => vi.fn(async () => [{ id: 'acct-1' }]))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => { const accounts = await (getAccounts()); return { accounts, connection: accounts.length > 0 ? 'connected' : 'not_connected' } } } }))
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
  reset: () => { getCostSummary.mockClear(); getAccounts.mockClear() },
  // GET /api/aws/accounts is not plan-gated (aws.routes.ts: authenticate only), and PR4b reads it on every
  // known plan so no AWS account can take the plan lock's place. Only the cost summary is a paid read here.
  paidCalls: () => getCostSummary.mock.calls.length,
  content: 'Cost attribution by team and service is not available yet',
  gate: 'On the Cost Control plan',
})
