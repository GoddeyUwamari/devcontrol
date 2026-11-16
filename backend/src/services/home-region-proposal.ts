/**
 * The home region proposed to a NEW AWS connection (home region HR-1,
 * home-region-step1.md §B, founder decisions HR-D5/HR-D6/HR-D22, Nov 16).
 *
 * Evidence: ONE Cost Explorer GetCostAndUsage request at connect, on the connect
 * check's own temporary credentials (USD 0.01 to the customer per request):
 *   - the last 30 full UTC days, MONTHLY granularity, UnblendedCost;
 *   - grouped by REGION;
 *   - filtered to the connected account (LINKED_ACCOUNT): a management/payer
 *     account would otherwise propose the region where OTHER accounts spend;
 *   - filtered to usage charges only (RECORD_TYPE = Usage; founder addition,
 *     Nov 16): credits, refunds, tax and support charges would skew the regional
 *     split (a credit applied in one region would make it look smaller). This
 *     filter is the proposal's alone: every other cost figure in the app keeps
 *     its own measure, unchanged;
 *   - at most 2 pages (a third page means the answer is not used: unavailable).
 * Group keys that are not region codes (global, NoRegion, empty) are not regional
 * spend: they are summed apart (non_region_amount) and never count in the rule.
 * Amounts at or below 0 never count as spend.
 *
 * Rule (HR-D5), the region R with the highest spend is proposed only when:
 *   1. the regional spend over the 30 days totals at least USD 5.00;
 *   2. R has at least 1.25 x the runner-up's spend (no near-tie);
 *   3. R is not the current home region, and has at least 2 x its spend.
 * Split spend (founder addition to HR-D5, Nov 16): with at least USD 5.00 of
 * regional spend, when the leader fails rule 2 or rule 3 AND the current home
 * region is not itself the top region, the state is split: the top regions and
 * shares are stored, and the owner is prompted to choose a home region (PR 3).
 * Nothing is selected: the owner's choice goes through the change endpoint.
 * Anything else is no_signal (under USD 5.00, or the current home region leads):
 * the current home region is kept and nothing is shown. A failed, refused,
 * empty-handed, throttled, malformed or too-long answer is unavailable (HR-D22:
 * no fallback evidence; no prompt either). The rule never changes the home region: only the
 * owner does (the change endpoint), and whether R is enabled in the account is
 * checked when the proposal is shown (rule 4, the GET /api/aws/accounts read).
 *
 * Stored per connection row, once, fenced on the new connection
 * (saveHomeRegionProposal): region codes, shares and USD amounts rounded to cents
 * (founder addition, Nov 16): the top 5 regions, an "other regions" total (the sum
 * of the rest) and the global/non-region amount apart, so the banner can show
 * "Other regions · $X" and the percentages always add up to exactly 100 (largest
 * remainder rounding over the top 5 and the other regions). Never an AWS message
 * or a credential. Logged: the outcome and AWS error NAMES only.
 */
import type { GetCostAndUsageCommandInput, GetCostAndUsageCommandOutput } from '@aws-sdk/client-cost-explorer';
import { GetCostAndUsageCommand, Granularity, Metric } from '@aws-sdk/client-cost-explorer';
import type { StoredHomeRegionProposal } from '../repositories/aws-connection-checks.repository';
import { MAX_REGION_NAME_LENGTH, REGION_NAME_PATTERN } from './region-list';
import { COST_METRIC_KEY } from './cost-month-state';

export const PROPOSAL_RULE = {
  version: 2,
  windowDays: 30,
  recordType: 'Usage',
  minTotalUsd: 5,
  runnerUpRatio: 1.25,
  currentHomeRatio: 2,
  maxPages: 2,
  topRegions: 5,
  timeoutMs: 10_000,
} as const;

/** Anything with Cost Explorer's send (the SDK client, or a test double). */
export interface CostExplorerSender {
  send(command: GetCostAndUsageCommand, options?: { abortSignal?: AbortSignal }): Promise<GetCostAndUsageCommandOutput>;
}

export interface RegionSpend {
  region: string;
  amount: number;
}

