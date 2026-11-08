import { Request, Response } from 'express';
import { Pool } from 'pg';
import { getOrganizationTier } from '../middleware/subscription.middleware';

const API_REQUEST_LIMITS: Record<string, number> = {
  free: 500,
  starter: 2000,
  pro: 5000,
  enterprise: 20000,
};

const RESOURCE_LIMITS: Record<string, number | null> = {
  free: 20,
  starter: 60,
  pro: 500,
  enterprise: null,
};

export class UsageController {
  constructor(private pool: Pool) {}

  async getApiRequests(req: Request, res: Response): Promise<void> {
    try {
      const organizationId = (req as any).user?.organizationId;
      if (!organizationId) {
        res.status(400).json({ success: false, error: 'Organization ID not found' });
        return;
      }

      // The limits of the effective tier: the plan the gates enforce, lowered
      // by a billing hold or a terminal subscription ('free' if not found).
      const [usageResult, tier] = await Promise.all([
        this.pool.query(
          `SELECT request_count FROM api_usage
           WHERE organization_id = $1 AND hour = date_trunc('hour', NOW())`,
          [organizationId]
        ),
        getOrganizationTier(organizationId, this.pool),
      ]);

      const requestsThisHour: number = usageResult.rows[0]?.request_count ?? 0;
      const limit: number = API_REQUEST_LIMITS[tier] ?? API_REQUEST_LIMITS.free;
      const resourceLimit: number | null = tier in RESOURCE_LIMITS ? RESOURCE_LIMITS[tier] : RESOURCE_LIMITS.free;

      res.json({ success: true, data: { requestsThisHour, limit, resourceLimit } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
