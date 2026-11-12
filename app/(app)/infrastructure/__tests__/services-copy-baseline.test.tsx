/**
 * Services copy (light-lane PR), Infrastructure side: the "Possible savings"
 * tile in every state and the "What needs attention" rows for security-group
 * findings, pinned from the view model and the rendered components with
 * synthetic data. Each output is dumped into __fixtures__/services-copy/; a
 * change shows up as a diff of those files. To regenerate after an approved
 * change:
 *   SERVICES_COPY_FIXTURES=write npx vitest run infrastructure/__tests__/services-copy-baseline
 *
 * Synthetic data only: account 123456789012 and sg-0123456789abcdef0-style
 * placeholder IDs.
 */
process.env.TZ = 'UTC'

import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { render, within } from '@testing-library/react'
import type { RecommendationStats } from '@/lib/types'
import type { AccountSecurityFinding } from '@/lib/services/account-security-findings.service'
import { describeOverview, type OverviewInputs } from '../overview/overviewModel'
import { KpiTiles } from '../overview/KpiTiles'
import { AttentionReview } from '../overview/AttentionReview'
import { NOW, ready, LOADING, ERROR, noAccountCoverage, attentionPage, finding, NO_SAVINGS, inputs } from './overview-fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/infrastructure' }))

const DIR = path.join(__dirname, '__fixtures__', 'services-copy')
const WRITE = process.env.SERVICES_COPY_FIXTURES === 'write'

function pin(name: string, value: unknown): void {
  const file = path.join(DIR, name)
  const body = `${JSON.stringify(value, null, 2)}\n`
  if (WRITE) {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(file, body)
  }
  expect(body).toBe(fs.readFileSync(file, 'utf8'))
}

const view = (o: Partial<OverviewInputs> = {}) => describeOverview(inputs(o), NOW)

// ── Savings ──

function stats(o: Partial<RecommendationStats> & Record<string, unknown>): RecommendationStats {
  return { ...NO_SAVINGS, ...o } as RecommendationStats
}

/**
 * Each tile state. The `estimatedFindings` / `unestimatedFindings` keys are the
 * counts the stats API adds in PR-ICONS-b (as the service maps them); before
 * this PR the tile ignores them.
 */
const SAVINGS_STATES: Record<string, Partial<OverviewInputs>> = {
  'estimate > 0, S3 ceiling, no counts': { savings: ready(stats({
    totalRecommendations: 3, activeRecommendations: 3, totalPotentialSavings: 123.45, potentialSavingsByResourceType: { EBS: 123.45 },
    potentialSavingsCeiling: 41.27, potentialSavingsCeilingByResourceType: { S3: 41.27 },
  })) },
  'estimate > 0, S3 + DynamoDB ceilings, counts 1 and 2': { savings: ready(stats({
    totalRecommendations: 5, activeRecommendations: 5, totalPotentialSavings: 5.17, potentialSavingsByResourceType: { EBS: 5.17 },
    potentialSavingsCeiling: 0.03, potentialSavingsCeilingByResourceType: { S3: 0.01, DynamoDB: 0.02 },
    estimatedFindings: 1, unestimatedFindings: 2,
  })) },
  'estimate > 0, no ceiling, counts 3 and 1': { savings: ready(stats({
    totalRecommendations: 4, activeRecommendations: 4, totalPotentialSavings: 1200, potentialSavingsByResourceType: { EC2: 1200 },
    estimatedFindings: 3, unestimatedFindings: 1,
  })) },
  'estimate > 0, counts 2 and 0': { savings: ready(stats({
    totalRecommendations: 2, activeRecommendations: 2, totalPotentialSavings: 10, potentialSavingsByResourceType: { EBS: 10 },
    estimatedFindings: 2, unestimatedFindings: 0,
  })) },
  'no estimate, S3 ceiling, 2 open': { savings: ready(stats({
    totalRecommendations: 2, activeRecommendations: 2, potentialSavingsCeiling: 0.01, potentialSavingsCeilingByResourceType: { S3: 0.01 },
    estimatedFindings: 0, unestimatedFindings: 1,
  })) },
  'no estimate, DynamoDB ceiling only, 1 open': { savings: ready(stats({
    totalRecommendations: 1, activeRecommendations: 1, potentialSavingsCeiling: 0.02, potentialSavingsCeilingByResourceType: { DynamoDB: 0.02 },
  })) },
  'no estimate, no ceiling, 3 open': { savings: ready(stats({ totalRecommendations: 3, activeRecommendations: 3 })) },
  'zero (no open findings)': { savings: ready(NO_SAVINGS) },
  'zero with a closed history': { savings: ready(stats({ totalRecommendations: 4, activeRecommendations: 0 })) },
  error: { savings: ERROR },
  loading: { savings: LOADING },
  'not connected': { coverage: ready(noAccountCoverage()) },
}

