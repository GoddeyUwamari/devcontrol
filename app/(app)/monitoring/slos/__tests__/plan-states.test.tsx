/**
 * /monitoring/slos waits for a known plan: no gate while the organization
 * loads or fails, and SLO evaluation and the resource picker load only for
 * a known Enterprise plan.
 */
import { vi } from 'vitest'
import { describePlanStates } from '@/lib/contexts/__tests__/org-load-harness'

const evaluateAll = vi.hoisted(() => vi.fn(async () => []))
const getResources = vi.hoisted(() => vi.fn(async () => ({ resources: [] })))
vi.mock('@/lib/services/slo.service', () => ({
  default: { evaluateAll, listSlos: vi.fn(), createSlo: vi.fn(), updateSlo: vi.fn(), deleteSlo: vi.fn(), getOptions: vi.fn() },
  SLI_RESOURCE_TYPE: { ec2_availability: 'ec2', alb_latency_avg: 'load-balancer', alb_error_rate: 'load-balancer', lambda_error_rate: 'lambda' },
  SLI_LABEL: { ec2_availability: 'EC2 Availability', alb_latency_avg: 'ALB Average Latency', alb_error_rate: 'ALB Error Rate', lambda_error_rate: 'Lambda Error Rate' },
}))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getAll: getResources } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import SLODashboardPage from '../page'

describePlanStates('/monitoring/slos', {
  render: () => <SLODashboardPage />,
  entitledTier: 'enterprise',
  notEntitledTier: 'starter',
  reset: () => { evaluateAll.mockClear(); getResources.mockClear() },
  paidCalls: () => evaluateAll.mock.calls.length + getResources.mock.calls.length,
  content: 'No SLOs configured',
  gate: 'Upgrade to Enterprise',
})
