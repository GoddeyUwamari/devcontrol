/**
 * Resource truth (2B) on the nine-resource account: what Infrastructure and Services
 * show before a scan and after one, measured through the real discovery path.
 *
 * Unlike the fixture in awsResourceDiscovery.framework-applicability.test.ts (whose
 * AWS clients all fail, so only the compliance scan runs), every AWS call here
 * answers: discovery re-reads each resource, so the rows written by earlier releases
 * are overwritten the way they are in a real account.
 *
 * Every name and identifier is a placeholder. Set RT2B_MEASURE_OUT to a file path to
 * have the measured values written there as JSON.
 */
import fs from 'fs';
import { Pool } from 'pg';
import { EC2Client } from '@aws-sdk/client-ec2';
import { S3Client } from '@aws-sdk/client-s3';
import { RDSClient } from '@aws-sdk/client-rds';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { IAMClient } from '@aws-sdk/client-iam';
import { BackupClient } from '@aws-sdk/client-backup';
import { ResourceExplorer2Client } from '@aws-sdk/client-resource-explorer-2';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AWSResourcesRepository } from '../../repositories/awsResources.repository';
import { ComplianceScannerService } from '../complianceScanner';
import { InfrastructureController } from '../../controllers/infrastructure.controller';
import servicesRouter from '../../routes/services.routes';
import { pool as appPool } from '../../config/database';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
// Each case runs a whole discovery against the database.
jest.setTimeout(30_000);
const measurements: Record<string, unknown> = {};

const REGION = 'us-east-1';
const ACCOUNT_ID = '111122223333';
const INSTANCE_ID = 'i-1234567890abcdef0';
const VOL_UNATTACHED = 'vol-1234567890abcdef0';
const VOL_ATTACHED = 'vol-0123456789abcdef0';
const SECURITY_GROUP = 'sg-1234567890abcdef0';
const BUCKETS = ['app-prod-backups', 'app-deploy-artifacts', 'marketing-site'];
const HTTPS_FAILING = new Set(['app-prod-backups', 'app-deploy-artifacts']);
const TOPIC_ARN = `arn:aws:sns:${REGION}:${ACCOUNT_ID}:app-alerts`;
const VPC_ARNS = ['vpc-1234567890abcdef0', 'vpc-0123456789abcdef0'].map((id) => `arn:aws:ec2:${REGION}:${ACCOUNT_ID}:vpc/${id}`);

// The 41 entries the scanner of the release before 2A stored for these resources.
const T = (severity: string, category: string, issue: string, extra: Record<string, unknown> = {}) => ({ severity, category, issue, recommendation: 'r', ...extra });
const TAGS = T('low', 'tagging', 'Resource is missing required tags: Owner, Environment, Team', { provenance: 'SELF_ATTESTED' });
const HIPAA_RETENTION = T('high', 'backups', 'HIPAA: Resource lacks documented backup retention policy');
const HIPAA_CMK = T('medium', 'encryption', 'HIPAA: Resource should use AWS KMS Customer Managed Keys (CMK) for encryption');
const HIPAA_BACKUPS = T('critical', 'backups', 'HIPAA: EBS storing PHI must have automated backups');
const HIPAA_LOGGING = (type: string) => T('critical', 'networking', `HIPAA: ${type} lacks required access logging for audit trails`);
const HIPAA_VERSIONING = T('high', 'backups', 'HIPAA: S3 bucket should have versioning enabled for PHI data integrity');
const SOC2_IAM = T('high', 'tagging', 'Tagging: IAM role/owner not documented', { provenance: 'SELF_ATTESTED' });
const SOC2_MONITORING = T('high', 'networking', 'Observability: Monitoring/logging not documented via tag', { provenance: 'SELF_ATTESTED' });
const NOT_ENCRYPTED = (type: string) => T('medium', 'encryption', `${type} resource is not encrypted`, { provenance: 'OBSERVED' });
const EC2_PUBLIC = T('high', 'public_access', 'EC2 instance has a public IP address', { provenance: 'OBSERVED' });
const EC2_SNAPSHOTS = T('medium', 'backups', 'EC2 instance does not have regular snapshots', { provenance: 'OBSERVED' });
const HTTPS_ONLY = T('high', 'encryption', 'S3 bucket does not enforce HTTPS-only access', { provenance: 'OBSERVED', findingKey: 's3.https_only' });
const S3_COMMON = [TAGS, SOC2_MONITORING, HIPAA_CMK, HIPAA_LOGGING('S3'), HIPAA_RETENTION, HIPAA_VERSIONING];

