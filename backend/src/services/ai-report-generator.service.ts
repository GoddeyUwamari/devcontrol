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

import { Pool } from 'pg';
import {
  AI_CONTEXT_CONTRACT_VERSION,
  collectSection,
  deriveSection,
  EVIDENCE_CLAIM_RULES,
  hasEvidence,
  notEntitled,
  requireOrganizationId,
  toModelEvidence,
  type ContextSection,
  type EvidencePeriod,
} from './ai-context-contract';
import type { MonthOverMonthEvidence, SpendEvidence } from './cost-context-sections';
import { runModel, type Interpretation } from './ai/model-client';
import type { FallbackReason } from './ai/model-response';
import { collectEvidence, sectionOf } from './ai/evidence/registry';
import { defaultEvidenceRegistry } from './ai/evidence/providers';
import { canSeeLines, untrustedBlock, UNTRUSTED_TEXT_RULE } from './ai/evidence/render';
import type { EvidenceBundle } from './ai/evidence/types';
import type { ConfigChecksEvidence, AccountFindingsEvidence, RiskScoreEvidence, SecurityHubEvidence } from './ai/evidence/providers/security';
import type { CostFindingsEvidence, TopEstimatedResources } from './ai/evidence/providers/cost';
import type { ResourceCounts } from './ai/evidence/providers/inventory';
import type { AlarmsEvidence, CpuTelemetryEvidence, ResourceHealthEvidence } from './ai/evidence/providers/operations';
import type { CustomFrameworkScansEvidence, FrameworkEvaluationsEvidence } from './ai/evidence/providers/compliance';
import type { DeploymentRecordsEvidence } from './ai/evidence/providers/delivery';
import type { ConnectionScopeEvidence, RegionCoverageEvidence } from './ai/evidence/providers/scope';

type Severity = 'critical' | 'high' | 'medium' | 'low';
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

/** Configuration-check findings on discovered resources (security.config_checks). */
export type ComplianceFindingsEvidence = ConfigChecksEvidence;

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
  /**
   * priceKnown false: the figure is DevControl's default for an EC2 instance
   * type whose price is unknown (metadata.price_source), not a price.
   */
  items: Array<{ resourceId: string; resourceType: string; issue: string; estimatedMonthlySavings: number; priceKnown: boolean }>;
  totalEstimatedMonthlySavings: number;
}

/** The evidence one report is written from. A section absent here was not requested for this report type. */
export interface ReportData {
  organizationId: string;
  reportType: string;
  /** The requested report period; `to` is exclusive (matching the deployment query). */
  dateRange: { from: string; to: string };
  sections: {
    connection?: ContextSection<ConnectionScopeEvidence>;
    regions?: ContextSection<RegionCoverageEvidence>;
    spend?: ContextSection<SpendEvidence>;
    monthOverMonth?: ContextSection<MonthOverMonthEvidence>;
    topEstimatedResources?: ContextSection<TopEstimatedResources>;
    idleResourceRecommendations?: ContextSection<IdleResourceRecommendations>;
    resourceInventory?: ContextSection<ResourceCounts>;
    resourceChange?: ContextSection<never>;
    securityFindings?: ContextSection<ComplianceFindingsEvidence>;
    accountSecurityFindings?: ContextSection<AccountFindingsEvidence>;
    securityScore?: ContextSection<RiskScoreEvidence>;
    securityHub?: ContextSection<SecurityHubEvidence>;
    complianceEvaluations?: ContextSection<FrameworkEvaluationsEvidence>;
    customComplianceScans?: ContextSection<CustomFrameworkScansEvidence>;
    deployments?: ContextSection<DeploymentCounts>;
    deliveryRates?: ContextSection<DeliveryRates>;
    timeBetweenDeployments?: ContextSection<TimeBetweenDeployments>;
    cloudwatchAlarms?: ContextSection<AlarmsEvidence>;
    operationalHealth?: ContextSection<ResourceHealthEvidence>;
    cpuTelemetry?: ContextSection<CpuTelemetryEvidence>;
    alertHistory?: ContextSection<never>;
  };
  /** Every evidence source's state (the registry bundle); absent only in hand-built test data. */
  evidence?: EvidenceBundle;
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
    /**
     * Set by DevControl, never by the model: true when estimatedSavings is the
     * amount of an idle-resource item whose price is unknown (priceKnown
     * false, metadata.price_source = the EC2 default). The report page then
     * shows the approved "(price unknown)" suffix after it.
     */
    estimatedSavingsPriceUnknown?: boolean;
    effort: 'low' | 'medium' | 'high';
  }>;
  executiveSummary: string;
}

