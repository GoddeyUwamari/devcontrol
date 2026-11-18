/**
 * PR 3d-1 parity: Infrastructure, Security, the Dashboard and Connect AWS say
 * what the Services & Ownership page says, from the same coverage response,
 * for every case the founder listed (3d-1 brief, TESTS):
 *   home ok / home failed / denied / timed out / former home with an old ok /
 *   flagged latest_scan_failed / an abandoned job / partial / a scan running
 *   past 60 minutes with the lease held,
 * plus the flagged in-progress line that stays dormant until an organization
 * is flagged (brief item 7).
 *
 * The fixtures are the Services page's own (redesign-fixtures tab5 / tab8 /
 * tab2, home-region-fixtures tab12Coverage). Variants of tab5 change the home
 * region's status and set home_only_coverage by the server's G8 rule (doc
 * §15.2: 1 only when the current home's last status is ok or partial).
 *
 * Each case pins the Services values as literals (so a wrong shared rule
 * fails here, not only on one page), then checks every page's line equals them.
 */
process.env.TZ = 'UTC'

import { describe, it, expect } from 'vitest'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import { R_NOW, tab2, tab5, tab8 } from '../(app)/services/__tests__/redesign-fixtures'
import { tab12Coverage } from '../(app)/services/__tests__/home-region-fixtures'
import { organisingLine, redesignScanLine } from '../(app)/services/redesignModel'
import { richText } from '../(app)/services/regionCoverage'
import { describeCoverage } from '../(app)/services/coverage'
import { regionGaps, scanIsRunning, scanState } from '../(app)/services/servicesTruth'
import { describeOverview } from '../(app)/infrastructure/overview/overviewModel'
import { attentionPage, inputs, ready } from '../(app)/infrastructure/__tests__/overview-fixtures'
import { headerScanLine, notCheckedText, securityCheckedLines } from '../(app)/security/overview/securityModel'
import { dataFreshnessSegments, headerStatusLine } from '../(app)/dashboard/dashboardFreshness'

const NOW = R_NOW // 2026-11-15 16:30 UTC

/** tab5 with the home region's last status changed, and home_only_coverage by the server's rule. */
function homeStatus(status: string): ServicesCoverage {
  const c = tab5('ok')
  c.region_status[0].status = status
  c.home_only_coverage = { regions_total: 4, regions_checked: status === 'ok' || status === 'partial' ? 1 : 0 }
  return c
}

/** A running job with no lease: abandoned (the scanner's recovery hasn't marked it yet). */
function abandoned(): ServicesCoverage {
  const c = tab5('ok')
  c.last_scan = { status: 'running', started_at: '2026-11-15T12:00:00.000Z', completed_at: null, warnings: [] }
  return c
}

/** A scan running for 3.5 hours that still holds the lease: in progress (never "failed" by age). */
function longRunning(): ServicesCoverage {
  const c = tab5('ok')
  c.scan_in_progress = { since: '2026-11-15T13:00:00.000Z' }
  c.last_scan = { status: 'running', started_at: '2026-11-15T13:00:00.000Z', completed_at: null, warnings: [] }
  return c
}

interface Expected {
  /** The Services header line (redesignScanLine) and state. */
  scan: { state: string; text: string }
  /** The Services coverage card's organising line. */
  line: string
  /** "Not checked yet: …" on Infrastructure and Security. */
  notChecked: string
  /** The other-regions lines ("What we checked" on Infrastructure and Security). */
  otherRegions: string[]
  /** Infrastructure's inventory line's ending (the home region's result). */
  inventory: string
  /** The last finished scan, as the Dashboard's freshness row prints it (default today, 10:20 AM). */
  finished?: string
}

const IAM = 'IAM roles and policies'
const FINISHED = 'Last scan finished today, 10:20 AM'

