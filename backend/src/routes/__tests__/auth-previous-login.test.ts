/**
 * Previous sign-in time (Dashboard PR-UI-a, DB-D8; admin migration
 * 202611121200_add_users_previous_login_at).
 *
 * Drives the real /api/auth routes over HTTP against live Postgres: password
 * login, token refresh and GET /me, with the real authenticate middleware and
 * sessions. Only the rate limiters are passed through (this suite signs in
 * repeatedly from 127.0.0.1; limiting is not under test).
 *
 *   - a sign-in sets previous_login_at = the old last_login_at and
 *     last_login_at = NOW() in one UPDATE;
 *   - first-ever sign-in: previousLoginAt is null;
 *   - token refresh and a failed sign-in change neither column;
 *   - /me adds previousLoginAt and nothing else.
 *
 * The SAML path is covered in saml-sso-authorization.test.ts (real signed
 * responses), and a static sweep below proves no other code writes either
 * column. Synthetic users only.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { Pool } from 'pg';
import authRoutes from '../auth.routes';

jest.mock('../../middleware/rateLimiter', () => {
  const actual = jest.requireActual('../../middleware/rateLimiter');
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, authRateLimiter: passThrough };
});

jest.setTimeout(30000);

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
const PASSWORD = 'Sup3rSecret!1';
let passwordHash: string;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** An organization with one active member who can sign in with PASSWORD. */
async function member(): Promise<{ id: string; email: string; orgId: string }> {
  const suffix = uniqueSuffix();
  const { rows: org } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $1, 'pro', 10, 20) RETURNING id`,
    [`PrevLogin ${suffix}`, `prev-login-${suffix}`]
  );
  createdOrgIds.push(org[0].id);
  const email = `prev-login-${suffix}@example.com`;
  const { rows: user } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, 'Prev Login User') RETURNING id`,
    [email, passwordHash]
  );
  createdUserIds.push(user[0].id);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'member', NOW(), true)`,
    [org[0].id, user[0].id]
  );
  return { id: user[0].id, email, orgId: org[0].id };
}

/** Both columns as Postgres renders them (full microsecond precision), and their order. */
async function logins(userId: string): Promise<{ last: string | null; previous: string | null; ordered: boolean | null }> {
  const { rows } = await pool.query(
    `SELECT last_login_at::text AS last, previous_login_at::text AS previous,
            last_login_at > previous_login_at AS ordered
       FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0];
}

