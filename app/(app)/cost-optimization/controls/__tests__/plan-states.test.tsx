/**
 * /cost-optimization/controls waits for a known plan: no gate while the
 * organization loads or fails, and the rule configuration loads only for a
 * known Enterprise plan.
 */
import { vi } from 'vitest'
import { describePlanStates } from '@/lib/contexts/__tests__/org-load-harness'

const getConfig = vi.hoisted(() => vi.fn(async () => [{
  ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default',
  default: 10, min: 0, max: 1000, unit: 'invocations_per_30d', type: 'integer',
}]))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getOptimizationRuleConfiguration: getConfig,
    updateOptimizationRuleConfiguration: vi.fn(),
    resetOptimizationRuleConfiguration: vi.fn(),
  },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import OptimizationControlsPage from '../page'

describePlanStates('/cost-optimization/controls', {
  render: () => <OptimizationControlsPage />,
  entitledTier: 'enterprise',
  notEntitledTier: 'pro',
  reset: () => getConfig.mockClear(),
  paidCalls: () => getConfig.mock.calls.length,
  content: 'Low-usage Lambda functions',
  gate: 'Upgrade to Enterprise',
})
