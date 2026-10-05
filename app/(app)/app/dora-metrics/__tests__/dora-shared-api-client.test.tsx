/**
 * Regression coverage for the DORA Metrics page calling
 * `http://localhost:8080` directly for its service filter, team filter and
 * custom benchmarks. Those raw fetches were refused in production and sent no
 * Bearer token.
 *
 * The real services and shared axios client are used, with only the client's
 * transport stubbed, so the assertions cover the actual requests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import DORAMetricsPage from '../page'

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-1', subscriptionTier: 'enterprise' } }),
}))

vi.mock('@/components/demo/demo-mode-toggle', () => ({
  useDemoMode: () => false,
}))

vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: false }),
}))

// Out of scope here: the metrics call itself is not one of the calls under test.
vi.mock('@/lib/services/dora-metrics.service', () => ({
  doraMetricsService: { getDORAMetrics: vi.fn().mockResolvedValue({ success: true, data: null }) },
}))

const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter
const fetchSpy = vi.fn()

const BENCHMARK_ROW = {
  metric_name: 'deployment_frequency',
  target_value: 3,
  target_unit: 'per_day',
  performance_label: 'Elite',
}

const adapter: AxiosAdapter = async (config) => {
  requests.push(config)
  let data: unknown = { success: true }
  if (config.method === 'get' && config.url === '/api/services') {
    // Backend rows are snake_case; the service maps them.
    data = { success: true, data: [{ id: 'svc-1', name: 'checkout-api', team_id: 'team-1' }] }
  } else if (config.method === 'get' && config.url === '/api/teams') {
    data = { success: true, data: [{ id: 'team-1', name: 'Payments' }] }
  } else if (config.method === 'get' && config.url === '/api/dora/benchmarks') {
    data = { success: true, data: [BENCHMARK_ROW] }
  }
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DORAMetricsPage />
    </QueryClientProvider>
  )
}

const find = (method: string, url: string) => requests.filter((r) => r.method === method && r.url === url)

describe('DORA Metrics page — shared authenticated API client', () => {
  beforeEach(() => {
    requests.length = 0
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
    vi.stubGlobal('fetch', fetchSpy)
    fetchSpy.mockClear()
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('loads services, teams and benchmarks through the shared client with the Bearer token', async () => {
    renderPage()

    await waitFor(() => {
      expect(find('get', '/api/services')).toHaveLength(1)
      expect(find('get', '/api/teams')).toHaveLength(1)
      expect(find('get', '/api/dora/benchmarks')).toHaveLength(1)
    })
    for (const request of requests) {
      expect(request.baseURL).toBe(api.defaults.baseURL)
      expect(request.headers.Authorization).toBe('Bearer test-access-token')
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still reads the benchmark response envelope and saves/resets with the same payload', async () => {
    renderPage()

    // A custom benchmark row from `{ success, data: [...] }` enables "Reset to Default".
    const reset = await screen.findByRole('button', { name: /reset to default/i })
    fireEvent.click(reset)
    await waitFor(() => expect(find('delete', '/api/dora/benchmarks/deployment_frequency')).toHaveLength(1))

    fireEvent.click(screen.getAllByRole('button', { name: /edit|set custom|customi[sz]e/i })[0])
    fireEvent.change(screen.getByPlaceholderText('e.g. 2'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(find('post', '/api/dora/benchmarks')).toHaveLength(1))
    const [post] = find('post', '/api/dora/benchmarks')
    expect(JSON.parse(post.data)).toEqual({
      metric_name: 'deployment_frequency',
      target_value: 5,
      performance_label: 'Elite',
    })
    expect(post.headers.Authorization).toBe('Bearer test-access-token')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('has no hardcoded API origin or raw fetch left in the page source', () => {
    const source = readFileSync(resolve(__dirname, '../page.tsx'), 'utf8')
    expect(source).not.toMatch(/localhost/)
    expect(source).not.toMatch(/\bfetch\(/)
  })
})
