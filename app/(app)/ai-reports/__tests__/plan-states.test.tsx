/**
 * /ai-reports waits for a known plan: no Pro gate while the organization
 * loads or fails, and report history loads only for a known Pro-or-above
 * plan (formerly requested on every mount, for every plan).
 */
import { vi } from 'vitest'
import { describePlanStates } from '@/lib/contexts/__tests__/org-load-harness'

const getReportHistory = vi.hoisted(() => vi.fn(async () => []))
vi.mock('@/lib/services/ai-reports.service', () => ({
  aiReportsService: { getReportHistory, generateReport: vi.fn(), deleteReport: vi.fn(), bulkDeleteReports: vi.fn(), getReport: vi.fn() },
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

import AIReportsPage from '../page'

describePlanStates('/ai-reports', {
  render: () => <AIReportsPage />,
  entitledTier: 'enterprise',
  notEntitledTier: 'free',
  reset: () => getReportHistory.mockClear(),
  paidCalls: () => getReportHistory.mock.calls.length,
  content: /Uncover Cost Savings, Risks, and Insights/,
  gate: 'Pro Plan Required',
})
