/**
 * Evaluates Security Hub-backed frameworks (CIS AWS Foundations Benchmark v5.0.0, PCI
 * DSS v4.0.1) for one org from already-persisted Security Hub state + findings (see
 * SecurityHubSyncService for how that data gets there -- this service does not call AWS
 * itself). Both frameworks share the exact same underlying evidence (one sync serves
 * both, see security-hub-sync.service.ts) and the exact same evaluation mechanics
 * (evaluateFramework below) -- only their mapping configuration and standard ARN
 * differ.
 *
 * Status derivation rules (verified by __tests__/security-hub-compliance.service.test.ts):
 *   capability NOT_GRANTED / NOT_AVAILABLE -> every mapped control NOT_EVALUATED (never FAIL)
 *   capability ERROR                       -> every mapped control ERROR (never FAIL)
 *   capability ENABLED, standard disabled  -> every mapped control NOT_EVALUATED (never PASS/FAIL)
 *   capability ENABLED, standard enabled:
 *     any fresh ACTIVE finding with Compliance.Status = FAILED   -> FAIL
 *     all fresh ACTIVE findings NOT_AVAILABLE (SH's own signal)  -> NOT_APPLICABLE
 *     all fresh ACTIVE findings PASSED (none FAILED)             -> PASS
 *     no fresh findings for this control at all                  -> UNKNOWN (never PASS)
 *   NOT_ESTABLISHABLE entries (PCI only, e.g. PCI Requirement 9 physical security) are
 *     unconditionally NOT_ESTABLISHABLE in every state above -- this is a property of
 *     DevControl's evidence model, not of sync/capability state; see
 *     securityHubPciMapping.ts's own docblock for why these are curated explicitly
 *     rather than derived.
 * "Fresh" = last_seen_at at or after the most recent sync's start time. A finding not
 * refreshed by the latest sync (because that sync was PARTIAL and never got to it) is
 * treated as absent evidence, not as confirmed-passing evidence -- this is what makes
 * partial-pagination failures unable to manufacture a false PASS/resolution.
 */
import { SecurityHubStateRepository } from '../repositories/security-hub-state.repository';
import { SecurityHubFindingsRepository } from '../repositories/security-hub-findings.repository';
import { CIS_V5_CONTROL_MAPPINGS, CIS_AWS_FOUNDATIONS_VERSION } from '../config/securityHubCisMapping';
import {
  PCI_V4_CONTROL_MAPPINGS,
  PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS,
  PCI_DSS_VERSION,
} from '../config/securityHubPciMapping';
import { FoundationControlStatus, FrameworkControlResult, FrameworkReadinessResult } from '../types/security-hub-foundation.types';

/** Matches by ARN suffix (independent of the region prefix) -- see comment at call site. */
const CIS_V5_ARN_SUFFIX = '::standards/cis-aws-foundations-benchmark/v/5.0.0';
const PCI_V4_ARN_SUFFIX = '::standards/pci-dss/v/4.0.1';

interface ControlMappingEntry {
  controlId: string;
  title: string;
  securityHubControlId: string;
  mappingType: 'DIRECT' | 'ADDITIONAL_EVIDENCE';
}

interface NotEstablishableEntry {
  controlId: string;
  title: string;
  reason: string;
}

interface FrameworkEvalConfig {
  framework: 'cis' | 'pci';
  frameworkVersion: string;
  standardArnSuffix: string;
  controlMappings: ControlMappingEntry[];
  notEstablishableRequirements: NotEstablishableEntry[];
}

const CIS_CONFIG: FrameworkEvalConfig = {
  framework: 'cis',
  frameworkVersion: CIS_AWS_FOUNDATIONS_VERSION,
  standardArnSuffix: CIS_V5_ARN_SUFFIX,
  controlMappings: CIS_V5_CONTROL_MAPPINGS.map((m) => ({
    controlId: m.controlId,
    title: m.title,
    securityHubControlId: m.securityHubControlId,
    mappingType: m.mappingType,
  })),
  notEstablishableRequirements: [],
};

const PCI_CONFIG: FrameworkEvalConfig = {
  framework: 'pci',
  frameworkVersion: PCI_DSS_VERSION,
  standardArnSuffix: PCI_V4_ARN_SUFFIX,
  controlMappings: PCI_V4_CONTROL_MAPPINGS.map((m) => ({
    controlId: m.pciRequirementId,
    title: m.title,
    securityHubControlId: m.securityHubControlId,
    mappingType: m.mappingType,
  })),
  notEstablishableRequirements: PCI_V4_NOT_ESTABLISHABLE_REQUIREMENTS.map((r) => ({
    controlId: r.pciRequirementId,
    title: r.title,
    reason: r.reason,
  })),
};

export class SecurityHubComplianceService {
  private stateRepo = new SecurityHubStateRepository();
  private findingsRepo = new SecurityHubFindingsRepository();

  async evaluateCis(organizationId: string): Promise<FrameworkReadinessResult> {
    return this.evaluateFramework(organizationId, CIS_CONFIG);
  }

  async evaluatePci(organizationId: string): Promise<FrameworkReadinessResult> {
    return this.evaluateFramework(organizationId, PCI_CONFIG);
  }

