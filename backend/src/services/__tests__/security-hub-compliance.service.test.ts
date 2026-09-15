/**
 * Status semantics coverage (spec Section 8/9/23): the derivation rules must never
 * turn an API error, a missing permission, or a disabled standard into FAIL, and must
 * never turn an absence of findings into an automatic PASS.
 */
import { deriveControlStatus, SecurityHubComplianceService } from '../security-hub-compliance.service';
import { CIS_V5_CONTROL_MAPPINGS } from '../../config/securityHubCisMapping';

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
