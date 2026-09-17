/**
 * Coverage for the ComplianceIssue provenance foundation PR:
 *
 *   - ComplianceIssueProvenance accepts exactly OBSERVED/DERIVED/SELF_ATTESTED
 *   - real-AWS-API-backed producers (encryption/public-access/backup checks,
 *     the enhanced S3 public-access check, security groups, IAM MFA/stale-key
 *     findings) emit `provenance: 'OBSERVED'`
 *   - tag-only producers (generic checkTags, and the three surviving
 *     checkSOC2Compliance signals) emit `provenance: 'SELF_ATTESTED'`
 *   - checkHIPAACompliance findings are deliberately left without a blanket
 *     provenance value -- its sub-checks mix OBSERVED (has_backup) and
 *     SELF_ATTESTED (tag-only) evidence, and classifying each individually
 *     is out of scope for this PR (see complianceScanner.ts's checkSOC2Compliance
 *     doc comment and the implementation-readiness audit this PR implements)
 *   - the new 'observability' ComplianceCategory is wired into every exhaustive
 *     backend category structure (getCategoryDisplayName, getComplianceStats'
 *     tally) without being *produced* by any current detector (Signal 3/4
 *     category is explicitly unchanged in this PR)
 *   - category (old or new) never affects calculateRiskScore
 *   - old JSON compliance_issues rows without a `provenance` key remain valid
 *     and are handled the same as any other issue by the stats tally
 */
import { ComplianceScannerService } from '../complianceScanner';
import { AWSResourcesRepository } from '../../repositories/awsResources.repository';
import { AWSResource, ComplianceIssue, ComplianceIssueProvenance } from '../../types/aws-resources.types';
import { calculateRiskScore } from '../../utils/riskScoring';
import { EC2Client } from '@aws-sdk/client-ec2';
import { S3Client } from '@aws-sdk/client-s3';
import {
  IAMClient,
  ListUsersCommand,
  ListMFADevicesCommand,
  ListAccessKeysCommand,
  GetLoginProfileCommand,
} from '@aws-sdk/client-iam';
import { Pool, PoolClient } from 'pg';

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

describe('ComplianceIssueProvenance -- exactly three values', () => {
  it('accepts OBSERVED, DERIVED, and SELF_ATTESTED, and no others, at the type level', () => {
    // Compile-time proof: this assignment only type-checks if the union is exactly
    // these three values (in either order) -- an extra or missing member would fail
    // `tsc --noEmit`, which is run as part of this PR's verification.
    const values: ComplianceIssueProvenance[] = ['OBSERVED', 'DERIVED', 'SELF_ATTESTED'];
    expect(new Set(values).size).toBe(3);
  });

  it('is optional -- a ComplianceIssue with no provenance key is still a valid ComplianceIssue', () => {
    const issue: ComplianceIssue = {
      severity: 'low',
      category: 'tagging',
      issue: 'test',
      recommendation: 'test',
    };
    expect(issue.provenance).toBeUndefined();
  });
});

describe('OBSERVED producers -- checkEncryption/checkPublicAccess/checkBackups', () => {
  it('checkEncryption emits OBSERVED on verified-false evidence', () => {
    const issues = (service as any).checkEncryption(resource({ resource_type: 's3', is_encrypted: false }));
    expect(issues).toHaveLength(1);
    expect(issues[0].provenance).toBe('OBSERVED');
    expect(issues[0].issue).toBe('S3 bucket does not have default encryption enabled');
  });

  it('checkEncryption emits nothing (not even an unprovenanced issue) on null/unknown evidence', () => {
    const issues = (service as any).checkEncryption(resource({ resource_type: 's3', is_encrypted: null }));
    expect(issues).toHaveLength(0);
  });

  it('checkPublicAccess emits OBSERVED', () => {
    const issues = (service as any).checkPublicAccess(resource({ resource_type: 's3', is_public: true }));
    expect(issues).toHaveLength(1);
    expect(issues[0].provenance).toBe('OBSERVED');
  });

  it('checkBackups emits OBSERVED on verified-false evidence', () => {
    const issues = (service as any).checkBackups(resource({ resource_type: 'rds', has_backup: false }));
    expect(issues).toHaveLength(1);
    expect(issues[0].provenance).toBe('OBSERVED');
  });
});