export type ProposalOutcome = 'proposed' | 'below_minimum' | 'near_tie' | 'current_home_leads' | 'not_twice_current';

export type SpendFetch =
  | { ok: true; spend: RegionSpend[]; period: { start: string; end: string } }
  | { ok: false; reason: 'denied' | 'failed' | 'timed_out' | 'too_many_pages' | 'malformed' };

const DAY_MS = 24 * 60 * 60 * 1000;

/** The 30 full UTC days before `now`'s day: [start, end), as Cost Explorer dates. */
export function proposalPeriod(now: Date): { start: string; end: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end.getTime() - PROPOSAL_RULE.windowDays * DAY_MS);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** The request, exactly (one per connect). */
export function proposalRequest(accountId: string, period: { start: string; end: string }): GetCostAndUsageCommandInput {
  return {
    TimePeriod: { Start: period.start, End: period.end },
    Granularity: Granularity.MONTHLY,
    Metrics: [Metric.UNBLENDED_COST],
    GroupBy: [{ Type: 'DIMENSION', Key: 'REGION' }],
    Filter: {
      And: [
        { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [accountId] } },
        { Dimensions: { Key: 'RECORD_TYPE', Values: [PROPOSAL_RULE.recordType] } },
      ],
    },
  };
}

const DENIED_NAMES = new Set(['AccessDeniedException', 'AccessDenied', 'UnauthorizedOperation', 'UnrecognizedClientException']);

/**
 * The regional spend of `accountId` over the proposal period. Never throws, never
 * logs an AWS message: a failure is a reason code (and its error name in the
 * server log, by the caller).
 */
export async function fetchRegionSpend(
  ce: CostExplorerSender,
  accountId: string,
  now: Date,
  { timeoutMs = PROPOSAL_RULE.timeoutMs }: { timeoutMs?: number } = {}
): Promise<SpendFetch & { errorName?: string }> {
  const period = proposalPeriod(now);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const totals = new Map<string, number>();
  try {
    let token: string | undefined;
    for (let page = 1; ; page++) {
      const input = proposalRequest(accountId, period);
      const output = await ce.send(new GetCostAndUsageCommand(token ? { ...input, NextPageToken: token } : input), { abortSignal: controller.signal });
      for (const result of output?.ResultsByTime ?? []) {
        for (const group of result.Groups ?? []) {
          const key = group.Keys?.[0];
          // The response names the metric UnblendedCost (as every cost query of the app reads it).
          const raw = group.Metrics?.[COST_METRIC_KEY]?.Amount;
          const amount = typeof raw === 'string' ? Number(raw) : NaN;
          if (typeof key !== 'string' || !Number.isFinite(amount)) return { ok: false, reason: 'malformed' };
          totals.set(key, (totals.get(key) ?? 0) + amount);
        }
      }
      token = output?.NextPageToken || undefined;
      if (!token) break;
      if (page >= PROPOSAL_RULE.maxPages) return { ok: false, reason: 'too_many_pages' };
    }
  } catch (error: unknown) {
    const name = (error as { name?: unknown } | null)?.name;
    const errorName = typeof name === 'string' ? name.slice(0, 64) : 'unknown error';
    if (controller.signal.aborted) return { ok: false, reason: 'timed_out', errorName };
    return { ok: false, reason: DENIED_NAMES.has(errorName) ? 'denied' : 'failed', errorName };
  } finally {
    clearTimeout(timer);
  }
  return { ok: true, spend: [...totals].map(([region, amount]) => ({ region, amount })), period };
}

const percent = (part: number, total: number) => Math.round((part / total) * 1000) / 10;
const cents = (amount: number) => Math.round(amount * 100) / 100;
const isRegionCode = (key: string) => key.length <= MAX_REGION_NAME_LENGTH && REGION_NAME_PATTERN.test(key);

/**
 * Shares in percent with one decimal that add up to exactly 100.0 (largest
 * remainder over tenths of a percent; ties to the earlier entry). Empty for a
 * zero total.
 */
