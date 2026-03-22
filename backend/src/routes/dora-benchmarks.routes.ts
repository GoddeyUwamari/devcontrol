import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const VALID_METRICS = [
  'deployment_frequency',
  'lead_time',
  'change_failure_rate',
  'recovery_time',
] as const;

type MetricName = typeof VALID_METRICS[number];

const METRIC_UNITS: Record<MetricName, string> = {
  deployment_frequency: 'per_day',
  lead_time:            'hours',
  change_failure_rate:  'percentage',
  recovery_time:        'minutes',
};

function isValidMetric(m: string): m is MetricName {
  return VALID_METRICS.includes(m as MetricName);
}

function getOrgId(req: Request): string {
  return (
    (req as any).organizationId ||
    (req as any).user?.organizationId ||
    'a8ea4c8f-5f93-4073-b627-160c61aa064f' // demo fallback
  );
}

export function createDoraBenchmarksRoutes(pool: Pool): Router {
  const router = Router();

  /**
   * GET /api/dora/benchmarks
   * Returns all custom benchmarks for the organization, keyed by metric_name.
   */
  router.get('/benchmarks', async (req: Request, res: Response) => {
    try {
      const organizationId = getOrgId(req);
      const result = await pool.query(
        `SELECT id, metric_name, target_value, target_unit, performance_label,
                created_at, updated_at
         FROM custom_dora_benchmarks
         WHERE organization_id = $1
         ORDER BY metric_name`,
        [organizationId]
      );
      res.json({ success: true, data: result.rows });
    } catch (error: any) {
      console.error('[DORA Benchmarks] GET /benchmarks error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to fetch DORA benchmarks' });
    }
  });

  /**
   * POST /api/dora/benchmarks
   * Create or update a custom benchmark for one metric (upsert by org + metric_name).
   *
   * Body: { metric_name, target_value, performance_label? }
   * target_unit is derived automatically from metric_name.
   */
  router.post('/benchmarks', async (req: Request, res: Response) => {
    try {
      const organizationId = getOrgId(req);
      const { metric_name, target_value, performance_label } = req.body;

      if (!metric_name || !isValidMetric(metric_name)) {
        res.status(400).json({
          success: false,
          error: `Invalid metric_name. Must be one of: ${VALID_METRICS.join(', ')}`,
        });
        return;
      }

      const parsedValue = Number(target_value);
      if (isNaN(parsedValue) || parsedValue <= 0) {
        res.status(400).json({
          success: false,
          error: 'target_value must be a positive number',
        });
        return;
      }

      const target_unit = METRIC_UNITS[metric_name];
      const label = (performance_label || 'Elite').trim().slice(0, 100);

      const result = await pool.query(
        `INSERT INTO custom_dora_benchmarks
           (organization_id, metric_name, target_value, target_unit, performance_label)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (organization_id, metric_name) DO UPDATE SET
           target_value      = EXCLUDED.target_value,
           target_unit       = EXCLUDED.target_unit,
           performance_label = EXCLUDED.performance_label,
           updated_at        = NOW()
         RETURNING *`,
        [organizationId, metric_name, parsedValue, target_unit, label]
      );

      res.json({ success: true, data: result.rows[0] });
    } catch (error: any) {
      console.error('[DORA Benchmarks] POST /benchmarks error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to save DORA benchmark' });
    }
  });

  /**
   * DELETE /api/dora/benchmarks/:metric
   * Reset a metric to industry standard by deleting the custom benchmark row.
   */
  router.delete('/benchmarks/:metric', async (req: Request, res: Response) => {
    try {
      const organizationId = getOrgId(req);
      const { metric } = req.params;

      if (!isValidMetric(metric)) {
        res.status(400).json({
          success: false,
          error: `Invalid metric. Must be one of: ${VALID_METRICS.join(', ')}`,
        });
        return;
      }

      const result = await pool.query(
        `DELETE FROM custom_dora_benchmarks
         WHERE organization_id = $1 AND metric_name = $2
         RETURNING metric_name`,
        [organizationId, metric]
      );

      if (result.rowCount === 0) {
        res.json({
          success: true,
          message: `No custom benchmark existed for ${metric} — already using industry standard`,
        });
        return;
      }

      res.json({
        success: true,
        message: `Benchmark for ${metric} reset to industry standard`,
      });
    } catch (error: any) {
      console.error('[DORA Benchmarks] DELETE /benchmarks/:metric error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to reset DORA benchmark' });
    }
  });

  return router;
}
