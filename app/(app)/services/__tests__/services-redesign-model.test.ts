/**
 * The Services redesign's pure model (redesignModel.ts, PR 3b): every string
 * against the exact-string fixture `__fixtures__/services-redesign/strings.json`,
 * and the rules that need no rendering: the organising line for every doc
 * example, the banner's tone rule, the header line, tile captions, the
 * "What we didn't check" summary and the group time range. TZ UTC.
 */
process.env.TZ = 'UTC'

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  FAILURE_LABEL, LEGEND_TEXT, REDESIGN_COPY, SHORT_DETAILS, attentionScopeCaption, describeCoverageCard, describeNotChecked, failureCode,
  organisingLine, reasonLine, redesignScanLine, regionNoteText, resourcesCaptions, scanBanner, timeRange, type FailureCode,
} from '../redesignModel'
import { R_NOW, docExample, docExamples, flaggedCoverage, mrRegion, redesignStats } from './redesign-fixtures'
import { SCAN_RUNNING_HINT } from '../ServicesHeader'

const S = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'services-redesign', 'strings.json'), 'utf8'))
const CODES: FailureCode[] = ['access_denied', 'access_denied_scp', 'throttled', 'call_timeout', 'error', 'region_not_ready', 'region_deadline', 'scan_budget']

describe('exact strings (fixture)', () => {
  it('labels, short Details, reason lines, notes', () => {
    for (const code of CODES) {
      expect(FAILURE_LABEL[code], code).toBe(S.labels[code])
      expect(SHORT_DETAILS[code], code).toBe(S.shortDetails[code])
      expect(reasonLine(code, 'R'), code).toBe(S.reasonLines[code])
      expect(regionNoteText(code, 'R', code === 'throttled' ? 31 : null), code).toBe(S.notes[code])
    }
    expect(regionNoteText('throttled', 'R', null)).toBe(S.notes.throttledNoCount)
    expect(regionNoteText('throttled', 'R', 1)).toBe(S.notes.throttledNoCount + ' The 1 resource found there earlier stays listed until a complete scan.')
  })

  it('legend, card, page and header copy', () => {
    for (const [key, v] of Object.entries(LEGEND_TEXT)) expect(`${v.label}: ${v.text}`, key).toBe(S.legend[key])
    for (const key of Object.keys(S.card)) {
      const value = key === 'homeLine' ? REDESIGN_COPY.homeLine('R') : key === 'heading' ? REDESIGN_COPY.coverageHeading : (REDESIGN_COPY as any)[key]
      expect(value, key).toBe(S.card[key])
    }
    for (const key of Object.keys(S.page)) expect((REDESIGN_COPY as any)[key], key).toBe(S.page[key])
    expect(REDESIGN_COPY.scanNow).toBe(S.header.scanNow)
    expect(REDESIGN_COPY.scanning).toBe(S.header.scanning)
    expect(REDESIGN_COPY.noScanYet).toBe(S.header.none)
    expect(REDESIGN_COPY.dismiss).toBe(S.banner.dismiss)
    expect(SCAN_RUNNING_HINT).toBe(S.header.hint)
  })

  it('failureCode maps state + error_code (doc §5); an unknown stored code falls back per state', () => {
    expect(failureCode({ state: 'failed', error_code: 'throttled' })).toBe('throttled')
    expect(failureCode({ state: 'failed', error_code: 'call_timeout' })).toBe('call_timeout')
    expect(failureCode({ state: 'failed', error_code: 'error' })).toBe('error')
    expect(failureCode({ state: 'failed', error_code: null })).toBe('error')
    expect(failureCode({ state: 'denied', error_code: 'access_denied_scp' })).toBe('access_denied_scp')
    expect(failureCode({ state: 'denied', error_code: null })).toBe('access_denied')
    expect(failureCode({ state: 'not_ready', error_code: 'region_not_ready' })).toBe('region_not_ready')
    expect(failureCode({ state: 'not_checked_deadline', error_code: 'region_deadline' })).toBe('region_deadline')
    expect(failureCode({ state: 'not_checked_budget', error_code: 'scan_budget' })).toBe('scan_budget')
    for (const state of ['checked', 'checked_with_warnings', 'in_progress', 'not_started', 'excluded'] as const) expect(failureCode({ state, error_code: null })).toBeNull()
  })
})

