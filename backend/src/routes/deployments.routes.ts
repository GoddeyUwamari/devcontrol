import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { DeploymentsController } from '../controllers/deployments.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();
const controller = new DeploymentsController();

// ─── GET /api/deployments/stats ───────────────────────────────────────────────
// Must be before /:id or Express treats "stats" as an id param

router.get('/stats', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    const { environment } = req.query as Record<string, string>;

    const conditions: string[] = [];
    const values: any[] = [];
    let p = 1;

    if (orgId) {
      conditions.push(`organization_id = $${p++}`);
      values.push(orgId);
    }

    if (environment && environment !== 'all') {
      conditions.push(`environment = $${p++}`);
      values.push(environment);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT
         COUNT(*)                                          AS total,
         COUNT(*) FILTER (WHERE status = 'running')       AS running,
         COUNT(*) FILTER (WHERE status = 'failed')        AS failed,
         COUNT(*) FILTER (WHERE status = 'deploying')     AS deploying,
         COALESCE(SUM(cost_estimate), 0)                  AS total_cost
       FROM deployments ${where}`,
      values
    );

    const row = rows[0];
    const total    = parseInt(row.total) || 0;
    const running  = parseInt(row.running) || 0;
    const failed   = parseInt(row.failed) || 0;
    const deploying = parseInt(row.deploying) || 0;
    const totalCost = parseFloat(row.total_cost) || 0;
    const successRate = total > 0 ? Math.round((running / total) * 100) : null;

    res.json({
      success: true,
      stats: { total, running, failed, deploying, success_rate: successRate, total_cost: totalCost },
    });
  } catch (err: any) {
    console.error('[Deployments/stats]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET / and GET /:id — delegate to controller ─────────────────────────────

router.get('/', (req, res) => controller.getAll(req, res));
router.get('/:id', (req, res) => controller.getById(req, res));

// ─── POST / — resolve serviceName → service_id, then delegate ────────────────

router.post('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    let { service_id, service_name, serviceName, environment, aws_region, region, deployed_by, version } = req.body;

    const name = serviceName || service_name;

    // Resolve service name → service_id if not already provided
    if (!service_id && name) {
      // Look up existing service by name (scoped to org if available)
      const lookupConditions = orgId
        ? `(LOWER(name) = LOWER($1) AND (organization_id = $2 OR organization_id IS NULL))`
        : `LOWER(name) = LOWER($1)`;
      const lookupValues = orgId ? [name, orgId] : [name];

      const { rows: existing } = await pool.query(
        `SELECT id FROM services WHERE ${lookupConditions} ORDER BY created_at DESC LIMIT 1`,
        lookupValues
      );

      if (existing.length > 0) {
        service_id = existing[0].id;
      } else {
        // Create a placeholder service
        const { rows: inserted } = await pool.query(
          `INSERT INTO services (name, template, owner, status, organization_id)
           VALUES ($1, 'api', 'platform-portal@internal', 'active', $2)
           RETURNING id`,
          [name, orgId ?? null]
        );
        service_id = inserted[0].id;
      }
    }

    if (!service_id) {
      res.status(400).json({ success: false, error: 'service_id or serviceName is required' });
      return;
    }

    // Patch req.body with resolved fields before delegating to controller
    req.body.service_id   = service_id;
    req.body.aws_region   = aws_region || region || 'us-east-1';
    req.body.status       = 'deploying';
    req.body.deployed_by  = deployed_by || 'platform-portal';
    if (version) {
      req.body.resources = { ...(req.body.resources || {}), version };
    }
    if (orgId) {
      req.body.organization_id = orgId;
    }

    controller.create(req, res);
  } catch (err: any) {
    console.error('[Deployments/create]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', (req, res) => controller.delete(req, res));

export default router;
