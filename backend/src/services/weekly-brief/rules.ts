/**
 * The weekly summary email's rules: pure functions from the facts (facts.ts)
 * to every string the email shows. The HTML template and the plain-text part
 * render only what composeWeeklyBrief() returns; neither decides anything.
 *
 * Layout and copy: the founder-approved "executive brief" (Nov 17, mock copy
 * and answers Q0-Q14 in review-logs/weekly-email/brief-build.md). Rules R1-R9:
 *   R1 the summary sentence is fixed templates filled from facts, with no
 *      judging words (BANNED_WORDS);
 *   R2 attention items in a fixed order: connection broken, security, cost,
 *      failed deployments; an empty one never renders;
 *   R3 the clean state only when the connection is OK, nothing is open in
 *      security or Cost Optimization, nothing failed, and no source is unknown;
 *   R4 spend counts finished days only; a percentage only for two finished,
 *      equal-length windows with a previous total above $0;
 *   R5 service lines: changes with a comparison, totals without one;
 *   R6 savings figures use the Cost Optimization page's formatter;
 *   R7 the security tile leads with the open count;
 *   R8 delivery is one line; the rate only over finished deployments, and only
 *      on the plan that includes it;
 *   R9 the footer carries provenance, method and what is not tracked.
 */

import { ANALYSIS_PARTIAL_NOTE } from '../../config/weekly-email-copy';
import { WEEKLY_EMAIL_PATHS } from '../../config/weekly-email-paths';
import { PLAN_NAME } from '../../config/plan-names';
import {
  completedScan,
  type AnalysisFacts,
  type CostFacts,
  type WeeklyFacts,
} from './facts';
import {
  displayResource,
  formatDate,
  formatDays,
  formatMoney,
  formatOpenSavings,
  formatSavings,
  formatSignedMoney,
  formatSubjectWindow,
  formatTime,
  plural,
} from './format';

// ── Types: what the template renders ─────────────────────────────────────────

/** A link inside the email: a path on the frontend. */
export interface BriefLink {
  label: string;
  path: string;
}

export interface BriefTile {
  label: string;
  /** A small line under the label (the finished days' dates, "Open opportunities"); null when none. */
  sublabel: string | null;
  value: string;
  lines: string[];
}

export interface BriefAttentionItem {
  /** 1-based position among the items shown. */
  number: number;
  /** orange (connection, security, delivery) or blue (cost). */
  tone: 'warning' | 'info';
  title: string;
  body: string[];
  /** A grey time line; null when none. */
  time: string | null;
  link: BriefLink;
}

/** A line with an optional bold part (a headline figure). */
export interface BriefLine {
  text: string;
  strong: string | null;
}

export interface BriefCostSection {
  lines: BriefLine[];
  services: { heading: string; rows: Array<{ service: string; amount: string }> } | null;
  link: BriefLink;
}

export interface BriefDeliverySection {
  line: string;
  link: BriefLink;
}

/** The not-connected layout's own content (founder Q3: today's strings). */
export interface BriefNotConnected {
  status: string[];
  action: BriefLink;
  sections: Array<{ title: string; line: string }>;
}

export interface WeeklyBrief {
  layout: 'connected' | 'not_connected';
  subject: string;
  eyebrow: string;
  /** The cost window: "Nov 9 – 15, 2026". */
  title: string;
  /** "<org> · <plan> plan"; null when neither could be read. */
  orgLine: string | null;
  summary: { bold: string; plain: string };
  tiles: BriefTile[];
  attention: BriefAttentionItem[];
  notConnected: BriefNotConnected | null;
  cost: BriefCostSection | null;
  delivery: BriefDeliverySection;
  button: BriefLink & { style: 'button' | 'link' };
  footer: { lines: string[]; alarms: { text: string; link: BriefLink | null } };
}

// ── Copy ─────────────────────────────────────────────────────────────────────

export const WEEKLY_SUMMARY_SUBJECT_PREFIX = 'Your DevControl weekly summary';
export const EYEBROW = 'DEVCONTROL WEEKLY SUMMARY';
/** R3 / board B. */
export const CLEAN_SENTENCE = 'No open security findings and nothing to review in Cost Optimization.';
/** Founder Q4: any source that couldn't be read. */
export const SOME_FIGURES_MISSING = "Some figures couldn't be retrieved; see the tiles below.";
const COULDNT_RETRIEVE = "Couldn't retrieve this week";
/** Founder Q10, then the floor clause (F6). */
export const COST_METHOD =
  'AWS Cost Explorer unblended cost after credits, by UTC day. Cost Explorer can take several days to finish a day; ' +
  'DevControl counts only finished days and lists the others as so far.';
