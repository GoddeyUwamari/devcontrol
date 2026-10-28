/**
 * /remediation waits for a known plan: no gate while the organization loads
 * or fails, and the workflow list (and its 10 s poll) only for a known
 * Enterprise plan.
 */
import { vi } from 'vitest'
import { describePlanStates } from '@/lib/contexts/__tests__/org-load-harness'

const list = vi.hoisted(() => vi.fn(async () => []))
const get = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/remediation.service', () => ({
  remediationService: { list, get, approve: vi.fn(), reject: vi.fn(), execute: vi.fn(), rollback: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import RemediationPage from '../page'

describePlanStates('/remediation', {
  render: () => <RemediationPage />,
  entitledTier: 'enterprise',
  notEntitledTier: 'pro',
  reset: () => { list.mockClear(); get.mockClear() },
  paidCalls: () => list.mock.calls.length + get.mock.calls.length,
  content: /Approval-based infrastructure remediation/,
  gate: 'Upgrade to Enterprise',
})
