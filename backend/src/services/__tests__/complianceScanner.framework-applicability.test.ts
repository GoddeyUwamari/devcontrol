/**
 * ComplianceScannerService: framework applicability and evaluation state.
 *
 * Framework checks run only for an explicitly enabled framework. Applicability
 * (configuration), evaluation state (what happened when a check ran), severity (how
 * much a failure matters), evidence basis and provenance are separate: every case
 * below asserts each of them rather than a count. Pure: no database, no AWS.
 *
 * The scanner describes ONE evaluation. What an earlier scan found, what is stale
 * and what stays in compliance_issues are decided from the stored evaluations --
 * see framework-evaluations.repository.test.ts and
 * awsResourceDiscovery.framework-applicability.test.ts.
 */
import { ComplianceScannerService, FrameworkCheck } from '../complianceScanner';
import { FRAMEWORK_CHECKS, HIPAA_CHECKS, checkAppliesTo } from '../framework-checks';
import { AWSResource, ComplianceIssue, FrameworkCheckEvaluation } from '../../types/aws-resources.types';
import {
  FrameworkApplicability,
  FrameworkSettingsRead,
  evaluationReasonText,
  isActiveComplianceFinding,
  resolveFrameworkApplicability,
} from '../../utils/frameworkApplicability';

const ARN = 'arn:aws:ec2:us-east-1:111122223333:volume/vol-1';

