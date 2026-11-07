/**
 * AI Summary Service
 * Composes real, already-computed dashboard evidence (System Intelligence
 * score, security posture, top finding, cost recommendations, cloud spend and
 * its month-over-month comparison) into a fact-only prompt and asks Claude (via
 * AIInsightsService) to turn it into a short plain-English summary.
 *
 * Every input is its own ContextSection (ai-context-contract.ts), so one
 * failed source never blanks the others, and missing evidence is stated as
 * missing -- never as zero, "none", or "no outages". Every section comes from
 * the shared evidence registry (services/ai/evidence/). System Status is the
 * CloudWatch alarm state (ops.cloudwatch_alarms), written deterministically on
 * every request -- never by the model, never served from the cache.
 *
 * Spend comes from the AI Chat cost path (AIChatContextRepository.
 * gatherCostContext() via cost-context-sections.ts), so a real $0 or
 * net-credit Cost Explorer month stays actual billed spend, an inventory
 * estimate is labeled an estimate, and the month-over-month change is
 * DevControl's own derived comparison -- never a client-supplied number.
 *
 * Cached per-org, keyed on evidenceFingerprint() of every provider (so any
 * change in a fact, its state, or its freshness regenerates the prose), with a
 * 4h TTL ceiling as a defensive fallback. The result says who wrote it
 * (summarySource) and when the model last did (aiGeneratedAt): a facts-only
 * result is never presented as fresh AI output.
 */

import { AIInsightsService, type StructuredDashboardSummary, type SummarySource } from './ai-insights.service';
import { formatSavingsCurrency } from '../utils/formatSavingsCurrency';
import {
  collectSection,
  EVIDENCE_CLAIM_RULES,
  OMITTED_REASON,
  evidenceFingerprint,
  hasEvidence,
  requireOrganizationId,
  type ContextSection,
} from './ai-context-contract';
import { lastIncludedDay } from './ai-chat.service';
import type { MonthOverMonthEvidence, SpendEvidence } from './cost-context-sections';
import { noUrgentFindingsLine, reviewedFindingsLine } from './top-risk-selection';
import { collectEvidence, fingerprintSections, sectionOf } from './ai/evidence/registry';
import { defaultEvidenceRegistry } from './ai/evidence/providers';
import { LOW_ACTIVITY_FINDING_RULE, renderEvidence, statusPhrase, untrustedBlock, UNTRUSTED_TEXT_RULE } from './ai/evidence/render';
import type { EvidenceBundle } from './ai/evidence/types';
import { SECURITY_EVALUATION_MAX_AGE_SECONDS as EVALUATION_MAX_AGE, topRiskTitle, type PostureCountsEvidence, type TopRiskEvidence } from './ai/evidence/providers/security';
import type { CostFindingsEvidence } from './ai/evidence/providers/cost';
import type { AlarmsEvidence, SystemIntelligenceEvidence } from './ai/evidence/providers/operations';


const EMPTY_FIELDS: StructuredDashboardSummary = {
  overallHealth: { score: null, context: null },
  topRisk: null,
  cloudSpend: null,
  systemStatus: null,
};

/** Bump when the prompt or the facts it is built from change, so cached prose is not reused. */
const PROMPT_VERSION = 'dashboard-summary-v4';

/** Evidence budget for the summary prompt, in estimated tokens. */
export const SUMMARY_EVIDENCE_BUDGET_TOKENS = 6_000;

/**
 * Providers whose data the summary loads. Listed by state only:
 *   - Operational Health checks and CPU telemetry: their values change on
 *     every check, which would regenerate the cached summary every minute;
 *   - the account findings list: the summary states security findings
 *     through Top Risk and the posture counts, so a finding the customer
 *     accepted or dismissed never reaches its prompt (false positives PR 1).
 */
export const SUMMARY_PROVIDERS = [
  'connection.scope',
  'coverage.regions',
  'system.intelligence',
  'security.posture_counts',
  'security.top_risk',
  'security.evaluation_status',
  'security.config_checks',
  'security.risk_score',
  'compliance.framework_evaluations',
  'cost.findings',
  'cost.spend',
  'cost.month_over_month',
  'ops.cloudwatch_alarms',
] as const;

