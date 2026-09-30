/**
 * AI Summary Service
 * Composes real, already-computed dashboard evidence (System Intelligence
 * score, security posture, top finding, cost recommendations, cloud spend and
 * its month-over-month comparison) into a fact-only prompt and asks Claude (via
 * AIInsightsService) to turn it into a short plain-English summary.
 *
 * Every input is its own ContextSection (ai-context-contract.ts), so one
 * failed source never blanks the others, and missing evidence is stated as
 * missing -- never as zero, "none", or "no outages". Outage/anomaly status is
 * not evaluated by DevControl, so systemStatus says so deterministically
 * rather than letting the model infer "no critical outages" from absent data.
 *
 * Spend comes from the AI Chat cost path (AIChatContextRepository.
 * gatherCostContext() via cost-context-sections.ts), so a real $0 or
 * net-credit Cost Explorer month stays actual billed spend, an inventory
 * estimate is labeled an estimate, and the month-over-month change is
 * DevControl's own derived comparison -- never a client-supplied number.
 *
 * Cached per-org, keyed on evidenceFingerprint() of every section the prompt
 * is built from (so any change in a fact, its state, or its freshness
 * regenerates the prose), with a 4h TTL ceiling as a defensive fallback.
 */

import { pool } from '../config/database';
import { AIInsightsService, StructuredDashboardSummary } from './ai-insights.service';
import systemIntelligenceService from './system-intelligence.service';
import { RiskTrackingService } from './risk-tracking.service';
import { AccountSecurityFindingsRepository } from '../repositories/account-security-findings.repository';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import { AIChatContextRepository } from '../repositories/ai-chat-context.repository';
import { formatSavingsCurrency } from '../utils/formatSavingsCurrency';
import {
  collectSection,
  EVIDENCE_CLAIM_RULES,
  evidenceFingerprint,
  hasEvidence,
  notSupported,
  requireOrganizationId,
  type ContextDataState,
  type ContextSection,
} from './ai-context-contract';
import { lastIncludedDay } from './ai-chat.service';
import { monthOverMonthSection, spendSection, type MonthOverMonthEvidence, type SpendEvidence } from './cost-context-sections';

const EMPTY_FIELDS: StructuredDashboardSummary = {
  overallHealth: { score: null, context: null },
  topRisk: null,
  cloudSpend: null,
  systemStatus: null,
};

/** Bump when the prompt or the facts it is built from change, so cached prose is not reused. */
const PROMPT_VERSION = 'dashboard-summary-v3';

/** Shown instead of any model-written status while DevControl evaluates no outage/anomaly source. */
export const SYSTEM_STATUS_UNAVAILABLE = 'Outage status unavailable: DevControl does not currently evaluate outages or incidents.';

/**
 * identified      = topRisk states a finding present in the evidence
 * none_identified = security evidence was evaluated and records no active findings
 * unavailable     = risk could not be evaluated (missing, failed, or preliminary evidence)
 */
export type TopRiskStatus = 'identified' | 'none_identified' | 'unavailable';

export interface AISummaryResult extends StructuredDashboardSummary {
  topRiskStatus: TopRiskStatus;
  generatedAt: string;
}

type SummaryFields = StructuredDashboardSummary & { topRiskStatus: TopRiskStatus };

interface CacheEntry {
  fields: SummaryFields;
  fingerprint: string;
  timestamp: number;
}

export interface DashboardSections {
  systemScore: ContextSection<{ score: number; cost: number | null; security: number | null; observability: number | null; observabilityState: ContextDataState }>;
  securityPosture: ContextSection<{ score: number; combinedFindings: number }>;
  accountFindings: ContextSection<{ count: number; top: { title: string; severity: string } | null }>;
  recommendations: ContextSection<{ active: number; totalEstimatedMonthlySavings: number }>;
  spend: ContextSection<SpendEvidence>;
  monthOverMonth: ContextSection<MonthOverMonthEvidence>;
  monitoring: ContextSection<never>;
}

