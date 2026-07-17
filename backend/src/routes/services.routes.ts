import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { ServicesController } from '../controllers/services.controller';
import { validateBody, validateParams } from '../middleware/validation';
import { createServiceSchema, updateServiceSchema, uuidParamSchema } from '../validators/schemas';
import { authenticateToken } from '../middleware/auth.middleware';
import { checkDiscoveryLimit, checkResourceLimit } from '../middleware/subscription.middleware';
import { AWSResourceDiscoveryService } from '../services/awsResourceDiscovery';

const router = Router();
const controller = new ServicesController();
const discoveryService = new AWSResourceDiscoveryService(pool);

// ─── Status mapping ───────────────────────────────────────────────────────────

function mapStatus(resourceType: string, rawStatus: string | null): 'healthy' | 'warning' | 'critical' {
  if (!rawStatus) return 'warning';
  const s = rawStatus.toLowerCase();

  switch (resourceType) {
    case 'ec2':
      if (s === 'running') return 'healthy';
      if (s === 'stopped') return 'warning';
      if (s === 'terminated') return 'critical';
      return 'warning';

    case 'ecs':
      if (s === 'active') return 'healthy';
      if (s === 'draining') return 'warning';
      if (s === 'inactive') return 'critical';
      return 'warning';

    case 'lambda':
      return 'healthy';

    case 'rds':
    case 'aurora':
      if (s === 'available') return 'healthy';
      if (['modifying', 'backing-up', 'upgrading', 'maintenance'].includes(s)) return 'warning';
      if (['stopped', 'failed', 'deleting'].includes(s)) return 'critical';
      return 'warning';

    case 'eks':
      if (s === 'active') return 'healthy';
      if (['creating', 'updating'].includes(s)) return 'warning';
      if (['failed', 'deleting'].includes(s)) return 'critical';
      return 'warning';

    default:
      if (['active', 'available', 'enabled', 'running'].includes(s)) return 'healthy';
      return 'warning';
  }
}

// ─── Severity taxonomy merge ────────────────────────────────────────────────
// Three incompatible severity schemes exist in this codebase: resource
// operational status (healthy/warning/critical, derived above from raw AWS
// state), ComplianceSeverity (critical/high/medium/low, from
// aws_resources.compliance_issues / account_security_findings), and
// RecommendationSeverity (LOW/MEDIUM/HIGH, no critical, from
// cost_recommendations' dollar thresholds). This merges all three into one
// `priority_severity` per resource so sorting/grouping logic for the
// services list lives here, not scattered across frontend components.
//
// Product decision: compliance is authoritative over cost when a resource has
// both — a security gap is categorically more urgent than a spend
// inefficiency, so cost severity is only consulted when there's no
// compliance issue for that resource. Operational status is folded in as an
// independent signal (a stopped/terminated resource is worth surfacing even
// with zero compliance/cost findings): critical status -> critical severity,
// warning status -> medium severity (worth a look, not security-grade
// urgent), healthy status -> no contribution. The final priority_severity is
// the worse of (compliance-or-cost) and (status-derived) severity.

type PrioritySeverity = 'critical' | 'high' | 'medium' | 'low';
type SeverityFinding = { severity: PrioritySeverity; reason: string };

const SEVERITY_RANK: Record<PrioritySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const COST_SEVERITY_MAP: Record<string, PrioritySeverity> = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

function worseSeverity(a: SeverityFinding | null, b: SeverityFinding | null): SeverityFinding | null {
  if (!a) return b;
  if (!b) return a;
  return SEVERITY_RANK[a.severity] <= SEVERITY_RANK[b.severity] ? a : b;
}

function worstComplianceIssue(issues: any[] | null): SeverityFinding | null {
  if (!issues || issues.length === 0) return null;
  let worst = issues[0];
  for (const issue of issues) {
    if (SEVERITY_RANK[issue.severity as PrioritySeverity] < SEVERITY_RANK[worst.severity as PrioritySeverity]) worst = issue;
  }
  return { severity: worst.severity, reason: worst.issue };
}

function worstCostRecommendation(recs: any[] | null): SeverityFinding | null {
  if (!recs || recs.length === 0) return null;
  const rank: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  let worst = recs[0];
  for (const r of recs) {
    if (
      rank[r.severity] < rank[worst.severity] ||
      (rank[r.severity] === rank[worst.severity] && Number(r.potential_savings) > Number(worst.potential_savings))
    ) {
      worst = r;
    }
  }
  return { severity: COST_SEVERITY_MAP[worst.severity], reason: worst.issue };
}

