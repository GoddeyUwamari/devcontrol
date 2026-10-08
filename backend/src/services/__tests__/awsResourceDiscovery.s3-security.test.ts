/**
 * The S3 security evaluation inside AWSResourceDiscoveryService.discoverAllResources:
 * the compliance-scan loop passes the org's S3 Control client and account id, falls
 * back to carrying previous findings forward unverified when an evaluation throws
 * (without aborting the remaining resources), persists the result, and logs the
 * per-scan pass/fail/unknown counts.
 *
 * Real Postgres for aws_resources (the persisted snapshot is what is under test).
 * AWSClientFactory is mocked: ListBuckets is denied, so S3 discovery and S3
 * reconciliation leave the pre-inserted bucket rows alone, and every other AWS
 * phase fails fast inside its own try/catch, as in awsResourceDiscovery.first-insight-funnel.test.ts.
 * No real AWS call is made.
 */
import { Pool } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import { ComplianceScannerService } from '../complianceScanner';
import costOptimizationService from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { S3_FINDING_KEYS } from '../s3-security-evaluation';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
const ACCOUNT_ID = '111122223333';

const ALL_BLOCKED = { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true };
const awsError = (name: string) => Object.assign(new Error(name), { name });

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`S3 Security Org ${suffix}`, `s3-security-org-${suffix}`, `S3 Security Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertBucket(orgId: string, name: string, complianceIssues: unknown[]): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
        is_encrypted, is_public, has_backup, compliance_issues)
     VALUES ($1, $2, $3, $3, 's3', 'us-east-1', 'active', true, false, null, $4)`,
    [orgId, `arn:aws:s3:::${name}`, name, JSON.stringify(complianceIssues)]
  );
}

async function issuesFor(orgId: string, name: string): Promise<any[]> {
  const { rows } = await pool.query(
    `SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND resource_id = $2`,
    [orgId, name]
  );
  return rows[0].compliance_issues;
}

const PROTECTED_POLICY = (bucket: string) => JSON.stringify({
  Version: '2012-10-17',
  Statement: [{
    Sid: 'DenyInsecureTransport', Effect: 'Deny', Principal: '*', Action: 's3:*',
    Resource: [`arn:aws:s3:::${bucket}`, `arn:aws:s3:::${bucket}/*`],
    Condition: { Bool: { 'aws:SecureTransport': 'false' } },
  }],
});

