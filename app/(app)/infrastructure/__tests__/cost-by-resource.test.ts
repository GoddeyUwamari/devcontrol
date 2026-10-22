/**
 * largestEstimatedCosts: one row per resource (never merged by name), no
 * not-estimated or $0 resource, at most 5 rows largest first, bars relative to
 * the largest, and no percentage.
 */
import { describe, it, expect } from 'vitest'
import { largestEstimatedCosts } from '../costByResource'

const r = (id: string, serviceName: string, costPerMonth: number | null) => ({ id, serviceName, awsId: `aws-${id}`, costPerMonth })

describe('largestEstimatedCosts', () => {
  it('T5.1 keeps two resources with the same name apart', () => {
    const rows = largestEstimatedCosts([r('a', 'web', 10), r('b', 'web', 20)])
    expect(rows.map((row) => [row.id, row.cost])).toEqual([['b', 20], ['a', 10]])
  })

  it('T5.2 leaves out resources with no estimate or a $0 estimate', () => {
    expect(largestEstimatedCosts([r('a', 'a', null), r('b', 'b', 0), r('c', 'c', 7)]).map((row) => row.id)).toEqual(['c'])
    expect(largestEstimatedCosts([r('a', 'a', null), r('b', 'b', null)])).toEqual([])
  })

  it('T5.3 returns at most 5 rows, largest first, bars relative to the largest, and no percentage', () => {
    const rows = largestEstimatedCosts([10, 70, 20, 35, 60, 5, 40].map((cost, i) => r(`r${i}`, `n${i}`, cost)))
    expect(rows.map((row) => row.cost)).toEqual([70, 60, 40, 35, 20])
    expect(rows[0].barWidth).toBe(100)
    expect(rows.find((row) => row.cost === 35)!.barWidth).toBe(50)
    for (const row of rows) expect(row).not.toHaveProperty('pct')
  })
})
