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
import { SECURITY_PRELIMINARY_REASON, type DayWindow, type WeeklyEvidence } from '../repositories/weekly-summary.repository';

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
  organizationName: string;
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
    const coverage = estimate.state === 'partial'
      ? ` Only ${d.pricedResources} of ${d.totalResources} discovered resources have a cost estimate.`
      : '';
    return [
      body(
        `Estimated monthly run-rate for currently discovered resources: approximately ${money(d.monthlyRunRate)}/month ` +
        `— a DevControl list-price estimate, not billed AWS spend.${coverage}`
      ),
      note('No week-over-week comparison is available.'),
    ];
  };

  if (current.state === 'error') {
    return [body(`AWS Cost Explorer spend for ${compact} couldn't be retrieved.`), ...estimateLines()];
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
  const lines: EmailLine[] = [
    d.accountLevelFindings === 0 && d.resourceComplianceIssues === 0
      ? body("DevControl's configuration checks currently report no active findings.")
      : body(
          `DevControl's configuration checks currently report ${plural(d.accountLevelFindings, 'account-level finding')} ` +
          `(security groups, IAM) and ${plural(d.resourceComplianceIssues, 'resource compliance issue')} ` +
          '(encryption, backups, tagging, and other infrastructure checks).'
        ),
  ];
  if (d.score !== undefined) lines.push(body(`Security posture score: ${d.score}/100.`));
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
  const lines: EmailLine[] = [];
  if (d.active === 0) {
    lines.push(body('No open savings findings.'));
  } else if (d.estimatedFindings > 0) {
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
  lines.push(linkLine('See Cost Optimization →', WEEKLY_EMAIL_PATHS.costOptimization));
  return lines;
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

export function composeWeeklySummary(e: WeeklyEvidence, options: { organizationName?: string } = {}): WeeklySummaryContent {
  const organizationName = options.organizationName ?? 'Your Organization';
  const notConnected = e.awsConnection === 'not_connected';
  return {
    organizationName,
    intro: notConnected
      ? `No AWS account is connected to ${organizationName} yet, so this week has no spend, security or savings data.`
      : `Here's what DevControl measured for ${organizationName}. Spend covers the 7 full UTC days before this email. ` +
        'Findings and savings come from the latest scan.',
    status: notConnected
      ? {
          lines: [body('AWS connection: not connected.'), body('DevControl connects with a read-only role in your AWS account.')],
          action: { label: 'Connect AWS →', path: WEEKLY_EMAIL_PATHS.connectAws },
        }
      : null,
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