function resource(overrides: Partial<AWSResource> = {}): AWSResource {
  return {
    id: 'id-1',
    organization_id: 'org-1',
    resource_arn: ARN,
    resource_id: 'vol-1',
    resource_name: 'volume',
    resource_type: 'ebs',
    region: 'us-east-1',
    // The three required tags, so the baseline tag check stays quiet unless a case wants it.
    tags: { Owner: 'o', Environment: 'e', Team: 't' },
    metadata: {},
    status: 'available',
    estimated_monthly_cost: 1,
    actual_monthly_cost: 1,
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

const settings = (rows: unknown[]): FrameworkSettingsRead => ({ status: 'ok', rows });
const hipaa = (enabled: unknown) => resolveFrameworkApplicability(settings([{ standard_name: 'HIPAA', enabled }]));

const APPLICABILITY: Record<string, FrameworkApplicability[]> = {
  enabled: hipaa(true),
  disabled: hipaa(false),
  not_configured: resolveFrameworkApplicability(settings([])),
  unavailable: resolveFrameworkApplicability({ status: 'unavailable' }),
  invalid: hipaa(null),
};

const BACKUP_KEY = 'hipaa.automated_backups';
const BACKUP_TEXT = 'HIPAA: EBS storing PHI must have automated backups';

// This file pins the framework rules through HIPAA. SOC 2 is registered too and is
// resolved from the same settings rows, none of which names it here; its outcomes
// are pinned in complianceScanner.soc2-framework.test.ts and left out of the
// evaluations below so each assertion states exactly what HIPAA produced.
const service = () => {
  const scanner = new ComplianceScannerService();
  const evaluateResource = scanner.evaluateResource.bind(scanner);
  scanner.evaluateResource = async (resource, applicability) => {
    const result = await evaluateResource(resource, applicability);
    return { ...result, frameworkEvaluations: result.frameworkEvaluations.filter((e) => e.framework !== 'SOC2') };
  };
  return scanner;
};
const frameworkIssues = (issues: ComplianceIssue[]) => issues.filter((i) => i.framework !== undefined || i.issue.startsWith('HIPAA'));
const forCheck = (evaluations: FrameworkCheckEvaluation[], check: string | null) => evaluations.filter((e) => e.check === check);

/** A full evaluation record, from the parts that vary. */
function record(
  check: string | null,
  applicability: string,
  evaluation_state: string,
  reason_code: string,
  rest: Partial<FrameworkCheckEvaluation> = {}
) {
  return {
    framework: 'HIPAA', check, applicability, evaluation_state, severity: null, evidence_basis: 'none', provenance: null,
    reason_code, reason: evaluationReasonText(reason_code), error_code: null, resource_arn: ARN, ...rest,
  };
}

describe('a framework that is not explicitly enabled is not evaluated', () => {
  const cases: Array<[string, FrameworkApplicability[] | undefined, string, string, string]> = [
    ['explicitly disabled', APPLICABILITY.disabled, 'disabled', 'explicitly_disabled', 'Framework is explicitly disabled for this organization'],
    ['missing settings', APPLICABILITY.not_configured, 'not_configured', 'no_setting', 'No setting is recorded for this framework; a framework is evaluated only when explicitly enabled'],
    ['no applicability supplied at all', undefined, 'not_configured', 'no_setting', 'No setting is recorded for this framework; a framework is evaluated only when explicitly enabled'],
    ['settings read failure', APPLICABILITY.unavailable, 'unavailable', 'settings_unavailable', 'Framework settings could not be read'],
    ['invalid settings', APPLICABILITY.invalid, 'invalid', 'invalid_enabled_value', 'Framework setting has no usable enabled/disabled value'],
  ];

  it.each(cases)('%s: no finding, no pass, one not_evaluated record with the reason', async (_name, applicability, state, code, text) => {
    // has_backup false would be a Critical HIPAA failure if the framework were evaluated.
    const result = await service().evaluateResource(resource({ has_backup: false }), applicability);

    expect(frameworkIssues(result.issues)).toEqual([]);
    expect(result.frameworkEvaluations).toEqual([record(null, state, 'not_evaluated', code)]);
    expect(result.frameworkEvaluations[0].reason).toBe(text);
    expect(result.frameworkEvaluations.some((e) => e.evaluation_state === 'passed')).toBe(false);
  });

  it('scanResource with no applicability emits no framework finding for any resource type', async () => {
    for (const resource_type of ['ec2', 'ebs', 'rds', 's3', 'lambda', 'elasticache', 'vpc'] as const) {
      const issues = await service().scanResource(resource({ resource_type, tags: {}, has_backup: false }));
      expect(frameworkIssues(issues)).toEqual([]);
    }
  });

  it('what an earlier scan left in compliance_issues is not read by the scanner: nothing is carried into this evaluation', async () => {
    const previous = [
      { severity: 'critical', category: 'backups', issue: BACKUP_TEXT, recommendation: 'r', findingKey: BACKUP_KEY, framework: 'HIPAA', applicability: 'enabled', evaluation_state: 'failed' },
      { severity: 'high', category: 'backups', issue: 'HIPAA: Resource lacks documented backup retention policy', recommendation: 'r' },
    ] as ComplianceIssue[];
    for (const applicability of Object.values(APPLICABILITY)) {
      const result = await service().evaluateResource(resource({ has_backup: true, compliance_issues: previous }), applicability);
      expect(frameworkIssues(result.issues)).toEqual([]);
    }
  });
});

describe('an explicitly enabled framework is evaluated against evidence', () => {
  it('a supported pass: the AWS Backup observation shows a backup', async () => {
    const result = await service().evaluateResource(resource({ has_backup: true }), APPLICABILITY.enabled);

    expect(forCheck(result.frameworkEvaluations, BACKUP_KEY)).toEqual([
      record(BACKUP_KEY, 'enabled', 'passed', 'backup_reported', { evidence_basis: 'aws_api', provenance: 'OBSERVED' }),
    ]);
    expect(frameworkIssues(result.issues)).toEqual([]);
  });

  it('a supported failure: the AWS Backup observation shows none', async () => {
    const result = await service().evaluateResource(resource({ has_backup: false }), APPLICABILITY.enabled);

    expect(forCheck(result.frameworkEvaluations, BACKUP_KEY)).toEqual([
      record(BACKUP_KEY, 'enabled', 'failed', 'no_backup_reported', { severity: 'critical', evidence_basis: 'aws_api', provenance: 'OBSERVED' }),
    ]);
    expect(frameworkIssues(result.issues)).toEqual([
      {
        severity: 'critical',
        category: 'backups',
        issue: BACKUP_TEXT,
        recommendation: 'Enable automated backups with minimum 30-day retention. Test backup restoration quarterly. Document backup procedures.',
        resource_arn: ARN,
        findingKey: BACKUP_KEY,
        framework: 'HIPAA',
        applicability: 'enabled',
        evaluation_state: 'failed',
        evidence_basis: 'aws_api',
        evaluation_reason: 'AWS Backup reports no backup for this resource',
      },
    ]);
    expect(isActiveComplianceFinding(frameworkIssues(result.issues)[0])).toBe(true);
  });

  it('insufficient evidence (backup state unknown) is unable_to_evaluate: not a finding, not a pass', async () => {
    const result = await service().evaluateResource(resource({ has_backup: null }), APPLICABILITY.enabled);

    expect(forCheck(result.frameworkEvaluations, BACKUP_KEY)).toEqual([record(BACKUP_KEY, 'enabled', 'unable_to_evaluate', 'backup_state_unknown')]);
    expect(frameworkIssues(result.issues)).toEqual([]);
  });

  const tagOnly: Array<[string, Partial<AWSResource>, string, 'none' | 'tag']> = [
    ['s3 access logging, no tag', { resource_type: 's3', tags: {} }, 'hipaa.access_logging', 'none'],
    ['s3 access logging, tag present', { resource_type: 's3', tags: { AccessLogging: 'true' } }, 'hipaa.access_logging', 'tag'],
    ['s3 versioning, no tag', { resource_type: 's3', tags: {} }, 'hipaa.s3_versioning', 'none'],
    ['rds encryption in transit, no tag', { resource_type: 'rds', tags: {} }, 'hipaa.encryption_in_transit', 'none'],
    ['rds encryption in transit, tag present', { resource_type: 'rds', tags: { SSLEnabled: 'true' } }, 'hipaa.encryption_in_transit', 'tag'],
    ['ec2 backup retention, no tag', { resource_type: 'ec2', tags: {} }, 'hipaa.backup_retention_policy', 'none'],
    ['ebs customer managed key, encrypted, no tag', { resource_type: 'ebs', tags: {}, is_encrypted: true }, 'hipaa.customer_managed_key', 'none'],
  ];

  it.each(tagOnly)('insufficient evidence (%s) is unable_to_evaluate whether or not a tag is present', async (_name, overrides, check, basis) => {
    const result = await service().evaluateResource(resource(overrides), APPLICABILITY.enabled);

    expect(forCheck(result.frameworkEvaluations, check)).toEqual([
      basis === 'tag'
        ? record(check, 'enabled', 'unable_to_evaluate', 'tag_only_evidence', { evidence_basis: 'tag', provenance: 'SELF_ATTESTED' })
        : record(check, 'enabled', 'unable_to_evaluate', 'no_evidence_collected'),
    ]);
    expect(result.issues.filter((i) => i.findingKey === check)).toEqual([]);
  });

  it('encryption state unknown is unable_to_evaluate for the customer-managed-key check', async () => {
    const result = await service().evaluateResource(resource({ is_encrypted: null }), APPLICABILITY.enabled);
    expect(forCheck(result.frameworkEvaluations, 'hipaa.customer_managed_key')).toEqual([
      record('hipaa.customer_managed_key', 'enabled', 'unable_to_evaluate', 'encryption_state_unknown'),
    ]);
  });

  it('a tag never produces a pass or a failure: every tag-only check stays unable_to_evaluate with all tags set and with none', async () => {
    const allTags = { KMSKey: 'k', SSLEnabled: 't', AccessLogging: 't', BackupRetention: '6y', VersioningEnabled: 't' };
    for (const tags of [{}, allTags]) {
      for (const resource_type of ['s3', 'rds', 'ec2', 'lambda', 'elasticache'] as const) {
        const result = await service().evaluateResource(resource({ resource_type, tags, has_backup: true }), APPLICABILITY.enabled);
        expect(result.frameworkEvaluations.length).toBeGreaterThan(0);
        expect(new Set(result.frameworkEvaluations.map((e) => e.evaluation_state))).toEqual(new Set(['unable_to_evaluate']));
        expect(frameworkIssues(result.issues)).toEqual([]);
      }
    }
  });

  it('an unencrypted resource is left to the baseline encryption check, recorded as not_evaluated rather than silently skipped', async () => {
    const result = await service().evaluateResource(resource({ is_encrypted: false }), APPLICABILITY.enabled);
    expect(forCheck(result.frameworkEvaluations, 'hipaa.customer_managed_key')).toEqual([
      record('hipaa.customer_managed_key', 'enabled', 'not_evaluated', 'covered_by_baseline_encryption_check', { evidence_basis: 'aws_api', provenance: 'OBSERVED' }),
    ]);
    expect(result.issues.filter((i) => i.category === 'encryption').map((i) => i.issue)).toEqual(['EBS resource is not encrypted']);
  });

  it('produces no outcome for a check that does not apply to the resource type', async () => {
    const result = await service().evaluateResource(resource({ resource_type: 'vpc' }), APPLICABILITY.enabled);
    expect(result.frameworkEvaluations).toEqual([]);
  });
});

describe('an evaluation error is its own state', () => {
  it('an exception becomes error with a category, never the message: no pass, no finding, and the other checks still run', async () => {
    const scanner = service();
    (scanner as any).frameworkChecks.HIPAA = HIPAA_CHECKS.map((check) =>
      check.key === BACKUP_KEY
        ? { ...check, evaluate: () => { throw new Error('secret-internal-detail arn:aws:iam::111122223333:role/x'); } }
        : check
    );
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await scanner.evaluateResource(resource({ has_backup: true, is_encrypted: false }), APPLICABILITY.enabled);

      expect(forCheck(result.frameworkEvaluations, BACKUP_KEY)).toEqual([
        record(BACKUP_KEY, 'enabled', 'error', 'check_exception', { error_code: 'check_exception' }),
      ]);
      expect(result.frameworkEvaluations[1].reason).toBe('Check could not be completed');
      expect(JSON.stringify(result)).not.toContain('secret-internal-detail');
      expect(frameworkIssues(result.issues)).toEqual([]);
      // Checks before and after the failing one, and the baseline checks, still ran.
      expect(result.frameworkEvaluations.map((e) => [e.check, e.evaluation_state])).toEqual([
        ['hipaa.customer_managed_key', 'not_evaluated'],
        [BACKUP_KEY, 'error'],
        ['hipaa.backup_retention_policy', 'unable_to_evaluate'],
      ]);
      expect(result.baselineIssues.map((i) => i.issue)).toEqual(['EBS resource is not encrypted']);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('several frameworks with different applicability in one scan', () => {
  it('evaluates only the enabled one, and reports each of the others with its own state and reason', async () => {
    const scanner = service();
    const always = (key: string, framework: string): FrameworkCheck => ({
      key,
      resourceTypes: ['ebs'],
      evaluate: () => ({ state: 'failed', severity: 'low', evidence_basis: 'aws_api', provenance: 'OBSERVED', reason_code: 'no_backup_reported' }),
      finding: () => ({ category: 'tagging', issue: `${framework}: fails`, recommendation: 'r' }),
    });
    (scanner as any).frameworkChecks.SECOND = [always('second.always_fails', 'SECOND')];
    (scanner as any).frameworkChecks.THIRD = [always('third.always_fails', 'THIRD')];
    (scanner as any).frameworkChecks.FOURTH = [always('fourth.always_fails', 'FOURTH')];

    const frameworks = [{ key: 'HIPAA' }, { key: 'SECOND' }, { key: 'THIRD' }, { key: 'FOURTH' }, { key: 'FIFTH' }];
    const applicability = resolveFrameworkApplicability(
      settings([
        { standard_name: 'HIPAA', enabled: false },
        { standard_name: 'SECOND', enabled: true },
        { standard_name: 'THIRD', enabled: 'yes' },
        { standard_name: 'FIFTH', enabled: true },
      ]),
      frameworks
    );

    const result = await scanner.evaluateResource(resource({ has_backup: false }), applicability);

    expect(result.frameworkEvaluations.map((e) => [e.framework, e.check, e.applicability, e.evaluation_state, e.reason_code])).toEqual([
      ['HIPAA', null, 'disabled', 'not_evaluated', 'explicitly_disabled'],
      ['SECOND', 'second.always_fails', 'enabled', 'failed', 'no_backup_reported'],
      ['THIRD', null, 'invalid', 'not_evaluated', 'invalid_enabled_value'],
      ['FOURTH', null, 'not_configured', 'not_evaluated', 'no_setting'],
      // Enabled, but nothing evaluates it: still not a pass.
      ['FIFTH', null, 'enabled', 'not_evaluated', 'no_checks_registered'],
    ]);
    expect(result.issues.filter((i) => i.framework !== undefined).map((i) => [i.framework, i.findingKey, i.severity, i.evaluation_state, i.issue])).toEqual([
      ['SECOND', 'second.always_fails', 'low', 'failed', 'SECOND: fails'],
    ]);
    expect(result.issues.some((i) => i.issue.startsWith('HIPAA'))).toBe(false);
  });
});

describe('severity and evaluation state stay separate', () => {
  it('only a failed evaluation carries a severity, in every applicability state', async () => {
    for (const applicability of Object.values(APPLICABILITY)) {
      for (const resource_type of ['ebs', 's3', 'rds', 'ec2'] as const) {
        const result = await service().evaluateResource(resource({ resource_type, has_backup: false, tags: {} }), applicability);
        for (const evaluation of result.frameworkEvaluations) {
          expect(evaluation.severity === null).toBe(evaluation.evaluation_state !== 'failed');
        }
      }
    }
  });

  it('each framework finding corresponds to exactly one failed evaluation, and is failed and enabled', async () => {
    for (const applicability of Object.values(APPLICABILITY)) {
      const result = await service().evaluateResource(resource({ has_backup: false }), applicability);
      const findings = result.issues.filter((i) => i.framework !== undefined);
      for (const issue of findings) expect(issue).toMatchObject({ evaluation_state: 'failed', applicability: 'enabled' });
      const failedChecks = result.frameworkEvaluations.filter((e) => e.evaluation_state === 'failed').map((e) => e.check);
      expect(findings.map((i) => i.findingKey)).toEqual(failedChecks);
    }
  });

  it('a pass or a failure always rests on an AWS observation, never on a tag or on nothing', async () => {
    const tags = { KMSKey: 'k', SSLEnabled: 't', AccessLogging: 't', BackupRetention: '6y', VersioningEnabled: 't' };
    for (const resource_type of ['ebs', 's3', 'rds', 'ec2', 'lambda', 'elasticache'] as const) {
      for (const has_backup of [true, false, null]) {
        const { frameworkEvaluations } = await service().evaluateResource(resource({ resource_type, has_backup, tags }), APPLICABILITY.enabled);
        for (const evaluation of frameworkEvaluations.filter((e) => ['passed', 'failed'].includes(e.evaluation_state))) {
          expect(evaluation).toMatchObject({ evidence_basis: 'aws_api', provenance: 'OBSERVED' });
        }
      }
    }
  });
});

describe('the finding of a stored failure', () => {
  it('is built from the stored outcome and the check\'s wording, without re-evaluating the resource', () => {
    // has_backup is not consulted: the stored row says the check failed.
    const finding = service().frameworkFinding(
      { resource_arn: ARN, resource_type: 'ebs' },
      'HIPAA',
      BACKUP_KEY,
      { severity: 'high', evidence_basis: 'aws_api', reason_code: 'no_backup_reported' }
    );
    expect(finding).toEqual({
      severity: 'high',
      category: 'backups',
      issue: BACKUP_TEXT,
      recommendation: 'Enable automated backups with minimum 30-day retention. Test backup restoration quarterly. Document backup procedures.',
      resource_arn: ARN,
      findingKey: BACKUP_KEY,
      framework: 'HIPAA',
      applicability: 'enabled',
      evaluation_state: 'failed',
      evidence_basis: 'aws_api',
      evaluation_reason: 'AWS Backup reports no backup for this resource',
    });
  });

  it('a stored failure whose check has no wording any more is still reported, by its key', () => {
    const finding = service().frameworkFinding({ resource_arn: ARN, resource_type: 'ebs' }, 'HIPAA', 'hipaa.retired', { severity: 'low', evidence_basis: 'aws_api', reason_code: 'nobody_knows_this_code' });
    expect(finding).toMatchObject({ severity: 'low', issue: 'HIPAA: check hipaa.retired failed', findingKey: 'hipaa.retired', evaluation_reason: 'No further detail is recorded' });
  });
});

describe('the check registry', () => {
  it('every check that can fail has finding wording, and keys are unique and storable', () => {
    for (const [framework, checks] of Object.entries(FRAMEWORK_CHECKS)) {
      expect(new Set(checks.map((c) => c.key)).size).toBe(checks.length);
      for (const check of checks) {
        expect(check.key).toMatch(/^[a-z0-9][a-z0-9._-]{0,95}$/);
        expect(framework).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
        for (const resource_type of check.resourceTypes) {
          for (const has_backup of [true, false, null]) {
            for (const is_encrypted of [true, false, null]) {
              const outcome = check.evaluate(resource({ resource_type: resource_type as any, has_backup, is_encrypted, tags: {} }));
              if (outcome.state === 'failed') expect(typeof check.finding).toBe('function');
              expect(outcome.reason_code).toMatch(/^[a-z][a-z0-9_]{0,47}$/);
              expect(evaluationReasonText(outcome.reason_code)).not.toBe('No further detail is recorded');
            }
          }
        }
      }
    }
  });

  it('applies a check to its resource types only', () => {
    const backups = HIPAA_CHECKS.find((c) => c.key === BACKUP_KEY)!;
    expect(['ebs', 'ec2', 'rds', 's3'].map((type) => checkAppliesTo(backups, type))).toEqual([true, false, false, false]);
    expect(service().registeredCheckKeys('HIPAA')).toEqual(HIPAA_CHECKS.map((c) => c.key));
    expect(service().registeredCheckKeys('NOPE')).toEqual([]);
  });
});

describe('baseline (non-framework) findings are unaffected by framework applicability', () => {
  // An EC2 instance that trips every baseline check.
  const exposed = () => resource({
    resource_type: 'ec2', resource_arn: 'arn:aws:ec2:us-east-1:111122223333:instance/i-1', tags: {},
    is_encrypted: false, is_public: true, has_backup: false,
  });
  const EXPECTED = [
    ['high', 'encryption', 'EC2 instance has unencrypted EBS volumes', 'OBSERVED'],
    ['high', 'public_access', 'EC2 instance has a public IP address', 'OBSERVED'],
    ['medium', 'backups', 'EC2 instance does not have regular snapshots', 'OBSERVED'],
    ['low', 'tagging', 'Resource is missing required tags: Owner, Environment, Team', 'SELF_ATTESTED'],
  ];

  it.each(Object.entries(APPLICABILITY))('HIPAA %s: the same baseline findings, with no framework or evaluation fields added', async (_state, applicability) => {
    const evaluation = await service().evaluateResource(exposed(), applicability);
    const issues = evaluation.issues.filter((i) => i.framework === undefined);

    expect(issues.map((i) => [i.severity, i.category, i.issue, i.provenance])).toEqual(EXPECTED);
    expect(evaluation.baselineIssues).toEqual(issues);
    expect(service().evaluateBaseline(exposed())).toEqual(issues);
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual(['category', 'issue', 'provenance', 'recommendation', 'resource_arn', 'severity']);
      expect(isActiveComplianceFinding(issue)).toBe(true);
    }
  });
});