async function login(email: string, password = PASSWORD) {
  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function me(accessToken: string) {
  const res = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return { status: res.status, body: (await res.json()) as any };
}

async function refresh(refreshToken: string) {
  const res = await fetch(`${baseUrl}/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

/** The ISO string node-postgres + JSON produce for a stored timestamp (millisecond precision). */
async function iso(text: string): Promise<string> {
  const { rows } = await pool.query('SELECT $1::timestamptz AS t', [text]);
  return (rows[0].t as Date).toISOString();
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash(PASSWORD, 4);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/auth`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM sessions WHERE user_id = ANY($1) OR organization_id = ANY($2)', [
    createdUserIds,
    createdOrgIds,
  ]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

describe('password sign-in records the previous sign-in', () => {
  it('first-ever sign-in: previousLoginAt is null, lastLoginAt is this sign-in', async () => {
    const user = await member();
    expect(await logins(user.id)).toEqual({ last: null, previous: null, ordered: null });

    const first = await login(user.email);
    expect(first.status).toBe(200);

    const stored = await logins(user.id);
    expect(stored.last).not.toBeNull();
    expect(stored.previous).toBeNull();

    const current = await me(first.body.data.accessToken);
    expect(current.status).toBe(200);
    expect(current.body.data.previousLoginAt).toBeNull();
    expect(current.body.data.lastLoginAt).toBe(await iso(stored.last!));
  });

  it('second sign-in: previousLoginAt is exactly the first sign-in, lastLoginAt is later', async () => {
    const user = await member();
    await login(user.email);
    const afterFirst = await logins(user.id);

    const second = await login(user.email);
    expect(second.status).toBe(200);

    const afterSecond = await logins(user.id);
    expect(afterSecond.previous).toBe(afterFirst.last); // microsecond-exact copy of the old value
    expect(afterSecond.ordered).toBe(true);

    const current = await me(second.body.data.accessToken);
    expect(current.body.data.previousLoginAt).toBe(await iso(afterFirst.last!));
    expect(current.body.data.lastLoginAt).toBe(await iso(afterSecond.last!));
  });

  it('a user who signed in before this release: the first sign-in after it copies the stored last_login_at (no backfill needed)', async () => {
    const user = await member();
    await pool.query(`UPDATE users SET last_login_at = '2026-10-01T08:00:00.123456Z' WHERE id = $1`, [user.id]);

    const result = await login(user.email);
    expect(result.status).toBe(200);

    const { rows } = await pool.query(`SELECT (previous_login_at AT TIME ZONE 'UTC')::text AS previous FROM users WHERE id = $1`, [user.id]);
    expect(rows[0].previous).toBe('2026-10-01 08:00:00.123456'); // exact, in UTC
    expect((await me(result.body.data.accessToken)).body.data.previousLoginAt).toBe('2026-10-01T08:00:00.123Z');
  });

  it('a failed sign-in (wrong password) changes neither column', async () => {
    const user = await member();
    await login(user.email);
    await login(user.email);
    const before = await logins(user.id);

    const failed = await login(user.email, 'wrong-password');
    expect(failed.status).toBe(401);

    expect(await logins(user.id)).toEqual(before);
  });
});

describe('token refresh changes neither column', () => {
  it('refreshing (twice) leaves last_login_at and previous_login_at as they were; /me on the new token shows the same times', async () => {
    const user = await member();
    await login(user.email);
    const signedIn = await login(user.email);
    const before = await logins(user.id);
    expect(before.previous).not.toBeNull();

    const first = await refresh(signedIn.body.data.refreshToken);
    expect(first.status).toBe(200);
    const second = await refresh(first.body.data.refreshToken);
    expect(second.status).toBe(200);

    expect(await logins(user.id)).toEqual(before);
    const current = await me(second.body.data.accessToken);
    expect(current.body.data.previousLoginAt).toBe(await iso(before.previous!));
    expect(current.body.data.lastLoginAt).toBe(await iso(before.last!));
  });
});

describe('/me shape', () => {
  it('adds previousLoginAt and nothing else', async () => {
    const user = await member();
    await login(user.email);
    const signedIn = await login(user.email);

    const current = await me(signedIn.body.data.accessToken);
    expect(current.status).toBe(200);
    expect(Object.keys(current.body).sort()).toEqual(['data', 'success']);
    expect(Object.keys(current.body.data).sort()).toEqual(
      ['avatarUrl', 'createdAt', 'email', 'fullName', 'id', 'isEmailVerified', 'lastLoginAt', 'organizations', 'previousLoginAt'].sort()
    );
    expect(current.body.data.previousLoginAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
    expect(current.body.data.organizations.map((o: any) => o.id)).toEqual([user.orgId]);
  });

  it('the login response itself is unchanged (no previousLoginAt there)', async () => {
    const user = await member();
    const result = await login(user.email);
    expect(Object.keys(result.body.data.user).sort()).toEqual(['avatarUrl', 'email', 'fullName', 'id', 'isEmailVerified']);
    expect(JSON.stringify(result.body)).not.toMatch(/previous/i);
  });
});

// ─── Static: only the two sign-in UPDATEs write either column ───────────────

const SRC = path.join(__dirname, '../..');
const WRITE = /\b(?:last|previous)_login_at\s*=(?!=)/g;
const WRITES_ANY = new RegExp(WRITE.source);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|js)$/.test(entry.name) && !/\.test\.(ts|js)$/.test(entry.name) ? [full] : [];
  });
}

describe('only the password and SAML sign-ins write last_login_at / previous_login_at', () => {
  it('exactly two files write them, each once, as previous_login_at = last_login_at, last_login_at = NOW()', () => {
    const writers = sourceFiles(SRC)
      .map((file) => ({ file: path.relative(SRC, file), text: fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ') }))
      .filter(({ text }) => WRITES_ANY.test(text));
    expect(writers.map((w) => w.file).sort()).toEqual(['services/auth.service.ts', 'services/saml.service.ts']);
    for (const { text } of writers) {
      expect(text.match(WRITE)).toHaveLength(2);
      expect(text.split('previous_login_at = last_login_at, last_login_at = NOW()')).toHaveLength(2);
    }
  });

  it('the refresh path never names either column', () => {
    const service = fs.readFileSync(path.join(SRC, 'services/auth.service.ts'), 'utf8');
    const start = service.indexOf('async refreshAccessToken(');
    const end = service.indexOf('\n  }\n', start);
    expect(start).toBeGreaterThan(0);
    expect(service.slice(start, end)).not.toMatch(/login_at/);
  });
});
