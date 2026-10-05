/**
 * Regression coverage for doraMetricsService calling /api/metrics/dora with a
 * raw fetch that carried no Authorization header. The route sits behind
 * authenticateToken, so the DORA page's metrics could only ever get a 401.
 *
 * The real shared axios client is used with only its transport stubbed, so
 * the assertions cover the request as it would go on the wire.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import { doraMetricsService } from '../dora-metrics.service'

const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter
const fetchSpy = vi.fn()

function stubTransport(status: number, body: unknown, statusText = '') {
  const adapter: AxiosAdapter = async (config) => {
    requests.push(config)
    const response = { data: body, status, statusText, headers: {}, config }
    if (status >= 400) {
      throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, response)
    }
    return response
  }
  api.defaults.adapter = adapter
}

describe('doraMetricsService.getDORAMetrics — shared authenticated API client', () => {
  beforeEach(() => {
    requests.length = 0
    localStorage.setItem('accessToken', 'test-access-token')
    vi.stubGlobal('fetch', fetchSpy)
    fetchSpy.mockClear()
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('requests the relative path through the shared client with the Bearer token', async () => {
    stubTransport(200, { success: true, data: { totalDeployments: 0 } })

    await doraMetricsService.getDORAMetrics()

    expect(requests).toHaveLength(1)
    const [request] = requests
    expect(request.method).toBe('get')
    expect(request.url).toBe('/api/metrics/dora')
    expect(request.baseURL).toBe(api.defaults.baseURL)
    expect(request.headers.Authorization).toBe('Bearer test-access-token')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps the snake_case query parameters the controller reads', async () => {
    stubTransport(200, { success: true, data: {} })

    await doraMetricsService.getDORAMetrics({
      dateRange: '30d',
      serviceId: 'svc-1',
      teamId: 'team-1',
      environment: 'production',
    })

    expect(requests[0].url).toBe(
      '/api/metrics/dora?date_range=30d&service_id=svc-1&team_id=team-1&environment=production'
    )
  })

  it('sends only the filters that are set', async () => {
    stubTransport(200, { success: true, data: {} })

    await doraMetricsService.getDORAMetrics({ dateRange: '7d' })

    expect(requests[0].url).toBe('/api/metrics/dora?date_range=7d')
  })

  it('returns the full { success, data } envelope the DORA page reads', async () => {
    const body = { success: true, data: { deploymentFrequency: { value: 2, unit: 'per day' } } }
    stubTransport(200, body)

    await expect(doraMetricsService.getDORAMetrics({ dateRange: '30d' })).resolves.toEqual(body)
  })

  it("rejects with the backend's error text on a failed response", async () => {
    stubTransport(400, { success: false, error: 'Invalid date_range. Must be one of: 7d, 30d, 90d' })

    await expect(doraMetricsService.getDORAMetrics()).rejects.toThrow(
      'Invalid date_range. Must be one of: 7d, 30d, 90d'
    )
  })

  it('falls back to the status text when the failed response has no error field', async () => {
    stubTransport(502, '<html>Bad Gateway</html>', 'Bad Gateway')

    await expect(doraMetricsService.getDORAMetrics()).rejects.toThrow(
      'Failed to fetch DORA metrics: Bad Gateway'
    )
  })

  it('has no API origin or raw fetch left in the service source', () => {
    const source = readFileSync(resolve(__dirname, '../dora-metrics.service.ts'), 'utf8')
    expect(source).not.toMatch(/localhost/)
    expect(source).not.toMatch(/NEXT_PUBLIC_API_URL/)
    expect(source).not.toMatch(/\bfetch\(/)
  })
})