export const COST_FLOOR_CLAUSE = 'If credits take a category below $0 on a day, that category counts as $0.';
/** Founder Q8 fallback: shown with any service block (the per-service figures are not floored). */
export const SERVICE_LINES_NOTE = 'Per-service figures are after credits and may not add up to the total.';
export const COVERAGE_LINE =
  "Security covers DevControl's own configuration checks, not AWS Security Hub. Savings are estimates, not confirmed billing savings.";
export const NOT_TRACKED_LINE = 'Lead time for changes and time to restore service: not tracked.';
export const ALARMS_LINK_LABEL = 'Your active CloudWatch alarms are on Operational Health →';
const ALARMS_NOT_CONNECTED = 'Active CloudWatch alarms appear on Operational Health once AWS is connected.';
/** F5: only when the finished total is $0. */
const COST_ZERO_NOTE = 'Cost Explorer reported $0.00 for these days. If AWS credits cover your usage, it shows $0 here.';
const NO_DEPLOYMENTS = 'No deployments recorded in DevControl this week.';

/**
 * R1: no generated string may contain these words (a test scans every
 * string). Names the email repeats (organization, person, AWS service) are
 * data, not wording, and are left out of that scan (founder Q14).
 */
export const BANNED_WORDS = ['healthy', 'improved', 'strong', 'good', 'great', 'excellent', 'worse', 'better', 'risky', 'critical'] as const;

const LINKS = {
  connectAws: { label: 'Open Connect AWS →', path: WEEKLY_EMAIL_PATHS.connectAws },
  security: { label: 'Review findings →', path: WEEKLY_EMAIL_PATHS.security },
  costs: { label: 'See costs →', path: WEEKLY_EMAIL_PATHS.costs },
  deployments: { label: 'See deployments →', path: WEEKLY_EMAIL_PATHS.deployments },
  recordDeployment: { label: 'Record a deployment on the Deployments page →', path: WEEKLY_EMAIL_PATHS.deployments },
  alarms: { label: ALARMS_LINK_LABEL, path: WEEKLY_EMAIL_PATHS.operationalHealth },
} satisfies Record<string, BriefLink>;

const isAre = (n: number) => (n === 1 ? 'is' : 'are');
const wasWere = (n: number) => (n === 1 ? 'was' : 'were');
const days = (n: number) => plural(n, 'day');

// ── R3: the clean state ──────────────────────────────────────────────────────

/**
 * Board B: the connection is OK, no security finding is open, nothing is
 * open or still detected in Cost Optimization (after an analysis has
 * measured it), no deployment failed, and every source was read (founder Q4:
 * unknown is never 0).
 */
export function isClean(f: WeeklyFacts): boolean {
  return (
    f.connection.state === 'ok' &&
    f.security.state === 'available' && f.security.open === 0 &&
    f.savings.state === 'available' && f.savings.measured &&
    f.savings.open.count === 0 && f.savings.stillDetected.count === 0 &&
    f.delivery.state === 'available' && f.delivery.failed === 0 &&
    f.cost.state === 'available'
  );
}

// ── Shared phrases ───────────────────────────────────────────────────────────

/** "Down 26%", "Up less than 1%", "Unchanged" for a change percentage. */
function changeWords(changePercent: number): string {
  const rounded = Math.round(Math.abs(changePercent));
  if (changePercent === 0) return 'Unchanged';
  const direction = changePercent < 0 ? 'Down' : 'Up';
  return rounded === 0 ? `${direction} less than 1%` : `${direction} ${rounded}%`;
}

/**
 * Founder D-2: the days not finished this week, updating and not reported
 * counted and named separately; a part that is 0 is left out.
 *   summary: "1 day is still updating and 3 aren't reported yet"
 *   tile:    "+ 1 day still updating · 3 not reported yet"
 * Null when every day is finished.
 */
function unfinishedSummary(c: Extract<CostFacts, { state: 'available' }>): string | null {
  const u = c.updating.days.length;
  const r = c.notReported.length;
  const updating = `${days(u)} ${isAre(u)} still updating`;
  if (u > 0 && r > 0) return `${updating} and ${r} ${r === 1 ? "isn't" : "aren't"} reported yet`;
  if (u > 0) return updating;
  if (r > 0) return `${days(r)} ${r === 1 ? "isn't" : "aren't"} reported yet`;
  return null;
}

