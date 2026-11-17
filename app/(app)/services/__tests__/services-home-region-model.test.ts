/**
 * The Services home-region model (homeRegionModel.ts + the former-home rules of
 * redesignModel.ts, PR 3c): every string against the exact-string fixture
 * `__fixtures__/services-redesign/home-region-strings.json`, the banner per
 * server state (only `proposed` and `split` render; nothing is derived from
 * shares), amounts (never $0, never a sum), the dialog options and "What
 * changes", the error mapping by CODE, the former home (flag off) and the S35
 * founder copy fix. TZ UTC.
 */
process.env.TZ = 'UTC'

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import {
  HOME_REGION_COPY, amountText, changeErrorText, changedText, connectionAccountId, dialogOptions, homeRegionBanner, percentText,
  periodText, previewRefusalText, spendBars, whatChanges,
} from '../homeRegionModel'
import { REDESIGN_COPY, describeCoverageCard, describeNotChecked, formerHomeOf, organisingLine, resourcesCaptions } from '../redesignModel'
import { regionOptionLabel } from '../allResources'
import { R_NOW, docExample, flaggedCoverage, tab5 } from './redesign-fixtures'
import { ACCOUNT_ID, CHANGED_AT, preview, previewFor, proposal, split, splitSeven, tab12Scan } from './home-region-fixtures'

const S = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'services-redesign', 'home-region-strings.json'), 'utf8'))
const OWNER = { canChange: true, scanRunning: false, home: 'us-east-1', multiRegion: false, accountId: ACCOUNT_ID }
const STATES = ['proposed', 'waiting', 'not_applicable', 'split', 'split_waiting', 'accepted', 'dismissed', 'superseded', 'no_signal', 'unavailable'] as const

describe('exact strings (fixture)', () => {
  it('proposal (HR-S1–S5), split (V2-1…V2-8), dialog (HR-S10–S16, V2-9)', () => {
    const C = HOME_REGION_COPY
    expect(C.proposalTitle('R')).toBe(S.proposal.title)
    expect(C.proposalBody('84', 'R', 'H', '3', true)).toBe(S.proposal.bodyFlagOff)
    expect(C.proposalBody('84', 'R', 'H', '3', false)).toBe(S.proposal.bodyFlagOn)
    expect([C.proposalUse('R'), C.keep('H')]).toEqual(S.proposal.buttons)
    expect(C.proposalFootnote('A', 'S', 'E')).toBe(S.proposal.footnote)
    expect(C.scanRunning).toBe(S.proposal.scanRunning)
    expect(C.ownerOnlyChange).toBe(S.proposal.member)
    expect([C.splitTitle, C.splitBody, C.choose, C.ownerOnlyChoose, C.splitNote, C.splitFootnote('A', 'S', 'E'), C.otherRegions(2), C.homeNow])
      .toEqual([S.split.title, S.split.body, S.split.choose, S.split.member, S.split.note, S.split.footnote, S.split.other, S.split.homeNow])
    expect([C.dialogTitle, C.dialogTitleSplit, C.dialogIntro(false), C.dialogIntro(true), C.selectLabel, C.placeholder, C.optionCurrent('R'), C.optionAmount('R', '$1.00'), C.optionNoAmount('R'), C.onlyEnabled, C.whatChangesLater, C.whatChanges])
      .toEqual([S.dialog.title, S.dialog.titleSplit, S.dialog.introFlagOn, S.dialog.introFlagOff, S.dialog.label, S.dialog.placeholder, S.dialog.current, S.dialog.amount, S.dialog.noAmount, S.dialog.onlyEnabled, S.dialog.later, S.dialog.whatChanges])
    expect([C.scanStarts('N'), C.costLeaving(3, 'O'), C.costLeaving(1, 'O'), C.resourcesKept(4, 'O'), C.resourcesKept(1, 'O'), C.securityHub('N')])
      .toEqual([S.dialog.scanStarts, S.dialog.costLeaving, S.dialog.costLeavingOne, S.dialog.kept, S.dialog.keptOne, S.dialog.securityHub])
    expect([C.confirmNone, C.confirm('N'), C.cancel]).toEqual([S.dialog.confirmNone, S.dialog.confirm, S.dialog.cancel])
    expect([C.errScan, C.errNotEnabled('R'), C.errOwner, C.errGeneric]).toEqual(S.errors)
    expect([C.changedScanStarted('N'), C.changedNextScan('N')]).toEqual(S.success)
    expect(C.change).toBe(S.change)
  })

  it('former home and the S35 copy fix', () => {
    expect([REDESIGN_COPY.formerHomeChip, REDESIGN_COPY.noLongerScanned, REDESIGN_COPY.formerHomeDetails, REDESIGN_COPY.footerOffNone])
      .toEqual([S.former.chip, S.former.status, S.former.details, S.footerOffNone])
  })
})

