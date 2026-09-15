/**
 * Status semantics coverage (spec Section 8/9/23): the derivation rules must never
 * turn an API error, a missing permission, or a disabled standard into FAIL, and must
 * never turn an absence of findings into an automatic PASS.
 */
import { deriveControlStatus, SecurityHubComplianceService } from '../security-hub-compliance.service';
import { CIS_V5_CONTROL_MAPPINGS } from '../../config/securityHubCisMapping';
import { PCI_V4_CONTROL_MAPPINGS } from '../../config/securityHubPciMapping';

jest.mock('../../repositories/security-hub-state.repository');
jest.mock('../../repositories/security-hub-findings.repository');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SecurityHubStateRepository } = require('../../repositories/security-hub-state.repository');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SecurityHubFindingsRepository } = require('../../repositories/security-hub-findings.repository');

describe('deriveControlStatus (pure function)', () => {
  it('empty findings -> UNKNOWN, never PASS', () => {
    expect(deriveControlStatus([]).status).toBe('UNKNOWN');
  });

  it('any FAILED finding -> FAIL', () => {
    expect(deriveControlStatus([{ complianceStatus: 'PASSED' }, { complianceStatus: 'FAILED' }]).status).toBe('FAIL');
  });

  it('all findings PASSED -> PASS', () => {
    expect(deriveControlStatus([{ complianceStatus: 'PASSED' }, { complianceStatus: 'PASSED' }]).status).toBe('PASS');
  });

  it('all findings NOT_AVAILABLE -> NOT_APPLICABLE', () => {
    expect(deriveControlStatus([{ complianceStatus: 'NOT_AVAILABLE' }]).status).toBe('NOT_APPLICABLE');
  });

  it('only WARNING findings -> UNKNOWN, not PASS and not FAIL', () => {
    const result = deriveControlStatus([{ complianceStatus: 'WARNING' }]);
    expect(result.status).toBe('UNKNOWN');
  });
});

describe('SecurityHubComplianceService.evaluateCis — capability/standard gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('never synced -> every control NOT_EVALUATED, zero passed/failed', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({ get: jest.fn().mockResolvedValue(null) }));
    const result = await new SecurityHubComplianceService().evaluateCis('org-1');

    expect(result.syncStatus).toBe('NEVER_RUN');
    expect(result.coverage.passed).toBe(0);
    expect(result.coverage.failed).toBe(0);
    expect(result.controls.every((c) => c.status === 'NOT_EVALUATED')).toBe(true);
  });

  it('capability NOT_GRANTED -> NOT_EVALUATED, never FAIL', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'NOT_GRANTED',
        capabilityError: 'AccessDenied',
        enabledStandards: [],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    const result = await new SecurityHubComplianceService().evaluateCis('org-1');

    expect(result.capabilityStatus).toBe('NOT_GRANTED');
    expect(result.controls.every((c) => c.status === 'NOT_EVALUATED')).toBe(true);
    expect(result.controls.every((c) => c.status !== 'FAIL')).toBe(true);
    expect(result.coverage.failed).toBe(0);
  });

  it('capability NOT_AVAILABLE (Security Hub disabled) -> NOT_EVALUATED, never FAIL', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'NOT_AVAILABLE',
        capabilityError: null,
        enabledStandards: [],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    const result = await new SecurityHubComplianceService().evaluateCis('org-1');

    expect(result.controls.every((c) => c.status === 'NOT_EVALUATED')).toBe(true);
    expect(result.coverage.failed).toBe(0);
    expect(result.coverage.passed).toBe(0);
  });

  it('capability ERROR -> ERROR, never FAIL and never PASS', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ERROR',
        capabilityError: 'Rate exceeded',
        enabledStandards: [],
        lastSyncStatus: 'FAILED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    const result = await new SecurityHubComplianceService().evaluateCis('org-1');

    expect(result.controls.every((c) => c.status === 'ERROR')).toBe(true);
    expect(result.coverage.errors).toBe(CIS_V5_CONTROL_MAPPINGS.length);
    expect(result.coverage.failed).toBe(0);
    expect(result.coverage.passed).toBe(0);
  });

  it('capability ENABLED but CIS standard not enabled -> NOT_EVALUATED, not PASS/FAIL', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ENABLED',
        capabilityError: null,
        enabledStandards: [{ standardsArn: 'arn:aws:securityhub:us-east-1::standards/pci-dss/v/3.2.1', standardsSubscriptionArn: 'sub', name: 'PCI DSS', enabled: true }],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    const result = await new SecurityHubComplianceService().evaluateCis('org-1');

    expect(result.standardEnabled).toBe(false);
    expect(result.controls.every((c) => c.status === 'NOT_EVALUATED')).toBe(true);
  });

  it('capability ENABLED, CIS enabled, no fresh findings anywhere -> UNKNOWN, never automatic PASS', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ENABLED',
        capabilityError: null,
        enabledStandards: [{ standardsArn: 'arn:aws:securityhub:us-east-1::standards/cis-aws-foundations-benchmark/v/5.0.0', standardsSubscriptionArn: 'sub', name: 'CIS', enabled: true }],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    (SecurityHubFindingsRepository as jest.Mock).mockImplementation(() => ({
      getAllFreshActiveFindingsGroupedByControl: jest.fn().mockResolvedValue(new Map()),
    }));

    const result = await new SecurityHubComplianceService().evaluateCis('org-1');

    expect(result.standardEnabled).toBe(true);
    expect(result.controls.every((c) => c.status === 'UNKNOWN')).toBe(true);
    expect(result.coverage.passed).toBe(0);
  });

  it('capability ENABLED, CIS enabled, a control has a fresh FAILED finding -> that control is FAIL', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ENABLED',
        capabilityError: null,
        enabledStandards: [{ standardsArn: 'arn:aws:securityhub:us-east-1::standards/cis-aws-foundations-benchmark/v/5.0.0', standardsSubscriptionArn: 'sub', name: 'CIS', enabled: true }],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    (SecurityHubFindingsRepository as jest.Mock).mockImplementation(() => ({
      getAllFreshActiveFindingsGroupedByControl: jest.fn().mockResolvedValue(
        new Map([['IAM.5', [{ complianceStatus: 'FAILED' }]]])
      ),
    }));

    const result = await new SecurityHubComplianceService().evaluateCis('org-1');
    const iam5 = result.controls.find((c) => c.securityHubControlId === 'IAM.5');
    expect(iam5?.status).toBe('FAIL');
    expect(result.coverage.failed).toBe(1);
  });
});