function unfinishedTile(c: Extract<CostFacts, { state: 'available' }>): string | null {
  const u = c.updating.days.length;
  const r = c.notReported.length;
  if (u > 0 && r > 0) return `+ ${days(u)} still updating · ${r} not reported yet`;
  if (u > 0) return `+ ${days(u)} still updating`;
  if (r > 0) return `+ ${days(r)} not reported yet`;
  return null;
}

/** "{n} account-level (security groups, IAM) · {r} resource compliance (…)."; a part that is 0 is left out (founder, Nov 18). */
function securityBreakdown(account: number, resource: number): string {
  const parts: string[] = [];
  if (account > 0) parts.push(`${account} account-level (security groups, IAM)`);
  if (resource > 0) parts.push(`${resource} resource compliance (encryption, backups, tagging)`);
  return `${parts.join(' · ')}.`;
}

/** "{a} account-level security findings and {r} resource compliance issues are open." */
function securitySentence(account: number, resource: number): string {
  if (account > 0 && resource > 0) {
    return `${plural(account, 'account-level security finding')} and ${plural(resource, 'resource compliance issue')} are open.`;
  }
  if (account > 0) return `${plural(account, 'account-level security finding')} ${isAre(account)} open.`;
  return `${plural(resource, 'resource compliance issue')} ${isAre(resource)} open.`;
}

/** The last completed cost analysis's time; null when none completed; undefined when unreadable. */
function completedAnalysisAt(a: AnalysisFacts): string | null | undefined {
  if (a.kind === 'completed') return a.at;
  if (a.kind === 'from_last_completed') return a.lastAt;
  if (a.kind === 'unreadable') return undefined;
  return null;
}

/**
 * The connection-broken clause (founder Q2, as changed in D-10): security
 * figures name the last completed scan and savings the last completed cost
 * analysis, each with its own time. A source with nothing completed, or
 * security or savings with no figures this week (their read failed), says
 * there are no figures; one whose dates couldn't be read is left out.
 */
function brokenClause(f: WeeklyFacts, lastOkAt: string | null): string {
  const lead = `DevControl couldn't reach your AWS account${lastOkAt ? ` (last successful check ${formatTime(lastOkAt)})` : ''}`;
  // A scan date names where security figures come from only when there are
  // security figures; with the security read failed or preliminary the tile
  // shows none, so the clause says so (brief review L-2).
  const scan = f.security.state !== 'available' ? null : f.scan === null ? undefined : completedScan(f.scan);
  // Savings name the cost analysis only when there are savings figures; with
  // the savings read failed the tile shows none, so the clause says so
  // (founder ruling on the savings twin of brief review L-2).
  const analysisAt = f.savings.state !== 'available' ? null : completedAnalysisAt(f.analysis);
  if (scan === undefined && analysisAt === undefined) return `${lead}.`;
  if (scan === null && analysisAt === null) return `${lead}, so there are no security or savings figures this week.`;
  const parts: string[] = [];
  if (scan) parts.push(`security figures below are from the last completed scan (${formatTime(scan.at)})`);
  else if (scan === null) parts.push('there are no security figures this week');
  if (analysisAt) parts.push(`${scan ? 'savings' : 'savings below are'} from the last completed cost analysis (${formatTime(analysisAt)})`);
  else if (analysisAt === null) parts.push('there are no savings figures this week');
  return `${lead}, so ${parts.join(' and ')}.`;
}

/** The connection's state when it is neither OK nor broken, as a plain sentence; null otherwise. */
function connectionStatusSentence(f: WeeklyFacts): string | null {
  switch (f.connection.state) {
    case 'stale': return `DevControl hasn't checked your AWS connection since ${formatDate(f.connection.checkedAt)}.`;
    case 'not_checked_yet': return "DevControl hasn't checked your AWS connection yet.";
    case 'unknown': return "AWS connection health couldn't be retrieved for this summary.";
    default: return null;
  }
}

/** "21 deployments, none failed." / "21 deployments, 2 failed." / "No deployments recorded in DevControl this week." */
function deliverySentence(count: number, failed: number): string {
  if (count === 0) return NO_DEPLOYMENTS;
  return `${plural(count, 'deployment')}, ${failed === 0 ? 'none' : failed} failed.`;
}