describe('organising line, every doc example', () => {
  const EXPECTED: Record<string, string> = {
    all_checked: '3 of 3 regions checked · 3 with resources',
    in_progress: 'Scanning: 1 of 4 regions checked so far · 1 with resources · 3 still running or waiting',
    budget_incomplete: '2 of 4 regions checked · 2 with resources · 2 not checked',
    regional_failure: '1 of 4 regions checked · 1 with resources · 3 not checked',
    empty_regions: '3 of 3 regions checked · 1 with resources · 1 empty · 1 partly checked',
    not_enabled: '2 of 2 regions checked · 2 with resources',
    latest_scan_failed: 'Last scan failed after checking 1 of 2 regions · 1 with resources',
    home_not_us_east_1: '2 of 2 regions checked · 1 with resources · 1 empty',
    single_region: '1 of 1 region checked · 1 with resources',
    unattributed_warning: '3 of 3 regions checked · 2 with resources · 1 partly checked',
  }
  it('covers every example in the doc', () => {
    expect(Object.keys(docExamples()).sort()).toEqual(Object.keys(EXPECTED).sort())
  })
  it.each(Object.entries(EXPECTED))('%s', (name, line) => {
    const c = flaggedCoverage(docExample(name))
    expect(organisingLine(c)).toEqual({ text: line, failed: name === 'latest_scan_failed' })
  })
  it('a region that failed during a running scan is "not checked", so the line still adds up', () => {
    const mr = docExample('in_progress')
    mr.progress = { ...mr.progress, regions_done: 2, regions_running: 0, regions_waiting: 2 }
    expect(organisingLine(flaggedCoverage(mr)).text).toBe('Scanning: 1 of 4 regions checked so far · 1 with resources · 1 not checked · 2 still running or waiting')
  })
  it('no scan, or no list: S19 / "No scan has finished yet."', () => {
    const mr = docExample('all_checked')
    mr.coverage_status = 'unavailable'
    expect(organisingLine(flaggedCoverage({ ...mr })).text).toBe('No scan has finished yet.')
    expect(organisingLine(flaggedCoverage({ ...mr, regions: [] })).text).toBe(S.card.regionListUnread)
    expect(organisingLine(flaggedCoverage({ ...mr, scan: null })).text).toBe('No scan has finished yet.')
  })
})

describe('scan banner', () => {
  const id = '00000000-0000-4000-8000-00000000a001'
  const out = (jobId: string | null = id) => ({ jobId, discovered: 4, updated: 12 })
  it('green / amber (one named, several counted) / red, only when scan.id = jobId', () => {
    expect(scanBanner(flaggedCoverage(docExample('all_checked')), out())).toEqual({ tone: 'success', text: 'Scan finished · 3 of 3 regions checked', counts: '4 new · 12 updated' })
    expect(scanBanner(flaggedCoverage(docExample('regional_failure')), out())).toEqual({ tone: 'warning', text: "Scan finished · 1 of 4 regions checked · 3 regions couldn't be checked", counts: '4 new · 12 updated' })
    const one = docExample('budget_incomplete')
    one.regions.pop(); Object.assign(one.scan, { regions_total: 3 })
    expect(scanBanner(flaggedCoverage(one), out())?.text).toBe("Scan finished · 2 of 3 regions checked · ap-south-1 couldn't be checked")
    expect(scanBanner(flaggedCoverage(docExample('latest_scan_failed')), out())).toEqual({ tone: 'danger', text: 'Scan failed · it checked 1 of 2 regions, then stopped before finishing · try Scan now again', counts: null })
    expect(scanBanner(flaggedCoverage(docExample('single_region')), out())?.text).toBe('Scan finished · 1 of 1 region checked')
  })
  it('another scan, or no job id: no tone, the counts only; absent while a scan runs', () => {
    for (const o of [out('other'), out(null)]) expect(scanBanner(flaggedCoverage(docExample('all_checked')), o)).toEqual({ tone: 'neutral', text: 'Scan finished', counts: '4 new · 12 updated' })
    expect(scanBanner(flaggedCoverage(docExample('in_progress')), out())).toBeNull()
  })
  it('never green on completed_with_regions_not_checked', () => {
    for (const name of ['budget_incomplete', 'regional_failure']) expect(scanBanner(flaggedCoverage(docExample(name)), out())?.tone).toBe('warning')
  })
})

