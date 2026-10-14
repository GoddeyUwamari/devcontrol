/**
 * SOC 2 checks follow the same rules as every other framework's:
 *
 *   - they run only for an organization that has explicitly enabled SOC 2;
 *   - a check whose only signal is a resource tag reports unable_to_evaluate,
 *     whether the tag is present or not. It is never a finding, never a pass,
 *     and never carries a severity.
 *
 * Until this change the two checks below ran for every organization as
 * "baseline" checks and reported a missing tag as a High finding
 * ('Tagging: IAM role/owner not documented', 'Observability: Monitoring/logging
 * not documented via tag'). Entries with those texts that are still stored are
 * not current findings (see frameworkApplicability.test.ts).
 *
 * Replaces complianceScanner.soc2-relabel.test.ts, which pinned the High findings.
 */
import { ComplianceScannerService } from '../complianceScanner';
import { FRAMEWORK_CHECKS, SOC2_CHECKS } from '../framework-checks';
import { AWSResource, ResourceType } from '../../types/aws-resources.types';
import {
  REGISTERED_FRAMEWORKS,
  isActiveComplianceFinding,
  resolveFrameworkApplicability,
} from '../../utils/frameworkApplicability';

const IAM_KEY = 'soc2.iam_role_documented';
const MONITORING_KEY = 'soc2.monitoring_logging_documented';
const LEGACY_TEXTS = ['Tagging: IAM role/owner not documented', 'Observability: Monitoring/logging not documented via tag'];

