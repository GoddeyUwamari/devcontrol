/**
 * NEXT_PUBLIC_OBSERVABILITY_V2 (Operational Health, O1):
 * - on only for exactly 'true';
 * - off, or in demo mode (useDemoMode or the sales demo, until O4), the new module is never loaded: a
 *   module-load counter stays at 0, and the same counter reaches 1 with the flag on, so the probe is live.
 *   Each test re-registers the mock with vi.doMock after vi.resetModules(), so the counter is per test;
 * - the legacy page is the page at a93daef: the file differs from it only by two imports, the rename of
 *   MonitoringPage to MonitoringContent, and the wrapper.
 * The legacy render and its requests are pinned for every off value by monitoring-flag-off.test.tsx.
 */
const m = vi.hoisted(() => ({ v2Loads: 0, demo: false, salesDemo: false, log: [] as string[] }))

import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { isObservabilityV2Enabled } from '../observabilityV2Flag'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector?: (state: { enabled: boolean }) => unknown) => (selector ? selector({ enabled: m.salesDemo }) : { enabled: m.salesDemo }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const OFF_VALUES = ['unset', '', 'false', 'TRUE', 'True', '1', 'yes', 'on', ' true', 'true ']
const stubFlag = (value: string) => vi.stubEnv('NEXT_PUBLIC_OBSERVABILITY_V2', value === 'unset' ? (undefined as unknown as string) : value)
const LEGACY_TITLE = 'Infrastructure Intelligence'

beforeEach(() => {
  vi.resetModules()
  m.v2Loads = 0
  vi.doMock('../operational-health/OperationalHealthV2', () => {
    m.v2Loads += 1
    return { default: () => <div data-testid="observability-v2-stub" /> }
  })
  m.demo = false
  m.salesDemo = false
  m.log.length = 0
  global.fetch = vi.fn().mockImplementation((url: string) => {
    m.log.push(new URL(url, 'http://localhost').pathname)
    return Promise.resolve({ ok: false, status: 500, statusText: '500', json: async () => ({}) })
  }) as unknown as typeof fetch
})
afterEach(() => { vi.unstubAllEnvs() })

async function renderPage() {
  const { default: MonitoringPage } = await import('../page')
  const utils = render(<MonitoringPage />)
  for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 0)))
  return utils
}

describe('isObservabilityV2Enabled', () => {
  it.each(OFF_VALUES)('is off for %j', (value) => {
    stubFlag(value)
    expect(isObservabilityV2Enabled()).toBe(false)
  })
  it("is on only for 'true'", () => {
    stubFlag('true')
    expect(isObservabilityV2Enabled()).toBe(true)
  })
})

describe('the new module is loaded only with the flag on, outside demo mode', () => {
  it.each(OFF_VALUES)('flag %j: the legacy page, new module loads = 0', async (value) => {
    stubFlag(value)
    const { unmount } = await renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: LEGACY_TITLE })).toBeInTheDocument()
    expect(screen.queryByTestId('observability-v2-stub')).toBeNull()
    expect(m.v2Loads).toBe(0)
    unmount()
  })
  it("flag 'true': the new module loads once and renders (the probe is live)", async () => {
    stubFlag('true')
    const { unmount } = await renderPage()
    expect(await screen.findByTestId('observability-v2-stub')).toBeInTheDocument()
    expect(m.v2Loads).toBe(1)
    expect(screen.queryByRole('heading', { name: LEGACY_TITLE })).toBeNull()
    // The legacy page's requests are never made.
    expect(m.log).toEqual([])
    unmount()
  })
  it("flag 'true' in demo mode: the legacy page, new module loads = 0", async () => {
    stubFlag('true')
    m.demo = true
    const { unmount } = await renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: LEGACY_TITLE })).toBeInTheDocument()
    expect(m.v2Loads).toBe(0)
    unmount()
  })
  it("flag 'true' in the sales demo: the legacy page, new module loads = 0", async () => {
    stubFlag('true')
    m.salesDemo = true
    const { unmount } = await renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: LEGACY_TITLE })).toBeInTheDocument()
    expect(m.v2Loads).toBe(0)
    unmount()
  })
  it("flag 'true' again, after the demo tests: loads = 1 here too (the counter is per test)", async () => {
    stubFlag('true')
    const { unmount } = await renderPage()
    expect(await screen.findByTestId('observability-v2-stub')).toBeInTheDocument()
    expect(m.v2Loads).toBe(1)
    unmount()
  })
})

describe('MonitoringContent is the page at a93daef', () => {
  const source = readFileSync(join(process.cwd(), 'app/(app)/admin/monitoring/page.tsx'), 'utf8')
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
  // Computed from `git show a93daef:'app/(app)/admin/monitoring/page.tsx'` (the page before Operational Health).
  const A93DAEF_FILE_SHA256 = '25a96fca8ac8fae90b33aae6920d3c0b9a77d02c9be6b0a2a076597b126fe5f2'
  const ADDED_IMPORTS = "import dynamic from 'next/dynamic'\nimport { isObservabilityV2Enabled } from './observabilityV2Flag'\n"
  const WRAPPER = /\n\nconst OperationalHealthV2 = dynamic\(\(\) => import\('\.\/operational-health\/OperationalHealthV2'\)\)\n\n\/\*\*[\s\S]*?\*\/\nexport default function MonitoringPage\(\) \{\n  const demoMode = useDemoMode\(\)\n  const salesDemoMode = useSalesDemo\(\(state\) => state\.enabled\)\n  if \(!isObservabilityV2Enabled\(\) \|\| demoMode \|\| salesDemoMode\) return <MonitoringContent \/>\n  return <OperationalHealthV2 \/>\n\}\n$/

  it('the file is a93daef plus exactly the two imports, the rename and the wrapper', () => {
    expect(source.split(ADDED_IMPORTS)).toHaveLength(2)
    expect(source.split('function MonitoringContent() {\n')).toHaveLength(2)
    expect(WRAPPER.test(source)).toBe(true)
    const restored = source
      .replace(ADDED_IMPORTS, '')
      .replace('function MonitoringContent() {\n', 'export default function MonitoringPage() {\n')
      .replace(WRAPPER, '')
    expect(sha256(restored)).toBe(A93DAEF_FILE_SHA256)
  })
})
