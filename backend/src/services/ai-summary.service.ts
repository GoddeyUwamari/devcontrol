/**
 * AI Summary Service
 * Composes real, already-computed dashboard data (System Intelligence score,
 * security posture, top finding, cost recommendations, active anomalies) into a
 * fact-only prompt and asks Claude (via AIInsightsService) to turn it into a short
 * plain-English summary. Never fabricates — any field that isn't available is
 * simply omitted from the facts list, and the whole summary is null if nothing
 * real is available to say.
 *
 * Cached per-org, keyed on a JSON digest of every dynamic value that actually gets
 * baked into the generated prose — composite/component System Intelligence scores,
 * security posture score, account-level + resource compliance finding counts, the
 * top finding, active cost-recommendation count + savings, critical anomaly count,
 * monthly spend, and cost delta — with a 4h TTL ceiling as a defensive fallback. Each
 * of these moves on its own cadence (anomaly detection every 15m, alert sync every
 * 1m, the manual "Analyze Costs" action, a daily-refreshed risk score, cost data on
 * its own cadence) fully decoupled from the resource-discovery scan this used to be
 * keyed on alone — so nothing here can go stale for longer than a real fact change
 * takes to next be observed, up to the TTL ceiling.
 */

import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { AIInsightsService, StructuredDashboardSummary } from './ai-insights.service';
import { SystemIntelligenceService, SystemIntelligenceResult } from './system-intelligence.service';
import { RiskTrackingService } from './risk-tracking.service';
import { RiskScore } from '../utils/riskScoring';
import { AccountSecurityFindingsRepository, AccountSecurityFinding } from '../repositories/account-security-findings.repository';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';

const EMPTY_FIELDS: StructuredDashboardSummary = {
  overallHealth: { score: null, context: null },
  topRisk: null,
  cloudSpend: null,
  systemStatus: null,
};

export interface AISummaryResult extends StructuredDashboardSummary {
  generatedAt: string;
}

interface CacheEntry {
  fields: StructuredDashboardSummary;
  factsKey: string;
  timestamp: number;
}

interface DashboardFacts {
  intelligence: SystemIntelligenceResult;
  riskScore: RiskScore;
  activeFindings: AccountSecurityFinding[];
  costStats: { active_recommendations: number; total_potential_savings: number };
  criticalAnomalies: number;
  costDeltaPct: number | null;
}

export class AISummaryService {
  private aiInsightsService = new AIInsightsService(pool);
  private systemIntelligenceService = new SystemIntelligenceService();
  private riskTrackingService = new RiskTrackingService(pool);
  private accountFindingsRepository = new AccountSecurityFindingsRepository();
  private costRecommendationsRepository = new CostRecommendationsRepository();

  private cache: Map<string, CacheEntry> = new Map();
  private static readonly CACHE_TTL_CEILING = 4 * 60 * 60 * 1000; // 4h