type Row = { key: string; arn: string; id: string; type: string; status: string; encrypted: boolean; isPublic: boolean; hasBackup: boolean | null; stored: unknown[] };
/** The rows as earlier releases left them, with the ARNs discovery writes. */
const ACCOUNT: Row[] = [
  { key: 'vol-unattached', arn: `arn:aws:ec2:${REGION}:*:volume/${VOL_UNATTACHED}`, id: VOL_UNATTACHED, type: 'ebs', status: 'available', encrypted: false, isPublic: false, hasBackup: null, stored: [NOT_ENCRYPTED('EBS'), TAGS, HIPAA_RETENTION] },
  { key: 'vol-attached', arn: `arn:aws:ec2:${REGION}:*:volume/${VOL_ATTACHED}`, id: VOL_ATTACHED, type: 'ebs', status: 'in-use', encrypted: true, isPublic: false, hasBackup: false, stored: [TAGS, HIPAA_CMK, HIPAA_RETENTION, HIPAA_BACKUPS] },
  { key: 'instance', arn: `arn:aws:ec2:${REGION}:*:instance/${INSTANCE_ID}`, id: INSTANCE_ID, type: 'ec2', status: 'running', encrypted: true, isPublic: true, hasBackup: false, stored: [EC2_PUBLIC, EC2_SNAPSHOTS, TAGS, SOC2_IAM, SOC2_MONITORING, HIPAA_CMK, HIPAA_LOGGING('EC2'), HIPAA_RETENTION] },
  ...BUCKETS.map((name): Row => ({ key: name, arn: `arn:aws:s3:::${name}`, id: name, type: 's3', status: 'active', encrypted: true, isPublic: false, hasBackup: null, stored: HTTPS_FAILING.has(name) ? [...S3_COMMON, HTTPS_ONLY] : S3_COMMON })),
  // First written on 2026-05-31 by the Describe*-based discovery: a made-up status, and "not encrypted".
  { key: 'topic', arn: TOPIC_ARN, id: 'app-alerts', type: 'sns', status: 'active', encrypted: false, isPublic: false, hasBackup: false, stored: [NOT_ENCRYPTED('SNS'), TAGS] },
  ...VPC_ARNS.map((arn, i): Row => ({ key: `vpc-${i + 1}`, arn, id: arn.split('/')[1], type: 'vpc', status: 'available', encrypted: false, isPublic: false, hasBackup: false, stored: [NOT_ENCRYPTED('VPC'), TAGS] })),
];

async function insertAccount(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Resource Truth Org ${suffix}`, `resource-truth-org-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  for (const r of ACCOUNT) {
    await pool.query(
      `INSERT INTO aws_resources
         (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
          tags, is_encrypted, is_public, has_backup, compliance_issues)
       VALUES ($1, $2, $3, $3, $4, $5, $6, '{}', $7, $8, $9, $10)`,
      [orgId, r.arn, r.id, r.type, REGION, r.status, r.encrypted, r.isPublic, r.hasBackup, JSON.stringify(r.stored)]
    );
  }
  return orgId;
}

const awsError = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name }, extra);
/** A real SDK client (the paginators check the class) whose every call is answered here; an unlisted call answers {}. */
function client<T extends { send: unknown }>(real: T, handlers: Record<string, (input: any) => unknown> = {}): T {
  (real as any).send = jest.fn(async (command: any) => {
    const handler = handlers[command.constructor.name];
    return handler ? handler(command.input) : {};
  });
  return real;
}
const at = { region: REGION };

type Scenario = {
  /** The ingress rules of the instance's security group, or 'denied' when it cannot be read. */
  securityGroup: any[] | 'denied';
  /** What GetBucketTagging answers for every bucket. */
  bucketTagging: 'no-tag-set' | 'denied';
};
const CLOSED: Scenario = { securityGroup: [{ IpProtocol: 'tcp', FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }], bucketTagging: 'no-tag-set' };

