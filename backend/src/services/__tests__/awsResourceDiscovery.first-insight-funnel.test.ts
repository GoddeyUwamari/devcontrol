/**
 * Focused coverage for first_insight_generated on the AUTOMATIC discovery
 * path (AWSResourceDiscoveryService.discoverAllResources -> the 6-hour
 * ResourceDiscoveryJob cron), added as part of PR 1 of the DevControl
 * cost-intelligence consolidation. Before this fix, first_insight_generated
 * only fired from the manual POST /api/cost-recommendations/analyze endpoint
 * (see cost-recommendations-funnel-events.test.ts) -- an org whose first-ever
 * recommendations arrived from the scheduled scan instead of a manual click
 * never fired the event.
 *
 * Same mocking strategy as that existing suite: real Postgres for the
 * analytics_events assertion, CostRecommendationsRepository and
 * costOptimizationService mocked (network/DB-touching collaborators), so no
 * schema fixture is needed for cost_recommendations itself. AWSClientFactory
 * is additionally mocked here (returning non-SDK-instance client stand-ins)
 * so every AWS-touching discovery/compliance/reconciliation phase inside
 * discoverAllResources fails fast and is caught by its own existing
 * try/catch -- exactly as it would for a real org with a broken/missing AWS
 * connection -- without making any real network call, leaving the (mocked)
 * cost-analysis phase as the only phase under test that "succeeds".
 */
import { Pool } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { AWSClientFactory } from '../aws-client-factory.service';
import costOptimizationService from '../cost-optimization.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import type { RecommendationStats } from '../../types';

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
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// resource_discovery_jobs has ON DELETE CASCADE on organization_id, so
// deleting the org (in afterAll) also removes the job rows this test creates.
async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Discovery Funnel Org ${suffix}`, `discovery-funnel-org-${suffix}`, `Discovery Funnel Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchEvents(orgId: string, eventName: string) {
  const { rows } = await pool.query(
    `SELECT * FROM analytics_events WHERE organization_id = $1 AND event_name = $2 ORDER BY created_at ASC`,
    [orgId, eventName]
  );
  return rows;
}

function fakeStats(totalPotentialSavings: number): RecommendationStats {
  return {
    total_recommendations: totalPotentialSavings > 0 ? 1 : 0,
    active_recommendations: totalPotentialSavings > 0 ? 1 : 0,
    total_potential_savings: totalPotentialSavings,
    by_severity: { high: 0, medium: 0, low: totalPotentialSavings > 0 ? 1 : 0 },
  };
}

/**
 * Every AWSClients field is a non-SDK-instance stand-in -- calling `.send()`
 * on it (direct calls like S3's ListBuckets) throws synchronously
 * ("... .send is not a function"), and the generated SDK paginators used by
 * EC2/RDS/Lambda/ELB/ResourceExplorer independently reject the client via
 * their own `instanceof` check. Either way each discovery phase's own
 * try/catch inside discoverAllResources catches it -- no real AWS network
 * call is ever attempted.
 */
