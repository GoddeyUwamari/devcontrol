/**
 * SOC 2 Readiness Evidence Layer -- Phase 1 types.
 *
 * Provenance and result are deliberately separate, narrow vocabularies -- see
 * soc2_evidence_observations' migration comment and soc2-evidence.service.ts's
 * docblock for the full reasoning. Do not add PASS/FAIL/COMPLIANT/NOT_EVALUATED/
 * NOT_ESTABLISHABLE here; those belong to Security Hub's FoundationControlStatus,
 * a different axis (evaluation outcome, not evidence provenance/claim).
 */

/** Where a SOC 2 evidence observation's underlying fact came from. Phase 1 only ever
 * produces OBSERVED. DERIVED and SELF_ATTESTED are real, supported values -- not
 * placeholders -- but no Phase 1 code path constructs one. */
export type Soc2EvidenceProvenance = 'OBSERVED' | 'DERIVED' | 'SELF_ATTESTED';

/** What a single observation establishes about a criterion -- evidence FOR a claim,
 * not a framework pass/fail. UNKNOWN must be used whenever the underlying source data
 * is null, unavailable, or of unproven completeness; it must never be silently
 * upgraded to SUPPORTS or CONTRADICTS. */
export type Soc2EvidenceResult = 'SUPPORTS' | 'CONTRADICTS' | 'UNKNOWN';

export type Soc2DispositionClass =
  | 'A_OBSERVABLE'
  | 'B_DERIVABLE'
  | 'C_SELF_ATTESTED'
  | 'D_ADDITIONAL_EVIDENCE'
  | 'E_NOT_ESTABLISHABLE';

/**
 * Narrow, typed source metadata -- one member per kind of underlying evidence this
 * layer reads. Mirrors FindingEvidence's existing discriminated-union precedent
 * (SecurityGroupEvidence/IamMfaEvidence/IamAccessKeyEvidence in aws-resources.types.ts)
 * rather than a schema-less JSONB blob. Never include credentials, secrets, tokens,
 * policy documents, or a full raw AWS API response -- only enough to say which
 * check/field produced this fact.
 */
export interface AwsResourceFieldSource {
  source_type: 'aws_resource_field';
  field: 'is_encrypted' | 'is_public' | 'has_backup';
  resource_type: string;
}

export interface ComplianceIssueSource {
  source_type: 'compliance_issue';
  /** The exact ComplianceIssue.issue text this observation is keyed on. */
  issue_text: string;
  resource_type: string;
}

export interface ComplianceIssueAbsentSource {
  source_type: 'compliance_issue_absent';
  /** The exact ComplianceIssue.issue text whose absence this observation reports. */
  issue_text: string;
  resource_type: string;
}

export interface AccountSecurityFindingSource {
  source_type: 'account_security_finding';
  finding_key: string;
  resource_identifier: string;
  category: 'networking' | 'iam';
}

export interface AccountSecurityFindingAggregateSource {
  source_type: 'account_security_finding_aggregate';
  category: 'networking' | 'iam';
  /** The finding title/type this aggregate counts, e.g. 'mfa_not_enabled'. */
  finding_type: string;
  active_count: number;
}

export type Soc2EvidenceSource =
  | AwsResourceFieldSource
  | ComplianceIssueSource
  | ComplianceIssueAbsentSource
  | AccountSecurityFindingSource
  | AccountSecurityFindingAggregateSource;

/** One row of soc2_evidence_observations, as read from or written to the database. */
export interface Soc2EvidenceObservation {
  id?: string;
  organization_id: string;
  criterion_id: string;
  /** NULL only for the org-level aggregate case -- see AccountSecurityFindingAggregateSource. */
  resource_arn: string | null;
  resource_type: string;
  provenance: Soc2EvidenceProvenance;
  result: Soc2EvidenceResult;
  observed_at: Date | null;
  collected_at: Date;
  source: Soc2EvidenceSource;
  explanation: string;
  schema_version?: number;
  created_at?: Date;
}

export interface Soc2EvidenceSummary {
  supports: number;
  contradicts: number;
  unknown: number;
}

/** One row of soc2_control_evaluations -- a recomputable read-through cache, never a
 * second source of truth, never a percentage/score/pass-fail certification. */
export interface Soc2ControlEvaluation {
  id?: string;
  organization_id: string;
  criterion_id: string;
  disposition_class: Soc2DispositionClass;
  evidence_summary: Soc2EvidenceSummary;
  /** Always empty in Phase 1 -- customer_evidence does not exist yet. */
  customer_evidence_ids: string[];
  computed_at: Date;
}
