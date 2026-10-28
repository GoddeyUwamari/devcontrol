/**
 * Q8 and brief addition 3: the Compliance page's times are the viewer's local time, never UTC. Run in New York at
 * 11:30 PM, where it is already the next day in UTC; staleness still compares the raw timestamps.
 */
const NOW = vi.hoisted(() => {
  process.env.TZ = 'America/New_York'
  return Date.parse('2026-10-27T03:30:00Z') // Oct 26, 11:30 PM here
})

import { describe, it, expect, vi } from 'vitest'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'
import { FRAMEWORK_STALE_AFTER_MS } from '@/lib/compliance/evaluation'
import { describeCompliance } from '../complianceModel'

const fw = { id: 'fw-a', organization_id: 'org-1', name: 'Example baseline', description: null, framework_type: 'custom', enabled: true, is_default: false, standard_name: null, version: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' } as ComplianceFramework
const run = (id: string, status: ComplianceScan['status'], when: string) => ({
  id, organization_id: 'org-1', framework_id: 'fw-a', scan_type: 'manual', status, total_resources: 10, compliant_resources: 9, non_compliant_resources: 1,
  compliance_score: '0.00', critical_issues: 0, high_issues: 0, medium_issues: 0, low_issues: 0,
  started_at: when, completed_at: status === 'running' ? null : when, duration_seconds: 1, created_at: when,
}) as unknown as ComplianceScan
const sh = { failed: false, capability: null, evaluated: { cis: false, pci: false, nist: false } }
const view = (scans: ComplianceScan[]) => describeCompliance({ status: 'ready', data: { frameworks: [fw], scans, scansLimit: 50 } }, sh, NOW)

describe('local time in New York', () => {
  it('the zone is really New York here', () => {
    expect(new Date(NOW).getDate()).toBe(26)
  })
  it('the score tile: 02:00 UTC on Oct 27 is "today, 10:00 PM" here, not "Oct 27, 2:00 AM"', () => {
    expect(view([run('s-1', 'completed', '2026-10-27T02:00:00Z')]).tiles.score.sub).toBe('Example baseline · evaluated today, 10:00 PM')
  })
  it('history rows cross local midnight correctly', () => {
    const rows = view([
      run('s-1', 'running', '2026-10-27T03:00:00Z'),
      run('s-2', 'failed', '2026-10-26T03:00:00Z'),
      run('s-3', 'completed', '2026-10-25T03:00:00Z'),
    ]).history.map((r) => r.text)
    expect(rows).toEqual([
      'Example baseline · Running · started today, 11:00 PM',
      'Example baseline · Failed yesterday, 11:00 PM',
      'Example baseline · Completed Oct 24, 11:00 PM · 90%',
    ])
  })
  it('the banner date is local; staleness still uses the raw timestamps (exactly 7 days is stale)', () => {
    const when = new Date(NOW - FRAMEWORK_STALE_AFTER_MS).toISOString() // 03:30 UTC on Oct 20 = Oct 19, 11:30 PM here
    expect(view([run('s-1', 'completed', when)]).banner).toEqual({ kind: 'one', frameworkId: 'fw-a', text: 'Results are out of date — Example baseline was last evaluated Oct 19, 11:30 PM.' })
    const fresher = new Date(NOW - FRAMEWORK_STALE_AFTER_MS + 1).toISOString()
    expect(view([run('s-1', 'completed', fresher)]).banner).toBeNull()
  })
})
