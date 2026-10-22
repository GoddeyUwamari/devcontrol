/**
 * GET /api/services and /api/services/stats: the fields, filters and counts
 * the Services page redesign reads (Phase 1, PR S1-A). Everything here is
 * added; every field, default and behaviour that existed before is unchanged.
 *
 *   - Each row carries aws_region (the stored region), last_seen_at (the last
 *     discovery that listed it), ownership and attention_cause.
 *   - ownership: unknown when the tags could not be read, whatever they hold;
 *     owned with an Owner or a Team tag (exact keys, any case); unowned otherwise.
 *   - ?ownership, ?region, ?team (case-insensitive) and ?tags_known filter in
 *     SQL; /stats counts the same rule over the same rows, in one statement.
 *   - ?env=untagged&tags_known=true leaves out the resources whose tags could
 *     not be read. ?env=untagged alone is unchanged.
 *   - ?sort=attention lists the resources that need attention first, by
 *     severity; a finding below the floor never lifts a row. The default is unchanged.
 *   - ?search_tags=true also matches tag keys and values, literally: %, _ and \
 *     are characters, not wildcards. Paged like any list, length-capped.
 *   - Nothing crosses organizations, by the explicit predicate and, as the
 *     non-superuser devcontrol role, by row-level security alone.
 *
 * Real routes over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken (to choose the caller) is stubbed.
 */
import express from 'express';
import http from 'http';
import { Client, Pool } from 'pg';
import servicesRoutes, { MAX_TAG_SEARCH_LENGTH } from '../services.routes';
import { tagsObserved } from '../../services/complianceScanner';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { pool as appPool } from '../../config/database';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

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
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Services Facets ${suffix}`, `services-facets-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Services Facets User') RETURNING id`,
    [`services-facets-${uniqueSuffix()}@example.com`]
  );
  const userId = rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'viewer', NOW(), true)`,
    [orgId, userId]
  );
  return userId;
}

async function insertService(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2) RETURNING id`,
    [`facets-service-${uniqueSuffix()}`, orgId]
  );
  return rows[0].id as string;
}

interface Fixture {
  type?: string;
  region?: string;
  status?: string;
  tags?: unknown;
  metadata?: Record<string, unknown>;
  complianceIssues?: unknown[];
  lastSyncedAt?: string;
  serviceId?: string;
}

async function insertResource(orgId: string, name: string, f: Fixture = {}): Promise<string> {
  const type = f.type ?? 'ec2';
  const region = f.region ?? 'us-east-1';
  const resourceId = `${name}-${uniqueSuffix()}`;
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata,
        compliance_issues, last_synced_at, service_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      orgId,
      `arn:aws:${type}:${region}:123456789012:resource/${resourceId}`,
      resourceId,
      name,
      type,
      region,
      f.status ?? 'running',
      JSON.stringify(f.tags ?? {}),
      JSON.stringify(f.metadata ?? {}),
      JSON.stringify(f.complianceIssues ?? []),
      f.lastSyncedAt ?? null,
      f.serviceId ?? null,
    ]
  );
  return resourceId;
}

async function insertCostRecommendation(orgId: string, resourceId: string, severity: string): Promise<void> {
  await pool.query(
    `INSERT INTO cost_recommendations (
       organization_id, resource_id, resource_name, resource_type, issue, description,
       potential_savings, severity, aws_region, metadata, status
     ) VALUES ($1, $2, $2, 'EC2', 'Idle Instance', 'Idle.', 40, $3, 'us-east-1', '{}', 'ACTIVE')`,
    [orgId, resourceId, severity]
  );
}

let server: http.Server;
let baseUrl: string;

// Every statement the app runs, with its parameters: a pass-through recorder on pg's Client.prototype.query, installed before
// any connection exists (config/database.ts wraps each pooled client's query once,
// keeping whatever method it found then).
interface Recorded { text: string; values: unknown[] }
const originalClientQuery = Client.prototype.query;
const recorded: Recorded[] = [];

/** The statements run during `fn` whose text matches `pattern`. */
async function statementsDuring(fn: () => Promise<unknown>, pattern: RegExp): Promise<Recorded[]> {
  const start = recorded.length;
  await fn();
  return recorded.slice(start).filter((r) => pattern.test(r.text));
}

