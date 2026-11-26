/**
 * C1b: rdsIdleSavingsExplanation -- the approved explanation under a priced
 * idle RDS finding, built only from the finding's own price key; nothing for a
 * finding with no estimate, an upper bound, or another issue.
 *
 * Fix round (review B-2): rdsIdleEstimateWithheld -- an idle RDS row that
 * claims an estimate but lacks a price field, or whose figure is missing, not a
 * number or not above $0 (a stored 0 included), is no estimate: the card reads
 * "No dollar estimate" and there is no explanation. There is no fallback
 * sentence any more.
 */
import { describe, it, expect, vi } from 'vitest'
import { rdsIdleEstimateWithheld, rdsIdleSavingsExplanation } from '../finding-display'
import { costRecommendationsService } from '../services/cost-recommendations.service'
import { api } from '@/lib/api'

vi.mock('@/lib/api', () => {
  const mockApi = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
  return {
    api: mockApi,
    default: mockApi,
    handleApiResponse: (response: { data: { success: boolean; data: unknown } }) => response.data.data,
  }
})

const KEY = { price_region: 'us-east-1', price_instance_class: 'db.t3.medium', price_engine_label: 'PostgreSQL', price_deployment: 'Single-AZ' }
const ESTIMATE = 'estimated: the us-east-1 on-demand list price for db.t3.medium PostgreSQL Single-AZ instance hours ($0.072/hour, 730 hours); not billed cost'
const APPROVED =
  "Estimated from the us-east-1 on-demand list price for db.t3.medium (PostgreSQL, Single-AZ), instance hours only; a reserved instance would lower the actual saving. Storage and backups are still billed while it's stopped, and AWS restarts a stopped database after 7 days."
// The figure is passed as an object so an explicit `undefined` stays undefined (a default parameter would replace it).
const finding = (metadata: Record<string, unknown> | null, issue = 'Idle RDS Instance', figure: { potentialSavings: number | null | undefined } = { potentialSavings: 52.56 }) => ({ issue, metadata, ...figure })
const FIELDS = ['price_region', 'price_instance_class', 'price_engine_label', 'price_deployment'] as const
const without = (field: string) => Object.fromEntries(Object.entries(KEY).filter(([name]) => name !== field))

describe('rdsIdleSavingsExplanation', () => {
  it('a priced idle RDS finding: the approved copy with its region, class, engine and deployment', () => {
    expect(rdsIdleSavingsExplanation(finding({ savings_basis: ESTIMATE, ...KEY }))).toBe(APPROVED)
    expect(rdsIdleEstimateWithheld(finding({ savings_basis: ESTIMATE, ...KEY }))).toBe(false)
  })

  it.each(FIELDS)('B-2 Z1: missing %s -> no explanation at all (no fallback sentence) and the estimate is withheld', (field) => {
    const rec = finding({ savings_basis: ESTIMATE, ...without(field) })
    expect(rdsIdleSavingsExplanation(rec)).toBeNull()
    expect(rdsIdleEstimateWithheld(rec)).toBe(true)
  })

  it.each(FIELDS.flatMap((field) => [[field, ''], [field, '   '], [field, null], [field, 7]] as const))('B-2 Z1: %s = %j -> withheld, no explanation', (field, value) => {
    const rec = finding({ savings_basis: ESTIMATE, ...KEY, [field]: value })
    expect(rdsIdleSavingsExplanation(rec)).toBeNull()
    expect(rdsIdleEstimateWithheld(rec)).toBe(true)
  })

  it.each([
    ['Z3: a stored figure of exactly 0', 0],
    ['Z2: a missing figure (undefined)', undefined],
    ['Z2: a missing figure (null)', null],
    ['a figure that is not a number', Number.NaN],
    ['an infinite figure', Number.POSITIVE_INFINITY],
    ['a negative figure', -52.56],
  ])('B-2 %s, all four fields present -> withheld, no explanation', (_label, figure) => {
    const rec = finding({ savings_basis: ESTIMATE, ...KEY }, 'Idle RDS Instance', { potentialSavings: figure })
    expect(rdsIdleSavingsExplanation(rec)).toBeNull()
    expect(rdsIdleEstimateWithheld(rec)).toBe(true)
  })

  it.each([
    ['no estimate (savings_note only)', finding({ savings_note: 'missing_license_model', ...KEY }, 'Idle RDS Instance', { potentialSavings: 0 })],
    ['a C1 row ($0, no basis)', finding({ rule_version: 1, savings_note: 'no_price_source' }, 'Idle RDS Instance', { potentialSavings: 0 })],
    ['an upper bound', finding({ savings_basis: 'ceiling: placeholder', ...KEY })],
    ['no metadata', finding(null)],
    ['another issue with an estimate', finding({ savings_basis: ESTIMATE, ...KEY }, 'Idle NAT Gateway')],
    ['another issue with an estimate of 0 (pre-existing path, not C1b)', finding({ savings_basis: ESTIMATE }, 'Idle NAT Gateway', { potentialSavings: 0 })],
  ])('%s: no explanation, and not an RDS estimate to withhold (the basis decides as before)', (_label, rec) => {
    expect(rdsIdleSavingsExplanation(rec)).toBeNull()
    expect(rdsIdleEstimateWithheld(rec)).toBe(false)
  })
})

describe('B-2 Z2 through the real service mapper: a missing potential_savings is never shown as an RDS estimate', () => {
  it.each([['null', null], ['absent', undefined], ['empty', ''], ['non-numeric', 'n/a']])('potential_savings %s -> the mapper yields 0 (pre-existing) -> withheld, no explanation', async (_label, value) => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { success: true, data: [
      { id: 'rec-rds', resource_type: 'RDS', issue: 'Idle RDS Instance', ...(value === undefined ? {} : { potential_savings: value }), severity: 'MEDIUM', status: 'ACTIVE', metadata: { savings_basis: ESTIMATE, ...KEY } },
    ] } } as never)
    const [rec] = await costRecommendationsService.getAll()
    expect(rec.potentialSavings).toBe(0)
    expect(rdsIdleEstimateWithheld(rec)).toBe(true)
    expect(rdsIdleSavingsExplanation(rec)).toBeNull()
  })

  it('potential_savings "52.56" -> a complete estimate with the approved line', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: { success: true, data: [
      { id: 'rec-rds', resource_type: 'RDS', issue: 'Idle RDS Instance', potential_savings: '52.56', severity: 'MEDIUM', status: 'ACTIVE', metadata: { savings_basis: ESTIMATE, ...KEY } },
    ] } } as never)
    const [rec] = await costRecommendationsService.getAll()
    expect(rdsIdleEstimateWithheld(rec)).toBe(false)
    expect(rdsIdleSavingsExplanation(rec)).toBe(APPROVED)
  })
})
