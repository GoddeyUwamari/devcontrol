/**
 * Evaluates the CIS AWS Foundations Benchmark v5.0.0 framework for one org from
 * already-persisted Security Hub state + findings (see SecurityHubSyncService for how
 * that data gets there -- this service does not call AWS itself).
 *
 * Status derivation rules (Section 8/9/23 of the spec) -- verified by
 * __tests__/security-hub-compliance.service.test.ts:
 *   capability NOT_GRANTED / NOT_AVAILABLE -> every control NOT_EVALUATED (never FAIL)
 *   capability ERROR                       -> every control ERROR (never FAIL)
 *   capability ENABLED, standard disabled  -> every control NOT_EVALUATED (never PASS/FAIL)
 *   capability ENABLED, standard enabled:
 *     any fresh ACTIVE finding with Compliance.Status = FAILED   -> FAIL
 *     all fresh ACTIVE findings NOT_AVAILABLE (SH's own signal)  -> NOT_APPLICABLE
 *     all fresh ACTIVE findings PASSED (none FAILED)             -> PASS
 *     no fresh findings for this control at all                  -> UNKNOWN (never PASS)
 * "Fresh" = last_seen_at at or after the most recent sync's start time. A finding not
 * refreshed by the latest sync (because that sync was PARTIAL and never got to it) is
 * treated as absent evidence, not as confirmed-passing evidence -- this is what makes
 * partial-pagination failures unable to manufacture a false PASS/resolution.
 */
import { SecurityHubStateRepository } from '../repositories/security-hub-state.repository';
import { SecurityHubFindingsRepository } from '../repositories/security-hub-findings.repository';
import { CIS_V5_CONTROL_MAPPINGS, CIS_AWS_FOUNDATIONS_VERSION } from '../config/securityHubCisMapping';
import { FoundationControlStatus, FrameworkControlResult, FrameworkReadinessResult } from '../types/security-hub-foundation.types';

/** Matches by ARN suffix (independent of the region prefix) -- see comment at call site. */
const CIS_V5_ARN_SUFFIX = '::standards/cis-aws-foundations-benchmark/v/5.0.0';

export class SecurityHubComplianceService {
  private stateRepo = new SecurityHubStateRepository();
  private findingsRepo = new SecurityHubFindingsRepository();