/** Per-bucket S3 behaviour, keyed by the command's Bucket input. */
function s3Client() {
  return {
    send: jest.fn(async (command: { constructor: { name: string }; input: { Bucket?: string } }) => {
      const name = command.constructor.name;
      const bucket = command.input?.Bucket;
      if (name === 'ListBucketsCommand') throw awsError('AccessDenied');
      if (bucket?.startsWith('protected')) {
        switch (name) {
          case 'GetBucketPolicyCommand': return { Policy: PROTECTED_POLICY(bucket) };
          case 'GetBucketPolicyStatusCommand': return { PolicyStatus: { IsPublic: false } };
          case 'GetPublicAccessBlockCommand': return { PublicAccessBlockConfiguration: ALL_BLOCKED };
          case 'GetBucketOwnershipControlsCommand': return { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } };
          case 'GetBucketAclCommand': return { Grants: [] };
        }
      }
      if (bucket?.startsWith('public')) {
        switch (name) {
          case 'GetBucketPolicyCommand': return { Policy: JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${bucket}/*` }] }) };
          case 'GetBucketPolicyStatusCommand': return { PolicyStatus: { IsPublic: true } };
          case 'GetPublicAccessBlockCommand': throw awsError('NoSuchPublicAccessBlockConfiguration');
          case 'GetBucketOwnershipControlsCommand': return { OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] } };
          case 'GetBucketAclCommand': return { Grants: [] };
        }
      }
      throw awsError('AccessDenied');
    }),
  };
}

function mockAwsClients(s3: object, s3Control: object) {
  return jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true,
    region: 'us-east-1',
    accountId: ACCOUNT_ID,
    s3,
    s3Control,
    costExplorer: {}, ec2: {}, rds: {}, cloudWatch: {}, lambda: {}, ecs: {}, elb: {}, eks: {}, dynamodb: {},
    cloudFront: {}, apiGateway: {}, elastiCache: {}, sqs: {}, sns: {}, iam: {}, resourceExplorer: {},
  } as any);
}

function mockCostAnalysis() {
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [] } as any);
  jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 } as any);
  jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
  jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

const keyedPolicyFinding = {
  severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access', recommendation: 'r',
  provenance: 'OBSERVED', findingKey: S3_FINDING_KEYS.publicPolicy,
};

function tallyLineFrom(logSpy: jest.SpyInstance): string | undefined {
  return logSpy.mock.calls.map((c) => String(c[0])).find((line) => line.includes('[Discovery] S3 security evaluation:'));
}

describe('discovery compliance loop: S3 security evaluation', () => {
  it('wires the S3 Control client and account id, persists the evaluated findings, and logs the counts', async () => {
    const orgId = await insertOrg();
    await insertBucket(orgId, 'protected-bucket', [
      { severity: 'critical', category: 'public_access', issue: 'S3 bucket policy allows public access (wildcard principal)', recommendation: 'r', provenance: 'OBSERVED' },
      { severity: 'critical', category: 'encryption', issue: 'HIPAA: S3 must have encryption in transit for PHI data', recommendation: 'r' },
    ]);
    await insertBucket(orgId, 'public-bucket', []);

    const s3 = s3Client();
    const s3Control = { send: jest.fn().mockRejectedValue(awsError('NoSuchPublicAccessBlockConfiguration')) };
    mockAwsClients(s3, s3Control);
    mockCostAnalysis();
    const evaluateSpy = jest.spyOn(ComplianceScannerService.prototype, 'evaluateS3Security');
    const logSpy = jest.spyOn(console, 'log');

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    // Wiring: every S3 row is evaluated with the factory's S3 client, S3 Control client and account id.
    expect(evaluateSpy).toHaveBeenCalledTimes(2);
    for (const call of evaluateSpy.mock.calls) {
      expect(call[1]).toBe(s3);
      expect(call[2]).toEqual({ s3Control, accountId: ACCOUNT_ID });
    }
    // Account-level Block Public Access: one lookup for the whole scan, for this account.
    expect(s3Control.send).toHaveBeenCalledTimes(1);
    expect((s3Control.send.mock.calls[0][0] as any).input).toEqual({ AccountId: ACCOUNT_ID });

    // Protected bucket: both legacy false positives cleared by a verified re-scan.
    const protectedIssues = await issuesFor(orgId, 'protected-bucket');
    expect(protectedIssues.filter((i: any) => String(i.findingKey ?? '').startsWith('s3.'))).toEqual([]);
    expect(protectedIssues.map((i: any) => i.issue)).not.toContain('S3 bucket policy allows public access (wildcard principal)');
    expect(protectedIssues.map((i: any) => i.issue)).not.toContain('HIPAA: S3 must have encryption in transit for PHI data');

    // Public bucket: a verified critical policy finding.
    const publicFinding = (await issuesFor(orgId, 'public-bucket')).find((i: any) => i.findingKey === S3_FINDING_KEYS.publicPolicy);
    expect(publicFinding).toMatchObject({ severity: 'critical', provenance: 'OBSERVED' });
    expect(publicFinding.verification).toBeUndefined();

    // Per-scan counts were logged.
    const tallyLine = tallyLineFrom(logSpy);
    expect(tallyLine).toContain('2 bucket(s)');
    expect(tallyLine).toContain('s3.public_access.policy pass=1 fail=1 unknown=0');
    expect(tallyLine).toContain('account_bpa_unavailable_public_policy=0');
  });

  it('when one evaluation throws: carries that bucket\'s keyed finding forward unverified, skips a null entry, and keeps scanning the rest', async () => {
    const orgId = await insertOrg();
    // Three identically configured, protected buckets, each with a malformed (null)
    // entry and a keyed finding in its previous snapshot. Whichever is evaluated FIRST
    // throws, so at least two evaluations must follow the failure.
    for (const name of ['protected-a', 'protected-b', 'protected-c']) {
      await insertBucket(orgId, name, [null, keyedPolicyFinding]);
    }

    mockAwsClients(s3Client(), { send: jest.fn().mockRejectedValue(awsError('NoSuchPublicAccessBlockConfiguration')) });
    mockCostAnalysis();
    const original = ComplianceScannerService.prototype.evaluateS3Security;
    let failedBucket: string | undefined;
    const evaluateSpy = jest
      .spyOn(ComplianceScannerService.prototype, 'evaluateS3Security')
      .mockImplementation(async function (this: ComplianceScannerService, resource, client, options) {
        if (!failedBucket) {
          failedBucket = resource.resource_id;
          throw new Error('simulated evaluation failure');
        }
        return original.call(this, resource, client, options);
      });
    const logSpy = jest.spyOn(console, 'log');

    await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);

    expect(evaluateSpy).toHaveBeenCalledTimes(3);
    expect(failedBucket).toBeDefined();

    for (const name of ['protected-a', 'protected-b', 'protected-c']) {
      const issues = await issuesFor(orgId, name);
      expect(issues).not.toContain(null);
      const s3Findings = issues.filter((i: any) => String(i?.findingKey ?? '').startsWith('s3.'));
      if (name === failedBucket) {
        // Fallback: previous keyed finding kept, marked unverified.
        expect(s3Findings).toEqual([{ ...keyedPolicyFinding, verification: 'unverified' }]);
      } else {
        // Evaluated after the failure and verified clean: the finding is gone.
        expect(s3Findings).toEqual([]);
      }
    }

    expect(logSpy.mock.calls.map((c) => String(c[0]))).toContain('✅ [Discovery] Compliance scan complete (3 resources scanned)');
    expect(tallyLineFrom(logSpy)).toContain('3 bucket(s); s3.public_access.policy pass=2 fail=0 unknown=1');
  });
});
