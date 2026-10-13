/**
 * Response contract for GET /api/services/intelligence.
 *
 * Inventory, service grouping, recorded findings, capabilities, discovery
 * freshness, and resource health read from the Resource checks evaluator's
 * cached results. Cost is not evaluated yet and says so explicitly
 * (`state: 'not_evaluated'`) rather than carrying an amount. A field whose
 * source has no value is null -- never a default.
 *
 * Resource types and finding sources are open strings: what a type supports
 * is described by the `capabilities` map, not by this file.
 */

import type {
  HealthCheckKind,
  NoSignalReason,
  RESOURCE_HEALTH_RANGE,
  RESOURCE_HEALTH_SOURCE,
  ResourceHealthCheck,
  ResourceHealthCounts,
  ResourceHealthState,
} from '../services/resource-health';

export const SERVICES_INTELLIGENCE_CONTRACT_VERSION = '1';

export type NotEvaluated = 'not_evaluated';

/**
 * What the Resource checks evaluator last reported for the resource (see
 * services/resource-health.ts). Missing or undetermined data is `no_signal`:
 * never passing, never failing. `group` and `signal` stay null: they belong
 * to a classification policy that does not exist yet.
 */
export interface ResourceHealth {
  state: ResourceHealthState;
  group: null;
  /** Why the state is no_signal; empty for every other state. */
  reasons: Array<{ kind: NoSignalReason }>;
  signal: null;
  /** The one check that produced the state; empty when none was evaluated. */
  checks: ResourceHealthCheck[];
  /** When the evaluation this was read from ran; null when none was read. */
  evaluated_at: string | null;
  source: typeof RESOURCE_HEALTH_SOURCE | null;
}

/** Counts only. There is no rolled-up verdict for a service, so `state` stays not_evaluated. */
export interface ServiceHealth {
  state: NotEvaluated;
  resource_counts: ResourceHealthCounts;
}

/** Freshness of the evaluation every resource's health in this response was read from. */
export interface HealthFreshness {
  /** null on a miss: no resource in this response carries an evaluated result. */
  evaluated_at: string | null;
  source: typeof RESOURCE_HEALTH_SOURCE | null;
  /** The evaluator range that was read. */
  range: typeof RESOURCE_HEALTH_RANGE;
  /** hit = a cached evaluation no older than max_age_seconds was read. Nothing is evaluated on a miss. */
  cache: 'hit' | 'miss';
  max_age_seconds: number;
}

export interface ResourceCost {
  state: NotEvaluated;
  amount: null;
  basis: null;
  display: null;
}

export interface ServiceCost {
  state: NotEvaluated;
  amount: null;
  priced_resources: null;
  unpriced_resources: null;
}

/**
 * Read-only indication that an existing remediation path applies. Nothing is
 * created, scheduled, or executed by reading it; the write endpoints keep
 * their own authorization (`requires` restates it, it does not grant it).
 */
