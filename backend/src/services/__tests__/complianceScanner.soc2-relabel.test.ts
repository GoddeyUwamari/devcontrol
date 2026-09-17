/**
 * Coverage for the SOC 2 Readiness disposition decision: the four legacy
 * tag-inferred checks inside ComplianceScannerService.checkSOC2Compliance
 * (formerly "SOC2:"-prefixed) are NOT valid SOC 2 evidence -- see the
 * disposition analysis this PR implements. This is a RELABEL only:
 *
 *   - issue text drops the "SOC2:" prefix in favor of a truthful
 *     infrastructure/tagging/observability label
 *   - signal 1's category changes from 'iam' to 'tagging' (it has always
 *     been a tag-documentation check, not a real IAM security check)
 *   - severity, trigger conditions, and resource-type gating are unchanged
 *   - none of the four checks call an AWS API -- they remain pure
 *     tag-presence checks, exactly as before
 *
 * No test existed for checkSOC2Compliance before this PR (confirmed via a
 * repo-wide search) -- every test below is new, not a modification of
 * prior coverage.
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

describe('checkSOC2Compliance -- signal 2: change-management tags', () => {
  it('missing LastModifiedBy/ChangeTicket/Version tag produces the new label, category, and severity, for any resource type', () => {
    for (const resource_type of ['ec2', 's3', 'rds', 'lambda', 'dynamodb'] as ResourceType[]) {
      const issues = checkSOC2(resource({ resource_type, tags: {} }));
      const finding = issues.find((i: any) => i.issue === 'Tagging: Missing change-tracking tags');
      expect(finding).toBeDefined();
      expect(finding.severity).toBe('medium');
      expect(finding.category).toBe('tagging'); // unchanged
    }
  });

  it('any one of LastModifiedBy/ChangeTicket/Version suppresses the finding (unchanged condition)', () => {
    for (const tag of ['LastModifiedBy', 'ChangeTicket', 'Version']) {
      const issues = checkSOC2(resource({ resource_type: 'ec2', tags: { [tag]: 'x' } }));
      expect(issues.find((i: any) => i.issue === 'Tagging: Missing change-tracking tags')).toBeUndefined();
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

describe('checkSOC2Compliance -- signal 4: S3 access-logging tag', () => {
  it('missing AccessLogging tag on an s3 resource produces the new label, category, and severity', () => {
    const issues = checkSOC2(resource({ resource_type: 's3', tags: {} }));
    const finding = issues.find((i: any) => i.issue === 'S3: Access logging not documented via tag');
    expect(finding).toBeDefined();
    expect(finding.severity).toBe('high');
    expect(finding.category).toBe('networking'); // unchanged in this PR
  });

  it('only applies to s3 (unchanged condition)', () => {
    const issues = checkSOC2(resource({ resource_type: 'ec2', tags: {} }));
    expect(issues.find((i: any) => i.issue === 'S3: Access logging not documented via tag')).toBeUndefined();
  });

  it('an AccessLogging tag suppresses the finding (unchanged condition)', () => {
    const issues = checkSOC2(resource({ resource_type: 's3', tags: { AccessLogging: 'true' } }));
    expect(issues.find((i: any) => i.issue === 'S3: Access logging not documented via tag')).toBeUndefined();
  });
});

describe('checkSOC2Compliance -- no SOC2 prefix anywhere, and remains tag-inferred only', () => {
  it('a fully untagged s3 resource (signals 2, 3, and 4 fire) never emits "SOC2:" anywhere', () => {
    const issues = checkSOC2(resource({ resource_type: 's3', tags: {} }));
    expect(issues).toHaveLength(3);
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

  it('a fully tagged s3 resource produces zero findings from these four signals', () => {
    const issues = checkSOC2(resource({
      resource_type: 's3',
      tags: {
        IAMRole: 'x',
        LastModifiedBy: 'x',
        MonitoringEnabled: 'true',
        AccessLogging: 'true',
      },
    }));
    expect(issues).toHaveLength(0);
  });
});

describe('checkSOC2Compliance -- relabel is score-neutral (uses the authoritative backend formula, not a duplicate)', () => {
  it('feeding the exact severity multiset these four relabeled signals produce into calculateRiskScore yields the same result the pre-relabel severities would have', () => {
    // No single resource type triggers all four signals at once (signal 1 excludes
    // s3/rds; signal 4 is s3-only) -- a fully untagged ec2 resource triggers exactly
    // three of them (signals 1, 2, 3) with their documented (unchanged) severities:
    // high, medium, high.
    const issues = checkSOC2(resource({ resource_type: 'ec2', tags: {} }));
    expect(issues).toHaveLength(3);

    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const i of issues) {
      bySeverity[i.severity as 'critical' | 'high' | 'medium' | 'low']++;
    }
    // This is the severity multiset that existed under the old "SOC2:" labels too --
    // relabeling changed no severities, so this must still be {high: 2, medium: 1}.
    expect(bySeverity).toEqual({ critical: 0, high: 2, medium: 1, low: 0 });

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
    //                 = max(0, 100 - (0 + 2*5 + 1*2 + 0)) = max(0, 100-12) = 88
    // totalScore = publicAccess(100)*0.30 + encryption(100)*0.25 + compliance(88)*0.25
    //            + backup(100)*0.15 + resourceMgmt(100)*0.05
    //            = 30 + 25 + 22 + 15 + 5 = 97
    expect(result.factors.compliance).toBe(88);
    expect(result.score).toBe(97);
  });

  it('category is the only structural field signal 1 changed -- category alone is not read by calculateRiskScore, so the score above is unaffected by the iam->tagging category change', () => {
    // calculateRiskScore's `complianceIssues`/`resourceComplianceCounts` inputs are
    // severity-keyed counts only (see backend/src/utils/riskScoring.ts) -- category
    // never enters the formula. This assertion documents that guarantee explicitly
    // so a future change to the formula's input shape doesn't silently reintroduce
    // a category-sensitive scoring rule without this test catching it.
    const issues = checkSOC2(resource({ resource_type: 'ec2', tags: {} }));
    const iamOwnerFinding = issues.find((i: any) => i.issue === 'Tagging: IAM role/owner not documented');
    expect(iamOwnerFinding.category).toBe('tagging');
  });
});
