/**
 * The Security Overview redesign's expanded row (F2b): Review / Hide, the approved fix guidance, the web-server
 * hint, Copy policy statement and the resource-row link. Rendered from responses at the HTTP boundary, with the
 * copy pinned to the founder's decisions (review log security-v2-f2/founder-decisions.md §2 and §7).
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import SecurityOverviewV2 from '../overview/SecurityOverviewV2'
import { buildHttpsOnlyStatement, guidanceFor } from '../overview/fixGuidance'
import { connectedRoutes, fail, finding, installFetch, newClient, ok, renderWith, settled, FINDINGS, SG, type Harness, type Route } from './security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('./security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => m.role }))
vi.mock('sonner', () => ({ toast: m.toast }))

const h = m.h as unknown as Harness
Element.prototype.scrollIntoView = function scrollIntoView() {}

const WEB = finding({
  id: 'af-web', category: 'networking', region: 'us-east-1', severity: 'medium',
  title: `Security group "example-web-sg" (${SG}) allows HTTPS (port 443) from anywhere (0.0.0.0/0)`,
  evidence: {
    schema_version: 1, security_group_id: SG, security_group_name: 'example-web-sg', region: 'us-east-1', direction: 'ingress',
    protocol: 'tcp', from_port: 443, to_port: 443, ip_version: 'v4', cidr: '0.0.0.0/0', detected_at: '2026-10-23T00:00:00Z',
  },
})

const writeText = vi.fn<(text: string) => Promise<void>>()
function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.routes = connectedRoutes()
  h.routes['GET /api/security/account-findings'] = ok([...FINDINGS, WEB])
  m.role = 'owner'
  m.toast.success.mockReset(); m.toast.error.mockReset()
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch(h)
  window.location.hash = ''
  writeText.mockReset()
  setClipboard({ writeText })
})
afterEach(() => setClipboard(undefined))

async function show(routes: Partial<Record<string, Route>> = {}) {
  Object.assign(h.routes, routes)
  const client = newClient()
  const utils = renderWith(client, <SecurityOverviewV2 />)
  await settled(client)
  return { ...utils, client }
}

const findings = () => document.getElementById('findings') as HTMLElement
const rowOf = (id: string) => findings().querySelector(`[data-row-id="${id}"]`) as HTMLElement
const toggleOf = (id: string) => within(rowOf(id)).getByRole('button', { name: /^(Show|Hide) details for / })
const panelOf = (id: string) => {
  const controls = toggleOf(id).getAttribute('aria-controls')
  return controls ? document.getElementById(controls) : null
}
function expand(id: string) {
  fireEvent.click(toggleOf(id))
  return panelOf(id)!
}
const terms = (panel: HTMLElement) => [...panel.querySelectorAll('dt')].map((d) => d.textContent)
const details = (panel: HTMLElement) => [...panel.querySelectorAll('dd')].map((d) => d.textContent)
const ADMIN = 'account:af-admin'
const HTTPS = 'resource:res-1:s3.https_only'
const KEYLESS = 'account:af-ack'

describe('Review / Hide (e2 21)', () => {
  it('aria-expanded and the accessible name follow the real state; the panel exists only while open', async () => {
    await show()
    const title = rowOf(ADMIN).querySelectorAll('td')[1].querySelector('span > span')!.textContent ?? ''
    expect(title).toBe('Port 22 open to the internet')
    const toggle = toggleOf(ADMIN)
    expect(toggle).toHaveAccessibleName(`Show details for ${title} on example-admin-sg`)
    expect(toggle).toHaveTextContent('Review')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(findings()).queryAllByTestId('security-row-panel')).toHaveLength(0)

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName(`Hide details for ${title} on example-admin-sg`)
    expect(toggle).toHaveTextContent('Hide')
    const panel = panelOf(ADMIN)!
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-testid', 'security-row-panel')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(findings()).queryAllByTestId('security-row-panel')).toHaveLength(0)
  })
  it('every row has its own toggle and "First found <date>" stays on account rows', async () => {
    await show()
    const rows = within(findings()).getAllByTestId('security-row')
    for (const row of rows) expect(within(row).getAllByRole('button', { name: /^Show details for / })).toHaveLength(1)
    expect(rowOf(ADMIN)).toHaveTextContent('First found Oct 13')
  })
})

describe('the guidance panel (e2 7; plan §7)', () => {
  it('a keyed row: the three headings with the approved text, word for word', async () => {
    await show()
    const panel = expand(ADMIN)
    const g = guidanceFor('sg_open_admin')!
    expect(terms(panel)).toEqual(['Why it matters', 'Next step', 'Risk of the fix'])
    expect(details(panel)).toEqual([g.whyItMatters, g.nextStep, g.fixRisk])
  })
  it('a row without a key: its own recommendation, no guidance headings', async () => {
    await show()
    const panel = expand(KEYLESS)
    expect(terms(panel)).toEqual([])
    expect(panel).toHaveTextContent('Review it.')
  })
  it('the web-server hint on an open web port only, never on an admin port', async () => {
    await show()
    expect(within(expand('account:af-web')).getByTestId('security-web-hint')).toHaveTextContent('Expected for a web server? Accept the risk with a reason.')
    expect(within(expand(ADMIN)).queryByTestId('security-web-hint')).toBeNull()
  })
  it('no "Draft wording" label anywhere, with every row open', async () => {
    const { container } = await show()
    for (const toggle of within(findings()).getAllByRole('button', { name: /^Show details for / })) fireEvent.click(toggle)
    expect(within(findings()).getAllByTestId('security-row-panel').length).toBeGreaterThan(3)
    expect(container.textContent).not.toMatch(/draft/i)
  })
})

describe('Copy policy statement (e2 8, 9; D4)', () => {
  const STATEMENT = buildHttpsOnlyStatement('example-bucket')

  it('only on the S3 HTTPS-only row, with entry 7\'s Risk text beside it', async () => {
    await show()
    for (const toggle of within(findings()).getAllByRole('button', { name: /^Show details for / })) fireEvent.click(toggle)
    expect(screen.getAllByRole('button', { name: 'Copy policy statement' })).toHaveLength(1)
    const panel = panelOf(HTTPS)!
    expect(within(panel).getByRole('button', { name: 'Copy policy statement' })).toBeEnabled()
    expect(within(panel).getByTestId('security-copy-risk')).toHaveTextContent(guidanceFor('s3_https_only')!.fixRisk)
    // The Risk text is shown once, under "Risk of the fix", beside the button.
    expect(within(panel).getAllByText(guidanceFor('s3_https_only')!.fixRisk)).toHaveLength(1)
  })
  it('copies exactly one statement, valid JSON, with no request; "Copied" only after the write resolves', async () => {
    await show()
    const panel = expand(HTTPS)
    let resolve!: () => void
    writeText.mockImplementation(() => new Promise<void>((r) => { resolve = r }))
    const before = h.log.length
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy policy statement' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0]
    expect(text).toBe(STATEMENT)
    const parsed = JSON.parse(text)
    expect(Array.isArray(parsed)).toBe(false)
    expect(parsed.Sid).toBe('DenyInsecureTransport')
    expect(parsed).not.toHaveProperty('Statement')
    expect(parsed).not.toHaveProperty('Version')
    expect(within(panel).getByTestId('security-copy-result')).toHaveTextContent(/^$/)
    await act(async () => { resolve() })
    expect(within(panel).getByTestId('security-copy-result')).toHaveTextContent(/^Copied$/)
    expect(within(panel).queryByTestId('security-copy-fallback')).toBeNull()
    expect(h.log.length).toBe(before)
  })
  it('a rejected write: the failure line and, below it, the same statement as read-only text; never "Copied"', async () => {
    await show()
    const panel = expand(HTTPS)
    writeText.mockRejectedValue(new Error('denied'))
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy policy statement' }))
    await waitFor(() => expect(within(panel).getByTestId('security-copy-result')).toHaveTextContent(/^Couldn't copy to the clipboard\.$/))
    expect(panel).not.toHaveTextContent(/Copied/)
    const fallback = within(panel).getByTestId('security-copy-fallback')
    expect(fallback.textContent).toBe(STATEMENT)
    expect(fallback.tagName).toBe('PRE')
    expect(within(panel).getByTestId('security-copy-result').compareDocumentPosition(fallback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('no clipboard API: the same failure, and the statement to select', async () => {
    setClipboard(undefined)
    await show()
    const panel = expand(HTTPS)
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy policy statement' }))
    await waitFor(() => expect(within(panel).getByTestId('security-copy-result')).toHaveTextContent("Couldn't copy to the clipboard."))
    expect(within(panel).getByTestId('security-copy-fallback').textContent).toBe(STATEMENT)
  })
  it('the statement is not shown after a successful copy', async () => {
    await show()
    const panel = expand(HTTPS)
    writeText.mockResolvedValue(undefined)
    fireEvent.click(within(panel).getByRole('button', { name: 'Copy policy statement' }))
    await waitFor(() => expect(within(panel).getByTestId('security-copy-result')).toHaveTextContent('Copied'))
    expect(within(panel).queryByTestId('security-copy-fallback')).toBeNull()
    expect(panel.textContent).not.toContain('DenyInsecureTransport')
  })
})

describe('resource rows before B4: navigation only (Q14; the F2b brief)', () => {
  const NOTE = "This opens the Infrastructure page. It doesn't fix anything. Acknowledge, Accept risk and Dismiss for resource findings come in a later release."

  it('Pro list: no decision actions; the Infrastructure link and the note', async () => {
    await show()
    const panel = expand(HTTPS)
    expect(within(panel).queryByRole('button', { name: /acknowledge|accept risk|dismiss/i })).toBeNull()
    expect(within(panel).getByRole('link', { name: 'Review in Infrastructure →' })).toHaveAttribute('href', '/infrastructure')
    expect(within(panel).getByTestId('security-review-note')).toHaveTextContent(NOTE)
  })
  it('below Pro (needs-attention rows): the same', async () => {
    await show({ 'GET /api/aws-resources/compliance': fail(402) })
    const panel = expand('resource:svc-1')
    expect(within(panel).queryByRole('button', { name: /acknowledge|accept risk|dismiss/i })).toBeNull()
    expect(within(panel).getByRole('link', { name: 'Review in Infrastructure →' })).toHaveAttribute('href', '/infrastructure')
    expect(panel).toHaveTextContent(NOTE)
  })
})
