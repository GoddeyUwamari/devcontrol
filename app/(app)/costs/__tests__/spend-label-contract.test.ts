/**
 * Contract: an inventory estimate is never labeled "spend".
 *
 * Every spend figure in the app is worded by describeSpend (the Costs page,
 * /costs/efficiency, and the Dashboard card, from GET /api/platform/costs/summary)
 * or describeStatsSpend (the by-team and /infrastructure cards, from
 * GET /api/platform/stats/dashboard). For every input either can receive:
 *   - a figure whose provenance is 'estimated' carries a label without the
 *     word "spend" and says it is not AWS billed spend;
 *   - a figure shown under a "spend" label has provenance 'actual'.
 */
import { describe, it, expect } from 'vitest'
import type { ContextSection, CostSpendEvidence } from '@/lib/types'
import { computeDashboardAwsGates } from '../../dashboard/dashboardAwsGates'
import { ACTUAL_SPEND_LABEL, describeSpend, describeStatsSpend, ESTIMATED_RUN_RATE_LABEL, NO_SPEND_FIGURE_SUB, type SpendDisplay } from '../cost-display'

const ok = { isLoading: false, isError: false }

function section(over: Omit<Partial<ContextSection<CostSpendEvidence>>, 'data'> & { data?: Partial<CostSpendEvidence> | null }): ContextSection<CostSpendEvidence> {
  const { data, ...rest } = over
  return {
    state: 'available',
    provenance: 'actual',
    data: data === null ? null : ({ amount: 1234.5, basis: 'billed_month_to_date', lastDayInProgress: false, ...data } as CostSpendEvidence),
    ...rest,
  } as ContextSection<CostSpendEvidence>
}

const summaryCases: Array<[string, ContextSection<CostSpendEvidence> | undefined, { isLoading: boolean; isError: boolean }]> = [
  ['actual', section({}), ok],
  ['actual $0', section({ data: { amount: 0 } }), ok],
  ['actual net credit', section({ data: { amount: -12 } }), ok],
  ['actual partial', section({ state: 'partial' }), ok],
  ['estimated provenance', section({ provenance: 'estimated', data: { basis: 'estimated_monthly_run_rate' } }), ok],
  ['estimated basis only', section({ data: { basis: 'estimated_monthly_run_rate' } }), ok],
  ['estimated partial', section({ provenance: 'estimated', state: 'partial', data: { basis: 'estimated_monthly_run_rate' } }), ok],
  ['estimated $0', section({ provenance: 'estimated', data: { amount: 0, basis: 'estimated_monthly_run_rate' } }), ok],
  ['unavailable', section({ state: 'unavailable', data: null }), ok],
  ['error', section({ state: 'error', data: null }), ok],
  ['loading', undefined, { isLoading: true, isError: false }],
  ['request failed', undefined, { isLoading: false, isError: true }],
]

const statsCases: Array<[string, Parameters<typeof describeStatsSpend>[0], { isLoading: boolean; isError: boolean }]> = [
  ['actual', { monthlyAwsCost: 1234.5, costSource: 'actual' }, ok],
  ['estimated', { monthlyAwsCost: 412.5, costSource: 'estimated' }, ok],
  ['estimated $0', { monthlyAwsCost: 0, costSource: 'estimated' }, ok],
  ['source not stated', { monthlyAwsCost: 99 }, ok],
  ['loading', undefined, { isLoading: true, isError: false }],
  ['request failed', undefined, { isLoading: false, isError: true }],
  ['no response', undefined, ok],
]

function expectContract(d: SpendDisplay) {
  if (d.provenance === 'estimated') {
    expect(d.label).not.toMatch(/spend/i)
    expect(d.label).toBe(ESTIMATED_RUN_RATE_LABEL)
    expect(d.sub).toMatch(/not AWS billed spend/)
  }
  if (/spend/i.test(d.label) && d.value !== '—') {
    expect(d.provenance).toBe('actual')
  }
}

describe('describeSpend (GET /api/platform/costs/summary)', () => {
  it.each(summaryCases)('%s', (_name, s, status) => {
    expectContract(describeSpend(s, status))
  })

  it('an estimate is labeled as a run-rate, an actual figure as month-to-date spend', () => {
    expect(describeSpend(section({ provenance: 'estimated', data: { basis: 'estimated_monthly_run_rate' } }), ok).label).toBe(ESTIMATED_RUN_RATE_LABEL)
    expect(describeSpend(section({}), ok).label).toBe(ACTUAL_SPEND_LABEL)
  })
})