describe('errors by the server CODE (HR-S15)', () => {
  it.each([
    ['SCAN_IN_PROGRESS', 'A scan is running. You can change the home region when it finishes.'],
    ['REGION_NOT_ENABLED', "us-west-1 isn't enabled in this AWS account."],
    ['HOME_REGION_OWNER_ONLY', 'Only an organization owner can change the home region.'],
  ])('%s', (code, text) => expect(changeErrorText(code, 'us-west-1')).toBe(text))

  it.each([
    'INVALID_REGION', 'HOME_REGION_UNCHANGED', 'AWS_NOT_CONNECTED', 'AWS_ACCOUNT_AMBIGUOUS', 'REGION_LIST_UNKNOWN', 'REGION_EXCLUDED',
    'CONNECTION_CHANGED', 'HOME_REGION_CHANGE_BUSY', 'HOME_REGION_CHANGE_FAILED', 'HOME_REGION_UNAVAILABLE', 'NO_OPEN_PROPOSAL', 'SOMETHING_NEW',
  ])('every other code (%s) → the generic line', (code) => expect(changeErrorText(code, 'r')).toBe(HOME_REGION_COPY.errGeneric))

  it('no code at all (network error, an older 403 with a message only) → generic, never the owner text', () => {
    expect(changeErrorText(null, 'r')).toBe(HOME_REGION_COPY.errGeneric)
  })

  it('the preview refusal NAMES map to the same texts', () => {
    expect(previewRefusalText('scan_in_progress', 'r')).toBe(HOME_REGION_COPY.errScan)
    expect(previewRefusalText('region_not_enabled', 'r')).toBe("r isn't enabled in this AWS account.")
    expect(previewRefusalText('region_excluded', 'r')).toBe(HOME_REGION_COPY.errGeneric)
  })

  it('success by scan_started (both FOUNDER APPROVAL REQUIRED)', () => {
    expect(changedText('us-west-2', true)).toBe('Home region changed to us-west-2. A scan has started.')
    expect(changedText('us-west-2', false)).toBe('Home region changed to us-west-2. The next scan will check it.')
  })
})

describe('numbers', () => {
  it('shares as sent; amounts only above 0, never $0, two decimals', () => {
    expect([percentText(84), percentText(7.9), percentText(3), percentText(29.6)]).toEqual(['84', '7.9', '3', '29.6'])
    expect(amountText(1284.1)).toBe('$1,284.10')
    expect(amountText(0.01)).toBe('$0.01')
    for (const v of [0, -1, null, undefined, Number.NaN]) expect(amountText(v as any)).toBeNull()
  })

  it('period: the end is exclusive (end − 1 day); the year once, or on both sides across a year', () => {
    expect(periodText({ start: '2026-10-17', end: '2026-11-16' })).toEqual({ start: 'Oct 17', end: 'Nov 15, 2026' })
    expect(periodText({ start: '2025-12-10', end: '2026-01-09' })).toEqual({ start: 'Dec 10, 2025', end: 'Jan 8, 2026' })
    expect(periodText({ start: '2026-11-16', end: '2026-11-16' })).toBeNull()
  })

  it('the connection account: the one active row, 12 digits; otherwise none', () => {
    expect(connectionAccountId([{ account_id: ACCOUNT_ID, status: 'active' }, { account_id: '123456789012', status: 'disconnected' }])).toBe(ACCOUNT_ID)
    expect(connectionAccountId([{ account_id: ACCOUNT_ID, status: 'active' }, { account_id: '123456789012', status: 'active' }])).toBeNull()
    expect(connectionAccountId([{ account_id: 'acct-1', status: 'active' }])).toBeNull()
  })
})

