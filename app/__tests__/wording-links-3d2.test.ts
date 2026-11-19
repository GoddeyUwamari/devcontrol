/**
 * PR 3d-2 "wording and links": the model- and source-level checks, one block per decision (D1, D2, D4,
 * D7, D8, D9, D10) and 3d-1 leftover (N11, Connect's home cell, RR-L1). Render-level checks live with each
 * page's own harness (Infrastructure overview-render "PR 3d-2", Services services-show-param, Connect
 * connect-home-region-3d2, Operational Health operational-health-3d2, the legacy pages' *-legacy-region-3d2).
 * Every expected string is a literal. Synthetic data only (the Services test fixtures).
 */
process.env.TZ = 'UTC'

import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import type { ServicesCoverage } from '@/lib/services/aws-services.service'
import type { HomeRegionAccountView, HomeRegionProposalView } from '@/lib/services/aws-accounts.service'
import { R_NOW, tab2, tab5, tab8 } from '../(app)/services/__tests__/redesign-fixtures'
import { ACCOUNT_ID, accountsAnswer, proposal, split, splitSeven, tab12Coverage } from '../(app)/services/__tests__/home-region-fixtures'
import {
  ATTENTION_DEFINITION, NEEDS_ATTENTION_HREF, REGION_COVERAGE_HREF, REGION_COVERAGE_LINK, homeRegionOf, organisingLine,
  redesignScanLine, redesignScanLineTime,
} from '../(app)/services/redesignModel'
import { HOME_REGION_COPY, homeRegionBanner, homeRegionPromptShows } from '../(app)/services/homeRegionModel'
import { describeCoverage } from '../(app)/services/coverage'
import { connectHomeRegionLinks, homeRegionCheck, scanState, scanStateParts, scanStateTime } from '../(app)/services/servicesTruth'
import { OVERVIEW_COPY } from '../(app)/infrastructure/overview/overviewModel'
import { PAGE_COPY as SECURITY_COPY } from '../(app)/security/overview/securityCopy'
import { PAGE_COPY as OH_COPY, TABLE_COPY, TABLE_HREF } from '../(app)/admin/monitoring/operational-health/operationalHealthCopy'
import { HOME_REGION_CHANGE, HOME_REGION_SUGGESTION, HOME_REGION_SUGGESTION_LINK } from '../(app)/connect-aws/connectAwsCopy'

const NOW = R_NOW
const src = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

/** tab5 with the home region's last status changed, and home_only_coverage by the server's G8 rule (as the 3d-1 parity test). */
function homeStatus(status: string): ServicesCoverage {
  const c = tab5('ok')
  c.region_status[0].status = status
  c.home_only_coverage = { regions_total: 4, regions_checked: status === 'ok' || status === 'partial' ? 1 : 0 }
  return c
}
function abandoned(): ServicesCoverage {
  const c = tab5('ok')
  c.last_scan = { status: 'running', started_at: '2026-11-15T12:00:00.000Z', completed_at: null, warnings: [] }
  return c
}
function running(): ServicesCoverage {
  const c = tab5('ok')
  c.last_scan = { status: 'running', started_at: '2026-11-15T13:00:00.000Z', completed_at: null, warnings: [] }
  c.scan_in_progress = { since: '2026-11-15T13:00:00.000Z' }
  return c
}
function failedFlagOff(): ServicesCoverage {
  const c = tab5('ok')
  c.last_scan = { status: 'failed', started_at: '2026-11-15T13:00:00.000Z', completed_at: '2026-11-15T13:05:00.000Z', warnings: [] }
  return c
}
function neverScanned(): ServicesCoverage {
  const c = tab5('ok')
  c.last_scan = null
  c.last_successful_scan_at = null
  if (c.last_completed_scan) c.last_completed_scan = null
  return c
}

// ── N11 ──

