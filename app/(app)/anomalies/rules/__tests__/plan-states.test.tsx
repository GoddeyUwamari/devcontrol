/**
 * /anomalies/rules waits for a known plan: no gate while the organization
 * loads or fails, and rules load only for a known Enterprise plan -- including
 * when that plan arrives after the page mounted (formerly never loaded).
 */
import { vi } from 'vitest'
import { describePlanStates } from '@/lib/contexts/__tests__/org-load-harness'

const getRules = vi.hoisted(() => vi.fn(async () => [{
  id: 'r1', name: 'Nightly spend', metric: 'cost', condition: 'greater_than', threshold: 5,
  timeWindow: '1h', severity: 'warning', enabled: true, createdAt: '2026-10-01T00:00:00Z',
}]))
vi.mock('@/lib/services/custom-anomaly-rules.service', () => ({
  default: { getRules, createRule: vi.fn(), toggleRule: vi.fn(), deleteRule: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import AnomalyRulesPage from '../page'

describePlanStates('/anomalies/rules', {
  render: () => <AnomalyRulesPage />,
  entitledTier: 'enterprise',
  notEntitledTier: 'pro',
  reset: () => getRules.mockClear(),
  paidCalls: () => getRules.mock.calls.length,
  // A loaded rule: proves the rules were fetched after the late plan, not just the header.
  content: 'Nightly spend',
  gate: 'Upgrade to Enterprise',
})
