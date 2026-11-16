/**
 * Home region HR-D21 (HR-1 item 6): the AI's CPU telemetry evidence counts only
 * the home region's stored observations and collection times. The sweep writes
 * them per (account, region = home region); after a home region change the old
 * region's rows stay in the tables, and must not be counted as the current
 * collection. For an account whose observations are all in its home region
 * (every account before HR-1) nothing changes (org-isolation.test.ts keeps its
 * counts).
 *
 * Live database through the evidence fixture, as a NOSUPERUSER NOBYPASSRLS role
 * inside a tagged request. Cost Explorer and CloudWatch are faked; nothing calls
 * AWS. Placeholders only.
 */
import type { Pool } from 'pg';

const mockPools: { app?: Pool } = {};
jest.mock('../../../../config/database', () => {
  const actual = jest.requireActual('../../../../config/database');
  return {
    ...actual,
    get pool() {
      return mockPools.app;
    },
  };
});
jest.mock('../../../aws-cost.service', () => ({
  __esModule: true,
  default: {
    fetchMonthlyCosts: jest.fn(async () => { throw new Error('AWS_NOT_CONNECTED: fixture'); }),
    fetchCostTrend: jest.fn(),
    getCostTrendFetchedAt: jest.fn(),
  },
}));

import { EvidenceDb, type OrgSeed } from './db-fixture';
import { collectEvidence, sectionOf } from '../registry';
import { createDefaultEvidenceRegistry } from '../providers';
import { operationsSources } from '../providers/operations';

const db = new EvidenceDb();
const registry = createDefaultEvidenceRegistry();
let org: OrgSeed;

const HOME_FULL = '2026-11-10T08:00:00.000Z';
const OTHER_FULL = '2026-11-15T08:00:00.000Z';
const OTHER_NEWEST = '2026-11-15T09:00:00.000Z';

beforeAll(async () => {
  await db.setUp();
  org = await db.seedOrg('hr-telemetry', 1, '9');
  // The home region's collection time, and another region's rows (as a former home region leaves them).
  await db.admin.query(
    `INSERT INTO observability_collection_scopes (organization_id, aws_account_id, region, last_full_success_at, last_attempt_at, last_attempt_outcome)
     VALUES ($1, $2, 'us-east-1', $3, $3, 'complete'), ($1, $2, 'eu-west-1', $4, $4, 'complete')`,
    [org.id, org.accountId, HOME_FULL, OTHER_FULL]
  );
  // Two eu-west-1 resources (the observations' foreign key names the aws_resources row) and their observations.
  await db.admin.query(
    `WITH r AS (
       INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, resource_name, region, status)
       SELECT $1, 'arn:aws:ec2:eu-west-1:' || $2 || ':instance/hr-telemetry-' || g, 'hr-telemetry-' || g, 'ec2', 'hr-telemetry-' || g, 'eu-west-1', 'running'
         FROM generate_series(1, 2) g
       RETURNING id)
     INSERT INTO resource_telemetry_observations (organization_id, aws_account_id, region, resource_id, last_datapoint_at, last_successful_check_at)
     SELECT $1, $2, 'eu-west-1', r.id, $3, $3 FROM r`,
    [org.id, org.accountId, OTHER_NEWEST]
  );
});
afterAll(async () => {
  await db.admin.query('DELETE FROM observability_collection_scopes WHERE organization_id = $1', [org.id]);
  await db.admin.query('DELETE FROM resource_telemetry_observations WHERE organization_id = $1', [org.id]);
  await db.admin.query("DELETE FROM aws_resources WHERE organization_id = $1 AND resource_id LIKE 'hr-telemetry-%'", [org.id]);
  await db.tearDown();
});

async function telemetry() {
  mockPools.app = db.roleApp;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(operationsSources, 'peekEvaluation').mockReturnValue(null);
  try {
    const bundle = await db.asRequest(db.rolePool, org.id, () =>
      collectEvidence(registry, { organizationId: org.id, consumer: 'test', select: { providerIds: ['telemetry.cpu'] }, budgetTokens: 1_000_000 }));
    return sectionOf<{ collection: { resourcesTracked: number; resourcesWithDatapoints: number; newestDatapointAt: string | null; lastFullCollectionAt: string | null } }>(bundle, 'telemetry.cpu').data?.collection;
  } finally {
    jest.restoreAllMocks();
  }
}

describe('telemetry.cpu counts the home region only (HR-D21)', () => {
  it('home us-east-1: the eu-west-1 rows are not counted, and its newer collection time is not used', async () => {
    const collection = await telemetry();
    expect(collection).toMatchObject({ resourcesTracked: 1, resourcesWithDatapoints: 1, lastFullCollectionAt: HOME_FULL });
    expect(collection!.newestDatapointAt).not.toBe(OTHER_NEWEST);
  });

  it('after the home region moves to eu-west-1: only eu-west-1 is counted', async () => {
    await db.admin.query(`UPDATE aws_accounts SET region = 'eu-west-1' WHERE org_id = $1`, [org.id]);
    try {
      expect(await telemetry()).toEqual({ resourcesTracked: 2, resourcesWithDatapoints: 2, newestDatapointAt: OTHER_NEWEST, lastFullCollectionAt: OTHER_FULL });
    } finally {
      await db.admin.query(`UPDATE aws_accounts SET region = 'us-east-1' WHERE org_id = $1`, [org.id]);
    }
  });
});