/** Expressed as the fact lines below, so the generic evidence block leaves out their data. */
export const SUMMARY_FACT_PROVIDERS = [
  'system.intelligence',
  'security.posture_counts',
  'security.top_risk',
  'security.evaluation_status',
  'cost.spend',
  'cost.month_over_month',
  'ops.cloudwatch_alarms',
] as const;

/**
 * A security evaluation older than this is not current: two scheduled scans in a
 * row (every 6 hours, jobs/resourceDiscovery.job.ts) did not refresh it, allowing
 * the second its longest possible run. The same 13 hours as the coverage page's
 * STALE_AFTER_SECONDS (routes/services-coverage.routes.ts; a test pins the two).
 */
export const SECURITY_EVALUATION_MAX_AGE_SECONDS = EVALUATION_MAX_AGE;

/** System Status when the summary could not be built at all. */
export const SYSTEM_STATUS_UNAVAILABLE = 'CloudWatch alarm status is unavailable right now. See Operational Health for your active CloudWatch alarms.';

/** System Status from the CloudWatch alarms section: deterministic, never model-written. */
export function systemStatusFor(monitoring: ContextSection<AlarmsEvidence>): string {
  if (!hasEvidence(monitoring)) {
    return `CloudWatch alarm status is unavailable: ${statusPhrase(monitoring).replace(/ -- .*$/, '')}. See Operational Health for your active CloudWatch alarms.`;
  }
  const d = monitoring.data;
  const region = monitoring.scope?.kind === 'aws_account_region' && monitoring.scope.region ? ` in ${monitoring.scope.region}` : '';
  const when = monitoring.asOf ? ` as of ${monitoring.asOf}` : '';
  if (d.inAlarmCount === 0 && d.inAlarmComplete) {
    return `No CloudWatch alarms are in ALARM${region}${when}. See Operational Health for details.`;
  }
  const atLeast = d.inAlarmComplete ? '' : 'At least ';
  return `${atLeast}${d.inAlarmCount} CloudWatch alarm${d.inAlarmCount !== 1 ? 's are' : ' is'} in ALARM${region}${when}. See Operational Health for details.`;
}

/**
 * identified         = topRisk states a finding present in the evidence
 * no_urgent_findings = topRisk is W11: the latest security evaluation completed and is
 *                      current, and every open finding is low (founder decision D-B3)
 * all_urgent_reviewed = topRisk is W11b: same evaluation gate, and every open critical,
 *                      high or medium finding was accepted or dismissed by the customer
 * none_identified    = security evidence was evaluated and records no active findings
 * unavailable        = risk could not be evaluated (missing, failed, or preliminary evidence)
 */
export type TopRiskStatus = 'identified' | 'no_urgent_findings' | 'all_urgent_reviewed' | 'none_identified' | 'unavailable';

export interface AISummaryResult extends StructuredDashboardSummary {
  topRiskStatus: TopRiskStatus;
  /** When this result was produced (a cache hit keeps its original time). */
  generatedAt: string;
  /** Who wrote the prose fields (PR 1 review L4); never presented as AI output unless ai_written. */
  summarySource: SummarySource;
  /** When the model wrote the prose fields; null unless summarySource is ai_written. */
  aiGeneratedAt: string | null;
}

type SummaryFields = StructuredDashboardSummary & { topRiskStatus: TopRiskStatus; summarySource: SummarySource };

interface CacheEntry {
  fields: SummaryFields;
  fingerprint: string;
  timestamp: number;
}

export interface DashboardSections {
  systemScore: ContextSection<SystemIntelligenceEvidence>;
  /**
   * urgentFindings: critical + high + medium across both sources, whatever their
   * disposition; accountUrgentFindings: the account-findings part of it. Null when
   * not reported.
   */
  securityPosture: ContextSection<PostureCountsEvidence>;
  /**
   * top: the Top Risk finding (top-risk-selection.ts), never an accepted or dismissed one;
   * its title is untrusted text ("top title").
   * reviewedUrgent: critical/high/medium findings marked accepted risk or dismissed.
   */
  accountFindings: ContextSection<TopRiskEvidence>;
  /** Available only when the latest finished security evaluation completed and is current. */
  securityEvaluation: ContextSection<{ current: true }>;
  recommendations: ContextSection<{ active: number; totalEstimatedMonthlySavings: number }>;
  spend: ContextSection<SpendEvidence>;
  monthOverMonth: ContextSection<MonthOverMonthEvidence>;
  /** CloudWatch alarms, the alerts source (A-D10). */
  monitoring: ContextSection<AlarmsEvidence>;
}

