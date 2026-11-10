/**
 * NLQueryAnalyticsService.initializeTable() checks the catalog only: it never
 * issues DDL (nl_query_analytics and its indexes come from admin migration
 * 202611091300_harden_database_ownership.sql, and the application role has no
 * CREATE on schema public). When everything exists it is silent; when
 * something is missing, or the check fails, it reports once per process and
 * continues.
 *
 * Unit: a recording fake pool. Database: the real service, run as devcontrol
 * (the production application role) against the bootstrapped schema.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';

type Recorded = { text: string; values?: unknown[] };

function fakePool(answer: (text: string) => { rows: unknown[] } | Error): { pool: Pool; queries: Recorded[] } {
  const queries: Recorded[] = [];
  const pool = {
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      const result = answer(text);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as Pool;
  return { pool, queries };
}

/** A fresh module (its once-per-process report state reset) for each case. */
function freshService(): typeof import('../nl-query-analytics.service') {
  let mod!: typeof import('../nl-query-analytics.service');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('../nl-query-analytics.service');
  });
  return mod;
}

const DDL = /\b(CREATE|ALTER|DROP)\b/i;

afterEach(() => jest.restoreAllMocks());

describe('initializeTable(): catalog check only', () => {
  it('the service source issues no DDL at all', () => {
    const source = fs.readFileSync(path.join(__dirname, '../nl-query-analytics.service.ts'), 'utf8');
    const sqlLiterals = [...source.matchAll(/`([^`]*)`|'([^'\n]*)'/g)].map((m) => m[1] ?? m[2]);
    expect(sqlLiterals.filter((s) => /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|SCHEMA|EXTENSION)\b/i.test(s))).toEqual([]);
  });

  it('everything exists: one catalog query, no DDL, nothing logged', async () => {
    const { NLQueryAnalyticsService, NL_ANALYTICS_RELATIONS } = freshService();
    const { pool, queries } = fakePool(() => ({ rows: [] }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await new NLQueryAnalyticsService(pool).initializeTable();

    expect(queries).toHaveLength(1);
    expect(queries[0].text).toMatch(/to_regclass/);
    expect(queries[0].text).not.toMatch(DDL);
    expect(queries[0].values).toEqual([NL_ANALYTICS_RELATIONS]);
    expect([warn, error, log].map((s) => s.mock.calls.length)).toEqual([0, 0, 0]);
  });

  it('something missing: no DDL, one warning per process however many services check', async () => {
    const { NLQueryAnalyticsService } = freshService();
    const { pool, queries } = fakePool(() => ({ rows: [{ name: 'public.idx_nl_analytics_query' }] }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await new NLQueryAnalyticsService(pool).initializeTable();
    await new NLQueryAnalyticsService(pool).initializeTable();

    expect(queries.every((q) => !DDL.test(q.text))).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('public.idx_nl_analytics_query missing');
    expect(error).not.toHaveBeenCalled();
  });

  it('the check itself fails: no DDL, one error per process, never throws', async () => {
    const { NLQueryAnalyticsService } = freshService();
    const { pool, queries } = fakePool(() => new Error('connection refused'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new NLQueryAnalyticsService(pool).initializeTable()).resolves.toBeUndefined();
    await expect(new NLQueryAnalyticsService(pool).initializeTable()).resolves.toBeUndefined();

    expect(queries.every((q) => !DDL.test(q.text))).toBe(true);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('initializeTable() and logQuery() as devcontrol on the migrated schema', () => {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
  const devcontrol = new Pool({ ...dbConfig, max: 2, options: '-c role=devcontrol' });
  const admin = new Pool({ ...dbConfig, max: 1 });
  const orgId = randomUUID();

  afterAll(async () => {
    await admin.query('DELETE FROM nl_query_analytics WHERE organization_id = $1', [orgId]);
    await devcontrol.end();
    await admin.end();
  });

  it('runs as devcontrol, which has no CREATE on public', async () => {
    const { rows } = await devcontrol.query(
      `SELECT current_user AS who, has_schema_privilege('public', 'CREATE') AS can_create`
    );
    expect(rows[0]).toEqual({ who: 'devcontrol', can_create: false });
  });

  it('startup check logs nothing, and a query is recorded and counted', async () => {
    const { NLQueryAnalyticsService } = freshService();
    const warn = jest.spyOn(console, 'warn');
    const error = jest.spyOn(console, 'error');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const service = new NLQueryAnalyticsService(devcontrol);

    await service.initializeTable();
    await service.logQuery({
      organizationId: orgId,
      query: 'list ec2 instances',
      target: 'aws_resources',
      action: 'list',
      filterCount: 0,
      confidence: 'high',
      wasCached: false,
      responseTime: 12,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const { rows } = await admin.query('SELECT count(*)::int AS n FROM nl_query_analytics WHERE organization_id = $1', [orgId]);
    expect(rows[0].n).toBe(1);
  });
});
