/**
 * Weekly Summary email content, composed deterministically from the evidence
 * sections WeeklySummaryRepository.gatherWeeklyEvidence() collects.
 *
 * The email always has the same five sections -- COSTS, SECURITY, ESTIMATED
 * SAVINGS, ALERTS, DELIVERY -- and every one states its own state: a figure,
 * "Not connected", a failure, a plan gate, or "Coming soon". A section is
 * never left out, and missing data is never $0, "no findings" or "none".
 *   - spend is Cost Explorer UnblendedCost after credits, labelled as such;
 *     an inventory figure is labelled a list-price estimate, never billed spend;
 *   - savings separate estimates, upper bounds and findings with no figure;
 *   - plan-gated figures (posture score, DORA metrics) are replaced by a line
 *     naming the plan that includes them, never silently dropped.
 *
 * The HTML template and the plain-text part both render these lines, so the
 * two can't differ. Wording: weekly-email-mock-v1.html (founder, Nov 11).
 *
 * No model-written text reaches the email. buildRecommendationPrompt() and
 * checkRecommendationText() are kept, unused and outside the send path, pending
 * a grounded redesign (PR #136 review finding B1; WE-D9).
 */

import { EVIDENCE_CLAIM_RULES, CONTEXT_STATE_LABELS, hasEvidence, type ContextSection } from './ai-context-contract';
import { formatSavingsCurrency } from '../utils/formatSavingsCurrency';
import { describeCeilings, describeCeilingsWithoutEstimate } from './estimated-savings';
import { PLAN_NAME } from '../config/plan-names';
import { PLAN_ENTITLEMENTS } from '../config/plan-entitlements';
import { SUPPORT_EMAIL, WEEKLY_EMAIL_PATHS } from '../config/weekly-email-paths';
import { CONNECTION_FAILING_HELP } from '../config/weekly-email-copy';
import {
  SECURITY_PRELIMINARY_REASON,
  type DayWindow,
  type WeeklyEvidence,
} from '../repositories/weekly-summary.repository';

/** A link inside the email: a path on the frontend, or a mailto: address. */
export interface EmailLink {
  label: string;
  path: string;
}

export type EmailLineStyle = 'body' | 'note' | 'upsell';

export interface EmailLine {
  style: EmailLineStyle;
  /** The line's words; '' for a line that is only a link. */
  text: string;
  /** A part of `text` shown in bold in the HTML (a headline figure). */
  strong?: string;
  /** A small tag after the text, e.g. "Coming soon". */
  chip?: string;
  /** A link after the text (or the whole line when text is ''). */
  link?: EmailLink;
}

export type EmailSectionId = 'costs' | 'security' | 'savings' | 'alerts' | 'delivery';

export interface EmailSection {
  id: EmailSectionId;
  title: string;
  lines: EmailLine[];
}

export interface WeeklySummaryContent {
  /** "Your DevControl weekly summary · Nov 9 – 15, 2026": the cost window's dates (WE-D12). */
  subject: string;
  /** "<org> · <plan> plan · Nov 9 – Nov 15, 2026 (UTC)"; the org and the plan are left out when they couldn't be read. */
  header: string;
  organizationName: string;
  /** False when the organization's name couldn't be read; the footer then says "your organization". */
  organizationNameKnown: boolean;
  intro: string;
  /** The AWS connection box; null when nothing is stated about the connection. */
  status: { lines: EmailLine[]; action: EmailLink | null } | null;
  /** Always the five sections, in this order. */
  sections: EmailSection[];
  /** The closing "View Full Dashboard" call to action. */
  cta: { link: EmailLink; style: 'button' | 'link' };
}

/** The five section titles, in email order. */
export const WEEKLY_SECTION_TITLES: Record<EmailSectionId, string> = {
  costs: 'COSTS',
  security: 'SECURITY',
  savings: 'ESTIMATED SAVINGS',
  alerts: 'ALERTS',
  delivery: 'DELIVERY',
};
const SECTION_ORDER: EmailSectionId[] = ['costs', 'security', 'savings', 'alerts', 'delivery'];

