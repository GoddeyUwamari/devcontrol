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

// ─── Shared inventory read — single source of truth for both /stats and / ────
// Both endpoints read the same rows (this organization, not terminated) with
// the same joins, and decide needs_attention with the same predicate
// (attentionOf below); duplicating either would let them drift (exactly what
// happened before — /stats used a separate, cruder status-only query and
// disagreed with the list once compliance/cost data existed).

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

// A resource's active cost recommendations, scoped by the row's own organization.
const COST_RECOMMENDATIONS_SQL = `(SELECT json_agg(json_build_object('issue', cr.issue, 'severity', cr.severity, 'potential_savings', cr.potential_savings))
        FROM cost_recommendations cr
       WHERE cr.organization_id = r.organization_id
         AND cr.resource_id = r.resource_id
         AND LOWER(cr.resource_type) = r.resource_type
         AND cr.status = 'ACTIVE'
     )`;

/**
 * The WHERE clause of every inventory read. The explicit organization predicate
 * comes first and every filter is ANDed after it (RLS sits underneath as a
 * second layer, not a replacement).
 */
function inventoryWhere(orgId: string, filters: ServiceListFilters): { where: string; values: unknown[] } {
  // Services list/stats represent current infrastructure — a soft-terminated
  // resource (see resourceReconciliation.service.ts) is no longer a "service" and
  // must not surface here at all, let alone as a false critical/needs_attention
  // alarm via mapStatus's terminated->critical mapping below.
  const conditions: string[] = ['r.organization_id = $1', "r.status != 'terminated'"];
  const values: unknown[] = [orgId];
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

  // A substring match: %, _ and \ in the search are literal characters, not
  // LIKE wildcards or escapes.
  if (filters.search) {
    conditions.push(`(r.resource_name ILIKE $${p} ESCAPE '\\' OR r.resource_id ILIKE $${p} ESCAPE '\\')`);
    values.push(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
    p++;
  }

  return { where: conditions.join(' AND '), values };
}

/** The columns the needs-attention predicate reads. */
type AttentionInputs = {
  type: string;
  raw_status: string | null;
  compliance_issues: Parameters<typeof deriveAttention>[1];
  cost_recommendations: Parameters<typeof deriveAttention>[2];
};

/**
 * The one needs-attention predicate. The list's ?needs_attention filter, the
 * list's counts and /stats all call this, over rows read by inventoryWhere, so
 * a count and the rows it counts cannot disagree.
 */
function attentionOf(row: AttentionInputs) {
  const status = mapStatus(row.type, row.raw_status);
  return { status, ...deriveAttention(status, row.compliance_issues, row.cost_recommendations) };
}

async function fetchServices(orgId: string, filters: ServiceListFilters) {
  const { where, values } = inventoryWhere(orgId, filters);

  // One statement, so the rows, the total and the counts the list derives from
  // them all come from the same snapshot. No ORDER BY: listServices sets the
  // order (byPriorityThenName / byNameThenId), which needs needs_attention and
  // priority_severity first.
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
       ${COST_RECOMMENDATIONS_SQL} AS cost_recommendations
     FROM aws_resources r
     WHERE ${where}`,
    values
  );

  return rows.map((row) => {
    const { status, priority_severity, reason, needs_attention } = attentionOf(row);
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

type ServiceRowOut = Awaited<ReturnType<typeof fetchServices>>[number];

// The same comparison the page uses (localeCompare with 'en'), so a page the
// browser re-sorts keeps the server's order. The row id breaks every tie, so
// rows with equal names never move between pages.
const NAME_COLLATOR = new Intl.Collator('en');

function byNameThenId(a: ServiceRowOut, b: ServiceRowOut): number {
  return NAME_COLLATOR.compare(a.name ?? '', b.name ?? '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function byPriorityThenName(a: ServiceRowOut, b: ServiceRowOut): number {
  const ra = a.priority_severity ? SEVERITY_RANK[a.priority_severity] : 4;
  const rb = b.priority_severity ? SEVERITY_RANK[b.priority_severity] : 4;
  return ra - rb || byNameThenId(a, b);
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export interface ServicesListPage {
  services: ServiceRowOut[];
  pagination: { page: number; limit: number; total: number; total_pages: number; has_more: boolean };
  /** The filtered set (type/env/search) split by the predicate; ?needs_attention does not narrow these. */
  counts: { needs_attention: number; no_flagged_issues: number };
}

/**
 * One page of the list. Every number is computed over the full filtered,
 * organization-scoped set, never over the page: pagination.total is the size of
 * the set after ?needs_attention, counts split the set before it. Needs-attention
 * rows sort by severity, then name; the others by name; the row id breaks ties.
 */
async function listServices(
  orgId: string,
  filters: ServiceListFilters,
  options: { needsAttention?: boolean; page: number; limit: number }
): Promise<ServicesListPage> {
  const all = await fetchServices(orgId, filters);
  const needsAttention = all.filter((s) => s.needs_attention);
  const counts = { needs_attention: needsAttention.length, no_flagged_issues: all.length - needsAttention.length };

  const selected = options.needsAttention === true ? needsAttention.sort(byPriorityThenName)
    : options.needsAttention === false ? all.filter((s) => !s.needs_attention).sort(byNameThenId)
    : all.sort(byNameThenId);

  const total = selected.length;
  const totalPages = Math.ceil(total / options.limit);
  const start = (options.page - 1) * options.limit;
  return {
    services: selected.slice(start, start + options.limit),
    pagination: { page: options.page, limit: options.limit, total, total_pages: totalPages, has_more: options.page < totalPages },
    counts,
  };
}

/** /stats' numbers from one read of the inventory. Pure, so its parity can be tested. */
export function serviceStatsFrom(rows: AttentionInputs[]) {
  const findingsBySeverity: Record<PrioritySeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const attentionReasons = { with_finding: 0, with_cost_recommendation: 0, stopped_or_degraded: 0, failed: 0 };
  let needsAttention = 0;
  for (const row of rows) {
    for (const finding of activeComplianceFindings(row.compliance_issues)) {
      if (finding.severity in findingsBySeverity) findingsBySeverity[finding.severity]++;
    }
    const { needs_attention, causes } = attentionOf(row);
    if (needs_attention) needsAttention++;
    if (causes.finding) attentionReasons.with_finding++;
    if (causes.cost_recommendation) attentionReasons.with_cost_recommendation++;
    if (causes.status === 'warning') attentionReasons.stopped_or_degraded++;
    if (causes.status === 'critical') attentionReasons.failed++;
  }
  const total = rows.length;
  return {
    total,
    healthy: total - needsAttention,
    needs_attention: needsAttention,
    findings_by_severity: findingsBySeverity,
    attention_reasons: attentionReasons,
  };
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

    // One read of the whole inventory (no filters, no limit): a true org-wide
    // count through the same WHERE and the same needs-attention predicate as the
    // list, so the two can never disagree on what "needs attention" means.
    //
    // findings_by_severity says how many current findings of each severity the
    // resources carry (same currency rule as needs_attention:
    // isActiveComplianceFinding), so a page that labels the needs_attention count
    // can say how many are Critical instead of assuming so. attention_reasons says
    // why the needs_attention resources are counted; a resource can be in more
    // than one.
    const { where, values } = inventoryWhere(orgId, {});
    const { rows } = await pool.query(
      `SELECT r.resource_type AS type, r.status AS raw_status, r.compliance_issues,
              ${COST_RECOMMENDATIONS_SQL} AS cost_recommendations
         FROM aws_resources r
        WHERE ${where}`,
      values
    );
    const stats = serviceStatsFrom(rows);

    // Connected means what the connect flow means: the organization has an
    // aws_accounts row. POST /api/aws/accounts writes the only one (status
    // 'active'), refuses a second as "already has a connected AWS account"
    // (UNIQUE org_id), and GET /api/aws/accounts lists exactly these rows. The
    // count is independent of the inventory: resources left from an earlier
    // connection, or seeded, do not make an account connected.
    const { rows: accountRows } = await pool.query(
      'SELECT COUNT(*)::int AS connected FROM aws_accounts WHERE org_id = $1',
      [orgId]
    );
    const awsAccountsConnected: number = accountRows[0].connected;

    // No real monitoring data source exists yet — avg_uptime is intentionally null
    // rather than a fabricated figure.
    res.json({
      success: true,
      stats: {
        total: stats.total, healthy: stats.healthy, needs_attention: stats.needs_attention, avg_uptime: null,
        findings_by_severity: stats.findings_by_severity,
        attention_reasons: stats.attention_reasons,
        aws_accounts_connected: awsAccountsConnected,
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
//
// Paged with ?page (from 1) and ?limit (default DEFAULT_PAGE_SIZE, at most
// MAX_PAGE_SIZE). ?needs_attention=true lists only the resources that need
// attention, =false only the others; absent lists both.

// A repeated parameter (?env=a&env=b) arrives as an array and a bracketed one
// (?env[x]=y) as an object: the first string value is used, anything else is
// no filter.
function firstQueryValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : undefined;
}

// undefined when absent, null when present but not a positive integer.
function positiveIntegerParam(value: string | undefined): number | undefined | null {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d{0,8}$/.test(value)) return null;
  return Number(value);
}

function booleanParam(value: string | undefined): boolean | undefined | null {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

router.get('/', authenticateToken, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const orgId = req.organizationId;
  if (!orgId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

  const page = positiveIntegerParam(firstQueryValue(req.query.page));
  const limit = positiveIntegerParam(firstQueryValue(req.query.limit));
  const needsAttention = booleanParam(firstQueryValue(req.query.needs_attention));
  if (page === null)  { res.status(400).json({ success: false, error: 'page must be a positive integer' }); return; }
  if (limit === null) { res.status(400).json({ success: false, error: 'limit must be a positive integer' }); return; }
  if (needsAttention === null) { res.status(400).json({ success: false, error: 'needs_attention must be true or false' }); return; }

  try {
    const result = await listServices(orgId, {
      type:   firstQueryValue(req.query.type),
      env:    firstQueryValue(req.query.env),
      search: firstQueryValue(req.query.search),
    }, {
      needsAttention,
      page:  page ?? 1,
      // Larger requests get the largest page, not an error.
      limit: Math.min(limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    });

    // total stays at the top level for older clients; it is pagination.total.
    res.json({ success: true, services: result.services, total: result.pagination.total, pagination: result.pagination, counts: result.counts });
  } catch (err: any) {
    console.error('[Services/list]', err);
    // The real error is logged above; the response carries only a fixed message.
    res.status(500).json({ success: false, error: 'Failed to load services' });
  }
});

// ─── GET /api/services/registered — the services table ───────────────────────

/**
 * The services registered in this organization (POST /api/services), newest
 * first. These, not the discovered resources GET / returns, are what
 * dependencies and deployments reference. Scoped by an explicit
 * organization_id predicate as well as RLS; a team is named only when it
 * belongs to the same organization. Declared before /:id, which would
 * otherwise take "registered" as an id.
 */
router.get('/registered', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const orgId = req.organizationId;
  if (!orgId) { res.status(401).json({ success: false, error: 'Unauthorized' }); return; }

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.owner, s.team_id, t.name AS team_name, s.github_url, s.created_at
         FROM services s
         LEFT JOIN teams t ON t.id = s.team_id AND t.organization_id = s.organization_id
        WHERE s.organization_id = $1
        ORDER BY s.created_at DESC, s.id`,
      [orgId]
    );
    res.json({ success: true, services: rows, total: rows.length });
  } catch (err: unknown) {
    console.error('[Services/registered]', err);
    res.status(500).json({ success: false, error: 'Failed to load registered services' });
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
