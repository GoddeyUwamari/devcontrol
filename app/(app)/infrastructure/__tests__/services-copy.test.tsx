/**
 * Services copy (light-lane PR), Infrastructure side:
 * - "Possible savings": the weekly email's sentences in every state, green only
 *   for an estimate above $0, the API's own finding counts used only when sent
 *   (never computed here), DynamoDB never labelled S3, and the zero / error /
 *   not-connected states exactly as before;
 * - "What needs attention": a security group reads "<name> (sg-…)", or the
 *   sg- ID alone; the stored identifier, order and links are unchanged.
 * Synthetic data only (account 123456789012, placeholder sg- IDs).
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, within } from '@testing-library/react'
import type { RecommendationStats } from '@/lib/types'
import type { AccountSecurityFinding, SecurityGroupEvidence } from '@/lib/services/account-security-findings.service'
import { describeOverview, rankAttention, securityGroupLabel, OVERVIEW_COPY, type OverviewInputs } from '../overview/overviewModel'
import { KpiTiles } from '../overview/KpiTiles'
import { AttentionReview } from '../overview/AttentionReview'
import { NOW, ready, LOADING, ERROR, noAccountCoverage, attentionPage, finding, NO_SAVINGS, inputs } from './overview-fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/infrastructure' }))

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', () => ({ default: { get: mockGet }, handleApiResponse: (r: { data: { data: unknown } }) => r.data.data }))
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'

const view = (o: Partial<OverviewInputs> = {}) => describeOverview(inputs(o), NOW)
const stats = (o: Partial<RecommendationStats>): RecommendationStats => ({ ...NO_SAVINGS, ...o })
const savingsOf = (o: Partial<RecommendationStats>) => view({ savings: ready(stats(o)) }).tiles!.savings
const lines = (captions: unknown[][]) => captions.map((c) => c.join(''))

const SOURCE = OVERVIEW_COPY.savingsSource

// ── Possible savings ──

describe('savings: estimate > 0', () => {
  const base = { totalRecommendations: 5, activeRecommendations: 5, totalPotentialSavings: 5.17, potentialSavingsByResourceType: { EBS: 5.17 } }

  it('with the API counts: "across N", "K more … no dollar estimate yet", then the upper bounds; green', () => {
    const s = savingsOf({ ...base, potentialSavingsCeilingByResourceType: { S3: 0.01, DynamoDB: 0.02 }, estimatedFindings: 1, unestimatedFindings: 2 })
    expect(s.value).toBe('$5.17/month')
    expect(s.tone).toBe('success')
    expect(lines(s.captions)).toEqual([
      'Estimated savings: $5.17/month across 1 open finding. This is a DevControl estimate, not realized savings.',
      '2 more open findings have no dollar estimate yet.',
      'Plus up to $0.01/month if S3 data qualifies for Standard-IA (upper bound, not included above).',
      'Plus up to $0.02/month if DynamoDB provisioned capacity were cut to its observed peak (upper bound, not included above).',
      SOURCE,
    ])
  })

  it('plural N, singular K', () => {
    const s = savingsOf({ ...base, totalPotentialSavings: 1200, estimatedFindings: 3, unestimatedFindings: 1 })
    expect(lines(s.captions)).toEqual([
      'Estimated savings: $1,200.00/month across 3 open findings. This is a DevControl estimate, not realized savings.',
      '1 more open finding has no dollar estimate yet.',
      SOURCE,
    ])
  })

  it('K = 0: no "more" line', () => {
    const s = savingsOf({ ...base, totalPotentialSavings: 10, estimatedFindings: 2, unestimatedFindings: 0 })
    expect(lines(s.captions)).toEqual(['Estimated savings: $10.00/month across 2 open findings. This is a DevControl estimate, not realized savings.', SOURCE])
  })

  it.each([
    ['absent', {}],
    ['null', { estimatedFindings: null, unestimatedFindings: null }],
  ])('counts %s: the sentence without a count and no "more" line; nothing computed from the active count', (_label, counts) => {
    const s = savingsOf({ ...base, activeRecommendations: 7, potentialSavingsCeilingByResourceType: { S3: 0.01 }, ...counts })
    expect(s.tone).toBe('success')
    expect(lines(s.captions)).toEqual([
      'Estimated savings: $5.17/month. This is a DevControl estimate, not realized savings.',
      'Plus up to $0.01/month if S3 data qualifies for Standard-IA (upper bound, not included above).',
      SOURCE,
    ])
    expect(JSON.stringify(s)).not.toMatch(/open finding|\b7\b|\b5\b more/)
  })

  it('only one count sent: each is used on its own', () => {
    expect(lines(savingsOf({ ...base, estimatedFindings: 4 }).captions)[0]).toBe('Estimated savings: $5.17/month across 4 open findings. This is a DevControl estimate, not realized savings.')
    expect(lines(savingsOf({ ...base, estimatedFindings: 4 }).captions)).toHaveLength(2)
    expect(lines(savingsOf({ ...base, unestimatedFindings: 3 }).captions)).toEqual([
      'Estimated savings: $5.17/month. This is a DevControl estimate, not realized savings.',
      '3 more open findings have no dollar estimate yet.',
      SOURCE,
    ])
  })
})

describe('savings: open findings, no estimate > 0', () => {
  it('"N open findings; none has a dollar estimate yet." then "Up to" lines without "Plus"/"not included above"; neutral, never $0', () => {
    const s = savingsOf({ totalRecommendations: 2, activeRecommendations: 2, potentialSavingsCeilingByResourceType: { S3: 0.01 } })
    expect(s.value).toBe('No dollar estimate')
    expect(s.tone).toBeUndefined()
    expect(lines(s.captions)).toEqual([
      '2 open findings; none has a dollar estimate yet.',
      'Up to $0.01/month if S3 data qualifies for Standard-IA (upper bound).',
      SOURCE,
    ])
    expect(JSON.stringify(s)).not.toMatch(/\$0\.00|Plus|not included above/)
  })

  it('singular, no ceiling, uses the active count even when the API counts are sent', () => {
    const s = savingsOf({ totalRecommendations: 1, activeRecommendations: 1, estimatedFindings: 0, unestimatedFindings: 1 })
    expect(lines(s.captions)).toEqual(['1 open finding; none has a dollar estimate yet.', SOURCE])
  })

  it('DynamoDB is never labelled S3', () => {
    const s = savingsOf({ totalRecommendations: 1, activeRecommendations: 1, potentialSavingsCeilingByResourceType: { DynamoDB: 0.02 } })
    expect(lines(s.captions)).toEqual([
      '1 open finding; none has a dollar estimate yet.',
      'Up to $0.02/month if DynamoDB provisioned capacity were cut to its observed peak (upper bound).',
      SOURCE,
    ])
    expect(JSON.stringify(s)).not.toMatch(/S3|Standard-IA/)
    const withEstimate = savingsOf({ totalRecommendations: 2, activeRecommendations: 2, totalPotentialSavings: 3, potentialSavingsCeilingByResourceType: { DynamoDB: 0.02 } })
    expect(JSON.stringify(withEstimate)).not.toMatch(/S3|Standard-IA/)
  })

  it('a non-finite total is not an estimate', () => {
    expect(savingsOf({ activeRecommendations: 2, totalPotentialSavings: Number.NaN }).value).toBe('No dollar estimate')
  })
})

describe('savings: zero, error and not connected are unchanged', () => {
  it('no open findings: the exact pre-PR tile', () => {
    expect(savingsOf({})).toEqual({
      key: 'savings', label: 'Possible savings', link: { text: 'Review recommendations →', href: '/cost-optimization' },
      value: '$0.00/mo est.', captions: [[SOURCE], [OVERVIEW_COPY.savingsNone]],
    })
  })
  it('error and loading', () => {
    expect(view({ savings: ERROR }).tiles!.savings).toEqual({
      key: 'savings', label: 'Possible savings', link: { text: 'Review recommendations →', href: '/cost-optimization' },
      value: '—', captions: [[OVERVIEW_COPY.savingsError]],
    })
    expect(view({ savings: LOADING }).tiles!.savings.value).toBe('…')
  })
  it('not connected: no tiles', () => {
    expect(view({ coverage: ready(noAccountCoverage()) }).tiles).toBeNull()
  })
})

describe('savings tile render: green only for an estimate > 0', () => {
  const valueClass = (o: Partial<RecommendationStats> | 'error') => {
    const tiles = view({ savings: o === 'error' ? ERROR : ready(stats(o)) }).tiles!
    const { getByTestId, unmount } = render(<KpiTiles tiles={tiles} now={NOW} />)
    const cls = getByTestId('infra-tile-savings').children[1].className
    unmount()
    return cls
  }
  it.each([
    ['estimate > 0', { activeRecommendations: 1, totalPotentialSavings: 1 }, true],
    ['no estimate', { activeRecommendations: 1 }, false],
    ['zero', {}, false],
    ['error', 'error' as const, false],
  ])('%s', (_l, o, green) => {
    const cls = valueClass(o as Partial<RecommendationStats> | 'error')
    if (green) expect(cls).toMatch(/text-ink-success/)
    else { expect(cls).not.toMatch(/success|green|emerald/); expect(cls).toMatch(/text-slate-900/) }
  })
})

describe('GET /api/cost-recommendations/stats mapping', () => {
  beforeEach(() => mockGet.mockReset())
  const respond = (extra: Record<string, unknown>) => mockGet.mockResolvedValue({ data: { data: {
    total_recommendations: 3, active_recommendations: 3, total_potential_savings: '5.17', potential_savings_by_resource_type: {},
    potential_savings_ceiling: 0, potential_savings_ceiling_by_resource_type: {}, by_severity: { high: 0, medium: 0, low: 0 }, ...extra,
  } } })

  it('maps estimated_findings / unestimated_findings when sent', async () => {
    respond({ estimated_findings: 2, unestimated_findings: 0 })
    expect(await costRecommendationsService.getStats()).toMatchObject({ estimatedFindings: 2, unestimatedFindings: 0 })
  })
  it.each([
    ['absent', {}],
    ['null', { estimated_findings: null, unestimated_findings: null }],
    ['strings', { estimated_findings: '2', unestimated_findings: '1' }],
    ['negative / fractional', { estimated_findings: -1, unestimated_findings: 1.5 }],
  ])('%s: null, never 0', async (_l, extra) => {
    respond(extra)
    expect(await costRecommendationsService.getStats()).toMatchObject({ estimatedFindings: null, unestimatedFindings: null })
  })
})

// ── Security-group rows ──

const SG = 'sg-0123456789abcdef0'
const arn = (id: string) => `arn:aws:ec2:us-east-1:123456789012:security-group/${id}`
const evidence = (id: string, name: string): SecurityGroupEvidence => ({
  schema_version: 1, security_group_id: id, security_group_name: name, region: 'us-east-1',
  direction: 'ingress', protocol: 'tcp', from_port: 22, to_port: 22, ip_version: 'v4', cidr: '0.0.0.0/0', detected_at: '2026-10-23T13:00:00Z',
})

describe('securityGroupLabel', () => {
  it.each([
    ['ARN + name', arn(SG), evidence(SG, 'launch-wizard-1'), `launch-wizard-1 (${SG})`],
    ['ARN, no evidence', arn(SG), null, SG],
    ['ARN, blank name', arn(SG), evidence(SG, '   '), SG],
    ['bare sg- ID + name', SG, evidence(SG, 'web'), `web (${SG})`],
    ['evidence about another group: its name is not used', arn(SG), evidence('sg-0123456789abcdef9', 'other'), SG],
    ['no sg- ID in the identifier: the evidence ID', 'some-group', evidence(SG, 'web'), `web (${SG})`],
    ['nothing to go on: the stored identifier as it is', 'some-group', null, 'some-group'],
    ['name equal to the ID', arn(SG), evidence(SG, SG), SG],
  ])('%s', (_l, resource_identifier, ev, expected) => {
    expect(securityGroupLabel({ resource_identifier, evidence: ev })).toBe(expected)
  })
})

describe('"What needs attention": security groups', () => {
  const findings: AccountSecurityFinding[] = [
    finding('f-named', { severity: 'critical', resource_identifier: arn(SG), evidence: evidence(SG, 'launch-wizard-1'), title: 'SSH open to the world', recommendation: 'Restrict port 22' }),
    finding('f-unnamed', { severity: 'high', resource_identifier: arn('sg-0123456789abcdef1'), evidence: null, title: 'RDP open' }),
    finding('f-iam', { category: 'iam', severity: 'high', region: null, resource_identifier: 'arn:aws:iam::123456789012:user/example-user', title: 'No MFA', recommendation: 'Enable MFA' }),
  ]

  it('rows show "<name> (sg-…)" or the sg- ID; IAM rows, found text, next step and order are unchanged; the stored finding is untouched', () => {
    const before = JSON.stringify(findings)
    const rows = rankAttention([], findings, null)
    expect(rows.map((r) => [r.key, r.resource, r.resourceKind])).toEqual([
      ['account-f-named', `launch-wizard-1 (${SG})`, 'Security group'],
      // Ordered by the stored identifier, as before: arn:aws:ec2… sorts before arn:aws:iam….
      ['account-f-unnamed', 'sg-0123456789abcdef1', 'Security group'],
      ['account-f-iam', 'arn:aws:iam::123456789012:user/example-user', 'IAM user'],
    ])
    expect(rows[0].found).toBe('SSH open to the world (security group)')
    expect(rows[0].nextStep).toEqual({ text: 'Restrict port 22' })
    expect(JSON.stringify(findings)).toBe(before)
    expect(JSON.stringify(rows)).not.toMatch(/arn:aws:ec2|0\.0\.0\.0/)
  })

  it('rendered: table, phone list, Review labels and the same links', () => {
    const attention = view({ attention: ready(attentionPage([])), accountFindings: ready(findings) }).attention!
    const { container } = render(<AttentionReview view={attention} now={NOW} onRetry={() => {}} />)
    const table = container.querySelector('table')!
    expect(within(table).getByRole('rowheader', { name: 'SSH open to the world' }).closest('tr')).toHaveTextContent(`launch-wizard-1 (${SG}) Security group`)
    expect(within(table).getByRole('button', { name: `Review launch-wizard-1 (${SG})` })).toBeInTheDocument()
    expect(within(table).getByRole('button', { name: 'Review sg-0123456789abcdef1' })).toBeInTheDocument()
    expect([...container.querySelectorAll('ul > li p')].map((p) => p.textContent)).toContain(`launch-wizard-1 (${SG}) · Security group · us-east-1`)
    expect([...container.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Security findings →', '/security']])
    expect(container.textContent).not.toMatch(/arn:aws:ec2/)
  })
})
