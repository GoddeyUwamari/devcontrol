/**
 * What the Services page says about the home region (multi-region PR 3c, mock
 * v2.1 tabs 9–12): the proposal and split-spend banners, the change dialog, and
 * the error and success lines. Pure, so every string and rule is tested without
 * rendering. Behind NEXT_PUBLIC_SERVICES_REDESIGN.
 *
 * Rules (pr3-step1.md §B.6, §E.5; the PR 3c brief):
 * - A banner renders only for the server's `home_region_proposal.state`:
 *   `proposed` → the proposal banner, `split` → the split-spend banner, every
 *   other state (split_waiting, waiting, not_applicable, …) → nothing. The state
 *   is never worked out here from shares or amounts.
 * - Amounts only where the server sent a spend amount above 0; otherwise "—".
 *   Never $0, never a calculated or summed total (review L-2).
 * - Owner controls only when `can_change_home_region` is true (G9, the current
 *   membership); the server refuses everyone else anyway.
 * - Errors by the server's error code, never by HTTP status alone.
 * - No region literal: every region comes from the API.
 */
import type { HomeRegionProposalView, RegionSpendShare } from '@/lib/services/aws-accounts.service'

// ── Copy (exact strings; founder-approved HR-S1–S16, V2-1…V2-9, and the PR 3c brief) ──

export const HOME_REGION_COPY = {
  change: 'Change',
  // HR-S1–S5 (proposal)
  proposalTitle: (r: string) => `Your AWS costs point to ${r} as your home region.`,
  proposalBody: (p: string, r: string, h: string, q: string, flagOff: boolean) =>
    `${p}% of this account's regional AWS spend in the last 30 days was in ${r}; ${h} (your home region now) had ${q}%. `
    + 'Your home region is where DevControl checks cost savings, Operational Health and Security Hub'
    + (flagOff ? ', and the one region it scans for resources (S3 and CloudFront are checked everywhere)' : '') + '.',
  proposalUse: (r: string) => `Use ${r}`,
  keep: (h: string) => `Keep ${h}`,
  proposalFootnote: (acct: string, start: string, end: string) =>
    `Based on AWS Cost Explorer usage charges for account ${acct}, ${start} – ${end}. Credits, refunds and tax aren't included. You can change your home region at any time on the Services page.`,
  scanRunning: 'You can switch when the current scan finishes.',
  ownerOnlyChange: 'Only an organization owner can change the home region.',
  // V2-1…V2-8 (split spend)
  splitTitle: 'Your AWS spend is distributed across multiple regions.',
  splitBody: "We couldn't identify one clear home region from your last 30 days of regional AWS spend. Choose where DevControl should run cost savings, Operational Health and Security Hub checks.",
  choose: 'Choose your home region',
  ownerOnlyChoose: 'Only an organization owner can choose the home region.',
  splitNote: 'Your selection controls home-region-only checks. It does not enable multi-region discovery.',
  splitFootnote: (acct: string, start: string, end: string) =>
    `Based on AWS Cost Explorer usage charges for account ${acct}, ${start} – ${end}. Credits, refunds and tax aren't included.`,
  otherRegions: (n: number) => `Other regions (${n})`,
  homeNow: '(home now)',
  barsLabel: 'Regional usage charges, last 30 days',
  // HR-S10–S16, V2-9 (dialog)
  dialogTitle: 'Change home region',
  dialogTitleSplit: 'Choose your home region',
  dialogIntro: (flagOff: boolean) =>
    'Your home region is where DevControl checks cost savings, Operational Health and Security Hub.'
    + (flagOff ? " It's also the one region scanned for resources, apart from S3 and CloudFront." : ''),
  selectLabel: 'Home region',
  placeholder: 'Select a region',
  optionCurrent: (r: string) => `${r} (current)`,
  optionAmount: (r: string, amount: string) => `${r} · ${amount} in the last 30 days`,
  onlyEnabled: 'Only regions enabled in this AWS account are listed.',
  whatChangesLater: '“What changes” appears once a region is selected.',
  whatChanges: 'What changes',
  scanStarts: (r: string) => `A scan of ${r} starts right away.`,
  costLeaving: (n: number, old: string) => (n === 1
    ? `1 cost finding in ${old} leaves your savings total. It comes back if you switch back.`
    : `${n.toLocaleString('en-US')} cost findings in ${old} leave your savings total. They come back if you switch back.`),
  resourcesKept: (k: number, old: string) => (k === 1
    ? `The 1 resource already found in ${old} stays listed, marked “no longer scanned”.`
    : `The ${k.toLocaleString('en-US')} resources already found in ${old} stay listed, marked “no longer scanned”.`),
  securityHub: (r: string) => `Security Hub findings from ${r} appear after your next sync.`,
  confirmNone: 'Change home region',
  confirm: (r: string) => `Change to ${r}`,
  cancel: 'Cancel',
  close: 'Close',
  loading: 'Loading regions…',
  // HR-S15 (by code)
  errScan: 'A scan is running. You can change the home region when it finishes.',
  errNotEnabled: (r: string) => `${r} isn't enabled in this AWS account.`,
  errOwner: 'Only an organization owner can change the home region.',
  errGeneric: "The home region couldn't be changed. Nothing was changed. Try again.",
  // Keep / dismiss failed with any code but NO_OPEN_PROPOSAL (founder decision f)
  keepFailed: "Your choice couldn't be saved. Nothing was changed. Try again.",
  // HR-S16 + the brief's scan_started false variant (FOUNDER APPROVAL REQUIRED: both)
  changedScanStarted: (r: string) => `Home region changed to ${r}. A scan has started.`,
  changedNextScan: (r: string) => `Home region changed to ${r}. The next scan will check it.`,
} as const

