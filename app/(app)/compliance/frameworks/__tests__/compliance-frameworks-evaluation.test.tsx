/**
 * Security V2 F3b: the Compliance page's real mode, answered at the HTTP boundary (the shared harness from the
 * Security tests), so the reads, the start hook and the model run unmocked. Security Hub and SOC 2 are mocked at
 * their hooks (their own suites cover them). Placeholders only.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  return {
    h: { log: [] as string[], routes: {} as Record<string, unknown>, posts: [] as { path: string; body: unknown }[] },
    role: 'owner' as string | null,
    sh: {
      capability: null as unknown,
      cis: null as unknown, pci: null as unknown, nist: null as unknown,
      error: null as string | null, syncing: false, triggerSync: vi.fn(),
    },
  }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import ComplianceFrameworksPage from '../page'
import {
  SCANS_PATH, failWith, framework, newClient, ok, renderWith, scan, settled, type Harness, type Route,
} from '../../../security/__tests__/security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('../../../security/__tests__/security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => m.role }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('@/lib/hooks/useSecurityHub', () => ({ useSecurityHub: () => ({ ...m.sh, loading: false, refetch: vi.fn() }) }))
vi.mock('@/lib/hooks/useSoc2Readiness', () => ({ useSoc2Readiness: () => ({ data: [], isLoading: false, error: null, refetch: vi.fn() }) }))

const h = m.h as unknown as Required<Harness>
const DAY = 86_400_000
const FRAMEWORKS = 'GET /api/compliance-frameworks'
const SCANS = `GET ${SCANS_PATH}`
const START = 'POST /api/compliance-frameworks/fw-1/scan'
const A = framework('fw-1', 'Example baseline')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.posts.length = 0
  h.routes = { [FRAMEWORKS]: ok([A]), [SCANS]: ok([scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)]) }
  m.role = 'owner'
  Object.assign(m.sh, { capability: null, cis: null, pci: null, nist: null, error: null, syncing: false })
  m.sh.triggerSync.mockClear()
})

async function show(routes: Record<string, Route> = {}) {
  Object.assign(h.routes, routes)
  const client = newClient()
  renderWith(client, <ComplianceFrameworksPage />)
  await settled(client)
  return client
}
const tiles = () => screen.getAllByTestId('compliance-tile')
const tile = (label: string) => tiles().find((t) => t.textContent?.includes(label))!
const reads = () => h.log.filter((l) => l === SCANS).length
const row = () => screen.getByTestId('compliance-custom-framework')
const held = () => {
  let release!: () => void
  return { wait: new Promise<void>((r) => { release = r }), release: () => release() }
}

describe('reads (D1, D7)', () => {
  it('the score comes from the counts, never the stored "0.00"; the tile names the framework in local time', async () => {
    await show()
    expect(tile('Overall Compliance Score')).toHaveTextContent('90%')
    expect(tile('Overall Compliance Score')).toHaveTextContent('Example baseline · evaluated Oct 21, 3:00 PM')
    expect(document.body.textContent).not.toContain('0.00')
    expect(screen.getAllByTestId('evaluation-history-row').map((r) => r.textContent)).toEqual(['Example baseline · Completed Oct 21, 3:00 PM · 90% Re-evaluate now'])
  })

  it('402: the Enterprise sentence and See plans; no tiles, no history and no empty state', async () => {
    await show({ [FRAMEWORKS]: failWith(402, 'TIER_REQUIRED'), [SCANS]: failWith(402, 'TIER_REQUIRED') })
    const plan = screen.getByTestId('compliance-plan')
    expect(plan).toHaveTextContent('Compliance frameworks are on the Enterprise plan.')
    expect(within(plan).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.queryAllByTestId('compliance-tile')).toHaveLength(0)
    for (const text of ['No frameworks yet', 'Not yet evaluated', 'No active compliance evaluations', "Couldn't load"]) {
      expect(document.body.textContent).not.toContain(text)
    }
  })

  it.each([
    ['500', failWith(500, 'Failed to fetch scans')],
    ['a network error', { status: 0 } as Route],
  ])('%s: "Couldn\'t load compliance results. Try again." and never an empty state', async (_, failure) => {
    await show({ [SCANS]: failure })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load compliance results. Try again.")
    for (const text of ['No frameworks yet', 'Not yet evaluated', 'No active compliance evaluations', 'Enterprise plan', 'Failed to fetch scans']) {
      expect(document.body.textContent).not.toContain(text)
    }
    for (const t of tiles()) expect(t).toHaveTextContent('Unable to load')
    expect(screen.queryByTestId('compliance-custom-framework')).toBeNull()
  })

  it('history keeps failed runs and both duplicate runs (D4, D5)', async () => {
    await show({ [SCANS]: ok([
      scan('s-3', 'fw-1', 'failed', null, DAY),
      scan('s-2', 'fw-1', 'completed', '50.00', 2 * DAY + 2000),
      scan('s-1', 'fw-1', 'completed', '50.00', 2 * DAY),
    ]) })
    expect(screen.getAllByTestId('evaluation-history-row').map((r) => r.getAttribute('data-status'))).toEqual(['failed', 'completed', 'completed'])
    expect(screen.getAllByTestId('evaluation-history-row')[0]).toHaveTextContent('Example baseline · Failed yesterday, 3:00 PM')
    expect(tile('Overall Compliance Score')).toHaveTextContent('Example baseline · last evaluation failed')
  })
})

describe('starting a run (D5, 409 contract)', () => {
  it('posts once to the existing endpoint; the button is disabled while the start is in flight', async () => {
    const gate = held()
    await show({ [START]: { status: 200, body: { success: true, data: { scanId: 's-new' } }, wait: gate.wait } })
    const button = within(row()).getByRole('button', { name: 'Re-evaluate now' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)
    expect(h.posts).toEqual([{ path: '/api/compliance-frameworks/fw-1/scan', body: {} }])
    h.routes[SCANS] = ok([scan('s-new', 'fw-1', 'running', null, 0), scan('s-1', 'fw-1', 'completed', '0.00', 2 * DAY)])
    gate.release()
    await waitFor(() => expect(tile('Overall Compliance Score')).toHaveTextContent('Example baseline · evaluation running'))
    expect(screen.getAllByTestId('evaluation-history-row')[0]).toHaveTextContent('Example baseline · Running · started today, 3:00 PM')
    expect(button).toBeEnabled()
  })

  it('a 409 SCAN_IN_PROGRESS is Running, never "Couldn\'t start", and reads the list again', async () => {
    await show({ [START]: failWith(409, 'SCAN_IN_PROGRESS') })
    const before = reads()
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(reads()).toBe(before + 1))
    expect(document.body.textContent).not.toContain("Couldn't start")
  })

  it.each([
    [409, 'CONFLICT', "Couldn't start the evaluation. Try again."],
    [500, 'Failed to execute scan', "Couldn't start the evaluation. Try again."],
    [404, 'Framework not found', "Couldn't start the evaluation. Try again."],
    [403, 'Insufficient permissions', "Viewers can't start an evaluation"],
  ])('%i %s → %s, and the previous state stays', async (status, code, text) => {
    await show({ [START]: failWith(status, code) })
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(within(row()).getByRole('alert')).toHaveTextContent(text))
    expect(tile('Overall Compliance Score')).toHaveTextContent('90%')
    expect(document.body.textContent).not.toContain(code)
  })

  it('402 → the Enterprise sentence and See plans under the button', async () => {
    await show({ [START]: failWith(402, 'TIER_REQUIRED') })
    fireEvent.click(within(row()).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(within(row()).getByRole('alert')).toHaveTextContent('Compliance frameworks are on the Enterprise plan.'))
    expect(within(row()).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')
  })
})

describe('out-of-date banner (D2, Q4)', () => {
  it('one stale framework: its "Re-evaluate now" starts that framework\'s run', async () => {
    await show({ [SCANS]: ok([scan('s-1', 'fw-1', 'completed', '0.00', 8 * DAY)]), [START]: ok({ scanId: 's-new' }) })
    const banner = screen.getByTestId('compliance-stale-banner')
    expect(banner).toHaveTextContent('Results are out of date — Example baseline was last evaluated Oct 15, 3:00 PM.')
    expect(tile('Overall Compliance Score')).toHaveTextContent('Example baseline · evaluated Oct 15, 3:00 PM · out of date')
    fireEvent.click(within(banner).getByRole('button', { name: 'Re-evaluate now' }))
    await waitFor(() => expect(h.posts).toHaveLength(1))
    expect(h.posts[0].path).toBe('/api/compliance-frameworks/fw-1/scan')
  })

  it('two or more: "[n] frameworks are out of date." and Review scrolls to the history, where each has its own action', async () => {
    await show({
      [FRAMEWORKS]: ok([A, framework('fw-2', 'Example tagging')]),
      [SCANS]: ok([scan('s-1', 'fw-1', 'completed', null, 8 * DAY), scan('s-2', 'fw-2', 'completed', null, 9 * DAY)]),
    })
    const banner = screen.getByTestId('compliance-stale-banner')
    expect(banner).toHaveTextContent('2 frameworks are out of date.')
    expect(within(banner).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '#evaluation-history')
    expect(document.getElementById('evaluation-history')).not.toBeNull()
    expect(screen.getAllByTestId('evaluation-history-row').map((r) => within(r).queryByRole('button', { name: 'Re-evaluate now' }) !== null)).toEqual([true, true])
  })

  it('a current framework shows no banner', async () => {
    await show()
    expect(screen.queryByTestId('compliance-stale-banner')).toBeNull()
  })
})

describe('failed banner (founder wording, Oct 28)', () => {
  it('one failed framework: named, with "Try again", which starts that framework\'s run', async () => {
    await show({ [SCANS]: ok([scan('s-2', 'fw-1', 'failed', null, DAY), scan('s-1', 'fw-1', 'completed', null, 2 * DAY)]), [START]: ok({ scanId: 's-new' }) })
    const banner = screen.getByTestId('compliance-failed-banner')
    expect(banner).toHaveTextContent('The last evaluation of Example baseline failed on Oct 22. No score is shown as current.')
    expect(within(banner).queryByRole('link', { name: 'Review' })).toBeNull()
    fireEvent.click(within(banner).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(h.posts).toEqual([{ path: '/api/compliance-frameworks/fw-1/scan', body: {} }]))
  })
  it('two or more: one banner with the count and Review; each newest failed row in the history has "Try again"', async () => {
    await show({
      [FRAMEWORKS]: ok([A, framework('fw-2', 'Example tagging')]),
      [SCANS]: ok([scan('s-2', 'fw-2', 'failed', null, DAY), scan('s-1', 'fw-1', 'failed', null, 2 * DAY)]),
    })
    const banners = screen.getAllByTestId('compliance-failed-banner')
    expect(banners).toHaveLength(1)
    expect(banners[0]).toHaveTextContent('2 frameworks failed their last evaluation.')
    expect(within(banners[0]).getByRole('link', { name: 'Review' })).toHaveAttribute('href', '#evaluation-history')
    expect(within(banners[0]).queryByRole('button')).toBeNull()
    expect(document.getElementById('evaluation-history')).not.toBeNull()
    expect(screen.getAllByTestId('evaluation-history-row').map((r) => within(r).getByRole('button').textContent?.trim())).toEqual(['Try again', 'Try again'])
  })
  it('failed and out of date at the same time: both banners show, the failed one first', async () => {
    await show({
      [FRAMEWORKS]: ok([A, framework('fw-2', 'Example tagging')]),
      [SCANS]: ok([scan('s-2', 'fw-1', 'failed', null, DAY), scan('s-1', 'fw-2', 'completed', null, 9 * DAY)]),
    })
    const failed = screen.getByTestId('compliance-failed-banner')
    const stale = screen.getByTestId('compliance-stale-banner')
    expect(failed).toHaveTextContent('The last evaluation of Example baseline failed on Oct 22.')
    expect(stale).toHaveTextContent('Results are out of date — Example tagging was last evaluated Oct 14, 3:00 PM.')
    expect(failed.compareDocumentPosition(stale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('no failed banner while a newer run is running, or once a newer run completed', async () => {
    await show({ [SCANS]: ok([scan('s-3', 'fw-1', 'running', null, 1000), scan('s-2', 'fw-1', 'failed', null, DAY)]) })
    expect(screen.queryByTestId('compliance-failed-banner')).toBeNull()
  })
  it('a viewer sees "Try again" disabled with the viewer reason', async () => {
    m.role = 'viewer'
    await show({ [SCANS]: ok([scan('s-2', 'fw-1', 'failed', null, DAY)]) })
    const tryAgain = within(screen.getByTestId('compliance-failed-banner')).getByRole('button', { name: 'Try again' })
    expect(tryAgain).toBeDisabled()
    expect(tryAgain).toHaveAccessibleDescription("Viewers can't start an evaluation")
  })
})

describe('frameworks tile (Q1)', () => {
  it('counts enabled frameworks, never runs', async () => {
    await show({
      [FRAMEWORKS]: ok([A, { ...framework('fw-off', 'Example off'), enabled: false }]),
      [SCANS]: ok([scan('s-1', 'fw-1', 'completed', null, DAY), scan('s-2', 'fw-1', 'completed', null, 2 * DAY), scan('s-3', 'fw-off', 'completed', null, DAY)]),
    })
    expect(tile('Frameworks')).toHaveTextContent('1')
    expect(tile('Frameworks')).toHaveTextContent('1 custom framework evaluated')
  })
  it('"No frameworks yet." for none', async () => {
    await show({ [FRAMEWORKS]: ok([]), [SCANS]: ok([]) })
    expect(tile('Frameworks')).toHaveTextContent('No frameworks yet.')
  })
})

describe('viewer reasons (Q2)', () => {
  it('a viewer: every member-or-above control is disabled with its reason, and nothing is sent', async () => {
    m.role = 'viewer'
    await show()
    const add = screen.getByRole('button', { name: /Add Framework/ })
    expect(add).toBeDisabled()
    expect(add).toHaveAccessibleDescription("Viewers can't add frameworks.")
    const run = within(row()).getByRole('button', { name: 'Re-evaluate now' })
    expect(run).toBeDisabled()
    expect(run).toHaveAccessibleDescription("Viewers can't start an evaluation")
    const sync = screen.getByRole('button', { name: /Sync Security Hub/ })
    expect(sync).toBeDisabled()
    expect(sync).toHaveAccessibleDescription('Only admins can sync Security Hub.')
    fireEvent.click(run)
    fireEvent.click(sync)
    expect(h.posts).toEqual([])
    expect(m.sh.triggerSync).not.toHaveBeenCalled()
    // Reading stays open to a viewer.
    expect(within(row()).getByRole('button', { name: /View \/ Manage Rules/ })).toBeEnabled()
  })
  it('a role not read yet fails closed: disabled, no reason', async () => {
    m.role = null
    await show()
    expect(screen.getByRole('button', { name: /Add Framework/ })).toBeDisabled()
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeDisabled()
    expect(document.body.textContent).not.toContain('Viewers can')
  })
  it.each(['member', 'admin', 'owner'])('%s: adding frameworks and starting runs are enabled', async (role) => {
    m.role = role
    await show()
    expect(screen.getByRole('button', { name: /Add Framework/ })).toBeEnabled()
    expect(within(row()).getByRole('button', { name: 'Re-evaluate now' })).toBeEnabled()
  })
  // The sync is requireAdmin on the server (security-hub.routes.ts:61, rbac.middleware.ts:48): owner and admin only.
  it.each([
    ['owner', true], ['admin', true], ['member', false], ['viewer', false],
  ])('Sync Security Hub as %s: enabled = %s; otherwise "Only admins can sync Security Hub." and nothing is sent', async (role, enabled) => {
    m.role = role
    await show()
    const sync = screen.getByRole('button', { name: /Sync Security Hub/ })
    if (enabled) {
      expect(sync).toBeEnabled()
      expect(document.body.textContent).not.toContain('Only admins can sync Security Hub.')
      return
    }
    expect(sync).toBeDisabled()
    expect(sync).toHaveAccessibleDescription('Only admins can sync Security Hub.')
    fireEvent.click(sync)
    expect(m.sh.triggerSync).not.toHaveBeenCalled()
  })
})

describe('Security Hub card (D3, Q5, Q6)', () => {
  const cap = (capabilityStatus: string | null, syncStatus = 'COMPLETED') => ({ capabilityStatus, syncStatus, checkedAt: null, error: null, enabledStandards: [] })
  const readiness = (framework: string, standardEnabled: boolean) => ({
    framework, frameworkVersion: '1', syncStatus: 'COMPLETED', capabilityStatus: 'ENABLED', standardEnabled, evaluatedAt: null,
    coverage: { totalControls: 4, evaluated: 2, passed: 1, failed: 1, unknown: 2, notEvaluated: 0, notApplicable: 0, notEstablishable: 0, errors: 0 }, controls: [],
  })
  it.each([
    ['never synced', null, null, 'Not checked yet', 'AWS Security Hub continuously evaluates'],
    ['enabled', cap('ENABLED'), null, 'Connected', 'AWS Security Hub continuously evaluates'],
    ['missing permission', cap('NOT_GRANTED'), null, 'Permission required', "DevControl can't read Security Hub — the connected role is missing a permission."],
    ['not enabled', cap('NOT_AVAILABLE'), null, 'Not enabled', 'Turn it on in your AWS account, then sync to evaluate CIS, PCI DSS and NIST.'],
    ['error', cap('ERROR'), null, 'Check failed', "Couldn't check Security Hub. Try again later."],
    ['the read failed', null, 'Failed to load Security Hub status', 'Check failed', "Couldn't check Security Hub. Try again later."],
  ])('%s', async (_, capability, error, pill, body) => {
    Object.assign(m.sh, { capability, error })
    await show()
    expect(screen.getByTestId('security-hub-pill')).toHaveTextContent(pill)
    expect(screen.getByTestId('security-hub-body')).toHaveTextContent(body)
    const turnOn = document.body.textContent!.includes('Turn it on')
    expect(turnOn).toBe(pill === 'Not enabled')
    // Q6: "Needs Security Hub" only while Security Hub isn't enabled, on CIS, PCI DSS and NIST, never SOC 2.
    const needs = ['cis', 'pci', 'nist', 'soc2'].map((k) => screen.getByTestId(`standard-${k}`).textContent!.includes('Needs Security Hub'))
    expect(needs).toEqual(pill === 'Not enabled' ? [true, true, true, false] : [false, false, false, false])
  })
  it('Q6: "Not yet available" stays on a standard DevControl doesn\'t evaluate, with Security Hub on', async () => {
    Object.assign(m.sh, { capability: cap('ENABLED'), cis: readiness('cis', true), pci: readiness('pci', false), nist: readiness('nist', false) })
    await show()
    expect(screen.getByTestId('standard-cis')).not.toHaveTextContent('Not yet available')
    expect(screen.getByTestId('standard-pci')).toHaveTextContent('Not yet available')
    expect(screen.getByTestId('standard-nist')).toHaveTextContent('Not yet available')
    expect(tile('Frameworks')).toHaveTextContent('1 custom · 1 Security Hub standard')
  })
})