describe('baseline: Infrastructure "Possible savings" tile', () => {
  it('view model, every state', () => {
    const out: Record<string, unknown> = {}
    for (const [state, o] of Object.entries(SAVINGS_STATES)) out[state] = view(o).tiles?.savings ?? null
    pin('infra-savings-tile.json', out)
  })

  it('rendered tile: lines and the value colour', () => {
    const out: Record<string, unknown> = {}
    for (const [state, o] of Object.entries(SAVINGS_STATES)) {
      const tiles = view(o).tiles
      if (!tiles) { out[state] = null; continue }
      const { container, unmount } = render(<KpiTiles tiles={tiles} now={NOW} />)
      const tile = within(container).getByTestId('infra-tile-savings')
      out[state] = {
        lines: [...tile.children].map((c) => c.textContent),
        valueClass: tile.children[1].className,
      }
      unmount()
    }
    pin('infra-savings-tile-rendered.json', out)
  })
})

// ── Security-group rows ──

const SG = 'sg-0123456789abcdef0'
const SG2 = 'sg-0123456789abcdef1'
const SG3 = 'sg-0123456789abcdef2'
const arn = (id: string) => `arn:aws:ec2:us-east-1:123456789012:security-group/${id}`
const evidence = (id: string, name: string) => ({
  schema_version: 1 as const, security_group_id: id, security_group_name: name, vpc_id: 'vpc-0123456789abcdef0', region: 'us-east-1',
  direction: 'ingress' as const, protocol: 'tcp', from_port: 22, to_port: 22, ip_version: 'v4' as const, cidr: '0.0.0.0/0', detected_at: '2026-10-23T13:00:00Z',
})

const SG_FINDINGS: AccountSecurityFinding[] = [
  finding('f-named', { severity: 'critical', resource_identifier: arn(SG), evidence: evidence(SG, 'launch-wizard-1'), title: 'SSH open to the world', recommendation: 'Restrict port 22' }),
  finding('f-no-evidence', { severity: 'high', resource_identifier: arn(SG2), evidence: null, title: 'RDP open to the world' }),
  finding('f-blank-name', { severity: 'high', resource_identifier: arn(SG3), evidence: evidence(SG3, '  '), title: 'All ports open' }),
  finding('f-bare-id', { severity: 'high', resource_identifier: 'sg-0123456789abcdef3', evidence: null, title: 'Bare ID' }),
  finding('f-iam', { category: 'iam', severity: 'high', region: null, resource_identifier: 'arn:aws:iam::123456789012:user/example-user', title: 'Console user without MFA' }),
]

describe('baseline: "What needs attention" security-group rows', () => {
  const o: Partial<OverviewInputs> = { attention: ready(attentionPage([])), accountFindings: ready(SG_FINDINGS) }

  it('view model rows (resource, kind, found, next step) and the section links', () => {
    const attention = view(o).attention!
    if (attention.status !== 'ready') throw new Error('attention not ready')
    pin('infra-sg-rows.json', {
      rows: attention.rows.map((r) => ({ key: r.key, resource: r.resource, resourceKind: r.resourceKind, issue: r.issue, found: r.found, nextStep: r.nextStep })),
      viewAll: attention.viewAll,
      securityLink: attention.securityLink,
    })
  })

  it('rendered rows and links', () => {
    const attention = view(o).attention!
    const { container } = render(<AttentionReview view={attention} now={NOW} onRetry={() => {}} />)
    const table = container.querySelector('table')!
    pin('infra-sg-rows-rendered.json', {
      table: [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent)),
      phone: [...container.querySelectorAll('ul > li')].map((li) => [...li.querySelectorAll('p')].map((p) => p.textContent)),
      reviewButtons: [...table.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
      links: [...container.querySelectorAll('a')].map((a) => ({ text: a.textContent, href: a.getAttribute('href') })),
    })
  })
})