/** The server's error codes the dialog has words for (HR-S15); every other code reads errGeneric. */
export const HOME_REGION_ERROR_CODES = {
  scanInProgress: 'SCAN_IN_PROGRESS',
  regionNotEnabled: 'REGION_NOT_ENABLED',
  ownerOnly: 'HOME_REGION_OWNER_ONLY',
  noOpenProposal: 'NO_OPEN_PROPOSAL',
} as const

/** HR-S15 by the server's error code (never by HTTP status). `region` is the region asked for. */
export function changeErrorText(code: string | null, region: string): string {
  switch (code) {
    case HOME_REGION_ERROR_CODES.scanInProgress: return HOME_REGION_COPY.errScan
    case HOME_REGION_ERROR_CODES.regionNotEnabled: return HOME_REGION_COPY.errNotEnabled(region)
    case HOME_REGION_ERROR_CODES.ownerOnly: return HOME_REGION_COPY.errOwner
    default: return HOME_REGION_COPY.errGeneric
  }
}

/** The preview's `target.refusal` (a refusal NAME, not a code) as the same HR-S15 text. */
export function previewRefusalText(refusal: string, region: string): string {
  switch (refusal) {
    case 'scan_in_progress': return HOME_REGION_COPY.errScan
    case 'region_not_enabled': return HOME_REGION_COPY.errNotEnabled(region)
    default: return HOME_REGION_COPY.errGeneric
  }
}

/** HR-S16, or the next-scan variant when the follow-up scan didn't take the lease. */
export function changedText(to: string, scanStarted: boolean): string {
  return scanStarted ? HOME_REGION_COPY.changedScanStarted(to) : HOME_REGION_COPY.changedNextScan(to)
}

// ── Numbers ──

/** "84%" / "7.9%": a share as the server sent it (whole numbers without a decimal). */
export function percentText(share: number): string {
  return Number.isInteger(share) ? `${share}` : share.toFixed(1)
}