function spendSentence(c: CostFacts): string | null {
  if (c.state === 'unavailable') return 'AWS Cost Explorer returned no data for this week.';
  if (c.state !== 'available') return null;
  const n = c.finished.days.length;
  const unfinished = unfinishedSummary(c);
  if (n === 0) return `${noFinishedDays(c)}.`;
  let sentence = `Spend for the ${n} finished ${n === 1 ? 'day' : 'days'} was ${formatMoney(c.finished.total)}`;
  if (c.comparison.kind === 'percent') {
    sentence += `, ${changeWords(c.comparison.changePercent).toLowerCase()} on the same ${days(n)} last week`;
  }
  if (unfinished) sentence += `; ${unfinished}`;
  return `${sentence}.`;
}

/** "No finished days yet this week · $0.06 so far, still updating" (founder Q11). */
function noFinishedDays(c: Extract<CostFacts, { state: 'available' }>): string {
  return c.updating.days.length > 0
    ? `No finished days yet this week · ${formatMoney(c.updating.total)} so far, still updating`
    : 'No finished days yet this week';
}

// ── R1: the summary sentence ─────────────────────────────────────────────────

/**
 * The paragraph under the header: the attention facts in bold first (in R2's
 * order), or the clean sentence, then the plain facts: connection state,
 * missing figures, spend, delivery.
 */
export function summarySentence(f: WeeklyFacts): { bold: string; plain: string } {
  const bold: string[] = [];
  const plain: string[] = [];

  if (f.connection.state === 'broken') bold.push(brokenClause(f, f.connection.lastOkAt));
  if (f.security.state === 'available' && f.security.open > 0) bold.push(securitySentence(f.security.account, f.security.resource));
  if (f.savings.state === 'available') {
    const still = f.savings.stillDetected.count;
    const open = f.savings.open.count;
    if (still > 0) bold.push(`${plural(still, 'cost finding')} you marked resolved ${wasWere(still)} detected again.`);
    if (open > 0) bold.push(`${plural(open, 'cost opportunity', 'cost opportunities')} ${isAre(open)} open in Cost Optimization.`);
  }
  const failed = f.delivery.state === 'available' && f.delivery.failed > 0;
  if (failed && f.delivery.state === 'available') bold.push(deliverySentence(f.delivery.count, f.delivery.failed));
  if (isClean(f)) bold.push(CLEAN_SENTENCE);

  const status = connectionStatusSentence(f);
  if (status) plain.push(status);
  if (f.security.state === 'preliminary') plain.push("Your first scan hasn't finished yet.");
  if (f.security.state === 'error' || f.savings.state === 'error' || f.cost.state === 'error' || f.delivery.state === 'error') {
    plain.push(SOME_FIGURES_MISSING);
  }
  const spend = spendSentence(f.cost);
  if (spend) plain.push(spend);
  if (!failed && f.delivery.state === 'available') plain.push(deliverySentence(f.delivery.count, f.delivery.failed));

  return { bold: bold.join(' '), plain: plain.join(' ') };
}

// ── Tiles ────────────────────────────────────────────────────────────────────

/** R7: open count first, posture score secondary. */
function securityTile(f: WeeklyFacts): BriefTile {
  const s = f.security;
  const tile = (value: string, lines: string[]): BriefTile => ({ label: 'SECURITY', sublabel: null, value, lines });
  if (s.state === 'preliminary') return tile('—', ["Your first scan hasn't finished yet."]);
  if (s.state !== 'available') return tile('—', [COULDNT_RETRIEVE]);
  const lines = s.open > 0 ? [`${s.account} account · ${s.resource} compliance`] : [];
  if (s.score !== undefined) lines.push(`Posture score ${s.score}/100`);
  return tile(`${s.open} open`, lines);
}

/** R4: finished days only. */
function spendTile(f: WeeklyFacts): BriefTile {
  const c = f.cost;
  if (c.state !== 'available') {
    const why = c.state === 'unavailable' ? 'AWS Cost Explorer returned no data for this week'
      : c.state === 'not_connected' ? 'No AWS account is connected' : COULDNT_RETRIEVE;
    return { label: 'AWS SPEND', sublabel: null, value: '—', lines: [why] };
  }
  const n = c.finished.days.length;
  const label = `AWS SPEND · ${n} FINISHED ${n === 1 ? 'DAY' : 'DAYS'}`;
  if (n === 0) {
    return {
      label,
      sublabel: null,
      value: 'No finished days yet',
      lines: [
        c.updating.days.length > 0 ? `${formatMoney(c.updating.total)} so far, still updating`
          : c.notReported.length > 0 ? 'Not reported by Cost Explorer yet'
          : 'Not determined yet',
      ],
    };
  }
  const lines = [c.comparison.kind === 'percent' ? `${changeWords(c.comparison.changePercent)} on the same days` : 'No comparison yet (see Cost)'];
  const unfinished = unfinishedTile(c);
  if (unfinished) lines.push(unfinished);
  return { label, sublabel: formatDays(c.finished.days), value: formatMoney(c.finished.total), lines };
}