function mockAws(scenario: Scenario) {
  const ec2 = client(new EC2Client(at), {
    DescribeInstancesCommand: () => ({
      Reservations: [{
        Instances: [{
          InstanceId: INSTANCE_ID,
          InstanceType: 't3.micro',
          State: { Name: 'running' },
          PublicIpAddress: '203.0.113.10',
          PrivateIpAddress: '10.0.0.10',
          Placement: { AvailabilityZone: `${REGION}a` },
          SecurityGroups: [{ GroupId: SECURITY_GROUP, GroupName: 'app' }],
          BlockDeviceMappings: [{ Ebs: { VolumeId: VOL_ATTACHED } }],
          Tags: [],
        }],
      }],
    }),
    DescribeVolumesCommand: () => ({
      Volumes: [
        { VolumeId: VOL_UNATTACHED, VolumeType: 'gp3', Size: 8, State: 'available', Encrypted: false, AvailabilityZone: `${REGION}a`, Attachments: [], Tags: [] },
        { VolumeId: VOL_ATTACHED, VolumeType: 'gp3', Size: 8, State: 'in-use', Encrypted: true, AvailabilityZone: `${REGION}a`, Attachments: [{ InstanceId: INSTANCE_ID }], Tags: [] },
      ],
    }),
    DescribeSecurityGroupsCommand: () => {
      if (scenario.securityGroup === 'denied') throw awsError('UnauthorizedOperation');
      return { SecurityGroups: [{ GroupId: SECURITY_GROUP, GroupName: 'app', IpPermissions: scenario.securityGroup }] };
    },
  });
  const s3 = client(new S3Client(at), {
    ListBucketsCommand: () => ({ Buckets: BUCKETS.map((Name) => ({ Name, CreationDate: new Date('2026-01-01T00:00:00Z') })) }),
    GetBucketLocationCommand: () => ({}),
    GetBucketEncryptionCommand: () => ({ ServerSideEncryptionConfiguration: { Rules: [] } }),
    GetBucketAclCommand: () => ({ Grants: [] }),
    GetBucketLifecycleConfigurationCommand: () => { throw awsError('NoSuchLifecycleConfiguration'); },
    GetBucketTaggingCommand: () => { throw awsError(scenario.bucketTagging === 'denied' ? 'AccessDenied' : 'NoSuchTagSet'); },
  });
  const backup = client(new BackupClient(at), {
    // AWS Backup holds nothing for the instance or its volume, and cannot be asked about the unattached one.
    ListRecoveryPointsByResourceCommand: (input) => {
      if (String(input.ResourceArn).includes(VOL_UNATTACHED)) throw awsError('AccessDeniedException');
      return { RecoveryPoints: [] };
    },
  });
  // Resource Explorer reports each resource with a tags property; none of these has a tag.
  const tagged = (Arn: string, CfnResourceType: string, Service: string) => ({
    Arn, CfnResourceType, Service, Region: REGION, Properties: [{ Name: 'tags', Data: [] }],
  });
  const resourceExplorer = client(new ResourceExplorer2Client(at), {
    SearchCommand: () => ({
      Resources: [
        tagged(`arn:aws:ec2:${REGION}:${ACCOUNT_ID}:instance/${INSTANCE_ID}`, 'AWS::EC2::Instance', 'ec2'),
        ...VPC_ARNS.map((arn) => tagged(arn, 'AWS::EC2::VPC', 'ec2')),
        tagged(TOPIC_ARN, 'AWS::SNS::Topic', 'sns'),
      ],
    }),
  });
  const empty = {} as any;
  jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true, region: REGION, accountId: ACCOUNT_ID,
    ec2, s3, s3Control: undefined, backup, resourceExplorer,
    getS3ClientForRegion: () => s3,
    getEC2ClientForRegion: () => ec2,
    rds: client(new RDSClient(at)), lambda: client(new LambdaClient(at)), elb: client(new ElasticLoadBalancingV2Client(at)),
    cloudFront: client(new CloudFrontClient(at)), iam: client(new IAMClient(at)),
    costExplorer: empty, cloudWatch: empty, ecs: empty, eks: empty, dynamodb: empty, apiGateway: empty,
    elastiCache: empty, sqs: empty, sns: empty,
  } as any);
  jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({ observations: [], riRecommendations: [] } as any);
  jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 } as any);
  jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
  jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
  // HTTPS-only fails on two buckets; the policy and ACL checks pass on all three.
  jest.spyOn(ComplianceScannerService.prototype, 'evaluateS3Security').mockImplementation(async (resource) => {
    const pass = (key: string) => ({ key, status: 'pass', reason: 'ok' });
    const failing = HTTPS_FAILING.has(resource.resource_id);
    return {
      issues: failing ? [{ ...HTTPS_ONLY, resource_arn: resource.resource_arn }] : [],
      evaluation: {
        publicPolicy: pass('s3.public_access.policy'),
        publicAcl: pass('s3.public_access.acl'),
        httpsOnly: failing ? { key: 's3.https_only', status: 'fail', reason: 'no policy' } : pass('s3.https_only'),
      },
    } as any;
  });
}

