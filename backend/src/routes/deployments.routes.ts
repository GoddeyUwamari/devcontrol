import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { DeploymentsController } from '../controllers/deployments.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { checkResourceLimit } from '../middleware/subscription.middleware';
import {
  DEPLOYMENT_ENVIRONMENTS,
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
// finished deployment regardless of the window. organization_has_deployments
// is whether the organization has any deployment at all, in any environment
// or window -- what separates "nothing matches these filters" from "nothing
// has ever been recorded".
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

    const [counts, last, any] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)                                     AS total,
           COUNT(*) FILTER (WHERE status = 'success')   AS success,
           COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
           COUNT(*) FILTER (WHERE status = 'deploying'
             AND created_at >= NOW() - make_interval(hours => ${maxAgeParam})) AS in_progress,
           COUNT(*) FILTER (WHERE status = 'deploying'
             AND (created_at IS NULL OR created_at < NOW() - make_interval(hours => ${maxAgeParam}))) AS no_completion_recorded,
           COUNT(*) FILTER (WHERE status NOT IN ('success', 'failed', 'deploying')) AS unknown
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
          ORDER BY deployed_at DESC NULLS LAST, id DESC
          LIMIT 1`,
        scopeValues
      ),
      pool.query(
        'SELECT EXISTS (SELECT 1 FROM deployments WHERE organization_id = $1) AS has_deployments',
        [orgId]
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
        organization_has_deployments: any.rows[0]?.has_deployments === true,
        last_deployment: lastRow && lastRow.deployed_at
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

// The only body fields a caller may set. Everything else -- organization_id,
// status, deployed_at, metadata and any unknown key -- is dropped: the
// organization comes from the authenticated request, a deployment created
// here is always 'deploying' as of now, and metadata is reserved for the CI
// integration's own provenance.
export const createDeploymentBodySchema = z.object({
  service_id: z.string().uuid().optional(),
  service_name: z.string().trim().min(1).max(255).optional(),
  serviceName: z.string().trim().min(1).max(255).optional(),
  environment: z.enum(DEPLOYMENT_ENVIRONMENTS),
  aws_region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/).optional(),
  region: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/).optional(),
  deployed_by: z.string().trim().min(1).max(255).optional(),
  version: z.string().trim().min(1).max(100).optional(),
  resources: z.record(z.string(), z.any()).optional(),
  cost_estimate: z.number().min(0).max(99_999_999.99).optional(),
});

router.post('/', authenticateToken, requireMember, checkResourceLimit('deployments', 1), async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    if (!orgId) {
      res.status(401).json({ success: false, error: 'Unauthorized - organization context required' });
      return;
    }

    const parsed = createDeploymentBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({ success: false, error: `Invalid ${issue.path.join('.') || 'body'}: ${issue.message}` });
      return;
    }
    const body = parsed.data;
    let service_id = body.service_id;
    const name = body.serviceName || body.service_name;

    // Resolve service name → service_id if not already provided. The name is
    // only ever matched against, or created in, the caller's organization.
    if (!service_id && name) {
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

    // The controller only ever sees the allowlisted fields.
    req.body = {
      service_id,
      environment: body.environment,
      aws_region: body.aws_region || body.region || 'us-east-1',
      status: 'deploying',
      deployed_by: body.deployed_by || 'platform-portal',
      // Zero is not a recorded cost.
      ...(body.cost_estimate ? { cost_estimate: body.cost_estimate } : {}),
      ...(body.resources || body.version
        ? { resources: { ...(body.resources || {}), ...(body.version ? { version: body.version } : {}) } }
        : {}),
    };

    controller.create(req, res);
  } catch (err: any) {
    console.error('[Deployments/create]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/:id', authenticateToken, requireMember, (req, res) => controller.delete(req, res));

export default router;
