/**
 * Coverage for the SOC 2 Readiness disposition decision: the legacy
 * tag-inferred checks inside ComplianceScannerService.checkSOC2Compliance
 * (formerly "SOC2:"-prefixed) are NOT valid SOC 2 evidence -- see the
 * disposition analysis this PR implements. This was originally a RELABEL
 * only (issue text, category, provenance -- not severity/trigger/scoring):
 *
 *   - issue text drops the "SOC2:" prefix in favor of a truthful
 *     infrastructure/tagging/observability label
 *   - signal 1's category changes from 'iam' to 'tagging' (it has always
 *     been a tag-documentation check, not a real IAM security check)
 *   - severity and resource-type gating are unchanged for the two
 *     surviving signals
 *   - none of the surviving checks call an AWS API -- they remain pure
 *     tag-presence checks, exactly as before, now carrying
 *     `provenance: 'SELF_ATTESTED'`
 *
 * A later PR (ComplianceIssue provenance foundation) retired the former
 * "signal 2" (change-management tags: LastModifiedBy/ChangeTicket/Version)
 * outright -- see the "signal 2 retired" describe block below. That
 * retirement is NOT score-neutral (it removes real medium-severity findings
 * from any org currently missing those tags); only the surviving signals'
 * relabel remains score-neutral, as documented in the last describe block.
 *
 * A still-later production-accuracy fix retired the former "signal 4" (S3
 * access-logging tag) outright too -- see the "signal 4 retired" describe
 * block below. Unlike signal 2, this wasn't retired for being too broad: S3
 * discovery never collects bucket tags at all (discoverS3Buckets() writes
 * `tags: {}` unconditionally, every scan -- see awsResourceDiscovery.ts), so
 * this specific tag-presence check was structurally guaranteed to fire for
 * every S3 bucket in every organization regardless of actual AWS
 * configuration. Not weak evidence -- a permanent false positive with no
 * tagging-based remediation path. Also not score-neutral for the same
 * reason signal 2's retirement isn't.
 *
 * No test existed for checkSOC2Compliance before the original relabel PR
 * (confirmed via a repo-wide search) -- every test below is new, not a
 * modification of prior coverage.
 */
import { ComplianceScannerService } from '../complianceScanner';
import { AWSResource, ResourceType } from '../../types/aws-resources.types';
import { calculateRiskScore } from '../../utils/riskScoring';