describe('SecurityHubComplianceService.evaluatePci — capability/standard gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('never synced -> every mapped control NOT_EVALUATED; production PCI mapping has zero live NOT_ESTABLISHABLE entries', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({ get: jest.fn().mockResolvedValue(null) }));
    const result = await new SecurityHubComplianceService().evaluatePci('org-1');

    expect(result.framework).toBe('pci');
    expect(result.frameworkVersion).toBe('4.0.1');
    expect(result.syncStatus).toBe('NEVER_RUN');
    expect(result.coverage.totalControls).toBe(PCI_V4_CONTROL_MAPPINGS.length);
    // The production PCI mapping must never represent an unsupported requirement as a
    // NOT_ESTABLISHABLE row -- see securityHubPciMapping.ts's own docblock. Real
    // NOT_ESTABLISHABLE behavior is verified via a synthetic config below, not here.
    expect(result.coverage.notEstablishable).toBe(0);
    expect(result.controls.some((c) => c.status === 'NOT_ESTABLISHABLE')).toBe(false);
    expect(result.controls.every((c) => c.status === 'NOT_EVALUATED')).toBe(true);
  });

  it('capability NOT_GRANTED -> every mapped control NOT_EVALUATED, never FAIL', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'NOT_GRANTED',
        capabilityError: 'AccessDenied',
        enabledStandards: [],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    const result = await new SecurityHubComplianceService().evaluatePci('org-1');

    expect(result.controls.every((c) => c.status === 'NOT_EVALUATED')).toBe(true);
    expect(result.controls.every((c) => c.status !== 'FAIL')).toBe(true);
    expect(result.coverage.notEstablishable).toBe(0);
    expect(result.coverage.failed).toBe(0);
  });

  it('capability NOT_AVAILABLE (Security Hub disabled) -> NOT_EVALUATED, never FAIL', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'NOT_AVAILABLE',
        capabilityError: null,
        enabledStandards: [],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    const result = await new SecurityHubComplianceService().evaluatePci('org-1');
    const mapped = result.controls.filter((c) => c.status !== 'NOT_ESTABLISHABLE');
    expect(mapped.every((c) => c.status === 'NOT_EVALUATED')).toBe(true);
    expect(result.coverage.failed).toBe(0);
    expect(result.coverage.passed).toBe(0);
  });

  it('capability ERROR -> ERROR for mapped controls, never FAIL/PASS', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ERROR',
        capabilityError: 'Rate exceeded',
        enabledStandards: [],
        lastSyncStatus: 'FAILED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    const result = await new SecurityHubComplianceService().evaluatePci('org-1');

    expect(result.controls.every((c) => c.status === 'ERROR')).toBe(true);
    expect(result.coverage.errors).toBe(PCI_V4_CONTROL_MAPPINGS.length);
    expect(result.coverage.failed).toBe(0);
    expect(result.coverage.passed).toBe(0);
  });

  it('capability ENABLED but PCI standard not enabled -> NOT_EVALUATED, not PASS/FAIL', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ENABLED',
        capabilityError: null,
        enabledStandards: [{ standardsArn: 'arn:aws:securityhub:us-east-1::standards/cis-aws-foundations-benchmark/v/5.0.0', standardsSubscriptionArn: 'sub', name: 'CIS', enabled: true }],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    const result = await new SecurityHubComplianceService().evaluatePci('org-1');

    expect(result.standardEnabled).toBe(false);
    expect(result.controls.every((c) => c.status === 'NOT_EVALUATED')).toBe(true);
  });

  it('capability ENABLED, PCI enabled, no fresh findings anywhere -> UNKNOWN, never automatic PASS', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ENABLED',
        capabilityError: null,
        enabledStandards: [{ standardsArn: 'arn:aws:securityhub:us-east-1::standards/pci-dss/v/4.0.1', standardsSubscriptionArn: 'sub', name: 'PCI DSS v4.0.1', enabled: true }],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    (SecurityHubFindingsRepository as jest.Mock).mockImplementation(() => ({
      getAllFreshActiveFindingsGroupedByControl: jest.fn().mockResolvedValue(new Map()),
    }));

    const result = await new SecurityHubComplianceService().evaluatePci('org-1');

    expect(result.standardEnabled).toBe(true);
    expect(result.controls.every((c) => c.status === 'UNKNOWN')).toBe(true);
    expect(result.coverage.passed).toBe(0);
  });

  it('multiple findings for the same control resolve deterministically -- one FAILED among several PASSED still yields FAIL, never a false PASS', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ENABLED',
        capabilityError: null,
        enabledStandards: [{ standardsArn: 'arn:aws:securityhub:us-east-1::standards/pci-dss/v/4.0.1', standardsSubscriptionArn: 'sub', name: 'PCI DSS v4.0.1', enabled: true }],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    // IAM.5 has 3 resources evaluated: 2 PASSED, 1 FAILED -- a naive "last row wins" or
    // "any PASSED wins" resolution would incorrectly report PASS.
    (SecurityHubFindingsRepository as jest.Mock).mockImplementation(() => ({
      getAllFreshActiveFindingsGroupedByControl: jest.fn().mockResolvedValue(
        new Map([
          ['IAM.5', [{ complianceStatus: 'PASSED' }, { complianceStatus: 'FAILED' }, { complianceStatus: 'PASSED' }]],
        ])
      ),
    }));

    const result = await new SecurityHubComplianceService().evaluatePci('org-1');
    const iam5Rows = result.controls.filter((c) => c.securityHubControlId === 'IAM.5');
    expect(iam5Rows.length).toBeGreaterThanOrEqual(1);
    expect(iam5Rows.every((c) => c.status === 'FAIL')).toBe(true);
  });

  it('a control mapped to multiple PCI requirements (IAM.3) produces one result row per requirement, all reflecting the same underlying evidence', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ENABLED',
        capabilityError: null,
        enabledStandards: [{ standardsArn: 'arn:aws:securityhub:us-east-1::standards/pci-dss/v/4.0.1', standardsSubscriptionArn: 'sub', name: 'PCI DSS v4.0.1', enabled: true }],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    (SecurityHubFindingsRepository as jest.Mock).mockImplementation(() => ({
      getAllFreshActiveFindingsGroupedByControl: jest.fn().mockResolvedValue(
        new Map([['IAM.3', [{ complianceStatus: 'FAILED' }]]])
      ),
    }));

    const result = await new SecurityHubComplianceService().evaluatePci('org-1');
    const iam3Rows = result.controls.filter((c) => c.securityHubControlId === 'IAM.3');
    expect(iam3Rows.length).toBeGreaterThanOrEqual(2);
    expect(new Set(iam3Rows.map((r) => r.controlId)).size).toBe(iam3Rows.length);
    expect(iam3Rows.every((r) => r.status === 'FAIL')).toBe(true);
  });

  it('mappingType is exposed on every control-backed PCI result', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({ get: jest.fn().mockResolvedValue(null) }));
    const result = await new SecurityHubComplianceService().evaluatePci('org-1');

    expect(result.controls.every((c) => c.mappingType === 'DIRECT' || c.mappingType === 'ADDITIONAL_EVIDENCE')).toBe(true);
  });
});

