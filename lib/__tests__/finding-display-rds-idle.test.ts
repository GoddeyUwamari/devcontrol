/**
 * C1b: rdsIdleSavingsExplanation -- the approved explanation under a priced
 * idle RDS finding, built only from the finding's own price key; nothing for a
 * finding with no estimate, an upper bound, or another issue.
 */
import { describe, it, expect } from 'vitest'
import { rdsIdleSavingsExplanation } from '../finding-display'

const KEY = { price_region: 'us-east-1', price_instance_class: 'db.t3.medium', price_engine_label: 'PostgreSQL', price_deployment: 'Single-AZ' }
const ESTIMATE = 'estimated: the us-east-1 on-demand list price for db.t3.medium PostgreSQL Single-AZ instance hours ($0.072/hour, 730 hours); not billed cost'
const finding = (metadata: Record<string, unknown> | null, issue = 'Idle RDS Instance') => ({ issue, metadata })

describe('rdsIdleSavingsExplanation', () => {
  it('a priced idle RDS finding: the approved copy with its region, class, engine and deployment', () => {
    expect(rdsIdleSavingsExplanation(finding({ savings_basis: ESTIMATE, ...KEY }))).toBe(
      "Estimated from the us-east-1 on-demand list price for db.t3.medium (PostgreSQL, Single-AZ), instance hours only; a reserved instance would lower the actual saving. Storage and backups are still billed while it's stopped, and AWS restarts a stopped database after 7 days."
    )
  })

  it.each(['price_region', 'price_instance_class', 'price_engine_label', 'price_deployment'])('missing %s: the same sentence without the specifics, never a guessed value', (field) => {
    const rest = Object.fromEntries(Object.entries(KEY).filter(([name]) => name !== field))
    expect(rdsIdleSavingsExplanation(finding({ savings_basis: ESTIMATE, ...rest }))).toBe(
      "Estimated from the on-demand list price, instance hours only; a reserved instance would lower the actual saving. Storage and backups are still billed while it's stopped, and AWS restarts a stopped database after 7 days."
    )
  })

  it.each([
    ['no estimate (savings_note only)', finding({ savings_note: 'missing_license_model', ...KEY })],
    ['a C1 row ($0, no basis)', finding({ rule_version: 1, savings_note: 'no_price_source' })],
    ['an upper bound', finding({ savings_basis: 'ceiling: placeholder', ...KEY })],
    ['no metadata', finding(null)],
    ['another issue with an estimate', finding({ savings_basis: ESTIMATE, ...KEY }, 'Idle NAT Gateway')],
  ])('%s: no explanation', (_label, rec) => {
    expect(rdsIdleSavingsExplanation(rec)).toBeNull()
  })
})
