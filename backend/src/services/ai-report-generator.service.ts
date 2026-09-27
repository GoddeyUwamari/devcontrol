/**
 * AI Report Generator Service
 * Generates AI-powered infrastructure reports from evidence DevControl
 * actually holds.
 *
 * Every data source is its own ContextSection (ai-context-contract.ts), so a
 * report can have cost available, security partial, and alerts not supported
 * at the same time -- never one global "data unavailable" switch, never a
 * placeholder number standing in for missing evidence. In particular there is
 * no fabricated previous cost, previous security score, resource change,
 * lead-time default, or hard-coded issue severity: a fact is stated only when
 * a section carries evidence for it.
 *
 * Cost evidence comes from the AI Chat cost path
 * (AIChatContextRepository.gatherCostContext() via cost-context-sections.ts),
 * so a real $0 or net-credit Cost Explorer month stays actual billed spend
 * and an inventory estimate is always labeled an estimate.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import { AWSResourcesRepository } from '../repositories/awsResources.repository';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import { AIChatContextRepository } from '../repositories/ai-chat-context.repository';
import type { ChatContext } from './ai-chat.service';
import {
  AI_CONTEXT_CONTRACT_VERSION,
  collectSection,
  deriveSection,
  EVIDENCE_CLAIM_RULES,
  hasEvidence,
  notSupported,
  requireOrganizationId,
  toModelEvidence,
  type ContextSection,
  type EvidencePeriod,
  type SectionMeta,
} from './ai-context-contract';
import { monthOverMonthSection, spendSection, type MonthOverMonthEvidence, type SpendEvidence } from './cost-context-sections';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

type Severity = 'critical' | 'high' | 'medium' | 'low';
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export interface ComplianceFindingsEvidence {
  /** Non-terminated discovered resources the checks ran against. */
  resourcesEvaluated: number;
  resourcesWithFindings: number;
  findingsBySeverity: Record<Severity, number>;
  /** Per category, with severities and resource types taken from the findings themselves. */
  byCategory: Array<{ category: string; findings: number; highestSeverity: Severity; resourceTypes: string[] }>;
}

export interface DeploymentCounts {
  total: number;
  successful: number;
  failed: number;
}

export interface DeliveryRates {
  /** null when no deployments were recorded -- a rate of nothing is undefined, not 0%. */
  successRatePercent: number | null;
  changeFailureRatePercent: number | null;
  deploymentsPerDay: number;
}

export interface TimeBetweenDeployments {
  averageHours: number;
  intervalsMeasured: number;
  servicesMeasured: number;
}

export interface IdleResourceRecommendations {
  items: Array<{ resourceId: string; resourceType: string; issue: string; estimatedMonthlySavings: number }>;
  totalEstimatedMonthlySavings: number;
}

interface DeploymentRecord {
  serviceId: string;
  status: string;
  deployedAt: string;
}

/** The evidence one report is written from. A section absent here was not requested for this report type. */
export interface ReportData {
  organizationId: string;
  reportType: string;
  /** The requested report period; `to` is exclusive (matching the deployment query). */
  dateRange: { from: string; to: string };
  sections: {
    spend?: ContextSection<SpendEvidence>;
    monthOverMonth?: ContextSection<MonthOverMonthEvidence>;
    topEstimatedResources?: ContextSection<Array<{ resourceId: string; resourceType: string; name: string; estimatedMonthlyCost: number }>>;
    idleResourceRecommendations?: ContextSection<IdleResourceRecommendations>;
    resourceInventory?: ContextSection<{ total: number; byType: Record<string, number> }>;
    resourceChange?: ContextSection<never>;
    securityFindings?: ContextSection<ComplianceFindingsEvidence>;
    securityScore?: ContextSection<never>;
    securityHistory?: ContextSection<never>;
    deployments?: ContextSection<DeploymentCounts>;
    deliveryRates?: ContextSection<DeliveryRates>;
    timeBetweenDeployments?: ContextSection<TimeBetweenDeployments>;
    alerts?: ContextSection<never>;
  };
}

export interface GeneratedReport {
  summary: string;
  keyHighlights: string[];
  costAnalysis?: {
    overview: string;
    trends: string;
    recommendations: string[];
  };
  securityAnalysis?: {
    overview: string;
    topRisks: string;
    recommendations: string[];
  };
  performanceAnalysis?: {
    overview: string;
    doraMetrics: string;
    recommendations: string[];
  };
  topRecommendations: Array<{
    title: string;
    impact: 'high' | 'medium' | 'low';
    description: string;
    estimatedSavings?: number;
    effort: 'low' | 'medium' | 'high';
  }>;
  executiveSummary: string;
}

export interface GeneratedReportResult {
  report: GeneratedReport;
  /** True when the deterministic template was used instead of the model. */
  wasFallback: boolean;
}