/** "$1,284.10" for an amount the server sent above 0; null otherwise (rendered "—", never $0). */
export function amountText(amount: number | null | undefined): string | null {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "Oct 17 – Nov 15, 2026" from the stored [start, end) period: the end is
 * exclusive, so the last day shown is end − 1 day (UTC calendar dates).
 */
export function periodText(period: { start: string; end: string }): { start: string; end: string } | null {
  const s = Date.parse(`${period.start}T00:00:00Z`)
  const e = Date.parse(`${period.end}T00:00:00Z`) - 86_400_000
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null
  const a = new Date(s)
  const b = new Date(e)
  const day = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  return {
    start: a.getUTCFullYear() === b.getUTCFullYear() ? day(a) : `${day(a)}, ${a.getUTCFullYear()}`,
    end: `${day(b)}, ${b.getUTCFullYear()}`,
  }
}

// ── Banners ──

export interface SpendBar {
  key: string
  /** A region (monospace) or "Other regions (n)". */
  label: string
  region: boolean
  homeNow: boolean
  share: number
  shareText: string
  /** null → "—". */
  amount: string | null
}

export interface HomeRegionBannerView {
  kind: 'proposal' | 'split'
  title: string
  /** The proposal's region (monospace in the title); null for split. */
  region: string | null
  body: string
  bars: SpendBar[]
  /** Owner controls; null for everyone else (the read-only line instead). */
  owner: { primary: string; keep: string; disabled: boolean; hint: string | null } | null
  memberLine: string | null
  note: string | null
  footnote: string | null
}

/** The bars: shares[] as sent (top 5, server order), "(home now)" on the current home's bar, then "Other regions (n)". */
export function spendBars(p: HomeRegionProposalView): SpendBar[] {
  const current = p.current?.region ?? null
  const bars: SpendBar[] = p.shares.map((s: RegionSpendShare) => ({
    key: `region-${s.region}`, label: s.region, region: true, homeNow: s.region === current,
    share: s.share, shareText: `${percentText(s.share)}%`, amount: amountText(s.amount),
  }))
  if (p.other_regions) {
    bars.push({
      key: 'other', label: HOME_REGION_COPY.otherRegions(p.other_regions.count), region: false, homeNow: false,
      share: p.other_regions.share, shareText: `${percentText(p.other_regions.share)}%`, amount: amountText(p.other_regions.amount),
    })
  }
  return bars
}

/** The connection's 12-digit AWS account (the one active row), as the Connect page shows it; null otherwise. */
export function connectionAccountId(accounts: ReadonlyArray<{ account_id?: string | null; status?: string }>): string | null {
  const active = accounts.filter((a) => a.status === 'active')
  const id = active.length === 1 ? active[0].account_id ?? null : null
  return id && /^\d{12}$/.test(id) ? id : null
}

/**
 * The banner for the server's state, or null. `home` is the account's current
 * home region (coverage). `multiRegion`: coverage carries `multi_region`.
 */
/**
 * Whether the proposal or split banner shows (PR 3d-2, founder ruling): from the server's
 * `home_region_proposal` and the account's home region only. `proposed` needs its region, that region's
 * share and the current home's share; `split` needs a home region. Every other state shows nothing.
 * homeRegionBanner uses it, and so does Connect AWS's suggestion line, so the two can't disagree.
 */
export function homeRegionPromptShows(p: HomeRegionProposalView | null | undefined, home: string | null): boolean {
  if (!p) return false
  if (p.state === 'proposed') {
    const r = p.region
    return !!r && !!p.shares.find((s) => s.region === r) && !!(p.current?.region ?? home) && !!p.current
  }
  if (p.state === 'split') return !!(home ?? p.current?.region)
  return false
}

export function homeRegionBanner(
  p: HomeRegionProposalView | null | undefined,
  o: { canChange: boolean; scanRunning: boolean; home: string | null; multiRegion: boolean; accountId: string | null },
): HomeRegionBannerView | null {
  if (!p || !homeRegionPromptShows(p, o.home)) return null
  const period = p.period ? periodText(p.period) : null
  if (p.state === 'proposed') {
    const r = p.region!
    const lead = p.shares.find((s) => s.region === r)!
    const h = (p.current?.region ?? o.home)!
    const current = p.current!
    return {
      kind: 'proposal',
      title: HOME_REGION_COPY.proposalTitle(r),
      region: r,
      body: HOME_REGION_COPY.proposalBody(percentText(lead.share), r, h, percentText(current.share), !o.multiRegion),
      bars: spendBars(p),
      owner: o.canChange
        ? { primary: HOME_REGION_COPY.proposalUse(r), keep: HOME_REGION_COPY.keep(h), disabled: o.scanRunning, hint: o.scanRunning ? HOME_REGION_COPY.scanRunning : null }
        : null,
      memberLine: o.canChange ? null : HOME_REGION_COPY.ownerOnlyChange,
      note: null,
      footnote: period && o.accountId ? HOME_REGION_COPY.proposalFootnote(o.accountId, period.start, period.end) : null,
    }
  }
  if (p.state === 'split') {
    const home = (o.home ?? p.current?.region)!
    return {
      kind: 'split',
      title: HOME_REGION_COPY.splitTitle,
      region: null,
      body: HOME_REGION_COPY.splitBody,
      bars: spendBars(p),
      // L-7 (founder, Nov 17): as the proposal (HR-S5), both owner buttons wait for a running scan.
      owner: o.canChange
        ? { primary: HOME_REGION_COPY.choose, keep: HOME_REGION_COPY.keep(home), disabled: o.scanRunning, hint: o.scanRunning ? HOME_REGION_COPY.scanRunning : null }
        : null,
      memberLine: o.canChange ? null : HOME_REGION_COPY.ownerOnlyChoose,
      note: HOME_REGION_COPY.splitNote,
      footnote: period && o.accountId ? HOME_REGION_COPY.splitFootnote(o.accountId, period.start, period.end) : null,
    }
  }
  return null
}

// ── Dialog ──

export type DialogMode = 'change' | 'proposal' | 'split'

export interface DialogOption { value: string; label: string; disabled: boolean }

/**
 * The dialog's options: the enabled, choosable regions of the account's stored
 * list (refusal = null), in region-name order, with the current home as
 * "{r} (current)" (not selectable). An amount only for a region the open
 * prompt's evidence names with an amount above 0; every other option is the
 * region name only (founder decision c: no "· —"). Without an open prompt
 * (`evidence` null), no amounts.
 */
export function dialogOptions(
  regions: ReadonlyArray<{ region: string; current: boolean; refusal: string | null }>,
  evidence: HomeRegionProposalView | null,
): DialogOption[] {
  const amounts = new Map<string, number>()
  if (evidence) for (const s of evidence.shares) amounts.set(s.region, s.amount)
  return regions
    .filter((r) => r.refusal === null)
    .slice()
    .sort((a, b) => (a.region < b.region ? -1 : a.region > b.region ? 1 : 0))
    .map((r) => {
      if (r.current) return { value: r.region, label: HOME_REGION_COPY.optionCurrent(r.region), disabled: true }
      const amount = evidence ? amountText(amounts.get(r.region)) : null
      return { value: r.region, label: amount ? HOME_REGION_COPY.optionAmount(r.region, amount) : r.region, disabled: false }
    })
}

/** "What changes" (HR-S13 + V2-5 last): the cost line only when n > 0; the flag-off line only when the server sent a number above 0. */
export function whatChanges(target: { region: string; cost_findings_leaving: { total: number }; resources_kept_in_old_region: number | null }, oldHome: string): string[] {
  const lines = [HOME_REGION_COPY.scanStarts(target.region)]
  const n = target.cost_findings_leaving.total
  if (n > 0) lines.push(HOME_REGION_COPY.costLeaving(n, oldHome))
  const k = target.resources_kept_in_old_region
  if (k !== null && k > 0) lines.push(HOME_REGION_COPY.resourcesKept(k, oldHome))
  lines.push(HOME_REGION_COPY.securityHub(target.region), HOME_REGION_COPY.splitNote)
  return lines
}
