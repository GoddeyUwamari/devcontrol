/**
 * Security & Compliance Readiness Foundation — shared types.
 *
 * Deliberately separate from the existing ControlStatus ('pass'|'fail'|'not_applicable')
 * used by ComplianceEngineService/compliance-controls.ts (SOC2/HIPAA). That engine is
 * untouched by this feature; these types back the new, distinct Security Hub-evidenced
 * evaluation path (CIS first).
 *
 * Three facts stay separate everywhere in this module, per the architecture:
 *   CAPABILITY  — what DevControl has actually proven via AWS API calls (this file's
 *                 SecurityHubCapabilityStatus).
 *   STANDARD    — whether a given Security Hub standard is enabled in the account
 *                 (independent of DevControl's own permission/capability).
 *   CONTROL     — the per-control evaluation result (FoundationControlStatus), which can
 *                 only be PASS/FAIL when both of the above are satisfied.
 * None of these may be collapsed into a single boolean or into each other.
 */

/** What DevControl has actually proven about Security Hub access for this org. */
export type SecurityHubCapabilityStatus = 'NOT_GRANTED' | 'NOT_AVAILABLE' | 'ENABLED' | 'ERROR';

/**
 * Foundation-level control/framework evaluation result. NOT_EVALUATED and ERROR are
 * distinct from FAIL by design — see deriveControlStatus in security-hub-compliance.service.ts.
 */
export type FoundationControlStatus =
  | 'PASS'
  | 'FAIL'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN'
  | 'NOT_EVALUATED'
  | 'ERROR';

export type SecurityHubSyncStatus = 'NEVER_RUN' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

/**
 * Canonical normalized Security Hub evidence — the only shape the rest of the app
 * (control evaluation, frontend) ever sees. Never the raw AwsSecurityFinding payload:
 * this deliberately omits Resources[].Details (which can carry IPs/hostnames/ARNs of
 * unrelated resources), ProductFields, Note, UserDefinedFields, and Remediation.Recommendation
 * text — only what's needed for control evaluation, resource identification, and
 * freshness/provenance survives normalization.
 */
export interface SecurityHubFindingEvidence {
  /** Security Hub's own finding Id (globally stable identity — never DevControl-derived). */
  findingId: string;
  productArn: string;
  region: string | null;
  title: string;
  /** DevControl's normalized severity scale, derived from Security Hub's SeverityLabel. */
  severity: 'critical' | 'high' | 'medium' | 'low' | 'informational';
  /** Native Security Hub compliance check result for this finding, when applicable. */
  complianceStatus: 'PASSED' | 'WARNING' | 'FAILED' | 'NOT_AVAILABLE' | null;
  /** AWS's own resolution signal — authoritative, unlike DevControl's own scanner findings. */
  recordState: 'ACTIVE' | 'ARCHIVED';
  workflowStatus: 'NEW' | 'NOTIFIED' | 'RESOLVED' | 'SUPPRESSED' | null;
  /** e.g. "IAM.5" — the short Security Hub control identifier, when this finding is control-based. */
  securityControlId: string | null;
  /** Standards (by StandardsId, e.g. "cis-aws-foundations-benchmark/v/5.0.0") this control belongs to. */
  associatedStandardIds: string[];
  /** Minimal resource identification only — type + id, not the full Resources[].Details blob. */
  resourceType: string | null;
  resourceId: string | null;
  /** AWS's own timestamps for this finding record. */
  securityHubCreatedAt: string;
  securityHubUpdatedAt: string;
  /** DevControl's own ingestion bookkeeping — when this row was last confirmed present. */
  lastSeenAt: string;
}

export interface SecurityHubCapabilityResult {
  status: SecurityHubCapabilityStatus;
  checkedAt: string;
  error: string | null;
}

export interface SecurityHubStandardSummary {
  standardsArn: string;
  standardsSubscriptionArn: string;
  name: string;
  enabled: boolean;
}

/** Coverage breakdown that must accompany any readiness figure — never a bare percentage. */
export interface FrameworkCoverage {
  totalControls: number;
  evaluated: number;
  passed: number;
  failed: number;
  unknown: number;
  notEvaluated: number;
  notApplicable: number;
  errors: number;
}

export interface FrameworkControlResult {
  controlId: string;
  title: string;
  securityHubControlId: string;
  status: FoundationControlStatus;
  reason: string;
}

export interface FrameworkReadinessResult {
  framework: 'cis';
  frameworkVersion: string;
  /** NEVER_RUN means no sync has ever completed for this org -- capabilityStatus below is
   *  not yet meaningful in that case (no API call has actually been attempted). */
  syncStatus: SecurityHubSyncStatus;
  capabilityStatus: SecurityHubCapabilityStatus | null;
  standardEnabled: boolean | null;
  evaluatedAt: string | null;
  coverage: FrameworkCoverage;
  controls: FrameworkControlResult[];
}