describe('describeStatsSpend (GET /api/platform/stats/dashboard)', () => {
  it.each(statsCases)('%s', (_name, stats, status) => {
    expectContract(describeStatsSpend(stats, status))
  })

  it('reads costSource: actual is month-to-date spend, estimated is a run-rate', () => {
    expect(describeStatsSpend({ monthlyAwsCost: 1234.5, costSource: 'actual' }, ok)).toMatchObject({
      label: ACTUAL_SPEND_LABEL, value: '$1,234.50', provenance: 'actual',
    })
    expect(describeStatsSpend({ monthlyAwsCost: 412.5, costSource: 'estimated' }, ok)).toMatchObject({
      label: ESTIMATED_RUN_RATE_LABEL, value: '$412.50/mo', provenance: 'estimated',
    })
  })

  // What the backend actually sends when Cost Explorer has no positive total
  // (AWSCostService.getMonthlySpendWithFallback): 'actual' only for a Cost
  // Explorer total above $0; otherwise the inventory estimate, as 'estimated'.
  // The frontend cannot tell these apart, so none of them may read as a figure
  // unless the inventory estimate itself is above $0.
  describe('fallback cases, as the backend sends them', () => {
    const noFigure: Array<[string, Parameters<typeof describeStatsSpend>[0]]> = [
      ['Cost Explorer request failed, inventory estimate $0', { monthlyAwsCost: 0, costSource: 'estimated' }],
      ['a real $0 Cost Explorer month, inventory estimate $0', { monthlyAwsCost: 0, costSource: 'estimated' }],
      ['net credits (Cost Explorer total below $0), inventory estimate $0', { monthlyAwsCost: 0, costSource: 'estimated' }],
      ['no connected AWS account (empty inventory)', { monthlyAwsCost: 0, costSource: 'estimated' }],
      ['an estimate below $0', { monthlyAwsCost: -3, costSource: 'estimated' }],
    ]
    it.each(noFigure)('%s: no figure -- "—" with the reason, never "$0.00/mo"', (_name, stats) => {
      const d = describeStatsSpend(stats, ok)
      expect(d).toMatchObject({ value: '—', sub: NO_SPEND_FIGURE_SUB, amount: null, provenance: null })
      expect(d.value).not.toMatch(/\$/)
    })

    it('any of them with a positive inventory estimate: the estimate, labeled as a run-rate', () => {
      expect(describeStatsSpend({ monthlyAwsCost: 87.2, costSource: 'estimated' }, ok)).toMatchObject({
        label: ESTIMATED_RUN_RATE_LABEL, value: '$87.20/mo', provenance: 'estimated',
      })
    })
  })

  it('the costs/summary path also shows no figure for an estimate of $0', () => {
    expect(describeSpend(section({ provenance: 'estimated', data: { amount: 0, basis: 'estimated_monthly_run_rate' } }), ok))
      .toMatchObject({ value: '—', sub: NO_SPEND_FIGURE_SUB, provenance: null })
  })

  it('a response that does not state its source is treated as an estimate, never as spend', () => {
    expect(describeStatsSpend({ monthlyAwsCost: 99 }, ok).provenance).toBe('estimated')
  })

  it('loading or a failed request shows no figure', () => {
    expect(describeStatsSpend(undefined, { isLoading: true, isError: false }).value).toBe('—')
    expect(describeStatsSpend(undefined, { isLoading: false, isError: true })).toMatchObject({ value: '—', sub: 'Could not be retrieved', provenance: null })
  })
})

describe('the Dashboard billing gate and the by-team / /infrastructure spend cards agree', () => {
  const inputs: Array<Parameters<typeof describeStatsSpend>[0] & {}> = [
    { monthlyAwsCost: 1234.5, costSource: 'actual' },
    { monthlyAwsCost: 412.5, costSource: 'estimated' },
    { monthlyAwsCost: 0, costSource: 'estimated' },
    { monthlyAwsCost: -3, costSource: 'estimated' },
    { monthlyAwsCost: 99 },
    { monthlyAwsCost: 0 },
  ]
  it.each(inputs)('%o: a figure is shown exactly when the Dashboard sees billing data', (stats) => {
    const { hasBillingData } = computeDashboardAwsGates({
      isDemoActive: false, isAwsConnected: true, statsLoading: false, stats: { totalServices: 1, ...stats },
    })
    expect(describeStatsSpend(stats, ok).value !== '—').toBe(hasBillingData)
  })
})
