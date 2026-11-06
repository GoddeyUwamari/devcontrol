/**
 * G1 (AI truth PR 1): AWSResourcesRepository.getStats() without an executor
 * must count the caller's organization's resources under RLS.
 *
 * Before the fix it checked out a raw pool.connect() connection with no
 * tenant tag. aws_resources is under RLS for the application role, so it
 * counted 0 rows -- the report's "0 discovered resources across 0 types" next
 * to "10 findings on 6 resources" (the findings query used the tagged client).
 *
 * Every assertion runs as a throwaway NOSUPERUSER NOBYPASSRLS role -- the
 * category of role production's application user is -- through a pool whose
 * query() follows the request context exactly as config/database.ts's pool
 * does, with the same installTenantTagReset() hygiene.
 */
import { Pool, PoolClient } from 'pg';

const mockPools: { app?: Pool } = {};
jest.mock('../../config/database', () => {
  const actual = jest.requireActual('../../config/database');
  return {
    ...actual,
    get pool() {
      return mockPools.app;
    },
  };
});

import { installTenantTagReset, requestContext } from '../../config/database';
import { AWSResourcesRepository } from '../awsResources.repository';
import { AIReportGeneratorService } from '../../services/ai-report-generator.service';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const ROLE = `tenant_reset_test_${suffix}`;
const admin = new Pool(dbConfig());
let rolePool: Pool;
let appPool: Pool;
/** One connection only, so every checkout is the same session (the leak check below). */
let oneConnectionPool: Pool;
const createdOrgIds: string[] = [];

async function insertOrg(label: string): Promise<string> {
  const s = `${label}-${suffix}`;
  const { rows } = await admin.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'pro', 'active') RETURNING id`,
    [`G1 Stats ${s}`, `g1-stats-${s}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertResources(orgId: string, label: string, types: string[]): Promise<void> {
  for (const [i, type] of types.entries()) {
    await admin.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status)
       VALUES ($1, $2, $3, $4, 'us-east-1', 'active')`,
      [orgId, `arn:aws:test:::g1-${label}-${i}-${suffix}`, `g1-${label}-${i}`, type]
    );
  }
}

/** A request's connection: tagged for `orgId`, as authenticate does. */
async function asRequest<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const client: PoolClient = await rolePool.connect();
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
    return await requestContext.run(client, fn);
  } finally {
    client.release();
  }
}

async function scopedCount(orgId: string): Promise<number> {
  const { rows } = await admin.query(
    `SELECT COUNT(*)::int AS n FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
    [orgId]
  );
  return rows[0].n;
}

let orgA: string;
let orgB: string;

beforeAll(async () => {
  await admin.query(`CREATE ROLE ${ROLE} NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`);

  rolePool = installTenantTagReset(new Pool({ ...dbConfig(), max: 2, options: `-c role=${ROLE}` }));
  // The production pool's shape: query() uses the request's client when there is one.
  appPool = new Proxy(rolePool, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return (...args: unknown[]) => {
          const client = requestContext.getStore();
          return ((client ?? target).query as (...a: unknown[]) => unknown)(...args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  mockPools.app = appPool;
  oneConnectionPool = installTenantTagReset(new Pool({ ...dbConfig(), max: 1, options: `-c role=${ROLE}` }));

  orgA = await insertOrg('a');
  orgB = await insertOrg('b');
  await insertResources(orgA, 'a', ['ec2', 's3']);
  await insertResources(orgB, 'b', ['ec2', 'ec2', 'rds']);
  await admin.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at) VALUES ($1, 'completed', NOW() - interval '5 minutes', NOW())`,
    [orgA]
  );
});

afterAll(async () => {
  await rolePool?.end();
  await oneConnectionPool?.end();
  if (createdOrgIds.length > 0) await admin.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await admin.query(`DROP OWNED BY ${ROLE}`);
  await admin.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await admin.end();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('getStats() without an executor, under RLS', () => {
  it('the role really is restricted: an untagged connection sees no rows (the old behaviour)', async () => {
    const client = await rolePool.connect();
    try {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM aws_resources WHERE organization_id = $1`, [orgA]);
      expect(rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it("counts the organization's own resources outside a request (jobs)", async () => {
    const repo = new AWSResourcesRepository(appPool);
    const a = await repo.getStats(orgA);
    const b = await repo.getStats(orgB);
    expect(a.total_resources).toBe(2);
    expect(a.by_type).toEqual({ ec2: 1, s3: 1 });
    expect(b.total_resources).toBe(3);
    expect(b.by_type).toEqual({ ec2: 2, rds: 1 });
  });

  it('inside a request tagged for org A: org A never counts org B resources, and B never counts A', async () => {
    const repo = new AWSResourcesRepository(appPool);
    const a = await asRequest(orgA, () => repo.getStats(orgA));
    const b = await asRequest(orgB, () => repo.getStats(orgB));
    expect(a.total_resources).toBe(2);
    expect(b.total_resources).toBe(3);
  });

  it('is scoped to the organization it is given, on its own tagged connection', async () => {
    const repo = new AWSResourcesRepository(appPool);
    // getStats tags its own connection with the organization it is asked for;
    // the explicit organization_id predicate still applies to every query.
    const asked = await asRequest(orgA, () => repo.getStats(orgB));
    expect(asked.total_resources).toBe(3);
  });

  it('the tag it sets never leaks: the same connection, checked out next without a tag, carries none and sees no rows', async () => {
    const sessionOf = async () => {
      const client = await oneConnectionPool.connect();
      try {
        const { rows } = await client.query(
          `SELECT pg_backend_pid() AS pid,
                  COALESCE(current_setting('app.current_organization_id', true), '') AS tag,
                  (SELECT COUNT(*)::int FROM aws_resources WHERE organization_id = $1) AS visible`,
          [orgB]
        );
        return rows[0] as { pid: number; tag: string; visible: number };
      } finally {
        client.release();
      }
    };

    const before = await sessionOf();
    expect(before).toMatchObject({ tag: '', visible: 0 });

    // getStats tags this pool's only connection for B and releases it.
    const stats = await new AWSResourcesRepository(oneConnectionPool).getStats(orgB);
    expect(stats.total_resources).toBe(3);

    // The next, untagged checkout is that same session: the tag must be gone.
    const next = await sessionOf();
    expect(next.pid).toBe(before.pid);
    expect(next.tag).toBe('');
    expect(next.visible).toBe(0);
  });

  it('stats agree with the scoped inventory count', async () => {
    const repo = new AWSResourcesRepository(appPool);
    for (const org of [orgA, orgB]) {
      expect((await repo.getStats(org)).total_resources).toBe(await scopedCount(org));
    }
  });

  it("the report's resource count is the organization's scoped count, not 0", async () => {
    const data = await asRequest(orgA, () =>
      new AIReportGeneratorService(appPool).fetchReportData(orgA, { from: '2026-10-29', to: '2026-11-05' }, 'infrastructure_health')
    );
    const inventory = data.sections.resourceInventory!;
    expect(inventory.state).toBe('available');
    expect(inventory.data).toEqual({ total: 2, byType: { ec2: 1, s3: 1 } });
  });
});
