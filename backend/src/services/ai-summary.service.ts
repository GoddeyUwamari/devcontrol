/**
 * AI Summary Service
 * Composes real, already-computed dashboard data (System Intelligence score,
 * security posture, top finding, cost recommendations, active anomalies) into a
 * fact-only prompt and asks Claude (via AIInsightsService) to turn it into a short
 * plain-English summary. Never fabricates — any field that isn't available is
 * simply omitted from the facts list, and the whole summary is null if nothing
 * real is available to say.
 *
 * Cached per-org, keyed on the org's latest completed discovery scan (not just a
 * fixed clock TTL) so the summary regenerates when a new scan actually runs rather
 * than on every dashboard poll — with a 4h ceiling as a defensive fallback in case
 * scans stall. Also keyed on rounded monthlySpend/costDeltaPct: those two facts
 * move on the cost-data cadence (daily Cost Explorer updates), which is decoupled
 * from resource-discovery scans, so a scan-only cache key can serve a summary with
 * stale dollar figures baked into its prose for up to the 4h ceiling.
 */

import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { AIInsightsService, StructuredDashboardSummary } from './ai-insights.service';
import { SystemIntelligenceService } from './system-intelligence.service';
import { RiskTrackingService } from './risk-tracking.service';
import { AccountSecurityFindingsRepository } from '../repositories/account-security-findings.repository';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import awsCostService from './aws-cost.service';

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
  scanCompletedAt: string | null;
  monthlySpendRounded: number | null;
  costDeltaPct: number | null;
  timestamp: number;
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
   * Get the cached summary if it's for the same completed scan, the same rounded
   * monthly spend, and the same cost delta — all under the TTL ceiling — otherwise
   * regenerate and cache. monthlySpend/costDeltaPct are rounded to the precision
   * actually shown in the generated prose ($ whole number, 1 decimal %) so this
   * doesn't regenerate on noise smaller than what a user could ever see change.
   */
  async getSummary(organizationId: string, costDeltaPct?: number | null): Promise<AISummaryResult> {
    const scanCompletedAt = await this.getLatestScanCompletedAt(organizationId);
    const monthlySpendRounded = await this.getMonthlySpendRounded(organizationId);
    const normalizedCostDeltaPct = costDeltaPct ?? null;
    const cached = this.cache.get(organizationId);

    if (
      cached &&
      cached.scanCompletedAt === scanCompletedAt &&
      cached.monthlySpendRounded === monthlySpendRounded &&
      cached.costDeltaPct === normalizedCostDeltaPct &&
      Date.now() - cached.timestamp < AISummaryService.CACHE_TTL_CEILING
    ) {
      return { ...cached.fields, generatedAt: new Date(cached.timestamp).toISOString() };
    }

    const fields = await this.generateSummary(organizationId, normalizedCostDeltaPct);
    const timestamp = Date.now();
    this.cache.set(organizationId, { fields, scanCompletedAt, monthlySpendRounded, costDeltaPct: normalizedCostDeltaPct, timestamp });
    return { ...fields, generatedAt: new Date(timestamp).toISOString() };
  }

  /**
   * Cheap peek at current monthly spend for cache-key purposes — reuses
   * AWSCostService's own 4h-TTL per-org cache, so this is a real Cost Explorer
   * call only as often as fetchMonthlyCosts itself would already make one.
   * Rounded to whole dollars to match what generateSummary's prose actually shows.
   */
  private async getMonthlySpendRounded(organizationId: string): Promise<number | null> {
    try {
      const { total } = await awsCostService.fetchMonthlyCosts(organizationId);
      return Math.round(total);
    } catch (error: any) {
      console.error('[AI Summary] Error fetching monthly spend for cache key:', error.message);
      return null;
    }
  }

  private async generateSummary(
    organizationId: string,
    costDeltaPct?: number | null
  ): Promise<StructuredDashboardSummary> {
    try {
      const [intelligence, riskScore, activeFindings, costStats, criticalAnomalies] = await Promise.all([
        this.systemIntelligenceService.getSystemIntelligence(organizationId),
        this.riskTrackingService.getCurrentRiskScore(organizationId),
        this.accountFindingsRepository.getActive(organizationId),
        this.costRecommendationsRepository.getStats(organizationId),
        this.getCriticalAnomalyCount(organizationId),
      ]);

      // Reuse the monthly spend system-intelligence already fetched (live Cost
      // Explorer, falling back to the DB estimate) instead of independently
      // re-calling Cost Explorer for the same org.
      const monthlySpend = intelligence.components.cost.monthlySpend;

      // Highest-severity active finding — AccountSecurityFindingsRepository.getActive()
      // (unfiltered, no limit) already sorts the full result set by severity in JS, so
      // [0] here is genuinely the most severe finding, not just the most recent one.
      const topFinding = activeFindings[0] ?? null;

      const facts: string[] = [];

      if (intelligence.system_score != null) {
        facts.push(
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
        facts.push(
          `Security posture score: ${riskScore.score}/100 — ${accountLevelCount} account-level ` +
          `finding${accountLevelCount !== 1 ? 's' : ''} (security groups, IAM) and ` +
          `${resourceComplianceCount} resource compliance issue${resourceComplianceCount !== 1 ? 's' : ''} ` +
          `(encryption, backups, tagging, SOC2/HIPAA checks) currently active.`
        );
      }

      if (topFinding) {
        facts.push(`Top active finding: "${topFinding.title}" (severity: ${topFinding.severity}).`);
      }

      if (costStats.active_recommendations > 0) {
        facts.push(
          `${costStats.active_recommendations} active cost optimization` +
          `${costStats.active_recommendations !== 1 ? 's' : ''} could save approximately ` +
          `$${Math.round(costStats.total_potential_savings).toLocaleString()}/month.`
        );
      }

      facts.push(
        criticalAnomalies > 0
          ? `${criticalAnomalies} critical outage${criticalAnomalies !== 1 ? 's are' : ' is'} currently active.`
          : 'No critical outages are currently active.'
      );

      if (monthlySpend != null && monthlySpend > 0) {
        facts.push(
          costDeltaPct != null
            ? `Current monthly cloud spend is $${Math.round(monthlySpend).toLocaleString()}, ` +
              `${costDeltaPct > 0 ? 'up' : costDeltaPct < 0 ? 'down' : 'unchanged'} ${Math.abs(costDeltaPct)}% vs last month.`
            : `Current monthly cloud spend is $${Math.round(monthlySpend).toLocaleString()}.`
        );
      }

      if (facts.length === 0) return EMPTY_FIELDS;

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
        `Facts:\n${facts.map((f) => `- ${f}`).join('\n')}`;

      const result = await this.aiInsightsService.generateStructuredDashboardSummary(prompt);
      return result ?? EMPTY_FIELDS;
    } catch (error: any) {
      console.error('[AI Summary] Error generating summary:', error.message);
      return EMPTY_FIELDS;
    }
  }
}