describe('banner: the server state only', () => {
  it.each(STATES)('%s', (state) => {
    const p = { ...proposal(), state }
    const view = homeRegionBanner(p, OWNER)
    expect(view?.kind ?? null).toBe(state === 'proposed' ? 'proposal' : state === 'split' ? 'split' : null)
  })

  it('split_waiting with split-looking shares → nothing (never re-derived from amounts or shares)', () => {
    expect(homeRegionBanner(split({ state: 'split_waiting' }), OWNER)).toBeNull()
    // and a "proposed" state with a near-tie in the shares is still the proposal: the server decided.
    expect(homeRegionBanner(split({ state: 'proposed', region: 'us-west-2' }), OWNER)?.kind).toBe('proposal')
  })

  it('null or absent → nothing', () => {
    expect(homeRegionBanner(null, OWNER)).toBeNull()
    expect(homeRegionBanner(undefined, OWNER)).toBeNull()
  })

  it('proposal, owner, flag off (tab 9)', () => {
    const v = homeRegionBanner(proposal(), OWNER)!
    expect(v.title).toBe('Your AWS costs point to us-west-2 as your home region.')
    expect(v.body).toBe("84% of this account's regional AWS spend in the last 30 days was in us-west-2; us-east-1 (your home region now) had 3%. Your home region is where DevControl checks cost savings, Operational Health and Security Hub, and the one region it scans for resources (S3 and CloudFront are checked everywhere).")
    expect(v.owner).toEqual({ primary: 'Use us-west-2', keep: 'Keep us-east-1', disabled: false, hint: null })
    expect(v.memberLine).toBeNull()
    expect(v.footnote).toBe("Based on AWS Cost Explorer usage charges for account 111122223333, Oct 17 – Nov 15, 2026. Credits, refunds and tax aren't included. You can change your home region at any time on the Services page.")
    expect(v.bars.map((b) => [b.label, b.homeNow, b.shareText, b.amount])).toEqual([
      ['us-west-2', false, '84%', '$1,284.10'], ['eu-west-1', false, '7.9%', '$120.33'], ['us-east-2', false, '5.1%', '$78.40'], ['us-east-1', true, '3%', '$45.92'],
    ])
  })

  it('proposal while a scan runs: both buttons disabled with HR-S5', () => {
    expect(homeRegionBanner(proposal(), { ...OWNER, scanRunning: true })!.owner).toEqual({ primary: 'Use us-west-2', keep: 'Keep us-east-1', disabled: true, hint: 'You can switch when the current scan finishes.' })
  })

  it('proposal, member: no buttons, the HR-S15 line; flag on: no bracket', () => {
    const v = homeRegionBanner(proposal(), { ...OWNER, canChange: false, multiRegion: true })!
    expect(v.owner).toBeNull()
    expect(v.memberLine).toBe('Only an organization owner can change the home region.')
    expect(v.body.endsWith('checks cost savings, Operational Health and Security Hub.')).toBe(true)
  })

  it('split, owner and member (tab 10): no region named, no bar led, Choose + Keep / V2-8', () => {
    const v = homeRegionBanner(split(), OWNER)!
    expect([v.title, v.region, v.body, v.note]).toEqual([HOME_REGION_COPY.splitTitle, null, HOME_REGION_COPY.splitBody, HOME_REGION_COPY.splitNote])
    expect(v.owner).toEqual({ primary: 'Choose your home region', keep: 'Keep us-east-1', disabled: false, hint: null })
    expect(v.footnote).toBe("Based on AWS Cost Explorer usage charges for account 111122223333, Oct 17 – Nov 15, 2026. Credits, refunds and tax aren't included.")
    const m = homeRegionBanner(split(), { ...OWNER, canChange: false })!
    expect([m.owner, m.memberLine]).toEqual([null, 'Only an organization owner can choose the home region.'])
  })

  it('more than 5 regions: "Other regions (2)" last; shares as sent add to 100; no total row, no sum', () => {
    const bars = spendBars(splitSeven())
    expect(bars.map((b) => b.label)).toEqual(['us-west-2', 'eu-west-1', 'ap-south-1', 'us-east-2', 'sa-east-1', 'Other regions (2)'])
    expect(bars.at(-1)).toMatchObject({ region: false, shareText: '7.3%', amount: '$292.00' })
    expect(Math.round(bars.reduce((n, b) => n + b.share, 0) * 10) / 10).toBe(100)
    // The current home (in the other regions) gets no bar of its own: it would count twice.
    expect(bars.some((b) => b.homeNow)).toBe(false)
  })

  it('an amount of 0 from the server renders "—", never $0', () => {
    const bars = spendBars(proposal({ shares: [{ region: 'us-west-2', share: 100, amount: 50 }, { region: 'us-east-1', share: 0, amount: 0 }] }))
    expect(bars.map((b) => b.amount)).toEqual(['$50.00', null])
  })

  it('no account id or no period → no footnote (never a made-up account)', () => {
    expect(homeRegionBanner(proposal(), { ...OWNER, accountId: null })!.footnote).toBeNull()
    expect(homeRegionBanner(proposal({ period: null }), OWNER)!.footnote).toBeNull()
  })
})

