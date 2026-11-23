/**
 * PR2 empty states, Security V2: with no AWS account connected the page is the header (title, subtitle, an
 * outlined "Connect AWS account" in place of Scan now), the four tiles as label and "—" only, the shared
 * NotConnectedCard and the bottom links. No stale scan line or banner, findings, plan pitches or What we
 * checked. Connected, the page is unchanged. Until coverage answers, grey blocks only.
 * Synthetic data only.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return {
    h: { log: [] as string[], routes: {} as Record<string, unknown> },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import SecurityOverviewV2 from '../overview/SecurityOverviewV2'
import { SCANS_PATH, connectedRoutes, coverage, fail, installFetch, iso, newClient, raw, renderWith, settled, type Harness, type Route } from './security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('./security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('sonner', () => ({ toast: m.toast }))

const h = m.h as unknown as Harness
const DAY = 86_400_000
const TILES = ['score', 'findings', 'compliance', 'anomalies'] as const

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.routes = connectedRoutes()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch(h)
})

async function show(routes: Partial<Record<string, Route>> = {}, pending = 0) {
  Object.assign(h.routes, routes)
  const client = newClient()
  const utils = renderWith(client, <SecurityOverviewV2 />)
  await settled(client, pending)
  return utils
}

/** No account now; a failed scan, findings and plan answers left from an earlier connection. */
const NOT_CONNECTED: Partial<Record<string, Route>> = {
  'GET /api/services/coverage': raw({
    success: true,
    coverage: coverage({
      account: { connected: false, status: null, home_region: null },
      last_scan: { status: 'failed', started_at: iso(DAY), completed_at: iso(DAY), warnings: [] },
    }),
  }),
  'GET /api/risk-score/current': fail(402),
  'GET /api/risk-score/trend?date_range=30d': fail(402),
  'GET /api/compliance-frameworks': fail(402),
  [`GET ${SCANS_PATH}`]: fail(402),
}

describe('PR2: Security with no AWS account connected', () => {
  it('header: subtitle kept, outlined Connect AWS account in place of Scan now, no scan line', async () => {
    await show(NOT_CONNECTED)
    expect(screen.getByText("What's exposed, what to fix first, and what we checked in your AWS account.")).toBeInTheDocument()
    const header = screen.getByRole('banner')
    expect(within(header).getByTestId('connect-aws-header-button')).toHaveAttribute('href', '/connect-aws')
    expect(within(header).getByRole('link', { name: 'Connect AWS account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Scan now|Scanning/ })).toBeNull()
    expect(screen.queryByTestId('security-scan-line')).toBeNull()
  })

  it('the four tiles: label and "—" only (no caption, plan pitch, link or retry)', async () => {
    await show(NOT_CONNECTED)
    for (const id of TILES) {
      const tile = screen.getByTestId(`security-tile-${id}`)
      expect(within(tile).getByTestId('unmeasured-value')).toHaveTextContent('—')
      expect(within(tile).queryByRole('link')).toBeNull()
      expect(within(tile).queryByRole('button')).toBeNull()
      expect(tile.querySelectorAll('p')).toHaveLength(1)
    }
  })

  it('the shared card and the bottom links; nothing else from an earlier connection or a plan', async () => {
    const { container } = await show(NOT_CONNECTED)
    const card = screen.getByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(within(card).getByRole('link', { name: 'Connect AWS account' })).toHaveAttribute('href', '/connect-aws')
    for (const name of [/^Anomalies\s*Unusual activity/, /^Anomaly Rules/, /^Audit logs/]) expect(screen.getByRole('link', { name })).toBeInTheDocument()
    expect(screen.queryByTestId('security-banner')).toBeNull()
    for (const name of ['Security findings', 'Score, last 30 days', 'What we checked', 'Compliance frameworks']) {
      expect(screen.queryByRole('heading', { name })).toBeNull()
    }
    expect(container.textContent).not.toMatch(/didn.t finish|Showing high and critical|Optimization Engine plan|See plans|Enterprise/)
  })

  it('coverage loading: grey blocks only (no tiles, card, button or banner)', async () => {
    await show({ 'GET /api/services/coverage': 'pending' }, 1)
    expect(screen.getByTestId('connection-loading')).toBeInTheDocument()
    expect(screen.getByTestId('connection-loading-tiles').children).toHaveLength(4)
    expect(screen.getByTestId('header-action-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('security-tile-score')).toBeNull()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('security-banner')).toBeNull()
  })
})

describe('PR2: Security connected is unchanged', () => {
  it('Scan now, the tiles with their numbers and links, findings; no card, no Connect button', async () => {
    await show()
    expect(screen.getByRole('button', { name: /Scan now/ })).toBeInTheDocument()
    expect(screen.getByTestId('security-tile-score')).toHaveTextContent('86/100')
    expect(within(screen.getByTestId('security-tile-anomalies')).getByRole('link', { name: 'History →' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Security findings' })).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByTestId('connect-aws-header-button')).toBeNull()
    expect(screen.queryByTestId('unmeasured-value')).toBeNull()
  })

  it('a real zero stays: no open anomalies is "None open", never "—"', async () => {
    await show({ 'GET /api/anomalies/stats': raw({ success: true, stats: { active: 0, total: 0 } }) })
    expect(screen.getByTestId('security-tile-anomalies')).toHaveTextContent('None open')
    expect(screen.getByTestId('security-tile-anomalies')).not.toHaveTextContent('—')
  })

  it('a failed coverage read is neither state: no card, no Connect button', async () => {
    await show({ 'GET /api/services/coverage': fail(500) })
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByTestId('connect-aws-header-button')).toBeNull()
    expect(screen.queryByTestId('connection-loading')).toBeNull()
  })
})