describe('header line (Services only)', () => {
  it('finished / running / failed / none, local time', () => {
    expect(redesignScanLine(flaggedCoverage(docExample('all_checked')), R_NOW)).toEqual({ state: 'finished', text: 'Last scan finished today, 10:20 AM' })
    expect(redesignScanLine(flaggedCoverage(docExample('in_progress')), R_NOW)).toEqual({ state: 'running', text: 'Scan in progress since 10:00 AM · 1 of 4 regions done' })
    expect(redesignScanLine(flaggedCoverage(docExample('in_progress')), R_NOW + 24 * 3600_000)).toEqual({ state: 'running', text: 'Scan in progress since yesterday, 10:00 AM · 1 of 4 regions done' })
    expect(redesignScanLine(flaggedCoverage(docExample('latest_scan_failed')), R_NOW)).toEqual({ state: 'failed', text: "Last scan: today, 10:21 AM · didn't finish" })
    const none = flaggedCoverage(docExample('all_checked'), { lastCompletedAt: null })
    expect(redesignScanLine({ ...none, multi_region: { ...none.multi_region, coverage_status: 'unavailable' } }, R_NOW)).toEqual({ state: 'none', text: 'No scan has finished yet.' })
  })
})

describe('tile captions', () => {
  it('V2-20: regions, 1 region, plus global, global only; nothing without attention or the field', () => {
    expect(attentionScopeCaption(redesignStats({ attention_scope: { regions: 2, global: 0 } }))).toBe('in 2 regions')
    expect(attentionScopeCaption(redesignStats({ attention_scope: { regions: 1, global: 0 } }))).toBe('in 1 region')
    expect(attentionScopeCaption(redesignStats({ attention_scope: { regions: 2, global: 1 } }))).toBe('in 2 regions, plus 1 global (CloudFront)')
    expect(attentionScopeCaption(redesignStats({ attention_scope: { regions: 0, global: 3 } }))).toBe('3 global (CloudFront)')
    expect(attentionScopeCaption(redesignStats({ needs_attention: 0, attention_scope: { regions: 0, global: 0 } }))).toBeNull()
    expect(attentionScopeCaption(redesignStats({ attention_scope: undefined }))).toBeNull()
  })
  it('S21 / S21b / V2-21 from multi_region; today\'s caption for an unflagged organization', () => {
    expect(resourcesCaptions(flaggedCoverage(docExample('all_checked'), { cloudfront: 3 }))).toEqual({ scope: 'in 3 regions, plus 3 global (CloudFront)', earlier: null })
    expect(resourcesCaptions(flaggedCoverage(docExample('single_region')))).toEqual({ scope: 'in eu-west-1', earlier: null })
    expect(resourcesCaptions(flaggedCoverage(docExample('in_progress')))).toEqual({ scope: 'in 2 regions', earlier: '2 from an earlier scan; may change when the scan finishes' })
    expect(resourcesCaptions(flaggedCoverage(docExample('regional_failure')))).toEqual({ scope: 'in 2 regions', earlier: '3 from an earlier scan' })
    const unflagged = { ...flaggedCoverage(docExample('all_checked')), multi_region: undefined }
    expect(resourcesCaptions(unflagged)).toEqual({ scope: 'in us-east-1, plus S3 in every region and CloudFront', earlier: null })
  })
})