function mockDisabledAwsClients() {
  return jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
    enabled: true,
    region: 'us-east-1',
    costExplorer: {} as any,
    ec2: {} as any,
    rds: {} as any,
    s3: {} as any,
    cloudWatch: {} as any,
    lambda: {} as any,
    ecs: {} as any,
    elb: {} as any,
    eks: {} as any,
    dynamodb: {} as any,
    cloudFront: {} as any,
    apiGateway: {} as any,
    elastiCache: {} as any,
    sqs: {} as any,
    sns: {} as any,
    iam: {} as any,
    resourceExplorer: {} as any,
  } as any);
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AWSResourceDiscoveryService.discoverAllResources -> first_insight_generated', () => {
  it('emits first_insight_generated when the scheduled scan is this org\'s first source of recommendations', async () => {
    const orgId = await insertOrg();
    mockDisabledAwsClients();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
      observations: [
        { issue: 'Idle Instance', success: true, recommendations: [{ resource_id: 'i-abc', resource_type: 'EC2', issue: 'Idle Instance', potential_savings: 8.5, severity: 'LOW' } as any] },
        { issue: 'Oversized Instance', success: true, recommendations: [] },
        { issue: 'Unused Elastic IP', success: true, recommendations: [] },
      ],
      riRecommendations: [],
    });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 1 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(8.5));

    const service = new AWSResourceDiscoveryService(pool);
    await service.discoverAllResources(orgId);

    const rows = await fetchEvents(orgId, 'first_insight_generated');
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toEqual({ recommendationCount: 1, totalMonthlySavings: 8.5 });
  });

  it('does not emit when the scheduled scan finds no recommendations', async () => {
    const orgId = await insertOrg();
    mockDisabledAwsClients();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
      observations: [
        { issue: 'Idle Instance', success: true, recommendations: [] },
        { issue: 'Oversized Instance', success: true, recommendations: [] },
        { issue: 'Unused Elastic IP', success: true, recommendations: [] },
      ],
      riRecommendations: [],
    });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 0 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(0));

    const service = new AWSResourceDiscoveryService(pool);
    await service.discoverAllResources(orgId);

    const rows = await fetchEvents(orgId, 'first_insight_generated');
    expect(rows).toHaveLength(0);
  });

  it('does not double-fire across two scheduled scans for the same org', async () => {
    const orgId = await insertOrg();
    mockDisabledAwsClients();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
      observations: [
        { issue: 'Idle Instance', success: true, recommendations: [{ resource_id: 'i-abc', resource_type: 'EC2', issue: 'Idle Instance', potential_savings: 8.5, severity: 'LOW' } as any] },
        { issue: 'Oversized Instance', success: true, recommendations: [] },
        { issue: 'Unused Elastic IP', success: true, recommendations: [] },
      ],
      riRecommendations: [],
    });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 1 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(8.5));

    const service = new AWSResourceDiscoveryService(pool);
    await service.discoverAllResources(orgId);
    await service.discoverAllResources(orgId);

    const rows = await fetchEvents(orgId, 'first_insight_generated');
    expect(rows).toHaveLength(1);
  });

  it('does not double-fire when the manual analyze endpoint already recorded it for this org', async () => {
    const orgId = await insertOrg();
    mockDisabledAwsClients();
    jest.spyOn(costOptimizationService, 'analyzeAllResources').mockResolvedValue({
      observations: [
        { issue: 'Idle Instance', success: true, recommendations: [{ resource_id: 'i-abc', resource_type: 'EC2', issue: 'Idle Instance', potential_savings: 8.5, severity: 'LOW' } as any] },
        { issue: 'Oversized Instance', success: true, recommendations: [] },
        { issue: 'Unused Elastic IP', success: true, recommendations: [] },
      ],
      riRecommendations: [],
    });
    jest.spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations').mockResolvedValue({ insertedCount: 1 });
    jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0);
    jest.spyOn(CostRecommendationsRepository.prototype, 'getStats').mockResolvedValue(fakeStats(8.5));

    // Simulates a prior manual /api/cost-recommendations/analyze call for
    // this org having already recorded the event -- both entry points share
    // the same trackFunnelEventOnce guard (organization_id + event_name), so
    // the scheduled scan running afterward must be a no-op here too.
    await pool.query(
      `INSERT INTO analytics_events (organization_id, event_name, event_category, properties)
       VALUES ($1, 'first_insight_generated', 'funnel', '{"recommendationCount":1,"totalMonthlySavings":8.5}')`,
      [orgId]
    );

    const service = new AWSResourceDiscoveryService(pool);
    await service.discoverAllResources(orgId);

    const rows = await fetchEvents(orgId, 'first_insight_generated');
    expect(rows).toHaveLength(1);
  });
});