export interface GeneratedReportResult {
  report: GeneratedReport;
  /** True when the deterministic template was used instead of the model. */
  wasFallback: boolean;
  /** Why the template was used (model-response.ts); null when the model's report was used. */
  fallbackReason: FallbackReason | null;
}

/** Stored with the report in report_data.meta -- set by DevControl, never by the model. */
export interface GeneratedReportMeta {
  wasFallback: boolean;
  fallbackReason: FallbackReason | null;
}

const IMPACTS = ['high', 'medium', 'low'] as const;
const EFFORTS = ['low', 'medium', 'high'] as const;
const STRING_ARRAY = { type: 'array', items: { type: 'string' } } as const;

function analysisSchema(detailField: 'trends' | 'topRisks' | 'doraMetrics'): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { overview: { type: 'string' }, [detailField]: { type: 'string' }, recommendations: STRING_ARRAY },
    required: ['overview', detailField, 'recommendations'],
  };
}

/**
 * The report's JSON shape, sent as output_config.format (structured output)
 * and enforced again by parseGeneratedReport(). Only the fields the report
 * page renders; estimatedSavingsPriceUnknown is set by DevControl, never here.
 */
export const REPORT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    keyHighlights: STRING_ARRAY,
    costAnalysis: analysisSchema('trends'),
    securityAnalysis: analysisSchema('topRisks'),
    performanceAnalysis: analysisSchema('doraMetrics'),
    topRecommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          impact: { type: 'string', enum: [...IMPACTS] },
          description: { type: 'string' },
          estimatedSavings: { type: 'number' },
          effort: { type: 'string', enum: [...EFFORTS] },
        },
        required: ['title', 'impact', 'description', 'effort'],
      },
    },
    executiveSummary: { type: 'string' },
  },
  required: ['summary', 'keyHighlights', 'topRecommendations', 'executiveSummary'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

type Analysis<K extends string> = { overview: string; recommendations: string[] } & Record<K, string>;

function parseAnalysis<K extends 'trends' | 'topRisks' | 'doraMetrics'>(value: unknown, detail: K): Analysis<K> | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.overview !== 'string' || typeof value[detail] !== 'string' || !isStringArray(value.recommendations)) return 'invalid';
  return { overview: value.overview, [detail]: value[detail], recommendations: value.recommendations } as Analysis<K>;
}

/**
 * The model's report, or null when its text is not exactly one report object
 * of REPORT_OUTPUT_SCHEMA's shape. The whole text must be the JSON (one
 * surrounding code fence is tolerated); only known fields are copied, so the
 * model cannot add fields such as meta or estimatedSavingsPriceUnknown.
 */
