/**
 * Composes the GET /api/services/intelligence response from one
 * organization's rows (see services-intelligence.repository.ts).
 *
 * Everything here is deterministic and read-only. Nothing is inferred:
 *   - health is what the Resource checks evaluator last reported, read from
 *     its cache (see resource-health.ts). This never evaluates and never
 *     calls AWS: with no recent evaluation, a resource is no_signal;
 *   - cost is reported as not evaluated. Stored cost estimates and billing
 *     totals are not used to stand in for it;
 *   - findings are passed through as recorded, including their stable key
 *     and their verification marker;
 *   - remediation is an indication derived from existing ACTIVE cost
 *     recommendations. It creates, schedules, and executes nothing.
 */
import { ISSUE_EC2_IDLE_INSTANCE } from '../config/optimization-rules';
import { ActionType, assertActionAvailable, isAutomatedRemediationEnabled } from './remediation.service';
import { GENERIC_RESOURCE_TYPES } from './resourceExplorer.service';
import { CloudWatchMetrics, CloudWatchServiceHealth, cloudWatchService } from './cloudwatch.service';
import {
  countByState,
  RESOURCE_HEALTH_MAX_AGE_MS,
  RESOURCE_HEALTH_RANGE,
  RESOURCE_HEALTH_SOURCE,
  resourceHealthFrom,
  supportedChecksForType,
} from './resource-health';
import {
  IntelligenceRecommendationRow,
  IntelligenceResourceRow,
  ServicesIntelligenceRepository,
  ServicesIntelligenceRows,
} from '../repositories/services-intelligence.repository';
import {
  Capability,
  Discovery,
  Finding,
  CheckEvaluation,
  FindingApplicability,
  FindingEvaluationState,
  FindingEvidenceBasis,
  FindingNotCurrentReason,
  FrameworkEvaluationBlock,
  FrameworkEvaluationSummary,
  FindingProvenance,
  FindingSeverity,
  Remediation,
  Resource,
  SERVICES_INTELLIGENCE_CONTRACT_VERSION,
  Service,
  ServicesIntelligence,
} from '../types/services-intelligence.types';
import { REGISTERED_FRAMEWORKS, evaluationReasonText, isActiveComplianceFinding } from '../utils/frameworkApplicability';
import { lifecycleStateFor } from '../utils/resourceLifecycle';
import { FRAMEWORK_CHECKS, checkAppliesTo } from './framework-checks';
import {
  CheckEvaluationRow,
  FrameworkEvaluationRows,
  ReconciliationRow,
} from '../repositories/framework-evaluations.repository';

// ─── Remediation eligibility ────────────────────────────────────────────────
// One entry per cost recommendation that an existing endpoint can act on.
// Today that is only what POST /api/cost-recommendations/:id/execute-remediation
// accepts (cost-recommendations.controller.ts executeRemediation): an Idle
// Instance recommendation on EC2, which stops the instance. `requires` restates
// that route's gates.
interface RecommendationRemediationRule {
  /** cost_recommendations.resource_type, compared exactly as the route does. */
  recommendationResourceType: string;
  issue: string;
  path: Remediation['path'];
  actionType: ActionType;
  requires: Remediation['requires'];
}

export const RECOMMENDATION_REMEDIATION_RULES: readonly RecommendationRemediationRule[] = [
  {
    recommendationResourceType: 'EC2',
    issue: ISSUE_EC2_IDLE_INSTANCE,
    path: 'cost_recommendation_execute',
    actionType: 'stop_instance',
    requires: { role: 'admin', plan: 'enterprise' },
  },
];

/** False for an action the remediation service refuses to run (e.g. rightsize_instance). */
function isActionAvailable(actionType: ActionType): boolean {
  try {
    assertActionAvailable(actionType);
    return true;
  } catch {
    return false;
  }
}

function remediationFor(recommendation: IntelligenceRecommendationRow): Remediation | null {
  const rule = RECOMMENDATION_REMEDIATION_RULES.find(
    (r) => r.recommendationResourceType === recommendation.resource_type && r.issue === recommendation.issue
  );
  if (!rule || !isActionAvailable(rule.actionType)) return null;
  return {
    available: true,
    path: rule.path,
    action_type: rule.actionType,
    recommendation_id: recommendation.id,
    requires: rule.requires,
  };
}

