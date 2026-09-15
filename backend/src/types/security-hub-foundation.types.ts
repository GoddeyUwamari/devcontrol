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
 *
 * NOT_ESTABLISHABLE (added for PCI; CIS never needed it, since every CIS mapping entry
 * is DIRECT) is a property of the MAPPING, not of a sync/evaluation run: "DevControl
 * cannot establish this requirement using evidence sources currently supported by this
 * product." It must never be confused with:
 *   - NOT_EVALUATED: DevControl has not evaluated the requirement because required
 *     evidence/evaluation has not occurred (capability/standard/sync state-dependent —
 *     could become PASS/FAIL/UNKNOWN once evaluation actually runs).
 *   - NOT_APPLICABLE: the requirement genuinely does not apply (Security Hub's own
 *     signal, e.g. Compliance.Status = NOT_AVAILABLE on every evaluated resource).
 * A NOT_ESTABLISHABLE control is permanently that status regardless of capability/sync
 * state — it is never returned to the caller by the same code path that resolves
 * NOT_EVALUATED, and never counted toward "evaluated" in FrameworkCoverage.
 */
export type FoundationControlStatus =
  | 'PASS'
  | 'FAIL'
  | 'NOT_APPLICABLE'
  | 'UNKNOWN'
  | 'NOT_EVALUATED'
  | 'ERROR'
  | 'NOT_ESTABLISHABLE';

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
  /**
   * Raw Compliance.RelatedRequirements strings verbatim (e.g. "PCI DSS v4.0.1/1.3.1"),
   * when AWS provides them. Supporting provenance/drift-detection evidence only — the
   * static, version-pinned mapping configs (securityHubCisMapping.ts,
   * securityHubPciMapping.ts) remain the sole source of truth for framework mapping;
   * this is never parsed at evaluation time. Defaults to [] when AWS provides none.
   */
  relatedRequirements: string[];
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

/**
 * Coverage breakdown that must accompany any readiness figure — never a bare percentage.
 * `notEstablishable` counts entries permanently outside DevControl's evidence model
 * (see NOT_ESTABLISHABLE on FoundationControlStatus) — deliberately excluded from
 * `evaluated`, since an unevaluable requirement was never "evaluated" in any sense.
 */
export interface FrameworkCoverage {
  totalControls: number;
  evaluated: number;
  passed: number;
  failed: number;
  unknown: number;
  notEvaluated: number;
  notApplicable: number;
  notEstablishable: number;
  errors: number;
}

export interface FrameworkControlResult {
  /** The framework's own control/requirement number (e.g. CIS "5.3" or PCI "8.4.2") —
   *  NOT the Security Hub control ID. For PCI, multiple rows may share the same
   *  controlId when more than one Security Hub control supports the same requirement
   *  (see securityHubPciMapping.ts) — coverage counts are per mapping entry, not
   *  deduplicated by requirement number. */
  controlId: string;
  title: string;
  /** Null only for NOT_ESTABLISHABLE entries with no backing Security Hub control. */
  securityHubControlId: string | null;
  status: FoundationControlStatus;
  reason: string;
  /** DIRECT vs ADDITIONAL_EVIDENCE — absent for NOT_ESTABLISHABLE entries (no mapping
   *  backs them). This is mapping metadata, never itself a runtime compliance status —
   *  see securityHubPciMapping.ts's own docblock. */
  mappingType?: 'DIRECT' | 'ADDITIONAL_EVIDENCE';
}

export interface FrameworkReadinessResult {
  framework: 'cis' | 'pci' | 'nist';
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