async function scan(orgId: string, scenario: Scenario): Promise<string[]> {
  mockAws(scenario);
  const result = await new AWSResourceDiscoveryService(pool).discoverAllResources(orgId);
  jest.restoreAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  return result.errors;
}

function fakeResponse() {
  const res: any = { body: undefined, statusCode: 200 };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: unknown) => { res.body = body; return res; };
  return res;
}

/** GET /api/services/stats, by its own handler. */
async function servicesStats(orgId: string): Promise<any> {
  const layer = (servicesRouter as any).stack.find((l: any) => l.route?.path === '/stats');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const res = fakeResponse();
  await handler({ organizationId: orgId }, res);
  return res.body.stats;
}

/** GET /api/infrastructure, by its own controller. */
async function infrastructureRows(orgId: string): Promise<any[]> {
  const res = fakeResponse();
  await new InfrastructureController().getAll({ user: { organizationId: orgId }, query: {} } as any, res);
  return res.body.data;
}

async function measure(orgId: string) {
  const { rows } = await pool.query(
    `SELECT resource_arn, resource_type, status, is_encrypted, is_public, has_backup, compliance_issues
       FROM aws_resources WHERE organization_id = $1`,
    [orgId]
  );
  const byArn = new Map(rows.map((r) => [r.resource_arn, r]));
  const stats = (await new AWSResourcesRepository(pool).getStats(orgId)).compliance_stats;
  const services = await servicesStats(orgId);
  const infrastructure = await infrastructureRows(orgId);
  const infraByAwsId = new Map(infrastructure.map((r) => [r.awsId, r]));
  return {
    findings: { total: stats.total_issues, ...stats.by_severity },
    storedEntries: rows.reduce((n, r) => n + r.compliance_issues.length, 0),
    // Services: "N of M at risk".
    servicesAtRisk: `${services.needs_attention} of ${services.total}`,
    // Infrastructure cards: the count under "No Flagged Issues" and the one under the red card.
    infrastructureCards: {
      noFlaggedIssues: services.healthy,
      redCardCount: services.needs_attention,
      findingsBySeverity: services.findings_by_severity ?? null,
      // Why the red card's resources are counted.
      attentionReasons: services.attention_reasons ?? null,
    },
    perResource: Object.fromEntries(
      ACCOUNT.map((r) => {
        const row = byArn.get(r.arn);
        return [r.key, {
          storedStatus: row.status,
          shownStatus: infraByAwsId.get(r.id)?.status ?? null,
          is_encrypted: row.is_encrypted,
          has_backup: row.has_backup,
          findings: (row.compliance_issues as any[]).map((i) => `${i.severity}: ${i.issue}`).sort(),
        }];
      })
    ),
  };
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

// /api/services/stats reads it; CI's bootstrap does not create it.
beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (process.env.RT2B_MEASURE_OUT) fs.writeFileSync(process.env.RT2B_MEASURE_OUT, JSON.stringify(measurements, null, 2));
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM account_security_findings WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM framework_evaluation_runs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
  await appPool.end();
});