// ─── Capabilities ───────────────────────────────────────────────────────────
// What each resource type supports, as data. Adding a type or a signal is an
// entry here, not a contract change. Health lists the Resource checks
// evaluator's own checks for the type (resource-health.ts). Pricing is not
// evaluated by this endpoint yet, so it claims no basis.
//
// Discovery facts come from awsResourceDiscovery.ts: EC2, EBS, RDS, Lambda and
// load balancers are described in the account's primary region; S3 is listed
// account-wide and each bucket carries its own region; CloudFront is global;
// the generic types come from the primary region's Resource Explorer index.
// S3 and CloudFront rows are written with no tags.
type DiscoveryCapability = Capability['discovery'] & { tagsCollected: boolean };

const DESCRIBED_TYPES: Record<string, DiscoveryCapability> = {
  ec2: { source: 'describe', region_scope: 'primary', tagsCollected: true },
  ebs: { source: 'describe', region_scope: 'primary', tagsCollected: true },
  rds: { source: 'describe', region_scope: 'primary', tagsCollected: true },
  lambda: { source: 'describe', region_scope: 'primary', tagsCollected: true },
  'load-balancer': { source: 'describe', region_scope: 'primary', tagsCollected: true },
  s3: { source: 'describe', region_scope: 'per_resource', tagsCollected: false },
  cloudfront: { source: 'describe', region_scope: 'global', tagsCollected: false },
};

function healthCapability(type: string): Capability['health'] {
  const supported = supportedChecksForType(type);
  return supported
    ? { state: 'supported', kind: supported.kind, counts_toward_at_risk: null, checks: [...supported.checks] }
    : { state: 'not_supported', kind: null, counts_toward_at_risk: null, checks: [] };
}

export function buildCapabilities(): Record<string, Capability> {
  const discovery: Record<string, DiscoveryCapability> = { ...DESCRIBED_TYPES };
  for (const type of GENERIC_RESOURCE_TYPES) {
    discovery[type] = { source: 'resource_explorer', region_scope: 'primary', tagsCollected: true };
  }

  const capabilities: Record<string, Capability> = {};
  for (const type of Object.keys(discovery).sort()) {
    const { tagsCollected, ...source } = discovery[type];
    const actionTypes = RECOMMENDATION_REMEDIATION_RULES
      .filter((r) => r.recommendationResourceType.toLowerCase() === type && isActionAvailable(r.actionType))
      .map((r) => r.actionType as string);
    capabilities[type] = {
      discovery: source,
      health: healthCapability(type),
      pricing: { state: 'not_evaluated', basis: null },
      tags: { collected: tagsCollected },
      remediation: { action_types: Array.from(new Set(actionTypes)).sort() },
    };
  }
  return capabilities;
}

// ─── Findings ───────────────────────────────────────────────────────────────

const SEVERITIES: readonly FindingSeverity[] = ['critical', 'high', 'medium', 'low'];
const PROVENANCES: readonly FindingProvenance[] = ['OBSERVED', 'DERIVED', 'SELF_ATTESTED'];
const APPLICABILITIES: readonly FindingApplicability[] = ['enabled', 'disabled', 'not_configured', 'unavailable', 'invalid'];
const EVALUATION_STATES: readonly FindingEvaluationState[] = ['failed', 'passed', 'unable_to_evaluate', 'error', 'not_evaluated', 'not_applicable'];
const EVIDENCE_BASES: readonly FindingEvidenceBasis[] = ['aws_api', 'tag', 'none'];