export interface Remediation {
  available: true;
  path: 'cost_recommendation_execute';
  action_type: string;
  recommendation_id: string;
  requires: { role: 'admin'; plan: 'enterprise' };
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingProvenance = 'OBSERVED' | 'DERIVED' | 'SELF_ATTESTED';
export type FindingApplicability = 'enabled' | 'disabled' | 'not_configured' | 'unavailable' | 'invalid';
export type FindingEvaluationState =
  | 'failed'
  | 'passed'
  | 'unable_to_evaluate'
  | 'error'
  | 'not_evaluated'
  | 'not_applicable';
/**
 * Why a recorded finding is not a current one:
 *   legacy_unattributed    written for a framework before frameworks had to be enabled;
 *   not_current_state      its recorded or stored state is not 'failed';
 *   not_reverified         carried forward from an earlier scan because the latest one could
 *                          not read what the check needs (verification: 'unverified');
 *   storage_unavailable    framework evaluations cannot be read, so it cannot be confirmed;
 *   no_evaluation_record   no stored evaluation backs it;
 *   stale_evaluation       the evaluation behind it predates the framework's latest finished run.
 * The last four are findings that were PRESERVED from an earlier scan rather than re-verified.
 */
export type FindingNotCurrentReason =
  | 'legacy_unattributed'
  | 'not_current_state'
  | 'not_reverified'
  | 'storage_unavailable'
  | 'no_evaluation_record'
  | 'stale_evaluation';
export type FindingEvidenceBasis = 'aws_api' | 'tag' | 'none';

export interface Finding {
  /** Detector table: `resource_scan` (aws_resources.compliance_issues) or `cost_recommendation`. */
  source: 'resource_scan' | 'cost_recommendation';
  /** The source row's id where it has one; resource_scan findings have none. */
  source_id: string | null;
  /** The detector's stable key, exactly as recorded; null when the detector records none. */
  finding_key: string | null;
  /**
   * Verification marker exactly as recorded. 'unverified' = carried forward
   * from an earlier scan that could not re-evaluate the check. null = no
   * marker recorded, which is not a statement that the finding was verified.
   */
  verification: string | null;
  /** Normalised severity; null when the recorded value is not a known level. */
  severity: FindingSeverity | null;
  /** Severity as the source states it. */
  source_severity: string | null;
  category: string | null;
  title: string | null;
  /** Evidence classification as recorded; null = none recorded. */
  provenance: FindingProvenance | null;
  /**
   * The compliance framework the entry belongs to, as recorded; null = a baseline
   * (non-framework) finding, or a cost recommendation.
   */
  framework: string | null;
  /** The framework's applicability when the entry was written, as recorded; null = none recorded. */
  applicability: FindingApplicability | null;
  /**
   * What happened when the check ran, as recorded. Independent of severity. null =
   * none recorded, which is not a statement that the check failed or passed. Any
   * recorded value other than 'failed' marks an entry that is not a current finding.
   */
  evaluation_state: FindingEvaluationState | null;
  /** What the outcome rests on, as recorded; null = none recorded. */
  evidence_basis: FindingEvidenceBasis | null;
  /** Why the entry has its evaluation_state, as recorded; null = none recorded. */
  evaluation_reason: string | null;
  /**
   * Whether the entry is a current finding. A framework finding is current only
   * when a stored evaluation of the same check for this resource is 'failed' and
   * is not stale. A baseline finding or a cost recommendation is current.
   */
  current: boolean;
  /** Why `current` is false; null when it is true. */
  not_current_reason: FindingNotCurrentReason | null;
  remediation: Remediation | null;
}

/**
 * The stored outcome of one check for one resource -- every outcome, not only
 * failures. Severity is set only on 'failed'.
 */
export interface CheckEvaluation {
  /** What the check belongs to. Only frameworks today. */
  source: { kind: 'framework'; key: string };
  check: string;
  evaluation_state: FindingEvaluationState;
  severity: FindingSeverity | null;
  evidence_basis: FindingEvidenceBasis | null;
  provenance: FindingProvenance | null;
  reason_code: string;
  /** Fixed wording for reason_code. */
  reason: string;
  /** A category, set only on 'error'. */
  error_code: string | null;
  /** null when nothing is recorded. */
  evaluated_at: string | null;
  /**
   * false = no evaluation of this check is stored for the resource, although the
   * check applies to it and its framework was evaluated. Such an entry is always
   * 'not_evaluated' and never stale: there is no stored result to be stale.
   */
  recorded: boolean;
  /** The stored evaluation predates the framework's latest finished run. */
  stale: boolean;
  /** The last real pass or fail, when the current state is not one. */
  last_conclusive: { state: 'failed' | 'passed'; at: string; severity: FindingSeverity | null } | null;
}

/** Set while the resource's last framework evaluation could not be stored. */
export interface FrameworkReconciliation {
  required: true;
  since: string;
  last_attempt_at: string;
  attempts: number;
  reason_code: string;
}

export interface FrameworkEvaluationSummary {
  framework: string;
  /** As applied by the latest finished run -- not the live setting. null = never evaluated. */
  applicability: FindingApplicability | null;
  applicability_reason_code: string | null;
  applicability_reason: string | null;
  /** The latest run that finished 'complete' or 'partial'. A failed run is never it. */
  latest_run: {
    status: 'complete' | 'partial';
    started_at: string;
    finished_at: string;
    evaluator_version: string;
  } | null;
  /** A run is in progress. Everything else here still describes the latest finished run. */
  running: boolean;
  /** The most recent attempt failed; the latest finished run above still stands. */
  last_attempt_failed: boolean;
  stale: boolean;
  stale_reason: 'no_run' | 'run_too_old' | null;
  /** Stored check outcomes for the organization's current resources, by state. */
  counts: Record<FindingEvaluationState, number> & { stale: number };
  /** Resources whose last evaluation could not be stored. */
  reconciliation_required: number;
}

export interface FrameworkEvaluationBlock {
  /**
   * unavailable = framework evaluations cannot be read from this deployment's
   * database. Nothing is then claimed about any framework: `frameworks` is empty
   * and framework findings are reported as not current (storage_unavailable).
   */
  storage: 'available' | 'unavailable';
  frameworks: FrameworkEvaluationSummary[];
}

export interface Resource {
  id: string;
  arn: string;
  resource_id: string;
  /** null = no name recorded; show `resource_id`. */
  name: string | null;
  type: string;
  /** The aws_resources.region column, not a tag. */
  region: string;
  /** Raw recorded AWS state; null when none is recorded. Not a health signal. */
  lifecycle_state: string | null;
  /** A service of the caller's organization, or null (unassigned). */
  service_id: string | null;
  /** aws_resources.last_synced_at; null when never recorded. */
  last_seen_at: string | null;
  findings: Finding[];
  /** Stored check outcomes for the resource; empty when storage is unavailable. */
  check_evaluations: CheckEvaluation[];
  framework_reconciliation: FrameworkReconciliation | null;
  health: ResourceHealth;
  cost: ResourceCost;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  /** Free-text services.owner: declared by a user, not verified. */
  owner_declared: string | null;
  team: { id: string; name: string } | null;
  resources: { count: number; by_type: Record<string, number>; items: Resource[] };
  health: ServiceHealth;
  cost: ServiceCost;
}

export interface Capability {
  discovery: {
    source: 'describe' | 'resource_explorer';
    region_scope: 'primary' | 'per_resource' | 'global';
  };
  health: {
    state: 'supported' | 'not_supported';
    kind: HealthCheckKind | null;
    counts_toward_at_risk: null;
    /** Every check the evaluator can report for the type; a resource reports one of them. */
    checks: string[];
  };
  pricing: { state: NotEvaluated; basis: null };
  tags: { collected: boolean };
  remediation: { action_types: string[] };
}

export interface Discovery {
  /** aws_accounts.region; null = no connected account. */
  primary_region: string | null;
  scope: 'single_region_plus_global';
  regions_present: string[];
  /** Latest discovery job; null = never run. */
  last_attempt: {
    job_id: string;
    started_at: string | null;
    completed_at: string | null;
    status: string;
  } | null;
  /**
   * completed_at of the latest job that finished with no recorded error.
   * null = no such job, so no freshness claim is made.
   */
  inventory_refreshed_at: string | null;
}

export interface Totals {
  resources: number;
  services: number;
  unassigned_resources: number;
}

export interface ServicesIntelligence {
  contract_version: typeof SERVICES_INTELLIGENCE_CONTRACT_VERSION;
  generated_at: string;
  organization_id: string;
  /** null = no connected account and no discovery job. */
  discovery: Discovery | null;
  /**
   * Whether the remediation service's global kill-switch currently allows
   * real execution. Informational: it grants nothing, and execution is still
   * checked when it is attempted.
   */
  remediation_execution_enabled: boolean;
  health: HealthFreshness;
  framework_evaluation: FrameworkEvaluationBlock;
  /** A type absent from the map has no described capability. */
  capabilities: Record<string, Capability>;
  totals: Totals;
  services: Service[];
  unassigned: { resources: Resource[] };
}
