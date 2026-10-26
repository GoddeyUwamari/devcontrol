/**
 * Deployments page: the DORA links open the app's DORA page (/app/dora-metrics).
 * /dora-metrics is the marketing page; the demo card's "Full report" pointed there.
 *
 * The real page with its client's transport stubbed; demo mode is switched on
 * per test, since the "Full report" link is on the demo DORA card only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import api from '@/lib/api'
import DeploymentsPage from '../page'

let demo = false

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => demo }))
vi.mock('@/lib/demo/sales-demo-data', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: false }),
}))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro' }) }))

const originalAdapter = api.defaults.adapter
const adapter: AxiosAdapter = async (config) => {
  const url = config.url ?? ''
  const data = url.startsWith('/api/deployments/stats')
    ? {
        success: true,
        stats: {
          window_days: 30, total: 0, success: 0, failed: 0, in_progress: 0, no_completion_recorded: 0, unknown: 0,
          change_failure_rate: null, organization_has_deployments: false, last_deployment: null,
        },
      }
    : { success: true, data: [], total: 0 }
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DeploymentsPage />
    </QueryClientProvider>
  )
}

beforeEach(() => { api.defaults.adapter = adapter })
afterEach(() => { api.defaults.adapter = originalAdapter; demo = false })

describe('Deployments: DORA links', () => {
  it("demo mode: the DORA card's Full report link opens the app DORA page", async () => {
    demo = true
    renderPage()
    const link = await screen.findByRole('link', { name: /full report/i })
    expect(link.getAttribute('href')).toBe('/app/dora-metrics')
  })

  it('real mode: View DORA metrics opens the app DORA page', async () => {
    renderPage()
    const link = await screen.findByRole('link', { name: /view dora metrics/i })
    expect(link.getAttribute('href')).toBe('/app/dora-metrics')
  })
})