describe('group "Last full scan" range', () => {
  it('one time, a same-day range, a range across days, none', () => {
    expect(timeRange(['2026-11-15T10:03:00.000Z', '2026-11-15T10:03:00.000Z'], R_NOW)).toEqual({ iso: '2026-11-15T10:03:00.000Z' })
    expect(timeRange(['2026-11-15T16:36:00.000Z', null, '2026-11-15T16:31:00.000Z'], R_NOW)).toBe('today, 4:31–4:36 PM')
    expect(timeRange(['2026-11-15T10:31:00.000Z', '2026-11-15T13:05:00.000Z'], R_NOW)).toBe('today, 10:31 AM–1:05 PM')
    expect(timeRange(['2026-11-14T22:00:00.000Z', '2026-11-15T10:00:00.000Z'], R_NOW)).toBe('yesterday, 10:00 PM – today, 10:00 AM')
    expect(timeRange([null, null], R_NOW)).toBeNull()
  })
})

describe('coverage card: rows and groups only from the server fields', () => {
  it('empty grouping only from `empty`; a 0-resource partial region is its own row, never empty', () => {
    const view = describeCoverageCard(flaggedCoverage(docExample('empty_regions')), R_NOW)
    expect(view.rows.map((r) => r.key)).toEqual(['region-us-east-1', 'region-ap-south-1', 'empty'])
    expect(view.rows[1]).toMatchObject({ resources: 0, status: { key: 'partial' } })
    expect(view.rows[2]).toMatchObject({ regions: ['eu-west-1'], resources: 0, status: { key: 'complete' } })
  })
  it('excluded regions are not shown; CloudFront is never a region row', () => {
    const mr = docExample('all_checked')
    mr.regions.push(mrRegion('zz-test-9', { state: 'excluded' }))
    const view = describeCoverageCard(flaggedCoverage(mr, { cloudfront: 2 }), R_NOW)
    expect(view.rows.map((r) => r.key)).not.toContain('region-zz-test-9')
    expect(view.rows.some((r) => r.label.startsWith('CloudFront'))).toBe(false)
    expect(view.global).toMatchObject({ label: 'CloudFront · 2 distributions', resources: 2 })
    expect(describeCoverageCard(flaggedCoverage(mr, { cloudfront: 1 }), R_NOW).global?.label).toBe('CloudFront · 1 distribution')
    expect(describeCoverageCard(flaggedCoverage(mr), R_NOW).global).toBeNull()
  })
})

describe('What we didn\'t check (option b)', () => {
  it('flagged: region lines first, no "other enabled regions", no job warning lines', () => {
    const c = flaggedCoverage(docExample('regional_failure'), { warnings: ['discovery_listing_truncated'] })
    const view = describeNotChecked(c, redesignStats(), R_NOW, ['resource_explorer_no_index'])
    expect(view.lines.map((l) => l.key)).toEqual(['region-ap-south-1', 'region-eu-west-1', 'region-me-central-1', 'iam', 'tags-unknown', 'types'])
    expect(view.summary).toBe("Not checked: ap-south-1 on the last scan · eu-west-1 on the last scan · me-central-1 on the last scan · IAM · 2 resources' tags · other resource types.")
  })
  it('one unreadable resource reads "1 resource\'s tags"', () => {
    const view = describeNotChecked(flaggedCoverage(docExample('all_checked')), redesignStats({ ownership: { owned: 1, unowned: 0, unknown: 1 } }), R_NOW, [])
    expect(view.summary).toBe("Not checked: IAM · 1 resource's tags · other resource types.")
  })
})
