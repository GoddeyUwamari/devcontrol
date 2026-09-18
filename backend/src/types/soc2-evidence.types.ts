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
  /** Always empty as of Phase 3 -- wiring real customer_evidence.id values into this
   * column is a future combined-evaluation phase's job, not Phase 3's. Phase 3 only
   * stores customer_evidence rows; it never writes to soc2_control_evaluations. */
  customer_evidence_ids: string[];
  computed_at: Date;
}

/**
 * SOC 2 Readiness Evidence Layer -- Phase 3 (customer-provided evidence) types.
 *
 * Deliberately NOT a reuse of Soc2EvidenceObservation/Soc2EvidenceProvenance. Customer
 * evidence is a separate source of truth (see customer_evidence's migration docblock,
 * 202609181200_create_customer_evidence.sql) -- reusing the technical-observation type
 * would let a customer-evidence value type-check as OBSERVED/DERIVED, which is exactly
 * the provenance-escalation this layer must structurally prevent, not just police by
 * convention.
 */

/** Always exactly this one value for customer evidence -- a customer can never submit
 * OBSERVED or DERIVED (those describe AWS-derived facts). Assigned server-side only;
 * never accepted from a client request body. Also enforced by a DB CHECK constraint --
 * see the migration's own comment. */
export type Soc2CustomerEvidenceProvenance = 'SELF_ATTESTED';

/**
 * SUBMITTED -> REVIEWED -> EXPIRED, and SUBMITTED/REVIEWED -> SUPERSEDED.
 *
 * Deliberately not ACCEPTED. REVIEWED means only "an authorized DevControl
 * platform-staff reviewer reviewed this evidence record" -- it must never be read, by
 * any consumer of this API, as SOC 2 compliance, SOC 2 certification, SOC 2 Type II
 * certification, auditor approval, or operating effectiveness. No hard delete in v1:
 * EXPIRED and SUPERSEDED are both terminal status transitions, never a DELETE -- see
 * soc2-customer-evidence.repository.ts for the legal-transition enforcement.
 */
export type Soc2CustomerEvidenceStatus = 'SUBMITTED' | 'REVIEWED' | 'EXPIRED' | 'SUPERSEDED';

/**
 * A small, bounded, descriptive vocabulary -- not a formal compliance taxonomy. No
 * value here means "this document satisfies control X"; that judgment is exactly what
 * the REVIEWED status (a human review event) exists to make, not this field.
 */
export type Soc2CustomerEvidenceType = 'policy' | 'procedure' | 'training' | 'attestation' | 'other';

export const SOC2_CUSTOMER_EVIDENCE_TYPES: readonly Soc2CustomerEvidenceType[] = [
  'policy',
  'procedure',
  'training',
  'attestation',
  'other',
] as const;

/** One row of customer_evidence, as read from or written to the database. A separate
 * source of truth from Soc2EvidenceObservation -- see this file's Phase 3 docblock. */
export interface Soc2CustomerEvidence {
  id?: string;
  organization_id: string;
  criterion_id: string;
  evidence_type: Soc2CustomerEvidenceType;
  title: string;
  description: string | null;
  /** Customer-supplied pointer only -- never fetched, resolved, or stored as content by
   * DevControl. See customer_evidence's migration comment. */
  external_reference: string | null;
  provenance: Soc2CustomerEvidenceProvenance;
  status: Soc2CustomerEvidenceStatus;
  submitted_by: string | null;
  submitted_at: Date;
  /** Informational only -- no job or trigger reads this to change status. */
  review_date: Date | null;
  created_at?: Date;
  updated_at?: Date;
}