  private async withOrgClient<T>(
    organizationId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );
      return await fn(client);
    } finally {
      client.release();
    }
  }

  private async getLatestScanCompletedAt(organizationId: string): Promise<string | null> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `SELECT completed_at FROM resource_discovery_jobs
         WHERE organization_id = $1 AND status = 'completed'
         ORDER BY completed_at DESC LIMIT 1`,
        [organizationId]
      );
      const completedAt = result.rows[0]?.completed_at;
      return completedAt ? new Date(completedAt).toISOString() : null;
    });
  }

  private async getCriticalAnomalyCount(organizationId: string): Promise<number> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `SELECT COUNT(*) as count FROM anomaly_detections
         WHERE organization_id = $1 AND severity = 'critical' AND status = 'active'`,
        [organizationId]
      );
      return parseInt(result.rows[0]?.count ?? '0', 10);
    });
  }

  /**
   * Get the cached summary if every dynamic value referenced in the prose is
   * unchanged from the cached run — otherwise regenerate and cache. Values are
   * rounded/normalized to the precision actually shown in the generated text (e.g.
   * $ whole number, 1 decimal %) so this doesn't regenerate on noise smaller than
   * what a user could ever see change.
   */
  async getSummary(organizationId: string, costDeltaPct?: number | null): Promise<AISummaryResult> {
    const scanCompletedAt = await this.getLatestScanCompletedAt(organizationId);
    const normalizedCostDeltaPct = costDeltaPct ?? null;

    let fields: StructuredDashboardSummary;
    let factsKey: string;

    try {
      const [intelligence, riskScore, activeFindings, costStats, criticalAnomalies] = await Promise.all([
        this.systemIntelligenceService.getSystemIntelligence(organizationId),
        this.riskTrackingService.getCurrentRiskScore(organizationId),
        this.accountFindingsRepository.getActive(organizationId),
        this.costRecommendationsRepository.getStats(organizationId),
        this.getCriticalAnomalyCount(organizationId),
      ]);

      const facts: DashboardFacts = {
        intelligence,
        riskScore,
        activeFindings,
        costStats,
        criticalAnomalies,
        costDeltaPct: normalizedCostDeltaPct,
      };

      factsKey = JSON.stringify({ scanCompletedAt, ...this.extractKeyFacts(facts) });

      const cached = this.cache.get(organizationId);
      if (
        cached &&
        cached.factsKey === factsKey &&
        Date.now() - cached.timestamp < AISummaryService.CACHE_TTL_CEILING
      ) {
        return { ...cached.fields, generatedAt: new Date(cached.timestamp).toISOString() };
      }

      fields = await this.buildSummary(facts);
    } catch (error: any) {
      console.error('[AI Summary] Error generating summary:', error.message);
      fields = EMPTY_FIELDS;
      factsKey = JSON.stringify({ scanCompletedAt, costDeltaPct: normalizedCostDeltaPct, error: true });
    }

    const timestamp = Date.now();
    this.cache.set(organizationId, { fields, factsKey, timestamp });
    return { ...fields, generatedAt: new Date(timestamp).toISOString() };
  }

  /**
   * Pull out exactly the values `buildSummary()` below turns into prose, rounded to
   * the precision actually shown, as a plain object suitable for JSON-digesting into
   * the cache key.
   */
  private extractKeyFacts(facts: DashboardFacts) {
    const { intelligence, riskScore, activeFindings, costStats, criticalAnomalies, costDeltaPct } = facts;
    const topFinding = activeFindings[0] ?? null;

    let accountLevelCount: number | null = null;
    let resourceComplianceCount: number | null = null;
    if (!riskScore.isPreliminary) {
      const c = riskScore.complianceIssueCounts;
      const totalCombined = c.critical + c.high + c.medium + c.low;
      accountLevelCount = activeFindings.length;
      resourceComplianceCount = totalCombined - accountLevelCount;
    }

    return {
      systemScore: intelligence.system_score,
      costScore: intelligence.components.cost.score,
      securityScore: intelligence.components.security.score,
      observabilityScore: intelligence.components.observability.score,
      monthlySpendRounded: intelligence.components.cost.monthlySpend != null
        ? Math.round(intelligence.components.cost.monthlySpend)
        : null,
      costDeltaPct,
      riskScore: riskScore.isPreliminary ? null : riskScore.score,
      accountLevelCount,
      resourceComplianceCount,
      topFindingKey: topFinding ? `${topFinding.title}|${topFinding.severity}` : null,
      activeRecommendations: costStats.active_recommendations,
      totalPotentialSavingsRounded: Math.round(costStats.total_potential_savings),
      criticalAnomalies,
    };
  }

  private async buildSummary(facts: DashboardFacts): Promise<StructuredDashboardSummary> {
    try {
      const { intelligence, riskScore, activeFindings, costStats, criticalAnomalies, costDeltaPct } = facts;

      // Reuse the monthly spend system-intelligence already fetched (live Cost
      // Explorer, falling back to the DB estimate) instead of independently
      // re-calling Cost Explorer for the same org.
      const monthlySpend = intelligence.components.cost.monthlySpend;

      // Highest-severity active finding — AccountSecurityFindingsRepository.getActive()
      // (unfiltered, no limit) already sorts the full result set by severity in JS, so
      // [0] here is genuinely the most severe finding, not just the most recent one.
      const topFinding = activeFindings[0] ?? null;

      const factLines: string[] = [];

      if (intelligence.system_score != null) {
        factLines.push(
          `Composite System Intelligence score: ${intelligence.system_score}/100 ` +
          `(Cost ${intelligence.components.cost.score}, Security ${intelligence.components.security.score}, ` +
          `Observability ${intelligence.components.observability.score}).`
        );
      }

      if (!riskScore.isPreliminary) {
        // riskScore.complianceIssueCounts is account-level findings (security groups,
        // IAM — the account_security_findings table) combined with per-resource
        // compliance issues (encryption/backup/tagging/SOC2/HIPAA checks stored on
        // aws_resources) — see RiskTrackingService.combineSeverityCounts(). Reporting
        // only the combined total as "N active findings" reads as one homogeneous
        // metric when it's actually two different things from two different scanners;
        // report them separately instead. activeFindings.length is the real
        // account-level count; the resource-level count is recovered by subtracting
        // it from the combined total (combineSeverityCounts is a plain per-field sum,
        // so this is exact, not an estimate).
        const c = riskScore.complianceIssueCounts;
        const totalCombined = c.critical + c.high + c.medium + c.low;
        const accountLevelCount = activeFindings.length;
        const resourceComplianceCount = totalCombined - accountLevelCount;
        factLines.push(
          `Security posture score: ${riskScore.score}/100 — ${accountLevelCount} account-level ` +
          `finding${accountLevelCount !== 1 ? 's' : ''} (security groups, IAM) and ` +
          `${resourceComplianceCount} resource compliance issue${resourceComplianceCount !== 1 ? 's' : ''} ` +
          `(encryption, backups, tagging, SOC2/HIPAA checks) currently active.`
        );
      }

      if (topFinding) {
        factLines.push(`Top active finding: "${topFinding.title}" (severity: ${topFinding.severity}).`);
      }

      if (costStats.active_recommendations > 0) {
        factLines.push(
          `${costStats.active_recommendations} active cost optimization` +
          `${costStats.active_recommendations !== 1 ? 's' : ''} could save approximately ` +
          `$${Math.round(costStats.total_potential_savings).toLocaleString()}/month.`
        );
      }

      factLines.push(
        criticalAnomalies > 0
          ? `${criticalAnomalies} critical outage${criticalAnomalies !== 1 ? 's are' : ' is'} currently active.`
          : 'No critical outages are currently active.'
      );

      if (monthlySpend != null && monthlySpend > 0) {
        factLines.push(
          costDeltaPct != null
            ? `Current monthly cloud spend is $${Math.round(monthlySpend).toLocaleString()}, ` +
              `${costDeltaPct > 0 ? 'up' : costDeltaPct < 0 ? 'down' : 'unchanged'} ${Math.abs(costDeltaPct)}% vs last month.`
            : `Current monthly cloud spend is $${Math.round(monthlySpend).toLocaleString()}.`
        );
      }

      if (factLines.length === 0) return EMPTY_FIELDS;

      const prompt =
        `You are populating a scannable, 4-part executive summary for a cloud infrastructure ` +
        `dashboard: Overall Health, Top Risk, Cloud Spend, and System Status.\n\n` +
        `Use ONLY the facts below. Do not invent, estimate, or assume anything not explicitly ` +
        `stated — reproduce any scores or dollar amounts exactly as given. Do not add generic ` +
        `advice or filler. Each field should be a short, plain-English clause or sentence, not ` +
        `a list. If a fact needed for a field is not present below, leave that field null rather ` +
        `than guessing.\n\n` +
        `Fields to populate:\n` +
        `- overallHealth: the composite System Intelligence score (if present) plus a brief ` +
        `clause of context on what's driving it.\n` +
        `- topRisk: the single most urgent finding, one short sentence.\n` +
        `- cloudSpend: current spend, trend, and optimization potential, one short sentence.\n` +
        `- systemStatus: the outage/incident state, one short clause.\n\n` +
        `Facts:\n${factLines.map((f) => `- ${f}`).join('\n')}`;

      const result = await this.aiInsightsService.generateStructuredDashboardSummary(prompt);
      return result ?? EMPTY_FIELDS;
    } catch (error: any) {
      console.error('[AI Summary] Error generating summary:', error.message);
      return EMPTY_FIELDS;
    }
  }
}
