/**
 * PR 3d-2 (D10, R7): the legacy /security page (NEXT_PUBLIC_SECURITY_V2 off, or demo mode) prints each
 * anomaly's own region and leaves the segment out without one; it never prints a region the response didn't
 * send. The flag-off snapshots (security-flag-off.test.tsx) pin the "no region" case byte for byte; this file
 * pins the "own region" and "mixed" cases. Same request boundary as that test (the axios instance and fetch).
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  const now = Date.parse('2026-10-23T15:00:00Z')
  vi.useFakeTimers({ toFake: ['Date'], now })
  return now
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SecurityPage from '../page'

const m = vi.hoisted(() => ({ routes: {} as Record<string, unknown> }))

function answer(path: string): Promise<{ data: unknown }> {
  if (!(path in m.routes)) return Promise.reject(Object.assign(new Error('404'), { response: { status: 404, data: {} } }))
  return Promise.resolve({ data: { success: true, data: m.routes[path] } })
}
vi.mock('@/lib/api', () => {
  const api = { get: (p: string) => answer(p), post: (p: string) => answer(p), put: (p: string) => answer(p), delete: (p: string) => answer(p) }
  return {
    default: api, api,
    handleApiResponse: (response: { data: { success: boolean; data: unknown; message?: string } }) => {
      if (!response.data.success) throw new Error(response.data.message || 'API request failed')
      return response.data.data
    },
  }
})
vi.mock('@/lib/services/demo-mode.service', () => ({ demoModeService: { isEnabled: () => false } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString()
const anomaly = (id: string, name: string, region?: string) => ({
  id, organizationId: 'org-1', type: 'cpu_spike', severity: 'critical', resourceName: name, resourceType: 'EC2', metric: 'cpu',
  currentValue: 92, expectedValue: 45, deviation: 104, historicalAverage: 45, historicalStdDev: 5, detectedAt: iso(1), timeWindow: '1h',
  title: `Anomaly on ${name}`, description: '', aiExplanation: '', impact: '', recommendation: '', confidence: 90, status: 'active',
  ...(region ? { region } : {}),
})

function routes(anomalies: unknown[]) {
  m.routes = {
    '/api/risk-score/current': null,
    '/api/compliance-frameworks': [],
    '/api/compliance-frameworks/scans/list?limit=50': [],
    '/api/security/account-findings': [],
    '/api/anomalies': { anomalies },
    '/api/anomalies/stats': { active: anomalies.length, total: anomalies.length },
  }
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const { pathname, search } = new URL(url, 'http://localhost')
    const path = pathname + search
    const ok = path in m.routes
    return Promise.resolve({ ok, status: ok ? 200 : 404, json: async () => (ok ? m.routes[path] : { error: 'failed' }) } as Response)
  }) as unknown as typeof fetch
}

async function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><SecurityPage /></QueryClientProvider>)
  await waitFor(() => expect(client.isFetching()).toBe(0))
  for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
  await waitFor(() => expect(client.isFetching()).toBe(0))
}
const text = () => document.body.textContent ?? ''

beforeEach(() => {
  vi.setSystemTime(NOW)
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  vi.stubEnv('NEXT_PUBLIC_SECURITY_V2', 'false')
})
afterEach(() => { vi.unstubAllEnvs() })

describe('D10: legacy Security prints the anomaly\'s own region', () => {
  it('every critical anomaly in eu-west-1: banner "(eu-west-1)", top risk and list lines "· eu-west-1"; never us-east-1', async () => {
    routes([anomaly('a1', 'worker-a', 'eu-west-1'), anomaly('a2', 'worker-b', 'eu-west-1')])
    await show()
    expect(await screen.findByText('2 critical risks impacting user-facing services (eu-west-1)')).toBeInTheDocument()
    expect(text()).toContain('EC2·worker-a·eu-west-1')
    expect(text()).toContain('EC2 · worker-b · eu-west-1')
    expect(text()).not.toContain('us-east-1')
  })

  it('two regions: both named in the banner, each line its own', async () => {
    routes([anomaly('a1', 'worker-a', 'eu-west-1'), anomaly('a2', 'worker-b', 'ap-south-1')])
    await show()
    expect(await screen.findByText('2 critical risks impacting user-facing services (eu-west-1, ap-south-1)')).toBeInTheDocument()
    expect(text()).toContain('EC2 · worker-b · ap-south-1')
  })

  it('mixed (one without a region): the banner names none; the line without one has no region segment', async () => {
    routes([anomaly('a1', 'worker-a', 'eu-west-1'), anomaly('a2', 'worker-b')])
    await show()
    expect(await screen.findByText('2 critical risks impacting user-facing services')).toBeInTheDocument()
    expect(text()).toContain('EC2 · worker-a · eu-west-1')
    expect(text()).toMatch(/EC2 · worker-b(?! · )/)
    expect(text()).not.toContain('us-east-1')
  })
})
