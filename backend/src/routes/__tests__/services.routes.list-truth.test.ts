/**
 * What GET /api/services says about each resource, and when it answers.
 *
 *   - A resource with no environment tag is untagged: environment is null,
 *     never a default 'production'.
 *   - Environment, owner and team tags are read whatever the case of the key
 *     (AWS convention is Environment / Owner / Team).
 *   - ?env=untagged lists the untagged resources; ?env=production lists only
 *     resources tagged production.
 *   - ?type=ebs lists EBS volumes.
 *   - ?search= is a case-insensitive substring match in which %, _ and \
 *     are literal characters, not LIKE wildcards or escapes.
 *   - The list is never refused by the services plan limit: that limit counts
 *     the services registry, not the resources the list returns.
 *
 * Real routes over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken (to choose the caller) is stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import servicesRoutes from '../services.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { pool as appPool } from '../../config/database';

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

async function insertOrg(tier: string): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, $3, 'active') RETURNING id`,
    [`Services List Truth ${suffix}`, `services-list-truth-${suffix}`, tier]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string, role: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Services List Truth User') RETURNING id`,
    [`services-list-truth-${role}-${uniqueSuffix()}@example.com`]
  );
  const userId = rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );
  return userId;
}

async function insertResource(
  orgId: string,
  name: string,
  opts: { type?: string; status?: string; tags?: Record<string, string>; metadata?: Record<string, string> } = {}
): Promise<void> {
  const type = opts.type ?? 'ec2';
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata)
     VALUES ($1, $2, $3, $3, $4, 'us-east-1', $5, $6, $7)`,
    [
      orgId,
      `arn:aws:${type}:us-east-1:123456789012:resource/${name}`,
      name,
      type,
      opts.status ?? 'running',
      JSON.stringify(opts.tags ?? {}),
      JSON.stringify(opts.metadata ?? {}),
    ]
  );
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
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
});

async function get(userId: string, orgId: string, path: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'services-list-truth-caller@example.com',
    organizationId: orgId,
    role: 'viewer',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer test-token' } });
  return { status: res.status, body: (await res.json()) as any };
}

function byName(services: any[]): Record<string, any> {
  return Object.fromEntries(services.map((s) => [s.name, s]));
}

describe('GET /api/services -- environment, owner and team tags', () => {
  let orgId: string;
  let viewer: string;

  beforeAll(async () => {
    orgId = await insertOrg('enterprise');
    viewer = await member(orgId, 'viewer');
    await insertResource(orgId, 'lt-untagged');
    await insertResource(orgId, 'lt-blank-tag', { tags: { Environment: '  ' } });
    await insertResource(orgId, 'lt-capitalised', { tags: { Environment: 'Production', Owner: 'owner-a', Team: 'team-a' } });
    await insertResource(orgId, 'lt-lowercase', { tags: { environment: 'staging', owner: 'owner-b', team: 'team-b' } });
    await insertResource(orgId, 'lt-uppercase', { tags: { ENVIRONMENT: 'production', OWNER: 'owner-c', TEAM: 'team-c' } });
    await insertResource(orgId, 'lt-metadata-env', { metadata: { environment: 'dev' } });
    await insertResource(orgId, 'lt-blank-duplicate', { tags: { Environment: 'staging', environment: ' ' } });
    await insertResource(orgId, 'lt-volume', { type: 'ebs', status: 'in-use' });
  });

  it('an untagged resource has no environment, not production', async () => {
    const { status, body } = await get(viewer, orgId, '/services');
    expect(status).toBe(200);
    const rows = byName(body.services);
    expect(rows['lt-untagged'].environment).toBeNull();
    expect(rows['lt-blank-tag'].environment).toBeNull();
    expect(rows['lt-volume'].environment).toBeNull();
    expect(body.services.filter((s: any) => s.environment === 'production')).toHaveLength(1);
  });

  it('reads Environment, environment and ENVIRONMENT keys alike, then falls back to metadata', async () => {
    const rows = byName((await get(viewer, orgId, '/services')).body.services);
    expect(rows['lt-capitalised'].environment).toBe('Production');
    expect(rows['lt-lowercase'].environment).toBe('staging');
    expect(rows['lt-uppercase'].environment).toBe('production');
    expect(rows['lt-metadata-env'].environment).toBe('dev');
    // A blank tag under another case of the key does not hide the real one.
    expect(rows['lt-blank-duplicate'].environment).toBe('staging');
  });

  it('reads owner and team whatever the case of the key', async () => {
    const rows = byName((await get(viewer, orgId, '/services')).body.services);
    expect([rows['lt-capitalised'].owner, rows['lt-capitalised'].team]).toEqual(['owner-a', 'team-a']);
    expect([rows['lt-lowercase'].owner, rows['lt-lowercase'].team]).toEqual(['owner-b', 'team-b']);
    expect([rows['lt-uppercase'].owner, rows['lt-uppercase'].team]).toEqual(['owner-c', 'team-c']);
    expect([rows['lt-untagged'].owner, rows['lt-untagged'].team]).toEqual([null, null]);
  });

  it('?env=untagged lists only the untagged resources', async () => {
    const { body } = await get(viewer, orgId, '/services?env=untagged');
    expect(body.services.map((s: any) => s.name).sort()).toEqual(['lt-blank-tag', 'lt-untagged', 'lt-volume']);
  });

  it('?env=production lists only resources tagged production, in any key or value case', async () => {
    const { body } = await get(viewer, orgId, '/services?env=production');
    expect(body.services.map((s: any) => s.name).sort()).toEqual(['lt-capitalised', 'lt-uppercase']);
  });

  it('?type=ebs lists EBS volumes', async () => {
    const { body } = await get(viewer, orgId, '/services?type=ebs');
    expect(body.services.map((s: any) => s.name)).toEqual(['lt-volume']);
  });
});

describe('GET /api/services -- repeated or bracketed query parameters', () => {
  let orgId: string;
  let viewer: string;

  beforeAll(async () => {
    orgId = await insertOrg('enterprise');
    viewer = await member(orgId, 'viewer');
    await insertResource(orgId, 'rq-prod', { tags: { Environment: 'production' } });
    await insertResource(orgId, 'rq-staging', { tags: { Environment: 'staging' } });
    await insertResource(orgId, 'rq-volume', { type: 'ebs', status: 'in-use' });
  });

  const names = (body: any) => body.services.map((s: any) => s.name).sort();

  it('?env=a&env=b uses the first value', async () => {
    const { status, body } = await get(viewer, orgId, '/services?env=production&env=staging');
    expect(status).toBe(200);
    expect(names(body)).toEqual(['rq-prod']);
  });

  it('?type=a&type=b uses the first value', async () => {
    const { status, body } = await get(viewer, orgId, '/services?type=ebs&type=ec2');
    expect(status).toBe(200);
    expect(names(body)).toEqual(['rq-volume']);
  });

  it('?search=a&search=b uses the first value', async () => {
    const { status, body } = await get(viewer, orgId, '/services?search=staging&search=prod');
    expect(status).toBe(200);
    expect(names(body)).toEqual(['rq-staging']);
  });

  it('a bracketed parameter is no filter, not an error', async () => {
    const { status, body } = await get(viewer, orgId, '/services?env[x]=production&type[y]=ebs');
    expect(status).toBe(200);
    expect(names(body)).toEqual(['rq-prod', 'rq-staging', 'rq-volume']);
  });
});

describe('GET /api/services -- search matches %, _ and \\ literally', () => {
  let orgId: string;
  let viewer: string;

  beforeAll(async () => {
    orgId = await insertOrg('enterprise');
    viewer = await member(orgId, 'viewer');
    for (const name of ['sr_a_b', 'sr-a-b', 'srXaXb', 'sr-rate-100%', 'sr-back\\slash']) {
      await insertResource(orgId, name);
    }
    // Another organization's names match every search below.
    const otherOrgId = await insertOrg('enterprise');
    for (const name of ['sr_foreign_a_b', 'sr-foreign-100%', 'sr-foreign\\b']) {
      await insertResource(otherOrgId, name);
    }
  });

  const search = async (term: string) => {
    const { status, body } = await get(viewer, orgId, `/services?search=${encodeURIComponent(term)}`);
    expect(status).toBe(200);
    return body.services.map((s: any) => s.name).sort();
  };

  it('"_" matches only names containing an underscore', async () => {
    expect(await search('_')).toEqual(['sr_a_b']);
    expect(await search('a_b')).toEqual(['sr_a_b']);
  });

  it('"%" matches only names containing a percent sign', async () => {
    expect(await search('%')).toEqual(['sr-rate-100%']);
    expect(await search('100%')).toEqual(['sr-rate-100%']);
  });

  it('"\\" matches only names containing a backslash', async () => {
    expect(await search('\\')).toEqual(['sr-back\\slash']);
    expect(await search('back\\s')).toEqual(['sr-back\\slash']);
  });

  it('plain text still matches as a substring, in any case', async () => {
    expect(await search('A-B')).toEqual(['sr-a-b']);
    expect(await search('sr')).toEqual(['sr-a-b', 'sr-back\\slash', 'sr-rate-100%', 'srXaXb', 'sr_a_b']);
  });
});

describe('GET /api/services -- not refused by the services plan limit', () => {
  it('answers a free organization whose registry is over its services limit', async () => {
    const orgId = await insertOrg('free');
    const viewer = await member(orgId, 'viewer');
    await insertResource(orgId, 'lt-free-resource');
    // A limit of 2 with 3 registry services: over the limit however the
    // tier default is resolved.
    await pool.query('UPDATE organizations SET max_services = 2 WHERE id = $1', [orgId]);
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `INSERT INTO services (name, template, owner, status, organization_id)
         VALUES ($1, 'api', 'owner@example.com', 'active', $2)`,
        [`lt-registry-${i}-${uniqueSuffix()}`, orgId]
      );
    }

    const list = await get(viewer, orgId, '/services');
    expect(list.status).toBe(200);
    expect(list.body.services.map((s: any) => s.name)).toEqual(['lt-free-resource']);

    const stats = await get(viewer, orgId, '/services/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.stats.total).toBe(1);
  });
});
