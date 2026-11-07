/**
 * FP PR 2b: lib/finding-display.ts mirrors backend/src/services/finding-display.ts
 * and the rule identity in backend/src/config/low-activity-rule.ts. The copy here
 * is founder-approved (C-1, C-3, C-6) and pinned word for word.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  LOW_ACTIVITY_DISPLAY_LABEL,
  LOW_ACTIVITY_FIXED_THRESHOLDS,
  LOW_ACTIVITY_STORAGE_NOTE,
  displayIssue,
  hasLowActivityRuleIdentity,
  isLowActivityFinding,
  lowActivityListPriceBasis,
  lowActivitySavingsHeadline,
} from '../finding-display'

const IDENTITY = { rule_version: 2, rule: { id: 'ec2_low_activity', version: 2 } }

describe('the rule identity mirror', () => {
  it('names the backend rule and version (backend/src/config/low-activity-rule.ts)', () => {
    const backend = readFileSync(join(process.cwd(), 'backend/src/config/low-activity-rule.ts'), 'utf8')
    const head = backend.slice(backend.indexOf('export const LOW_ACTIVITY_RULE'))
    expect(head).toMatch(/^export const LOW_ACTIVITY_RULE = deepFreeze\(\{\s*id: 'ec2_low_activity',\s*version: 2,/)
    expect(backend).toContain("export const LOW_ACTIVITY_DISPLAY_LABEL = 'Low-activity instance';")
  })

  it.each([
    ['the identity', IDENTITY, true],
    ['no metadata', null, false],
    ['a CPU-only finding', { average_cpu: 3.4 }, false],
    ['the marker alone', { rule_version: 2 }, false],
    ['the marker as a string', { ...IDENTITY, rule_version: '2' }, false],
    ['another rule', { ...IDENTITY, rule: { id: 'ec2_idle', version: 2 } }, false],
    ['another version', { rule_version: 3, rule: { id: 'ec2_low_activity', version: 3 } }, false],
  ])('judges %s as the backend does', (_label, metadata, expected) => {
    expect(hasLowActivityRuleIdentity(metadata)).toBe(expected)
    expect(displayIssue({ issue: 'Idle Instance', metadata: metadata as any })).toBe(expected ? 'Low-activity instance' : 'Idle Instance')
  })
})

describe('labels (C-1)', () => {
  it('"Low-activity instance" only for an Idle Instance row with the identity', () => {
    expect(LOW_ACTIVITY_DISPLAY_LABEL).toBe('Low-activity instance')
    expect(displayIssue({ issue: 'Idle Instance', metadata: IDENTITY })).toBe('Low-activity instance')
    expect(displayIssue({ issue: 'Idle Instance', metadata: { average_cpu: 1 } })).toBe('Idle Instance')
    expect(displayIssue({ issue: 'Unattached EBS Volume', metadata: IDENTITY })).toBe('Unattached EBS Volume')
    expect(displayIssue({ issue: null, metadata: null })).toBeNull()
    expect(isLowActivityFinding({ issue: 'Idle Instance', metadata: IDENTITY })).toBe(true)
  })
})

describe('approved copy', () => {
  const dollars = (n: number) => `$${Math.round(n)}`

  it('C-3 headline and list-price basis', () => {
    expect(lowActivitySavingsHeadline(8.5, dollars)).toBe("Up to $9/mo if it's no longer needed")
    expect(lowActivityListPriceBasis('t2.micro')).toBe("Estimated from list price for t2.micro in us-east-1. Doesn't include storage, which is still billed while an instance is stopped.")
    expect(LOW_ACTIVITY_STORAGE_NOTE).toBe("Doesn't include storage, which is still billed while an instance is stopped.")
  })

  it('C-6 fixed thresholds line', () => {
    expect(LOW_ACTIVITY_FIXED_THRESHOLDS).toBe(
      'Low-activity instances: peak CPU under 10% and network under 5 MB a day, every day for 30 days, and not behind a load balancer or in an Auto Scaling group. These thresholds are fixed.'
    )
  })
})
