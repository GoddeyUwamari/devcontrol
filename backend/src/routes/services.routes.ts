import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';
import { ServicesController } from '../controllers/services.controller';
import { validateBody, validateParams } from '../middleware/validation';
import { createServiceSchema, updateServiceSchema, uuidParamSchema } from '../validators/schemas';
import { authenticateToken } from '../middleware/auth.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { discoveryRateLimiter } from '../middleware/rateLimiter';
import { checkDiscoveryLimit } from '../middleware/subscription.middleware';
import { AWSResourceDiscoveryService } from '../services/awsResourceDiscovery';
import { isPlatformAwsCredentialsUnavailable, PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../services/platform-sts';
import { OrganizationAccessError, requireCurrentRole } from '../services/organization-authorization';
import { activeComplianceFindings, isActiveComplianceFinding } from '../utils/frameworkApplicability';
import { lifecycleStateFor } from '../utils/resourceLifecycle';

const router = Router();
const controller = new ServicesController();
const discoveryService = new AWSResourceDiscoveryService(pool);

/**
 * Creating, changing, or deleting a service is limited to owners and admins,
 * checked against the caller's CURRENT membership (not their JWT role
 * claim). Runs before parameter validation and before any service lookup, so
 * the answer for other roles is the same for every service id.
 */
async function requireCurrentAdminOrOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    await requireCurrentRole(pool, req.user.organizationId, req.user.userId, ['owner', 'admin']);
    next();
  } catch (err: unknown) {
    if (err instanceof OrganizationAccessError && err.statusCode === 403) {
      res.status(403).json({ success: false, error: 'Only an organization owner or admin can manage services' });
      return;
    }
    console.error('[Services] role check error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify permissions' });
  }
}

// ─── Status mapping ───────────────────────────────────────────────────────────

/**
 * The operational status a resource's stored lifecycle state stands for.
 *
 * 'unknown' is not a milder warning: it means there is no lifecycle state to judge.
 * Either the resource type has none (S3, SNS, VPC: see utils/resourceLifecycle.ts)
 * or it was not read ('unknown', as Resource Explorer-sourced rows are stored).
 * Neither says the resource is stopped or degraded, so neither raises a status
 * signal (see statusSeverity). Both used to map to 'warning'.
 */