function money(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${abs}` : `$${abs}`;
}

function missing(section: ContextSection<unknown>): string {
  return (section.reason ?? 'no data').replace(/\.$/, '');
}

/** A missing fact in words: a section left out for its size says so, never "not available". */
function notAvailable(section: ContextSection<unknown>): string {
  return section.state === 'omitted' ? OMITTED_REASON : `not available (${missing(section)})`;
}

export class AISummaryService {
  private aiInsightsService = new AIInsightsService();

  private cache: Map<string, CacheEntry> = new Map();
  private static readonly CACHE_TTL_CEILING = 4 * 60 * 60 * 1000; // 4h

  /**
   * Get the cached summary if the evidence fingerprint is unchanged from the
   * cached run -- otherwise regenerate and cache. organizationId must be the
   * authenticated caller's; there is no fallback tenant. System Status is
   * recomputed from the current alarm evidence on every request.
   */
  async getSummary(organizationId: string): Promise<AISummaryResult> {
    requireOrganizationId(organizationId, 'AI Summary', 'the dashboard summary');

    try {
      const { sections, evidence } = await this.gatherEvidence(organizationId);
      const fingerprint = evidenceFingerprint({ organizationId, sections: fingerprintSections(evidence), promptVersion: PROMPT_VERSION });
      const systemStatus = systemStatusFor(sections.monitoring);

      const cached = this.cache.get(organizationId);
      if (cached && cached.fingerprint === fingerprint && Date.now() - cached.timestamp < AISummaryService.CACHE_TTL_CEILING) {
        return this.result(cached.fields, cached.timestamp, systemStatus);
      }

      const fields = await this.buildSummary(sections, evidence);
      const timestamp = Date.now();
      this.cache.set(organizationId, { fields, fingerprint, timestamp });
      return this.result(fields, timestamp, systemStatus);
    } catch (error: any) {
      // Not cached: the next request retries instead of serving a failure for 4h.
      console.error('[AI Summary] Error generating summary:', error.message);
      const now = new Date().toISOString();
      return {
        ...EMPTY_FIELDS,
        systemStatus: SYSTEM_STATUS_UNAVAILABLE,
        topRiskStatus: 'unavailable',
        generatedAt: now,
        summarySource: 'ai_unavailable',
        aiGeneratedAt: null,
      };
    }
  }

  private result(fields: SummaryFields, timestamp: number, systemStatus: string): AISummaryResult {
    const generatedAt = new Date(timestamp).toISOString();
    return {
      ...fields,
      // No outage source is evaluated: generated text never states a status.
      systemStatus,
      generatedAt,
      aiGeneratedAt: fields.summarySource === 'ai_written' ? generatedAt : null,
    };
  }

  /** Every provider for the organization (summary sources loaded), and the summary's sections from them. */
  async gatherEvidence(organizationId: string): Promise<{ sections: DashboardSections; evidence: EvidenceBundle }> {
    const evidence = await collectEvidence(defaultEvidenceRegistry(), {
      organizationId,
      consumer: 'dashboard_summary',
      select: { providerIds: [...SUMMARY_PROVIDERS] },
      budgetTokens: SUMMARY_EVIDENCE_BUDGET_TOKENS,
    });
    // The cost findings' counts, under the summary's established source name.
    const findings = sectionOf<CostFindingsEvidence>(evidence, 'cost.findings');
    // Left out for its size: stays omitted (never "no cost findings are available").
    const recommendations = findings.state === 'omitted'
      ? { ...findings, source: 'DevControl cost recommendations', data: null } as ContextSection<{ active: number; totalEstimatedMonthlySavings: number }>
      : await collectSection<DashboardSections['recommendations'] extends ContextSection<infer T> ? T : never>(
      { source: 'DevControl cost recommendations', classification: 'estimated' },
      async () => {
        if (findings.state === 'error') throw new Error('cost findings could not be retrieved');
        if (!hasEvidence(findings)) return { state: 'unavailable', reason: findings.reason ?? 'no cost findings are available' };
        return { state: 'available', asOf: findings.asOf, data: { active: findings.data.lifecycle.active, totalEstimatedMonthlySavings: findings.data.totalEstimatedMonthlySavings } };
      }
    );
    const sections: DashboardSections = {
      systemScore: sectionOf(evidence, 'system.intelligence'),
      securityPosture: sectionOf(evidence, 'security.posture_counts'),
      accountFindings: sectionOf(evidence, 'security.top_risk'),
      securityEvaluation: sectionOf(evidence, 'security.evaluation_status'),
      recommendations,
      spend: sectionOf(evidence, 'cost.spend'),
      monthOverMonth: sectionOf(evidence, 'cost.month_over_month'),
      monitoring: sectionOf(evidence, 'ops.cloudwatch_alarms'),
    };
    return { sections, evidence };
  }

  async gatherSections(organizationId: string): Promise<DashboardSections> {
    return (await this.gatherEvidence(organizationId)).sections;
  }

  /** The fact lines the prompt is built from -- every missing source stated as missing. */
  buildFactLines(s: DashboardSections): string[] {
    const facts: string[] = [];

    if (hasEvidence(s.systemScore)) {
      const d = s.systemScore.data;
      const observability = d.observabilityState === 'partial'
        ? `Observability ${d.observability}, which measures EC2/RDS alert coverage only`
        : `Observability ${d.observability}`;
      const partial = s.systemScore.state === 'partial'
        ? ` This composite is partial and must be described as partial: ${missing(s.systemScore)}.`
        : '';
      facts.push(`Composite System Intelligence score: ${d.score}/100 (Cost ${d.cost}, Security ${d.security}, ${observability}).${partial}`);
    }

    if (hasEvidence(s.securityPosture) && hasEvidence(s.accountFindings)) {
      // The posture score's counts combine account-level findings (security
      // groups, IAM -- account_security_findings) with per-resource compliance
      // issues (see RiskTrackingService.combineSeverityCounts(), a plain
      // per-field sum), so the resource count is the exact difference.
      // Described as generic infrastructure checks, not framework checks --
      // most carry no framework label, so naming one would overstate them.
      const accountLevelCount = s.accountFindings.data.count;
      const resourceComplianceCount = s.securityPosture.data.combinedFindings - accountLevelCount;
      facts.push(
        `Security posture score: ${s.securityPosture.data.score}/100 — ${accountLevelCount} account-level ` +
        `finding${accountLevelCount !== 1 ? 's' : ''} (security groups, IAM) and ` +
        `${resourceComplianceCount} resource compliance issue${resourceComplianceCount !== 1 ? 's' : ''} ` +
        `(encryption, backups, tagging, and other infrastructure checks) currently active.`
      );
    } else {
      const gap = !hasEvidence(s.securityPosture) ? s.securityPosture : s.accountFindings;
      facts.push(`Security findings: ${notAvailable(gap)}. Do not state or imply that there are no security findings or risks.`);
    }

    if (hasEvidence(s.accountFindings) && s.accountFindings.data.top) {
      facts.push(`Top active finding: severity ${s.accountFindings.data.top.severity}; its title is the "top title" entry of the untrusted_evidence block below.`);
    }

    if (hasEvidence(s.recommendations)) {
      const { active, totalEstimatedMonthlySavings } = s.recommendations.data;
      if (active > 0) {
        facts.push(
          `${active} active cost optimization${active !== 1 ? 's have' : ' has'} estimated potential savings of approximately ` +
          `${formatSavingsCurrency(totalEstimatedMonthlySavings)}/month (a DevControl estimate, not realized savings).`
        );
      }
    } else {
      facts.push(`Cost recommendations: ${notAvailable(s.recommendations)}.`);
    }

    if (hasEvidence(s.monitoring)) {
      const d = s.monitoring.data;
      const region = s.monitoring.scope?.kind === 'aws_account_region' && s.monitoring.scope.region ? ` in ${s.monitoring.scope.region}` : '';
      facts.push(
        `CloudWatch alarms${region}: ${d.inAlarmComplete ? '' : 'at least '}${d.inAlarmCount} in ALARM, ` +
        `${d.configuredCountComplete ? '' : 'at least '}${d.configuredCount} configured (current state only). ` +
        'DevControl does not detect outages, incidents, or anomalies: never infer that there are none.'
      );
    } else {
      facts.push(
        `CloudWatch alarms: ${statusPhrase(s.monitoring)}. ` +
        'Do not state or imply that there are no alarms, outages, incidents, or anomalies.'
      );
    }

    if (hasEvidence(s.spend)) {
      const d = s.spend.data;
      if (d.basis === 'billed_month_to_date') {
        const period = s.spend.period?.kind === 'range'
          ? ` (${s.spend.period.start} through ${lastIncludedDay(s.spend.period.endExclusive)})`
          : '';
        const credit = d.amount < 0 ? ' (net negative: credits and refunds exceed charges)' : '';
        const inProgress = d.lastDayInProgress ? '; the current day is still being billed' : '';
        facts.push(`AWS Cost Explorer month-to-date billed spend${period} is ${money(d.amount)}${credit}${inProgress}.`);
      } else {
        const partial = s.spend.state === 'partial' && s.spend.reason ? `; ${s.spend.reason}` : '';
        facts.push(
          `Estimated current monthly cloud spend is approximately ${money(d.amount)} ` +
          `(based on discovered resource pricing, not live billing data${partial}).`
        );
      }
    } else {
      facts.push(`Cloud spend: ${notAvailable(s.spend)}. Do not describe spend as $0 or unchanged.`);
    }

    if (hasEvidence(s.monthOverMonth)) {
      const d = s.monthOverMonth.data;
      const pct = d.changePercent !== null
        ? `${d.changePercent > 0 ? 'up' : d.changePercent < 0 ? 'down' : 'unchanged at'} ${Math.abs(d.changePercent).toFixed(1)}%`
        : 'a percentage change is undefined because the previous window totals $0.00';
      const today = d.currentWindowIncludesToday ? '; the current day is still being billed' : '';
      const partial = s.monthOverMonth.state === 'partial' ? '; some days have no daily data' : '';
      facts.push(
        `Month-to-date spend vs the same days last month: ${pct} (${money(d.currentWindowTotal)} vs ${money(d.previousWindowTotal)}, ` +
        `daily charges with credits excluded${today}${partial}).`
      );
    } else if (hasEvidence(s.spend)) {
      facts.push(`Month-over-month change: ${notAvailable(s.monthOverMonth)}. Do not describe spend as up, down, flat, or unchanged.`);
    }

    return facts;
  }

  /**
   * Top Risk is only ever a finding present in the evidence, chosen by the shared
   * rule (top-risk-selection.ts): never one the customer accepted or dismissed.
   * W11 ("no_urgent_findings") requires the latest security evaluation to have
   * completed and be current, and no critical, high or medium finding open in
   * either source. W11b ("all_urgent_reviewed") requires the same evaluation, no
   * resource-compliance critical/high/medium, and every account critical/high/
   * medium finding accepted or dismissed -- the score's counts and the findings
   * list must agree on that number, or neither line is shown. Otherwise the count
   * line stays as before. "none_identified"
   * requires both security sources to be evaluated and empty -- anything
   * missing, failed, or preliminary is "unavailable", never "no risks".
   * Always deterministic: model-written text never reaches this field.
   */
  private topRiskFor(s: DashboardSections): { topRisk: string | null; topRiskStatus: TopRiskStatus } {
    const accountCount = hasEvidence(s.accountFindings) ? s.accountFindings.data.count : null;
    const combined = hasEvidence(s.securityPosture) ? s.securityPosture.data.combinedFindings : null;

    const top = hasEvidence(s.accountFindings) ? s.accountFindings.data.top : null;
    const title = top ? topRiskTitle(s.accountFindings) : null;
    if (top && title) return { topRisk: `${title} (${top.severity} severity)`, topRiskStatus: 'identified' };

    const urgent = hasEvidence(s.securityPosture) ? s.securityPosture.data.urgentFindings : null;
    const accountUrgent = hasEvidence(s.securityPosture) ? s.securityPosture.data.accountUrgentFindings : null;
    const reviewed = hasEvidence(s.accountFindings) ? s.accountFindings.data.reviewedUrgent : null;
    // Both lines need complete, current evidence from every source they speak for.
    const evaluated =
      combined !== null && combined > 0 &&
      s.accountFindings.state === 'available' && s.securityPosture.state === 'available' &&
      s.securityEvaluation.state === 'available';

    if (evaluated && urgent === 0) {
      return { topRisk: noUrgentFindingsLine(combined), topRiskStatus: 'no_urgent_findings' };
    }

    if (evaluated && urgent !== null && urgent > 0 && accountUrgent === urgent && reviewed === urgent) {
      return { topRisk: reviewedFindingsLine(reviewed), topRiskStatus: 'all_urgent_reviewed' };
    }

    if (combined !== null && combined > 0) {
      // combinedFindings is account findings + resource compliance issues
      // (combineSeverityCounts). Only with account findings known to be zero is
      // it a resource-compliance-only count; without them it stays combined.
      const topRisk = accountCount === 0
        ? `${combined} resource compliance issue${combined !== 1 ? 's' : ''} currently active`
        : `${combined} security finding${combined !== 1 ? 's' : ''} (account and resource compliance combined)`;
      return { topRisk, topRiskStatus: 'identified' };
    }

    const evaluatedAndEmpty =
      s.accountFindings.state === 'available' && accountCount === 0 &&
      s.securityPosture.state === 'available' && combined === 0;
    return { topRisk: null, topRiskStatus: evaluatedAndEmpty ? 'none_identified' : 'unavailable' };
  }

  private async buildSummary(sections: DashboardSections, evidence: EvidenceBundle): Promise<SummaryFields> {
    const facts = this.buildFactLines(sections);
    const topUntrusted = (sections.accountFindings.untrusted ?? []).filter((u) => u.field === 'top title');
    const fence = topUntrusted.length > 0 ? `\n${untrustedBlock('security.top_risk', topUntrusted)}` : '';

    const prompt =
      `You are populating a scannable, 4-part executive summary for a cloud infrastructure ` +
      `dashboard: Overall Health, Top Risk, Cloud Spend, and System Status.\n\n` +
      `Use ONLY the facts below. Do not invent, estimate, or assume anything not explicitly ` +
      `stated — reproduce any scores or dollar amounts exactly as given, including any ` +
      `"estimated"/"approximately" qualifier on a figure — never drop it or state an ` +
      `estimated figure as if it were confirmed. A fact marked "not available" is missing ` +
      `data: never turn it into zero, none, no findings, no outages, or unchanged. Do not add ` +
      `generic advice or filler. Each field should be a short, plain-English clause or sentence, ` +
      `not a list. If a fact needed for a field is not present below, leave that field null ` +
      `rather than guessing.\n\n` +
      `Evidence rules:\n${EVIDENCE_CLAIM_RULES.split('\n').map(rule => `- ${rule}`).join('\n')}\n- ${UNTRUSTED_TEXT_RULE}\n- ${LOW_ACTIVITY_FINDING_RULE}\n\n` +
      `Fields to populate:\n` +
      `- overallHealth: the composite System Intelligence score (if present) plus a brief ` +
      `clause of context on what's driving it.\n` +
      `- topRisk: the single most urgent security finding present below, one short sentence; null if none is present.\n` +
      `- cloudSpend: current spend, trend, and optimization potential as stated below, one short sentence.\n` +
      `- systemStatus: the CloudWatch alarm state exactly as stated below, one short clause.\n\n` +
      `Facts:\n${facts.map((f) => `- ${f}`).join('\n')}${fence}\n\n` +
      renderEvidence(evidence, { except: SUMMARY_FACT_PROVIDERS });

    const outcome = await this.aiInsightsService.summarizeDashboard(prompt);
    const fields = outcome.fields ?? EMPTY_FIELDS;
    const risk = this.topRiskFor(sections);

    return {
      ...fields,
      ...risk,
      summarySource: outcome.source,
    };
  }
}
