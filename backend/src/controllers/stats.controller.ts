import { Request, Response } from 'express';
import { Pool } from 'pg';
import { DeploymentsRepository } from '../repositories/deployments.repository';
import { AIChatContextRepository } from '../repositories/ai-chat-context.repository';
import { AWS_ACCOUNT_AMBIGUOUS_MESSAGE, isAwsAccountAmbiguous } from '../repositories/aws-accounts.repository';
import { ApiResponse, PlatformStats } from '../types';
import { pool } from '../config/database';
import { NO_LIFECYCLE_RESOURCE_TYPES, NOT_APPLICABLE_STATUS, UNKNOWN_STATUS } from '../utils/resourceLifecycle';
import awsCostService, { CostTrendRange } from '../services/aws-cost.service';
import { monthOverMonthSection, spendSection } from '../services/cost-context-sections';

const deploymentsRepo = new DeploymentsRepository();
const VALID_TREND_RANGES: CostTrendRange[] = ['7d', '30d', '90d', '6mo', '1yr'];

export class StatsController {
  private costContext: AIChatContextRepository;

  constructor(dbPool: Pool = pool) {
    this.costContext = new AIChatContextRepository(dbPool);
  }

  async getDashboardStats(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;

      if (!organizationId) {
        const stats: PlatformStats = {
          total_services: 0,
          active_deployments: 0,
          total_infrastructure_cost: 0,
          cost_source: 'estimated',
          free_tier_remaining: 25,
          recent_deployments: [],
          service_health: { healthy: 0, unhealthy: 0 },
        };
        const response: ApiResponse<PlatformStats> = { success: true, data: stats };
        res.json(response);
        return;
      }

      const [
        resourceCountResult,
        healthyCountResult,
        noLifecycleResult,
        activeDeployments,
        recentDeployments,
      ] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) as total FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
          [organizationId]
        ),
        pool.query(
          "SELECT COUNT(*) as healthy FROM aws_resources WHERE organization_id = $1 AND status IN ('running', 'active', 'available')",
          [organizationId]
        ),
        // Resources with no lifecycle state to judge: a type that has none (stored
        // 'not_applicable', or still carrying an earlier release's made-up status)
        // or one whose state was not read. Neither healthy nor unhealthy.
        pool.query(
          `SELECT COUNT(*) FILTER (WHERE resource_type = ANY($2::text[]) AND status IN ('running', 'active', 'available')) AS counted_healthy,
                  COUNT(*) FILTER (WHERE resource_type = ANY($2::text[]) OR status IN ('${NOT_APPLICABLE_STATUS}', '${UNKNOWN_STATUS}', 'UNKNOWN')) AS without_state
             FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
          [organizationId, NO_LIFECYCLE_RESOURCE_TYPES]
        ),
        deploymentsRepo.countByStatus(organizationId, 'running'),
        deploymentsRepo.findRecentByLimit(organizationId, 5),
      ]);

      // Live Cost Explorer, falling back to the DB estimate — see
      // AWSCostService.getMonthlySpendWithFallback (the single canonical
      // implementation of this decision, shared with system-intelligence.service.ts).
      const { amount: totalCost, source: costSource } =
        await awsCostService.getMonthlySpendWithFallback(organizationId);

      const totalResources = parseInt(resourceCountResult.rows[0].total, 10);
      const withoutLifecycleState = parseInt(noLifecycleResult.rows[0].without_state, 10);
      // A no-lifecycle row an earlier release stored as 'active'/'available' is not healthy either.
      const healthyResources =
        parseInt(healthyCountResult.rows[0].healthy, 10) - parseInt(noLifecycleResult.rows[0].counted_healthy, 10);

      const stats: PlatformStats = {
        total_services: totalResources,
        active_deployments: activeDeployments,
        total_infrastructure_cost: totalCost,
        cost_source: costSource,
        free_tier_remaining: Math.max(0, 25 - totalCost),
        recent_deployments: recentDeployments,
        service_health: {
          healthy: healthyResources,
          unhealthy: totalResources - healthyResources - withoutLifecycleState,
        },
      };

      const response: ApiResponse<PlatformStats> = { success: true, data: stats };
      res.json(response);
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      const response: ApiResponse = {
        success: false,
        error: 'Failed to fetch dashboard stats',
      };
      res.status(500).json(response);
    }
  }

  /**
   * GET /api/platform/costs/trend
   * Time-series cost breakdown by category (compute/storage/database/network/other)
   * from AWS Cost Explorer, for the requested range.
   */
  async getCostTrend(req: Request, res: Response): Promise<void> {
    const organizationId = (req as any).user?.organizationId;
    const rangeParam = (req.query.range as string) || '90d';

    if (!VALID_TREND_RANGES.includes(rangeParam as CostTrendRange)) {
      res.status(400).json({
        success: false,
        error: `Invalid range. Must be one of: ${VALID_TREND_RANGES.join(', ')}`,
      });
      return;
    }

    try {
      const data = await awsCostService.fetchCostTrend(organizationId, rangeParam as CostTrendRange);
      res.json({ success: true, data });
    } catch (error: any) {
      console.error('Error fetching cost trend:', error);
      if (isAwsAccountAmbiguous(error)) {
        res.status(409).json({ success: false, error: AWS_ACCOUNT_AMBIGUOUS_MESSAGE });
        return;
      }
      // No connected account: there is nothing to query, so an empty series
      // is the honest answer. Any other failure is not "no spend" -- it must
      // not reach the client as a successful empty series.
      if (String(error?.message ?? '').startsWith('AWS_NOT_CONNECTED')) {
        res.json({ success: true, data: [] });
        return;
      }
      res.status(502).json({ success: false, error: 'The AWS Cost Explorer trend could not be retrieved' });
    }
  }

  /**
   * GET /api/platform/costs/summary
   * The Costs page's month-to-date spend and month-over-month comparison, as
   * the shared evidence sections (cost-context-sections.ts over
   * AIChatContextRepository.gatherCostContext() -- the path AI Reports, the
   * Dashboard AI summary, and Ask AI already use). Unlike
   * getMonthlySpendWithFallback(), a real $0 or net-credit Cost Explorer
   * month stays 'actual', the inventory estimate stays 'estimated', and a
   * missing figure or comparison is a state, never 0 or 0%.
   */
  async getCostSummary(req: Request, res: Response): Promise<void> {
    const organizationId = (req as any).user?.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized - organization context required' });
      return;
    }

    try {
      const { costs } = await this.costContext.gatherCostContext(organizationId);
      const [spend, monthOverMonth] = await Promise.all([spendSection(costs), monthOverMonthSection(costs)]);
      res.json({ success: true, data: { spend, monthOverMonth } });
    } catch (error: any) {
      // The raw failure can carry SQL or AWS detail: server log only.
      console.error('[Stats Controller] Cost summary error:', error?.message ?? error);
      res.status(500).json({ success: false, error: 'Failed to load cost summary' });
    }
  }
}