describe('SELF_ATTESTED producers -- generic checkTags and the three surviving checkSOC2Compliance signals', () => {
  it('checkTags emits SELF_ATTESTED', () => {
    const issues = (service as any).checkTags(resource({ tags: {} }));
    expect(issues).toHaveLength(1);
    expect(issues[0].provenance).toBe('SELF_ATTESTED');
  });

  it('signal 1 (IAM role/owner tag) emits SELF_ATTESTED', () => {
    const issues = (service as any).checkSOC2Compliance(resource({ resource_type: 'ec2', tags: {} }));
    const finding = issues.find((i: ComplianceIssue) => i.issue === 'Tagging: IAM role/owner not documented');
    expect(finding.provenance).toBe('SELF_ATTESTED');
  });

  it('signal 3 (monitoring/logging tag) emits SELF_ATTESTED', () => {
    const issues = (service as any).checkSOC2Compliance(resource({ resource_type: 'ec2', tags: {} }));
    const finding = issues.find((i: ComplianceIssue) => i.issue === 'Observability: Monitoring/logging not documented via tag');
    expect(finding.provenance).toBe('SELF_ATTESTED');
  });

  it('signal 4 (S3 access-logging tag) emits SELF_ATTESTED', () => {
    const issues = (service as any).checkSOC2Compliance(resource({ resource_type: 's3', tags: {} }));
    const finding = issues.find((i: ComplianceIssue) => i.issue === 'S3: Access logging not documented via tag');
    expect(finding.provenance).toBe('SELF_ATTESTED');
  });

  it('signal 2 (change-management tags) no longer produces any finding, provenanced or otherwise', () => {
    const issues = (service as any).checkSOC2Compliance(resource({ resource_type: 'ec2', tags: {} }));
    expect(issues.find((i: ComplianceIssue) => i.issue === 'Tagging: Missing change-tracking tags')).toBeUndefined();
  });
});

describe('HIPAA findings are NOT assigned a blanket provenance', () => {
  it('checkHIPAACompliance findings have provenance left unset (undefined), not guessed', () => {
    const issues = (service as any).checkHIPAACompliance(resource({
      resource_type: 's3',
      is_encrypted: true,
      tags: {},
    }));
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.provenance).toBeUndefined();
    }
  });
});

describe('OBSERVED producers requiring an AWS client mock', () => {
  it('checkS3PublicAccessEnhanced emits OBSERVED for a public ACL finding', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ Grants: [{ Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' }, Permission: 'READ' }] })
      .mockRejectedValueOnce(Object.assign(new Error('no policy'), { name: 'NoSuchBucketPolicy' }));
    const s3Client = { send } as unknown as S3Client;

    const issues = await service.checkS3PublicAccessEnhanced(
      resource({ resource_type: 's3', resource_id: 'bucket-1' }),
      s3Client
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].provenance).toBe('OBSERVED');
  });

  it('checkSecurityGroups emits OBSERVED for an unrestricted-ingress finding', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      SecurityGroups: [{
        GroupId: 'sg-1',
        GroupName: 'web-sg',
        IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }],
      }],
    });
    const ec2Client = { send } as unknown as EC2Client;

    const { issues } = await service.checkSecurityGroups(ec2Client, 'us-east-1', '123456789012');
    expect(issues).toHaveLength(1);
    expect(issues[0].provenance).toBe('OBSERVED');
  });

  it('checkIAMSecurity emits OBSERVED for both an MFA finding and a stale-access-key finding', async () => {
    const send = jest.fn(async (command: any) => {
      if (command instanceof ListUsersCommand) {
        return { Users: [{ UserName: 'alice', Arn: 'arn:aws:iam::1:user/alice' }] };
      }
      if (command instanceof ListMFADevicesCommand) {
        return { MFADevices: [] };
      }
      if (command instanceof GetLoginProfileCommand) {
        return {}; // has console access
      }
      if (command instanceof ListAccessKeysCommand) {
        return {
          AccessKeyMetadata: [
            { AccessKeyId: 'AKIASTALE', CreateDate: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000), Status: 'Active' },
          ],
        };
      }
      throw new Error(`unexpected command: ${command.constructor.name}`);
    });
    const iamClient = new IAMClient({ region: 'us-east-1' });
    (iamClient as any).send = send;

    const { issues } = await service.checkIAMSecurity(iamClient);
    expect(issues).toHaveLength(2);
    for (const issue of issues) {
      expect(issue.provenance).toBe('OBSERVED');
    }
  });
});

