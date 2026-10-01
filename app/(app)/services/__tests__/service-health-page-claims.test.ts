/**
 * /services/health is static copy. It must not claim capabilities DevControl
 * does not have: learned performance baselines, automatically set alert
 * thresholds, or "real-time health" for every service across all regions.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(__dirname, '../health/page.tsx'), 'utf-8')

describe('/services/health copy', () => {
  it('makes no learned-baseline or auto-threshold claim', () => {
    expect(source).not.toMatch(/learns your normal performance patterns/i)
    expect(source).not.toMatch(/sets smart alert thresholds/i)
    expect(source).not.toMatch(/no manual configuration required/i)
    expect(source).not.toMatch(/Health Baseline Established/)
  })

  it('makes no "real-time health" / all-regions monitoring claim', () => {
    expect(source).not.toMatch(/Real-time Service Health/)
    expect(source).not.toMatch(/Real-time health scores for every service/)
    expect(source).not.toMatch(/across all your services, regions, and accounts/)
  })

  it('describes the checks DevControl actually runs', () => {
    expect(source).toMatch(/AWS status checks for EC2 and EBS/)
    expect(source).toMatch(/CloudWatch metric threshold/)
  })
})
