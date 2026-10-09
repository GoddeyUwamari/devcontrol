/**
 * Composes the GET /api/services/intelligence response from one
 * organization's rows (see services-intelligence.repository.ts).
 *
 * Everything here is deterministic and read-only. Nothing is inferred:
 *   - health and cost are reported as not evaluated. Inventory presence,
 *     lifecycle state, stored cost estimates, and billing totals are not
 *     used to stand in for either;
 *   - findings are passed through as recorded, including their stable key
 *     and their verification marker;
 *   - remediation is an indication derived from existing ACTIVE cost
 *     recommendations. It creates, schedules, and executes nothing.
 */
import { ISSUE_EC2_IDLE_INSTANCE } from '../config/optimization-rules';
import { ActionType, assertActionAvailable, isAutomatedRemediationEnabled } from './remediation.service';
import { GENERIC_RESOURCE_TYPES } from './resourceExplorer.service';
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
  FindingProvenance,
  FindingSeverity,
  Remediation,
  Resource,
  SERVICES_INTELLIGENCE_CONTRACT_VERSION,
  Service,
  ServicesIntelligence,
} from '../types/services-intelligence.types';

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
// entry here, not a contract change. Health and pricing are not evaluated by
// this endpoint yet, so neither claims a kind or a basis.
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
      health: { state: 'not_evaluated', kind: null, counts_toward_at_risk: null },
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

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normaliseSeverity(value: unknown): FindingSeverity | null {
  if (typeof value !== 'string') return null;
  const lowered = value.toLowerCase() as FindingSeverity;
  return SEVERITIES.includes(lowered) ? lowered : null;
}

/** One aws_resources.compliance_issues entry, passed through as recorded. */
function scanFinding(issue: Record<string, unknown>): Finding {
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
    remediation: null,
  };
}

function scanFindings(complianceIssues: unknown): Finding[] {
  if (!Array.isArray(complianceIssues)) return [];
  return complianceIssues
    .filter((issue): issue is Record<string, unknown> => typeof issue === 'object' && issue !== null && !Array.isArray(issue))
    .map(scanFinding);
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

function toResource(row: IntelligenceResourceRow, recommendations: IntelligenceRecommendationRow[]): Resource {
  return {
    id: row.id,
    arn: row.resource_arn,
    resource_id: row.resource_id,
    name: row.resource_name,
    type: row.resource_type,
    region: row.region,
    lifecycle_state: row.status,
    service_id: row.service_id,
    last_seen_at: iso(row.last_synced_at),
    findings: [...scanFindings(row.compliance_issues), ...recommendations.map(recommendationFinding)],
    health: { state: 'not_evaluated', group: null, reasons: [], signal: null },
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

export function composeServicesIntelligence(
  organizationId: string,
  rows: ServicesIntelligenceRows,
  generatedAt: Date
): ServicesIntelligence {
  const recommendationsByResource = new Map<string, IntelligenceRecommendationRow[]>();
  for (const recommendation of rows.recommendations) {
    const key = recommendationKey(recommendation.resource_type, recommendation.resource_id);
    const list = recommendationsByResource.get(key) ?? [];
    list.push(recommendation);
    recommendationsByResource.set(key, list);
  }

  // Every resource lands in exactly one place: its service, or unassigned.
  const serviceIds = new Set(rows.services.map((s) => s.id));
  const byService = new Map<string, Resource[]>();
  const unassigned: Resource[] = [];
  for (const row of rows.resources) {
    const resource = toResource(
      row,
      recommendationsByResource.get(recommendationKey(row.resource_type, row.resource_id)) ?? []
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
      health: { state: 'not_evaluated', resource_counts: null },
      cost: { state: 'not_evaluated', amount: null, priced_resources: null, unpriced_resources: null },
    };
  });

  return {
    contract_version: SERVICES_INTELLIGENCE_CONTRACT_VERSION,
    generated_at: generatedAt.toISOString(),
    organization_id: organizationId,
    discovery: buildDiscovery(rows),
    remediation_execution_enabled: isAutomatedRemediationEnabled(),
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
  constructor(private readonly repository = new ServicesIntelligenceRepository()) {}

  async get(organizationId: string): Promise<ServicesIntelligence> {
    const rows = await this.repository.read(organizationId);
    return composeServicesIntelligence(organizationId, rows, new Date());
  }
}