export function parseGeneratedReport(text: string): GeneratedReport | null {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?[ \t]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  let raw: unknown;
  try {
    raw = JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (typeof raw.summary !== 'string' || typeof raw.executiveSummary !== 'string' || !isStringArray(raw.keyHighlights) || !Array.isArray(raw.topRecommendations)) return null;

  const recommendations: GeneratedReport['topRecommendations'] = [];
  for (const item of raw.topRecommendations) {
    if (!isRecord(item)) return null;
    const { title, impact, description, effort, estimatedSavings } = item;
    if (typeof title !== 'string' || typeof description !== 'string') return null;
    if (!(IMPACTS as readonly unknown[]).includes(impact) || !(EFFORTS as readonly unknown[]).includes(effort)) return null;
    if (estimatedSavings !== undefined && estimatedSavings !== null && (typeof estimatedSavings !== 'number' || !Number.isFinite(estimatedSavings))) return null;
    recommendations.push({
      title,
      impact: impact as GeneratedReport['topRecommendations'][number]['impact'],
      description,
      effort: effort as GeneratedReport['topRecommendations'][number]['effort'],
      ...(typeof estimatedSavings === 'number' ? { estimatedSavings } : {}),
    });
  }

  const cost = parseAnalysis(raw.costAnalysis, 'trends');
  const security = parseAnalysis(raw.securityAnalysis, 'topRisks');
  const performance = parseAnalysis(raw.performanceAnalysis, 'doraMetrics');
  if (cost === 'invalid' || security === 'invalid' || performance === 'invalid') return null;

  return {
    summary: raw.summary,
    keyHighlights: raw.keyHighlights,
    ...(cost ? { costAnalysis: cost } : {}),
    ...(security ? { securityAnalysis: security } : {}),
    ...(performance ? { performanceAnalysis: performance } : {}),
    topRecommendations: recommendations,
    executiveSummary: raw.executiveSummary,
  };
}

const SECTION_TITLES: Record<keyof ReportData['sections'], string> = {
  connection: 'Connected AWS account',
  regions: 'AWS regions and scan coverage',
  spend: 'Cloud spend',
  monthOverMonth: 'Month-over-month cost comparison',
  topEstimatedResources: 'Highest estimated-cost discovered resources',
  idleResourceRecommendations: 'Active idle/unused-resource recommendations',
  resourceInventory: 'Discovered resource inventory',
  resourceChange: 'Resource changes over the report period',
  securityFindings: 'Configuration-check findings on discovered resources',
  accountSecurityFindings: 'Account security findings (security groups, IAM)',
  securityScore: 'DevControl security posture score (calculated) and its daily history',
  securityHub: 'AWS Security Hub',
  complianceEvaluations: 'Compliance framework evaluations',
  customComplianceScans: 'Custom compliance framework scans',
  deployments: 'Deployments recorded in the report period',
  deliveryRates: 'Deployment rates',
  timeBetweenDeployments: 'Average time between successful deployments of the same service (NOT DORA lead time)',
  cloudwatchAlarms: 'CloudWatch alarms (current state)',
  operationalHealth: 'Operational Health resource checks',
  cpuTelemetry: 'EC2 CPU utilization (CloudWatch)',
  alertHistory: 'Alert history (past alerts)',
};

/** Which section each registry provider fills (the report's own section names are kept). */
const SECTION_PROVIDERS: Partial<Record<keyof ReportData['sections'], string>> = {
  connection: 'connection.scope',
  regions: 'coverage.regions',
  spend: 'cost.spend',
  monthOverMonth: 'cost.month_over_month',
  topEstimatedResources: 'cost.top_estimated_resources',
  resourceInventory: 'inventory.resource_counts',
  resourceChange: 'inventory.change_history',
  securityFindings: 'security.config_checks',
  accountSecurityFindings: 'security.account_findings',
  securityScore: 'security.risk_score',
  securityHub: 'security.security_hub',
  complianceEvaluations: 'compliance.framework_evaluations',
  customComplianceScans: 'compliance.custom_scans',
  cloudwatchAlarms: 'ops.cloudwatch_alarms',
  operationalHealth: 'ops.resource_health',
  cpuTelemetry: 'telemetry.cpu',
  alertHistory: 'alerts.history',
};

type SectionKey = keyof ReportData['sections'];
const COMMON_SECTIONS: SectionKey[] = ['connection', 'regions'];
const COST_SECTIONS: SectionKey[] = ['spend', 'monthOverMonth'];
const RESOURCE_SECTIONS: SectionKey[] = ['resourceInventory', 'topEstimatedResources', 'idleResourceRecommendations', 'resourceChange'];
const SECURITY_SECTIONS: SectionKey[] = ['securityFindings', 'accountSecurityFindings', 'securityScore', 'securityHub', 'complianceEvaluations', 'customComplianceScans'];
const DELIVERY_SECTIONS: SectionKey[] = ['deployments', 'deliveryRates', 'timeBetweenDeployments'];
const OPERATIONS_SECTIONS: SectionKey[] = ['cloudwatchAlarms', 'operationalHealth', 'cpuTelemetry', 'alertHistory'];

/** The sections each report type is written from (its topic set). */
export const REPORT_SECTIONS: Record<string, SectionKey[]> = {
  cost_analysis: [...COMMON_SECTIONS, ...COST_SECTIONS, ...RESOURCE_SECTIONS],
  security_insights: [...COMMON_SECTIONS, ...SECURITY_SECTIONS],
  infrastructure_health: [...COMMON_SECTIONS, ...DELIVERY_SECTIONS, ...RESOURCE_SECTIONS, ...OPERATIONS_SECTIONS],
  executive_summary: [...COMMON_SECTIONS, ...COST_SECTIONS, ...RESOURCE_SECTIONS, ...SECURITY_SECTIONS, ...DELIVERY_SECTIONS, ...OPERATIONS_SECTIONS],
};
const ALL_SECTIONS = REPORT_SECTIONS.executive_summary;

/** Evidence budget for one report, in estimated tokens (step1 §2.5). */
export const REPORT_EVIDENCE_BUDGET_TOKENS = 30_000;

const PROMPT_RULES = [
  'Cost figures have their own period (month-to-date billed spend, or a point-in-time monthly run-rate estimate), which may differ from the requested report period -- always state which one a figure is.',
  'Never state a previous-period cost, a trend, or a percentage change unless the month-over-month comparison section carries evidence. Never invent history.',
  'The security posture score is calculated by DevControl from its own checks: call it a calculated score, and describe a change only from its own daily history. Configuration-check results are overwritten on every scan, so there is no earlier configuration-check result to compare.',
  'Resource changes over the period are not tracked: do not describe resource growth or decline.',
  '"Average time between successful deployments" is not DORA lead time for changes: never call it lead time.',
  'CloudWatch alarms and Operational Health checks are current-state readings at their as-of time, not a history for the report period. There is no alert history: never say there were no alerts during the period, and never call an alarm count of 0 "no incidents".',
  'Configuration-check and account-level findings cover only DevControl\'s own checks: no findings means none from those checks, not that no security issues exist. An accepted-risk or dismissed finding is still active; say it was accepted or dismissed by the customer.',
  'Recommend only actions grounded in the supplied evidence. Do not recommend rightsizing, Reserved Instances, or Savings Plans unless a supplied recommendation says so.',
  'Savings are DevControl estimates of potential savings, never realized savings. In topRecommendations, set estimatedSavings only to a value copied from the idle/unused-resource recommendation evidence; otherwise omit the field.',
  'An idle/unused-resource item with priceKnown: false carries a DevControl default figure, used because the instance type\'s price is unknown. Never present that amount as a known price or as the instance\'s cost; wherever you mention it, say the price is unknown.',
  'When a section has no evidence, say that data is not available in the relevant analysis -- do not fill it in.',
  UNTRUSTED_TEXT_RULE,
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
  constructor(private pool: Pool) {}

  async generateWeeklyReport(data: ReportData, reportType: string = 'weekly_summary'): Promise<GeneratedReportResult> {
    const result = await runModel(
      'report',
      'ai_reports',
      {
        system: this.buildSystemPrompt(reportType),
        messages: [{ role: 'user', content: this.buildUserPrompt(data, reportType) }],
        jsonSchema: REPORT_OUTPUT_SCHEMA,
      },
      (outcome): Interpretation<GeneratedReport> => {
        if (outcome.kind === 'tool') return { ok: false, reason: 'unexpected_tool' };
        const parsed = parseGeneratedReport(outcome.text);
        return parsed ? { ok: true, value: parsed } : { ok: false, reason: 'malformed_output' };
      }
    );

    if (result.ok) {
      return { report: this.stripUngroundedSavings(result.value, data), wasFallback: false, fallbackReason: null };
    }
    return { report: this.generateFallbackReport(data), wasFallback: true, fallbackReason: result.reason };
  }

  /** The model-facing request: every section as toModelEvidence() JSON, plus the claim rules. */
  buildUserPrompt(data: ReportData, reportType: string): string {
    const sections = (Object.keys(data.sections) as Array<keyof ReportData['sections']>)
      .map(name => {
        const section = data.sections[name] as ContextSection<unknown>;
        const untrusted = section.untrusted ?? [];
        const fence = untrusted.length > 0 && section.data !== null ? `\n${untrustedBlock(SECTION_PROVIDERS[name] ?? name, untrusted)}` : '';
        return `### ${SECTION_TITLES[name]}\n${JSON.stringify(toModelEvidence(section))}${fence}`;
      })
      .join('\n\n');
    const sources = data.evidence ? canSeeLines(data.evidence.results) : null;
    const sourceLines = sources
      ? `\nEVERY EVIDENCE SOURCE DEVCONTROL HAS, with its state (sections below carry the data of the ones this report uses):\nWhat DevControl can see:\n${sources.canSee.join('\n') || '- (none)'}\nWhat DevControl can't see:\n${sources.cantSee.join('\n') || '- (none)'}\n`
      : '';

    return `Generate a ${this.buildReportLabel(reportType)}. Requested report period: ${data.dateRange.from} to ${data.dateRange.to} (end date exclusive).
${sourceLines}
EVIDENCE (contract version ${AI_CONTEXT_CONTRACT_VERSION}): each section below is JSON with its state (available / partial / stale / unavailable / not_connected / error / not_entitled / not_built), whether evidence is present, its classification (billed / measured / calculated / estimated / configured / customer_decision), source, scope, period, asOf (when it was observed), retrievedAt (when DevControl read it), freshness, completeness, coverage, reason, failure, truncation, and data. The meaning of each state and classification is included with it. AWS or customer text follows a section in an <untrusted_evidence> block.

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
    "overview": "security and compliance evidence (configuration checks, account-level findings, the posture score, frameworks), with what each covers",
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

FOCUS: DevControl security evidence: configuration checks on discovered resources, account-level findings (security groups, IAM) with the customer's dispositions, the calculated security posture score, framework evaluations, and Security Hub when present.
- Lead with the most severe findings present in the evidence
- Map each finding category present to a concrete remediation action
- Rank recommendations by the severity recorded in the evidence (critical, high, medium, low)`;

      case 'infrastructure_health':
        return `${base}

FOCUS: Deployment activity, the resource inventory, and the current operational state supplied.
- Lead with the deployment evidence for the report period
- CloudWatch alarms and Operational Health checks are current-state readings at their as-of time; describe them as such, never as availability or error rates over the period`;

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
    return this.markDefaultPriceSavings({
      ...report,
      topRecommendations: (report.topRecommendations ?? []).map(rec => {
        if (rec.estimatedSavings === undefined || rec.estimatedSavings === null) return rec;
        if (allowed.has(round(Number(rec.estimatedSavings), 2))) return rec;
        const { estimatedSavings: _dropped, ...rest } = rec;
        return rest;
      }),
    }, data);
  }

  /**
   * A cited estimatedSavings equal to the amount of an item whose price is
   * unknown (priceKnown false) is marked estimatedSavingsPriceUnknown, so the
   * report page labels it rather than showing a default as a known price.
   * Keyed on priceKnown (metadata.price_source), never on the amount: a
   * genuine list price of the same amount is not marked unless a default
   * item has that amount too -- then the citation can't be told apart, and
   * it is labelled. Any value the model supplied for the flag is discarded.
   * Totals are unchanged (decision D4).
   */
  private markDefaultPriceSavings(report: GeneratedReport, data: ReportData): GeneratedReport {
    const recs = data.sections.idleResourceRecommendations;
    const defaultAmounts = new Set<number>();
    if (recs && hasEvidence(recs)) {
      recs.data.items.filter(item => !item.priceKnown).forEach(item => defaultAmounts.add(round(item.estimatedMonthlySavings, 2)));
    }
    return {
      ...report,
      topRecommendations: (report.topRecommendations ?? []).map(rec => {
        const { estimatedSavingsPriceUnknown: _modelValue, ...rest } = rec;
        if (rest.estimatedSavings === undefined || rest.estimatedSavings === null) return rest;
        return defaultAmounts.has(round(Number(rest.estimatedSavings), 2)) ? { ...rest, estimatedSavingsPriceUnknown: true } : rest;
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

  private postureScoreSentence(section: ContextSection<RiskScoreEvidence> | undefined): string {
    if (!section) return '';
    if (!hasEvidence(section)) return ` The security posture score is not available: ${unavailablePhrase(section)}.`;
    return ` DevControl's calculated security posture score is ${section.data.score}/100 (grade ${section.data.grade}).`;
  }

  private accountFindingsSentence(section: ContextSection<AccountFindingsEvidence>): string {
    if (!hasEvidence(section)) return `Account-level security findings are not available: ${unavailablePhrase(section)}.`;
    const d = section.data;
    if (d.total === 0) return "DevControl's account-level checks (security groups, IAM) found no active findings.";
    const counts = SEVERITIES.map(sev => `${d.bySeverity[sev]} ${sev}`).join(', ');
    const reviewed = d.byDisposition.accepted_risk + d.byDisposition.dismissed;
    const reviewedText = reviewed > 0 ? `; ${reviewed} of these are marked as accepted risk or dismissed by your team` : '';
    return `DevControl's account-level checks (security groups, IAM) found ${d.total} active findings (${counts})${reviewedText}.`;
  }

  private alarmsSentence(section: ContextSection<AlarmsEvidence>): string {
    if (!hasEvidence(section)) return `CloudWatch alarm status is not available: ${unavailablePhrase(section)}.`;
    const d = section.data;
    const region = section.scope?.kind === 'aws_account_region' && section.scope.region ? ` in ${section.scope.region}` : '';
    const atLeast = d.inAlarmComplete ? '' : 'at least ';
    return `CloudWatch reported ${atLeast}${d.inAlarmCount} alarm${d.inAlarmCount !== 1 ? 's' : ''} in ALARM${region} as of ${section.asOf ?? 'an unknown time'} (current state, not a history for the period).`;
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
        overview: `${security}${this.postureScoreSentence(s.securityScore)} Earlier configuration-check results are not kept.`,
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

    if (s.accountSecurityFindings) {
      highlights.push(this.accountFindingsSentence(s.accountSecurityFindings));
    }

    if (s.cloudwatchAlarms) {
      highlights.push(this.alarmsSentence(s.cloudwatchAlarms));
    }

    report.summary = highlights.slice(0, 3).join(' ');
    report.executiveSummary = highlights.join(' ');
    return this.markDefaultPriceSavings(report, data);
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
    wasFallback: boolean = false,
    fallbackReason: FallbackReason | null = null
  ): Promise<string> {
    const meta: GeneratedReportMeta = { wasFallback, fallbackReason: wasFallback ? fallbackReason : null };
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
          JSON.stringify({ ...report, meta }),
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
  // Evidence (the shared evidence registry, services/ai/evidence/)
  // -------------------------------------------------------------------------

  async fetchReportData(
    organizationId: string,
    dateRange: { from: string; to: string },
    reportType: string = 'weekly_summary'
  ): Promise<ReportData> {
    requireOrganizationId(organizationId, 'AI Reports', 'report evidence');
    const fetchStart = Date.now();
    console.log(`[AI Report Generator] Fetching data... (org=${organizationId}, type=${reportType}, range=${dateRange.from}→${dateRange.to})`);

    const wanted = REPORT_SECTIONS[reportType] ?? ALL_SECTIONS;
    const providerIds = wanted.map(key => SECTION_PROVIDERS[key]).filter((id): id is string => !!id);
    if (wanted.includes('idleResourceRecommendations')) providerIds.push('cost.findings');
    if (wanted.includes('deployments')) providerIds.push('delivery.deployments', 'delivery.dora');

    // Every provider runs (so the prompt states every source's state); the
    // report's sections load data.
    const evidence = await collectEvidence(defaultEvidenceRegistry(), {
      organizationId,
      consumer: 'ai_reports',
      select: { providerIds },
      budgetTokens: REPORT_EVIDENCE_BUDGET_TOKENS,
      period: dateRange,
    });

    const sections: ReportData['sections'] = {};
    for (const key of wanted) {
      const providerId = SECTION_PROVIDERS[key];
      if (providerId) (sections as Record<string, ContextSection<unknown>>)[key] = sectionOf(evidence, providerId);
    }
    if (wanted.includes('idleResourceRecommendations')) {
      sections.idleResourceRecommendations = await this.idleRecommendationsFrom(sectionOf<CostFindingsEvidence>(evidence, 'cost.findings'));
    }
    if (wanted.includes('deployments')) {
      Object.assign(sections, await this.deliverySectionsFrom(
        sectionOf<DeploymentRecordsEvidence>(evidence, 'delivery.deployments'),
        sectionOf<unknown>(evidence, 'delivery.dora'),
        dateRange
      ));
    }

    const states = (Object.keys(sections) as Array<keyof ReportData['sections']>).map(k => `${k}=${sections[k]!.state}`).join(', ');
    console.log(`[AI Report Generator] Evidence gathered in ${Date.now() - fetchStart}ms: ${states}`);

    return { organizationId, reportType, dateRange, sections, evidence };
  }

  /**
   * The idle/unused-resource subset of the cost findings the report's savings
   * are grounded in: of the 10 active findings with the highest estimated
   * savings, those for idle or unused resources whose figure is an estimate
   * (a ceiling, or a figure with no savings basis, is never "estimated savings").
   */
  private idleRecommendationsFrom(findings: ContextSection<CostFindingsEvidence>): Promise<ContextSection<IdleResourceRecommendations>> {
    const meta = {
      source: 'DevControl cost recommendations',
      classification: 'estimated' as const,
      scope: findings.scope,
      period: { kind: 'point_in_time' } as EvidencePeriod,
      coverage: 'the 10 active recommendations with the highest estimated savings, filtered to idle or unused resources',
    };
    if (!hasEvidence(findings)) {
      return Promise.resolve({ ...findings, source: meta.source, coverage: meta.coverage, data: null });
    }
    return collectSection<IdleResourceRecommendations>(meta, async () => {
      const items = findings.data.items
        .slice(0, 10)
        .filter(rec => rec.issue.toLowerCase().includes('idle') || rec.issue.toLowerCase().includes('unused'))
        .filter(rec => rec.savingsBasis === 'estimate')
        .slice(0, 5)
        .map(rec => ({
          resourceId: rec.resourceId,
          resourceType: rec.resourceType,
          issue: rec.issue,
          estimatedMonthlySavings: rec.estimatedMonthlySavings,
          priceKnown: rec.priceKnown,
        }));
      const baseReason = 'lists only active recommendations DevControl has recorded; savings are estimates of potential, not realized, savings';
      return {
        state: 'available',
        asOf: findings.asOf,
        data: { items, totalEstimatedMonthlySavings: round(items.reduce((sum, i) => sum + i.estimatedMonthlySavings, 0), 2) },
        // An empty list is only "none recorded", never "nothing can be saved".
        // A default figure (priceKnown false) is never a known price (PR 4, S4).
        reason: items.some((i) => !i.priceKnown)
          ? `${baseReason}; some idle-instance figures use a default because the instance type's price is unknown`
          : baseReason,
      };
    });
  }

  /**
   * Deployment counts for the report period (end exclusive), plus rates and
   * the average gap between successful deployments -- each derived from the
   * same records, never from a default. The rates are DORA metrics, so they
   * follow the DORA plan entitlement: below it they are not_entitled.
   */
  private async deliverySectionsFrom(
    records: ContextSection<DeploymentRecordsEvidence>,
    dora: ContextSection<unknown>,
    dateRange: { from: string; to: string }
  ): Promise<Pick<ReportData['sections'], 'deployments' | 'deliveryRates' | 'timeBetweenDeployments'>> {
    const period: EvidencePeriod = { kind: 'range', start: dateRange.from, endExclusive: dateRange.to };

    const deployments: ContextSection<DeploymentCounts> = hasEvidence(records)
      ? { ...records, data: { total: records.data.total, successful: records.data.successful, failed: records.data.failed } }
      : { ...records, data: null };

    const periodDays = hasEvidence(records) ? records.data.periodDays : 1;
    const deliveryRates = dora.state === 'not_entitled'
      ? notEntitled<DeliveryRates>({ source: 'DevControl calculation from deployment records', period }, dora.reason ?? "not included in this organization's current plan")
      : await deriveSection(
          { source: 'DevControl calculation from deployment records', period },
          [deployments] as const,
          ([d]) => ({
            successRatePercent: d.total > 0 ? round((d.successful / d.total) * 100, 1) : null,
            changeFailureRatePercent: d.total > 0 ? round((d.failed / d.total) * 100, 1) : null,
            deploymentsPerDay: round(d.total / periodDays, 2),
          })
        );

    const intervals = hasEvidence(records) ? records.data.successfulIntervals : null;
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
            servicesMeasured: intervals!.servicesMeasured,
          })
        );

    return { deployments, deliveryRates, timeBetweenDeployments };
  }
}