function money(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${abs}` : `$${abs}`;
}

function missing(section: ContextSection<unknown>): string {
  return (section.reason ?? 'no data').replace(/\.$/, '');
}

export class AISummaryService {
  private aiInsightsService = new AIInsightsService(pool);
  private riskTrackingService = new RiskTrackingService(pool);
  private accountFindingsRepository = new AccountSecurityFindingsRepository();
  private costRecommendationsRepository = new CostRecommendationsRepository();
  private contextRepository = new AIChatContextRepository(pool);

  private cache: Map<string, CacheEntry> = new Map();
  private static readonly CACHE_TTL_CEILING = 4 * 60 * 60 * 1000; // 4h

  /**
   * Get the cached summary if the evidence fingerprint is unchanged from the
   * cached run -- otherwise regenerate and cache. organizationId must be the
   * authenticated caller's; there is no fallback tenant.
   */
  async getSummary(organizationId: string): Promise<AISummaryResult> {
    requireOrganizationId(organizationId, 'AI Summary', 'the dashboard summary');

    let fields: SummaryFields;
    try {
      const sections = await this.gatherSections(organizationId);
      const fingerprint = evidenceFingerprint({ organizationId, sections: { ...sections }, promptVersion: PROMPT_VERSION });

      const cached = this.cache.get(organizationId);
      if (cached && cached.fingerprint === fingerprint && Date.now() - cached.timestamp < AISummaryService.CACHE_TTL_CEILING) {
        return { ...cached.fields, generatedAt: new Date(cached.timestamp).toISOString() };
      }

      fields = await this.buildSummary(sections);
      const timestamp = Date.now();
      this.cache.set(organizationId, { fields, fingerprint, timestamp });
      return { ...fields, generatedAt: new Date(timestamp).toISOString() };
    } catch (error: any) {
      // Not cached: the next request retries instead of serving a failure for 4h.
      console.error('[AI Summary] Error generating summary:', error.message);
      fields = { ...EMPTY_FIELDS, systemStatus: SYSTEM_STATUS_UNAVAILABLE, topRiskStatus: 'unavailable' };
      return { ...fields, generatedAt: new Date().toISOString() };
    }
  }

  async gatherSections(organizationId: string): Promise<DashboardSections> {
    const costSections = this.contextRepository.gatherCostContext(organizationId)
      .then(({ costs }) => Promise.all([spendSection(costs), monthOverMonthSection(costs)]))
      .catch(async (error: unknown) => {
        const failed = () => { throw error; };
        return Promise.all([
          collectSection<SpendEvidence>({ source: 'AWS Cost Explorer' }, failed),
          collectSection<MonthOverMonthEvidence>({ source: 'DevControl month-over-month comparison' }, failed),
        ]);
      });

    const [systemScore, securityPosture, accountFindings, recommendations, [spend, monthOverMonth]] = await Promise.all([
      collectSection<DashboardSections['systemScore'] extends ContextSection<infer T> ? T : never>(
        { source: 'DevControl System Intelligence score', provenance: 'derived', coverage: "composite of DevControl's cost, security, and observability component scores" },
        async () => {
          const intelligence = await systemIntelligenceService.getSystemIntelligence(organizationId);
          if (intelligence.system_score == null) return { state: 'unavailable', reason: 'the System Intelligence score is not ready yet' };
          const observability = intelligence.components.observability;
          const data = {
            score: intelligence.system_score,
            cost: intelligence.components.cost.score ?? null,
            security: intelligence.components.security.score ?? null,
            observability: observability.score ?? null,
            observabilityState: observability.state,
          };
          // A composite built on a partial component is itself partial.
          return intelligence.composite_state === 'partial'
            ? { state: 'partial', data, reason: intelligence.composite_reason }
            : { state: 'available', data };
        }
      ),
      collectSection<DashboardSections['securityPosture'] extends ContextSection<infer T> ? T : never>(
        { source: 'DevControl security posture score', provenance: 'derived' },
        async () => {
          const risk = await this.riskTrackingService.getCurrentRiskScore(organizationId);
          if (risk.isPreliminary) return { state: 'unavailable', reason: 'the security posture score is still preliminary' };
          const c = risk.complianceIssueCounts;
          return { state: 'available', data: { score: risk.score, combinedFindings: c.critical + c.high + c.medium + c.low } };
        }
      ),
      collectSection<DashboardSections['accountFindings'] extends ContextSection<infer T> ? T : never>(
        { source: 'DevControl account-level security findings (security groups, IAM)', provenance: 'actual' },
        async () => {
          // getActive() sorts by severity, so [0] is the most severe active finding.
          const active = await this.accountFindingsRepository.getActive(organizationId);
          const top = active[0] ? { title: active[0].title, severity: active[0].severity } : null;
          return { state: 'available', data: { count: active.length, top } };
        }
      ),
      collectSection<DashboardSections['recommendations'] extends ContextSection<infer T> ? T : never>(
        { source: 'DevControl cost recommendations', provenance: 'estimated' },
        async () => {
          const stats = await this.costRecommendationsRepository.getStats(organizationId);
          return { state: 'available', data: { active: stats.active_recommendations, totalEstimatedMonthlySavings: stats.total_potential_savings } };
        }
      ),
      costSections,
    ]);

    const monitoring = notSupported<never>(
      { source: 'DevControl outage and anomaly detection' },
      'DevControl does not currently evaluate outages, incidents, or anomalies'
    );

    return { systemScore, securityPosture, accountFindings, recommendations, spend, monthOverMonth, monitoring };
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
      const reason = !hasEvidence(s.securityPosture) ? missing(s.securityPosture) : missing(s.accountFindings);
      facts.push(`Security findings: not available (${reason}). Do not state or imply that there are no security findings or risks.`);
    }

    if (hasEvidence(s.accountFindings) && s.accountFindings.data.top) {
      facts.push(`Top active finding: "${s.accountFindings.data.top.title}" (severity: ${s.accountFindings.data.top.severity}).`);
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
      facts.push(`Cost recommendations: not available (${missing(s.recommendations)}).`);
    }

    facts.push(
      `Outage and incident status: not available — ${missing(s.monitoring)}. ` +
      'Do not state or imply that there are no outages, incidents, or anomalies.'
    );

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
      facts.push(`Cloud spend: not available (${missing(s.spend)}). Do not describe spend as $0 or unchanged.`);
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
      facts.push(`Month-over-month change: not available (${missing(s.monthOverMonth)}). Do not describe spend as up, down, flat, or unchanged.`);
    }

    return facts;
  }

  /**
   * Top Risk is only ever a finding present in the evidence. "none_identified"
   * requires both security sources to be evaluated and empty -- anything
   * missing, failed, or preliminary is "unavailable", never "no risks".
   * Always deterministic: model-written text never reaches this field.
   */
  private topRiskFor(s: DashboardSections): { topRisk: string | null; topRiskStatus: TopRiskStatus } {
    const accountCount = hasEvidence(s.accountFindings) ? s.accountFindings.data.count : null;
    const combined = hasEvidence(s.securityPosture) ? s.securityPosture.data.combinedFindings : null;

    if ((accountCount ?? 0) > 0 || (combined ?? 0) > 0) {
      const top = hasEvidence(s.accountFindings) ? s.accountFindings.data.top : null;
      const topRisk = top
        ? `${top.title} (${top.severity} severity)`
        : `${combined} resource compliance issue${combined !== 1 ? 's' : ''} currently active`;
      return { topRisk, topRiskStatus: 'identified' };
    }

    const evaluatedAndEmpty =
      s.accountFindings.state === 'available' && accountCount === 0 &&
      s.securityPosture.state === 'available' && combined === 0;
    return { topRisk: null, topRiskStatus: evaluatedAndEmpty ? 'none_identified' : 'unavailable' };
  }

  private async buildSummary(sections: DashboardSections): Promise<SummaryFields> {
    const facts = this.buildFactLines(sections);

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
      `Evidence rules:\n${EVIDENCE_CLAIM_RULES.split('\n').map(rule => `- ${rule}`).join('\n')}\n\n` +
      `Fields to populate:\n` +
      `- overallHealth: the composite System Intelligence score (if present) plus a brief ` +
      `clause of context on what's driving it.\n` +
      `- topRisk: the single most urgent security finding present below, one short sentence; null if none is present.\n` +
      `- cloudSpend: current spend, trend, and optimization potential as stated below, one short sentence.\n` +
      `- systemStatus: the outage/incident state exactly as stated below, one short clause.\n\n` +
      `Facts:\n${facts.map((f) => `- ${f}`).join('\n')}`;

    const result = await this.aiInsightsService.generateStructuredDashboardSummary(prompt);
    const fields = result ?? EMPTY_FIELDS;
    const risk = this.topRiskFor(sections);

    return {
      ...fields,
      ...risk,
      // No outage source is evaluated: never let generated text claim a status.
      systemStatus: hasEvidence(sections.monitoring) ? fields.systemStatus : SYSTEM_STATUS_UNAVAILABLE,
    };
  }
}
