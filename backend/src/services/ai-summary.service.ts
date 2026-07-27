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
 * scans stall.
 */

import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { AIInsightsService, StructuredDashboardSummary } from './ai-insights.service';
import { SystemIntelligenceService } from './system-intelligence.service';
import { RiskTrackingService } from './risk-tracking.service';
import { AccountSecurityFindingsRepository } from '../repositories/account-security-findings.repository';
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
  scanCompletedAt: string | null;
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
   * Get the cached summary if it's for the same completed scan and under the TTL
   * ceiling, otherwise regenerate and cache.
   */
  async getSummary(organizationId: string, costDeltaPct?: number | null): Promise<AISummaryResult> {
    const scanCompletedAt = await this.getLatestScanCompletedAt(organizationId);
    const cached = this.cache.get(organizationId);

    if (
      cached &&
      cached.scanCompletedAt === scanCompletedAt &&
      Date.now() - cached.timestamp < AISummaryService.CACHE_TTL_CEILING
    ) {
      return { ...cached.fields, generatedAt: new Date(cached.timestamp).toISOString() };
    }

    const fields = await this.generateSummary(organizationId, costDeltaPct);
    const timestamp = Date.now();
    this.cache.set(organizationId, { fields, scanCompletedAt, timestamp });
    return { ...fields, generatedAt: new Date(timestamp).toISOString() };
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
        const c = riskScore.complianceIssueCounts;
        const totalFindings = c.critical + c.high + c.medium + c.low;
        facts.push(
          `Security posture score: ${riskScore.score}/100, driven by ${totalFindings} active ` +
          `finding${totalFindings !== 1 ? 's' : ''} (${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low).`
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