const SECTION_TITLES: Record<keyof ReportData['sections'], string> = {
  spend: 'Cloud spend',
  monthOverMonth: 'Month-over-month cost comparison',
  topEstimatedResources: 'Highest estimated-cost discovered resources',
  idleResourceRecommendations: 'Active idle/unused-resource recommendations',
  resourceInventory: 'Discovered resource inventory',
  resourceChange: 'Resource changes over the report period',
  securityFindings: 'Configuration-check findings on discovered resources',
  securityScore: 'Security score',
  securityHistory: 'Previous-period security results',
  deployments: 'Deployments recorded in the report period',
  deliveryRates: 'Deployment rates',
  timeBetweenDeployments: 'Average time between successful deployments of the same service (NOT DORA lead time)',
  alerts: 'Alerts',
};

const ALERTS_NOT_SUPPORTED_REASON =
  "DevControl's alert sync does not yet associate alerts with an organization, so this account's alert counts cannot be determined.";
const RESOURCE_CHANGE_NOT_SUPPORTED_REASON =
  'DevControl keeps only the current resource inventory, not its state at the start of the period, so resources added or removed during the period cannot be determined.';
const SECURITY_SCORE_NOT_SUPPORTED_REASON =
  'DevControl does not compute a validated security score for reports; the configuration-check findings are reported as counts instead.';
const SECURITY_HISTORY_NOT_SUPPORTED_REASON =
  "Each resource's configuration-check result is overwritten on every scan, so no earlier period's results exist to compare against.";

const CHECKS_COVERAGE =
  "DevControl's configuration checks (encryption, backups, public access, tagging, IAM and other checks) on resources discovered in the connected account's discovery region. Does not include account-level security findings or AWS Security Hub.";

const PROMPT_RULES = [
  'Cost figures have their own period (month-to-date billed spend, or a point-in-time monthly run-rate estimate), which may differ from the requested report period -- always state which one a figure is.',
  'Never state a previous-period cost, a trend, or a percentage change unless the month-over-month comparison section carries evidence. Never invent history.',
  'There is no security score and no earlier security result: do not state, estimate, or compare either.',
  'Resource changes over the period are not tracked: do not describe resource growth or decline.',
  '"Average time between successful deployments" is not DORA lead time for changes: never call it lead time.',
  'Alert data is not supported: never say there were no alerts, zero alerts, or that alerting is healthy.',
  'Configuration-check findings cover only DevControl\'s checks on discovered resources: no findings means none from those checks, not that no security issues exist.',
  'Recommend only actions grounded in the supplied evidence. Do not recommend rightsizing, Reserved Instances, or Savings Plans unless a supplied recommendation says so.',
  'Savings are DevControl estimates of potential savings, never realized savings. In topRecommendations, set estimatedSavings only to a value copied from the idle/unused-resource recommendation evidence; otherwise omit the field.',
  'When a section has no evidence, say that data is not available in the relevant analysis -- do not fill it in.',
].map(rule => `- ${rule}`).join('\n');