export function reconciledShares(amounts: readonly number[], total: number): number[] {
  if (!(total > 0) || amounts.length === 0) return [];
  const raw = amounts.map((a) => (a / total) * 1000);
  const tenths = raw.map(Math.floor);
  let missing = 1000 - tenths.reduce((sum, t) => sum + t, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (missing <= 0) break;
    tenths[i] += 1;
    missing -= 1;
  }
  return tenths.map((t) => t / 10);
}

/** The rule (HR-D5), over region spend as Cost Explorer reported it. Pure. */
export function decideProposal(
  spend: readonly RegionSpend[],
  currentHome: string,
  period: { start: string; end: string }
): { state: 'proposed' | 'split' | 'no_signal'; proposal: StoredHomeRegionProposal } {
  const regional = spend
    .filter((s) => isRegionCode(s.region) && s.amount > 0)
    .sort((a, b) => b.amount - a.amount || (a.region < b.region ? -1 : a.region > b.region ? 1 : 0));
  const nonRegion = spend.filter((s) => !isRegionCode(s.region) && s.amount > 0).reduce((sum, s) => sum + s.amount, 0);
  const total = regional.reduce((sum, s) => sum + s.amount, 0);
  const homeSpend = regional.find((s) => s.region === currentHome)?.amount ?? 0;
  const top = regional[0];
  const runnerUp = regional[1]?.amount ?? 0;

  let outcome: ProposalOutcome;
  if (!top || total < PROPOSAL_RULE.minTotalUsd) outcome = 'below_minimum';
  else if (top.amount < PROPOSAL_RULE.runnerUpRatio * runnerUp) outcome = 'near_tie';
  else if (top.region === currentHome) outcome = 'current_home_leads';
  else if (top.amount < PROPOSAL_RULE.currentHomeRatio * homeSpend) outcome = 'not_twice_current';
  else outcome = 'proposed';

  const leaders = regional.slice(0, PROPOSAL_RULE.topRegions);
  const rest = regional.slice(PROPOSAL_RULE.topRegions);
  const otherAmount = rest.reduce((sum, s) => sum + s.amount, 0);
  const shares = reconciledShares([...leaders.map((s) => s.amount), ...(rest.length > 0 ? [otherAmount] : [])], total);
  const leaderIndex = leaders.findIndex((s) => s.region === currentHome);

  const proposal: StoredHomeRegionProposal = {
    rule_version: PROPOSAL_RULE.version,
    basis: 'cost_explorer_30d_usage',
    period,
    region: outcome === 'proposed' ? top.region : null,
    current: currentHome,
    outcome,
    total_amount: cents(total),
    top: leaders.map((s, i) => ({ region: s.region, share: shares[i], amount: cents(s.amount) })),
    other_regions: rest.length > 0 ? { count: rest.length, share: shares[leaders.length], amount: cents(otherAmount) } : null,
    current_share: leaderIndex >= 0 ? shares[leaderIndex] : total > 0 ? percent(homeSpend, total) : 0,
    current_amount: cents(homeSpend),
    non_region_amount: cents(nonRegion),
  };
  // Split spend: enough spend, no clear leader, and the current home region is not the top region.
  const split = (outcome === 'near_tie' || outcome === 'not_twice_current') && top.region !== currentHome;
  return { state: outcome === 'proposed' ? 'proposed' : split ? 'split' : 'no_signal', proposal };
}

/** What a connect stores: the decided proposal, or unavailable (no proposal). */
export type EvaluatedProposal =
  | { state: 'proposed' | 'split' | 'no_signal'; proposal: StoredHomeRegionProposal }
  | { state: 'unavailable'; proposal: null; reason: Exclude<SpendFetch, { ok: true }>['reason']; errorName?: string };

/** The connect-time evaluation: one request, then the rule. Never throws. */
export async function evaluateHomeRegionProposal(
  ce: CostExplorerSender,
  accountId: string,
  currentHome: string,
  now: Date,
  options: { timeoutMs?: number } = {}
): Promise<EvaluatedProposal> {
  const fetched = await fetchRegionSpend(ce, accountId, now, options);
  if (!fetched.ok) return { state: 'unavailable', proposal: null, reason: fetched.reason, errorName: fetched.errorName };
  return decideProposal(fetched.spend, currentHome, fetched.period);
}