  private async evaluateFramework(organizationId: string, config: FrameworkEvalConfig): Promise<FrameworkReadinessResult> {
    const state = await this.stateRepo.get(organizationId);
    const totalControls = config.controlMappings.length + config.notEstablishableRequirements.length;

    const notEstablishableResults: FrameworkControlResult[] = config.notEstablishableRequirements.map((r) => ({
      controlId: r.controlId,
      title: r.title,
      securityHubControlId: null,
      status: 'NOT_ESTABLISHABLE' as FoundationControlStatus,
      reason: r.reason,
    }));

    const emptyCoverage = (notEvaluatedCount: number) => ({
      totalControls,
      evaluated: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      notEvaluated: notEvaluatedCount,
      notApplicable: 0,
      notEstablishable: config.notEstablishableRequirements.length,
      errors: 0,
    });

    if (!state) {
      return {
        framework: config.framework,
        frameworkVersion: config.frameworkVersion,
        syncStatus: 'NEVER_RUN',
        capabilityStatus: null,
        standardEnabled: null,
        evaluatedAt: null,
        coverage: emptyCoverage(config.controlMappings.length),
        controls: [
          ...config.controlMappings.map((m) => ({
            controlId: m.controlId,
            title: m.title,
            securityHubControlId: m.securityHubControlId,
            status: 'NOT_EVALUATED' as FoundationControlStatus,
            reason: 'Security Hub has not been synced for this organization yet.',
            mappingType: m.mappingType,
          })),
          ...notEstablishableResults,
        ],
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

      const coverage =
        status === 'ERROR'
          ? { ...emptyCoverage(0), errors: config.controlMappings.length }
          : emptyCoverage(config.controlMappings.length);

      return {
        framework: config.framework,
        frameworkVersion: config.frameworkVersion,
        syncStatus: state.lastSyncStatus,
        capabilityStatus: state.capabilityStatus,
        standardEnabled: null,
        evaluatedAt: state.lastSyncCompletedAt,
        coverage,
        controls: [
          ...config.controlMappings.map((m) => ({
            controlId: m.controlId,
            title: m.title,
            securityHubControlId: m.securityHubControlId,
            status,
            reason,
            mappingType: m.mappingType,
          })),
          ...notEstablishableResults,
        ],
      };
    }

    // Capability ENABLED -- determine whether this specific standard is enabled.
    // Matched by ARN suffix (not an exact region-qualified string) so this read-only
    // evaluation never needs its own AWS call just to learn the org's region -- the
    // enabled_standards snapshot already reflects whatever region the last sync used.
    const standardEnabled = state.enabledStandards.some((s) => s.standardsArn.endsWith(config.standardArnSuffix));

    if (!standardEnabled) {
      return {
        framework: config.framework,
        frameworkVersion: config.frameworkVersion,
        syncStatus: state.lastSyncStatus,
        capabilityStatus: state.capabilityStatus,
        standardEnabled: false,
        evaluatedAt: state.lastSyncCompletedAt,
        coverage: emptyCoverage(config.controlMappings.length),
        controls: [
          ...config.controlMappings.map((m) => ({
            controlId: m.controlId,
            title: m.title,
            securityHubControlId: m.securityHubControlId,
            status: 'NOT_EVALUATED' as FoundationControlStatus,
            reason: `Security Hub ${config.framework.toUpperCase()} standard is not enabled for this account.`,
            mappingType: m.mappingType,
          })),
          ...notEstablishableResults,
        ],
      };
    }

    const freshSince = state.lastSyncStartedAt ? new Date(state.lastSyncStartedAt) : new Date(0);
    // One query for all controls, not one per control -- avoids a query-per-control
    // fan-out on every readiness read (PCI's ~22-entry mapping, and any future growth,
    // is served by this exact same single query CIS already uses).
    const findingsByControl = await this.findingsRepo.getAllFreshActiveFindingsGroupedByControl(
      organizationId,
      freshSince
    );
    const controls: FrameworkControlResult[] = [
      ...config.controlMappings.map((mapping) => ({
        controlId: mapping.controlId,
        title: mapping.title,
        securityHubControlId: mapping.securityHubControlId,
        mappingType: mapping.mappingType,
        ...deriveControlStatus(findingsByControl.get(mapping.securityHubControlId) ?? []),
      })),
      ...notEstablishableResults,
    ];

    const coverage = {
      totalControls,
      evaluated: controls.filter((c) => c.status === 'PASS' || c.status === 'FAIL').length,
      passed: controls.filter((c) => c.status === 'PASS').length,
      failed: controls.filter((c) => c.status === 'FAIL').length,
      unknown: controls.filter((c) => c.status === 'UNKNOWN').length,
      notEvaluated: controls.filter((c) => c.status === 'NOT_EVALUATED').length,
      notApplicable: controls.filter((c) => c.status === 'NOT_APPLICABLE').length,
      notEstablishable: controls.filter((c) => c.status === 'NOT_ESTABLISHABLE').length,
      errors: controls.filter((c) => c.status === 'ERROR').length,
    };

    return {
      framework: config.framework,
      frameworkVersion: config.frameworkVersion,
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
 * Pure function -- the core status-derivation rule, given only the fresh ACTIVE
 * findings currently known for a control-backed mapping entry. Exported for direct unit
 * testing. Never called for NOT_ESTABLISHABLE entries (those never reach this function
 * -- they have no Security Hub control to look up findings for).
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