export type OperationalStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export function mapStatus(resourceType: string, rawStatus: string | null): OperationalStatus {
  const lifecycleState = lifecycleStateFor(resourceType, rawStatus);
  if (lifecycleState === null) return 'unknown';
  const s = lifecycleState.toLowerCase();

  switch (resourceType) {
    case 'cloudfront':
      // Deployed, or a change still propagating: either way the distribution is serving.
      if (s === 'active' || s === 'in-progress') return 'healthy';
      return 'warning';

    case 'ebs':
      // 'in-use' (attached) and 'available' (unattached) are a volume's two normal states.
      if (s === 'in-use' || s === 'available') return 'healthy';
      if (s === 'error') return 'critical';
      return 'warning';

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

// Current findings only (see isActiveComplianceFinding): an entry's severity is
// consulted only once the entry is known to be a finding.
function worstComplianceIssue(allIssues: any[] | null): SeverityFinding | null {
  const issues = Array.isArray(allIssues) ? allIssues.filter((issue) => isActiveComplianceFinding(issue)) : [];
  if (issues.length === 0) return null;
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

function statusSeverity(status: OperationalStatus): SeverityFinding | null {
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
// (hits VPCs and any resource type without a specific rule) is 'medium' and
// applies to most resources regardless of real risk, which would defeat the
// point of collapsing the boring majority. (The former "change-management
// tags" signal was the other 'medium' example that motivated this floor —
// it has since been retired outright rather than just excluded here. The two
// other tag-only signals of that group are now SOC 2 framework checks, which
// run only for an enabled framework and cannot fail on a tag: see
// framework-checks.ts SOC2_CHECKS.)
//
// This floor applies to compliance/cost findings only, not to operational
// status — a stopped/terminated resource keeps surfacing at its existing
// critical/medium mapping unchanged, since "this resource isn't running" is
// an operational fact, not a compliance-finding severity level, and wasn't
// part of what this floor was scoped to address.
const NEEDS_ATTENTION_FLOOR: PrioritySeverity = 'high';

export function derivePrioritySeverity(
  status: OperationalStatus,
  complianceIssues: any[] | null,
  costRecommendations: any[] | null
): { priority_severity: PrioritySeverity | null; reason: string | null; needs_attention: boolean } {
  const { priority_severity, reason, needs_attention } = deriveAttention(status, complianceIssues, costRecommendations);
  return { priority_severity, reason, needs_attention };
}

/** Why a resource needs attention. More than one can hold at once. */
export interface AttentionCauses {
  /** A current Critical or High compliance finding. */
  finding: boolean;
  /** A HIGH cost recommendation, on a resource with no current compliance finding. */
  cost_recommendation: boolean;
  /** Its operational status: 'warning' (stopped or degraded) or 'critical' (failed). */
  status: 'warning' | 'critical' | null;
}

/**
 * derivePrioritySeverity's result plus the causes behind needs_attention. One
 * computation, so a count of resources needing attention and an account of why
 * can never disagree.
 */
export function deriveAttention(
  status: OperationalStatus,
  complianceIssues: any[] | null,
  costRecommendations: any[] | null
): { priority_severity: PrioritySeverity | null; reason: string | null; needs_attention: boolean; causes: AttentionCauses } {
  const complianceFinding = worstComplianceIssue(complianceIssues);
  const flagged = complianceFinding ?? worstCostRecommendation(costRecommendations);
  const statusFinding = statusSeverity(status);
  const combined = worseSeverity(flagged, statusFinding);

  const flaggedMeetsFloor = !!flagged && SEVERITY_RANK[flagged.severity] <= SEVERITY_RANK[NEEDS_ATTENTION_FLOOR];
  const needsAttention = flaggedMeetsFloor || !!statusFinding;

  return {
    priority_severity: combined?.severity ?? null,
    reason: combined?.reason ?? null,
    needs_attention: needsAttention,
    causes: {
      finding: flaggedMeetsFloor && !!complianceFinding,
      cost_recommendation: flaggedMeetsFloor && !complianceFinding,
      status: statusFinding ? (status === 'critical' ? 'critical' : 'warning') : null,
    },
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

// Tags keep the key case they have in AWS, and AWS convention is capitalised
// (Environment, Owner, Team), so a tag is read whatever the case of its key.
// A blank value counts as no tag, and never hides a non-blank one under
// another case of the same key.
function tagValue(key: 'environment' | 'owner' | 'team'): string {
  return `(SELECT NULLIF(BTRIM(t.value), '')
             FROM jsonb_each_text(CASE WHEN jsonb_typeof(r.tags) = 'object' THEN r.tags ELSE '{}'::jsonb END) t
            WHERE LOWER(t.key) = '${key}' AND BTRIM(t.value) <> ''
            ORDER BY t.key
            LIMIT 1)`;
}

// No environment tag means the environment is unknown: null, shown as
// "Untagged", never assumed to be production.
const ENVIRONMENT_SQL = `COALESCE(${tagValue('environment')}, NULLIF(BTRIM(r.metadata->>'environment'), ''))`;

async function fetchServices(orgId: string, filters: ServiceListFilters, limit?: number) {
  // Services list/stats represent current infrastructure — a soft-terminated
  // resource (see resourceReconciliation.service.ts) is no longer a "service" and
  // must not surface here at all, let alone as a false critical/needs_attention
  // alarm via mapStatus's terminated->critical mapping below.
  const conditions: string[] = ['r.organization_id = $1', "r.status != 'terminated'"];
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

  if (filters.env && filters.env.toLowerCase() === 'untagged') {
    conditions.push(`(${ENVIRONMENT_SQL} IS NULL OR LOWER(${ENVIRONMENT_SQL}) = 'untagged')`);
  } else if (filters.env && filters.env !== 'all') {
    conditions.push(`(LOWER(${ENVIRONMENT_SQL}) = LOWER($${p++}))`);
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
       ${ENVIRONMENT_SQL}                                  AS environment,
       COALESCE(r.tags->>'region', r.metadata->>'region')  AS region,
       r.status                                            AS raw_status,
       r.estimated_monthly_cost                            AS monthly_cost,
       ${tagValue('owner')}                                AS owner,
       ${tagValue('team')}                                 AS team,
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
      environment:  row.environment ?? null,
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

// ─── Single-row fetch, mirroring fetchServices' terminated exclusion ────────
// GET /:id below is a detail view of the same "current infrastructure" list
// fetchServices serves — a soft-terminated resource must not be reachable
// here either, let alone mapped to a false critical status via mapStatus.
// fetchServices() itself isn't reused directly because this needs a single
// id-scoped row, not the list's type/env/search filters.

export async function fetchServiceById(orgId: string, id: string) {
  const { rows } = await pool.query(
    `SELECT * FROM aws_resources WHERE id = $1 AND organization_id = $2 AND status != 'terminated'`,
    [id, orgId]
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  const status = mapStatus(row.resource_type, row.status);
  return { ...row, status, uptime: null };
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

    // How many current findings of each severity the same resources carry. A page
    // that labels the needs_attention count has to be able to say how many of them
    // are Critical instead of assuming so. Same rows as fetchServices (this
    // organization, not terminated) and the same currency rule as needs_attention
    // (isActiveComplianceFinding), so the two cannot disagree.
    //
    // attention_reasons says why the needs_attention resources are counted: how many
    // carry a Critical or High finding, how many are there through a cost
    // recommendation, and how many through their status. A resource can be in more
    // than one. The cost recommendations are read the way fetchServices reads them.
    const { rows: findingRows } = await pool.query(
      `SELECT r.resource_type, r.status, r.compliance_issues,
              (SELECT json_agg(json_build_object('issue', cr.issue, 'severity', cr.severity, 'potential_savings', cr.potential_savings))
                 FROM cost_recommendations cr
                WHERE cr.organization_id = r.organization_id
                  AND cr.resource_id = r.resource_id
                  AND LOWER(cr.resource_type) = r.resource_type
                  AND cr.status = 'ACTIVE'
              ) AS cost_recommendations
         FROM aws_resources r
        WHERE r.organization_id = $1 AND r.status != 'terminated'`,
      [orgId]
    );
    const findingsBySeverity: Record<PrioritySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    const attentionReasons = { with_finding: 0, with_cost_recommendation: 0, stopped_or_degraded: 0, failed: 0 };
    for (const row of findingRows) {
      for (const finding of activeComplianceFindings(row.compliance_issues)) {
        if (finding.severity in findingsBySeverity) findingsBySeverity[finding.severity]++;
      }
      const { causes } = deriveAttention(mapStatus(row.resource_type, row.status), row.compliance_issues, row.cost_recommendations);
      if (causes.finding) attentionReasons.with_finding++;
      if (causes.cost_recommendation) attentionReasons.with_cost_recommendation++;
      if (causes.status === 'warning') attentionReasons.stopped_or_degraded++;
      if (causes.status === 'critical') attentionReasons.failed++;
    }

    // No real monitoring data source exists yet — avg_uptime is intentionally null
    // rather than a fabricated figure.
    res.json({
      success: true,
      stats: {
        total, healthy, needs_attention: needsAttention, avg_uptime: null,
        findings_by_severity: findingsBySeverity,
        attention_reasons: attentionReasons,
      },
    });
  } catch (err: any) {
    console.error('[Services/stats]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/services/discover ─────────────────────────────────────────────

router.post('/discover', authenticateToken, requireMember, checkDiscoveryLimit, discoveryRateLimiter, async (req: Request, res: Response): Promise<void> => {
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
      warnings:   result.warnings ?? [],
      jobId:      result.job_id,
    });
  } catch (err: any) {
    console.error('[Services/discover]', err);
    if (err.message?.startsWith('AWS_NOT_CONNECTED:')) {
      res.status(409).json({ error: 'aws_not_connected', message: 'Please connect your AWS account in Settings to run audits.' });
      return;
    }
    if (isPlatformAwsCredentialsUnavailable(err)) {
      res.status(503).json({ success: false, error: PLATFORM_AWS_UNAVAILABLE_MESSAGE });
      return;
    }
    // The real error is logged above; AWS messages can name ARNs and account
    // IDs, so the response carries only a fixed message.
    res.status(500).json({ success: false, error: 'Discovery failed. Please try again later.' });
  }
});

// ─── GET /api/services — aws_resources-backed list ───────────────────────────
// Reading the list is never blocked by a plan limit: the services limit counts
// the registry, not the resources this list returns.

// A repeated parameter (?env=a&env=b) arrives as an array and a bracketed one
// (?env[x]=y) as an object: the first string value is used, anything else is
// no filter.
function firstQueryValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : undefined;
}

router.get('/', authenticateToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const orgId = req.organizationId;
  if (!orgId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

  try {
    const services = await fetchServices(orgId, {
      type:   firstQueryValue(req.query.type),
      env:    firstQueryValue(req.query.env),
      search: firstQueryValue(req.query.search),
    }, 500);

    res.json({ success: true, services, total: services.length });
  } catch (err: any) {
    console.error('[Services/list]', err);
    // The real error is logged above; the response carries only a fixed message.
    res.status(500).json({ success: false, error: 'Failed to load services' });
  }
});

// ─── GET /api/services/:id — aws_resources-backed detail ─────────────────────

router.get('/:id', authenticateToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const orgId = req.organizationId;
  if (!orgId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

  // Try aws_resources first (UUID match)
  try {
    const service = await fetchServiceById(orgId, req.params.id);
    if (service) {
      res.json({ success: true, service });
      return;
    }
  } catch {
    // Fall through to legacy controller
  }

  // Fall through to legacy controller for services-table records
  validateParams(uuidParamSchema)(req, res, () => controller.getById(req, res, next));
});

// ─── Legacy controller routes (services table — create/update/delete) ─────────

router.post(   '/',    authenticateToken, requireCurrentAdminOrOwner, validateBody(createServiceSchema), (req, res, next) => controller.create(req, res, next));
router.put(    '/:id', authenticateToken, requireCurrentAdminOrOwner, validateParams(uuidParamSchema), validateBody(updateServiceSchema), (req, res, next) => controller.update(req, res, next));
router.delete( '/:id', authenticateToken, requireCurrentAdminOrOwner, validateParams(uuidParamSchema), (req, res, next) => controller.delete(req, res, next));

export default router;
