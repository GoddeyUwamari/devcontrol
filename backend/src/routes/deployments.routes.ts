import { Router, Request, Response } from 'express';
import { pool } from '../config/database';
import { DeploymentsController } from '../controllers/deployments.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { checkResourceLimit } from '../middleware/subscription.middleware';
import {
  IN_PROGRESS_MAX_AGE_HOURS,
  STATS_WINDOW_DAYS,
  changeFailureRate,
  isStatsWindow,
} from '../services/deployment-status';

const router = Router();
const controller = new DeploymentsController();

// ─── GET /api/deployments/stats ───────────────────────────────────────────────
// Must be before /:id or Express treats "stats" as an id param
//
// Counts for one organization over a window (date_range = 7d | 30d | 90d,
// default 30d, by deployed_at). Statuses are counted as recorded -- see
// services/deployment-status.ts -- and only finished deployments (success +
// failed) enter the change failure rate. last_deployment is the most recent
// finished deployment regardless of the window.
export async function deploymentStatsHandler(req: Request, res: Response): Promise<void> {
  try {
    // Never run unscoped: no organization means no query at all.
    const orgId = req.organizationId;
    if (!orgId) {
      res.status(401).json({ success: false, error: 'Unauthorized - organization context required' });
      return;
    }

    const { environment, date_range } = req.query as Record<string, string | undefined>;

    const window = date_range ?? '30d';
    if (!isStatsWindow(window)) {
      res.status(400).json({ success: false, error: 'Invalid date_range. Must be one of: 7d, 30d, 90d' });
      return;
    }
    const windowDays = STATS_WINDOW_DAYS[window];

    const scope: string[] = ['organization_id = $1'];
    const scopeValues: any[] = [orgId];
    if (environment && environment !== 'all') {
      scopeValues.push(environment);
      scope.push(`environment = $${scopeValues.length}`);
    }
    const scopeSql = scope.join(' AND ');
    const sinceParam = `$${scopeValues.length + 1}`;
    const maxAgeParam = `$${scopeValues.length + 2}`;

    const [counts, last] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)                                     AS total,
           COUNT(*) FILTER (WHERE status = 'success')   AS success,
           COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
           COUNT(*) FILTER (WHERE status = 'deploying'
             AND created_at >= NOW() - make_interval(hours => ${maxAgeParam})) AS in_progress,
           COUNT(*) FILTER (WHERE status = 'deploying'
             AND (created_at IS NULL OR created_at < NOW() - make_interval(hours => ${maxAgeParam}))) AS no_completion_recorded,
           COUNT(*) FILTER (WHERE status NOT IN ('success', 'failed', 'deploying')) AS unknown,
           COALESCE(SUM(cost_estimate), 0)              AS total_cost
         FROM deployments
         WHERE ${scopeSql}
           AND deployed_at >= NOW() - make_interval(days => ${sinceParam})`,
        [...scopeValues, windowDays, IN_PROGRESS_MAX_AGE_HOURS]
      ),
      pool.query(
        `SELECT status, deployed_at
           FROM deployments
          WHERE ${scopeSql}
            AND status IN ('success', 'failed')
          ORDER BY deployed_at DESC
          LIMIT 1`,
        scopeValues
      ),
    ]);

    const row = counts.rows[0];
    const success = parseInt(row.success) || 0;
    const failed  = parseInt(row.failed) || 0;
    const lastRow = last.rows[0];

    res.json({
      success: true,
      stats: {
        window_days: windowDays,
        total: parseInt(row.total) || 0,
        success,
        failed,
        in_progress: parseInt(row.in_progress) || 0,
        no_completion_recorded: parseInt(row.no_completion_recorded) || 0,
        unknown: parseInt(row.unknown) || 0,
        change_failure_rate: changeFailureRate(success, failed),
        total_cost: parseFloat(row.total_cost) || 0,
        last_deployment: lastRow
          ? { status: lastRow.status, deployed_at: new Date(lastRow.deployed_at).toISOString() }
          : null,
      },
    });
  } catch (err: any) {
    console.error('[Deployments/stats]', err);
    res.status(500).json({ success: false, error: 'Failed to load deployment stats' });
  }
}

router.get('/stats', authenticateToken, deploymentStatsHandler);

// ─── GET / and GET /:id — delegate to controller ─────────────────────────────

router.get('/', authenticateToken, (req, res) => controller.getAll(req, res));
router.get('/:id', authenticateToken, (req, res) => controller.getById(req, res));

// ─── POST / — resolve serviceName → service_id, then delegate ────────────────

router.post('/', authenticateToken, requireMember, checkResourceLimit('deployments', 1), async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    let { service_id, service_name, serviceName, environment, aws_region, region, deployed_by, version } = req.body;

    const name = serviceName || service_name;

    // Resolve service name → service_id if not already provided. The name is
    // only ever matched against, or created in, the caller's organization.
    if (!service_id && name) {
      if (!orgId) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      const { rows: existing } = await pool.query(
        `SELECT id FROM services
          WHERE LOWER(name) = LOWER($1) AND organization_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [name, orgId]
      );

      if (existing.length > 0) {
        service_id = existing[0].id;
      } else {
        // Create a placeholder service
        const { rows: inserted } = await pool.query(
          `INSERT INTO services (name, template, owner, status, organization_id)
           VALUES ($1, 'api', 'platform-portal@internal', 'active', $2)
           RETURNING id`,
          [name, orgId]
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

router.delete('/:id', authenticateToken, requireMember, (req, res) => controller.delete(req, res));

export default router;
