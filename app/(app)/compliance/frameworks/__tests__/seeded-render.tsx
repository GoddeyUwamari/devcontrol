/**
 * For the Compliance page's older suites, written before F3b moved the real-mode reads to React Query
 * (lib/compliance/useFrameworkEvaluations): each file still sets its frameworks and runs synchronously, and this
 * seeds them into the query cache under the page's key, so the first render has them. Those files mock '@/lib/api'
 * with a read that never answers, so the seeded data is what the page shows. compliance-frameworks-evaluation and
 * -transitions drive the real reads at the HTTP boundary instead.
 */
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FRAMEWORK_SCANS_LIMIT, type FrameworkResults } from '@/lib/compliance/useFrameworkEvaluations'

/** The page's query key for the mocked organization 'org-1'. */
export const COMPLIANCE_QUERY_KEY = ['compliance', 'org-1', 'frameworks', FRAMEWORK_SCANS_LIMIT]

/** Renders with `results` already read; null leaves the read in flight (loading). */
export function renderSeeded(ui: React.ReactElement, results: Omit<FrameworkResults, 'scansLimit'> | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (results) client.setQueryData(COMPLIANCE_QUERY_KEY, { ...results, scansLimit: FRAMEWORK_SCANS_LIMIT })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