/** R6: the page's formatter; never "$0/mo" while findings are open (founder Q6/Q7). */
function savingsTile(f: WeeklyFacts): BriefTile {
  const s = f.savings;
  const tile = (sublabel: string | null, value: string, lines: string[]): BriefTile => ({ label: 'ESTIMATED SAVINGS', sublabel, value, lines });
  if (s.state !== 'available') return tile(null, '—', [COULDNT_RETRIEVE]);
  if (!s.measured) return tile(null, '—', ['Shown after your first cost analysis finishes.']);
  const { open, stillDetected } = s;
  if (open.count === 0 && stillDetected.count === 0) {
    const a = f.analysis;
    const ran = a.kind === 'completed' && !a.partial && a.checks && a.checks.complete === a.checks.total
      ? [`all ${a.checks.total} active checks ran`]
      : [];
    return tile(null, 'Nothing to review', ran);
  }
  const value = open.count === 0
    ? `${formatSavings(0)}/mo`
    : formatOpenSavings(open.estimate, open.estimatedFindings) ?? `${open.count} open · no dollar estimate yet`;
  const lines = stillDetected.count > 0 ? [stillDetectedLine(stillDetected.count, stillDetected.estimate)] : [];
  return tile('Open opportunities', value, lines);
}

/**
 * Founder D-6: the page's still-detected estimate is cent-rounded, so $0.00
 * may hide a sub-cent estimate. Then no amount is shown at all, never
 * "no dollar estimate yet".
 */
function stillDetectedHasAmount(estimate: number): boolean {
  return Math.round(estimate * 100) !== 0;
}

/** "N still detected · about $Y/mo estimated" (Y = the page's C8 estimate); "N still detected" when Y rounds to $0.00. */
function stillDetectedLine(count: number, estimate: number): string {
  return stillDetectedHasAmount(estimate)
    ? `${count} still detected · about ${formatSavings(estimate)}/mo estimated`
    : `${count} still detected`;
}

export function tiles(f: WeeklyFacts): BriefTile[] {
  return [securityTile(f), spendTile(f), savingsTile(f)];
}

// ── R2: attention items ──────────────────────────────────────────────────────

/** The Cost item's note when the latest analysis didn't finish (F2); null otherwise. */
function analysisNote(a: AnalysisFacts): string | null {
  if (a.kind === 'from_last_completed' && a.latest === 'did_not_finish') {
    return a.thisWeek ? "This week's analysis didn't finish." : "The latest analysis didn't finish.";
  }
  if (a.kind === 'did_not_finish') return "The last cost analysis didn't finish.";
  return null;
}

/**
 * "Idle Instance on build-cache (us-east-1)". The check and resource come from
 * stored findings, so any ARN in them is printed as its final resource
 * segment only, never the full ARN or its account ID (brief review H-1).
 */
function stillDetectedWhere(check: string, resource: string, region: string | null): string {
  const name = displayResource(resource);
  return `${displayResource(check)}${name ? ` on ${name}` : ''}${region ? ` (${region})` : ''}`;
}

