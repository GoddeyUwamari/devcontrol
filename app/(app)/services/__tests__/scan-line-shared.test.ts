/**
 * The shared header scan line (securityModel scanLine), which Security and the
 * Dashboard render. PR 3b gives the Services page its own variant ("Last scan
 * finished …"), so this line must not change: its output for every coverage
 * state, with and without the PR 2 / PR 3a keys, is pinned in
 * `__snapshots__/scan-line-shared.json`, written by the code before PR 3b.
 * TZ UTC and a fixed clock.
 */
process.env.TZ = 'UTC'

import { describe, it, expect } from 'vitest'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { scanLine } from '../../security/overview/securityModel'
import { prodCoverage } from './m6-fixtures'
import { docExamples } from './redesign-fixtures'

const NOW = Date.parse('2026-10-22T15:00:00Z')
const at = (h: number) => new Date(NOW - h * 3600_000).toISOString()

function cases(): Record<string, ServicesCoverage> {
  const base: Record<string, ServicesCoverage> = {
    finished: prodCoverage(NOW),
    running: prodCoverage(NOW, {}, { scan_in_progress: { since: at(0.2) }, last_scan: { status: 'running', started_at: at(0.2), completed_at: null, warnings: [] } }),
    failed: prodCoverage(NOW, {}, { last_scan: { status: 'failed', started_at: at(1.1), completed_at: at(1), warnings: [] } }),
    abandoned: prodCoverage(NOW, {}, { last_scan: { status: 'running', started_at: at(5), completed_at: null, warnings: [] } }),
    yesterday: prodCoverage(NOW, {}, { last_completed_scan: { started_at: at(20), completed_at: at(19), resource_types: [], warnings: [] }, last_successful_scan_at: at(19), last_scan: { status: 'completed', started_at: at(20), completed_at: at(19), warnings: [] } }),
    none: prodCoverage(NOW, {}, { last_completed_scan: null, last_successful_scan_at: null, last_scan: null }),
  }
  const out: Record<string, ServicesCoverage> = { ...base }
  for (const [name, mr] of Object.entries(docExamples())) {
    out[`flagged.${name}`] = { ...base.finished, multi_region: mr, not_enabled_regions: mr.not_enabled_regions } as ServicesCoverage
  }
  out['unflagged.pr3a'] = { ...base.finished, not_enabled_regions: ['ap-east-1'], home_only_coverage: { regions_total: 17, regions_checked: 1 } } as ServicesCoverage
  return out
}

describe('scanLine (Security and the Dashboard) is unchanged by PR 3b', () => {
  it('every state, pinned', async () => {
    const lines = Object.fromEntries(Object.entries(cases()).map(([name, c]) => [name, scanLine({ status: 'ready', data: c }, NOW)]))
    await expect(JSON.stringify(lines, null, 2) + '\n').toMatchFileSnapshot('./__snapshots__/scan-line-shared.json')
  })
})
