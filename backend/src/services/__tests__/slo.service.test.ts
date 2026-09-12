/**
 * Live-Postgres coverage for SloService's CRUD lifecycle, validation, and organization
 * isolation, plus evaluate() orchestration against a fake CloudWatchService (injected
 * via the constructor's second parameter — see slo.service.ts). Same disposable-schema
 * technique as custom-anomaly-rules.service.test.ts: a throwaway schema holds a minimal
 * `organizations` fixture and a `slo_definitions` table shaped exactly like the real
 * migration (202609121200_create_slo_definitions.sql), including its CHECK constraints,
 * so constraint-violation behavior is exercised for real rather than assumed.
 */

import { Pool, Client } from 'pg';
import { SloService, SloValidationError, SloNotFoundError } from '../slo.service';
import { CloudWatchService, SloResourceObservation } from '../cloudwatch.service';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const schemaName = `slo_definitions_test_${Date.now()}`;
let admin: Client;
let pool: Pool;
let orgA: string;
let orgB: string;

function fakeCloudWatchService(observation: SloResourceObservation | null): CloudWatchService {
  return { evaluateResourceForSlo: jest.fn().mockResolvedValue(observation) } as unknown as CloudWatchService;
}

beforeAll(async () => {
  admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await admin.query(`SET search_path TO ${schemaName}, public`);

  await admin.query(`CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR NOT NULL)`);

  // Shaped exactly like 202609121200_create_slo_definitions.sql, CHECK constraints
  // included, so this suite proves the real constraints, not a looser approximation.
  await admin.query(`
    CREATE TABLE slo_definitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('ec2', 'load-balancer', 'lambda')),
      resource_id VARCHAR(255) NOT NULL,
      sli VARCHAR(30) NOT NULL CHECK (sli IN ('ec2_availability', 'alb_latency_avg', 'alb_error_rate', 'lambda_error_rate')),
      target_value NUMERIC(7,3) NOT NULL,
      evaluation_window VARCHAR(10) NOT NULL DEFAULT '7d' CHECK (evaluation_window IN ('24h', '7d')),
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT slo_definitions_sli_matches_resource_type CHECK (
        (sli = 'ec2_availability' AND resource_type = 'ec2') OR
        (sli = 'alb_latency_avg' AND resource_type = 'load-balancer') OR
        (sli = 'alb_error_rate' AND resource_type = 'load-balancer') OR
        (sli = 'lambda_error_rate' AND resource_type = 'lambda')
      ),
      CONSTRAINT slo_definitions_target_value_valid CHECK (
        (sli IN ('ec2_availability', 'alb_error_rate', 'lambda_error_rate') AND target_value > 0 AND target_value < 100) OR
        (sli = 'alb_latency_avg' AND target_value > 0)
      )
    )
  `);

  const orgs = await admin.query(`INSERT INTO organizations (name) VALUES ('org-a'), ('org-b') RETURNING id`);
  orgA = orgs.rows[0].id;
  orgB = orgs.rows[1].id;

  pool = new Pool({ ...dbConfig(), options: `-c search_path=${schemaName},public` });
});

afterEach(async () => {
  await admin.query(`DELETE FROM slo_definitions`);
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
  await pool.end();
});

