/**
 * The Security Overview redesign (F2a: shell + read-only findings list), rendered from responses at the
 * HTTP boundary. Copy is pinned to the founder's decisions of Oct 26, 2026 (review log
 * security-v2-f2/founder-decisions.md). The zone is pinned to UTC and Date frozen before anything loads.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return {
    h: { log: [] as string[], routes: {} as Record<string, unknown> },
    role: 'owner' as string | null,
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }
})

import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import SecurityOverviewV2, { FRAMEWORK_SCANS_LIMIT } from '../overview/SecurityOverviewV2'
import {
  ATTENTION_PATH, SCANS_PATH, connectedRoutes, coverage, fail, finding, installFetch, iso, newClient, ok, raw, renderWith, scan, settled,
  type Harness, type Route,
} from './security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('./security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => m.role }))
vi.mock('sonner', () => ({ toast: m.toast }))

const h = m.h as unknown as Harness
const DAY = 86_400_000

// jsdom has no scrollIntoView; the deep-link tests spy on this stand-in.
Element.prototype.scrollIntoView = function scrollIntoView() {}

beforeEach(() => {
  // vitest.setup.ts restores real timers after each test; freeze Date again for this one.
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.routes = connectedRoutes()
  m.role = 'owner'
  m.toast.success.mockReset(); m.toast.error.mockReset()
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch(h)
  window.location.hash = ''
})

async function show(routes: Partial<Record<string, Route>> = {}, pending = 0) {
  Object.assign(h.routes, routes)
  const client = newClient()
  const utils = renderWith(client, <SecurityOverviewV2 />)
  await settled(client, pending)
  return { ...utils, client }
}

const findings = () => document.getElementById('findings') as HTMLElement
const filter = (name: RegExp) => screen.getByRole('button', { name })

describe('requests', () => {
  it('only the existing database reads: no /api/observability/*, no anomaly list, no AWS call on render', async () => {
    await show()
    expect([...h.log].sort()).toEqual([
      'GET /api/aws-resources/compliance',
      'GET /api/compliance-frameworks',
      `GET /api/compliance-frameworks/scans/list?limit=${FRAMEWORK_SCANS_LIMIT}`,
      'GET /api/risk-score/current',
      'GET /api/risk-score/trend?date_range=30d',
      'GET /api/security/account-findings',
      'GET /api/services/coverage',
      'fetch /api/anomalies/stats',
    ])
    expect(h.log.filter((l) => l.includes('/api/observability/'))).toEqual([])
  })
  it('below Pro (402 on the resource list): the needs-attention list instead, one extra read', async () => {
    await show({ 'GET /api/aws-resources/compliance': fail(402) })
    expect(h.log).toContain(`GET ${ATTENTION_PATH}`)
  })
})

describe('layout and copy (founder answers 1, 3; e2 1, 2, 19)', () => {
  it('header, banner, tiles, then findings beside the side column, then the two link cards, in that order', async () => {
    const { container } = await show()
    expect(screen.getByRole('heading', { level: 1, name: 'Security Overview' })).toBeInTheDocument()
    expect(screen.getByText("What's exposed, what to fix first, and what we checked in your AWS account.")).toBeInTheDocument()
    const order = [
      screen.getByRole('heading', { level: 1 }),
      screen.getByTestId('security-banner'),
      screen.getByTestId('security-tile-score'),
      screen.getByRole('heading', { name: 'Security findings' }),
      screen.getByRole('heading', { name: 'Score, last 30 days' }),
      screen.getByRole('heading', { name: 'What we checked' }),
      screen.getByRole('heading', { name: 'Compliance frameworks' }),
      screen.getByRole('link', { name: /^Anomalies\s*Unusual activity and its history$/ }),
      screen.getByRole('link', { name: /^Audit logs\s*Who did what, and when$/ }),
    ]
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy()
    }
    expect(container.innerHTML).not.toMatch(/Draft wording|Control Assessment/i)
  })
  it('tile titles and links', async () => {
    await show()
    for (const [id, title] of [['score', 'Security score'], ['findings', 'Open findings'], ['compliance', 'Compliance baseline'], ['anomalies', 'Anomalies']]) {
      expect(within(screen.getByTestId(`security-tile-${id}`)).getByRole('heading', { name: title })).toBeInTheDocument()
    }
    expect(within(screen.getByTestId('security-tile-score')).getByText('86')).toBeInTheDocument()
    expect(screen.getByTestId('security-tile-score')).toHaveTextContent('86/100')
    expect(within(screen.getByTestId('security-tile-compliance')).getByRole('link', { name: 'Open frameworks →' })).toHaveAttribute('href', '/compliance/frameworks')
    expect(within(screen.getByTestId('security-tile-anomalies')).getByRole('link', { name: 'History →' })).toHaveAttribute('href', '/anomalies')
    expect(screen.getByTestId('security-tile-anomalies')).toHaveTextContent('2 open')
    expect(screen.getByRole('link', { name: 'Manage →' })).toHaveAttribute('href', '/compliance/frameworks')
  })
  it('the banner: headline left, "Not checked yet" right', async () => {
    await show()
    const banner = screen.getByTestId('security-banner')
    expect(banner).toHaveTextContent('1 critical and 1 high-severity findings need review')
    expect(screen.getByTestId('security-not-checked')).toHaveTextContent('Not checked yet: 16 regions · IAM roles and policies')
  })
  it('what we checked uses the mock wording', async () => {
    await show()
    expect(screen.getByTestId('security-checked-iam-users')).toHaveTextContent('IAM users: MFA, key ageChecked')
    expect(screen.getByTestId('security-checked-iam-roles')).toHaveTextContent('IAM roles and policiesNot checked')
  })
  it('no full ARN, account number or key ID anywhere on the page', async () => {
    const { container } = await show()
    expect(container.innerHTML).not.toMatch(/000000000000|AKIA[0-9A-Z]{16}|arn:aws:(iam|ec2)/)
  })
})

describe('header scan line and Sync (answers 5, 6, 12; e2 4, 5; decision 3)', () => {
  const line = () => screen.getByTestId('security-scan-line')
  it('finished: green, "Last scan: today, <time>"', async () => {
    await show()
    expect(line()).toHaveAttribute('data-state', 'finished')
    expect(line()).toHaveTextContent('Last scan: today, 9:00 AM')
    expect(line().querySelector('[aria-hidden="true"]')).not.toBeNull()
  })
  it('running: "Scan running…", Sync disabled', async () => {
    await show({ 'GET /api/services/coverage': raw({ success: true, coverage: coverage({ scan_in_progress: { since: iso(60_000) } }) }) })
    expect(line()).toHaveTextContent('Scan running…')
    expect(screen.getByRole('button', { name: /Sync now/ })).toBeDisabled()
  })
  it('failed: "Last scan failed: <time>"', async () => {
    await show({ 'GET /api/services/coverage': raw({ success: true, coverage: coverage({ last_scan: { status: 'failed', started_at: iso(7_200_000), completed_at: iso(3_600_000), warnings: [] } }) }) })
    expect(line()).toHaveAttribute('data-state', 'failed')
    expect(line()).toHaveTextContent('Last scan failed: today, 2:00 PM')
  })
  it('none finished: "No scan has finished yet."', async () => {
    await show({ 'GET /api/services/coverage': raw({ success: true, coverage: coverage({ last_completed_scan: null, last_successful_scan_at: null, last_scan: null }) }) })
    expect(line()).toHaveTextContent('No scan has finished yet.')
  })
  it('viewer: Sync shown disabled with its reason, never hidden', async () => {
    m.role = 'viewer'
    await show()
    const button = screen.getByRole('button', { name: /Sync now/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription("Viewers can't start a sync")
  })
  it('role not read yet: disabled, no reason; member: enabled', async () => {
    m.role = null
    const first = await show()
    expect(screen.getByRole('button', { name: /Sync now/ })).toBeDisabled()
    expect(screen.queryByText("Viewers can't start a sync")).toBeNull()
    first.unmount()
    m.role = 'member'
    await show()
    expect(screen.getByRole('button', { name: /Sync now/ })).toBeEnabled()
  })
  it('while the sync runs: "Syncing…", disabled', async () => {
    await show({ 'POST /api/services/discover': 'pending' })
    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }))
    expect(await screen.findByRole('button', { name: /Syncing…/ })).toBeDisabled()
  })
  it('success: the approved toast, and the button reads "Sync now" again (no separate done label)', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }))
    await waitFor(() => expect(m.toast.success).toHaveBeenCalledWith('Sync complete — 12 resources discovered'))
    await waitFor(() => expect(screen.getByRole('button', { name: /Sync now/ })).toBeEnabled())
    expect(m.toast.error).not.toHaveBeenCalled()
  })
  it.each([
    [403, "You don't have permission to start a sync."],
    [402, "Your plan's sync limit is reached."],
    [429, 'Too many syncs. Try again in a few minutes.'],
    [500, 'Sync failed — check your AWS connection'],
  ])('a failed sync (%i): its own message, never a success', async (status, text) => {
    await show({ 'POST /api/services/discover': fail(status) })
    fireEvent.click(screen.getByRole('button', { name: /Sync now/ }))
    await waitFor(() => expect(m.toast.error).toHaveBeenCalledWith(text))
    expect(m.toast.success).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: /Sync now/ })).toBeEnabled())
  })
})

describe('tiles: unavailable is never 0', () => {
  it('score error: "—", "Couldn\'t load the score." and Retry', async () => {
    await show({ 'GET /api/risk-score/current': fail(500) })
    const tile = screen.getByTestId('security-tile-score')
    expect(tile).toHaveTextContent("—Couldn't load the score.Retry")
    expect(tile.textContent).not.toMatch(/\d/)
    fireEvent.click(within(tile).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(h.log.filter((l) => l === 'GET /api/risk-score/current')).toHaveLength(2))
  })
  it('score below Pro: "The score is on the Pro plan.", no number', async () => {
    await show({ 'GET /api/risk-score/current': fail(402) })
    const tile = screen.getByTestId('security-tile-score')
    expect(tile).toHaveTextContent('The score is on the Pro plan.')
    expect(tile.textContent).not.toMatch(/\d/)
  })
  it('anomalies error: "Couldn\'t load anomalies." + Retry, no count', async () => {
    await show({ 'GET /api/anomalies/stats': fail(500) })
    const tile = screen.getByTestId('security-tile-anomalies')
    expect(tile).toHaveTextContent("Couldn't load anomalies.")
    expect(within(tile).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(tile.textContent).not.toMatch(/\d|None open/)
  })
  it('compliance: Enterprise note only for a real 402; any other failure is an error', async () => {
    const a = await show({ 'GET /api/compliance-frameworks': fail(402), [`GET ${SCANS_PATH}`]: fail(402) })
    expect(screen.getByTestId('security-tile-compliance')).toHaveTextContent('Compliance frameworks are on the Enterprise plan.')
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')
    a.unmount()
    await show({ 'GET /api/compliance-frameworks': fail(500) })
    expect(screen.getByTestId('security-tile-compliance')).toHaveTextContent("Couldn't load compliance frameworks.")
    expect(screen.queryByText('Compliance frameworks are on the Enterprise plan.')).toBeNull()
  })
  it('zero frameworks: "No frameworks yet."', async () => {
    await show({ 'GET /api/compliance-frameworks': ok([]), [`GET ${SCANS_PATH}`]: ok([]) })
    expect(screen.getByTestId('security-tile-compliance')).toHaveTextContent('No frameworks yet.')
  })
})

describe('the scan limit: one value for the request and the model (carried item 2)', () => {
  const others = (k: number) => Array.from({ length: k }, (_, i) => scan(`o-${i}`, 'other', 'completed', '90', DAY + i * 1000))
  it('the request asks for the limit the model is given', async () => {
    await show()
    expect(FRAMEWORK_SCANS_LIMIT).toBe(50)
    expect(h.log).toContain(`GET /api/compliance-frameworks/scans/list?limit=${FRAMEWORK_SCANS_LIMIT}`)
  })
  it('a full window (50 of 50) is not "never": "Last evaluation not found", "Re-evaluate now" links to the frameworks page', async () => {
    await show({ [`GET ${SCANS_PATH}`]: ok(others(50)) })
    expect(screen.getByTestId('security-tile-compliance')).toHaveTextContent('Last evaluation not found')
    const row = screen.getByTestId('security-framework')
    expect(within(row).getByRole('link', { name: 'Re-evaluate now' })).toHaveAttribute('href', '/compliance/frameworks')
  })
  it('49 of 50 is the whole history: "Never evaluated" and "Evaluate now"', async () => {
    await show({ [`GET ${SCANS_PATH}`]: ok(others(49)) })
    expect(screen.getByTestId('security-tile-compliance')).toHaveTextContent('Never evaluated')
    expect(within(screen.getByTestId('security-framework')).getByRole('link', { name: 'Evaluate now' })).toHaveAttribute('href', '/compliance/frameworks')
  })
  it('a failed run: "Try again" links to the frameworks page', async () => {
    await show({ [`GET ${SCANS_PATH}`]: ok([scan('s-f', 'fw-1', 'failed', null, DAY)]) })
    expect(within(screen.getByTestId('security-framework')).getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/compliance/frameworks')
  })
})

describe('#findings (the Dashboard deep link)', () => {
  it('the anchor is the findings section, unique, and there while the findings load', async () => {
    h.routes['GET /api/security/account-findings'] = 'pending'
    const client = newClient()
    renderWith(client, <SecurityOverviewV2 />)
    await settled(client, 1)
    const anchors = document.querySelectorAll('#findings')
    expect(anchors).toHaveLength(1)
    expect(within(anchors[0] as HTMLElement).getByRole('heading', { name: 'Security findings' })).toBeInTheDocument()
    expect(within(anchors[0] as HTMLElement).getByRole('button', { name: /^All/ })).toBeInTheDocument()
  })
  it('with #findings in the URL: scrolled to once, after the findings settle', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    window.location.hash = '#findings'
    try {
      await show()
      await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
      expect(spy.mock.contexts[0]).toBe(document.getElementById('findings'))
    } finally {
      spy.mockRestore()
    }
  })
  it('without it: no scroll', async () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    try {
      await show()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
  it('the Dashboard still links to /security#findings', () => {
    for (const file of ['components/dashboard/security-compliance-summary.tsx', 'components/dashboard/infrastructure-intelligence.tsx']) {
      expect(readFileSync(join(process.cwd(), file), 'utf8'), file).toMatch(/= '\/security#findings'/)
    }
  })
})

describe('findings list (read-only; founder answers 7–10, e2 13–16)', () => {
  it('filters read "<Label> <count>" with aria-pressed; the toggle is exactly "List | Group by issue"', async () => {
    await show()
    expect(filter(/^All 4$/)).toHaveAttribute('aria-pressed', 'true')
    expect(filter(/^Resources 1$/)).toHaveAttribute('aria-pressed', 'false')
    expect(filter(/^Account 3$/)).toBeInTheDocument()
    expect(filter(/^Accepted 1$/)).toBeInTheDocument()
    expect(filter(/^Dismissed 1$/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Group by issue', pressed: false })).toBeInTheDocument()
    fireEvent.click(filter(/^Resources 1$/))
    expect(filter(/^Resources 1$/)).toHaveAttribute('aria-pressed', 'true')
    expect(filter(/^All 4$/)).toHaveAttribute('aria-pressed', 'false')
  })
  it('severity labels; open rows have no chip; the others say Acknowledged / Risk accepted / Dismissed', async () => {
    await show()
    const rows = within(findings()).getAllByTestId('security-row')
    expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual(['Critical', 'High', 'Medium', 'Medium'])
    const statuses = within(findings()).queryAllByTestId('security-row-status').map((s) => s.textContent)
    expect(statuses).toEqual(['Acknowledged'])
    fireEvent.click(filter(/^Accepted/))
    expect(within(findings()).getAllByTestId('security-row-status').map((s) => s.textContent)).toEqual(['Risk accepted'])
    expect(screen.getByTestId('security-accepted-caption')).toHaveTextContent('Only account findings can be accepted for now.')
    fireEvent.click(filter(/^Dismissed/))
    expect(within(findings()).getAllByTestId('security-row-status').map((s) => s.textContent)).toEqual(['Dismissed'])
    expect(screen.queryByTestId('security-accepted-caption')).toBeNull()
  })
  it('scope labels Account / Resource', async () => {
    await show()
    const text = findings().textContent ?? ''
    expect(text).toContain('Account')
    expect(text).toContain('Resource')
  })
  it('a failed source keeps the loaded findings, says so, and its counts read "not available", never 0', async () => {
    await show({ 'GET /api/security/account-findings': fail(500) })
    expect(within(findings()).getAllByTestId('security-row')).toHaveLength(1)
    expect(screen.getByTestId('security-findings-note')).toHaveTextContent("Some checks couldn't load, so this may be incomplete.")
    expect(filter(/^Account/)).toHaveAccessibleName('Account not available')
    expect(filter(/^Account/)).toHaveTextContent('—')
    expect(filter(/^All/).textContent).not.toMatch(/\d/)
    expect(screen.getByTestId('security-banner')).not.toHaveTextContent(/No critical/)
  })
  it('below Pro: counts as shown, no "+", and the note explains the limit', async () => {
    await show({ 'GET /api/aws-resources/compliance': fail(402) })
    expect(filter(/^Resources 1$/)).toBeInTheDocument()
    expect(findings().textContent).not.toContain('+')
    expect(screen.getByTestId('security-findings-note')).toHaveTextContent('Showing high and critical resource findings.')
  })
  it('empty lines per filter, only when every source loaded', async () => {
    await show({ 'GET /api/security/account-findings': ok([]), 'GET /api/aws-resources/compliance': ok([]) })
    const expected: [RegExp, string][] = [
      [/^All/, 'No findings in the areas we checked.'],
      [/^Resources/, 'No resource findings.'],
      [/^Account/, 'No account findings.'],
      [/^Accepted/, 'No accepted findings.'],
      [/^Dismissed/, 'No dismissed findings.'],
    ]
    for (const [name, text] of expected) {
      fireEvent.click(filter(name))
      expect(screen.getByTestId('security-findings-empty')).toHaveTextContent(text)
    }
  })
  it('no "No … findings." line when a source failed', async () => {
    await show({ 'GET /api/security/account-findings': fail(500), 'GET /api/aws-resources/compliance': ok([]) })
    expect(screen.getByTestId('security-findings-empty')).toHaveTextContent("Some checks couldn't load, so this may be incomplete.")
  })
  it('more than 10: "Showing 10 of 12", "Show all 12", then "Show fewer"', async () => {
    const many = Array.from({ length: 12 }, (_, i) => finding({ id: `af-m${i}`, severity: 'low', title: `IAM user "example-${String(i).padStart(2, '0')}" does not have MFA enabled` }))
    await show({ 'GET /api/security/account-findings': ok(many), 'GET /api/aws-resources/compliance': ok([]) })
    expect(within(findings()).getAllByTestId('security-row')).toHaveLength(10)
    expect(screen.getByText('Showing 10 of 12')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all 12' }))
    expect(within(findings()).getAllByTestId('security-row')).toHaveLength(12)
    expect(screen.getByText('Showing 12 of 12')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }))
    expect(within(findings()).getAllByTestId('security-row')).toHaveLength(10)
  })
  it('group by issue: "<title> · <count>" headings', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: 'Group by issue' }))
    expect(screen.getByRole('button', { name: 'Group by issue', pressed: true })).toBeInTheDocument()
    const groups = within(findings()).getAllByTestId('security-group').map((g) => within(g).getByRole('heading').textContent)
    expect(groups).toEqual([
      'Remote-admin port open to the internet · 1',
      'IAM user "example-ack" does not have MFA enabled · 1',
      'Access key older than 90 days · 1',
      'S3 bucket accepts HTTP · 1',
    ])
  })
  it('no row actions in F2a', async () => {
    await show()
    for (const name of [/Acknowledge/, /Dismiss$/, /Accept risk/i, /Copy policy statement/, /^Review$/]) {
      expect(within(findings()).queryByRole('button', { name })).toBeNull()
    }
  })
})