export { WEEKLY_EMAIL_PATHS, SUPPORT_EMAIL };

/** Stated so the reader knows these are not measured; not given to the model as a fact. */
export const DELIVERY_NOT_TRACKED_LINE = 'Lead time for changes and time to restore service: Not tracked.';

const DAY_MS = 24 * 60 * 60 * 1000;

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDay(day: string, withYear = true): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
  });
}

function lastDayOf(window: DayWindow): string {
  return new Date(Date.parse(`${window.endExclusive}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** "Sep 20, 2026 – Sep 26, 2026" for a window with an exclusive end. */
export function formatDayWindow(window: DayWindow): string {
  return `${formatDay(window.start)} – ${formatDay(lastDayOf(window))}`;
}

/** "Nov 9 – Nov 15, 2026"; both years shown when the window spans two. */
export function formatCompactWindow(window: DayWindow): string {
  const last = lastDayOf(window);
  return window.start.slice(0, 4) === last.slice(0, 4)
    ? `${formatDay(window.start, false)} – ${formatDay(last)}`
    : formatDayWindow(window);
}

/** "Nov 9 – 15, 2026"; "Oct 26 – Nov 1, 2026" across two months; both years across two years. */
export function formatSubjectWindow(window: DayWindow): string {
  const last = lastDayOf(window);
  if (window.start.slice(0, 4) !== last.slice(0, 4)) return formatDayWindow(window);
  if (window.start.slice(5, 7) !== last.slice(5, 7)) return formatCompactWindow(window);
  return `${formatDay(window.start, false)} – ${Number(last.slice(8, 10))}, ${last.slice(0, 4)}`;
}

export const WEEKLY_SUMMARY_SUBJECT_PREFIX = 'Your DevControl weekly summary';

/** "Nov 16, 2026, 06:02 UTC" */
export function formatInstant(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDay(d.toISOString().slice(0, 10))}, ${hh}:${mm} UTC`;
}

/** "Nov 14, 2026" (the UTC day) */
export function formatInstantDay(iso: string): string {
  return formatDay(new Date(iso).toISOString().slice(0, 10));
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** A section's missing-evidence reason, safe to show (collectSection/notSupported reasons are customer-safe). */
function reasonOf(section: ContextSection<unknown>): string {
  return section.reason ?? CONTEXT_STATE_LABELS[section.state].toLowerCase();
}

const body = (text: string, extra: Partial<EmailLine> = {}): EmailLine => ({ style: 'body', text, ...extra });
const note = (text: string): EmailLine => ({ style: 'note', text });
const linkLine = (label: string, path: string): EmailLine => ({ style: 'body', text: '', link: { label, path } });
const COMPARE_PLANS: EmailLink = { label: 'Compare plans →', path: WEEKLY_EMAIL_PATHS.comparePlans };
const upsell = (text: string): EmailLine => ({ style: 'upsell', text, link: COMPARE_PLANS });

const COST_BASIS_NOTE =
  'Unblended cost by service, after any credits and refunds AWS applied. If credits take a category below $0 on a day, ' +
  'that category counts as $0. Recent days may still be updating.';
const COST_ZERO_NOTE = 'Cost Explorer reported $0.00 for these days. If AWS credits cover your usage, it shows $0 here.';
const SECURITY_COVERAGE = "This covers DevControl's own configuration checks, not AWS Security Hub or every AWS security finding.";
/** The undated security and estimate lines' companion when the scan dates couldn't be read. */
const SCAN_UNDATED_NOTE = "The date of the scan these come from couldn't be retrieved.";

/**
 * The last completed scan, when the scan read worked and one has completed;
 * `isLatest` when it is also the latest scan. Null otherwise: lines are then
 * undated, never dated with a guess.
 */
function completedScan(e: WeeklyEvidence): { at: string; isLatest: boolean } | null {
  const scan = e.scan;
  if (!scan || !hasEvidence(scan) || !scan.data.lastCompleted) return null;
  return { at: scan.data.lastCompleted.at, isLatest: scan.data.latest?.state === 'completed' };
}

/** True when the scan section could not be read (so undated lines say why). */
function scanUnreadable(e: WeeklyEvidence): boolean {
  return e.scan != null && !hasEvidence(e.scan);
}

/** Whether a run started inside the 7 days before this summary ("this week's"). */
function startedThisWeek(e: WeeklyEvidence, startedAt: string): boolean {
  return Date.parse(startedAt) >= Date.parse(e.period.delivery.start);
}

function costLines(e: WeeklyEvidence): EmailLine[] {
  const current = e.currentWeekSpend;
  const compact = formatCompactWindow(e.period.cost);

  if (current.state === 'not_connected') {
    return [body('Not connected. Cost Explorer spend appears here after you connect AWS.')];
  }

  if (hasEvidence(current)) {
    const amount = money(current.data.amount);
    const lines: EmailLine[] = [body(`AWS Cost Explorer spend, ${compact} (UTC): ${amount}.`, { strong: amount })];
    if (current.data.amount === 0) lines.push(body(COST_ZERO_NOTE));
    if (current.state === 'partial' && current.completeness) {
      lines.push(body(
        `Cost Explorer returned data for ${current.completeness.received} of ${current.completeness.expected} days, so this total covers only those days.`
      ));
    }

    const wow = e.weekOverWeek;
    const previousRange = formatDayWindow(e.period.previousCost);
    if (hasEvidence(wow)) {
      const d = wow.data;
      if (d.changePercent === null) {
        lines.push(body(`The previous 7 days (${previousRange}) total ${money(d.previousTotal)}, so a week-over-week percentage cannot be calculated.`));
      } else {
        const change = d.changePercent > 0
          ? `up ${d.changePercent.toFixed(1)}%`
          : d.changePercent < 0 ? `down ${Math.abs(d.changePercent).toFixed(1)}%` : 'unchanged';
        lines.push(body(`That is ${change} from ${money(d.previousTotal)} for the previous 7 days (${previousRange}).`));
      }
      if (wow.state === 'partial') {
        lines.push(body('Some days in this comparison have no Cost Explorer data, so it is not a complete week-over-week comparison.'));
      }
    } else {
      lines.push(body(`A comparison with the previous 7 days (${previousRange}) is unavailable.`));
    }
    lines.push(note(COST_BASIS_NOTE));
    lines.push(linkLine('See costs →', WEEKLY_EMAIL_PATHS.costs));
    return lines;
  }

  const estimate = e.inventoryEstimate;
  const estimateLines = (): EmailLine[] => {
    if (!estimate || !hasEvidence(estimate)) return [];
    const d = estimate.data;
    const scan = completedScan(e);
    const figure =
      `estimated run-rate of about ${money(d.monthlyRunRate)}/month for ${d.pricedResources} of ` +
      `${plural(d.totalResources, 'discovered resource')}. This is a DevControl list-price estimate, not billed AWS spend.`;
    return [
      scan
        ? body(`From the last completed scan (${formatInstantDay(scan.at)}): ${figure}`)
        : body(`${figure.charAt(0).toUpperCase()}${figure.slice(1)}`),
      ...(!scan && scanUnreadable(e) ? [body(SCAN_UNDATED_NOTE)] : []),
      note('No week-over-week comparison is available.'),
    ];
  };

  if (current.state === 'error') {
    // Only a fresh OK health check says the connection itself works.
    const connectionOk = e.connectionHealth != null && hasEvidence(e.connectionHealth) && e.connectionHealth.data.state === 'ok';
    return [
      body(`AWS Cost Explorer spend for ${compact} couldn't be retrieved.${connectionOk ? ' Other sections are unaffected.' : ''}`),
      ...estimateLines(),
    ];
  }
  if (estimate && hasEvidence(estimate)) {
    return [body(`Billed AWS spend for ${formatDayWindow(e.period.cost)} was unavailable (${reasonOf(current)}).`), ...estimateLines()];
  }
  if (estimate?.state === 'error') return [body('Cloud spend data could not be retrieved for this period.')];
  return [body(`Cloud spend data was unavailable for this period (${reasonOf(current)}).`)];
}

function securityLines(e: WeeklyEvidence): EmailLine[] {
  const s = e.security;
  if (s.state === 'not_connected') return [body("Not connected. DevControl's security checks run after you connect AWS.")];
  if (!hasEvidence(s)) {
    if (s.state === 'error') return [body("Security findings couldn't be retrieved for this summary. They're on the Security page.")];
    if (s.reason === SECURITY_PRELIMINARY_REASON) {
      return [body("Your first scan hasn't finished yet. Findings appear here after it completes.")];
    }
    return [body(`Security findings were unavailable for this period (${reasonOf(s)}).`)];
  }
  const d = s.data;
  // Dated with the scan the counts come from: "Latest scan (…)" when the
  // latest scan completed, "From the last completed scan (…)" when a later one
  // didn't (mock v1 (a)/(c)). Undated, never "currently", when no date is known.
  const scan = completedScan(e);
  const lead = !scan
    ? "DevControl's configuration checks report"
    : scan.isLatest
      ? `Latest scan (${formatInstant(scan.at)}):`
      : `From the last completed scan (${formatInstant(scan.at)}):`;
  const lines: EmailLine[] = [
    d.accountLevelFindings === 0 && d.resourceComplianceIssues === 0
      ? body(`${lead} no active findings.`)
      : body(
          `${lead} ${plural(d.accountLevelFindings, 'account-level finding')} ` +
          `(security groups, IAM) and ${plural(d.resourceComplianceIssues, 'resource compliance issue')} ` +
          '(encryption, backups, tagging, and other infrastructure checks).'
        ),
  ];
  if (!scan && scanUnreadable(e)) lines.push(body(SCAN_UNDATED_NOTE));
  if (d.score !== undefined) {
    lines.push(body(scan && !scan.isLatest
      ? `Security posture score: ${d.score}/100 (as of ${formatInstantDay(scan.at)}).`
      : `Security posture score: ${d.score}/100.`));
  }
  lines.push(note(SECURITY_COVERAGE));
  lines.push(linkLine('See security findings →', WEEKLY_EMAIL_PATHS.security));
  if (d.score === undefined) {
    lines.push(upsell(`Security posture score and its trend are included in ${PLAN_NAME[PLAN_ENTITLEMENTS.riskScore]}.`));
  }
  return lines;
}

function savingsLines(e: WeeklyEvidence): EmailLine[] {
  const r = e.recommendations;
  if (r.state === 'not_connected') return [body('Not connected. Savings checks run after you connect AWS.')];
  if (!hasEvidence(r)) {
    return r.state === 'error'
      ? [body('Cost recommendations could not be retrieved for this period.')]
      : [body(`Cost recommendations were unavailable for this period (${reasonOf(r)}).`)];
  }
  const d = r.data;
  const perMonth = (amount: number) => formatSavingsCurrency(amount);
  const analysis = analysisState(e);
  const lines: EmailLine[] = [];
  if (d.active === 0) {
    // "No open savings findings" is a measurement only once an analysis has
    // completed; before that the analysis line alone states the state.
    if (analysis.kind === 'completed') lines.push(body('No open savings findings in the last analysis.'));
    else if (analysis.kind === 'from_last_completed' || analysis.kind === 'unreadable') lines.push(body('No open savings findings.'));
  } else if (d.estimatedMonthlySavings > 0 && d.estimatedFindings > 0) {
    // Only a total above $0 is a headline: an estimate row stored at 0 is not
    // a measured $0 saving (same rule as the dashboard's savings card).
    const amount = `${perMonth(d.estimatedMonthlySavings)}/month`;
    lines.push(body(
      `Estimated savings: ${amount} across ${plural(d.estimatedFindings, 'open finding')}. This is a DevControl estimate, not realized savings.`,
      { strong: amount }
    ));
    for (const ceiling of describeCeilings(d.ceilingByResourceType, perMonth, 'month')) lines.push(body(`${ceiling}.`));
    if (d.unestimatedFindings > 0) {
      lines.push(body(d.unestimatedFindings === 1
        ? '1 more open finding has no dollar estimate yet.'
        : `${d.unestimatedFindings} more open findings have no dollar estimate yet.`));
    }
  } else {
    lines.push(body(`${plural(d.active, 'open finding')}; none has a dollar estimate yet.`));
    for (const ceiling of describeCeilingsWithoutEstimate(d.ceilingByResourceType, perMonth, 'month')) lines.push(body(`${ceiling}.`));
  }
  const dated = analysisLine(analysis, d.active > 0);
  if (dated) lines.push(body(dated));
  lines.push(linkLine('See Cost Optimization →', WEEKLY_EMAIL_PATHS.costOptimization));
  return lines;
}

type AnalysisState =
  | { kind: 'completed'; at: string }
  | { kind: 'from_last_completed'; lastAt: string; latest: 'did_not_finish' | 'in_progress'; thisWeek: boolean }
  | { kind: 'did_not_finish' }
  | { kind: 'in_progress' }
  | { kind: 'never' }
  | { kind: 'unreadable' };

/** The latest cost analysis as the savings section states it (cost_analysis_runs, WE-2). */
function analysisState(e: WeeklyEvidence): AnalysisState {
  const a = e.costAnalysis;
  if (!a || !hasEvidence(a)) return { kind: 'unreadable' };
  const { latest, lastCompleted } = a.data;
  if (!latest) return { kind: 'never' };
  if (latest.state === 'completed') return { kind: 'completed', at: latest.at };
  if (lastCompleted) {
    return { kind: 'from_last_completed', lastAt: lastCompleted.at, latest: latest.state, thisWeek: startedThisWeek(e, latest.startedAt) };
  }
  return { kind: latest.state };
}

/** The line dating the savings figures, or null (nothing to add next to figures with no analysis record). */
function analysisLine(a: AnalysisState, hasFindings: boolean): string | null {
  switch (a.kind) {
    case 'completed':
      return `From the cost analysis completed ${formatInstant(a.at)}.`;
    case 'from_last_completed':
      return `From the last completed cost analysis, ${formatInstantDay(a.lastAt)}. ` + (a.latest === 'in_progress'
        ? 'A new analysis is in progress.'
        : a.thisWeek ? "This week's analysis didn't finish." : "The latest analysis didn't finish.");
    case 'did_not_finish':
      return "The last cost analysis didn't finish.";
    case 'in_progress':
      return hasFindings ? 'A cost analysis is in progress.' : 'Cost analysis in progress. Savings appear when it finishes.';
    case 'never':
      return hasFindings ? null : 'Shown after your first cost analysis finishes.';
    case 'unreadable':
      return "The date of the last cost analysis couldn't be retrieved.";
  }
}

function alertLines(e: WeeklyEvidence): EmailLine[] {
  const a = e.alerts;
  if (hasEvidence(a)) return [body(`${plural(a.data.total, 'alert')} this period, ${a.data.critical} critical.`)];
  if (a.state !== 'not_built') {
    return [body(a.state === 'error'
      ? 'Alert data could not be retrieved for this period.'
      : `Alert data was unavailable for this period: ${reasonOf(a)}.`)];
  }
  return [
    body('Alert history', { chip: 'Coming soon' }),
    e.awsConnection === 'not_connected'
      ? body('Active CloudWatch alarms appear on Operational Health once AWS is connected.')
      : linkLine('See your active CloudWatch alarms on Operational Health →', WEEKLY_EMAIL_PATHS.operationalHealth),
  ];
}

function deliveryLines(e: WeeklyEvidence): EmailLine[] {
  const s = e.delivery;
  if (!hasEvidence(s)) {
    return [body(s.state === 'error'
      ? 'Deployment data could not be retrieved for this period.'
      : `Deployment data was unavailable for this period (${reasonOf(s)}).`)];
  }
  const d = s.data;
  const link = linkLine('See deployments →', WEEKLY_EMAIL_PATHS.deployments);
  if (d.deploymentCount === 0) {
    const history = e.deploymentHistory;
    if (history && hasEvidence(history) && !history.data.anyRecorded) {
      return [
        body('No deployments have been recorded in DevControl yet.'),
        linkLine('Record a deployment on the Deployments page →', WEEKLY_EMAIL_PATHS.deployments),
      ];
    }
    return [body('No deployments were recorded in DevControl in the 7 days before this summary, so delivery metrics could not be calculated.'), link];
  }
  const finished = d.successfulDeployments + d.failedDeployments;
  const unfinished = d.deploymentCount - finished;
  const lines: EmailLine[] = [body(
    `${plural(d.deploymentCount, 'deployment')} recorded in DevControl in the 7 days before this summary: ` +
    `${d.successfulDeployments} succeeded, ${d.failedDeployments} failed` +
    `${unfinished > 0 ? `, ${unfinished} with no finished status` : ''}.`
  )];
  // Below the DORA metrics plan the repository leaves the DORA figures out
  // (getWeeklyDeliveryOnPlan); the email says which plan includes them.
  if (d.deploymentFrequency === undefined || d.changeFailureRate === undefined) {
    lines.push(link);
    lines.push(upsell(
      `Deployment frequency and change failure rate are DORA metrics, included in ${PLAN_NAME[PLAN_ENTITLEMENTS.doraMetrics]}.`
    ));
    return lines;
  }
  lines.push(body(`Deployment frequency (successful deployments): ${d.deploymentFrequency}.`));
  lines.push(body(d.changeFailureRate === null
    ? 'Change failure rate: — (no deployment finished).'
    : `Change failure rate: ${d.changeFailureRate}% (${d.failedDeployments} of ${plural(finished, 'finished deployment')} failed).`));
  lines.push(note(DELIVERY_NOT_TRACKED_LINE));
  lines.push(link);
  return lines;
}

const LINES_OF: Record<EmailSectionId, (e: WeeklyEvidence) => EmailLine[]> = {
  costs: costLines,
  security: securityLines,
  savings: savingsLines,
  alerts: alertLines,
  delivery: deliveryLines,
};

const HEALTH_LAST_RESULT: Record<'ok' | 'failing' | 'lost', string> = { ok: 'OK', failing: 'failing', lost: 'lost' };

/** The connection box for a connected organization: health, then the latest scan (mock v1 (a)/(c)). */
function connectedStatus(e: WeeklyEvidence): NonNullable<WeeklySummaryContent['status']> {
  const lines: EmailLine[] = [];
  let action: EmailLink | null = null;
  const h = e.connectionHealth;
  if (!h || !hasEvidence(h)) {
    lines.push(body("AWS connection health couldn't be retrieved for this summary."));
  } else {
    const d = h.data;
    const day = (iso: string | null) => (iso ? formatInstantDay(iso) : null);
    if (d.state === 'ok' && d.checkedAt) {
      lines.push(body(`AWS connection: OK · checked ${formatInstant(d.checkedAt)}`));
    } else if ((d.state === 'failing' || d.state === 'lost') && d.failingSince) {
      lines.push(body(d.state === 'failing'
        ? `AWS connection: failing since ${day(d.failingSince)}.`
        : `AWS connection: lost, failing since ${day(d.failingSince)}.`));
      lines.push(body(CONNECTION_FAILING_HELP));
      action = { label: 'Open Connect AWS →', path: WEEKLY_EMAIL_PATHS.connectAws };
    } else if (d.state === 'not_checked_recently' && d.checkedAt) {
      lines.push(body(`AWS connection: not checked recently (last result ${HEALTH_LAST_RESULT[d.lastResult ?? 'ok']}, ${day(d.checkedAt)}).`));
    } else if (d.state === 'not_checked_yet') {
      lines.push(body('AWS connection: not checked yet. DevControl checks at each scan.'));
    } else {
      lines.push(body("AWS connection health couldn't be retrieved for this summary."));
    }
  }

  const scan = e.scan;
  if (!scan || !hasEvidence(scan)) {
    lines.push(body("Scan dates couldn't be retrieved for this summary."));
  } else {
    const { latest, lastCompleted } = scan.data;
    const last = lastCompleted ? `Last completed scan: ${formatInstant(lastCompleted.at)}.` : 'No scan has completed yet.';
    if (!latest) lines.push(body('Latest scan: none yet.'));
    else if (latest.state === 'completed') lines.push(body(`Latest scan: completed ${formatInstant(latest.at)}`));
    else if (latest.state === 'did_not_finish') lines.push(body(`Latest scan: didn't finish (${formatInstant(latest.at)}). ${last}`));
    else lines.push(body(`Latest scan: in progress (started ${formatInstant(latest.startedAt)}). ${last}`));
  }
  return { lines, action };
}

/** The connected intro: mock (a) only after a completed latest scan, mock (c) after this week's unfinished one. */
function connectedIntro(e: WeeklyEvidence, organizationLabel: string): string {
  const scan = e.scan && hasEvidence(e.scan) ? e.scan.data : null;
  if (scan?.latest?.state === 'completed') {
    return `Here's what DevControl measured for ${organizationLabel}. Spend covers the 7 full UTC days before this email. ` +
      'Findings and savings come from the latest scan.';
  }
  if (scan?.latest?.state === 'did_not_finish' && scan.lastCompleted && startedThisWeek(e, scan.latest.startedAt)) {
    return "DevControl couldn't finish this week's scan, so some figures below come from the last completed scan and say so.";
  }
  // No completed latest scan to point at: the approved WE-1 intro, which claims no scan.
  return 'Spend covers the 7 full UTC days before this email. Findings and savings show what DevControl currently has on record.';
}

const KNOWN_PLAN_NAMES: ReadonlySet<string> = new Set(Object.values(PLAN_NAME));

export function composeWeeklySummary(
  e: WeeklyEvidence,
  options: { organizationName?: string | null; planName?: string | null } = {}
): WeeklySummaryContent {
  const organizationNameKnown = Boolean(options.organizationName);
  const organizationName = options.organizationName || 'Your Organization';
  const organizationLabel = organizationNameKnown ? organizationName : 'your organization';
  // Only a name from the PLAN_NAME mirror, never a tier id or an unknown string.
  const planName = options.planName && KNOWN_PLAN_NAMES.has(options.planName) ? options.planName : null;
  const notConnected = e.awsConnection === 'not_connected';
  return {
    subject: `${WEEKLY_SUMMARY_SUBJECT_PREFIX} · ${formatSubjectWindow(e.period.cost)}`,
    header: [
      organizationNameKnown ? organizationName : null,
      planName ? `${planName} plan` : null,
      `${formatCompactWindow(e.period.cost)} (UTC)`,
    ].filter(Boolean).join(' · '),
    organizationName,
    organizationNameKnown,
    intro: notConnected
      ? `No AWS account is connected to ${organizationLabel} yet, so this week has no spend, security or savings data.`
      : connectedIntro(e, organizationLabel),
    status: notConnected
      ? {
          lines: [body('AWS connection: not connected.'), body('DevControl connects with a read-only role in your AWS account.')],
          action: { label: 'Connect AWS →', path: WEEKLY_EMAIL_PATHS.connectAws },
        }
      : connectedStatus(e),
    sections: SECTION_ORDER.map(id => ({ id, title: WEEKLY_SECTION_TITLES[id], lines: LINES_OF[id](e) })),
    cta: { link: { label: 'View Full Dashboard →', path: WEEKLY_EMAIL_PATHS.dashboard }, style: notConnected ? 'link' : 'button' },
  };
}

/** A section's words as one paragraph (links, chips and plan lines left out). */
function sectionFacts(content: WeeklySummaryContent, id: EmailSectionId): string {
  const section = content.sections.find(s => s.id === id)!;
  return section.lines
    .filter(line => line.style !== 'upsell' && line.text !== '' && line.text !== DELIVERY_NOT_TRACKED_LINE)
    .map(line => (line.chip ? `${line.text}: ${line.chip}.` : line.text))
    .join(' ');
}

/**
 * Fact lines for a model-written recommendation -- NOT USED: the email has no
 * model-written content (WE-D9). Kept, outside the send path, pending a
 * grounded redesign. Returns null when there are no open cost recommendations
 * and no active security findings in the evidence.
 */
export function buildRecommendationPrompt(e: WeeklyEvidence, content: WeeklySummaryContent): string | null {
  const hasOpenRecommendations = hasEvidence(e.recommendations) && e.recommendations.data.active > 0;
  const hasFindings = hasEvidence(e.security) && (e.security.data.accountLevelFindings + e.security.data.resourceComplianceIssues) > 0;
  if (!hasOpenRecommendations && !hasFindings) return null;

  const facts = [
    `Cost: ${sectionFacts(content, 'costs')}`,
    `Security: ${sectionFacts(content, 'security')}`,
    `Alerts: ${sectionFacts(content, 'alerts')}`,
    `Delivery: ${sectionFacts(content, 'delivery')}`,
    `Recommendations: ${sectionFacts(content, 'savings')}`,
  ];

  return (
    `You are writing a single, specific, actionable recommendation for a weekly ` +
    `cloud infrastructure email, aimed at an engineering lead.\n\n` +
    `Use ONLY the facts below. Do not invent, estimate, or assume anything not explicitly ` +
    `stated. Do not add generic advice like "review your dashboard".\n\n` +
    `Evidence rules:\n${EVIDENCE_CLAIM_RULES.split('\n').map(rule => `- ${rule}`).join('\n')}\n` +
    `- Never say there was no spend, no alerts, or no security risks. Never state a trend, ` +
    `historical value, percentage, or dollar amount that is not in the facts.\n` +
    `- Savings are estimates: never say "you can save" or "you will save".\n` +
    `- Do not recommend rightsizing, Reserved Instances, or Savings Plans, and do not mention DORA or lead time.\n\n` +
    `Facts:\n${facts.map(f => `- ${f}`).join('\n')}\n\n` +
    `Write the recommendation now (1-2 sentences, no preamble, no markdown):`
  );
}

/** Claims the model may never make in the weekly email, whatever the evidence. */
const FORBIDDEN_RECOMMENDATION_CLAIMS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bno (cloud |aws )?(spend|spending|costs?)\b/i, reason: 'claims no spend' },
  { pattern: /\b(no|zero) (active |critical )?alerts?\b/i, reason: 'claims no alerts' },
  { pattern: /\bno (security )?(risks?|vulnerabilit(y|ies))\b/i, reason: 'claims no security risk' },
  { pattern: /\blead[- ]time\b|\bDORA\b/i, reason: 'mentions DORA lead time' },
  { pattern: /\bright-?siz/i, reason: 'claims rightsizing' },
  { pattern: /\breserved instances?\b|\bsavings plans?\b|\bRIs?\b/i, reason: 'claims RI/Savings Plan savings' },
  { pattern: /\b(you|we|they) (can|could|will|would) save\b|\bsave \$/i, reason: 'states savings as definite' },
];

/** Every dollar amount and percentage in `text`, normalized (no thousands separators, no trailing .00). */
function figuresIn(text: string): string[] {
  return (text.match(/\$\s?[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?%/g) ?? [])
    .map(f => f.replace(/[,\s]/g, '').replace(/\.0+(?=%|$)/, ''));
}

/**
 * NOT USED (see buildRecommendationPrompt). The model's recommendation, or
 * null when it makes a forbidden claim or states a dollar amount / percentage
 * that is not in the prompt's facts. It checks only $ and % figures, so it is
 * not enough on its own to re-enable model text.
 */
export function checkRecommendationText(text: string | null, prompt: string): { text: string | null; rejected: string | null } {
  if (!text) return { text: null, rejected: null };
  const forbidden = FORBIDDEN_RECOMMENDATION_CLAIMS.find(rule => rule.pattern.test(text));
  if (forbidden) return { text: null, rejected: forbidden.reason };
  const allowed = new Set(figuresIn(prompt));
  const unsupported = figuresIn(text).find(figure => !allowed.has(figure));
  if (unsupported) return { text: null, rejected: `figure not in evidence: ${unsupported}` };
  return { text, rejected: null };
}
