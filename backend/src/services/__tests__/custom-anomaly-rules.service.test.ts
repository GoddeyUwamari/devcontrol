/**
 * Live-Postgres coverage for CustomAnomalyRulesService's adoption of the
 * pre-existing `anomaly_rules` table in place of the never-used, incompatible
 * `custom_anomaly_rules` table (see the investigation behind
 * 202608221231_enable_rls_on_anomaly_rules.sql). Runs against the actual
 * local dev Postgres instance, not a mocked pg client -- same rationale as
 * migrate-runner.test.ts and services.routes.lifecycle.test.ts.
 *
 * Full isolation per suite: a disposable schema holds a minimal
 * `organizations` fixture, an `anomaly_rules` table shaped exactly like
 * production's real column set, and a `custom_anomaly_rules` table (also
 * shaped like production's real, incompatible artifact) that every test
 * asserts stays untouched -- proving the service targets the right table,
 * not just that it works.
 */

import { Pool, Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { CustomAnomalyRulesService } from '../custom-anomaly-rules.service';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const schemaName = `custom_anomaly_rules_test_${Date.now()}`;
let admin: Client;
let pool: Pool;
let service: CustomAnomalyRulesService;
let orgA: string;
let orgB: string;

async function rowCount(table: string): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return rows[0].count;
}

beforeAll(async () => {
  admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await admin.query(`SET search_path TO ${schemaName}, public`);

  await admin.query(`
    CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR NOT NULL)
  `);

  // Shaped exactly like real production anomaly_rules (verified live via
  // information_schema during the adoption investigation).
  await admin.query(`
    CREATE TABLE anomaly_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name VARCHAR NOT NULL,
      description TEXT,
      metric VARCHAR NOT NULL,
      condition VARCHAR NOT NULL,
      threshold NUMERIC NOT NULL,
      time_window VARCHAR DEFAULT '24h',
      severity VARCHAR DEFAULT 'warning',
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // Shaped like the real, abandoned production custom_anomaly_rules artifact
  // -- present only so tests can assert it is never written to.
  await admin.query(`
    CREATE TABLE custom_anomaly_rules (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id UUID NOT NULL,
      name VARCHAR,
      condition JSONB
    )
  `);

  const orgs = await admin.query(
    `INSERT INTO organizations (name) VALUES ('org-a'), ('org-b') RETURNING id`
  );
  orgA = orgs.rows[0].id;
  orgB = orgs.rows[1].id;

  // Every pooled connection gets this search_path via the startup 'options'
  // parameter, so CustomAnomalyRulesService's unqualified table references
  // resolve into the isolated schema regardless of which pool connection is
  // used for a given query -- same technique migrate-runner.test.ts uses via
  // an explicit client, adapted for a Pool since the service takes one.
  pool = new Pool({ ...dbConfig(), options: `-c search_path=${schemaName},public` });
  service = new CustomAnomalyRulesService(pool);
});

afterEach(async () => {
  await admin.query(`DELETE FROM anomaly_rules`);
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
  await pool.end();
});

describe('CustomAnomalyRulesService targets anomaly_rules, not custom_anomaly_rules', () => {
  it('(1) source no longer references custom_anomaly_rules anywhere', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'custom-anomaly-rules.service.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/custom_anomaly_rules/);
    expect(source).toMatch(/FROM anomaly_rules/);
  });

  it('(2) SELECT — getRules() reads from anomaly_rules', async () => {
    await admin.query(
      `INSERT INTO anomaly_rules (organization_id, name, metric, condition, threshold)
       VALUES ($1, 'high cost', 'total_cost', 'greater_than', 1000)`,
      [orgA]
    );
    const rules = await service.getRules(orgA);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('high cost');
    expect(await rowCount('custom_anomaly_rules')).toBe(0);
  });

  it('(3) INSERT — createRule() writes to anomaly_rules, never custom_anomaly_rules', async () => {
    const rule = await service.createRule(orgA, {
      name: 'cpu spike',
      metric: 'ec2_cpu',
      condition: 'greater_than',
      threshold: 90,
    });
    expect(rule.id).toBeTruthy();
    expect(await rowCount('anomaly_rules')).toBe(1);
    expect(await rowCount('custom_anomaly_rules')).toBe(0);

    const { rows } = await admin.query(`SELECT * FROM anomaly_rules WHERE id = $1`, [rule.id]);
    expect(rows[0].organization_id).toBe(orgA);
    expect(rows[0].metric).toBe('ec2_cpu');
  });

  it('(4) UPDATE — updateRule() modifies the row in anomaly_rules', async () => {
    const rule = await service.createRule(orgA, {
      name: 'original', metric: 'total_cost', condition: 'greater_than', threshold: 100,
    });
    const updated = await service.updateRule(rule.id, orgA, { name: 'renamed', threshold: 200 });
    expect(updated.name).toBe('renamed');
    expect(updated.threshold).toBe(200);

    const { rows } = await admin.query(`SELECT name, threshold FROM anomaly_rules WHERE id = $1`, [rule.id]);
    expect(rows[0].name).toBe('renamed');
    expect(await rowCount('custom_anomaly_rules')).toBe(0);
  });

  it('(5) DELETE — deleteRule() removes the row from anomaly_rules', async () => {
    const rule = await service.createRule(orgA, {
      name: 'to delete', metric: 'total_cost', condition: 'less_than', threshold: 10,
    });
    await service.deleteRule(rule.id, orgA);
    expect(await rowCount('anomaly_rules')).toBe(0);
    expect(await rowCount('custom_anomaly_rules')).toBe(0);
  });

  it('(6) organization isolation — a rule from org B is invisible/unmodifiable via org A', async () => {
    const bRule = await service.createRule(orgB, {
      name: 'org-b rule', metric: 'total_cost', condition: 'greater_than', threshold: 50,
    });

    const aRules = await service.getRules(orgA);
    expect(aRules.find(r => r.id === bRule.id)).toBeUndefined();

    await expect(service.updateRule(bRule.id, orgA, { name: 'hijacked' })).rejects.toThrow('Rule not found');
    await expect(service.deleteRule(bRule.id, orgA)).rejects.toThrow('Rule not found');

    const { rows } = await admin.query(`SELECT name FROM anomaly_rules WHERE id = $1`, [bRule.id]);
    expect(rows[0].name).toBe('org-b rule');
  });
});
