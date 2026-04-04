import { Request, Response } from 'express';
import { Pool } from 'pg';

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

      const [usageResult, orgResult] = await Promise.all([
        this.pool.query(
          `SELECT request_count FROM api_usage
           WHERE organization_id = $1 AND hour = date_trunc('hour', NOW())`,
          [organizationId]
        ),
        this.pool.query(
          `SELECT subscription_tier FROM organizations WHERE id = $1`,
          [organizationId]
        ),
      ]);

      const requestsThisHour: number = usageResult.rows[0]?.request_count ?? 0;
      const tier: string = orgResult.rows[0]?.subscription_tier ?? 'free';
      const limit: number = API_REQUEST_LIMITS[tier] ?? API_REQUEST_LIMITS.free;
      const resourceLimit: number | null = tier in RESOURCE_LIMITS ? RESOURCE_LIMITS[tier] : RESOURCE_LIMITS.free;

      res.json({ success: true, data: { requestsThisHour, limit, resourceLimit } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