function resource(overrides: Partial<AWSResource>): AWSResource {
  return {
    id: 'id-1',
    organization_id: 'org-1',
    resource_arn: 'arn:aws:ec2:us-east-1:111122223333:instance/i-1234567890abcdef0',
    resource_id: 'i-1234567890abcdef0',
    resource_name: 'test-resource',
    resource_type: 'ec2',
    region: 'us-east-1',
    tags: { Owner: 'o', Environment: 'e', Team: 't' },
    metadata: {},
    status: 'running',
    estimated_monthly_cost: 10,
    actual_monthly_cost: 10,
    is_encrypted: true,
    is_public: false,
    has_backup: true,
    compliance_issues: [],
    is_orphaned: false,
    orphaned_monthly_savings: 0,
    last_synced_at: new Date(),
    first_discovered_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

const settings = (rows: unknown[]) => resolveFrameworkApplicability({ status: 'ok', rows });
const ENABLED = settings([{ standard_name: 'SOC2', enabled: true }]);
const DISABLED = settings([{ standard_name: 'SOC2', enabled: false }]);
const NOT_CONFIGURED = settings([]);
const UNAVAILABLE = resolveFrameworkApplicability({ status: 'unavailable' });

const service = new ComplianceScannerService();
const soc2 = async (res: AWSResource, applicability = ENABLED) =>
  (await service.evaluateResource(res, applicability)).frameworkEvaluations.filter((e) => e.framework === 'SOC2');

describe('SOC 2 is a registered framework with exactly the two tag-only checks', () => {
  it('is registered, and its setting is matched however the name is spelled', () => {
    expect(REGISTERED_FRAMEWORKS.map((f) => f.key)).toContain('SOC2');
    for (const name of ['SOC2', 'soc2', 'SOC 2', 'SOC-2']) {
      const resolved = settings([{ standard_name: name, enabled: true }]).find((a) => a.framework === 'SOC2');
      expect(resolved).toMatchObject({ state: 'enabled', reason_code: 'explicitly_enabled' });
    }
  });

  it('enabling HIPAA does not enable SOC 2, and the reverse', () => {
    const hipaaOnly = settings([{ standard_name: 'HIPAA', enabled: true }]);
    expect(hipaaOnly.find((a) => a.framework === 'SOC2')).toMatchObject({ state: 'not_configured' });
    expect(ENABLED.find((a) => a.framework === 'HIPAA')).toMatchObject({ state: 'not_configured' });
  });

  it('has the two checks, and the retired change-management and S3 access-logging signals are not among them', () => {
    expect(FRAMEWORK_CHECKS.SOC2).toBe(SOC2_CHECKS);
    expect(service.registeredCheckKeys('SOC2')).toEqual([IAM_KEY, MONITORING_KEY]);
  });

  it('no SOC 2 check can produce a finding: none has finding wording', () => {
    for (const check of SOC2_CHECKS) expect(check.finding).toBeUndefined();
  });
});

describe('SOC 2 is off by default', () => {
  it.each([
    ['no setting', NOT_CONFIGURED, 'not_configured', 'no_setting'],
    ['explicitly disabled', DISABLED, 'disabled', 'explicitly_disabled'],
    ['settings unreadable', UNAVAILABLE, 'unavailable', 'settings_unavailable'],
  ])('%s: no check runs, one not_evaluated record says why, and nothing is a finding', async (_name, applicability, state, reason) => {
    const untagged = resource({ tags: {} });
    const evaluations = await soc2(untagged, applicability);
    expect(evaluations).toEqual([
      expect.objectContaining({ check: null, applicability: state, evaluation_state: 'not_evaluated', severity: null, reason_code: reason }),
    ]);

    const issues = await service.scanResource(untagged, applicability);
    expect(issues.map((i) => i.issue)).toEqual(['Resource is missing required tags: Owner, Environment, Team']);
    expect(issues.some((i) => i.severity === 'high' || i.severity === 'critical')).toBe(false);
  });

  it('scanResource with no applicability at all treats SOC 2 as not configured', async () => {
    const issues = await service.scanResource(resource({ tags: {} }));
    for (const text of LEGACY_TEXTS) expect(issues.find((i) => i.issue === text)).toBeUndefined();
  });

  it('the baseline checks no longer include the two tag signals for any resource type', () => {
    for (const type of ['ec2', 'rds', 'lambda', 's3', 'ecs', 'ebs', 'vpc'] as ResourceType[]) {
      const texts = service.evaluateBaseline(resource({ resource_type: type, tags: {} })).map((i) => i.issue);
      for (const text of LEGACY_TEXTS) expect(texts).not.toContain(text);
    }
  });
});

describe('SOC 2 enabled: a tag is not evidence, present or absent', () => {
  it('no tags collected: both checks are unable_to_evaluate with no evidence, no severity and no provenance', async () => {
    expect(await soc2(resource({ tags: {} }))).toEqual([
      expect.objectContaining({
        check: IAM_KEY, applicability: 'enabled', evaluation_state: 'unable_to_evaluate',
        severity: null, evidence_basis: 'none', provenance: null, reason_code: 'no_evidence_collected', error_code: null,
      }),
      expect.objectContaining({
        check: MONITORING_KEY, applicability: 'enabled', evaluation_state: 'unable_to_evaluate',
        severity: null, evidence_basis: 'none', provenance: null, reason_code: 'no_evidence_collected', error_code: null,
      }),
    ]);
  });

  it.each([
    [IAM_KEY, { IAMRole: 'app-role' }],
    [IAM_KEY, { Role: 'app-role' }],
    [MONITORING_KEY, { MonitoringEnabled: 'true' }],
    [MONITORING_KEY, { LoggingEnabled: 'true' }],
    [MONITORING_KEY, { CloudWatchAlarms: 'true' }],
  ])('%s with its tag present (%j) is still unable_to_evaluate -- self-attested, never passed', async (key, tags) => {
    const evaluation = (await soc2(resource({ tags }))).find((e) => e.check === key);
    expect(evaluation).toMatchObject({
      evaluation_state: 'unable_to_evaluate', severity: null, evidence_basis: 'tag', provenance: 'SELF_ATTESTED', reason_code: 'tag_only_evidence',
    });
  });

  it('never fails, never passes and never has a severity, for any resource type and any tagging', async () => {
    const taggings: Array<Record<string, string>> = [{}, { IAMRole: 'r' }, { MonitoringEnabled: 'true' }, { IAMRole: 'r', Role: 'r', MonitoringEnabled: 'true', LoggingEnabled: 'true', CloudWatchAlarms: 'true' }];
    for (const type of ['ec2', 'rds', 'lambda', 's3', 'ecs', 'ebs', 'vpc', 'elasticache'] as ResourceType[]) {
      for (const tags of taggings) {
        for (const flags of [{ is_encrypted: false, is_public: true, has_backup: false }, { is_encrypted: null, is_public: null, has_backup: null }, {}]) {
          const res = resource({ resource_type: type, tags, ...(flags as Partial<AWSResource>) });
          for (const evaluation of await soc2(res)) {
            expect(evaluation.evaluation_state).toBe('unable_to_evaluate');
            expect(evaluation.severity).toBeNull();
          }
          const issues = await service.scanResource(res, ENABLED);
          expect(issues.filter((i) => i.framework === 'SOC2')).toEqual([]);
          for (const text of LEGACY_TEXTS) expect(issues.find((i) => i.issue === text)).toBeUndefined();
        }
      }
    }
  });

  it.each([
    ['ec2', [IAM_KEY, MONITORING_KEY]],
    ['lambda', [IAM_KEY, MONITORING_KEY]],
    ['ecs', [IAM_KEY]],
    ['rds', [MONITORING_KEY]],
    ['s3', [MONITORING_KEY]],
    ['ebs', []],
    ['vpc', []],
  ] as Array<[ResourceType, string[]]>)('%s is evaluated by %j, the same resource types as before', async (type, keys) => {
    expect((await soc2(resource({ resource_type: type, tags: {} }))).map((e) => e.check)).toEqual(keys);
  });

  it('an untagged, otherwise clean instance is not pushed to High by SOC 2: its only finding is the Low tagging one', async () => {
    const issues = await service.scanResource(resource({ tags: {} }), ENABLED);
    expect(issues.map((i) => [i.severity, i.issue])).toEqual([['low', 'Resource is missing required tags: Owner, Environment, Team']]);
  });

  it('checks that rest on AWS observations stay evidence-based with SOC 2 enabled: baseline findings are unchanged', async () => {
    const exposed = resource({ tags: {}, is_encrypted: false, is_public: true, has_backup: false });
    const baseline = service.evaluateBaseline(exposed);
    expect(baseline.map((i) => [i.severity, i.issue, i.provenance])).toEqual([
      ['high', 'EC2 instance has unencrypted EBS volumes', 'OBSERVED'],
      ['medium', 'EC2 instance has a public IP address. Exposure not checked: its security groups have not been read yet.', 'OBSERVED'],
      ['medium', 'EC2 instance does not have regular snapshots', 'OBSERVED'],
      ['low', 'Resource is missing required tags: Owner, Environment, Team', 'SELF_ATTESTED'],
    ]);
    for (const applicability of [ENABLED, DISABLED, NOT_CONFIGURED]) {
      expect((await service.evaluateResource(exposed, applicability)).baselineIssues).toEqual(baseline);
    }
  });
});

describe('SOC 2 entries stored before the framework had to be enabled are not current findings', () => {
  it.each([
    ...LEGACY_TEXTS,
    'SOC2: IAM role not properly configured',
  ])('%s', (issue) => {
    expect(isActiveComplianceFinding({ severity: 'high', category: 'tagging', issue, recommendation: 'r', provenance: 'SELF_ATTESTED' })).toBe(false);
  });

  it('a baseline finding that merely mentions tagging or monitoring is still current', () => {
    expect(isActiveComplianceFinding({ severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner', recommendation: 'r' })).toBe(true);
    expect(isActiveComplianceFinding({ severity: 'high', category: 'networking', issue: 'Observability: Monitoring/logging not documented', recommendation: 'r' })).toBe(true);
  });
});