function statusSeverity(status: 'healthy' | 'warning' | 'critical'): SeverityFinding | null {
  if (status === 'critical') return { severity: 'critical', reason: 'Resource in a failed or terminated state' };
  if (status === 'warning')  return { severity: 'medium',   reason: 'Resource is stopped or degraded' };
  return null;
}

// Below this rank, a compliance/cost finding is real but not urgent enough to
// pull a resource out of the collapsed "healthy" group in the services list —
// priority_severity still reflects it (for a future resource-detail view),
// it just doesn't set needs_attention. Confirmed floor: high/critical only.
// 'medium' was considered and rejected — this scanner's actual output makes
// it too broad to use as the floor: the generic "not encrypted" fallback
// (hits VPCs and any resource type without a specific rule) and the SOC2
// change-management tagging checklist are both 'medium' and apply to most
// resources regardless of real risk, which would defeat the point of
// collapsing the boring majority.
//
// This floor applies to compliance/cost findings only, not to operational
// status — a stopped/terminated resource keeps surfacing at its existing
// critical/medium mapping unchanged, since "this resource isn't running" is
// an operational fact, not a compliance-finding severity level, and wasn't
// part of what this floor was scoped to address.
const NEEDS_ATTENTION_FLOOR: PrioritySeverity = 'high';

function derivePrioritySeverity(
  status: 'healthy' | 'warning' | 'critical',
  complianceIssues: any[] | null,
  costRecommendations: any[] | null
): { priority_severity: PrioritySeverity | null; reason: string | null; needs_attention: boolean } {
  const flagged = worstComplianceIssue(complianceIssues) ?? worstCostRecommendation(costRecommendations);
  const statusFinding = statusSeverity(status);
  const combined = worseSeverity(flagged, statusFinding);

  const flaggedMeetsFloor = !!flagged && SEVERITY_RANK[flagged.severity] <= SEVERITY_RANK[NEEDS_ATTENTION_FLOOR];
  const needsAttention = flaggedMeetsFloor || !!statusFinding;

  return {
    priority_severity: combined?.severity ?? null,
    reason: combined?.reason ?? null,
    needs_attention: needsAttention,
  };
}

// ─── Shared row fetch — single source of truth for both /stats and / ────────
// Both endpoints need the same joins and the same priority_severity/
// needs_attention computation; duplicating either here would let them drift
// (exactly what happened before — /stats used a separate, cruder
// status-only query and disagreed with the list once compliance/cost data
// existed). /stats calls this with no filters and no limit for a true
// org-wide count; / passes the request's type/env/search and a row cap.

type ServiceListFilters = { type?: string; env?: string; search?: string };

async function fetchServices(orgId: string, filters: ServiceListFilters, limit?: number) {
  const conditions: string[] = ['r.organization_id = $1'];
  const values: any[] = [orgId];
  let p = 2;

  if (filters.type && filters.type !== 'all') {
    const typeMap: Record<string, string[]> = {
      'load balancer': ['load-balancer', 'elb'],
      'api gateway':   ['api-gateway'],
    };
    const normalized = filters.type.toLowerCase();
    const dbTypes = typeMap[normalized] ?? [normalized];
    conditions.push(`r.resource_type = ANY($${p++}::text[])`);
    values.push(dbTypes);
  }

  if (filters.env && filters.env !== 'all') {
    conditions.push(
      `(LOWER(COALESCE(r.tags->>'environment', r.metadata->>'environment', 'production')) = LOWER($${p++}))`
    );
    values.push(filters.env);
  }

  if (filters.search) {
    conditions.push(`(r.resource_name ILIKE $${p} OR r.resource_id ILIKE $${p})`);
    values.push(`%${filters.search}%`);
    p++;
  }

  const where = conditions.join(' AND ');
  const limitClause = limit ? `LIMIT ${Number(limit)}` : '';

  const { rows } = await pool.query(
    `SELECT
       r.id,
       COALESCE(r.resource_name, r.resource_id)           AS name,
       r.resource_id,
       r.resource_type                                     AS type,
       COALESCE(r.tags->>'environment', r.metadata->>'environment', 'production') AS environment,
       COALESCE(r.tags->>'region', r.metadata->>'region')  AS region,
       r.status                                            AS raw_status,
       r.estimated_monthly_cost                            AS monthly_cost,
       r.tags->>'owner'                                    AS owner,
       r.tags->>'team'                                     AS team,
       r.metadata->>'last_deployed'                        AS last_deployed,
       r.last_synced_at,
       r.metadata,
       r.compliance_issues,
       (SELECT json_agg(json_build_object('issue', cr.issue, 'severity', cr.severity, 'potential_savings', cr.potential_savings))
        FROM cost_recommendations cr
        WHERE cr.organization_id = r.organization_id
          AND cr.resource_id = r.resource_id
          AND LOWER(cr.resource_type) = r.resource_type
          AND cr.status = 'ACTIVE'
       ) AS cost_recommendations
     FROM aws_resources r
     WHERE ${where}
     ORDER BY r.resource_name ASC NULLS LAST, r.resource_id ASC
     ${limitClause}`,
    values
  );

  return rows.map((row) => {
    const status = mapStatus(row.type, row.raw_status);
    const { priority_severity, reason, needs_attention } = derivePrioritySeverity(status, row.compliance_issues, row.cost_recommendations);
    return {
      id:           row.id,
      name:         row.name,
      type:         row.type,
      environment:  row.environment,
      region:       row.region,
      status,
      // No real monitoring data source exists yet — null rather than a fabricated figure.
      uptime:       null,
      owner:        row.owner  ?? null,
      team:         row.team   ?? null,
      monthly_cost: row.monthly_cost !== null && row.monthly_cost !== undefined ? parseFloat(row.monthly_cost) : null,
      last_deployed: row.last_deployed ?? row.last_synced_at ?? null,
      metadata:     row.metadata ?? {},
      priority_severity,
      needs_attention,
      reason,
    };
  });
}