describe('N11: the organising line names the home region once', () => {
  it.each(['failed', 'denied', 'timed_out'])('home %s: "0 of 4 regions checked · us-east-1 couldn\'t be checked"', (status) => {
    expect(organisingLine(homeStatus(status)).text).toBe("0 of 4 regions checked · us-east-1 couldn't be checked")
  })
  it('negative: a checked or partial home still reads "1 of 4 regions checked · us-east-1" (unchanged)', () => {
    expect(organisingLine(homeStatus('ok')).text).toBe('1 of 4 regions checked · us-east-1')
    expect(organisingLine(homeStatus('partial')).text).toBe('1 of 4 regions checked · us-east-1')
  })
  it('never "{home} · {home} couldn\'t be checked" for any home status', () => {
    for (const status of ['ok', 'partial', 'failed', 'denied', 'timed_out', 'never_scanned']) {
      expect(organisingLine(homeStatus(status)).text).not.toMatch(/us-east-1 · us-east-1/)
    }
  })
})

// ── Connect home cell (3d-1 leftover, D3 wording) ──

describe('Connect\'s home cell: "last scan didn\'t finish" on the shared scan state', () => {
  const connect = (c: ServicesCoverage) => describeCoverage(c, NOW, [], { ...scanState(c, NOW), home: homeRegionCheck(c) })
  it.each([
    ['an abandoned scan', abandoned],
    ['a failed scan (flag off)', failedFlagOff],
    ['a flagged latest_scan_failed', tab8],
  ] as const)('%s: cell "… · home · last scan didn\'t finish", headline "us-east-1: last scan didn\'t finish" (ruling Nov 19)', (_name, make) => {
    const v = connect(make())
    expect(v.chips[0].note).toMatch(/ · home · last scan didn't finish$/)
    expect(v.chips[0].note).not.toMatch(/last scan failed/)
    expect(v.headline).toBe("us-east-1: last scan didn't finish")
  })
  it.each([
    ['finished', () => tab5('ok')], ['home failed', () => homeStatus('failed')], ['running', running], ['former home', tab12Coverage], ['flagged running', tab2],
  ] as const)('negative %s: the cell doesn\'t say "didn\'t finish", nor does the headline', (_name, make) => {
    const v = connect(make())
    expect(v.chips[0].note).not.toMatch(/didn't finish/)
    expect(v.headline).not.toMatch(/didn't finish/)
  })
  it('negative: the Services Phase 1 strip (no shared state) keeps its own words', () => {
    const v = describeCoverage(failedFlagOff(), NOW, [])
    expect(v.chips[0].note).toMatch(/ · home · last scan failed$/)
    expect(v.headline).not.toMatch(/didn't finish/)
  })
})

// ── RR-L1 ──

describe('RR-L1: scanStateTime is Services\' own export, never picked again', () => {
  const cases: Record<string, () => ServicesCoverage> = {
    finished: () => tab5('ok'), 'home failed': () => homeStatus('failed'), running, abandoned, 'failed (flag off)': failedFlagOff,
    'flagged failed': tab8, 'flagged running': tab2, 'former home': tab12Coverage, none: neverScanned,
  }
  it.each(Object.keys(cases))('%s: the same instant and words as the Services line, and the words are in the line', (name) => {
    const c = cases[name]()
    const t = scanStateTime(c, NOW)
    expect(t).toEqual(redesignScanLineTime(c, NOW))
    const line = redesignScanLine(c, NOW).text
    if (t) {
      expect(line).toContain(t.text)
      expect(scanStateParts(c, NOW).map((p) => (typeof p === 'string' ? p : p.text)).join('')).toBe(line)
    } else {
      expect(scanStateParts(c, NOW)).toEqual([line])
    }
  })
  it('pinned literals: finished, running today (no "today, "), failed', () => {
    expect(scanStateTime(tab5('ok'), NOW)?.text).toBe('today, 10:20 AM')
    expect(scanStateTime(running(), NOW)).toEqual({ iso: '2026-11-15T13:00:00.000Z', text: '1:00 PM' })
    expect(scanStateTime(failedFlagOff(), NOW)).toEqual({ iso: '2026-11-15T13:05:00.000Z', text: 'today, 1:05 PM' })
    expect(scanStateTime(neverScanned(), NOW)).toBeNull()
  })
  it('source: servicesTruth.scanStateTime only calls redesignScanLineTime (no time fields read there)', () => {
    const s = src('app/(app)/services/servicesTruth.ts')
    const body = s.slice(s.indexOf('export function scanStateTime'), s.indexOf('/** The scan-state line as text parts'))
    expect(body).toMatch(/return redesignScanLineTime\(c, now\)/)
    expect(body).not.toMatch(/started_at|completed_at|scan_in_progress|lastCompletedScanIso|formatLocalWhen/)
  })
})

// ── D1 ──

describe('D1: Infrastructure\'s ownership link', () => {
  it('"See ownership in Services & Ownership →"; "Assign owners" is gone from the page source', () => {
    expect(OVERVIEW_COPY.seeOwnership).toBe('See ownership in Services & Ownership →')
    for (const f of ['overviewModel.ts', 'OwnershipGaps.tsx']) expect(src(`app/(app)/infrastructure/overview/${f}`)).not.toMatch(/Assign owners/)
  })
})

// ── D2 ──

/** Every user-facing "sync" on the live pages this PR touches, classified (log §3). */
const DISCOVERY_SCAN_FILES = [
  'app/(app)/infrastructure/overview/OverviewHeader.tsx',
  'app/(app)/infrastructure/overview/InfrastructureOverviewV2.tsx',
  'app/(app)/infrastructure/overview/overviewModel.ts',
  'app/(app)/security/overview/securityCopy.ts',
  'app/(app)/security/overview/SecurityHeader.tsx',
  'app/(app)/security/overview/SecurityOverviewV2.tsx',
]
/** A user-facing string literal saying sync: '…sync…', "…sync…" or `…sync…`, or JSX text " Sync now<". */
const SYNC_STRING = /(['"`])[^'"`\n]*\b[Ss]ync(?:s|ing|ed)?\b[^'"`\n]*\1|>\s*[^<{}\n]*\b[Ss]ync(?:s|ing|ed)?\b[^<{}\n]*</g
/** Not user-facing: an element id, a query-key constant and the button's internal state value (SyncState). */
const NOT_COPY = /security-sync-reason|LEGACY_SYNC_KEYS|^'syncing'$/
const userSync = (path: string) => (stripComments(src(path)).match(SYNC_STRING) ?? []).filter((m) => !NOT_COPY.test(m))
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('D2: the discovery scan says "scan"; a different synchronisation keeps "Sync"', () => {
  it('Security: the eight discovery-scan strings', () => {
    expect([SECURITY_COPY.syncNow, SECURITY_COPY.syncing, SECURITY_COPY.syncComplete(12, 3), SECURITY_COPY.syncFailed,
      SECURITY_COPY.syncForbidden, SECURITY_COPY.syncLimit, SECURITY_COPY.syncRateLimited, SECURITY_COPY.viewerCantSync]).toEqual([
      'Scan now', 'Scanning…', 'Scan finished — 12 new · 3 updated', 'Scan failed — check your AWS connection',
      "You don't have permission to start a scan.", "Your plan's AWS resource limit is reached.",
      'Too many scans. Try again in a few minutes.', "Viewers can't start a scan",
    ])
  })
  it('Infrastructure: button, green state and toasts', () => {
    expect([OVERVIEW_COPY.scanNow, OVERVIEW_COPY.scanning, OVERVIEW_COPY.scanFinished, OVERVIEW_COPY.scanFinishedToast(1234, 5), OVERVIEW_COPY.scanFailedToast]).toEqual([
      'Scan now', 'Scanning…', 'Scan finished', 'Scan finished — 1,234 new · 5 updated', 'Scan failed — check your AWS connection',
    ])
  })
  it('the same words Services uses for its own Scan now', () => {
    const services = src('app/(app)/services/redesignModel.ts')
    expect(services).toContain("scanNow: 'Scan now'")
    expect(services).toContain("scanning: 'Scanning…'")
    expect(services).toContain('`${num(outcome.discovered)} new · ${num(outcome.updated)} updated`')
  })
  it('no user-facing "sync" string is left in the live Infrastructure and Security pages', () => {
    for (const f of DISCOVERY_SCAN_FILES) expect([f, userSync(f)]).toEqual([f, []])
  })
  it('the plan catalog has no scan limit: the 402 names the AWS resource limit the server enforces', () => {
    expect(src('lib/plan/plan-catalog.ts')).not.toMatch(/scan limit/i)
    expect(src('lib/plan/plan-catalog.ts')).toContain('AWS resources monitored (up to)')
    expect(src('backend/src/middleware/subscription.middleware.ts')).toContain("export const checkDiscoveryLimit = checkResourceLimit('aws_resources', 0)")
  })
  it('retained "Sync" (a different synchronisation): HR-S13 is the Security Hub sync, byte for byte', () => {
    expect(HOME_REGION_COPY.securityHub('us-west-2')).toBe('Security Hub findings from us-west-2 appear after your next sync.')
    // The discovery scan never reads Security Hub: only the manual, admin-only POST /api/security-hub/sync does.
    expect(src('backend/src/services/security-hub-sync.service.ts')).toMatch(/Manual sync only/)
  })
  it('retained "Sync" elsewhere: Security Hub on Compliance, billing data, legacy Infrastructure (founder: leave legacy)', () => {
    expect(src('app/(app)/compliance/frameworks/complianceModel.ts')).toContain("onlyAdminsSyncSecurityHub: 'Only admins can sync Security Hub.'")
    expect(src('app/(app)/dashboard/page.tsx')).toContain('Billing sync in progress (24–48h)')
    const legacy = src('app/(app)/infrastructure/page.tsx')
    for (const s of ['Sync AWS', 'Syncing AWS...', 'Sync Complete', "toast.error('Sync failed — check your AWS connection')", 'Run a sync to generate your Infrastructure Posture score.']) expect(legacy).toContain(s)
  })
  it('negative control for the check above: it does find "sync" strings where they are kept (legacy Infrastructure)', () => {
    expect('x = "Sync now"'.match(SYNC_STRING)).toEqual(['"Sync now"'])
    expect(userSync('app/(app)/infrastructure/page.tsx').length).toBeGreaterThan(0)
  })
})

// ── D4 ──

describe('D4: one needs-attention sentence on Services (redesign) and Infrastructure', () => {
  it('the founder\'s string, exactly, and Infrastructure uses the same constant', () => {
    expect(ATTENTION_DEFINITION).toBe('Critical and high findings, cost recommendations estimated at $100/mo or more, and stopped, degraded or failed resources.')
    expect(OVERVIEW_COPY.attentionDescription).toBe(ATTENTION_DEFINITION)
    expect(OVERVIEW_COPY.costRowLabel).toBe('Cost · ≥ $100/mo est.')
  })
  it('source: the Services table shows it in the redesign and keeps its text with the redesign off (flag-off unchanged)', () => {
    const s = src('app/(app)/services/AttentionTable.tsx')
    expect(s).toContain('{redesign ? ATTENTION_DEFINITION : ATTENTION_DESCRIPTION}')
    expect(s).toContain("export const ATTENTION_DESCRIPTION = 'Critical and high findings, high-severity cost recommendations, stopped or failed resources'")
  })
})

// ── D7 ──

describe('D7: one label and target per link into Services', () => {
  it('"Region coverage →" to the card everywhere (Security\'s label); "View all" to ?show=needs_attention', () => {
    expect([REGION_COVERAGE_LINK, REGION_COVERAGE_HREF, NEEDS_ATTENTION_HREF]).toEqual(['Region coverage →', '/services#region-coverage', '/services?show=needs_attention'])
    expect([OVERVIEW_COPY.regionsLink, OVERVIEW_COPY.regionsHref, OVERVIEW_COPY.viewAllHref]).toEqual([REGION_COVERAGE_LINK, REGION_COVERAGE_HREF, NEEDS_ATTENTION_HREF])
    expect(SECURITY_COPY.regionCoverage).toBe(REGION_COVERAGE_LINK)
    expect(src('app/(app)/services/RegionCoverageCard.tsx')).toMatch(/['"]region-coverage['"]/)
  })
  it('"View regions" is gone from Infrastructure', () => {
    for (const f of ['overviewModel.ts', 'AccountStrip.tsx']) expect(src(`app/(app)/infrastructure/overview/${f}`)).not.toMatch(/View regions/)
  })
})

// ── D8 ──

const view = (o: Parameters<typeof accountsAnswer>[0]) => accountsAnswer(o).homeRegion as HomeRegionAccountView
const other = (state: HomeRegionProposalView['state']) => proposal({ state })
const COVERAGE = () => tab5('ok')

describe('D8: Connect AWS shows the suggestion exactly when Services\' banner would (Services\' own proposal fixtures)', () => {
  const OPEN: [string, HomeRegionProposalView][] = [['proposed (tab 9)', proposal()], ['split (tab 10)', split()], ['split, 7 regions', splitSeven()]]
  /** Founder ruling Nov 19: "proposed" with missing data: Services shows no banner, so Connect shows no line. */
  const PROPOSED_MISSING_DATA: [string, HomeRegionProposalView][] = [
    ['proposed, no region', proposal({ region: null })],
    ['proposed, no share for its region', proposal({ shares: proposal().shares.filter((x) => x.region !== 'us-west-2') })],
    ['proposed, no current share', proposal({ current: null })],
  ]
  const CLOSED: [string, HomeRegionProposalView | null][] = [
    ...PROPOSED_MISSING_DATA,
    ['no_signal', other('no_signal')], ['unavailable', other('unavailable')], ['none (null)', null],
    ['waiting', other('waiting')], ['split_waiting', other('split_waiting')], ['not_applicable', other('not_applicable')],
    ['accepted', other('accepted')], ['dismissed', other('dismissed')], ['superseded', other('superseded')],
  ]

  it.each(OPEN)('%s, owner: the Change link and the suggestion line', (_n, p) => {
    expect(connectHomeRegionLinks(view({ proposal: p, canChange: true }), COVERAGE())).toEqual({ change: true, suggestion: true })
  })
  it.each(OPEN)('%s, member: the value only', (_n, p) => {
    expect(connectHomeRegionLinks(view({ proposal: p, canChange: false }), COVERAGE())).toEqual({ change: false, suggestion: false })
  })
  it.each(CLOSED)('%s, owner: the Change link, no suggestion', (_n, p) => {
    expect(connectHomeRegionLinks(view({ proposal: p, canChange: true }), COVERAGE())).toEqual({ change: true, suggestion: false })
  })
  it('missing keys (an older server) or no response: the value only', () => {
    expect(connectHomeRegionLinks(undefined, COVERAGE())).toEqual({ change: false, suggestion: false })
    expect(connectHomeRegionLinks(null, COVERAGE())).toEqual({ change: false, suggestion: false })
  })
  it('Services\' precondition: no suggestion before coverage is read, or with no connected account (the Change link stays)', () => {
    const v = view({ proposal: proposal(), canChange: true })
    expect(connectHomeRegionLinks(v, undefined)).toEqual({ change: true, suggestion: false })
    const c = COVERAGE(); c.account = { ...c.account, connected: false }
    expect(connectHomeRegionLinks(v, c)).toEqual({ change: true, suggestion: false })
  })
  it('parity: for every fixture (incl. proposed with missing data) × owner/member, Connect\'s line = Services\' banner shown', () => {
    const c = COVERAGE()
    for (const [name, p] of [...OPEN, ...CLOSED]) {
      expect([name, homeRegionPromptShows(p, homeRegionOf(c))]).toEqual([name, homeRegionBanner(p, { canChange: true, scanRunning: false, home: homeRegionOf(c), multiRegion: false, accountId: ACCOUNT_ID }) !== null])
      for (const canChange of [true, false]) {
        const banner = homeRegionBanner(p, { canChange, scanRunning: false, home: homeRegionOf(c), multiRegion: false, accountId: ACCOUNT_ID })
        const links = connectHomeRegionLinks(view({ proposal: p, canChange }), c)
        expect([name, canChange, links.suggestion]).toEqual([name, canChange, canChange && banner !== null])
      }
    }
  })
  it.each(PROPOSED_MISSING_DATA)('%s: Services shows no banner and Connect no line', (_n, p) => {
    const c = COVERAGE()
    expect(homeRegionBanner(p, { canChange: true, scanRunning: false, home: homeRegionOf(c), multiRegion: false, accountId: ACCOUNT_ID })).toBeNull()
    expect(connectHomeRegionLinks(view({ proposal: p, canChange: true }), c).suggestion).toBe(false)
  })
  it('the approved strings', () => {
    expect([HOME_REGION_CHANGE, HOME_REGION_SUGGESTION, HOME_REGION_SUGGESTION_LINK]).toEqual([
      'Change in Services & Ownership →', 'DevControl has a home-region suggestion for this account.', 'Review it in Services & Ownership →',
    ])
  })
  it('source: Connect calls Services\' own visibility check and Services\' banner uses the same one; no Connect-specific rule', () => {
    const truth = src('app/(app)/services/servicesTruth.ts')
    const body = truth.slice(truth.indexOf('export function connectHomeRegionLinks'))
    expect(body).toMatch(/homeRegionPromptShows\(view\?\.proposal, homeRegionOf\(coverage\)\)/)
    expect(body).not.toMatch(/shares|amount|share\b|'proposed'|'split'/)
    const model = src('app/(app)/services/homeRegionModel.ts')
    const banner = model.slice(model.indexOf('export function homeRegionBanner'))
    expect(banner).toMatch(/if \(!p \|\| !homeRegionPromptShows\(p, o\.home\)\) return null/)
  })
})

// ── D9 + O3 ──

describe('D9: Operational Health names the tile\'s own region; O3 link label', () => {
  it('the caption takes the region it is given (never a literal)', () => {
    expect(OH_COPY.regionCaption('eu-west-2')).toBe("This page checks your home region, eu-west-2. Resources in other regions aren't checked here yet.")
    expect(OH_COPY.regionCaption('ap-south-1')).not.toContain('us-east-1')
    expect(src('app/(app)/admin/monitoring/operational-health/operationalHealthCopy.ts')).not.toMatch(/home region, us-|us-east-1/)
  })
  it('no region to name: the caption is unchanged; the link is Region coverage →', () => {
    expect(OH_COPY.regionCaptionNoRegion).toBe("This page checks one AWS region. Resources in other regions aren't checked yet.")
    expect([OH_COPY.regionCoverage, OH_COPY.regionCoverageHref]).toEqual(['Region coverage →', '/services#region-coverage'])
  })
  it('O3: "Services & Ownership →" to /services', () => {
    expect([TABLE_COPY.allServices, TABLE_HREF.allServices]).toEqual(['Services & Ownership →', '/services'])
  })
})

// ── D10 ──

describe('D10: no region literal in the legacy pages\' anomaly and recommendation lines', () => {
  it('legacy Security prints no "us-east-1"; legacy Infrastructure has no `?? \'us-east-1\'` fallback', () => {
    expect(src('app/(app)/security/page.tsx')).not.toContain('us-east-1')
    expect(src('app/(app)/infrastructure/page.tsx')).not.toMatch(/\?\? 'us-east-1'/)
  })
})