function costItem(f: WeeklyFacts): Omit<BriefAttentionItem, 'number'> | null {
  if (f.savings.state !== 'available') return null;
  const { open, stillDetected } = f.savings;
  if (open.count === 0 && stillDetected.count === 0) return null;

  const titleParts: string[] = [];
  const body: string[] = [];
  if (stillDetected.count > 0) {
    const n = stillDetected.count;
    titleParts.push(`${plural(n, 'resolved finding')} detected again`);
    const ex = stillDetected.example;
    const where = ex ? stillDetectedWhere(ex.check, ex.resource, ex.region) : null;
    const money = stillDetectedHasAmount(stillDetected.estimate) ? ` About ${formatSavings(stillDetected.estimate)}/mo, estimated.` : '';
    if (n === 1 && ex) {
      body.push(`${where}. You resolved it ${formatDate(ex.resolvedAt)}; the latest analysis still sees it.${money}`);
    } else {
      body.push(`${where ? `${where} and ${n - 1} more. ` : ''}You resolved ${n === 1 ? 'it' : 'them'}; the latest analysis still sees ${n === 1 ? 'it' : 'them'}.${money}`);
    }
    if (stillDetected.ceiling > 0) body.push(`Plus up to ${formatSavings(stillDetected.ceiling)}/mo in estimated ceilings, not expected savings.`);
  }
  if (open.count > 0) {
    const m = open.count;
    titleParts.push(plural(m, 'open opportunity', 'open opportunities'));
    const figure = formatOpenSavings(open.estimate, open.estimatedFindings);
    if (figure) {
      const rest = open.unestimatedFindings > 0
        ? `; ${open.unestimatedFindings} ${open.unestimatedFindings === 1 ? 'has' : 'have'} no dollar estimate yet.`
        : '.';
      body.push(`${plural(m, 'open opportunity', 'open opportunities')}, about ${figure} estimated${rest}`);
    } else {
      body.push(`${plural(m, 'open opportunity', 'open opportunities')}, no dollar estimate yet.`);
    }
    if (open.ceiling > 0) body.push(`Plus up to ${formatSavings(open.ceiling)}/mo in estimated ceilings, not expected savings.`);
  }
  const note = analysisNote(f.analysis);
  if (note) body.push(note);

  const one = stillDetected.count === 1 && open.count === 0;
  return {
    tone: 'info',
    title: `Cost · ${titleParts.join(' · ')}`,
    body,
    time: null,
    link: { label: one ? 'Review it in Cost Optimization →' : 'Review in Cost Optimization →', path: WEEKLY_EMAIL_PATHS.costOptimization },
  };
}

/** R2: in this order, an empty item never shown. */
export function attentionItems(f: WeeklyFacts): BriefAttentionItem[] {
  const items: Array<Omit<BriefAttentionItem, 'number'>> = [];

  if (f.connection.state === 'broken') {
    const lastOk = f.connection.lastOkAt;
    items.push({
      tone: 'warning',
      title: "DevControl couldn't reach your AWS account.",
      body: [lastOk ? `Last successful check: ${formatTime(lastOk)}.` : "It hasn't connected successfully since the account was added."],
      time: null,
      link: LINKS.connectAws,
    });
  }

  if (f.security.state === 'available' && f.security.open > 0) {
    const s = f.security;
    const scan = completedScan(f.scan);
    items.push({
      tone: 'warning',
      title: `Security · ${plural(s.open, 'open finding')}`,
      body: [securityBreakdown(s.account, s.resource)],
      time: scan ? `${scan.isLatest ? 'Latest scan' : 'Last completed scan'} ${formatTime(scan.at)}` : null,
      link: LINKS.security,
    });
  }

  const cost = costItem(f);
  if (cost) items.push(cost);

  if (f.delivery.state === 'available' && f.delivery.failed > 0) {
    items.push({
      tone: 'warning',
      title: `Delivery · ${plural(f.delivery.failed, 'failed deployment')}`,
      body: [],
      time: null,
      link: LINKS.deployments,
    });
  }

  return items.map((item, i) => ({ ...item, number: i + 1 }));
}

// ── Cost section ─────────────────────────────────────────────────────────────