beforeAll(async () => {
  Client.prototype.query = function (this: Client, ...args: unknown[]) {
    const arg = args[0] as string | { text?: string; values?: unknown[] } | null;
    const entry: Recorded = {
      text: typeof arg === 'string' ? arg : arg?.text ?? '',
      values: (typeof arg === 'string' ? (Array.isArray(args[1]) ? args[1] : []) : arg?.values ?? []) as unknown[],
    };
    recorded.push(entry);
    return (originalClientQuery as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof Client.prototype.query;
  // /stats reads it; CI's bootstrap does not create it.
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  const app = express();
  app.use(express.json());
  app.use('/api/services', servicesRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
  Client.prototype.query = originalClientQuery;
});

async function get(userId: string, orgId: string, path: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'services-facets-caller@example.com',
    organizationId: orgId,
    role: 'viewer',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer test-token' } });
  return { status: res.status, body: (await res.json()) as any };
}

const names = (body: any): string[] => body.services.map((s: { name: string }) => s.name);
const sorted = (list: string[]): string[] => [...list].sort();
const byName = new Intl.Collator('en');

const baselineHigh = { severity: 'high', category: 'public_access', issue: 'EC2 instance has a public IP address', recommendation: 'r', provenance: 'OBSERVED' };
const baselineLow = { severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner', recommendation: 'r', provenance: 'SELF_ATTESTED' };

const OWNED = ['of-ebs-team-upper', 'of-ec2-owner', 'of-ec2-team', 'of-rds-data', 'of-sns-ml', 'of-sqs-data', 'of-ec2-growth'];
const UNOWNED = ['of-ec2-alias-key', 'of-ec2-blank-owner', 'of-ec2-env-only', 'of-s3-observed'];
const UNKNOWN = ['of-cloudfront', 'of-lambda-legacy', 'of-s3-unreadable'];
const ALL = [...OWNED, ...UNOWNED, ...UNKNOWN];

describe('the inventory facets: rows, filters and /stats', () => {
  let orgA: string;
  let viewerA: string;
  let orgB: string;
  let viewerB: string;

  beforeAll(async () => {
    orgA = await insertOrg();
    viewerA = await member(orgA);
    const serviceA = await insertService(orgA);

    // Owned: an Owner tag, or a Team tag alone, in any key case.
    await insertResource(orgA, 'of-ec2-owner', { tags: { Owner: 'owner-a@example.com', Team: 'Platform' }, complianceIssues: [baselineHigh] });
    await insertResource(orgA, 'of-ec2-team', { tags: { team: 'platform' } });
    await insertResource(orgA, 'of-ebs-team-upper', { type: 'ebs', status: 'error', tags: { TEAM: 'Platform' } });
    await insertResource(orgA, 'of-rds-data', { type: 'rds', region: 'eu-west-1', status: 'available', tags: { Team: 'data' } });
    await insertResource(orgA, 'of-sqs-data', { type: 'sqs', status: 'unknown', tags: { Team: 'data' }, metadata: { source: 'resource-explorer', tags_state: 'observed' } });
    await insertResource(orgA, 'of-ec2-growth', {
      tags: { Team: 'growth' },
      metadata: { tags_state: 'observed', last_deployed: '2020-01-01T00:00:00.000Z' },
      lastSyncedAt: '2026-10-01T12:00:00.000Z',
    });
    await insertResource(orgA, 'of-sns-ml', { type: 'sns', status: 'unknown', tags: { team: 'ml' }, metadata: { tags_state: 'observed' }, serviceId: serviceA });

    // Unowned: tags were read and hold neither. An alias key is not an Owner tag;
    // a blank value is no tag.
    const aliasId = await insertResource(orgA, 'of-ec2-alias-key', { tags: { owner_email: 'owner-b@example.com' } });
    await insertResource(orgA, 'of-ec2-blank-owner', { tags: { Owner: '   ' }, complianceIssues: [baselineLow] });
    await insertResource(orgA, 'of-ec2-env-only', { status: 'stopped', tags: { Environment: 'production' } });
    await insertResource(orgA, 'of-s3-observed', { type: 's3', region: 'us-west-2', status: 'not_applicable', metadata: { tags_state: 'observed' } });

    // Unknown: the tags could not be read, whatever is stored; a row of a
    // flag-recording type without the flag; CloudFront, whose tags are never read.
    await insertResource(orgA, 'of-s3-unreadable', { type: 's3', region: 'eu-west-1', status: 'not_applicable', tags: { Team: 'growth' }, metadata: { tags_state: 'unavailable' } });
    await insertResource(orgA, 'of-lambda-legacy', { type: 'lambda', status: 'active' });
    await insertResource(orgA, 'of-cloudfront', { type: 'cloudfront', region: 'global', status: 'active', metadata: { tags_state: 'unavailable' } });

    await insertCostRecommendation(orgA, aliasId, 'HIGH');

    // Another organization with the same team, tag values and kinds of rows, a
    // region of its own, and a service one of org A's rows points at.
    orgB = await insertOrg();
    viewerB = await member(orgB);
    const serviceB = await insertService(orgB);
    await insertResource(orgB, 'ob-ec2-platform', { region: 'ap-south-1', tags: { Owner: 'owner-a@example.com', Team: 'platform' } });
    await insertResource(orgB, 'ob-ec2-unowned', { region: 'ap-south-1' });
    await insertResource(orgB, 'ob-s3-unreadable', { type: 's3', region: 'ap-south-1', status: 'not_applicable', metadata: { tags_state: 'unavailable' } });
    await insertResource(orgA, 'of-foreign-service', { type: 'vpc', status: 'unknown', metadata: { tags_state: 'observed' }, tags: { Team: 'data' }, serviceId: serviceB });
    // of-foreign-service is org A's own row (owned, team data); only its service is org B's.
  });

  const ALL_A = [...ALL, 'of-foreign-service'];

  describe('row fields', () => {
    let rows: Record<string, any>;
    beforeAll(async () => {
      const { body } = await get(viewerA, orgA, '/services?limit=100');
      rows = Object.fromEntries(body.services.map((s: any) => [s.name, s]));
    });

    it('aws_region is the stored region; region keeps its old meaning', () => {
      expect(rows['of-rds-data'].aws_region).toBe('eu-west-1');
      expect(rows['of-cloudfront'].aws_region).toBe('global');
      expect(rows['of-rds-data'].region).toBeNull();
    });

    it('last_seen_at is the last discovery, never metadata.last_deployed; last_deployed is unchanged', () => {
      expect(rows['of-ec2-growth'].last_seen_at).toBe('2026-10-01T12:00:00.000Z');
      expect(rows['of-ec2-growth'].last_deployed).toBe('2020-01-01T00:00:00.000Z');
      expect(rows['of-ec2-team'].last_seen_at).toBeNull();
    });

    it('ownership: owned, unowned or unknown', () => {
      for (const name of [...OWNED, 'of-foreign-service']) expect([name, rows[name].ownership]).toEqual([name, 'owned']);
      for (const name of UNOWNED) expect([name, rows[name].ownership]).toEqual([name, 'unowned']);
      for (const name of UNKNOWN) expect([name, rows[name].ownership]).toEqual([name, 'unknown']);
    });

    it('owner and team are read exactly as before', () => {
      expect([rows['of-ec2-owner'].owner, rows['of-ec2-owner'].team]).toEqual(['owner-a@example.com', 'Platform']);
      expect([rows['of-ec2-alias-key'].owner, rows['of-ec2-alias-key'].team]).toEqual([null, null]);
      expect(rows['of-ec2-blank-owner'].owner).toBeNull();
    });

    it('attention_cause names the signal behind the reason, only for a resource that needs attention', () => {
      expect(rows['of-ec2-owner'].attention_cause).toBe('finding');
      expect(rows['of-ec2-alias-key'].attention_cause).toBe('cost_recommendation');
      expect(rows['of-ec2-env-only'].attention_cause).toBe('status');
      expect(rows['of-ebs-team-upper'].attention_cause).toBe('status');
      // A low finding has a reason, but the resource does not need attention.
      expect(rows['of-ec2-blank-owner'].reason).not.toBeNull();
      expect(rows['of-ec2-blank-owner'].attention_cause).toBeNull();
      expect(rows['of-ec2-team'].attention_cause).toBeNull();
    });
  });

  describe('?ownership', () => {
    it('lists each kind, and the totals are /stats\' counts', async () => {
      const stats = (await get(viewerA, orgA, '/services/stats')).body.stats;
      for (const [kind, expected] of [['owned', [...OWNED, 'of-foreign-service']], ['unowned', UNOWNED], ['unknown', UNKNOWN]] as const) {
        const { status, body } = await get(viewerA, orgA, `/services?ownership=${kind}&limit=100`);
        expect(status).toBe(200);
        expect(sorted(names(body))).toEqual(sorted([...expected]));
        expect(body.pagination.total).toBe(stats.ownership[kind]);
      }
    });

    it('splits by needs attention like any filter', async () => {
      const { body } = await get(viewerA, orgA, '/services?ownership=unowned');
      expect(body.counts).toEqual({ needs_attention: 2, no_flagged_issues: 2 });
    });

    it('anything else is a 400', async () => {
      const { status, body } = await get(viewerA, orgA, '/services?ownership=nobody');
      expect(status).toBe(400);
      expect(body.error).toBe('ownership must be owned, unowned or unknown');
    });
  });

  describe('?env=untagged and ?tags_known', () => {
    it('?env=untagged alone is unchanged: every row with no environment tag, including unreadable ones', async () => {
      const { body } = await get(viewerA, orgA, '/services?env=untagged&limit=100');
      expect(sorted(names(body))).toEqual(sorted(ALL_A.filter((n) => n !== 'of-ec2-env-only')));
    });

    it('with tags_known=true it leaves out the resources whose tags could not be read', async () => {
      const { body } = await get(viewerA, orgA, '/services?env=untagged&tags_known=true&limit=100');
      expect(sorted(names(body))).toEqual(sorted(ALL_A.filter((n) => n !== 'of-ec2-env-only' && !UNKNOWN.includes(n))));
    });

    it('tags_known=false lists only those', async () => {
      const { body } = await get(viewerA, orgA, '/services?tags_known=false&limit=100');
      expect(sorted(names(body))).toEqual(sorted(UNKNOWN));
    });

    it('anything else is a 400', async () => {
      expect((await get(viewerA, orgA, '/services?tags_known=yes')).status).toBe(400);
    });
  });

  describe('?region', () => {
    it('matches the stored region exactly', async () => {
      expect(sorted(names((await get(viewerA, orgA, '/services?region=eu-west-1')).body))).toEqual(['of-rds-data', 'of-s3-unreadable']);
      expect(names((await get(viewerA, orgA, '/services?region=global')).body)).toEqual(['of-cloudfront']);
      expect(names((await get(viewerA, orgA, '/services?region=EU-WEST-1')).body)).toEqual([]);
    });

    it('/stats counts every region, largest first, and they add up to the total', async () => {
      const { stats } = (await get(viewerA, orgA, '/services/stats')).body;
      expect(stats.regions).toEqual([
        { region: 'us-east-1', count: 11 },
        { region: 'eu-west-1', count: 2 },
        { region: 'global', count: 1 },
        { region: 'us-west-2', count: 1 },
      ]);
      expect(stats.regions.reduce((sum: number, r: { count: number }) => sum + r.count, 0)).toBe(stats.total);
    });
  });

  describe('?team and /stats teams', () => {
    it('matches the Team tag case-insensitively, trimmed', async () => {
      const expected = ['of-ebs-team-upper', 'of-ec2-owner', 'of-ec2-team'];
      for (const value of ['platform', 'PLATFORM', '%20Platform%20']) {
        expect(sorted(names((await get(viewerA, orgA, `/services?team=${value}`)).body))).toEqual(expected);
      }
    });

    it('never matches a row whose tags could not be read', async () => {
      // of-s3-unreadable stores Team: growth, but its tags were not read.
      expect(names((await get(viewerA, orgA, '/services?team=growth')).body)).toEqual(['of-ec2-growth']);
    });

    it('groups case-insensitively under the most common casing, largest first, top 3', async () => {
      const { stats } = (await get(viewerA, orgA, '/services/stats')).body;
      const all = [
        { team: 'data', count: 3 },
        { team: 'Platform', count: 3 },
        { team: 'growth', count: 1 },
        { team: 'ml', count: 1 },
      ];
      expect(stats.teams).toEqual({ top: all.slice(0, 3), all, total_teams: 4 });
    });

    it('every team count is the ?team total', async () => {
      const { stats } = (await get(viewerA, orgA, '/services/stats')).body;
      for (const { team, count } of stats.teams.all) {
        expect((await get(viewerA, orgA, `/services?team=${encodeURIComponent(team)}`)).body.pagination.total).toBe(count);
      }
    });
  });

  describe('/stats', () => {
    it('adds the new counts and keeps every old one', async () => {
      const { status, body } = await get(viewerA, orgA, '/services/stats');
      expect(status).toBe(200);
      expect(body.stats).toMatchObject({
        total: 15,
        needs_attention: 4,
        healthy: 11,
        avg_uptime: null,
        aws_accounts_connected: 0,
        attention_by_severity: { critical: 1, high: 2, medium: 1, low: 0 },
        ownership: { owned: 8, unowned: 4, unknown: 3 },
        unknown_by_type: { cloudfront: 1, lambda: 1, s3: 1 },
        // of-sns-ml's service is org A's; of-foreign-service's is org B's.
        mapped_to_service: 1,
      });
      expect(body.stats.findings_by_severity).toBeDefined();
      expect(body.stats.attention_reasons).toBeDefined();
    });

    it('attention_by_severity adds up to needs_attention', async () => {
      const { stats } = (await get(viewerA, orgA, '/services/stats')).body;
      const sum = Object.values(stats.attention_by_severity as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(sum).toBe(stats.needs_attention);
    });

    it('an organization with no resources gets zeros and empty lists, not an error', async () => {
      const empty = await insertOrg();
      const viewer = await member(empty);
      const { status, body } = await get(viewer, empty, '/services/stats');
      expect(status).toBe(200);
      expect(body.stats).toMatchObject({
        total: 0,
        needs_attention: 0,
        attention_by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
        ownership: { owned: 0, unowned: 0, unknown: 0 },
        unknown_by_type: {},
        regions: [],
        teams: { top: [], all: [], total_teams: 0 },
        mapped_to_service: 0,
      });
    });
  });

  describe('?sort=attention', () => {
    it('lists the resources that need attention first, by severity, then the rest by name', async () => {
      const { status, body } = await get(viewerA, orgA, '/services?sort=attention&limit=100');
      expect(status).toBe(200);
      const list = names(body);
      expect(list.slice(0, 4)).toEqual(['of-ebs-team-upper', 'of-ec2-alias-key', 'of-ec2-owner', 'of-ec2-env-only']);
      // A low finding does not lift of-ec2-blank-owner: it sorts with the rest, by name.
      const rest = ALL_A.filter((n) => !list.slice(0, 4).includes(n)).sort(byName.compare);
      expect(list.slice(4)).toEqual(rest);
    });

    it('pages the same order', async () => {
      const whole = names((await get(viewerA, orgA, '/services?sort=attention&limit=100')).body);
      const first = names((await get(viewerA, orgA, '/services?sort=attention&limit=5&page=1')).body);
      const second = names((await get(viewerA, orgA, '/services?sort=attention&limit=5&page=2')).body);
      expect([...first, ...second]).toEqual(whole.slice(0, 10));
    });

    it('the default is unchanged: every row by name', async () => {
      const byDefault = names((await get(viewerA, orgA, '/services?limit=100')).body);
      expect(byDefault).toEqual([...ALL_A].sort(byName.compare));
      expect(names((await get(viewerA, orgA, '/services?sort=name&limit=100')).body)).toEqual(byDefault);
    });

    it('anything else is a 400', async () => {
      const { status, body } = await get(viewerA, orgA, '/services?sort=severity');
      expect(status).toBe(400);
      expect(body.error).toBe('sort must be name or attention');
    });
  });

  describe('nothing crosses organizations', () => {
    it('org A\'s filters never return org B\'s rows', async () => {
      expect(sorted(names((await get(viewerA, orgA, '/services?team=platform')).body))).toEqual(['of-ebs-team-upper', 'of-ec2-owner', 'of-ec2-team']);
      expect(names((await get(viewerA, orgA, '/services?region=ap-south-1')).body)).toEqual([]);
      expect((await get(viewerA, orgA, '/services?ownership=unowned')).body.pagination.total).toBe(UNOWNED.length);
      expect((await get(viewerA, orgA, '/services?ownership=unknown')).body.pagination.total).toBe(UNKNOWN.length);
      expect(names((await get(viewerA, orgA, '/services?search=owner-a&search_tags=true')).body)).toEqual(['of-ec2-owner']);
    });

    it('org A\'s counts never include org B\'s rows, teams, regions or services', async () => {
      const { stats } = (await get(viewerA, orgA, '/services/stats')).body;
      expect(stats.regions.map((r: { region: string }) => r.region)).not.toContain('ap-south-1');
      expect(stats.teams.all.find((t: { team: string }) => t.team.toLowerCase() === 'platform').count).toBe(3);
      expect(stats.mapped_to_service).toBe(1);
    });

    it('org B sees only its own', async () => {
      const { stats } = (await get(viewerB, orgB, '/services/stats')).body;
      expect(stats).toMatchObject({
        total: 3,
        ownership: { owned: 1, unowned: 1, unknown: 1 },
        regions: [{ region: 'ap-south-1', count: 3 }],
        teams: { top: [{ team: 'platform', count: 1 }], all: [{ team: 'platform', count: 1 }], total_teams: 1 },
        mapped_to_service: 0,
      });
      expect(names((await get(viewerB, orgB, '/services?region=eu-west-1')).body)).toEqual([]);
      expect(names((await get(viewerB, orgB, '/services?team=data')).body)).toEqual([]);
      expect(names((await get(viewerB, orgB, '/services?search=owner-a&search_tags=true')).body)).toEqual(['ob-ec2-platform']);
    });
  });

  describe('/stats returns its facets once', () => {
    // The statement /stats ran, run again with its own parameters.
    async function statsStatementRows(userId: string, orgId: string) {
      const [statement] = await statementsDuring(() => get(userId, orgId, '/services/stats'), /WITH inv AS/);
      expect(statement).toBeDefined();
      return (await pool.query(statement.text, statement.values)).rows;
    }

    it('on one row, not on every resource row', async () => {
      const rows = await statsStatementRows(viewerA, orgA);
      expect(rows).toHaveLength(15);
      expect(rows.filter((row) => row.facets !== null)).toHaveLength(1);
    });

    it('an empty organization gets one row carrying the facets', async () => {
      const empty = await insertOrg();
      const viewer = await member(empty);
      const rows = await statsStatementRows(viewer, empty);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBeNull();
      expect(rows[0].facets).toMatchObject({ ownership: { owned: 0, unowned: 0, unknown: 0 }, regions: [], mapped_to_service: 0 });
      expect((await get(viewer, empty, '/services/stats')).status).toBe(200);
    });
  });

  it('?team that is empty after trimming is a 400', async () => {
    for (const value of ['', '%20%20']) {
      const { status, body } = await get(viewerA, orgA, `/services?team=${value}`);
      expect(status).toBe(400);
      expect(body.error).toBe('team must not be empty');
    }
  });

  describe('row-level security alone, as the non-superuser devcontrol role', () => {
    // The exact statements the routes run, with every explicit organization
    // predicate replaced by a test that holds for any organization. Only RLS
    // (app.current_organization_id) is left to scope them.
    function withoutOrganizationPredicate(text: string): string {
      const stripped = text
        .split('r.organization_id = $1').join('$1::uuid IS NOT NULL')
        .split('s.organization_id = $1').join('$1::uuid IS NOT NULL');
      expect(stripped).not.toMatch(/organization_id = \$1/);
      return stripped;
    }

    it('returns only the tagged organization\'s rows and counts, whatever organization is asked for', async () => {
      // Filters org B's rows would also match (ob-ec2-platform: owned, team platform, an "a" in its tags).
      const listPath = '/services?ownership=owned&team=platform&tags_known=true&search=a&search_tags=true&sort=attention&limit=100';
      const viaRoute = names((await get(viewerA, orgA, listPath)).body);
      expect(sorted(viaRoute)).toEqual(['of-ebs-team-upper', 'of-ec2-owner', 'of-ec2-team']);
      const [listStatement] = await statementsDuring(() => get(viewerA, orgA, listPath), /CROSS JOIN LATERAL/);
      const [regionStatement] = await statementsDuring(() => get(viewerA, orgA, '/services?region=ap-south-1'), /CROSS JOIN LATERAL/);
      const [statsStatement] = await statementsDuring(() => get(viewerA, orgA, '/services/stats'), /WITH inv AS/);
      const statsA = (await get(viewerA, orgA, '/services/stats')).body.stats;
      const statsB = (await get(viewerB, orgB, '/services/stats')).body.stats;
      const list = withoutOrganizationPredicate(listStatement.text);
      const region = withoutOrganizationPredicate(regionStatement.text);
      const stats = withoutOrganizationPredicate(statsStatement.text);
      const facetsOf = (rows: any[]) => rows.find((row) => row.facets !== null).facets;

      const client = await pool.connect();
      try {
        // Rolled back: the grants never outlive this test.
        await client.query('BEGIN');
        await client.query('GRANT SELECT ON aws_resources, services, cost_recommendations TO devcontrol');
        await client.query('SET LOCAL ROLE devcontrol');
        const role = await client.query(
          'SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
        );
        expect(role.rows[0]).toEqual({ name: 'devcontrol', rolsuper: false, rolbypassrls: false });
        const tables = await client.query(
          `SELECT relname, relrowsecurity, pg_get_userbyid(relowner) <> current_user AS not_owner
             FROM pg_class WHERE relkind = 'r' AND relname = ANY($1) AND relnamespace = 'public'::regnamespace ORDER BY relname`,
          [['aws_resources', 'cost_recommendations', 'services']]
        );
        expect(tables.rows).toEqual([
          { relname: 'aws_resources', relrowsecurity: true, not_owner: true },
          { relname: 'cost_recommendations', relrowsecurity: true, not_owner: true },
          { relname: 'services', relrowsecurity: true, not_owner: true },
        ]);

        // Tagged for A, asking for B.
        await client.query("SELECT set_config('app.current_organization_id', $1, true)", [orgA]);
        const listA = await client.query(list, [orgB, ...listStatement.values.slice(1)]);
        expect(listA.rows.map((row) => row.name)).not.toContain('ob-ec2-platform');
        expect(sorted(listA.rows.map((row) => row.name))).toEqual(sorted(viaRoute));
        expect((await client.query(region, [orgB, ...regionStatement.values.slice(1)])).rows).toEqual([]);
        const rowsA = (await client.query(stats, [orgB])).rows;
        expect(rowsA.filter((row) => row.id !== null)).toHaveLength(statsA.total);
        expect(facetsOf(rowsA)).toEqual({
          ownership: statsA.ownership,
          unknown_by_type: statsA.unknown_by_type,
          regions: statsA.regions,
          teams: { all: statsA.teams.all, total_teams: statsA.teams.total_teams },
          // RLS hides org B's service from the join too.
          mapped_to_service: statsA.mapped_to_service,
        });

        // Tagged for B, asking for A.
        await client.query("SELECT set_config('app.current_organization_id', $1, true)", [orgB]);
        const listB = await client.query(list, [orgA, ...listStatement.values.slice(1)]);
        expect(listB.rows.map((row) => row.name)).toEqual(['ob-ec2-platform']);
        const rowsB = (await client.query(stats, [orgA])).rows;
        expect(rowsB.filter((row) => row.id !== null)).toHaveLength(statsB.total);
        expect(facetsOf(rowsB)).toMatchObject({ ownership: statsB.ownership, regions: statsB.regions, mapped_to_service: 0 });

        // No tag: nothing.
        await client.query("SELECT set_config('app.current_organization_id', '', true)");
        expect((await client.query(list, listStatement.values)).rows).toEqual([]);
        const untagged = (await client.query(stats, [orgA])).rows;
        expect(untagged).toHaveLength(1);
        expect(untagged[0].facets.ownership).toEqual({ owned: 0, unowned: 0, unknown: 0 });
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });
  });
});

describe('?search_tags: tag keys and values, matched literally', () => {
  let orgId: string;
  let viewer: string;

  beforeAll(async () => {
    orgId = await insertOrg();
    viewer = await member(orgId);
    await insertResource(orgId, 'wc-percent', { tags: { CostCenter: 'rate-100%' } });
    await insertResource(orgId, 'wc-plain', { tags: { CostCenter: 'rate-1000' } });
    await insertResource(orgId, 'wc-underscore', { tags: { cost_center: 'kept' } });
    await insertResource(orgId, 'wc-lookalike', { tags: { costXcenter: 'kept' } });
    await insertResource(orgId, 'wc-backslash', { tags: { Path: 'a\\b' } });
    await insertResource(orgId, 'wc-no-backslash', { tags: { Path: 'ab' } });
    // Not an object: no tag to match, and no error.
    await insertResource(orgId, 'wc-array-tags', { tags: ['zzq'] });
    // Its tags could not be read: what it stores is not searched.
    await insertResource(orgId, 'wc-unreadable', { type: 's3', status: 'not_applicable', tags: { CostCenter: 'rate-unreadable' }, metadata: { tags_state: 'unavailable' } });
  });

  const search = async (term: string, extra = '&search_tags=true') =>
    sorted(names((await get(viewer, orgId, `/services?search=${encodeURIComponent(term)}${extra}&limit=100`)).body));

  it('matches a tag value', async () => {
    expect(await search('rate-1000')).toEqual(['wc-plain']);
  });

  it('matches a tag key, in any case', async () => {
    expect(await search('COSTCENTER')).toEqual(['wc-percent', 'wc-plain']);
  });

  it('"%" is a percent sign, not a wildcard', async () => {
    expect(await search('100%')).toEqual(['wc-percent']);
    expect(await search('%')).toEqual(['wc-percent']);
  });

  it('"_" is an underscore, not a single-character wildcard', async () => {
    expect(await search('cost_center')).toEqual(['wc-underscore']);
    expect(await search('_')).toEqual(['wc-underscore']);
  });

  it('"\\" is a backslash, not an escape', async () => {
    expect(await search('a\\b')).toEqual(['wc-backslash']);
  });

  it('never matches the tags of a row whose tags could not be read, as ?team does not', async () => {
    expect(await search('rate-unreadable')).toEqual([]);
    expect(await search('rate')).toEqual(['wc-percent', 'wc-plain']);
    // Its name and id are still searched.
    expect(await search('wc-unreadable')).toEqual(['wc-unreadable']);
  });

  it('a row whose tags are not an object matches nothing by tag', async () => {
    expect(await search('zzq')).toEqual([]);
  });

  it('without search_tags, tags are not searched: the old behaviour', async () => {
    expect(await search('cost_center', '')).toEqual([]);
    expect(await search('rate-1000', '&search_tags=false')).toEqual([]);
    expect(await search('wc-plain', '')).toEqual(['wc-plain']);
  });

  it('is paged: totals over every match, one page at a time', async () => {
    const { body } = await get(viewer, orgId, '/services?search=rate&search_tags=true&limit=1');
    expect(body.services).toHaveLength(1);
    expect(body.pagination).toMatchObject({ total: 2, total_pages: 2, has_more: true });
  });

  it(`is capped at ${MAX_TAG_SEARCH_LENGTH} characters when tags are searched, and only then`, async () => {
    const long = 'x'.repeat(MAX_TAG_SEARCH_LENGTH + 1);
    const capped = await get(viewer, orgId, `/services?search=${long}&search_tags=true`);
    expect(capped.status).toBe(400);
    expect(capped.body.error).toBe(`search must be at most ${MAX_TAG_SEARCH_LENGTH} characters when search_tags is true`);
    expect((await get(viewer, orgId, `/services?search=${'x'.repeat(MAX_TAG_SEARCH_LENGTH)}&search_tags=true`)).status).toBe(200);
    expect((await get(viewer, orgId, `/services?search=${long}`)).status).toBe(200);
  });

  it('search_tags must be true or false', async () => {
    expect((await get(viewer, orgId, '/services?search=x&search_tags=1')).status).toBe(400);
  });
});

describe('ownership "unknown" is exactly !tagsObserved (complianceScanner)', () => {
  let orgId: string;
  let viewer: string;
  // name → [type, metadata]. Every row has Team: ops, so a row whose tags count is owned.
  const MATRIX: Record<string, [string, Record<string, unknown>]> = {
    'tm-elb-legacy': ['elb', {}],
    'tm-load-balancer-legacy': ['load-balancer', {}],
    'tm-dynamodb-legacy': ['dynamodb', {}],
    'tm-sqs-legacy': ['sqs', { source: 'resource-explorer' }],
    'tm-ec2-legacy': ['ec2', {}],
    'tm-ebs-legacy': ['ebs', {}],
    'tm-rds-legacy': ['rds', {}],
    'tm-ec2-unavailable': ['ec2', { tags_state: 'unavailable' }],
    'tm-rds-observed': ['rds', { tags_state: 'observed' }],
    'tm-ec2-other-state': ['ec2', { tags_state: 'partial' }],
    'tm-lambda-other-state': ['lambda', { tags_state: 'partial' }],
    'tm-load-balancer-observed': ['load-balancer', { tags_state: 'observed' }],
    'tm-elb-observed': ['elb', { tags_state: 'observed' }],
    'tm-s3-unavailable': ['s3', { tags_state: 'unavailable' }],
  };

  beforeAll(async () => {
    orgId = await insertOrg();
    viewer = await member(orgId);
    for (const [name, [type, metadata]] of Object.entries(MATRIX)) {
      await insertResource(orgId, name, { type, status: 'unknown', tags: { Team: 'ops' }, metadata });
    }
  });

  it('a row with no tags_state is Unknown unless its type reads tags inline (EC2, EBS, RDS)', async () => {
    const { body } = await get(viewer, orgId, '/services?ownership=unknown&limit=100');
    expect(sorted(names(body))).toEqual([
      'tm-dynamodb-legacy', 'tm-ec2-unavailable', 'tm-elb-legacy', 'tm-lambda-other-state',
      'tm-load-balancer-legacy', 'tm-s3-unavailable', 'tm-sqs-legacy',
    ]);
  });

  it('agrees with tagsObserved on every row', async () => {
    const { body } = await get(viewer, orgId, '/services?limit=100');
    expect(body.services).toHaveLength(Object.keys(MATRIX).length);
    for (const row of body.services) {
      const [type, metadata] = MATRIX[row.name];
      expect([row.name, row.ownership === 'unknown']).toEqual([row.name, !tagsObserved({ resource_type: type, metadata } as any)]);
    }
  });
});

describe('attention_cause comes from the causes of needs attention', () => {
  let orgId: string;
  let viewer: string;

  beforeAll(async () => {
    orgId = await insertOrg();
    viewer = await member(orgId);
    // Stopped, with a MEDIUM cost recommendation: the recommendation is below the
    // floor and is the reason shown (as bad as the status); the status is the cause.
    const mediumId = await insertResource(orgId, 'ac-stopped-medium-cost', { status: 'stopped' });
    await insertCostRecommendation(orgId, mediumId, 'MEDIUM');
    // Stopped, with a HIGH cost recommendation: both are causes; the reason is the recommendation.
    const highId = await insertResource(orgId, 'ac-stopped-high-cost', { status: 'stopped' });
    await insertCostRecommendation(orgId, highId, 'HIGH');
    // Running, with only a MEDIUM cost recommendation: no attention, no cause.
    const runningId = await insertResource(orgId, 'ac-running-medium-cost');
    await insertCostRecommendation(orgId, runningId, 'MEDIUM');
  });

  it('a stopped instance with a MEDIUM cost recommendation: status, not cost_recommendation', async () => {
    const { body } = await get(viewer, orgId, '/services?limit=100');
    const rows = Object.fromEntries(body.services.map((s: any) => [s.name, s]));
    expect(rows['ac-stopped-medium-cost']).toMatchObject({ needs_attention: true, reason: 'Idle Instance', attention_cause: 'status' });
    expect(rows['ac-stopped-high-cost']).toMatchObject({ needs_attention: true, reason: 'Idle Instance', attention_cause: 'cost_recommendation' });
    expect(rows['ac-running-medium-cost']).toMatchObject({ needs_attention: false, attention_cause: null });
  });
});

describe('/stats teams: ties are deterministic', () => {
  let orgId: string;
  let viewer: string;

  beforeAll(async () => {
    orgId = await insertOrg();
    viewer = await member(orgId);
    // ops twice, one of each casing: a casing tie. Zed and apple once each: a count
    // tie that byte order of the raw value ("Z" < "a") would get backwards.
    for (const [name, team] of [['tt-1', 'ops'], ['tt-2', 'Ops'], ['tt-3', 'Zed'], ['tt-4', 'apple']]) {
      await insertResource(orgId, name, { tags: { Team: team } });
    }
  });

  it('count first; a count tie by the lowercased value; a casing tie by byte order', async () => {
    for (let i = 0; i < 3; i++) {
      const { stats } = (await get(viewer, orgId, '/services/stats')).body;
      expect(stats.teams.all).toEqual([
        { team: 'Ops', count: 2 },
        { team: 'apple', count: 1 },
        { team: 'Zed', count: 1 },
      ]);
    }
  });
});
