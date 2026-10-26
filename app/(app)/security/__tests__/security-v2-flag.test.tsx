/**
 * NEXT_PUBLIC_SECURITY_V2 (Security V2, F2a):
 * - on only for exactly 'true';
 * - off (or in demo mode), the V2 module is never loaded: a module-load counter stays at 0, and the same
 *   counter reaches 1 with the flag on, so the probe is live. The counter is per test: vi.resetModules()
 *   alone keeps vitest's mock registry (a factory runs once per file), so each test also re-registers the
 *   V2 mock with vi.doMock, and every off value and demo mode is proven on its own;
 * - the legacy page is the page at af3262e: SecurityContent's body is byte for byte the old SecurityPage
 *   body, and the whole file differs from af3262e only by the two imports and the wrapper.
 * The legacy render and its requests are pinned for every off value by security-flag-off.test.tsx.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return { v2Loads: 0, demo: false, log: [] as string[] }
})

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { isSecurityV2Enabled } from '../securityV2Flag'

vi.mock('@/lib/services/demo-mode.service', () => ({ demoModeService: { isEnabled: () => m.demo } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/api', () => {
  const reject = (method: string) => (path: string) => {
    m.log.push(`${method} ${path}`)
    return Promise.reject(Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: {} } }))
  }
  const api = { get: reject('GET'), post: reject('POST'), put: reject('PUT'), delete: reject('DELETE') }
  return { default: api, api, handleApiResponse: (r: { data: { data: unknown } }) => r.data.data }
})

const OFF_VALUES = ['unset', '', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']
const stubFlag = (value: string) => vi.stubEnv('NEXT_PUBLIC_SECURITY_V2', value === 'unset' ? (undefined as unknown as string) : value)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  vi.resetModules()
  m.v2Loads = 0
  // Re-registered for every test, so its factory (the counter) runs again on this test's first load.
  vi.doMock('../overview/SecurityOverviewV2', () => {
    m.v2Loads += 1
    return { default: () => <div data-testid="security-v2-stub" /> }
  })
  m.demo = false
  m.log.length = 0
  global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch
})
afterEach(() => { vi.unstubAllEnvs() })

/** A fresh copy of the page module (vi.resetModules), so a V2 load in one test can't hide one in another. */
async function renderPage() {
  const { default: SecurityPage } = await import('../page')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(<QueryClientProvider client={client}><SecurityPage /></QueryClientProvider>)
  // Let next/dynamic and the legacy page's requests run.
  for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return utils
}

describe('isSecurityV2Enabled', () => {
  it.each(OFF_VALUES)('is off for %j', (value) => {
    stubFlag(value)
    expect(isSecurityV2Enabled()).toBe(false)
  })
  it("is on only for 'true'", () => {
    stubFlag('true')
    expect(isSecurityV2Enabled()).toBe(true)
  })
})

describe('the V2 module is loaded only with the flag on, outside demo mode', () => {
  it.each(OFF_VALUES)('flag %j: the legacy page, V2 module loads = 0', async (value) => {
    stubFlag(value)
    await renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Cloud Security Command Center' })).toBeInTheDocument()
    expect(screen.queryByTestId('security-v2-stub')).toBeNull()
    expect(m.v2Loads).toBe(0)
  })
  it("flag 'true': the V2 module loads once and renders (the probe is live)", async () => {
    stubFlag('true')
    await renderPage()
    expect(await screen.findByTestId('security-v2-stub')).toBeInTheDocument()
    expect(m.v2Loads).toBe(1)
    expect(screen.queryByRole('heading', { name: 'Cloud Security Command Center' })).toBeNull()
  })
  it("flag 'true' in demo mode: the legacy page, V2 module loads = 0 (plan Q13)", async () => {
    stubFlag('true')
    m.demo = true
    await renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Cloud Security Command Center' })).toBeInTheDocument()
    expect(screen.queryByTestId('security-v2-stub')).toBeNull()
    expect(m.v2Loads).toBe(0)
  })
  it("flag 'true' again, after the demo test: loads = 1 here too (the counter is per test, not per file)", async () => {
    stubFlag('true')
    await renderPage()
    expect(await screen.findByTestId('security-v2-stub')).toBeInTheDocument()
    expect(m.v2Loads).toBe(1)
  })
  it('flag off: the legacy page makes its own requests and nothing of the redesign', async () => {
    stubFlag('false')
    await renderPage()
    expect(m.log.some((l) => l.includes('/api/services/coverage') || l.includes('/api/aws-resources/compliance'))).toBe(false)
  })
})

describe('SecurityContent is the page at af3262e', () => {
  const source = readFileSync(join(process.cwd(), 'app/(app)/security/page.tsx'), 'utf8')
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
  // Computed from `git show af3262e:'app/(app)/security/page.tsx'` (the page before Security V2).
  const AF3262E_BODY_SHA256 = '2e8dc819bd1e8438f99d5215517f33ecafbdd4c59d64390668e03f8a2ce0498b'
  const AF3262E_FILE_SHA256 = '27dbaf73b9bc362d5f1293cbf28b4139d1bf8b164f601282e492d62bb90ff315'
  const ADDED_IMPORTS = "import dynamic from 'next/dynamic'\nimport { isSecurityV2Enabled } from './securityV2Flag'\n"
  const WRAPPER = /const SecurityOverviewV2 = dynamic\(\(\) => import\('\.\/overview\/SecurityOverviewV2'\)\)\n\n\/\*\*[\s\S]*?\*\/\nexport default function SecurityPage\(\) \{\n  if \(!isSecurityV2Enabled\(\) \|\| demoModeService\.isEnabled\(\)\) return <SecurityContent \/>\n  return <SecurityOverviewV2 \/>\n\}\n\nfunction SecurityContent\(\) \{\n/

  it("SecurityContent's body is byte for byte the old SecurityPage body", () => {
    const parts = source.split('function SecurityContent() {\n')
    expect(parts).toHaveLength(2)
    expect(sha256(parts[1])).toBe(AF3262E_BODY_SHA256)
  })
  it('the file is af3262e plus exactly the two imports and the wrapper', () => {
    expect(source.split(ADDED_IMPORTS)).toHaveLength(2)
    expect(source.match(new RegExp(WRAPPER.source, 'g'))).toHaveLength(1)
    const restored = source.replace(ADDED_IMPORTS, '').replace(WRAPPER, 'export default function SecurityPage() {\n')
    expect(sha256(restored)).toBe(AF3262E_FILE_SHA256)
  })
})