describe('dialog', () => {
  it('options: enabled and choosable only, region-name order, current not selectable, amounts from the open prompt', () => {
    expect(dialogOptions(preview().regions, split())).toEqual([
      { value: 'ap-northeast-1', label: 'ap-northeast-1 · —', disabled: false },
      { value: 'eu-west-1', label: 'eu-west-1 · —', disabled: false },
      { value: 'us-east-1', label: 'us-east-1 (current)', disabled: true },
      { value: 'us-east-2', label: 'us-east-2 · $1,080.36 in the last 30 days', disabled: false },
      { value: 'us-west-2', label: 'us-west-2 · $1,215.40 in the last 30 days', disabled: false },
    ])
  })

  it('options without an open prompt: no amounts, no "—"', () => {
    expect(dialogOptions(preview().regions, null).map((o) => o.label)).toEqual(['ap-northeast-1', 'eu-west-1', 'us-east-1 (current)', 'us-east-2', 'us-west-2'])
  })

  it('order comes from the names, not from the server order or the spend', () => {
    const shuffled = [...preview().regions].reverse()
    expect(dialogOptions(shuffled, proposal()).map((o) => o.value)).toEqual(['ap-northeast-1', 'eu-west-1', 'us-east-1', 'us-east-2', 'us-west-2'])
  })

  it('an evidence amount of 0 → "—", never $0; no total anywhere', () => {
    const labels = dialogOptions(preview().regions, proposal({ shares: [{ region: 'us-west-2', share: 100, amount: 0 }] })).map((o) => o.label)
    expect(labels.join('|')).not.toMatch(/\$0\b|\$0\.00/)
    expect(labels).toContain('us-west-2 · —')
  })

  it('What changes: scan, cost (n > 0), flag-off line (non-null, > 0), Security Hub, V2-5 last', () => {
    expect(whatChanges(previewFor('us-west-2').target!, 'us-east-1')).toEqual([
      'A scan of us-west-2 starts right away.',
      '3 cost findings in us-east-1 leave your savings total. They come back if you switch back.',
      'The 4 resources already found in us-east-1 stay listed, marked “no longer scanned”.',
      'Security Hub findings from us-west-2 appear after your next sync.',
      'Your selection controls home-region-only checks. It does not enable multi-region discovery.',
    ])
    expect(whatChanges(previewFor('us-west-2', { costLeaving: 0, multiRegion: true }).target!, 'us-east-1')).toEqual([
      'A scan of us-west-2 starts right away.',
      'Security Hub findings from us-west-2 appear after your next sync.',
      'Your selection controls home-region-only checks. It does not enable multi-region discovery.',
    ])
    expect(whatChanges(previewFor('us-west-2', { kept: 0 }).target!, 'us-east-1').some((l) => l.includes('stay listed'))).toBe(false)
  })
})

