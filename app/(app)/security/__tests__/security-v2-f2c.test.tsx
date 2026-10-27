/**
 * Security V2 F2c, the fixes after the founder's production check: short row titles per guidance key with the
 * resource in "Where" and the full description kept in the expanded row, the web-server hint in the list,
 * severity pills, "Re-evaluate now" in the compliance panel, and three bottom link cards. Rendered from responses
 * at the HTTP boundary; the wording is pinned to founder-decisions.md §9. (The chart axis: security-v2-trend-axis.)
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  return { h: { log: [] as string[], routes: {} as Record<string, unknown> } }
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import SecurityOverviewV2 from '../overview/SecurityOverviewV2'
import { shortTitle, type GuidanceKey } from '../overview/fixGuidance'
import {
  connectedRoutes, finding, framework, installFetch, newClient, ok, renderWith, scan, settled, SCANS_PATH, SG, type Harness, type Route,
} from './security-v2-fixtures'

vi.mock('@/lib/api', async () => (await import('./security-v2-fixtures')).apiModule(m.h as never))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

const h = m.h as unknown as Harness
Element.prototype.scrollIntoView = function scrollIntoView() {}

const DAY = 86_400_000
const sg = (id: string, severity: string, protocol: string, from: number, to: number, title: string) => finding({
  id, category: 'networking', region: 'us-east-1', severity, title,
  resource_identifier: `arn:aws:ec2:us-east-1:000000000000:security-group/${SG}`,
  evidence: {
    schema_version: 1, security_group_id: SG, security_group_name: 'launch-wizard-1', region: 'us-east-1', direction: 'ingress',
    protocol, from_port: from, to_port: to, ip_version: 'v4', cidr: '0.0.0.0/0', detected_at: '2026-10-23T00:00:00Z',
  },
})
const mfa = (id: string, login: unknown) => finding({
  id: `af-${id}`, severity: 'high', title: `IAM user "example-${id}" does not have MFA enabled`,
  evidence: { schema_version: 1, resource_name: `example-${id}`, finding_type: 'mfa_not_enabled', relevant_aws_attributes: { has_login_profile: login } },
})

const WEB_TITLE = `Security group "launch-wizard-1" (${SG}) allows port 443 from anywhere (0.0.0.0/0)`
const ACCOUNT = [
  sg('af-ssh', 'critical', 'tcp', 22, 22, `Security group "launch-wizard-1" (${SG}) allows port 22 from anywhere (0.0.0.0/0)`),
  sg('af-range', 'medium', 'tcp', 8000, 8080, `Security group "launch-wizard-1" (${SG}) allows ports 8000-8080 from anywhere (0.0.0.0/0)`),
  sg('af-all', 'critical', '-1', -1, -1, `Security group "launch-wizard-1" (${SG}) allows all traffic from anywhere (0.0.0.0/0)`),
  sg('af-web', 'medium', 'tcp', 443, 443, WEB_TITLE),
  mfa('console', true),
  mfa('unknown', 'unknown'),
  finding({
    id: 'af-key', severity: 'medium', title: 'IAM user "example-user" has an access key (AKIAEXAMPLE000000001) that is 120 days old',
    evidence: {
      schema_version: 1, resource_name: 'example-user', finding_type: 'access_key_stale',
      relevant_aws_attributes: { access_key_id: 'AKIAEXAMPLE000000001', age_in_days: 120, key_status: 'Active' },
    },
  }),
  finding({ id: 'af-plain', severity: 'low', category: 'logging', title: 'CloudTrail is not enabled in every region' }),
]
const RESOURCES = [{
  id: 'res-b', resource_name: 'example-bucket', resource_arn: 'arn:aws:s3:::example-bucket', resource_type: 's3', region: 'eu-west-1',
  issues: [
    { severity: 'medium', category: 'encryption', issue: 'Bucket accepts requests over HTTP', recommendation: 'Deny insecure transport.', findingKey: 's3.https_only' },
    { severity: 'high', category: 'access', issue: 'Bucket policy grants public read', recommendation: 'Remove the public grant.', findingKey: 's3.public_access.policy' },
    { severity: 'high', category: 'access', issue: 'Bucket ACL grants AllUsers read', recommendation: 'Remove the ACL grant.', findingKey: 's3.public_access.acl' },
  ],
}]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-23T15:00:00Z') })
  h.log.length = 0
  h.routes = connectedRoutes()
  h.routes['GET /api/security/account-findings'] = ok(ACCOUNT)
  h.routes['GET /api/aws-resources/compliance'] = ok(RESOURCES)
  localStorage.clear()
  localStorage.setItem('accessToken', 'fake-token')
  installFetch(h)
  window.location.hash = ''
})

async function show(routes: Partial<Record<string, Route>> = {}) {
  Object.assign(h.routes, routes)
  const client = newClient()
  const utils = renderWith(client, <SecurityOverviewV2 />)
  await settled(client)
  const all = screen.queryByRole('button', { name: /^Show all / })
  if (all) fireEvent.click(all)
  return utils
}

const findings = () => document.getElementById('findings') as HTMLElement
const rowOf = (id: string) => findings().querySelector(`[data-row-id="${id}"]`) as HTMLElement
const cells = (id: string) => rowOf(id).querySelectorAll('td')
/** The row's title: the first line of its Issue cell. */
const titleOf = (id: string) => cells(id)[1].querySelector('span > span')!.textContent
const whereOf = (id: string) => cells(id)[2].textContent
function expand(id: string) {
  fireEvent.click(within(rowOf(id)).getByRole('button', { name: /^Show details for / }))
  return findings().querySelector('[data-testid="security-row-panel"]') as HTMLElement
}