export function costSection(f: WeeklyFacts): BriefCostSection {
  const c = f.cost;
  const line = (text: string, strong: string | null = null): BriefLine => ({ text, strong });
  const lines: BriefLine[] = [];
  let services: BriefCostSection['services'] = null;

  if (c.state === 'error') {
    lines.push(line(`AWS Cost Explorer spend for ${formatDays(windowDays(f))} couldn't be retrieved.`));
  } else if (c.state === 'unavailable') {
    lines.push(line('AWS Cost Explorer returned no data for this week.'));
  } else if (c.state === 'not_connected') {
    lines.push(line('Not connected. Cost Explorer spend appears here after you connect AWS.'));
  } else {
    const n = c.finished.days.length;
    if (n === 0) {
      lines.push(line(`${noFinishedDays(c)}.`));
    } else {
      const total = formatMoney(c.finished.total);
      let first = `Finished days, ${formatDays(c.finished.days)}: ${total}.`;
      if (c.comparison.kind === 'percent') {
        first += ` Same ${n === 1 ? 'day' : `${n} days`} last week (${formatDays(c.comparison.previousDays)}): ${formatMoney(c.comparison.previousTotal)}. ${changeWords(c.comparison.changePercent)}.`;
      }
      lines.push(line(first, total));
      if (c.comparison.kind === 'mismatch') {
        lines.push(line(
          `No week-over-week comparison: DevControl has ${plural(c.comparison.previousFinished, 'finished day')} from last week, not ${n}, so the two weeks don't match.`
        ));
      } else if (c.comparison.kind === 'previous_zero') {
        lines.push(line(`No week-over-week comparison: the same ${days(n)} last week (${formatDays(c.comparison.previousDays)}) total $0.00.`));
      }
      if (c.finished.total === 0) lines.push(line(COST_ZERO_NOTE));
    }
    if (c.updating.days.length > 0 && n > 0) {
      lines.push(line(`Still updating, ${formatDays(c.updating.days)}: ${formatMoney(c.updating.total)} so far. Not included in the comparison.`));
    }
    if (c.notReported.length > 0) {
      lines.push(line(`Not reported by Cost Explorer yet, ${formatDays(c.notReported)}.`));
    }
    // A point with no reportState: reported, but not determined as finished (brief review L-1). Dates only.
    if (c.undetermined.length > 0) {
      lines.push(line(`Not determined yet, ${formatDays(c.undetermined)}.`));
    }
    if (c.services) {
      services = c.services.kind === 'change'
        ? { heading: 'Change in spend vs the same days last week', rows: c.services.rows.map(r => ({ service: r.service, amount: formatSignedMoney(r.amount) })) }
        : { heading: 'Total spend by service, finished days (not changes)', rows: c.services.rows.map(r => ({ service: r.service, amount: formatMoney(r.amount) })) };
    }
  }
  return { lines, services, link: LINKS.costs };
}

/** The cost window's 7 days. */
function windowDays(f: WeeklyFacts): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${f.period.cost.start}T00:00:00Z`); t < Date.parse(`${f.period.cost.endExclusive}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

// ── R8: delivery ─────────────────────────────────────────────────────────────

export function deliverySection(f: WeeklyFacts): BriefDeliverySection {
  const d = f.delivery;
  if (d.state !== 'available') return { line: 'Deployment data could not be retrieved for this period.', link: LINKS.deployments };
  if (d.count === 0) return { line: NO_DEPLOYMENTS, link: d.everRecorded === false ? LINKS.recordDeployment : LINKS.deployments };
  let line = `${plural(d.count, 'deployment')} · ${d.failed} failed`;
  // Below the DORA metrics plan the rate is left out of the data (founder Q9: no upsell).
  if (typeof d.rate === 'number' && d.finished > 0) {
    line += ` · ${d.rate}% change failure rate${d.finished !== d.count ? ` (of ${d.finished} finished)` : ''}`;
  }
  return { line, link: LINKS.deployments };
}

// ── R9: footer ───────────────────────────────────────────────────────────────

function connectionLine(f: WeeklyFacts): string {
  const c = f.connection;
  switch (c.state) {
    case 'ok': return `AWS connection: OK · checked ${formatTime(c.checkedAt)}.`;
    case 'broken': return c.lastOkAt
      ? `AWS connection: DevControl couldn't reach your account. Last successful check: ${formatTime(c.lastOkAt)}.`
      : "AWS connection: DevControl couldn't reach your account. It hasn't connected successfully since the account was added.";
    case 'stale': return `AWS connection: not checked since ${formatDate(c.checkedAt)} (last result OK).`;
    case 'not_checked_yet': return 'AWS connection: not checked yet. DevControl checks at each scan.';
    default: return "AWS connection health couldn't be retrieved for this summary.";
  }
}

/** F9: names the scan the security figures come from. */
function scanLine(f: WeeklyFacts): string {
  const scan = f.scan;
  if (scan === null) return "Scan dates couldn't be retrieved for this summary.";
  const { latest, lastCompleted } = scan;
  const from = lastCompleted ? `security figures are from the last completed scan, ${formatTime(lastCompleted.at)}.` : 'no scan has completed yet.';
  if (!latest) return 'Latest scan: none yet.';
  if (latest.state === 'completed') return `Security figures are from the latest scan, completed ${formatTime(latest.at)}.`;
  if (latest.state === 'did_not_finish') return `The latest scan didn't finish (${formatTime(latest.at)}); ${from}`;
  return `A scan is in progress (started ${formatTime(latest.startedAt)}); ${from}`;
}