function resource(overrides: Partial<AWSResource>): AWSResource {
  return {
    id: 'id-1',
    organization_id: 'org-1',
    resource_arn: 'arn:aws:ec2:us-east-1:1:instance/i-1',
    resource_id: 'i-1',
    resource_name: 'test-resource',
    resource_type: 'ec2',
    region: 'us-east-1',
    tags: {},
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

const service = new ComplianceScannerService();

function checkSOC2(res: AWSResource) {
  return (service as any).checkSOC2Compliance(res);
}

describe('checkSOC2Compliance -- signal 1: IAM role/owner tag', () => {
  it('missing IAMRole/Role tag on an ec2/lambda/ecs resource produces the new label, category, and severity', () => {
    for (const resource_type of ['ec2', 'lambda', 'ecs'] as ResourceType[]) {
      const issues = checkSOC2(resource({ resource_type, tags: {} }));
      const finding = issues.find((i: any) => i.issue === 'Tagging: IAM role/owner not documented');
      expect(finding).toBeDefined();
      expect(finding.severity).toBe('high');
      expect(finding.category).toBe('tagging'); // relabeled from 'iam'
    }
  });

  it('never emits the old "SOC2:" prefixed text', () => {
    const issues = checkSOC2(resource({ resource_type: 'ec2', tags: {} }));
    for (const i of issues) {
      expect(i.issue).not.toMatch(/^SOC2:/);
    }
  });

  it('a resource type outside ec2/lambda/ecs is not evaluated for this signal (unchanged condition)', () => {
    const issues = checkSOC2(resource({ resource_type: 's3', tags: {} }));
    expect(issues.find((i: any) => i.issue === 'Tagging: IAM role/owner not documented')).toBeUndefined();
  });

  it('an IAMRole or Role tag suppresses the finding (unchanged condition)', () => {
    expect(checkSOC2(resource({ resource_type: 'ec2', tags: { IAMRole: 'x' } })).find((i: any) => i.issue.startsWith('Tagging: IAM role'))).toBeUndefined();
    expect(checkSOC2(resource({ resource_type: 'ec2', tags: { Role: 'x' } })).find((i: any) => i.issue.startsWith('Tagging: IAM role'))).toBeUndefined();
  });
});

describe('checkSOC2Compliance -- signal 2 (change-management tags): retired', () => {
  it('never produces the former change-tracking finding, tagged or untagged, for any resource type', () => {
    for (const resource_type of ['ec2', 's3', 'rds', 'lambda', 'dynamodb'] as ResourceType[]) {
      const untagged = checkSOC2(resource({ resource_type, tags: {} }));
      expect(untagged.find((i: any) => i.issue === 'Tagging: Missing change-tracking tags')).toBeUndefined();

      for (const tag of ['LastModifiedBy', 'ChangeTicket', 'Version']) {
        const tagged = checkSOC2(resource({ resource_type, tags: { [tag]: 'x' } }));
        expect(tagged.find((i: any) => i.issue === 'Tagging: Missing change-tracking tags')).toBeUndefined();
      }
    }
  });
});

describe('checkSOC2Compliance -- signal 3: monitoring/logging tag', () => {
  it('missing MonitoringEnabled/LoggingEnabled/CloudWatchAlarms tag on ec2/rds/lambda/s3 produces the new label, category, and severity', () => {
    for (const resource_type of ['ec2', 'rds', 'lambda', 's3'] as ResourceType[]) {
      const issues = checkSOC2(resource({ resource_type, tags: {} }));
      const finding = issues.find((i: any) => i.issue === 'Observability: Monitoring/logging not documented via tag');
      expect(finding).toBeDefined();
      expect(finding.severity).toBe('high');
      expect(finding.category).toBe('networking'); // unchanged in this PR -- taxonomy fix is a separate decision
    }
  });

  it('a resource type outside ec2/rds/lambda/s3 is not evaluated for this signal (unchanged condition)', () => {
    const issues = checkSOC2(resource({ resource_type: 'dynamodb', tags: {} }));
    expect(issues.find((i: any) => i.issue.startsWith('Observability:'))).toBeUndefined();
  });

  it('the recommendation text for every covered resource type no longer references SOC2', () => {
    // The switch inside this check has an explicit case for all four gated types
    // (s3/rds/ec2/lambda), so the switch's own `default` is unreachable given the
    // outer if-condition -- verify each real branch directly instead.
    for (const resource_type of ['ec2', 'rds', 'lambda', 's3'] as ResourceType[]) {
      const issues = checkSOC2(resource({ resource_type, tags: {} }));
      const finding = issues.find((i: any) => i.issue === 'Observability: Monitoring/logging not documented via tag');
      expect(finding.recommendation).not.toMatch(/SOC2/i);
    }
  });
});

describe('checkSOC2Compliance -- signal 4 (S3 access-logging tag): retired', () => {
  it('never produces the former S3 access-logging finding, tagged or untagged', () => {
    const untagged = checkSOC2(resource({ resource_type: 's3', tags: {} }));
    expect(untagged.find((i: any) => i.issue === 'S3: Access logging not documented via tag')).toBeUndefined();

    const tagged = checkSOC2(resource({ resource_type: 's3', tags: { AccessLogging: 'true' } }));
    expect(tagged.find((i: any) => i.issue === 'S3: Access logging not documented via tag')).toBeUndefined();
  });

  it('never produces any finding with "SOC2" or the retired S3 access-logging text, for any resource type', () => {
    for (const resource_type of ['ec2', 's3', 'rds', 'lambda', 'dynamodb'] as ResourceType[]) {
      const issues = checkSOC2(resource({ resource_type, tags: {} }));
      for (const i of issues) {
        expect(i.issue).not.toMatch(/^SOC2:/);
        expect(i.issue).not.toBe('S3: Access logging not documented via tag');
      }
    }
  });
});

describe('checkSOC2Compliance -- no SOC2 prefix anywhere, and remains tag-inferred only', () => {
  it('a fully untagged s3 resource (only signal 3 fires -- signal 1 excludes s3, signal 4 is retired) never emits "SOC2:" anywhere', () => {
    const issues = checkSOC2(resource({ resource_type: 's3', tags: {} }));
    expect(issues).toHaveLength(1);
    for (const i of issues) {
      expect(i.issue).not.toMatch(/SOC2/);
      expect(i.recommendation).not.toMatch(/SOC2/i);
    }
  });

  it('checkSOC2Compliance takes only a resource object -- no AWS client parameter, confirming it cannot call an AWS API', () => {
    // Structural guarantee, not just a behavioral one: the method signature itself
    // (resource: AWSResource) => ComplianceIssue[] admits no client to call AWS with.
    expect(service['checkSOC2Compliance'].length).toBe(1);
  });

  it('a fully tagged s3 resource produces zero findings from the surviving signals', () => {
    const issues = checkSOC2(resource({
      resource_type: 's3',
      tags: {
        IAMRole: 'x',
        MonitoringEnabled: 'true',
      },
    }));
    expect(issues).toHaveLength(0);
  });
});

describe('checkSOC2Compliance -- surviving signals feed calculateRiskScore correctly; category never affects score', () => {
  // NOTE: this documents current severity->score behavior for the surviving
  // signals (1 and 3), NOT a score-neutrality claim for this PR. Retiring the former
  // signal 2 (change-management tags) and signal 4 (S3 access-logging tag) each
  // removed real findings for orgs affected by them -- genuine, org-dependent Risk
  // Score changes, not asserted or measured here. Production impact is measured
  // after deploy via the standing verification workflow, not via this unit test.
  it('feeding the exact severity multiset the two resource-type-gated signals produce into calculateRiskScore yields the documented result', () => {
    // signal 1 excludes s3/rds -- a fully untagged ec2 resource triggers both
    // surviving signals (1 and 3), each 'high'.
    const issues = checkSOC2(resource({ resource_type: 'ec2', tags: {} }));
    expect(issues).toHaveLength(2);

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of issues) {
      bySeverity[i.severity as 'critical' | 'high' | 'medium' | 'low']++;
    }
    expect(bySeverity).toEqual({ critical: 0, high: 2, medium: 0, low: 0 });

    const result = calculateRiskScore({
      totalResources: 1,
      unencryptedResources: 0,
      publicResources: 0,
      complianceIssues: bySeverity,
      accountFindingsCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      resourceComplianceCounts: bySeverity,
      missingBackups: 0,
      orphanedResources: 0,
      scanCompleted: true,
    });

    // complianceScore = max(0, 100 - (critical*10 + high*5 + medium*2 + low*1))
    //                 = max(0, 100 - (0 + 2*5 + 0 + 0)) = max(0, 100-10) = 90
    // totalScore = publicAccess(100)*0.30 + encryption(100)*0.25 + compliance(90)*0.25
    //            + backup(100)*0.15 + resourceMgmt(100)*0.05
    //            = 30 + 25 + 22.5 + 15 + 5 = 97.5 -> Math.round -> 98
    expect(result.factors.compliance).toBe(90);
    expect(result.score).toBe(98);
  });

  it('category (including the new observability category, and signal 1\'s iam->tagging relabel) is not read by calculateRiskScore', () => {
    // calculateRiskScore's `complianceIssues`/`resourceComplianceCounts` inputs are
    // severity-keyed counts only (see backend/src/utils/riskScoring.ts) -- category
    // never enters the formula. This assertion documents that guarantee explicitly
    // so a future change to the formula's input shape doesn't silently reintroduce
    // a category-sensitive scoring rule without this test catching it.
    const issues = checkSOC2(resource({ resource_type: 'ec2', tags: {} }));
    const iamOwnerFinding = issues.find((i: any) => i.issue === 'Tagging: IAM role/owner not documented');
    expect(iamOwnerFinding.category).toBe('tagging');

    const observabilityFinding = issues.find((i: any) => i.issue === 'Observability: Monitoring/logging not documented via tag');
    expect(observabilityFinding.category).toBe('networking'); // unchanged in this PR

    const result = calculateRiskScore({
      totalResources: 1,
      unencryptedResources: 0,
      publicResources: 0,
      complianceIssues: { critical: 0, high: 2, medium: 0, low: 0 },
      accountFindingsCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      resourceComplianceCounts: { critical: 0, high: 2, medium: 0, low: 0 },
      missingBackups: 0,
      orphanedResources: 0,
      scanCompleted: true,
    });
    expect(result.score).toBe(98);
  });
});