const TITLES: [string, string][] = [
  ['account:af-ssh', 'Port 22 open to the internet'],
  ['account:af-range', 'Ports 8000–8080 open to the internet'],
  ['account:af-all', 'All ports open to the internet'],
  ['account:af-web', 'Port 443 open to the internet'],
  ['account:af-console', 'Console user without MFA'],
  ['account:af-unknown', 'User without MFA (console access unknown)'],
  ['account:af-key', 'Access key older than 90 days'],
  ['resource:res-b:s3.https_only', 'S3 bucket accepts HTTP'],
  ['resource:res-b:s3.public_access.policy', 'Bucket policy allows public access'],
  ['resource:res-b:s3.public_access.acl', 'Bucket ACL grants access to everyone'],
]

describe('row titles (F2c fix 1)', () => {
  it('shortTitle: the three port shapes, IAM ×3, S3 ×3, and null without a key', () => {
    const ev = (protocol: unknown, from: unknown, to: unknown) => ({ protocol, from_port: from, to_port: to })
    expect(shortTitle('sg_open_admin', ev('tcp', 3389, 3389))).toBe('Port 3389 open to the internet')
    expect(shortTitle('sg_open_other', ev('udp', 1000, 2000))).toBe('Ports 1000–2000 open to the internet')
    expect(shortTitle('sg_open_admin', ev('-1', -1, -1))).toBe('All ports open to the internet')
    expect(shortTitle('sg_open_admin', ev(-1, 0, 0))).toBe('All ports open to the internet')
    // ICMP keeps type and code in the port fields: no port number in the title, the approved group title instead.
    expect(shortTitle('sg_open_other', ev('icmp', 8, 0))).toBe('Port open to the internet')
    const plain: [GuidanceKey, string][] = [
      ['iam_no_mfa_console', 'Console user without MFA'],
      ['iam_no_mfa_unknown', 'User without MFA (console access unknown)'],
      ['iam_key_stale', 'Access key older than 90 days'],
      ['s3_https_only', 'S3 bucket accepts HTTP'],
      ['s3_public_policy', 'Bucket policy allows public access'],
      ['s3_public_acl', 'Bucket ACL grants access to everyone'],
    ]
    for (const [key, title] of plain) expect(shortTitle(key, null), key).toBe(title)
    expect(shortTitle(null, ev('tcp', 22, 22))).toBeNull()
  })

  it('each keyed row shows its short title in the list', async () => {
    await show()
    for (const [id, title] of TITLES) expect(titleOf(id), id).toBe(title)
  })

  it('a range reads "Ports <a>–<b>" with an en dash', async () => {
    await show()
    expect(titleOf('account:af-range')).toBe('Ports 8000–8080 open to the internet')
  })

  it('a row with no guidance key keeps its own title and has no extra description line', async () => {
    await show()
    expect(titleOf('account:af-plain')).toBe('CloudTrail is not enabled in every region')
    expect(within(expand('account:af-plain')).queryByTestId('security-row-description')).toBeNull()
  })

  it('"Where" is name · type · region, without the security group id', async () => {
    await show()
    expect(whereOf('account:af-web')).toBe('launch-wizard-1 · Security group · us-east-1')
    expect(whereOf('account:af-web')).not.toContain(SG)
    expect(within(findings()).getByText(TITLES[0][1]).closest('table')!.textContent).not.toContain(SG)
  })

  it("the scanner's full description is the expanded row's first line, unlabelled", async () => {
    await show()
    const panel = expand('account:af-web')
    const first = within(panel).getByTestId('security-panel').firstElementChild!
    expect(first).toHaveAttribute('data-testid', 'security-row-description')
    expect(first.textContent).toBe(WEB_TITLE)
    expect(first.tagName).toBe('P')
    expect(within(expand('resource:res-b:s3.public_access.acl')).getByTestId('security-row-description')).toHaveTextContent('Bucket ACL grants AllUsers read')
  })

  it('the stale-key description still masks the key id', async () => {
    await show()
    const d = within(expand('account:af-key')).getByTestId('security-row-description').textContent!
    expect(d).toContain('120 days old')
    expect(d).not.toContain('AKIAEXAMPLE000000001')
  })
})