/**
 * NOT_ESTABLISHABLE is a real, supported status of the shared evaluator
 * (SecurityHubComplianceService['evaluateFramework']) -- but per a focused review of
 * PR #88, the production PCI mapping must never contain an entry that exists solely to
 * produce a live NOT_ESTABLISHABLE row (that was found to conflict with "map only PCI
 * requirements DevControl can legitimately establish"). Both PCI_CONFIG and CIS_CONFIG
 * therefore pass an empty `notEstablishableRequirements` list in production -- see
 * securityHubPciMapping.ts's own docblock.
 *
 * This suite proves the *mechanism* itself is correct using a synthetic, test-only
 * config -- never by adding a fake requirement to the real PCI or CIS mapping files.
 * `evaluateFramework` is a private implementation detail of SecurityHubComplianceService;
 * reaching it via `(service as any)` is deliberate and the smallest way to exercise it
 * directly without changing its visibility or exporting its internal config shape as
 * public API.
 */
describe('SecurityHubComplianceService — NOT_ESTABLISHABLE via a synthetic test-only config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function syntheticConfig(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      framework: 'pci',
      frameworkVersion: 'test-fixture',
      standardArnSuffix: '::standards/synthetic-test-standard/v/1.0.0',
      controlMappings: [
        { controlId: 'TEST-1.1', title: 'A normal, control-backed synthetic requirement', securityHubControlId: 'TEST.1', mappingType: 'DIRECT' },
      ],
      notEstablishableRequirements: [
        { controlId: 'TEST-9', title: 'A deliberately unsupported synthetic requirement', reason: 'Test fixture only -- no real AWS evidence source exists for this.' },
      ],
      ...overrides,
    };
  }

  it('produces NOT_ESTABLISHABLE for the configured unsupported requirement, distinct from NOT_EVALUATED and FAIL, even when never synced', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({ get: jest.fn().mockResolvedValue(null) }));
    const service = new SecurityHubComplianceService();
    const result = await (service as any).evaluateFramework('org-1', syntheticConfig());

    const notEstablishableRow = result.controls.find((c: any) => c.controlId === 'TEST-9');
    expect(notEstablishableRow.status).toBe('NOT_ESTABLISHABLE');
    expect(notEstablishableRow.status).not.toBe('NOT_EVALUATED');
    expect(notEstablishableRow.status).not.toBe('FAIL');
    expect(notEstablishableRow.securityHubControlId).toBeNull();

    const controlBackedRow = result.controls.find((c: any) => c.controlId === 'TEST-1.1');
    expect(controlBackedRow.status).toBe('NOT_EVALUATED'); // never synced -- this one IS a real evaluation-state-dependent row
    expect(result.coverage.notEstablishable).toBe(1);
  });

  it('remains NOT_ESTABLISHABLE regardless of capability state (NOT_GRANTED, ERROR) -- it is a property of the mapping, not of sync/capability state', async () => {
    for (const capabilityStatus of ['NOT_GRANTED', 'NOT_AVAILABLE', 'ERROR']) {
      (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
        get: jest.fn().mockResolvedValue({
          capabilityStatus,
          capabilityError: capabilityStatus === 'ERROR' ? 'Rate exceeded' : null,
          enabledStandards: [],
          lastSyncStatus: 'COMPLETED',
          lastSyncStartedAt: new Date().toISOString(),
          lastSyncCompletedAt: new Date().toISOString(),
        }),
      }));
      const service = new SecurityHubComplianceService();
      const result = await (service as any).evaluateFramework('org-1', syntheticConfig());
      const notEstablishableRow = result.controls.find((c: any) => c.controlId === 'TEST-9');
      expect(notEstablishableRow.status).toBe('NOT_ESTABLISHABLE');
    }
  });

  it('remains NOT_ESTABLISHABLE even when the standard is enabled and the control-backed requirement resolves to FAIL', async () => {
    (SecurityHubStateRepository as jest.Mock).mockImplementation(() => ({
      get: jest.fn().mockResolvedValue({
        capabilityStatus: 'ENABLED',
        capabilityError: null,
        enabledStandards: [{ standardsArn: 'arn:aws:securityhub:us-east-1::standards/synthetic-test-standard/v/1.0.0', standardsSubscriptionArn: 'sub', name: 'Synthetic', enabled: true }],
        lastSyncStatus: 'COMPLETED',
        lastSyncStartedAt: new Date().toISOString(),
        lastSyncCompletedAt: new Date().toISOString(),
      }),
    }));
    (SecurityHubFindingsRepository as jest.Mock).mockImplementation(() => ({
      getAllFreshActiveFindingsGroupedByControl: jest.fn().mockResolvedValue(
        new Map([['TEST.1', [{ complianceStatus: 'FAILED' }]]])
      ),
    }));

    const service = new SecurityHubComplianceService();
    const result = await (service as any).evaluateFramework('org-1', syntheticConfig());

    const notEstablishableRow = result.controls.find((c: any) => c.controlId === 'TEST-9');
    expect(notEstablishableRow.status).toBe('NOT_ESTABLISHABLE');
    const controlBackedRow = result.controls.find((c: any) => c.controlId === 'TEST-1.1');
    expect(controlBackedRow.status).toBe('FAIL'); // the real control-backed row correctly reflects live evidence
    expect(result.coverage.notEstablishable).toBe(1);
    expect(result.coverage.failed).toBe(1);
  });
});