function money(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${abs}` : `$${abs}`;
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function unavailablePhrase(section: ContextSection<unknown>): string {
  return (section.reason ?? `${section.source} is not available`).replace(/\.$/, '');
}

export class AIReportGeneratorService {
  private awsResourcesRepo: AWSResourcesRepository;
  private costRecommendationsRepo: CostRecommendationsRepository;
  private contextRepo: AIChatContextRepository;

  constructor(private pool: Pool) {
    this.awsResourcesRepo = new AWSResourcesRepository(pool);
    this.costRecommendationsRepo = new CostRecommendationsRepository();
    this.contextRepo = new AIChatContextRepository(pool);
  }

  async generateWeeklyReport(data: ReportData, reportType: string = 'weekly_summary'): Promise<GeneratedReportResult> {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[AI Report Generator] ANTHROPIC_API_KEY not set - using fallback report');
      return { report: this.generateFallbackReport(data), wasFallback: true };
    }

    const systemPrompt = this.buildSystemPrompt(reportType);
    const userPrompt = this.buildUserPrompt(data, reportType);

    try {
      console.log('[AI Report Generator] Generating report with Claude API...');

      const response = await anthropic.messages.create(
        {
          model: 'claude-sonnet-5',
          max_tokens: 4000,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        },
        { timeout: 60000 }
      );

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      // Extract JSON from response
      let jsonText = content.text.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\n?/g, '');
      }

      const report: GeneratedReport = JSON.parse(jsonText);

      console.log('[AI Report Generator] Report generated successfully');
      return { report: this.stripUngroundedSavings(report, data), wasFallback: false };
    } catch (error: any) {
      console.error('[AI Report Generator] Error:', error.message);
      console.log('[AI Report Generator] Falling back to basic report');
      return { report: this.generateFallbackReport(data), wasFallback: true };
    }
  }

  /** The model-facing request: every section as toModelEvidence() JSON, plus the claim rules. */
  buildUserPrompt(data: ReportData, reportType: string): string {
    const sections = (Object.keys(data.sections) as Array<keyof ReportData['sections']>)
      .map(name => `### ${SECTION_TITLES[name]}\n${JSON.stringify(toModelEvidence(data.sections[name] as ContextSection<unknown>))}`)
      .join('\n\n');

    return `Generate a ${this.buildReportLabel(reportType)}. Requested report period: ${data.dateRange.from} to ${data.dateRange.to} (end date exclusive).

EVIDENCE (contract version ${AI_CONTEXT_CONTRACT_VERSION}): each section below is JSON with its state (available / partial / unavailable / error / not_supported), whether evidence is present, provenance (actual / estimated / derived), source, scope, period, asOf (when it was obtained), completeness, coverage, reason, and data. The meaning of each state and provenance is included with it.

RULES:
${EVIDENCE_CLAIM_RULES.split('\n').map(rule => `- ${rule}`).join('\n')}
${PROMPT_RULES}

${sections}

Return JSON with this structure (omit costAnalysis, securityAnalysis, or performanceAnalysis if no section above covers that area):
{
  "summary": "2-3 sentence summary grounded in the evidence",
  "keyHighlights": ["highlight 1", "highlight 2", "highlight 3"],
  "costAnalysis": {
    "overview": "cost evidence, with source and period",
    "trends": "the month-over-month comparison if it has evidence; otherwise say it is not available",
    "recommendations": ["recommendation grounded in the evidence"]
  },
  "securityAnalysis": {
    "overview": "configuration-check findings, with what they cover",
    "topRisks": "the most severe categories found, or that none were found by these checks",
    "recommendations": ["recommendation grounded in the evidence"]
  },
  "performanceAnalysis": {
    "overview": "deployment evidence for the report period",
    "doraMetrics": "only the delivery metrics present in the evidence, with their exact meaning",
    "recommendations": ["recommendation grounded in the evidence"]
  },
  "topRecommendations": [
    {
      "title": "Short recommendation title",
      "impact": "high",
      "description": "What to do and why, citing the evidence",
      "estimatedSavings": 0,
      "effort": "low"
    }
  ],
  "executiveSummary": "3-4 sentence summary for executives, grounded in the evidence"
}`;
  }

  private buildSystemPrompt(reportType: string): string {
    const base = `You are an AI infrastructure analyst for DevControl. You turn supplied, already-verified evidence into a clear report.

REPORT STYLE:
- Professional, concise, and strictly evidence-grounded
- Describe a trend or change only when a comparison section carries evidence for it
- Use dollar amounts and percentages only as they appear in the evidence, with their source and period
- Say plainly when data is not available, partial, or an estimate -- never fill a gap with an assumption

TONE:
- Clear and direct
- Balance technical accuracy with business language

RECOMMENDATIONS:
- Only recommend actions the evidence supports
- Include estimated impact only when the evidence contains it, labeled as an estimate
- Specify effort level (low/medium/high)`;

    switch (reportType) {
      case 'cost_analysis':
        return `${base}

FOCUS: Cost evidence and the active DevControl recommendations.
- Lead with the cost figures supplied, stating whether each is billed spend or an estimate
- Rank recommendations by the estimated savings given in the evidence
- Mention security and deployment details only if they are supplied and relevant to cost`;

      case 'security_insights':
        return `${base}

FOCUS: DevControl configuration-check findings on discovered resources.
- Lead with the most severe finding categories present in the evidence
- Map each finding category present to a concrete remediation action
- Rank recommendations by the severity recorded in the evidence (critical, high, medium, low)`;

      case 'infrastructure_health':
        return `${base}

FOCUS: Deployment activity and the resource inventory supplied.
- Lead with the deployment evidence for the report period
- Availability, error-rate, and alert data are not part of this report's evidence -- do not describe them`;

      case 'executive_summary':
        return `${base}

FOCUS: Board-ready executive summary with business impact.
- Use business language, not technical jargon
- Lead with the cost and risk facts present in the evidence
- Keep each section to 2-3 sentences maximum
- Recommendations must include a business outcome, and only where the evidence supports it`;

      default:
        // weekly_summary, monthly_summary — comprehensive review
        return `${base}

FOCUS: Comprehensive review across the cost, security, and deployment evidence supplied.
- Cover each area that has a section, stating what is and is not available
- Include an executive summary suitable for non-technical stakeholders`;
    }
  }

  private buildReportLabel(reportType: string): string {
    switch (reportType) {
      case 'cost_analysis':       return 'cost analysis report';
      case 'security_insights':   return 'security insights report';
      case 'infrastructure_health': return 'infrastructure health report';
      case 'executive_summary':   return 'executive summary report';
      case 'monthly_summary':     return 'monthly infrastructure report';
      default:                    return 'weekly infrastructure report';
    }
  }

  /**
   * The model may only cite savings that exist in the evidence: an
   * estimatedSavings that isn't one of the recommendation estimates (or
   * their total) is removed rather than shown as a DevControl figure.
   */
  private stripUngroundedSavings(report: GeneratedReport, data: ReportData): GeneratedReport {
    const recs = data.sections.idleResourceRecommendations;
    const allowed = new Set<number>();
    if (recs && hasEvidence(recs)) {
      recs.data.items.forEach(item => allowed.add(round(item.estimatedMonthlySavings, 2)));
      allowed.add(round(recs.data.totalEstimatedMonthlySavings, 2));
    }
    return {
      ...report,
      topRecommendations: (report.topRecommendations ?? []).map(rec => {
        if (rec.estimatedSavings === undefined || rec.estimatedSavings === null) return rec;
        if (allowed.has(round(Number(rec.estimatedSavings), 2))) return rec;
        const { estimatedSavings: _dropped, ...rest } = rec;
        return rest;
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Deterministic fallback (no API key, or the model call failed)
  // -------------------------------------------------------------------------

  private spendSentence(section: ContextSection<SpendEvidence>): string {
    if (!hasEvidence(section)) return `Cloud spend is not available: ${unavailablePhrase(section)}.`;
    const d = section.data;
    if (d.basis === 'estimated_monthly_run_rate') {
      const partial = section.state === 'partial' && section.reason ? `; ${section.reason}` : '';
      return `DevControl estimates the monthly run-rate of discovered resources at ${money(d.amount)} (a list-price estimate, not AWS billing data${partial}).`;
    }
    const period = section.period?.kind === 'range' ? ` for ${section.period.start} up to ${section.period.endExclusive} (exclusive)` : '';
    const credit = d.amount < 0 ? ' (net credit: credits and refunds exceed charges)' : '';
    const inProgress = d.lastDayInProgress ? '; the current day is still being billed' : '';
    return `AWS Cost Explorer shows ${money(d.amount)} of billed spend month-to-date${period}${credit}${inProgress}.`;
  }

  private monthOverMonthSentence(section: ContextSection<MonthOverMonthEvidence>): string {
    if (!hasEvidence(section)) return `A month-over-month cost comparison is not available (${unavailablePhrase(section)}), so no cost trend is reported.`;
    const d = section.data;
    const pct = d.changePercent !== null ? ` (${d.changePercent > 0 ? '+' : ''}${d.changePercent.toFixed(1)}%)` : ' (percentage undefined: the previous window totals $0.00)';
    const today = d.currentWindowIncludesToday ? " The current window's last day is today and still being billed." : '';
    const partial = section.state === 'partial' ? ' Some days in the compared windows have no daily data.' : '';
    return `Spend from ${d.currentWindow.start} to ${d.currentWindow.end} was ${money(d.currentWindowTotal)} vs ${money(d.previousWindowTotal)} for ${d.previousWindow.start} to ${d.previousWindow.end}, a change of ${money(d.changeAmount)}${pct}, from AWS Cost Explorer daily charges with credits excluded.${today}${partial}`;
  }

  private securitySentence(section: ContextSection<ComplianceFindingsEvidence>): string {
    if (!hasEvidence(section)) return `Configuration-check findings are not available: ${unavailablePhrase(section)}.`;
    const d = section.data;
    const partial = section.state === 'partial' && section.reason ? ` (${section.reason.replace(/\.$/, '')})` : '';
    const total = SEVERITIES.reduce((sum, s) => sum + d.findingsBySeverity[s], 0);
    if (total === 0) {
      return `DevControl's configuration checks on ${d.resourcesEvaluated} discovered resources recorded no findings${partial}. This covers only those checks, not account-level security findings.`;
    }
    const counts = SEVERITIES.map(s => `${d.findingsBySeverity[s]} ${s}`).join(', ');
    return `DevControl's configuration checks on ${d.resourcesEvaluated} discovered resources recorded ${total} findings on ${d.resourcesWithFindings} resources (${counts})${partial}.`;
  }

  private deploymentsSentence(section: ContextSection<DeploymentCounts>, rates?: ContextSection<DeliveryRates>): string {
    if (!hasEvidence(section)) return `Deployment data is not available: ${unavailablePhrase(section)}.`;
    const d = section.data;
    const rate = rates && hasEvidence(rates) && rates.data.successRatePercent !== null ? `, a ${rates.data.successRatePercent}% success rate` : '';
    return `${d.total} deployments were recorded in DevControl for the report period: ${d.successful} successful and ${d.failed} failed${rate}.`;
  }

  private deliveryMetricsSentence(rates?: ContextSection<DeliveryRates>, gap?: ContextSection<TimeBetweenDeployments>): string {
    const parts: string[] = [];
    if (rates && hasEvidence(rates)) {
      parts.push(`Deployment frequency: ${rates.data.deploymentsPerDay} per day.`);
      parts.push(rates.data.changeFailureRatePercent !== null
        ? `Change failure rate: ${rates.data.changeFailureRatePercent}% of recorded deployments failed.`
        : 'Change failure rate: not applicable, no deployments were recorded.');
    } else if (rates) {
      parts.push(`Deployment rates are not available: ${unavailablePhrase(rates)}.`);
    }
    if (gap && hasEvidence(gap)) {
      parts.push(`Average time between consecutive successful deployments of the same service: ${gap.data.averageHours} hours (${gap.data.intervalsMeasured} intervals across ${gap.data.servicesMeasured} services).`);
    } else if (gap) {
      parts.push(`Time between deployments is not available: ${unavailablePhrase(gap)}.`);
    }
    parts.push('DevControl does not measure DORA lead time for changes.');
    return parts.join(' ');
  }

  private generateFallbackReport(data: ReportData): GeneratedReport {
    const s = data.sections;
    const highlights: string[] = [];
    const topRecommendations: GeneratedReport['topRecommendations'] = [];
    const report: GeneratedReport = { summary: '', keyHighlights: highlights, topRecommendations, executiveSummary: '' };

    const recs = s.idleResourceRecommendations;
    const recsWithItems = recs && hasEvidence(recs) && recs.data.items.length > 0 ? recs.data : null;

    if (s.spend) {
      const spend = this.spendSentence(s.spend);
      const trend = s.monthOverMonth ? this.monthOverMonthSentence(s.monthOverMonth) : '';
      highlights.push(spend);
      const top = hasEvidence(s.spend) && s.spend.data.topServices && s.spend.data.topServices.length > 0
        ? ` Largest Cost Explorer service categories: ${s.spend.data.topServices.map(t => `${t.service} ${money(t.amount)}`).join(', ')}.`
        : '';
      const costRecommendations: string[] = [];
      if (recsWithItems) {
        costRecommendations.push(`Review ${recsWithItems.items.length} active recommendations for idle or unused resources (estimated potential savings of ${money(recsWithItems.totalEstimatedMonthlySavings)}/month; a DevControl estimate, not realized savings).`);
      } else if (recs && !hasEvidence(recs)) {
        costRecommendations.push(`Cost recommendations are not available: ${unavailablePhrase(recs)}.`);
      }
      report.costAnalysis = { overview: `${spend}${top}`, trends: trend, recommendations: costRecommendations };
    }

    if (recsWithItems) {
      highlights.push(`Estimated potential savings of ${money(recsWithItems.totalEstimatedMonthlySavings)}/month from idle or unused resources (a DevControl estimate, not realized savings).`);
      topRecommendations.push({
        title: 'Review idle or unused resources',
        impact: 'medium',
        description: `${recsWithItems.items.length} active DevControl recommendations flag idle or unused resources. Savings are DevControl estimates, not realized savings.`,
        estimatedSavings: recsWithItems.totalEstimatedMonthlySavings,
        effort: 'low',
      });
    }

    if (s.securityFindings) {
      const security = this.securitySentence(s.securityFindings);
      highlights.push(security);
      const findings = hasEvidence(s.securityFindings) ? s.securityFindings.data : null;
      const severe = findings ? findings.findingsBySeverity.critical + findings.findingsBySeverity.high : 0;
      report.securityAnalysis = {
        overview: `${security} DevControl does not compute a security score for reports, and earlier-period results are not stored.`,
        topRisks: !findings
          ? 'Not available.'
          : findings.byCategory.length > 0
            ? findings.byCategory.map(c => `${c.category}: ${c.findings} findings (highest severity: ${c.highestSeverity}; resource types: ${c.resourceTypes.join(', ')})`).join('; ')
            : 'No findings were recorded by these checks.',
        recommendations: severe > 0 ? [`Review the ${severe} critical and high severity configuration findings.`] : [],
      };
      if (severe > 0) {
        topRecommendations.unshift({
          title: 'Address critical and high severity configuration findings',
          impact: 'high',
          description: `DevControl's configuration checks recorded ${severe} critical or high severity findings on discovered resources.`,
          effort: 'medium',
        });
      }
    }

    if (s.deployments) {
      const deployments = this.deploymentsSentence(s.deployments, s.deliveryRates);
      highlights.push(deployments);
      const failed = hasEvidence(s.deployments) ? s.deployments.data.failed : 0;
      report.performanceAnalysis = {
        overview: deployments,
        doraMetrics: this.deliveryMetricsSentence(s.deliveryRates, s.timeBetweenDeployments),
        recommendations: failed > 0 ? [`Investigate the ${failed} failed deployments recorded in this period.`] : [],
      };
      if (failed > 3) {
        topRecommendations.push({
          title: 'Improve Deployment Success Rate',
          impact: 'medium',
          description: `Investigate recurring deployment failures (${failed} failures recorded this period).`,
          effort: 'medium',
        });
      }
    }

    if (s.resourceInventory) {
      highlights.push(hasEvidence(s.resourceInventory)
        ? `${s.resourceInventory.data.total} discovered resources across ${Object.keys(s.resourceInventory.data.byType).length} types${s.resourceInventory.state === 'partial' ? ' (inventory may be incomplete)' : ''}. Changes over the period are not tracked.`
        : `Resource inventory is not available: ${unavailablePhrase(s.resourceInventory)}.`);
    }

    if (s.alerts) {
      highlights.push('Alert counts are not available: DevControl does not yet associate alerts with an organization.');
    }

    report.summary = highlights.slice(0, 3).join(' ');
    report.executiveSummary = highlights.join(' ');
    return report;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async saveGeneratedReport(
    organizationId: string,
    report: GeneratedReport,
    dateRange: { from: string; to: string },
    reportType: string = 'weekly',
    scheduledReportId?: string,
    wasFallback: boolean = false
  ): Promise<string> {
    try {
      const result = await this.pool.query(
        `INSERT INTO generated_reports
         (organization_id, scheduled_report_id, report_type, date_range_from, date_range_to, report_data, was_fallback)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          organizationId,
          scheduledReportId || null,
          reportType,
          dateRange.from,
          dateRange.to,
          JSON.stringify(report),
          wasFallback,
        ]
      );

      const reportId = result.rows[0].id;
      console.log(`[AI Report Generator] Saved report ${reportId} for org ${organizationId}`);
      return reportId;
    } catch (error: any) {
      console.error('[AI Report Generator] Failed to save report:', error.message);
      throw error;
    }
  }

  async fetchReportHistory(
    organizationId: string,
    limit: number = 10,
    reportType?: string
  ): Promise<any[]> {
    try {
      let query: string;
      let params: any[];

      if (reportType) {
        query = `SELECT id, report_type, date_range_from, date_range_to, created_at, report_data
                 FROM generated_reports
                 WHERE organization_id = $1 AND report_type = $2
                 ORDER BY created_at DESC
                 LIMIT $3`;
        params = [organizationId, reportType, limit];
      } else {
        query = `SELECT id, report_type, date_range_from, date_range_to, created_at, report_data
                 FROM generated_reports
                 WHERE organization_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`;
        params = [organizationId, limit];
      }

      const result = await this.pool.query(query, params);

      return result.rows;
    } catch (error: any) {
      console.error('[AI Report Generator] Failed to fetch history:', error.message);
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Evidence
  // -------------------------------------------------------------------------

  async fetchReportData(
    organizationId: string,
    dateRange: { from: string; to: string },
    reportType: string = 'weekly_summary'
  ): Promise<ReportData> {
    requireOrganizationId(organizationId, 'AI Reports', 'report evidence');
    const fetchStart = Date.now();
    console.log(`[AI Report Generator] Fetching data... (org=${organizationId}, type=${reportType}, range=${dateRange.from}→${dateRange.to})`);

    // Determine which data sources are needed for this report type
    const needsCost       = ['cost_analysis', 'executive_summary', 'weekly_summary', 'monthly_summary'].includes(reportType);
    const needsSecurity   = ['security_insights', 'executive_summary', 'weekly_summary', 'monthly_summary'].includes(reportType);
    const needsDeploys    = ['infrastructure_health', 'executive_summary', 'weekly_summary', 'monthly_summary'].includes(reportType);
    const needsResources  = ['cost_analysis', 'infrastructure_health', 'executive_summary', 'weekly_summary', 'monthly_summary'].includes(reportType);
    const needsAlerts     = ['infrastructure_health', 'executive_summary', 'weekly_summary', 'monthly_summary'].includes(reportType);

    // Discovery state gates every inventory-backed section; the cost path
    // (which also calls Cost Explorer) runs only when cost is requested.
    const basis = needsCost
      ? await this.contextRepo.gatherCostContext(organizationId)
      : await this.contextRepo.gatherInventoryBasis(organizationId);
    const { discovery, inventoryScope } = basis;

    // Shared by the inventory and security sections; each awaits it inside its
    // own getter, so a failure becomes that section's 'error', not a crash.
    const statsPromise = needsResources || needsSecurity ? this.awsResourcesRepo.getStats(organizationId) : null;
    statsPromise?.catch(() => undefined);

    const sections: ReportData['sections'] = {};
    const tasks: Array<Promise<void>> = [];

    if (needsCost && 'costs' in basis) {
      const costs = (basis as Pick<ChatContext, 'costs'>).costs;
      tasks.push((async () => {
        [sections.spend, sections.monthOverMonth] = await Promise.all([spendSection(costs), monthOverMonthSection(costs)]);
      })());
    }

    if (needsResources && statsPromise) {
      tasks.push((async () => {
        sections.resourceInventory = await this.discoveryGated(
          { source: 'DevControl resource inventory (periodic AWS discovery)', provenance: 'actual', scope: inventoryScope, period: { kind: 'point_in_time' } },
          discovery,
          d => d.total === 0,
          async () => {
            const stats = await statsPromise;
            return { total: stats.total_resources, byType: this.convertByTypeToRecord(stats.by_type) };
          }
        );
      })());
      tasks.push((async () => { sections.topEstimatedResources = await this.fetchTopEstimatedResources(organizationId, discovery, inventoryScope); })());
      tasks.push((async () => { sections.idleResourceRecommendations = await this.fetchIdleResourceRecommendations(organizationId, inventoryScope); })());
      sections.resourceChange = notSupported({ source: 'DevControl resource inventory', scope: inventoryScope }, RESOURCE_CHANGE_NOT_SUPPORTED_REASON);
    }

    if (needsSecurity && statsPromise) {
      tasks.push((async () => {
        sections.securityFindings = await this.discoveryGated<ComplianceFindingsEvidence>(
          { source: 'DevControl configuration checks on discovered resources', provenance: 'actual', scope: inventoryScope, period: { kind: 'point_in_time' }, coverage: CHECKS_COVERAGE },
          discovery,
          d => d.resourcesWithFindings === 0,
          async () => this.summarizeComplianceFindings(organizationId, (await statsPromise).total_resources)
        );
      })());
      sections.securityScore = notSupported({ source: 'DevControl security score' }, SECURITY_SCORE_NOT_SUPPORTED_REASON);
      sections.securityHistory = notSupported({ source: 'DevControl configuration checks on discovered resources', scope: inventoryScope }, SECURITY_HISTORY_NOT_SUPPORTED_REASON);
    }

    if (needsDeploys) {
      tasks.push((async () => { Object.assign(sections, await this.fetchDeploymentSections(organizationId, dateRange)); })());
    }

    if (needsAlerts) {
      sections.alerts = notSupported({ source: 'DevControl alert history' }, ALERTS_NOT_SUPPORTED_REASON);
    }

    await Promise.all(tasks);

    const states = (Object.keys(sections) as Array<keyof ReportData['sections']>).map(k => `${k}=${sections[k]!.state}`).join(', ');
    console.log(`[AI Report Generator] Evidence gathered in ${Date.now() - fetchStart}ms: ${states}`);

    return { organizationId, reportType, dateRange, sections };
  }

  /**
   * An inventory-backed read: 'available' (and an empty result a confirmed
   * zero) only once the latest discovery run has completed. Otherwise an empty
   * result is 'unavailable' and existing rows are 'partial'. Mirrors AI Chat's
   * inventorySection() gating so both surfaces agree.
   */
  private discoveryGated<T>(
    meta: SectionMeta,
    discovery: ChatContext['discovery'],
    isEmpty: (data: T) => boolean,
    query: () => Promise<T>
  ): Promise<ContextSection<T>> {
    return collectSection<T>(meta, async () => {
      const data = await query();
      if (discovery.state === 'available' && discovery.data) {
        return { state: 'available', data, asOf: discovery.data.completedAt };
      }
      const problem = discovery.state === 'error'
        ? 'the status of the latest discovery run could not be determined'
        : 'the latest discovery run has not completed';
      if (isEmpty(data)) {
        return { state: 'unavailable', reason: `${problem}, so an empty result is not a confirmed zero` };
      }
      return { state: 'partial', data, asOf: null, reason: `${problem}; data may be stale or incomplete` };
    });
  }

  /** Counts, severities, and resource types taken from the recorded findings -- no severity is assigned by category. */
  private async summarizeComplianceFindings(organizationId: string, resourcesEvaluated: number): Promise<ComplianceFindingsEvidence> {
    const rows = await this.awsResourcesRepo.getComplianceIssues(organizationId);
    const findingsBySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const categories = new Map<string, { findings: number; severities: Set<Severity>; resourceTypes: Set<string> }>();

    for (const row of rows) {
      for (const issue of row.issues ?? []) {
        const severity = issue.severity as Severity;
        if (severity in findingsBySeverity) findingsBySeverity[severity]++;
        const entry = categories.get(issue.category) ?? { findings: 0, severities: new Set<Severity>(), resourceTypes: new Set<string>() };
        entry.findings++;
        entry.severities.add(severity);
        entry.resourceTypes.add(String(row.resource_type));
        categories.set(issue.category, entry);
      }
    }

    const rank = (s: Severity) => SEVERITIES.indexOf(s);
    const byCategory = [...categories.entries()]
      .map(([category, e]) => ({
        category,
        findings: e.findings,
        highestSeverity: [...e.severities].sort((a, b) => rank(a) - rank(b))[0],
        resourceTypes: [...e.resourceTypes].sort(),
      }))
      .sort((a, b) => rank(a.highestSeverity) - rank(b.highestSeverity) || b.findings - a.findings)
      .slice(0, 5);

    return {
      resourcesEvaluated,
      resourcesWithFindings: rows.filter(r => (r.issues ?? []).length > 0).length,
      findingsBySeverity,
      byCategory,
    };
  }

  private fetchTopEstimatedResources(
    organizationId: string,
    discovery: ChatContext['discovery'],
    inventoryScope: ChatContext['inventoryScope']
  ): Promise<NonNullable<ReportData['sections']['topEstimatedResources']>> {
    return this.discoveryGated(
      {
        source: 'DevControl inventory cost estimates',
        provenance: 'estimated',
        scope: inventoryScope,
        period: { kind: 'point_in_time' },
        coverage: 'list-price monthly estimates for individual discovered resources -- not AWS billed spend',
      },
      discovery,
      rows => rows.length === 0,
      async () => {
        const result = await this.pool.query(
          `SELECT resource_id, resource_type, estimated_monthly_cost, resource_name
           FROM aws_resources
           WHERE organization_id = $1
           AND estimated_monthly_cost > 0
           AND status != 'terminated'
           ORDER BY estimated_monthly_cost DESC
           LIMIT 5`,
          [organizationId]
        );
        return result.rows.map(row => ({
          resourceId: row.resource_id,
          resourceType: row.resource_type,
          name: row.resource_name || row.resource_id,
          estimatedMonthlyCost: round(parseFloat(row.estimated_monthly_cost), 2),
        }));
      }
    );
  }

  private fetchIdleResourceRecommendations(
    organizationId: string,
    inventoryScope: ChatContext['inventoryScope']
  ): Promise<NonNullable<ReportData['sections']['idleResourceRecommendations']>> {
    return collectSection<IdleResourceRecommendations>(
      {
        source: 'DevControl cost recommendations',
        provenance: 'estimated',
        scope: inventoryScope,
        period: { kind: 'point_in_time' },
        coverage: 'the 10 active recommendations with the highest estimated savings, filtered to idle or unused resources',
      },
      async () => {
        const active = await this.costRecommendationsRepo.findAll(organizationId, { status: 'ACTIVE', limit: 10 });
        const items = active
          .filter(rec => rec.issue.toLowerCase().includes('idle') || rec.issue.toLowerCase().includes('unused'))
          .slice(0, 5)
          .map(rec => ({
            resourceId: rec.resource_id,
            resourceType: rec.resource_type,
            issue: rec.issue,
            estimatedMonthlySavings: round(Number(rec.potential_savings), 2),
          }));
        return {
          state: 'available',
          data: { items, totalEstimatedMonthlySavings: round(items.reduce((sum, i) => sum + i.estimatedMonthlySavings, 0), 2) },
          // An empty list is only "none recorded", never "nothing can be saved".
          reason: 'lists only active recommendations DevControl has recorded; savings are estimates of potential, not realized, savings',
        };
      }
    );
  }

  /**
   * Deployment counts for the report period (end exclusive), plus rates and
   * the average gap between successful deployments -- each derived from the
   * same records, never from a default.
   */
  private async fetchDeploymentSections(
    organizationId: string,
    dateRange: { from: string; to: string }
  ): Promise<Pick<ReportData['sections'], 'deployments' | 'deliveryRates' | 'timeBetweenDeployments'>> {
    const period: EvidencePeriod = { kind: 'range', start: dateRange.from, endExclusive: dateRange.to };
    const periodDays = Math.max(1, this.calculateDaysBetween(dateRange.from, dateRange.to));

    const records = await collectSection<DeploymentRecord[]>(
      { source: 'DevControl deployment records', provenance: 'actual', period, scope: { kind: 'organization', window: `${dateRange.from} to ${dateRange.to} (end exclusive)` } },
      async () => {
        const result = await this.pool.query(
          `SELECT d.service_id, d.status, d.deployed_at
           FROM deployments d
           JOIN services s ON d.service_id = s.id
           WHERE s.organization_id = $1
           AND d.deployed_at >= $2
           AND d.deployed_at < $3
           ORDER BY d.deployed_at`,
          [organizationId, dateRange.from, dateRange.to]
        );
        return {
          state: 'available',
          data: result.rows.map(r => ({ serviceId: String(r.service_id), status: r.status, deployedAt: new Date(r.deployed_at).toISOString() })),
          asOf: new Date().toISOString(),
        };
      }
    );

    // The counts are the same records, summarized -- same state and provenance.
    const deployments: ContextSection<DeploymentCounts> = hasEvidence(records)
      ? {
          ...records,
          data: {
            total: records.data.length,
            successful: records.data.filter(r => r.status === 'success').length,
            failed: records.data.filter(r => r.status === 'failed').length,
          },
        }
      : { ...records, data: null };

    const deliveryRates = await deriveSection(
      { source: 'DevControl calculation from deployment records', period },
      [deployments] as const,
      ([d]) => ({
        successRatePercent: d.total > 0 ? round((d.successful / d.total) * 100, 1) : null,
        changeFailureRatePercent: d.total > 0 ? round((d.failed / d.total) * 100, 1) : null,
        deploymentsPerDay: round(d.total / periodDays, 2),
      })
    );

    const intervals = hasEvidence(records) ? this.successfulDeploymentIntervals(records.data) : null;
    const timeBetweenDeployments = intervals && intervals.hours.length === 0
      ? await collectSection<TimeBetweenDeployments>(
          { source: 'DevControl calculation from deployment records', period },
          async () => ({ state: 'unavailable', reason: 'no service had two or more successful deployments in the report period' })
        )
      : await deriveSection(
          { source: 'DevControl calculation from deployment records', period },
          [records] as const,
          () => ({
            averageHours: round(intervals!.hours.reduce((a, b) => a + b, 0) / intervals!.hours.length, 1),
            intervalsMeasured: intervals!.hours.length,
            servicesMeasured: intervals!.services,
          })
        );

    return { deployments, deliveryRates, timeBetweenDeployments };
  }

  /** Hours between consecutive successful deployments of the same service (the report period only). */
  private successfulDeploymentIntervals(records: DeploymentRecord[]): { hours: number[]; services: number } {
    const byService = new Map<string, number[]>();
    for (const r of records) {
      if (r.status !== 'success') continue;
      const times = byService.get(r.serviceId) ?? [];
      times.push(new Date(r.deployedAt).getTime());
      byService.set(r.serviceId, times);
    }
    const hours: number[] = [];
    let services = 0;
    for (const times of byService.values()) {
      if (times.length < 2) continue;
      services++;
      times.sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) hours.push((times[i] - times[i - 1]) / 3_600_000);
    }
    return { hours, services };
  }

  /**
   * Helper: Calculate days between two dates
   */
  private calculateDaysBetween(from: string, to: string): number {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Helper: Convert by_type object to Record format
   */
  private convertByTypeToRecord(byType: any): Record<string, number> {
    const result: Record<string, number> = {};
    if (byType) {
      Object.entries(byType).forEach(([key, value]) => {
        result[key] = value as number;
      });
    }
    return result;
  }
}