// ─── GET /api/services/stats ─────────────────────────────────────────────────
// Must be registered before /:id or Express treats "stats" as an id param

router.get('/stats', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    if (!orgId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    // No filters, no limit — a true org-wide count, computed via the exact
    // same priority_severity logic as the list below so the two can never
    // disagree on what "needs attention" means.
    const services = await fetchServices(orgId, {});
    const total          = services.length;
    const needsAttention = services.filter((s) => s.needs_attention).length;
    const healthy        = total - needsAttention;

    // No real monitoring data source exists yet — avg_uptime is intentionally null
    // rather than a fabricated figure.
    res.json({ success: true, stats: { total, healthy, needs_attention: needsAttention, avg_uptime: null } });
  } catch (err: any) {
    console.error('[Services/stats]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/services/discover ─────────────────────────────────────────────

router.post('/discover', authenticateToken, checkDiscoveryLimit, async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.organizationId;
    if (!orgId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

    console.log(`[Services/discover] Starting for org ${orgId}`);
    const result = await discoveryService.discoverAllResources(orgId);

    res.json({
      success:    true,
      message:    `Discovery complete — ${result.resources_discovered} new, ${result.resources_updated} updated`,
      discovered: result.resources_discovered,
      updated:    result.resources_updated,
      errors:     result.errors,
      jobId:      result.job_id,
    });
  } catch (err: any) {
    console.error('[Services/discover]', err);
    if (err.message?.startsWith('AWS_NOT_CONNECTED:')) {
      res.status(409).json({ error: 'aws_not_connected', message: 'Please connect your AWS account in Settings to run audits.' });
      return;
    }
    res.status(500).json({ success: false, error: err.message || 'Discovery failed — check AWS connection' });
  }
});

// ─── GET /api/services — aws_resources-backed list ───────────────────────────

router.get('/', authenticateToken, checkResourceLimit('services', 0), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Only intercept if the org is authenticated — fall through to controller otherwise
  const orgId = req.organizationId;
  if (!orgId) {
    // No org context → fall through to legacy controller (unauthenticated callers)
    return next();
  }

  try {
    const { type, env, search } = req.query as Record<string, string>;
    const services = await fetchServices(orgId, { type, env, search }, 500);

    res.json({ success: true, services, total: services.length });
  } catch (err: any) {
    console.error('[Services/list]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/services/:id — aws_resources-backed detail ─────────────────────

router.get('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const orgId = req.organizationId;
  if (!orgId) return next();

  // Try aws_resources first (UUID match)
  try {
    const { rows } = await pool.query(
      `SELECT * FROM aws_resources WHERE id = $1 AND organization_id = $2`,
      [req.params.id, orgId]
    );

    if (rows.length > 0) {
      const row = rows[0];
      const status = mapStatus(row.resource_type, row.status);
      res.json({
        success: true,
        service: { ...row, status, uptime: null },
      });
      return;
    }
  } catch {
    // Fall through to legacy controller
  }

  // Fall through to legacy controller for services-table records
  validateParams(uuidParamSchema)(req, res, () => controller.getById(req, res, next));
});

// ─── Legacy controller routes (services table — create/update/delete) ─────────

router.post(   '/',    validateBody(createServiceSchema), (req, res, next) => controller.create(req, res, next));
router.put(    '/:id', validateParams(uuidParamSchema), validateBody(updateServiceSchema), (req, res, next) => controller.update(req, res, next));
router.delete( '/:id', validateParams(uuidParamSchema), (req, res, next) => controller.delete(req, res, next));

export default router;
