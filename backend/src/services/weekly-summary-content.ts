/**
 * Weekly Summary email content, composed deterministically from the evidence
 * sections WeeklySummaryRepository.gatherWeeklyEvidence() collects.
 *
 * Every customer-facing statement here follows its section's state:
 *   - spend is labeled with its real period (7 complete UTC days), source,
 *     and basis (gross daily charges before credits); an inventory estimate
 *     is labeled a monthly run-rate estimate, never billed spend; missing
 *     spend is "unavailable", never $0 or "no spend";
 *   - the week-over-week change is the derived comparison section, qualified
 *     when either week has missing days;
 *   - alerts, security, delivery, and recommendations that were not
 *     evaluated say so, never "none";
 *   - savings are an estimated opportunity, never "you can save".
 *
 * The model only ever writes the optional recommendation sentence, from
 * fact lines built here, and checkRecommendationText() drops it if it
 * contradicts or goes beyond that evidence -- model prose never replaces a
 * deterministic line.
 */

import { CONTEXT_STATE_LABELS, EVIDENCE_CLAIM_RULES, hasEvidence, type ContextSection } from './ai-context-contract';
import { formatSavingsCurrency } from '../utils/formatSavingsCurrency';
import type { DayWindow, DORABenchmarkResult, WeeklyEvidence } from '../repositories/weekly-summary.repository';