  async evaluateCis(organizationId: string): Promise<FrameworkReadinessResult> {
    const state = await this.stateRepo.get(organizationId);
    const emptyCoverage = () => ({
      totalControls: CIS_V5_CONTROL_MAPPINGS.length,
      evaluated: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      notEvaluated: CIS_V5_CONTROL_MAPPINGS.length,
      notApplicable: 0,
      errors: 0,
    });

    if (!state) {
      return {
        framework: 'cis',
        frameworkVersion: CIS_AWS_FOUNDATIONS_VERSION,
        syncStatus: 'NEVER_RUN',
        capabilityStatus: null,
        standardEnabled: null,
        evaluatedAt: null,
        coverage: emptyCoverage(),
        controls: CIS_V5_CONTROL_MAPPINGS.map((m) => ({
          controlId: m.controlId,
          title: m.title,
          securityHubControlId: m.securityHubControlId,
          status: 'NOT_EVALUATED' as FoundationControlStatus,
          reason: 'Security Hub has not been synced for this organization yet.',
        })),
      };
    }

    if (state.capabilityStatus !== 'ENABLED') {
      const reason =
        state.capabilityStatus === 'NOT_GRANTED'
          ? 'Required Security Hub permissions are not available.'
          : state.capabilityStatus === 'NOT_AVAILABLE'
            ? 'Security Hub is not enabled for this AWS environment.'
            : `Security Hub API error: ${state.capabilityError ?? 'unknown error'}`;
      const status: FoundationControlStatus = state.capabilityStatus === 'ERROR' ? 'ERROR' : 'NOT_EVALUATED';

      return {
        framework: 'cis',
        frameworkVersion: CIS_AWS_FOUNDATIONS_VERSION,
        syncStatus: state.lastSyncStatus,
        capabilityStatus: state.capabilityStatus,
        standardEnabled: null,
        evaluatedAt: state.lastSyncCompletedAt,
        coverage: status === 'ERROR' ? { ...emptyCoverage(), notEvaluated: 0, errors: CIS_V5_CONTROL_MAPPINGS.length } : emptyCoverage(),
        controls: CIS_V5_CONTROL_MAPPINGS.map((m) => ({
          controlId: m.controlId,
          title: m.title,
          securityHubControlId: m.securityHubControlId,
          status,
          reason,
        })),
      };
    }

    // Capability ENABLED -- determine whether the CIS v5.0.0 standard specifically is
    // enabled. Matched by ARN suffix (not an exact region-qualified string) so this
    // read-only evaluation never needs its own AWS call just to learn the org's
    // region -- the enabled_standards snapshot already reflects whatever region the
    // last sync actually used.
    const standardEnabled = state.enabledStandards.some((s) => s.standardsArn.endsWith(CIS_V5_ARN_SUFFIX));

    if (!standardEnabled) {
      return {
        framework: 'cis',
        frameworkVersion: CIS_AWS_FOUNDATIONS_VERSION,
        syncStatus: state.lastSyncStatus,
        capabilityStatus: state.capabilityStatus,
        standardEnabled: false,
        evaluatedAt: state.lastSyncCompletedAt,
        coverage: emptyCoverage(),
        controls: CIS_V5_CONTROL_MAPPINGS.map((m) => ({
          controlId: m.controlId,
          title: m.title,
          securityHubControlId: m.securityHubControlId,
          status: 'NOT_EVALUATED' as FoundationControlStatus,
          reason: 'Security Hub CIS AWS Foundations standard is not enabled for this account.',
        })),
      };
    }

    const freshSince = state.lastSyncStartedAt ? new Date(state.lastSyncStartedAt) : new Date(0);
    // One query for all controls, not one per control -- avoids a 40-query fan-out on
    // every readiness read.
    const findingsByControl = await this.findingsRepo.getAllFreshActiveFindingsGroupedByControl(
      organizationId,
      freshSince
    );
    const controls: FrameworkControlResult[] = CIS_V5_CONTROL_MAPPINGS.map((mapping) => ({
      controlId: mapping.controlId,
      title: mapping.title,
      securityHubControlId: mapping.securityHubControlId,
      ...deriveControlStatus(findingsByControl.get(mapping.securityHubControlId) ?? []),
    }));

    const coverage = {
      totalControls: controls.length,
      evaluated: controls.filter((c) => c.status === 'PASS' || c.status === 'FAIL').length,
      passed: controls.filter((c) => c.status === 'PASS').length,
      failed: controls.filter((c) => c.status === 'FAIL').length,
      unknown: controls.filter((c) => c.status === 'UNKNOWN').length,
      notEvaluated: controls.filter((c) => c.status === 'NOT_EVALUATED').length,
      notApplicable: controls.filter((c) => c.status === 'NOT_APPLICABLE').length,
      errors: controls.filter((c) => c.status === 'ERROR').length,
    };

    return {
      framework: 'cis',
      frameworkVersion: CIS_AWS_FOUNDATIONS_VERSION,
      syncStatus: state.lastSyncStatus,
      capabilityStatus: state.capabilityStatus,
      standardEnabled: true,
      evaluatedAt: state.lastSyncCompletedAt,
      coverage,
      controls,
    };
  }
}

/**
 * Pure function -- the core of Section 8/9's rules for a single control, given only the
 * fresh ACTIVE findings currently known for it. Exported for direct unit testing.
 */
export function deriveControlStatus(
  freshFindings: { complianceStatus: string | null }[]
): { status: FoundationControlStatus; reason: string } {
  if (freshFindings.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'No fresh Security Hub evidence is available for this control.',
    };
  }

  const hasFailed = freshFindings.some((f) => f.complianceStatus === 'FAILED');
  if (hasFailed) {
    return { status: 'FAIL', reason: 'Security Hub reports at least one failing resource for this control.' };
  }

  const allNotAvailable = freshFindings.every((f) => f.complianceStatus === 'NOT_AVAILABLE');
  if (allNotAvailable) {
    return {
      status: 'NOT_APPLICABLE',
      reason: 'Security Hub reports this control as not applicable to any evaluated resource.',
    };
  }

  const hasPassed = freshFindings.some((f) => f.complianceStatus === 'PASSED');
  if (hasPassed) {
    return { status: 'PASS', reason: 'Security Hub reports all evaluated resources passing for this control.' };
  }

  // Only WARNING/null statuses present -- insufficient to establish PASS or FAIL.
  return {
    status: 'UNKNOWN',
    reason: 'Security Hub evidence for this control is incomplete (WARNING status).',
  };
}
