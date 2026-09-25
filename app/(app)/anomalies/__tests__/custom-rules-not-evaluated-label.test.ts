/**
 * Custom anomaly rules are stored but not evaluated (their metrics were read
 * from AWS tags, not measured data -- see backend
 * custom-anomaly-rules.service.ts). Every place that lists rules must say so,
 * so an enabled rule is never mistaken for active monitoring.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const rulesPageSource = readFileSync(join(__dirname, '../rules/page.tsx'), 'utf8')
const anomaliesPageSource = readFileSync(join(__dirname, '../page.tsx'), 'utf8')

describe('custom rule lists label rules as not currently evaluated', () => {
  it('/anomalies/rules labels every listed rule', () => {
    const row = rulesPageSource.slice(rulesPageSource.indexOf('{rules.map(rule =>'))
    expect(row).toMatch(/Not currently evaluated/)
  })

  it('/anomalies labels every listed rule', () => {
    const row = anomaliesPageSource.slice(anomaliesPageSource.indexOf('{rules.map(rule =>'))
    expect(row).toMatch(/Not currently evaluated/)
  })
})
