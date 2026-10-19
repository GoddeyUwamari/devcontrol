/**
 * The oversized-RDS detector is retired (it matched dev/staging/test in the
 * name plus "large" in the class, with no utilisation data). Its category
 * still reports a successful, empty observation every scan, so the normal
 * reconciliation path deletes legacy ACTIVE "Oversized Instance" rows while
 * RESOLVED/DISMISSED rows stay as history -- and a scan that never produced
 * observations (AWS not connected, or the scan itself threw) retires nothing.
 *
 * Live-DB, like cost-recommendations-occurrence-lifecycle.test.ts: the
 * property under test is what reconcileActiveRecommendations() actually does
 * to stored rows. AWS is mocked; no network calls.
 */
import { Pool } from 'pg';
import { CostRecommendationsRepository } from '../cost-recommendations.repository';
import costOptimizationService from '../../services/cost-optimization.service';
import { AWSClientFactory } from '../../services/aws-client-factory.service';
import { OptimizationRuleConfigService } from '../../services/optimization-rule-config.service';
import { ISSUE_RDS_OVERSIZED_INSTANCE } from '../../config/optimization-rules';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const repository = new CostRecommendationsRepository();
const createdOrgIds: string[] = [];

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`RDS Retired Org ${suffix}`, `rds-retired-org-${suffix}`, `RDS Retired Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertRdsRow(orgId: string, resourceId: string, status: 'ACTIVE' | 'RESOLVED' | 'DISMISSED') {
  await pool.query(
    `INSERT INTO cost_recommendations (
       organization_id, resource_id, resource_name, resource_type, issue, description,
       potential_savings, severity, aws_region, metadata, status
     ) VALUES ($1, $2, $2, 'RDS', $3, 'Non-production RDS instance using db.m5.large.', 98, 'MEDIUM', 'us-east-1', '{}', $4)`,
    [orgId, resourceId, ISSUE_RDS_OVERSIZED_INSTANCE, status]
  );
}

async function rdsRows(orgId: string) {
  await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
  const { rows } = await pool.query(
    `SELECT resource_id, status FROM cost_recommendations WHERE organization_id = $1 AND issue = $2 ORDER BY resource_id`,
    [orgId, ISSUE_RDS_OVERSIZED_INSTANCE]
  );
  return rows.map((r) => `${r.resource_id}:${r.status}`);
}

// A mocked account whose only RDS instance is exactly what the retired
// detector used to flag: a "dev" name on a "large" class.
function mockClients(rdsSend: jest.Mock) {
  return {
    enabled: true,
    ec2: {} as any,
    rds: { send: rdsSend } as any,
    s3: {} as any,
    lambda: {} as any,
    cloudWatch: {} as any,
    region: 'us-east-1',
  };
}

function neutralizeOtherDetectors() {
  jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockImplementation(async (_org, ruleId, parameterId) => ({
    ruleId, parameterId, value: 5, source: 'default' as const,
  }) as any);
  for (const detector of [
    'detectIdleEC2Instances',
    'detectUnusedElasticIPs',
    'detectUnattachedEBSVolumes',
    'detectGp2ToGp3Migrations',
    'detectS3LifecycleOptimization',
    'detectLowUsageLambdaFunctions',
    'detectDynamoDBCapacityOptimization',
    'detectDynamoDBOnDemandVsProvisionedOptimization',
  ]) {
    jest.spyOn(costOptimizationService as any, detector).mockResolvedValue({ success: true, issues: [] });
  }
  jest.spyOn(costOptimizationService as any, 'detectReservedInstanceOpportunities').mockResolvedValue({ success: true, issues: [] });
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('retired oversized-RDS detector', () => {
  it('a dev-db on db.m5.large yields no recommendations and a successful observation; RDS is never called', async () => {
    const rdsSend = jest.fn(async () => ({
      DBInstances: [{ DBInstanceIdentifier: 'dev-db', DBInstanceClass: 'db.m5.large', AvailabilityZone: 'us-east-1a' }],
    }));
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(mockClients(rdsSend) as any);
    neutralizeOtherDetectors();

    const { observations } = await costOptimizationService.analyzeAllResources('org-rds-retired');

    expect(observations.find((o) => o.issue === ISSUE_RDS_OVERSIZED_INSTANCE)).toEqual({
      issue: ISSUE_RDS_OVERSIZED_INSTANCE, success: true, recommendations: [],
    });
    expect(observations.flatMap((o) => o.recommendations)).toEqual([]);
    expect(rdsSend).not.toHaveBeenCalled();
    expect((costOptimizationService as any).detectOversizedRDSInstances).toBeUndefined();
    expect((costOptimizationService as any).estimateRDSCost).toBeUndefined();
    expect((costOptimizationService as any).recommendSmallerRDSInstance).toBeUndefined();
  });

  it('a successful scan deletes existing ACTIVE "Oversized Instance" rows and keeps RESOLVED/DISMISSED history', async () => {
    const orgId = await insertOrg();
    await insertRdsRow(orgId, 'dev-db-active', 'ACTIVE');
    await insertRdsRow(orgId, 'dev-db-resolved', 'RESOLVED');
    await insertRdsRow(orgId, 'dev-db-dismissed', 'DISMISSED');

    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(mockClients(jest.fn()) as any);
    neutralizeOtherDetectors();
    const { observations } = await costOptimizationService.analyzeAllResources(orgId);
    await repository.reconcileActiveRecommendations(orgId, observations);

    expect(await rdsRows(orgId)).toEqual(['dev-db-dismissed:DISMISSED', 'dev-db-resolved:RESOLVED']);
  });

  it('the retired category reports success even when another detector fails, so the clean-up is not blocked by unrelated failures', async () => {
    const orgId = await insertOrg();
    await insertRdsRow(orgId, 'dev-db-active', 'ACTIVE');

    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(mockClients(jest.fn()) as any);
    neutralizeOtherDetectors();
    jest.spyOn(costOptimizationService as any, 'detectUnusedElasticIPs').mockResolvedValue({ success: false, issues: [] });
    const { observations } = await costOptimizationService.analyzeAllResources(orgId);
    await repository.reconcileActiveRecommendations(orgId, observations);

    expect(await rdsRows(orgId)).toEqual([]);
  });

  it('AWS not connected: no observations, so ACTIVE rows are not retired', async () => {
    const orgId = await insertOrg();
    await insertRdsRow(orgId, 'dev-db-active', 'ACTIVE');

    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: false } as any);
    const { observations } = await costOptimizationService.analyzeAllResources(orgId);
    await repository.reconcileActiveRecommendations(orgId, observations);

    expect(observations).toEqual([]);
    expect(await rdsRows(orgId)).toEqual(['dev-db-active:ACTIVE']);
  });

  it('a scan that throws produces nothing to reconcile, so ACTIVE rows are not retired', async () => {
    const orgId = await insertOrg();
    await insertRdsRow(orgId, 'dev-db-active', 'ACTIVE');

    jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(new Error('AssumeRole failed'));
    await expect(costOptimizationService.analyzeAllResources(orgId)).rejects.toThrow('AssumeRole failed');

    expect(await rdsRows(orgId)).toEqual(['dev-db-active:ACTIVE']);
  });

  it('a failed observation for the category (the generic contract) leaves its ACTIVE rows alone', async () => {
    const orgId = await insertOrg();
    await insertRdsRow(orgId, 'dev-db-active', 'ACTIVE');

    await repository.reconcileActiveRecommendations(orgId, [
      { issue: ISSUE_RDS_OVERSIZED_INSTANCE, success: false, recommendations: [] },
    ]);

    expect(await rdsRows(orgId)).toEqual(['dev-db-active:ACTIVE']);
  });
});