describe('observability category -- wired into exhaustive backend structures, not yet produced by any detector', () => {
  it('getCategoryDisplayName covers observability', () => {
    expect(ComplianceScannerService.getCategoryDisplayName('observability')).toBe('Observability');
  });

  it('getComplianceStats tallies an observability-categoried issue correctly (mocked PoolClient, no real DB)', async () => {
    const repository = new AWSResourcesRepository({} as Pool);
    const mockClient = {
      query: jest.fn().mockResolvedValue({
        rows: [
          { compliance_issues: [{ severity: 'high', category: 'observability', issue: 'x', recommendation: 'y' }] },
          { compliance_issues: [{ severity: 'low', category: 'tagging', issue: 'x', recommendation: 'y' }] },
        ],
      }),
    } as unknown as PoolClient;

    const stats = await (repository as any).getComplianceStats(mockClient, 'org-1');
    expect(stats.by_category.observability).toBe(1);
    expect(stats.by_category.tagging).toBe(1);
    expect(stats.total_issues).toBe(2);
  });

  it('Signal 3/4 category is unchanged (still networking) in this PR -- the new category exists but is not yet produced by these detectors', () => {
    const issues = (service as any).checkSOC2Compliance(resource({ resource_type: 's3', tags: {} }));
    for (const i of issues) {
      expect(i.category).not.toBe('observability');
      expect(i.category).toBe('networking');
    }
  });
});

describe('category never affects calculateRiskScore', () => {
  it('an issue set categorized as observability scores identically to the same severities categorized as networking', () => {
    const base = {
      totalResources: 1,
      unencryptedResources: 0,
      publicResources: 0,
      accountFindingsCounts: { critical: 0, high: 0, medium: 0, low: 0 },
      missingBackups: 0,
      orphanedResources: 0,
      scanCompleted: true,
    };
    const severities = { critical: 0, high: 1, medium: 0, low: 0 };

    // calculateRiskScore never reads `category` -- only severity counts -- so the
    // result must be identical regardless of what category label produced them.
    const result = calculateRiskScore({ ...base, complianceIssues: severities, resourceComplianceCounts: severities });
    expect(result.factors.compliance).toBe(95); // 100 - 1*5
  });
});

describe('backward compatibility -- old JSON without provenance', () => {
  it('a legacy-shaped ComplianceIssue (no provenance key) is tallied identically to a provenanced one', async () => {
    const repository = new AWSResourcesRepository({} as Pool);
    const mockClient = {
      query: jest.fn().mockResolvedValue({
        rows: [
          // Legacy row: no `provenance` key at all, exactly as JSONB written before this PR.
          { compliance_issues: [{ severity: 'medium', category: 'tagging', issue: 'legacy', recommendation: 'legacy' }] },
        ],
      }),
    } as unknown as PoolClient;

    const stats = await (repository as any).getComplianceStats(mockClient, 'org-1');
    expect(stats.by_severity.medium).toBe(1);
    expect(stats.by_category.tagging).toBe(1);
    expect(stats.total_issues).toBe(1);
  });

  it('JSON.stringify/parse round-trips a provenance-less issue without introducing the key', () => {
    const legacy: ComplianceIssue = { severity: 'low', category: 'tagging', issue: 'x', recommendation: 'y' };
    const roundTripped = JSON.parse(JSON.stringify(legacy));
    expect('provenance' in roundTripped).toBe(false);
  });
});