const LOW_TAGS = 'low: Resource is missing required tags: Owner, Environment, Team';
const HTTPS = 'high: S3 bucket does not enforce HTTPS-only access';
const NO_LIFECYCLE = ['app-prod-backups', 'app-deploy-artifacts', 'marketing-site', 'topic', 'vpc-1', 'vpc-2'];
const findingsOf = (m: Awaited<ReturnType<typeof measure>>) => Object.fromEntries(Object.entries(m.perResource).map(([key, r]) => [key, r.findings]));

describe('the nine-resource account, measured', () => {
  it('as stored, before any scan: the same 17 findings count, 3 of 9 are at risk, and no bucket, topic or VPC shows a status', async () => {
    const orgId = await insertAccount();
    const m = await measure(orgId);
    measurements.beforeScan = m;

    expect(m.storedEntries).toBe(41);
    expect(m.findings).toEqual({ total: 17, critical: 0, high: 3, medium: 5, low: 9 });
    // Was 4 of 9: the attached volume counted through its 'in-use' status alone.
    expect(m.servicesAtRisk).toBe('3 of 9');
    expect(m.infrastructureCards).toEqual({
      noFlaggedIssues: 6, redCardCount: 3,
      findingsBySeverity: { critical: 0, high: 3, medium: 5, low: 9 },
      // The instance and two buckets, each through a High finding. Nothing through status.
      attentionReasons: { with_finding: 3, with_cost_recommendation: 0, stopped_or_degraded: 0, failed: 0 },
    });
    // By type, so the rows read correctly before discovery has rewritten them.
    for (const key of NO_LIFECYCLE) expect(m.perResource[key].shownStatus).toBeNull();
    expect(m.perResource.instance.shownStatus).toBe('running');
  });

  it('after a scan: no admin or database port open to the internet, buckets report no tag set', async () => {
    const orgId = await insertAccount();
    measurements.scanErrors = await scan(orgId, CLOSED);
    const m = await measure(orgId);
    measurements.afterScan = m;

    expect(measurements.scanErrors).toEqual([]);
    expect(m.findings).toEqual({ total: 14, critical: 0, high: 2, medium: 3, low: 9 });
    expect(m.storedEntries).toBe(14);
    expect(m.servicesAtRisk).toBe('2 of 9');
    // The red card: 2 resources, and 0 Critical findings behind it.
    expect(m.infrastructureCards).toEqual({
      noFlaggedIssues: 7, redCardCount: 2,
      findingsBySeverity: { critical: 0, high: 2, medium: 3, low: 9 },
      attentionReasons: { with_finding: 2, with_cost_recommendation: 0, stopped_or_degraded: 0, failed: 0 },
    });

    expect(findingsOf(m)).toEqual({
      'vol-unattached': [LOW_TAGS, 'medium: EBS resource is not encrypted'],
      'vol-attached': [LOW_TAGS],
      instance: [
        LOW_TAGS,
        'medium: EC2 instance does not have regular snapshots',
        'medium: EC2 instance has a public IP address. No security-group rule allows an admin/database port from 0.0.0.0/0 or ::/0.',
      ],
      // NoSuchTagSet is evidence of zero tags: the tag finding stands, now on a real read.
      'app-prod-backups': [HTTPS, LOW_TAGS],
      'app-deploy-artifacts': [HTTPS, LOW_TAGS],
      'marketing-site': [LOW_TAGS],
      // "not encrypted" is gone: nothing reads a topic's or a VPC's encryption.
      topic: [LOW_TAGS],
      'vpc-1': [LOW_TAGS],
      'vpc-2': [LOW_TAGS],
    });

    // Status: stored, and shown, consistently.
    for (const key of NO_LIFECYCLE) expect(m.perResource[key]).toMatchObject({ storedStatus: 'not_applicable', shownStatus: null });
    expect(m.perResource['vol-unattached']).toMatchObject({ storedStatus: 'available', shownStatus: 'running' });
    expect(m.perResource['vol-attached']).toMatchObject({ storedStatus: 'in-use', shownStatus: 'running' });
    expect(m.perResource.instance).toMatchObject({ storedStatus: 'running', shownStatus: 'running' });

    // The rows first written on 2026-05-31 no longer carry the placeholders.
    for (const key of ['topic', 'vpc-1', 'vpc-2']) expect(m.perResource[key]).toMatchObject({ is_encrypted: null, has_backup: null });
    // What AWS did report is kept.
    expect(m.perResource['vol-unattached'].is_encrypted).toBe(false);
    expect(m.perResource['vol-attached'].is_encrypted).toBe(true);
  });

  it('a second scan changes nothing', async () => {
    const orgId = await insertAccount();
    await scan(orgId, CLOSED);
    const first = await measure(orgId);
    await scan(orgId, CLOSED);
    expect(await measure(orgId)).toEqual(first);
  });

  it('after a scan: the security group opens every TCP port to the internet -> the instance is High, 3 of 9 at risk', async () => {
    const orgId = await insertAccount();
    await scan(orgId, { ...CLOSED, securityGroup: [{ IpProtocol: 'tcp', FromPort: 0, ToPort: 65535, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] });
    const m = await measure(orgId);
    measurements.afterScanOpenAdminPort = m;

    expect(m.findings).toEqual({ total: 14, critical: 0, high: 3, medium: 2, low: 9 });
    expect(m.servicesAtRisk).toBe('3 of 9');
    expect(m.perResource.instance.findings).toContain(
      `high: EC2 instance has a public IP address and security group ${SECURITY_GROUP} allows tcp 0-65535 from 0.0.0.0/0, ` +
      'which covers ports 22, 3389, 3306, 5432, 1433, 1521, 27017, 6379, 9200, 5601, 11211'
    );
  });

  it('a stopped instance and a HIGH cost recommendation are counted, and the card is told why', async () => {
    const orgId = await insertAccount();
    await scan(orgId, CLOSED);
    await pool.query(`UPDATE aws_resources SET status = 'stopped' WHERE organization_id = $1 AND resource_id = $2`, [orgId, INSTANCE_ID]);
    await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, description, potential_savings, severity, status)
       VALUES ($1, $2, 'EBS', 'Unattached EBS Volume', 'd', 10, 'HIGH', 'ACTIVE')`,
      [orgId, VOL_ATTACHED]
    );
    // A cost recommendation is consulted only for a resource with no current compliance
    // finding, so the volume's own (Low, tagging) finding is cleared for this case.
    await pool.query(`UPDATE aws_resources SET compliance_issues = '[]' WHERE organization_id = $1 AND resource_id = $2`, [orgId, VOL_ATTACHED]);
    const m = await measure(orgId);
    measurements.afterScanStoppedAndCostRecommendation = m;

    // Two buckets through a High finding, the instance through its status, the volume
    // through its cost recommendation.
    expect(m.servicesAtRisk).toBe('4 of 9');
    expect(m.infrastructureCards.attentionReasons).toEqual({ with_finding: 2, with_cost_recommendation: 1, stopped_or_degraded: 1, failed: 0 });
    expect(m.infrastructureCards.findingsBySeverity).toMatchObject({ critical: 0, high: 2 });
    expect(m.perResource.instance.shownStatus).toBe('stopped');
  });

  it('after a scan: security groups and bucket tags cannot be read -> Medium "exposure unknown", and no bucket tag finding', async () => {
    const orgId = await insertAccount();
    const errors = await scan(orgId, { securityGroup: 'denied', bucketTagging: 'denied' });
    const m = await measure(orgId);
    measurements.afterScanDenied = m;

    // The scan went on: every other step ran, and the resources are all still there.
    expect(errors.filter((e) => !e.startsWith('Security group scan'))).toEqual([]);
    expect(m.findings).toEqual({ total: 11, critical: 0, high: 2, medium: 3, low: 6 });
    expect(m.servicesAtRisk).toBe('2 of 9');
    expect(m.perResource.instance.findings).toContain('medium: EC2 instance has a public IP address. Exposure unknown: its security groups could not be read.');
    expect(m.perResource.instance.findings.some((f) => f.startsWith('high:'))).toBe(false);
    // The fabricated tag findings resolved through the scan itself: nothing was deleted by hand.
    expect(m.perResource['app-prod-backups'].findings).toEqual([HTTPS]);
    expect(m.perResource['app-deploy-artifacts'].findings).toEqual([HTTPS]);
    expect(m.perResource['marketing-site'].findings).toEqual([]);
  });
});