describe('SloService — CRUD', () => {
  it('(1) createSlo validates against the canonical supported domain, not arbitrary strings', async () => {
    const service = new SloService(pool);
    await expect(
      service.createSlo(orgA, { name: 'x', resourceId: 'i-1', sli: 'rds_uptime' as any, targetValue: 99 })
    ).rejects.toBeInstanceOf(SloValidationError);
  });

  it('(2) createSlo rejects a percent target outside (0, 100)', async () => {
    const service = new SloService(pool);
    await expect(
      service.createSlo(orgA, { name: 'x', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 100 })
    ).rejects.toBeInstanceOf(SloValidationError);
    await expect(
      service.createSlo(orgA, { name: 'x', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 0 })
    ).rejects.toBeInstanceOf(SloValidationError);
  });

  it('(3) createSlo rejects a non-positive latency target', async () => {
    const service = new SloService(pool);
    await expect(
      service.createSlo(orgA, { name: 'x', resourceId: 'alb-1', sli: 'alb_latency_avg', targetValue: 0 })
    ).rejects.toBeInstanceOf(SloValidationError);
  });

  it('(4) createSlo derives resource_type from sli automatically', async () => {
    const service = new SloService(pool);
    const slo = await service.createSlo(orgA, { name: 'EC2 uptime', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 99.9 });
    expect(slo.resourceType).toBe('ec2');
    expect(slo.evaluationWindow).toBe('7d'); // default
  });

  it('(5) getSlo/updateSlo/deleteSlo are all organization-scoped — org B cannot touch org A\'s SLO', async () => {
    const service = new SloService(pool);
    const slo = await service.createSlo(orgA, { name: 'EC2 uptime', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 99.9 });

    await expect(service.getSlo(slo.id, orgB)).rejects.toBeInstanceOf(SloNotFoundError);
    await expect(service.updateSlo(slo.id, orgB, { enabled: false })).rejects.toBeInstanceOf(SloNotFoundError);
    await expect(service.deleteSlo(slo.id, orgB)).rejects.toBeInstanceOf(SloNotFoundError);

    // Org A itself can still operate on it — proves the rejection above was isolation,
    // not a broken query.
    const updated = await service.updateSlo(slo.id, orgA, { enabled: false });
    expect(updated.enabled).toBe(false);
  });

  it('(6) listSlos never returns another organization\'s rows', async () => {
    const service = new SloService(pool);
    await service.createSlo(orgA, { name: 'A1', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 99.9 });
    await service.createSlo(orgB, { name: 'B1', resourceId: 'i-2', sli: 'ec2_availability', targetValue: 99.9 });

    const listA = await service.listSlos(orgA);
    const listB = await service.listSlos(orgB);
    expect(listA.map((s) => s.name)).toEqual(['A1']);
    expect(listB.map((s) => s.name)).toEqual(['B1']);
  });

  it('(7) updateSlo rejects moving a percent-SLI target to an invalid range', async () => {
    const service = new SloService(pool);
    const slo = await service.createSlo(orgA, { name: 'EC2 uptime', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 99.9 });
    await expect(service.updateSlo(slo.id, orgA, { targetValue: 150 })).rejects.toBeInstanceOf(SloValidationError);
  });

  it('(8) deleteSlo on a nonexistent id throws SloNotFoundError', async () => {
    const service = new SloService(pool);
    await expect(service.deleteSlo('00000000-0000-0000-0000-000000000000', orgA)).rejects.toBeInstanceOf(SloNotFoundError);
  });

  it('(9) the DB CHECK constraint itself rejects an sli/resource_type mismatch even bypassing the service', async () => {
    await expect(
      admin.query(
        `INSERT INTO slo_definitions (organization_id, name, resource_type, resource_id, sli, target_value) VALUES ($1, 'bad', 'ec2', 'i-1', 'alb_latency_avg', 500)`,
        [orgA]
      )
    ).rejects.toThrow(/slo_definitions_sli_matches_resource_type/);
  });
});

describe('SloService — evaluation orchestration', () => {
  it('(10) evaluateSloById returns healthy for a real observation above target', async () => {
    const service = new SloService(pool, fakeCloudWatchService({ resourceExists: true, monitored: true, uptime: 99.99, avgLatencyMs: null, errorRatePercent: null }));
    const slo = await service.createSlo(orgA, { name: 'EC2 uptime', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 99.9 });

    const { evaluation } = await service.evaluateSloById(slo.id, orgA);
    expect(evaluation.status).toBe('healthy');
  });

  it('(11) evaluateSloById returns aws_not_connected when the CloudWatch layer reports no connection', async () => {
    const service = new SloService(pool, fakeCloudWatchService(null));
    const slo = await service.createSlo(orgA, { name: 'EC2 uptime', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 99.9 });

    const { evaluation } = await service.evaluateSloById(slo.id, orgA);
    expect(evaluation.status).toBe('aws_not_connected');
  });

  it('(12) evaluateSloById on another organization\'s SLO id throws, never leaking cross-tenant evaluation', async () => {
    const service = new SloService(pool, fakeCloudWatchService({ resourceExists: true, monitored: true, uptime: 99.99, avgLatencyMs: null, errorRatePercent: null }));
    const slo = await service.createSlo(orgA, { name: 'EC2 uptime', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 99.9 });

    await expect(service.evaluateSloById(slo.id, orgB)).rejects.toBeInstanceOf(SloNotFoundError);
  });

  it('(13) evaluateAllSlos skips disabled SLOs', async () => {
    const cw = fakeCloudWatchService({ resourceExists: true, monitored: true, uptime: 99.99, avgLatencyMs: null, errorRatePercent: null });
    const service = new SloService(pool, cw);
    const slo = await service.createSlo(orgA, { name: 'EC2 uptime', resourceId: 'i-1', sli: 'ec2_availability', targetValue: 99.9 });
    await service.updateSlo(slo.id, orgA, { enabled: false });

    const results = await service.evaluateAllSlos(orgA);
    expect(results).toHaveLength(0);
    expect(cw.evaluateResourceForSlo).not.toHaveBeenCalled();
  });
});