const CASES: Record<string, { coverage: () => ServicesCoverage; expected: Expected }> = {
  'home ok': {
    coverage: () => tab5('ok'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: '1 of 4 regions checked · us-east-1',
      notChecked: `Not checked yet: 3 regions not scanned yet · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: 'us-east-1: Checked',
    },
  },
  'home failed': {
    coverage: () => tab5('failed'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: "0 of 4 regions checked · us-east-1 · us-east-1 couldn't be checked",
      notChecked: `Not checked yet: us-east-1 couldn't be checked · 3 regions not scanned yet · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: "us-east-1: Couldn't check: scan error",
    },
  },
  'home denied': {
    coverage: () => homeStatus('denied'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: "0 of 4 regions checked · us-east-1 · us-east-1 couldn't be checked",
      notChecked: `Not checked yet: us-east-1 couldn't be checked · 3 regions not scanned yet · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: "us-east-1: Couldn't check: access denied",
    },
  },
  'home timed out': {
    coverage: () => homeStatus('timed_out'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: "0 of 4 regions checked · us-east-1 · us-east-1 couldn't be checked",
      notChecked: `Not checked yet: us-east-1 couldn't be checked · 3 regions not scanned yet · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: "us-east-1: Couldn't check: AWS didn't respond",
    },
  },
  'home partial': {
    coverage: () => homeStatus('partial'),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: '1 of 4 regions checked · us-east-1',
      notChecked: `Not checked yet: 3 regions not scanned yet · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: 'us-east-1: Partly checked',
    },
  },
  'former home with an old ok': {
    coverage: () => tab12Coverage(),
    expected: {
      scan: { state: 'finished', text: FINISHED }, line: '1 of 4 regions checked · us-west-2',
      notChecked: `Not checked yet: us-east-1 since Nov 14 · 2 regions not scanned yet · ${IAM}`,
      otherRegions: ["us-east-1 hasn't been scanned since Nov 14, except for S3 buckets.", '2 regions not scanned yet'], inventory: 'us-west-2: Checked',
    },
  },
  'flagged latest_scan_failed (RR-L2)': {
    coverage: () => tab8(),
    expected: {
      scan: { state: 'failed', text: "Last scan: today, 10:21 AM · didn't finish" }, line: 'Last scan failed after checking 1 of 2 regions · 1 with resources',
      notChecked: `Not checked yet: 1 region couldn't be checked · ${IAM}`, otherRegions: ["1 region couldn't be checked"], inventory: 'us-east-1: Checked', finished: 'today, 4:20 AM',
    },
  },
  'abandoned job': {
    coverage: abandoned,
    expected: {
      scan: { state: 'failed', text: "Last scan: today, 12:00 PM · didn't finish" }, line: '1 of 4 regions checked · us-east-1',
      notChecked: `Not checked yet: 3 regions not scanned yet · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: 'us-east-1: Checked',
    },
  },
  'in progress past 60 minutes, lease held': {
    coverage: longRunning,
    expected: {
      scan: { state: 'running', text: 'Scan in progress since 1:00 PM · showing results from today, 10:20 AM' }, line: '1 of 4 regions checked · us-east-1',
      notChecked: `Not checked yet: 3 regions not scanned yet · ${IAM}`, otherRegions: ['3 regions not scanned yet'], inventory: 'us-east-1: Checked',
    },
  },
  'flagged in progress (dormant region progress, item 7)': {
    coverage: () => tab2(),
    expected: {
      scan: { state: 'running', text: 'Scan in progress since 10:00 AM · 1 of 4 regions done' },
      line: 'Scanning: 1 of 4 regions checked so far · 1 with resources · 3 still running or waiting',
      notChecked: `Not checked yet: 3 regions still running or waiting · ${IAM}`, otherRegions: ['3 regions still running or waiting'], inventory: 'us-east-1: Checked', finished: 'today, 4:20 AM',
    },
  },
}

describe.each(Object.entries(CASES))('%s', (_name, { coverage, expected }) => {
  const c = coverage()

  it('the Services page itself says the expected values (pinned literals)', () => {
    expect(redesignScanLine(c, NOW)).toEqual(expected.scan)
    expect(organisingLine(c).text).toBe(expected.line)
    expect(scanState(c, NOW)).toEqual(expected.scan)
    expect((regionGaps(c, NOW) ?? []).filter((g) => !g.home).map((g) => g.long)).toEqual(expected.otherRegions)
  })

  it('Infrastructure: header, strip, Not checked yet, What we checked and the empty-state scope', () => {
    const v = describeOverview(inputs({ coverage: ready(c), attention: ready(attentionPage([])), accountFindings: ready([]) }), NOW)
    // The header prints the parts, with the scan time as its own focusable element; the words are the same.
    expect(richText(v.header.lastScan!, NOW)).toBe(expected.scan.text)
    expect(v.header.scanRunning).toBe(scanIsRunning(c))
    expect(v.account!.items.find((i) => i.term === 'Regions checked')!.value).toBe(expected.line)
    expect(v.status.notChecked).toBe(expected.notChecked)
    const inventory = v.checked.find((l) => l.key === 'inventory')!.parts.join('')
    expect(inventory.endsWith(expected.inventory)).toBe(true)
    expect(v.checked.filter((l) => l.key.startsWith('other-regions')).map((l) => l.parts.join(''))).toEqual(expected.otherRegions)
    expect(v.attention).toMatchObject({ status: 'ready', empty: { scope: expected.line.endsWith('.') ? expected.line : `${expected.line}.` } })
    // Nothing on the page says the old helper's words.
    expect(JSON.stringify(v)).not.toMatch(/with gaps|Checked with gaps|Other enabled regions: Not checked \(/)
  })

  it('Security: header, Not checked yet banner and the other-regions lines', () => {
    expect(headerScanLine({ status: 'ready', data: c }, NOW)).toEqual(expected.scan)
    expect(notCheckedText({ status: 'ready', data: c }, NOW)).toBe(expected.notChecked)
    const other = securityCheckedLines({ status: 'ready', data: c }, NOW).filter((l) => l.key.startsWith('other-regions'))
    expect(other.map((l) => [l.label, l.status])).toEqual(expected.otherRegions.map((t) => [t, 'not_checked']))
  })

  it('Dashboard: header and freshness', () => {
    expect(headerStatusLine({ coverage: c, previousLoginAt: null, now: NOW })).toBe(expected.scan.text)
    const resources = dataFreshnessSegments({ costSummary: undefined, costSummaryError: false, coverage: c, cloudwatchCapturedAt: null, serviceCheckedAt: null, now: NOW })
      .find((s) => s.key === 'resources')!
    // "last scan finished {when}", the cadence only when the latest attempt didn't fail (DB-D10).
    expect(resources.text).toBe(`last scan finished ${expected.finished ?? 'today, 10:20 AM'}${expected.scan.state === 'failed' ? '' : ' · every 6 hours'}`)
  })

  it('Connect AWS: the Discovery line is the Services scan line; running and failed follow the same state', () => {
    const v = describeCoverage(c, NOW, [], scanState(c, NOW))
    expect(v.lastScan).toBe(expected.scan.text)
    expect(v.lastScanFailed).toBe(expected.scan.state === 'failed')
    expect(v.chips[0].state === 'scanning').toBe(expected.scan.state === 'running')
  })
})

describe('R5: Connect no longer reads a long scan as failed', () => {
  it('a scan running 3.5 hours with the lease is in progress on Connect; the Phase 1 rule (still used by the Services strip) says failed', () => {
    const c = longRunning()
    const shared = describeCoverage(c, NOW, [], scanState(c, NOW))
    expect(shared.chips[0]).toMatchObject({ state: 'scanning' })
    // The newest job is still running, so its scope is not claimed (scopeIsCompleted): no "plus …".
    expect(shared.headline).toBe('us-east-1 scanned')
    // The Services page's Phase 1 strip keeps its rule (no scan state given): unchanged.
    expect(describeCoverage(c, NOW).chips[0]).toMatchObject({ state: 'failed' })
  })
})
