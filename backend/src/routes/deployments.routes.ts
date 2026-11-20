import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { pool } from '../config/database';
import { DeploymentsController } from '../controllers/deployments.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { checkResourceLimit, organizationHasEntitlement } from '../middleware/subscription.middleware';
import {
  DEPLOYMENT_ENVIRONMENTS,
  IN_PROGRESS_MAX_AGE_HOURS,
  STATS_WINDOW_DAYS,
  changeFailureRate,
  isStatsWindow,
} from '../services/deployment-status';
import { MANUAL_RECORD_SOURCE, RECORDED_RESULTS, RECORD_MESSAGES } from '../services/deployment-record';

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
//
// The counts and the last deployment are served on every plan (the
// Deployments page needs them). change_failure_rate is a DORA metric: it is
// in the answer only when the organization's plan includes DORA metrics
// (PLAN_ENTITLEMENTS.doraMetrics), and left out otherwise -- including when
// the plan cannot be read.
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

    const [counts, last, any, includesDora] = await Promise.all([
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
      organizationHasEntitlement(orgId, 'doraMetrics').catch((err) => {
        console.error('[Deployments/stats] plan lookup failed', err?.message ?? err);
        return false;
      }),
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
        ...(includesDora ? { change_failure_rate: changeFailureRate(success, failed) } : {}),
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

// ─── POST / — record a deployment that already happened ──────────────────────

// The only body fields a caller may set. Everything else -- organization_id,
// deployed_at, metadata and any unknown key -- is dropped: the organization
// comes from the authenticated request, the time is the server's now, and
// metadata is the server's provenance (source 'manual' here; the GitHub
// webhook writes its own). deployed_by is accepted for older callers and
// ignored: the row always names the signed-in user.
//
// status is optional. Omitted, the row is 'deploying', as before this
// existed. 'success' or 'failed' records a finished deployment. Anything
// else is refused.
export const createDeploymentBodySchema = z.object({
  service_id: z.string().uuid().optional(),
  service_name: z.string().trim().min(1).max(255).optional(),
  serviceName: z.string().trim().min(1).max(255).optional(),
  environment: z.enum(DEPLOYMENT_ENVIRONMENTS),
  status: z.enum(RECORDED_RESULTS).optional(),
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
    // The recorder is the signed-in user, from the current membership.
    const recordedBy = req.user?.email;
    if (!recordedBy) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const parsed = createDeploymentBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const error = issue.path[0] === 'status'
        ? RECORD_MESSAGES.invalidStatus
        : `Invalid ${issue.path.join('.') || 'body'}: ${issue.message}`;
      res.status(400).json({ success: false, error });
      return;
    }
    const body = parsed.data;
    const name = body.serviceName || body.service_name;
    if (!body.service_id && !name) {
      res.status(400).json({ success: false, error: RECORD_MESSAGES.chooseService });
      return;
    }

    // The service must already exist in the caller's organization. Nothing is
    // created here: an unknown id or name, and another organization's
    // service, get the same answer.
    const { rows: found } = body.service_id
      ? await pool.query(
          'SELECT id, name FROM services WHERE id = $1 AND organization_id = $2',
          [body.service_id, orgId]
        )
      : await pool.query(
          `SELECT id, name FROM services
            WHERE LOWER(name) = LOWER($1) AND organization_id = $2
            ORDER BY created_at DESC LIMIT 1`,
          [name, orgId]
        );
    if (found.length === 0) {
      res.status(400).json({ success: false, error: RECORD_MESSAGES.chooseExistingService });
      return;
    }

    // The controller only ever sees the allowlisted fields.
    req.body = {
      service_id: found[0].id,
      environment: body.environment,
      aws_region: body.aws_region || body.region || 'us-east-1',
      status: body.status ?? 'deploying',
      deployed_by: recordedBy,
      metadata: { source: MANUAL_RECORD_SOURCE },
      // Zero is not a recorded cost.
      ...(body.cost_estimate ? { cost_estimate: body.cost_estimate } : {}),
      ...(body.resources || body.version
        ? { resources: { ...(body.resources || {}), ...(body.version ? { version: body.version } : {}) } }
        : {}),
    };
    res.locals.serviceName = found[0].name;

    controller.create(req, res);
  } catch (err: any) {
    console.error('[Deployments/create]', err);
    res.status(500).json({ success: false, error: RECORD_MESSAGES.notRecorded });
  }
});

router.delete('/:id', authenticateToken, requireMember, (req, res) => controller.delete(req, res));

export default router;