/** The analysis time and state (Q6, F2). */
function analysisLine(a: AnalysisFacts): string {
  switch (a.kind) {
    case 'completed':
      return `Savings are from the cost analysis completed ${formatTime(a.at)}.${a.partial ? ` ${ANALYSIS_PARTIAL_NOTE}` : ''}`;
    case 'from_last_completed': {
      const latest = a.latest === 'in_progress'
        ? 'A new analysis is in progress.'
        : a.thisWeek ? "This week's analysis didn't finish." : "The latest analysis didn't finish.";
      return `Savings are from the last completed cost analysis, ${formatTime(a.lastAt)}.${a.lastPartial ? ` ${ANALYSIS_PARTIAL_NOTE}` : ''} ${latest}`;
    }
    case 'did_not_finish': return "The last cost analysis didn't finish.";
    case 'in_progress': return 'Cost analysis in progress. Savings appear when it finishes.';
    case 'never': return 'Savings are shown after your first cost analysis finishes.';
    default: return "The date of the last cost analysis couldn't be retrieved.";
  }
}

export function footer(f: WeeklyFacts): WeeklyBrief['footer'] {
  const method = [COST_METHOD, COST_FLOOR_CLAUSE];
  if (f.cost.state === 'available' && f.cost.services) method.push(SERVICE_LINES_NOTE);
  return {
    lines: [
      connectionLine(f),
      scanLine(f),
      analysisLine(f.analysis),
      method.join(' '),
      COVERAGE_LINE,
      NOT_TRACKED_LINE,
    ],
    alarms: { text: '', link: LINKS.alarms },
  };
}

// ── The brief ────────────────────────────────────────────────────────────────

export interface BriefOptions {
  organizationName?: string | null;
  planName?: string | null;
}

/** Founder Q3: a not-connected organization keeps today's strings, in the new template. */
function notConnectedBrief(f: WeeklyFacts, organizationLabel: string): Pick<WeeklyBrief, 'layout' | 'summary' | 'tiles' | 'attention' | 'notConnected' | 'cost' | 'button' | 'footer'> {
  return {
    layout: 'not_connected',
    summary: { bold: '', plain: `No AWS account is connected to ${organizationLabel} yet, so this week has no spend, security or savings data.` },
    tiles: [],
    attention: [],
    notConnected: {
      status: ['AWS connection: not connected.', 'DevControl connects with a read-only role in your AWS account.'],
      action: { label: 'Connect AWS →', path: WEEKLY_EMAIL_PATHS.connectAws },
      sections: [
        { title: 'COSTS', line: 'Not connected. Cost Explorer spend appears here after you connect AWS.' },
        { title: 'SECURITY', line: "Not connected. DevControl's security checks run after you connect AWS." },
        { title: 'ESTIMATED SAVINGS', line: 'Not connected. Savings checks run after you connect AWS.' },
      ],
    },
    cost: null,
    button: { label: 'Open DevControl →', path: WEEKLY_EMAIL_PATHS.dashboard, style: 'link' },
    footer: { lines: [NOT_TRACKED_LINE], alarms: { text: ALARMS_NOT_CONNECTED, link: null } },
  };
}

const KNOWN_PLAN_NAMES: ReadonlySet<string> = new Set(Object.values(PLAN_NAME));

/** The whole email for one organization. Only a plan name from the PLAN_NAME mirror is printed, never a tier id. */
export function composeWeeklyBrief(f: WeeklyFacts, options: BriefOptions = {}): WeeklyBrief {
  const organizationName = options.organizationName || null;
  const planName = options.planName && KNOWN_PLAN_NAMES.has(options.planName) ? options.planName : null;
  const orgLine = [organizationName, planName ? `${planName} plan` : null].filter(Boolean).join(' · ') || null;
  const head = {
    subject: `${WEEKLY_SUMMARY_SUBJECT_PREFIX} · ${formatSubjectWindow(f.period.cost)}`,
    eyebrow: EYEBROW,
    title: formatSubjectWindow(f.period.cost),
    orgLine,
    delivery: deliverySection(f),
  };
  if (f.connection.state === 'not_connected') {
    return { ...head, ...notConnectedBrief(f, organizationName ?? 'your organization') };
  }
  return {
    ...head,
    layout: 'connected',
    summary: summarySentence(f),
    tiles: tiles(f),
    attention: attentionItems(f),
    notConnected: null,
    cost: costSection(f),
    button: { label: 'Open DevControl →', path: WEEKLY_EMAIL_PATHS.dashboard, style: 'button' },
    footer: footer(f),
  };
}