describe('web-server hint in the list (F2c fix 2)', () => {
  it('shows under the open web port title only', async () => {
    await show()
    const hints = within(findings()).getAllByTestId('security-row-web-hint')
    expect(hints).toHaveLength(1)
    expect(hints[0].closest('[data-row-id]')).toHaveAttribute('data-row-id', 'account:af-web')
    expect(hints[0]).toHaveTextContent(/^Expected for a web server\? Accept the risk with a reason\.$/)
    for (const [id] of TITLES.filter(([id]) => id !== 'account:af-web')) {
      expect(within(rowOf(id)).queryByTestId('security-row-web-hint'), id).toBeNull()
    }
  })
})

describe('severity pills (F2c fix 3)', () => {
  it('Critical / High / Medium / Low in the existing badge styles', async () => {
    await show()
    const expected: [string, string, string][] = [
      ['account:af-ssh', 'Critical', 'bg-red-100'],
      ['account:af-console', 'High', 'bg-amber-100'],
      ['account:af-web', 'Medium', 'bg-orange-100'],
      ['account:af-plain', 'Low', 'bg-blue-100'],
    ]
    for (const [id, label, bg] of expected) {
      const pill = cells(id)[0].querySelector('span')!
      expect(pill.textContent, id).toBe(label)
      expect(pill.className, id).toContain('rounded-full')
      expect(pill.className, id).toContain(bg)
    }
  })
})

describe('compliance panel: "Re-evaluate now" (F2c fix 5)', () => {
  it('Out of date, Failed and Never evaluated each link to /compliance/frameworks; Current has no button', async () => {
    await show({
      'GET /api/compliance-frameworks': ok([framework('fw-old', 'Old'), framework('fw-fail', 'Failing'), framework('fw-new', 'New'), framework('fw-ok', 'Fine')]),
      [`GET ${SCANS_PATH}`]: ok([
        scan('s-old', 'fw-old', 'completed', '90', 9 * DAY),
        scan('s-fail', 'fw-fail', 'failed', null, DAY),
        scan('s-ok', 'fw-ok', 'completed', '95', DAY),
      ]),
    })
    const byState = Object.fromEntries(screen.getAllByTestId('security-framework').map((el) => [el.dataset.state, el]))
    for (const state of ['out_of_date', 'failed', 'never']) {
      expect(byState[state], state).toBeDefined()
      expect(within(byState[state]).getByRole('link', { name: 'Re-evaluate now' }), state).toHaveAttribute('href', '/compliance/frameworks')
    }
    expect(within(byState.current).queryByRole('link')).toBeNull()
  })
})

describe('bottom link cards (F2c fix 6)', () => {
  it('three cards with a trailing arrow, in order, with their hrefs; they stack on phones', async () => {
    await show()
    const cards = [
      screen.getByRole('link', { name: /^Anomalies →\s*Unusual activity and its history$/ }),
      screen.getByRole('link', { name: /^Anomaly Rules →\s*Custom detection thresholds$/ }),
      screen.getByRole('link', { name: /^Audit logs →\s*Who did what, and when$/ }),
    ]
    expect(cards.map((c) => c.getAttribute('href'))).toEqual(['/anomalies', '/anomalies/rules', '/audit-logs'])
    const grid = cards[0].parentElement!
    expect([...grid.children]).toEqual(cards)
    expect(grid.className).toContain('grid-cols-1')
  })
})