describe('former home (flag off, tab 12)', () => {
  const c = () => tab12Scan().coverage

  it('the server keys, unflagged only; flagged → none (the old home is scanned)', () => {
    expect(formerHomeOf(c())).toEqual({ region: 'us-east-1', changedAt: CHANGED_AT, earlier: 4 })
    const flagged = flaggedCoverage(docExample('all_checked'))
    flagged.account = { ...flagged.account, previous_home_region: 'eu-west-1', home_region_changed_at: CHANGED_AT, previous_home_region_resources: 2 }
    expect(formerHomeOf(flagged)).toBeNull()
    expect(formerHomeOf(tab5())).toBeNull()
  })

  it('the card: home first, then the former home row; never counted as checked; HR-S18 note; legend', () => {
    const view = describeCoverageCard(c(), R_NOW)
    expect(organisingLine(c()).text).toBe('1 of 4 regions checked · us-west-2')
    expect(view.rows.map((r) => r.key)).toEqual(['region-us-west-2', 'region-us-east-1', 'not-scanned', 'not-enabled'])
    expect(view.rows[1]).toMatchObject({
      label: 'us-east-1', formerHome: true, resources: 6, resourcesNote: '2 S3 buckets checked today · 4 from earlier scans',
      status: { key: 'no_longer', label: 'No longer scanned' }, details: 'Not scanned since your home region moved. S3 buckets here are still checked on every scan.',
    })
    expect(view.rows[1].home).toBeFalsy()
    expect(view.rows[2].label).toBe('2 regions not scanned yet')
    expect(view.notes).toEqual([{ key: 'former-home', tone: 'info', parts: ["4 resources in us-east-1 are from earlier scans. us-east-1 hasn't been scanned since your home region moved to us-west-2 on Nov 14, 2026."] }])
    expect(view.legend.map((l) => l.key)).toEqual(['complete', 'not_scanned', 'no_longer', 'not_enabled'])
  })

  it('card = rows + CloudFront: the region rows and CloudFront add up to /stats total; the former row\'s two segments add up to its count', () => {
    const scan = tab12Scan()
    const view = describeCoverageCard(scan.coverage, R_NOW)
    const regional = view.rows.filter((r) => r.kind === 'region').reduce((n, r) => n + (r.resources ?? 0), 0)
    const s3NotScanned = 1 // eu-west-1's bucket, in the not-scanned group's "1 S3 bucket listed"
    expect(regional + s3NotScanned + (view.global?.resources ?? 0)).toBe(scan.stats.total)
    expect(view.rows.find((r) => r.key === 'not-scanned')!.resourcesNote).toBe('1 S3 bucket listed')
    expect(2 + 4).toBe(view.rows[1].resources)
  })

  it('no earlier rows (G2b 0): no HR-S18 note, no "from earlier scans" segment', () => {
    const cov = c()
    cov.account.previous_home_region_resources = 0
    const view = describeCoverageCard(cov, R_NOW)
    expect(view.notes).toEqual([])
    expect(view.rows[1].resourcesNote).toBe('2 S3 buckets checked today')
  })

  it('singular forms', () => {
    const cov = c()
    cov.account.previous_home_region_resources = 1
    cov.scope.s3.regions = cov.scope.s3.regions.map((r: any) => (r.region === 'us-east-1' ? { ...r, count: 1 } : r))
    const view = describeCoverageCard(cov, R_NOW)
    expect(view.rows[1].resourcesNote).toBe('1 S3 bucket checked today · 1 from earlier scans')
    expect(view.notes[0].parts[0]).toMatch(/^1 resource in us-east-1 is from earlier scans\./)
  })

  it('V2-21 tile line, V2-47 in What we didn\'t check, HR-S17 filter option', () => {
    expect(resourcesCaptions(c()).earlier).toBe('4 in us-east-1 from earlier scans')
    const nc = describeNotChecked(c(), tab12Scan().stats, R_NOW, [])
    expect(nc.lines.map((l) => l.key).slice(0, 2)).toEqual(['regions', 'former-home'])
    expect(nc.lines[1].text).toBe("us-east-1 hasn't been scanned since Nov 14, 2026, except for S3 buckets.")
    expect(nc.summary).toMatch(/^Not checked: other enabled regions \(S3 only\) · us-east-1 since Nov 14 · /)
    expect(regionOptionLabel('us-east-1', 6, 'us-west-2', 'us-east-1')).toBe('us-east-1, no longer scanned (6)')
    expect(regionOptionLabel('us-west-2', 5, 'us-west-2', 'us-east-1')).toBe('us-west-2, home (5)')
  })
})