/** A recorded value when it is one of the known ones, else null: an unknown value is never mapped to a known one. */
function knownOrNull<T extends string>(known: readonly T[], value: unknown): T | null {
  return known.includes(value as T) ? (value as T) : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normaliseSeverity(value: unknown): FindingSeverity | null {
  if (typeof value !== 'string') return null;
  const lowered = value.toLowerCase() as FindingSeverity;
  return SEVERITIES.includes(lowered) ? lowered : null;
}

// ─── Framework evaluations ──────────────────────────────────────────────────

/** A resource's stored check rows, by framework and check. */
type StoredChecks = Map<string, CheckEvaluationRow>;

function checkKey(framework: string, check: string): string {
  return `${framework}\u0000${check}`;
}

function storedChecksByResource(rows: FrameworkEvaluationRows | null): Map<string, StoredChecks> {
  const byResource = new Map<string, StoredChecks>();
  for (const row of rows?.checks ?? []) {
    const stored = byResource.get(row.resource_id) ?? new Map<string, CheckEvaluationRow>();
    stored.set(checkKey(row.framework, row.check), row);
    byResource.set(row.resource_id, stored);
  }
  return byResource;
}

/**
 * Whether a recorded finding is current, and if not, why. A framework finding is
 * only as good as the stored evaluation behind it: with no readable storage, no
 * stored row, a row that is not 'failed', or a stale row, it is a finding kept
 * from an earlier scan, not one this deployment can vouch for now.
 */
function findingCurrency(
  issue: Record<string, unknown>,
  storage: FrameworkEvaluationRows | null,
  stored: StoredChecks | undefined
): { current: boolean; not_current_reason: FindingNotCurrentReason | null } {
  const framework = stringOrNull(issue.framework);
  if (issue.verification === 'unverified') return { current: false, not_current_reason: 'not_reverified' };
  if (!isActiveComplianceFinding(issue)) {
    return { current: false, not_current_reason: framework === null && issue.evaluation_state == null ? 'legacy_unattributed' : 'not_current_state' };
  }
  if (framework === null) return { current: true, not_current_reason: null };

  if (storage === null) return { current: false, not_current_reason: 'storage_unavailable' };
  const row = stored?.get(checkKey(framework, stringOrNull(issue.findingKey) ?? ''));
  if (!row) return { current: false, not_current_reason: 'no_evaluation_record' };
  if (row.evaluation_state !== 'failed') return { current: false, not_current_reason: 'not_current_state' };
  if (row.stale) return { current: false, not_current_reason: 'stale_evaluation' };
  return { current: true, not_current_reason: null };
}

/** One aws_resources.compliance_issues entry, passed through as recorded. */
function scanFinding(
  issue: Record<string, unknown>,
  storage: FrameworkEvaluationRows | null,
  stored: StoredChecks | undefined
): Finding {
  const provenance = issue.provenance as FindingProvenance;
  return {
    source: 'resource_scan',
    source_id: null,
    finding_key: stringOrNull(issue.findingKey),
    verification: stringOrNull(issue.verification),
    severity: normaliseSeverity(issue.severity),
    source_severity: stringOrNull(issue.severity),
    category: stringOrNull(issue.category),
    title: stringOrNull(issue.issue),
    provenance: PROVENANCES.includes(provenance) ? provenance : null,
    framework: stringOrNull(issue.framework),
    applicability: knownOrNull(APPLICABILITIES, issue.applicability),
    evaluation_state: knownOrNull(EVALUATION_STATES, issue.evaluation_state),
    evidence_basis: knownOrNull(EVIDENCE_BASES, issue.evidence_basis),
    evaluation_reason: stringOrNull(issue.evaluation_reason),
    ...findingCurrency(issue, storage, stored),
    remediation: null,
  };
}

function scanFindings(
  complianceIssues: unknown,
  storage: FrameworkEvaluationRows | null,
  stored: StoredChecks | undefined
): Finding[] {
  if (!Array.isArray(complianceIssues)) return [];
  return complianceIssues
    .filter((issue): issue is Record<string, unknown> => typeof issue === 'object' && issue !== null && !Array.isArray(issue))
    .map((issue) => scanFinding(issue, storage, stored));
}

function storedCheckEvaluation(row: CheckEvaluationRow): CheckEvaluation {
  return {
    source: { kind: 'framework', key: row.framework },
    check: row.check,
    evaluation_state: row.evaluation_state,
    // Severity belongs to a failure and to nothing else, whatever is stored.
    severity: row.evaluation_state === 'failed' ? normaliseSeverity(row.severity) : null,
    evidence_basis: knownOrNull(EVIDENCE_BASES, row.evidence_basis),
    provenance: knownOrNull(PROVENANCES, row.provenance),
    reason_code: row.reason_code,
    reason: evaluationReasonText(row.reason_code),
    error_code: row.evaluation_state === 'error' ? row.error_code : null,
    evaluated_at: row.evaluated_at.toISOString(),
    recorded: true,
    stale: row.stale,
    last_conclusive:
      row.last_conclusive_state && row.last_conclusive_at && row.evaluation_state !== row.last_conclusive_state
        ? {
            state: row.last_conclusive_state,
            at: row.last_conclusive_at.toISOString(),
            severity: row.last_conclusive_state === 'failed' ? normaliseSeverity(row.last_conclusive_severity) : null,
          }
        : null,
  };
}

/**
 * The resource's stored check outcomes, plus one 'not_evaluated' entry for each
 * check that applies to it, belongs to a framework whose latest finished run
 * evaluated it (applicability enabled), and has no stored row. Those entries are
 * marked `recorded: false` and are never stale: nothing is stored to be stale.
 */
function checkEvaluationsFor(
  resourceType: string,
  storage: FrameworkEvaluationRows | null,
  stored: StoredChecks | undefined
): CheckEvaluation[] {
  if (storage === null) return [];
  const evaluations = Array.from(stored?.values() ?? []).map(storedCheckEvaluation);

  for (const run of storage.latestRuns) {
    if (run.applicability !== 'enabled') continue;
    for (const check of FRAMEWORK_CHECKS[run.framework] ?? []) {
      if (!checkAppliesTo(check, resourceType) || stored?.has(checkKey(run.framework, check.key))) continue;
      evaluations.push({
        source: { kind: 'framework', key: run.framework },
        check: check.key,
        evaluation_state: 'not_evaluated',
        severity: null,
        evidence_basis: null,
        provenance: null,
        reason_code: 'no_evaluation_recorded',
        reason: evaluationReasonText('no_evaluation_recorded'),
        error_code: null,
        evaluated_at: null,
        recorded: false,
        stale: false,
        last_conclusive: null,
      });
    }
  }
  return evaluations.sort((a, b) => a.source.key.localeCompare(b.source.key) || a.check.localeCompare(b.check));
}

const ZERO_COUNTS = (): FrameworkEvaluationSummary['counts'] => ({
  failed: 0, passed: 0, unable_to_evaluate: 0, error: 0, not_evaluated: 0, not_applicable: 0, stale: 0,
});

/**
 * One entry per registered framework and per framework that has a run. Describes
 * the latest FINISHED run: a run in progress or a failed attempt is flagged
 * beside it and never replaces it.
 */
function buildFrameworkEvaluation(rows: ServicesIntelligenceRows): FrameworkEvaluationBlock {
  const storage = rows.frameworkEvaluations;
  if (storage === null) return { storage: 'unavailable', frameworks: [] };

  const inScope = new Set(rows.resources.map((r) => r.id));
  const latest = new Map(storage.latestRuns.map((run) => [run.framework, run]));
  const activity = new Map(storage.activity.map((a) => [a.framework, a]));
  const names = new Set<string>([...REGISTERED_FRAMEWORKS.map((f) => f.key), ...latest.keys(), ...activity.keys()]);

  const counts = new Map<string, FrameworkEvaluationSummary['counts']>();
  for (const row of storage.checks) {
    if (!inScope.has(row.resource_id)) continue;
    const tally = counts.get(row.framework) ?? ZERO_COUNTS();
    if (EVALUATION_STATES.includes(row.evaluation_state)) tally[row.evaluation_state]++;
    if (row.stale) tally.stale++;
    counts.set(row.framework, tally);
  }
  const reconciliationRequired = storage.reconciliations.filter((r) => inScope.has(r.resource_id)).length;

  return {
    storage: 'available',
    frameworks: Array.from(names).sort().map((framework) => {
      const run = latest.get(framework);
      return {
        framework,
        applicability: run ? knownOrNull(APPLICABILITIES, run.applicability) : null,
        applicability_reason_code: run ? run.applicability_reason_code : null,
        applicability_reason: run ? evaluationReasonText(run.applicability_reason_code) : null,
        latest_run: run
          ? {
              status: run.status,
              started_at: run.started_at.toISOString(),
              finished_at: run.finished_at.toISOString(),
              evaluator_version: run.evaluator_version,
            }
          : null,
        running: activity.get(framework)?.running ?? false,
        last_attempt_failed: activity.get(framework)?.last_attempt_failed ?? false,
        stale: !run || run.aged,
        stale_reason: !run ? 'no_run' : run.aged ? 'run_too_old' : null,
        counts: counts.get(framework) ?? ZERO_COUNTS(),
        reconciliation_required: reconciliationRequired,
      };
    }),
  };
}

function recommendationFinding(recommendation: IntelligenceRecommendationRow): Finding {
  return {
    source: 'cost_recommendation',
    source_id: recommendation.id,
    finding_key: null,
    verification: null,
    severity: normaliseSeverity(recommendation.severity),
    source_severity: stringOrNull(recommendation.severity),
    category: 'cost',
    title: stringOrNull(recommendation.issue),
    provenance: null,
    framework: null,
    applicability: null,
    evaluation_state: null,
    evidence_basis: null,
    evaluation_reason: null,
    current: true,
    not_current_reason: null,
    remediation: remediationFor(recommendation),
  };
}

// ─── Composition ────────────────────────────────────────────────────────────

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

/** Same link the existing services list uses between a recommendation and a resource. */
function recommendationKey(resourceType: string, resourceId: string): string {
  return `${resourceType.toLowerCase()}\u0000${resourceId}`;
}

function toResource(
  row: IntelligenceResourceRow,
  recommendations: IntelligenceRecommendationRow[],
  evaluation: CloudWatchMetrics | null,
  evaluatedRow: CloudWatchServiceHealth | undefined,
  storage: FrameworkEvaluationRows | null,
  stored: StoredChecks | undefined,
  reconciliation: ReconciliationRow | undefined
): Resource {
  const health = resourceHealthFrom(
    { type: row.resource_type, lifecycleState: lifecycleStateFor(row.resource_type, row.status), metadataType: row.metadata_type },
    evaluation,
    evaluatedRow
  );
  return {
    id: row.id,
    arn: row.resource_arn,
    resource_id: row.resource_id,
    name: row.resource_name,
    type: row.resource_type,
    region: row.region,
    // null for a type with no lifecycle status (stored 'not_applicable') and for one not read.
    lifecycle_state: lifecycleStateFor(row.resource_type, row.status),
    service_id: row.service_id,
    last_seen_at: iso(row.last_synced_at),
    findings: [...scanFindings(row.compliance_issues, storage, stored), ...recommendations.map(recommendationFinding)],
    check_evaluations: checkEvaluationsFor(row.resource_type, storage, stored),
    framework_reconciliation: reconciliation
      ? {
          required: true,
          since: reconciliation.first_failed_at.toISOString(),
          last_attempt_at: reconciliation.last_failed_at.toISOString(),
          attempts: reconciliation.failure_count,
          reason_code: reconciliation.failure_code,
        }
      : null,
    health: {
      state: health.state,
      group: null,
      reasons: health.reasons,
      signal: null,
      checks: health.checks,
      evaluated_at: health.evaluated_at,
      source: health.source,
    },
    cost: { state: 'not_evaluated', amount: null, basis: null, display: null },
  };
}

function buildDiscovery(rows: ServicesIntelligenceRows): Discovery | null {
  if (!rows.hasConnectedAccount && !rows.lastDiscoveryJob) return null;
  const job = rows.lastDiscoveryJob;
  return {
    primary_region: rows.primaryRegion,
    scope: 'single_region_plus_global',
    regions_present: Array.from(new Set(rows.resources.map((r) => r.region))).sort(),
    last_attempt: job
      ? { job_id: job.id, started_at: iso(job.started_at), completed_at: iso(job.completed_at), status: job.status }
      : null,
    inventory_refreshed_at: iso(rows.inventoryRefreshedAt),
  };
}

/**
 * `evaluation` is the Resource checks evaluator's cached result for THIS
 * organization, or null when there is none recent enough. Its rows are joined
 * to resources by aws_resources.id, and only to the rows read for this
 * organization, so a row for any other resource is never used.
 */
export function composeServicesIntelligence(
  organizationId: string,
  rows: ServicesIntelligenceRows,
  generatedAt: Date,
  evaluation: CloudWatchMetrics | null = null
): ServicesIntelligence {
  const evaluatedById = new Map<string, CloudWatchServiceHealth>();
  for (const evaluated of evaluation?.services ?? []) evaluatedById.set(evaluated.resourceDbId, evaluated);

  const recommendationsByResource = new Map<string, IntelligenceRecommendationRow[]>();
  for (const recommendation of rows.recommendations) {
    const key = recommendationKey(recommendation.resource_type, recommendation.resource_id);
    const list = recommendationsByResource.get(key) ?? [];
    list.push(recommendation);
    recommendationsByResource.set(key, list);
  }

  const storedByResource = storedChecksByResource(rows.frameworkEvaluations);
  const reconciliationByResource = new Map(
    (rows.frameworkEvaluations?.reconciliations ?? []).map((r) => [r.resource_id, r])
  );

  // Every resource lands in exactly one place: its service, or unassigned.
  const serviceIds = new Set(rows.services.map((s) => s.id));
  const byService = new Map<string, Resource[]>();
  const unassigned: Resource[] = [];
  for (const row of rows.resources) {
    const resource = toResource(
      row,
      recommendationsByResource.get(recommendationKey(row.resource_type, row.resource_id)) ?? [],
      evaluation,
      evaluatedById.get(row.id),
      rows.frameworkEvaluations,
      storedByResource.get(row.id),
      reconciliationByResource.get(row.id)
    );
    if (resource.service_id && serviceIds.has(resource.service_id)) {
      const list = byService.get(resource.service_id) ?? [];
      list.push(resource);
      byService.set(resource.service_id, list);
    } else {
      unassigned.push({ ...resource, service_id: null });
    }
  }

  const services: Service[] = rows.services.map((service) => {
    const items = byService.get(service.id) ?? [];
    const byType: Record<string, number> = {};
    for (const item of items) byType[item.type] = (byType[item.type] ?? 0) + 1;
    return {
      id: service.id,
      name: service.name,
      description: service.description,
      owner_declared: service.owner,
      team: service.team_id && service.team_name ? { id: service.team_id, name: service.team_name } : null,
      resources: { count: items.length, by_type: byType, items },
      health: { state: 'not_evaluated', resource_counts: countByState(items.map((item) => item.health.state)) },
      cost: { state: 'not_evaluated', amount: null, priced_resources: null, unpriced_resources: null },
    };
  });

  return {
    contract_version: SERVICES_INTELLIGENCE_CONTRACT_VERSION,
    generated_at: generatedAt.toISOString(),
    organization_id: organizationId,
    discovery: buildDiscovery(rows),
    remediation_execution_enabled: isAutomatedRemediationEnabled(),
    health: {
      evaluated_at: evaluation ? evaluation.capturedAt : null,
      source: evaluation ? RESOURCE_HEALTH_SOURCE : null,
      range: RESOURCE_HEALTH_RANGE,
      cache: evaluation ? 'hit' : 'miss',
      max_age_seconds: RESOURCE_HEALTH_MAX_AGE_MS / 1000,
    },
    framework_evaluation: buildFrameworkEvaluation(rows),
    capabilities: buildCapabilities(),
    totals: {
      resources: rows.resources.length,
      services: rows.services.length,
      unassigned_resources: unassigned.length,
    },
    services,
    unassigned: { resources: unassigned },
  };
}

export class ServicesIntelligenceService {
  constructor(
    private readonly repository = new ServicesIntelligenceRepository(),
    private readonly evaluations: Pick<typeof cloudWatchService, 'peekCachedMetrics'> = cloudWatchService
  ) {}

  async get(organizationId: string): Promise<ServicesIntelligence> {
    const rows = await this.repository.read(organizationId);
    // A cache read only: no evaluation is started and no AWS call is made. The
    // key is the caller's own organization. A cached "no connected account"
    // answer (data: null) carries no evaluation, so it reads as a miss.
    const evaluation = this.evaluations.peekCachedMetrics(organizationId, RESOURCE_HEALTH_MAX_AGE_MS)?.data ?? null;
    return composeServicesIntelligence(organizationId, rows, new Date(), evaluation);
  }
}