export interface WeeklySummaryContent {
  costSummary: string;
  securitySummary: string;
  alertSummary: string;
  deliverySummary: string;
  /** Estimated savings opportunity, or the recommendations' unavailable state; null when there is nothing to state. */
  savingsSummary: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Sep 20, 2026 – Sep 26, 2026" for a window with an exclusive end. */
export function formatDayWindow(window: DayWindow): string {
  const lastDay = new Date(Date.parse(`${window.endExclusive}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
  return `${formatDay(window.start)} – ${formatDay(lastDay)}`;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function benchmarkLabel(benchmark: DORABenchmarkResult | null | undefined): string {
  if (!benchmark) return '';
  const level = benchmark.level.charAt(0).toUpperCase() + benchmark.level.slice(1);
  return ` (${benchmark.isCustom ? 'org' : 'industry'} benchmark: ${level})`;
}

/** A section's missing-evidence reason, safe to show (collectSection/notSupported reasons are customer-safe). */
function reasonOf(section: ContextSection<unknown>): string {
  return section.reason ?? CONTEXT_STATE_LABELS[section.state].toLowerCase();
}

function costSummary(e: WeeklyEvidence): string {
  const current = e.currentWeekSpend;
  const range = formatDayWindow(e.period.cost);

  if (hasEvidence(current)) {
    const parts = [
      `AWS Cost Explorer gross charges for the last 7 complete days (${range}, UTC): ${money(current.data.amount)}, before credits and refunds.`,
    ];
    if (current.state === 'partial' && current.completeness) {
      parts.push(
        `Cost Explorer returned data for ${current.completeness.received} of ${current.completeness.expected} days, so this total covers only those days.`
      );
    }

    const wow = e.weekOverWeek;
    const previousRange = formatDayWindow(e.period.previousCost);
    if (hasEvidence(wow)) {
      const d = wow.data;
      if (d.changePercent === null) {
        parts.push(
          `The previous 7 days (${previousRange}) total ${money(d.previousTotal)}, so a week-over-week percentage cannot be calculated.`
        );
      } else {
        const change = d.changePercent > 0
          ? `up ${d.changePercent.toFixed(1)}%`
          : d.changePercent < 0 ? `down ${Math.abs(d.changePercent).toFixed(1)}%` : 'unchanged';
        parts.push(`That is ${change} from ${money(d.previousTotal)} for the previous 7 days (${previousRange}).`);
      }
      if (wow.state === 'partial') {
        parts.push('Some days in this comparison have no Cost Explorer data, so it is not a complete week-over-week comparison.');
      }
    } else {
      parts.push(`A comparison with the previous 7 days (${previousRange}) is unavailable.`);
    }
    return parts.join(' ');
  }

  const estimate = e.inventoryEstimate;
  const billed = current.state === 'error'
    ? `Billed AWS spend for ${range} could not be retrieved.`
    : `Billed AWS spend for ${range} was unavailable (${reasonOf(current)}).`;

  if (estimate && hasEvidence(estimate)) {
    const d = estimate.data;
    const coverage = estimate.state === 'partial'
      ? ` Only ${d.pricedResources} of ${d.totalResources} discovered resources have a cost estimate.`
      : '';
    return (
      `${billed} Estimated monthly run-rate for currently discovered resources: approximately ${money(d.monthlyRunRate)}/month ` +
      `— a DevControl list-price estimate, not billed AWS spend.${coverage} No week-over-week comparison is available.`
    );
  }

  if (current.state === 'error' || estimate?.state === 'error') {
    return 'Cloud spend data could not be retrieved for this period.';
  }
  return `Cloud spend data was unavailable for this period (${reasonOf(current)}).`;
}

function securitySummary(e: WeeklyEvidence): string {
  const s = e.security;
  if (!hasEvidence(s)) {
    return s.state === 'error'
      ? 'Security findings could not be retrieved for this period.'
      : `Security findings were unavailable for this period (${reasonOf(s)}).`;
  }
  const d = s.data;
  const coverage = "This covers DevControl's own configuration checks, not AWS Security Hub or every AWS security finding.";
  if (d.accountLevelFindings === 0 && d.resourceComplianceIssues === 0) {
    return `DevControl's configuration checks currently report no active findings (security posture score ${d.score}/100). ${coverage}`;
  }
  return (
    `DevControl's configuration checks currently report ${plural(d.accountLevelFindings, 'account-level finding')} ` +
    `(security groups, IAM) and ${plural(d.resourceComplianceIssues, 'resource compliance issue')} ` +
    `(encryption, backups, tagging, and other infrastructure checks); security posture score ${d.score}/100. ${coverage}`
  );
}

function alertSummary(e: WeeklyEvidence): string {
  const a = e.alerts;
  if (hasEvidence(a)) {
    return `${plural(a.data.total, 'alert')} this period, ${a.data.critical} critical.`;
  }
  return a.state === 'error'
    ? 'Alert data could not be retrieved for this period.'
    : `Alert data was unavailable for this period: ${reasonOf(a)}.`;
}

function deliverySummary(e: WeeklyEvidence): string {
  const s = e.delivery;
  if (!hasEvidence(s)) {
    return s.state === 'error'
      ? 'Deployment data could not be retrieved for this period.'
      : `Deployment data was unavailable for this period (${reasonOf(s)}).`;
  }
  const d = s.data;
  if (d.deploymentCount === 0) {
    return 'No deployments were recorded in DevControl in the 7 days before this summary, so delivery metrics could not be calculated.';
  }
  const parts = [
    `${plural(d.deploymentCount, 'deployment')} recorded in DevControl in the 7 days before this summary: ` +
    `${d.deploymentFrequency}${benchmarkLabel(d.benchmarks.deploymentFrequency)}.`,
    `Change failure rate: ${d.changeFailureRate}%${benchmarkLabel(d.benchmarks.changeFailureRate)}.`,
    d.timeBetweenSuccessfulDeployments !== 'N/A'
      ? `Average time between successful deployments of the same service: ${d.timeBetweenSuccessfulDeployments}.`
      : 'Average time between successful deployments: not enough data (needs two or more successful deployments of the same service).',
  ];
  if (d.mttr !== 'N/A') {
    parts.push(
      `Average time from a failed deployment to the next successful deployment of that service: ${d.mttr}${benchmarkLabel(d.benchmarks.mttr)}.`
    );
  }
  return parts.join(' ');
}

function savingsSummary(e: WeeklyEvidence): string | null {
  const r = e.recommendations;
  if (!hasEvidence(r)) {
    return r.state === 'error'
      ? 'Cost recommendations could not be retrieved for this period.'
      : `Cost recommendations were unavailable for this period (${reasonOf(r)}).`;
  }
  if (r.data.active === 0) return null;
  return (
    `Estimated savings opportunity: ${formatSavingsCurrency(r.data.totalEstimatedMonthlySavings)}/month ` +
    `across ${plural(r.data.active, 'open cost recommendation')} (a DevControl estimate, not realized savings).`
  );
}

export function composeWeeklySummary(e: WeeklyEvidence): WeeklySummaryContent {
  return {
    costSummary: costSummary(e),
    securitySummary: securitySummary(e),
    alertSummary: alertSummary(e),
    deliverySummary: deliverySummary(e),
    savingsSummary: savingsSummary(e),
  };
}

/**
 * Fact lines for the model-written recommendation: the deterministic
 * summaries above (so the model sees exactly what the email states,
 * including every unavailable state) plus the evidence-state rules.
 * Returns null when there are no open cost recommendations and no active
 * security findings in the evidence -- nothing real to recommend on.
 */
export function buildRecommendationPrompt(e: WeeklyEvidence, content: WeeklySummaryContent): string | null {
  const hasOpenRecommendations = hasEvidence(e.recommendations) && e.recommendations.data.active > 0;
  const hasFindings = hasEvidence(e.security) && (e.security.data.accountLevelFindings + e.security.data.resourceComplianceIssues) > 0;
  if (!hasOpenRecommendations && !hasFindings) return null;

  const facts = [
    `Cost: ${content.costSummary}`,
    `Security: ${content.securitySummary}`,
    `Alerts: ${content.alertSummary}`,
    `Delivery: ${content.deliverySummary}`,
    content.savingsSummary ? `Recommendations: ${content.savingsSummary}` : null,
  ].filter((f): f is string => f !== null);

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
 * The model's recommendation, or null when it contradicts or goes beyond the
 * evidence: a forbidden claim, or any dollar amount / percentage that does
 * not appear in the prompt's facts. Fails closed -- a dropped recommendation
 * leaves the deterministic lines as the whole email.
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
