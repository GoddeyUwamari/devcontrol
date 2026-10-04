/**
 * SSO / SAML authorization hardening (PR #140).
 *
 * Drives the real /api/auth/saml routes over HTTP against live Postgres with
 * genuinely signed SAML Responses: a throwaway RSA key + self-signed cert is
 * generated per run (openssl), responses are built here and signed with
 * node-saml's own signing helper (assertion first, then the enveloping
 * Response), and node-saml validates them exactly as in production. Nothing
 * in the validation path is mocked; only authService.verifyToken is stubbed,
 * and only for the authenticated /config routes.
 *
 * sso_configurations lives in the non-canonical backend/migrations/012 and
 * is not part of the CI schema bootstrap, so it's created here (same DDL) if
 * absent and dropped afterwards. saml_request_ids comes from the canonical
 * database/migrations/202609281200_create_saml_request_ids.sql.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { signSamlPost } from '@node-saml/node-saml/lib/saml-post-signing';
import { createSAMLRoutes } from '../saml.routes';
import { samlService, samlCallbackUrl, SAML_CLOCK_SKEW_MS } from '../../services/saml.service';
import { authService } from '../../services/auth.service';

// The production limiters (10 SSO initiations / 15 min / IP) would throttle
// this suite, which drives dozens of logins from 127.0.0.1. Rate limiting is
// not what's under test; every other middleware and the whole validation
// path run unmodified.
jest.mock('../../middleware/rateLimiter', () => {
  const actual = jest.requireActual('../../middleware/rateLimiter');
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return { ...actual, samlInitiateRateLimiter: passThrough, authRateLimiter: passThrough };
});

// Each test signs XML with RSA and makes several HTTP + Postgres round trips;
// under full-suite parallel load that can exceed Jest's 5 s default (seen:
// the replay test timed out while its assertions pass in ~0.4 s alone).
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
let createdSsoTable = false;

const IDP_ENTITY_ID = 'https://idp.example.test/metadata';
const IDP_SSO_URL = 'https://idp.example.test/sso';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3010';

let idpKey: string;
let idpCert: string;
let rogueKey: string;
let tmpDir: string;

function makeKeyPair(dir: string, name: string): { key: string; cert: string } {
  const keyPath = path.join(dir, `${name}.key`);
  const certPath = path.join(dir, `${name}.crt`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '2',
    '-subj', `/CN=${name}.example.test`, '-keyout', keyPath, '-out', certPath,
  ], { stdio: 'ignore' });
  return { key: fs.readFileSync(keyPath, 'utf8'), cert: fs.readFileSync(certPath, 'utf8') };
}

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(tier = 'enterprise'): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, $4, 10, 50) RETURNING id`,
    [`SSO ${suffix}`, `sso-authz-${suffix}`, `SSO ${suffix}`, tier]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label = 'user'): Promise<{ id: string; email: string }> {
  const email = `sso-authz-${label}-${uniqueSuffix()}@example.com`;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'SSO Authz User') RETURNING id`,
    [email]
  );
  createdUserIds.push(rows[0].id);
  return { id: rows[0].id as string, email };
}

async function addMembership(
  orgId: string,
  userId: string,
  role: string,
  opts: { isActive?: boolean; invitationToken?: string | null } = {}
): Promise<void> {
  const pending = opts.invitationToken != null;
  await pool.query(
    `INSERT INTO organization_memberships
       (organization_id, user_id, role, joined_at, is_active, invitation_token, invitation_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      orgId,
      userId,
      role,
      pending ? null : new Date(),
      opts.isActive ?? true,
      opts.invitationToken ?? null,
      pending ? new Date(Date.now() + 86400000) : null,
    ]
  );
}

async function memberOf(orgId: string, role: string) {
  const user = await insertUser(role);
  await addMembership(orgId, user.id, role);
  return user;
}

async function configureSso(orgId: string, cert = idpCert, isActive = true): Promise<void> {
  await samlService.saveConfig(orgId, {
    providerName: 'Test IdP',
    idpEntityId: IDP_ENTITY_ID,
    idpSsoUrl: IDP_SSO_URL,
    idpCertificate: cert,
    isActive,
  });
}

/** An Enterprise org with active SSO and an active member of every role. */
async function ssoOrg() {
  const orgId = await insertOrg('enterprise');
  await configureSso(orgId);
  return {
    orgId,
    owner: await memberOf(orgId, 'owner'),
    admin: await memberOf(orgId, 'admin'),
    member: await memberOf(orgId, 'member'),
    viewer: await memberOf(orgId, 'viewer'),
  };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saml-authz-'));
  ({ key: idpKey, cert: idpCert } = makeKeyPair(tmpDir, 'idp'));
  ({ key: rogueKey } = makeKeyPair(tmpDir, 'rogue'));

  const { rows } = await pool.query("SELECT to_regclass('sso_configurations') AS t");
  if (!rows[0].t) {
    createdSsoTable = true;
    await pool.query(`
      CREATE TABLE sso_configurations (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        provider_name     VARCHAR(100) NOT NULL DEFAULT 'SAML IdP',
        idp_entity_id     TEXT NOT NULL,
        idp_sso_url       TEXT NOT NULL,
        idp_certificate   TEXT NOT NULL,
        sp_entity_id      TEXT NOT NULL,
        attribute_mapping JSONB NOT NULL DEFAULT '{"email":"email","name":"displayName"}',
        allowed_domains   JSONB NOT NULL DEFAULT '[]',
        is_active         BOOLEAN NOT NULL DEFAULT false,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (organization_id)
      )`);
  }

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/api/auth/saml', createSAMLRoutes());
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/auth/saml`;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM sessions WHERE user_id = ANY($1) OR organization_id = ANY($2)', [
    createdUserIds,
    createdOrgIds,
  ]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  // saml_request_ids and sso_configurations cascade from organizations.
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  if (createdSsoTable) await pool.query('DROP TABLE IF EXISTS sso_configurations');
  await pool.end();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── SAML protocol helpers ──────────────────────────────────────────────────

/** SP-initiated start: returns the AuthnRequest ID the service recorded. */
async function initiate(orgId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/initiate?orgId=${orgId}`, { redirect: 'manual' });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('location')!);
  expect(location.origin + location.pathname).toBe(IDP_SSO_URL);
  const xml = zlib.inflateRawSync(Buffer.from(location.searchParams.get('SAMLRequest')!, 'base64')).toString('utf8');
  const id = /\sID="([^"]+)"/.exec(xml)?.[1];
  expect(id).toBeTruthy();
  return id!;
}

interface ResponseOptions {
  email: string;
  inResponseTo?: string | null;
  /** SubjectConfirmationData InResponseTo; defaults to the Response's. */
  subjectInResponseTo?: string | null;
  destination?: string | null;
  recipient?: string;
  audience?: string;
  notOnOrAfterMs?: number;
  /** Conditions NotBefore offset from now; defaults to -60 s. */
  notBeforeMs?: number;
  signingKey?: string | null;
  extraAttributes?: Record<string, string>;
}

function buildResponse(orgId: string, opts: ResponseOptions): string {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const acs = samlCallbackUrl(orgId);
  const destination = opts.destination === undefined ? acs : opts.destination;
  const recipient = opts.recipient ?? acs;
  const audience = opts.audience ?? `${process.env.BACKEND_URL || 'http://localhost:8080'}/saml/${orgId}`;
  const notOnOrAfter = iso(now + (opts.notOnOrAfterMs ?? 5 * 60 * 1000));
  const inResponseTo = opts.inResponseTo ?? null;
  const irt = inResponseTo ? ` InResponseTo="${inResponseTo}"` : '';
  const subjectIrtValue = opts.subjectInResponseTo === undefined ? inResponseTo : opts.subjectInResponseTo;
  const subjectIrt = subjectIrtValue ? ` InResponseTo="${subjectIrtValue}"` : '';
  const notBefore = iso(now + (opts.notBeforeMs ?? -60 * 1000));
  const dest = destination ? ` Destination="${destination}"` : '';
  const attrs = { email: opts.email, ...(opts.extraAttributes ?? {}) };
  const attributeXml = Object.entries(attrs)
    .map(([k, v]) => `<saml:Attribute Name="${k}"><saml:AttributeValue>${v}</saml:AttributeValue></saml:Attribute>`)
    .join('');

  let xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"` +
    ` ID="_r${crypto.randomUUID()}" Version="2.0" IssueInstant="${iso(now)}"${dest}${irt}>` +
    `<saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<saml:Assertion ID="_a${crypto.randomUUID()}" Version="2.0" IssueInstant="${iso(now)}">` +
    `<saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.email}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${recipient}"${subjectIrt}/>` +
    `</saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
    `<saml:AudienceRestriction><saml:Audience>${audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="_s${crypto.randomUUID()}"><saml:AuthnContext>` +
    `<saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef>` +
    `</saml:AuthnContext></saml:AuthnStatement>` +
    `<saml:AttributeStatement>${attributeXml}</saml:AttributeStatement>` +
    `</saml:Assertion></samlp:Response>`;

  const key = opts.signingKey === undefined ? idpKey : opts.signingKey;
  if (key) {
    const signing = { privateKey: key, signatureAlgorithm: 'sha256' as const, digestAlgorithm: 'sha256' };
    xml = signSamlPost(xml, '/*[local-name(.)="Response"]/*[local-name(.)="Assertion"]', signing);
    xml = signSamlPost(
      xml,
      '/*[local-name(.)="Response" and namespace-uri(.)="urn:oasis:names:tc:SAML:2.0:protocol"]',
      signing
    );
  }
  return Buffer.from(xml, 'utf8').toString('base64');
}

interface CallbackResult {
  status: number;
  succeeded: boolean;
  location: URL;
  token?: jwt.JwtPayload;
}

async function postCallback(orgId: string, samlResponse: string, relayState?: string): Promise<CallbackResult> {
  const body = new URLSearchParams({ SAMLResponse: samlResponse });
  if (relayState) body.set('RelayState', relayState);
  const res = await fetch(`${baseUrl}/callback?orgId=${orgId}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const location = new URL(res.headers.get('location')!);
  const succeeded = location.pathname === '/auth/sso/callback';
  // Tokens are handed over in the fragment, never the query string.
  const raw = new URLSearchParams(location.hash.slice(1)).get('token');
  return {
    status: res.status,
    succeeded,
    location,
    token: raw ? (jwt.decode(raw) as jwt.JwtPayload) : undefined,
  };
}

function expectRejected(result: CallbackResult): void {
  expect(result.status).toBe(302);
  expect(result.succeeded).toBe(false);
  expect(result.location.pathname).toBe('/login');
  expect(result.location.searchParams.get('error')).toBe('sso_failed');
  expect(result.location.searchParams.get('token')).toBeNull();
  expect(result.location.searchParams.get('refreshToken')).toBeNull();
  expect(result.location.hash).toBe('');
}

async function sessionCount(userId: string): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM sessions WHERE user_id = $1', [userId]);
  return rows[0].n;
}

/**
 * Whether an issued request ID is still redeemable. The callback consumes it
 * only after the response has passed every protocol check (signature,
 * audience, timestamps, Destination, Recipient, InResponseTo), so "consumed"
 * proves a rejection happened later, at membership resolution; "still
 * outstanding" proves it happened earlier (config/tier/protocol).
 */
async function requestIdOutstanding(requestId: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT 1 FROM saml_request_ids WHERE request_id = $1', [requestId]);
  return rows.length === 1;
}

async function membershipRow(orgId: string, userId: string) {
  const { rows } = await pool.query(
    'SELECT role, is_active, invitation_token, joined_at FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return rows[0] ?? null;
}

// ─── Successful path ────────────────────────────────────────────────────────

describe('SAML callback -- valid SSO + active membership', () => {
  it.each(['owner', 'admin', 'member', 'viewer'] as const)(
    'an active %s signs in; token user/org/role come from the membership row',
    async (role) => {
      const org = await ssoOrg();
      const user = org[role];
      const requestId = await initiate(org.orgId);
      const result = await postCallback(org.orgId, buildResponse(org.orgId, { email: user.email, inResponseTo: requestId }));

      expect(result.succeeded).toBe(true);
      expect(result.token).toMatchObject({ userId: user.id, organizationId: org.orgId, role, type: 'access' });
      expect(result.location.origin).toBe(new URL(FRONTEND_URL).origin);
    }
  );

  it('hands the tokens over in the URL fragment, never in the query string', async () => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    const result = await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: requestId }));

    expect(result.status).toBe(302);
    expect(result.succeeded).toBe(true);
    // Nothing credential-bearing in the part of the URL a browser sends to a server.
    expect(result.location.search).toBe('');
    expect(result.location.searchParams.get('token')).toBeNull();
    expect(result.location.searchParams.get('refreshToken')).toBeNull();

    const fragment = new URLSearchParams(result.location.hash.slice(1));
    const access = jwt.decode(fragment.get('token')!) as jwt.JwtPayload;
    const refresh = jwt.decode(fragment.get('refreshToken')!) as jwt.JwtPayload;
    expect(access).toMatchObject({ userId: org.member.id, organizationId: org.orgId, type: 'access' });
    expect(refresh).toMatchObject({ userId: org.member.id, organizationId: org.orgId, type: 'refresh' });
    expect(fragment.get('orgId')).toBe(org.orgId);
  });

  it('asserted role/org attributes and RelayState cannot change the token', async () => {
    const org = await ssoOrg();
    const other = await ssoOrg();
    const requestId = await initiate(org.orgId);
    const response = buildResponse(org.orgId, {
      email: org.viewer.email,
      inResponseTo: requestId,
      extraAttributes: { role: 'owner', organizationId: other.orgId, orgId: other.orgId },
    });
    const result = await postCallback(org.orgId, response, other.orgId);

    expect(result.succeeded).toBe(true);
    expect(result.token).toMatchObject({ userId: org.viewer.id, organizationId: org.orgId, role: 'viewer' });
  });

  it('asserted email is matched case-insensitively against the stored (lowercase) email', async () => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    const result = await postCallback(
      org.orgId,
      buildResponse(org.orgId, { email: org.member.email.toUpperCase(), inResponseTo: requestId })
    );
    expect(result.succeeded).toBe(true);
    expect(result.token?.userId).toBe(org.member.id);
  });
});

// ─── Protocol: replay, InResponseTo, addressing, signature, audience, time ─

describe('SAML callback -- protocol validation', () => {
  it('a replayed response is rejected (request ID is single-use)', async () => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    const response = buildResponse(org.orgId, { email: org.member.email, inResponseTo: requestId });

    expect((await postCallback(org.orgId, response)).succeeded).toBe(true);
    const sessionsAfterFirst = await sessionCount(org.member.id);
    expectRejected(await postCallback(org.orgId, response));
    expect(await sessionCount(org.member.id)).toBe(sessionsAfterFirst);
  });

  it('two concurrent submissions of one response yield exactly one session', async () => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    const response = buildResponse(org.orgId, { email: org.member.email, inResponseTo: requestId });

    const results = await Promise.all([postCallback(org.orgId, response), postCallback(org.orgId, response)]);
    expect(results.filter((r) => r.succeeded)).toHaveLength(1);
    expect(await sessionCount(org.member.id)).toBe(1);
  });

  it('IdP-initiated SSO (no InResponseTo) is rejected by design', async () => {
    const org = await ssoOrg();
    expectRejected(await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: null })));
  });

  it('an InResponseTo this service never issued is rejected', async () => {
    const org = await ssoOrg();
    expectRejected(
      await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: '_never-issued' }))
    );
  });

  it('an expired request ID is rejected', async () => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    await pool.query("UPDATE saml_request_ids SET expires_at = NOW() - interval '1 second' WHERE request_id = $1", [
      requestId,
    ]);
    expectRejected(await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: requestId })));
  });

  it('a request ID issued for one org cannot be redeemed at another org (even with a shared IdP cert)', async () => {
    const orgA = await ssoOrg();
    const orgB = await ssoOrg(); // same IdP key/cert as orgA
    const user = await insertUser('both');
    await addMembership(orgB.orgId, user.id, 'member');
    const requestIdForA = await initiate(orgA.orgId);

    // Addressed to B in every respect except the request ID, which A issued.
    const result = await postCallback(orgB.orgId, buildResponse(orgB.orgId, { email: user.email, inResponseTo: requestIdForA }));
    expectRejected(result);
    // ...and A's request ID was not consumed by the failed attempt at B.
    const { rows } = await pool.query('SELECT 1 FROM saml_request_ids WHERE request_id = $1', [requestIdForA]);
    expect(rows).toHaveLength(1);
  });

  it('a response addressed to another org is rejected at this org\'s callback', async () => {
    const orgA = await ssoOrg();
    const orgB = await ssoOrg();
    const user = await insertUser('both');
    await addMembership(orgA.orgId, user.id, 'member');
    await addMembership(orgB.orgId, user.id, 'member');
    const requestIdForB = await initiate(orgB.orgId);
    // Built for A (A's audience/Destination/Recipient), posted to B.
    expectRejected(await postCallback(orgB.orgId, buildResponse(orgA.orgId, { email: user.email, inResponseTo: requestIdForB })));
  });

  it('Response and SubjectConfirmationData InResponseTo must name the same request', async () => {
    const org = await ssoOrg();
    // Both genuinely issued for this org, so each would pass on its own.
    const idA = await initiate(org.orgId);
    const idB = await initiate(org.orgId);

    expectRejected(
      await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: idA, subjectInResponseTo: idB }))
    );
    expectRejected(
      await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: idB, subjectInResponseTo: idA }))
    );
    expect(await sessionCount(org.member.id)).toBe(0);
    // Neither mismatched attempt redeemed either request...
    expect(await requestIdOutstanding(idA)).toBe(true);
    expect(await requestIdOutstanding(idB)).toBe(true);
    // ...and a consistent response still completes the real login.
    const genuine = await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: idA }));
    expect(genuine.succeeded).toBe(true);
    expect(await requestIdOutstanding(idA)).toBe(false);
  });

  it('an issued ID in SubjectConfirmationData cannot rescue an unissued or missing Response InResponseTo', async () => {
    const org = await ssoOrg();
    const issued = await initiate(org.orgId);

    expectRejected(
      await postCallback(
        org.orgId,
        buildResponse(org.orgId, { email: org.member.email, inResponseTo: '_never-issued', subjectInResponseTo: issued })
      )
    );
    expectRejected(
      await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: null, subjectInResponseTo: issued }))
    );
    expect(await sessionCount(org.member.id)).toBe(0);
    expect(await requestIdOutstanding(issued)).toBe(true);
  });

  it.each([
    ['wrong Destination', { destination: 'https://evil.example.test/acs' }],
    ['missing Destination', { destination: null }],
    ['wrong Recipient', { recipient: 'https://evil.example.test/acs' }],
    ['wrong audience', { audience: 'https://evil.example.test/sp' }],
    ['expired assertion (beyond clock-skew tolerance)', { notBeforeMs: -5 * 60 * 1000, notOnOrAfterMs: -2 * 60 * 1000 }],
    ['signed by an untrusted key', { signingKey: 'ROGUE' }],
    ['unsigned', { signingKey: null }],
  ] as const)('%s is rejected and the request ID stays redeemable', async (_label, override) => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    const opts: ResponseOptions = { email: org.member.email, inResponseTo: requestId, ...override } as ResponseOptions;
    if ((override as any).signingKey === 'ROGUE') opts.signingKey = rogueKey;

    expectRejected(await postCallback(org.orgId, buildResponse(org.orgId, opts)));
    expect(await sessionCount(org.member.id)).toBe(0);

    // A forged/misaddressed response must not burn the user's real login.
    const genuine = await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: requestId }));
    expect(genuine.succeeded).toBe(true);
  });

  it('a missing SAMLResponse is rejected', async () => {
    const org = await ssoOrg();
    const res = await fetch(`${baseUrl}/callback?orgId=${org.orgId}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });
});

// ─── Configuration / tier gating ────────────────────────────────────────────
//
// These are refused BEFORE protocol validation (requireUsableConfig), so an
// in-flight login's request ID must still be outstanding afterwards.

describe('SAML -- configuration and Enterprise gating', () => {
  it('missing SSO configuration: initiate and callback are rejected', async () => {
    const orgId = await insertOrg('enterprise');
    const user = await memberOf(orgId, 'owner');
    const init = await fetch(`${baseUrl}/initiate?orgId=${orgId}`, { redirect: 'manual' });
    expect(new URL(init.headers.get('location')!).pathname).toBe('/login');
    expectRejected(await postCallback(orgId, buildResponse(orgId, { email: user.email, inResponseTo: '_x' })));
    expect(await sessionCount(user.id)).toBe(0);
  });

  it('inactive configuration: initiate is refused, and an in-flight login is rejected', async () => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    await pool.query('UPDATE sso_configurations SET is_active = false WHERE organization_id = $1', [org.orgId]);

    const init = await fetch(`${baseUrl}/initiate?orgId=${org.orgId}`, { redirect: 'manual' });
    expect(new URL(init.headers.get('location')!).pathname).toBe('/login');
    expectRejected(await postCallback(org.orgId, buildResponse(org.orgId, { email: org.owner.email, inResponseTo: requestId })));
    expect(await requestIdOutstanding(requestId)).toBe(true);
    expect(await sessionCount(org.owner.id)).toBe(0);
  });

  it('downgraded from Enterprise: initiate is refused, and an in-flight login is rejected', async () => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    await pool.query("UPDATE organizations SET subscription_tier = 'pro' WHERE id = $1", [org.orgId]);

    const init = await fetch(`${baseUrl}/initiate?orgId=${org.orgId}`, { redirect: 'manual' });
    expect(new URL(init.headers.get('location')!).pathname).toBe('/login');
    expectRejected(await postCallback(org.orgId, buildResponse(org.orgId, { email: org.owner.email, inResponseTo: requestId })));
    expect(await requestIdOutstanding(requestId)).toBe(true);
    expect(await sessionCount(org.owner.id)).toBe(0);
  });

  it('soft-deleted organization: initiate is refused and an in-flight login is rejected, until restored', async () => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    await pool.query('UPDATE organizations SET deleted_at = NOW() WHERE id = $1', [org.orgId]);

    const init = await fetch(`${baseUrl}/initiate?orgId=${org.orgId}`, { redirect: 'manual' });
    expect(new URL(init.headers.get('location')!).pathname).toBe('/login');
    const response = buildResponse(org.orgId, { email: org.owner.email, inResponseTo: requestId });
    expectRejected(await postCallback(org.orgId, response));
    expect(await requestIdOutstanding(requestId)).toBe(true);
    expect(await sessionCount(org.owner.id)).toBe(0);

    // Positive control: the org's deleted state was the only obstacle.
    await pool.query('UPDATE organizations SET deleted_at = NULL WHERE id = $1', [org.orgId]);
    const restored = await postCallback(org.orgId, response);
    expect(restored.succeeded).toBe(true);
    expect(restored.token).toMatchObject({ userId: org.owner.id, organizationId: org.orgId, role: 'owner' });
  });

  it('malformed orgId is rejected', async () => {
    const init = await fetch(`${baseUrl}/initiate?orgId=not-a-uuid`, { redirect: 'manual' });
    expect(new URL(init.headers.get('location')!).pathname).toBe('/login');
  });
});

// ─── Clock-skew tolerance ───────────────────────────────────────────────────
//
// node-saml applies acceptedClockSkewMs to NotBefore/NotOnOrAfter only:
//   rejected if now + skew <  NotBefore
//   rejected if now - skew >= NotOnOrAfter
// Offsets are half and one-and-a-half times the tolerance, so test runtime
// (milliseconds) can't move a case across the boundary.

describe('SAML callback -- clock-skew tolerance', () => {
  it('is 60 seconds', () => {
    expect(SAML_CLOCK_SKEW_MS).toBe(60 * 1000);
  });

  const within = SAML_CLOCK_SKEW_MS / 2;
  const beyond = (SAML_CLOCK_SKEW_MS * 3) / 2;

  it.each([
    ['NotBefore in the future, within tolerance (IdP clock ahead)', { notBeforeMs: within }, true],
    ['NotBefore in the future, beyond tolerance', { notBeforeMs: beyond }, false],
    ['NotOnOrAfter in the past, within tolerance (IdP clock behind)', { notBeforeMs: -5 * 60 * 1000, notOnOrAfterMs: -within }, true],
    ['NotOnOrAfter in the past, beyond tolerance', { notBeforeMs: -5 * 60 * 1000, notOnOrAfterMs: -beyond }, false],
  ] as const)('%s', async (_label, timing, accepted) => {
    const org = await ssoOrg();
    const requestId = await initiate(org.orgId);
    const result = await postCallback(
      org.orgId,
      buildResponse(org.orgId, { email: org.member.email, inResponseTo: requestId, ...timing })
    );

    if (accepted) {
      expect(result.succeeded).toBe(true);
      expect(result.token).toMatchObject({ userId: org.member.id, organizationId: org.orgId, role: 'member' });
      expect(await requestIdOutstanding(requestId)).toBe(false);
    } else {
      expectRejected(result);
      expect(await sessionCount(org.member.id)).toBe(0);
      // Rejected during protocol validation: the login wasn't redeemed.
      expect(await requestIdOutstanding(requestId)).toBe(true);
    }
  });
});

// ─── Membership / account-linking ──────────────────────────────────────────
//
// Each rejection below is pinned to membership resolution by two
// behavioral facts, not by log output:
//   1. the request ID was CONSUMED -- the callback redeems it only after the
//      response passed every protocol check, so the rejection came later;
//   2. a positive control -- correcting exactly the one membership-state
//      defect under test makes the same flow succeed, with the role from
//      THIS org's membership row.
// Together these rule out an unrelated failure (the pre-PR JIT path, for
// instance, rejected several of these only because its user INSERT violated
// users.password_hash NOT NULL -- and never consumed anything). Each also
// asserts the intended state outcome: nothing created, activated, or linked.

describe('SAML callback -- membership is required, never manufactured', () => {
  async function attempt(orgId: string, email: string): Promise<{ result: CallbackResult; requestId: string }> {
    const requestId = await initiate(orgId);
    const result = await postCallback(orgId, buildResponse(orgId, { email, inResponseTo: requestId }));
    return { result, requestId };
  }

  /** Rejected, with no token, AFTER full protocol validation. */
  async function expectRejectedAtMembership(orgId: string, email: string): Promise<void> {
    const requestId = await initiate(orgId);
    // Outstanding before, consumed after -- never vacuously "not there".
    expect(await requestIdOutstanding(requestId)).toBe(true);
    const result = await postCallback(orgId, buildResponse(orgId, { email, inResponseTo: requestId }));
    expectRejected(result);
    expect(await requestIdOutstanding(requestId)).toBe(false);
  }

  async function expectSignsInAs(orgId: string, email: string, userId: string, role: string): Promise<void> {
    const { result } = await attempt(orgId, email);
    expect(result.succeeded).toBe(true);
    expect(result.token).toMatchObject({ userId, organizationId: orgId, role });
  }

  async function userRow(userId: string) {
    const { rows } = await pool.query(
      'SELECT email, is_active, deleted_at, last_login_at FROM users WHERE id = $1',
      [userId]
    );
    return rows[0];
  }

  it('unknown email: rejected, no user or membership is created; an invited-and-accepted account then signs in', async () => {
    const org = await ssoOrg();
    const email = `sso-authz-nobody-${uniqueSuffix()}@example.com`;
    await expectRejectedAtMembership(org.orgId, email);
    const { rows } = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
    expect(rows).toHaveLength(0);

    // Positive control: the only missing piece was an account with an active membership.
    const { rows: created } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Later') RETURNING id`,
      [email]
    );
    createdUserIds.push(created[0].id);
    await addMembership(org.orgId, created[0].id, 'viewer');
    await expectSignsInAs(org.orgId, email, created[0].id, 'viewer');
  });

  it.each(['owner', 'admin'] as const)(
    'the email of another org\'s %s grants nothing here: no membership, no session, account untouched',
    async (role) => {
      const org = await ssoOrg();
      const elsewhere = await ssoOrg();
      const victim = elsewhere[role];
      const before = await userRow(victim.id);

      await expectRejectedAtMembership(org.orgId, victim.email);
      expect(await membershipRow(org.orgId, victim.id)).toBeNull();
      expect(await sessionCount(victim.id)).toBe(0);
      expect(await userRow(victim.id)).toEqual(before);
      expect((await membershipRow(elsewhere.orgId, victim.id)).role).toBe(role);

      // Positive control: once they genuinely belong here (as a viewer), SSO
      // signs them in with THIS org's role -- never their role elsewhere.
      await addMembership(org.orgId, victim.id, 'viewer');
      await expectSignsInAs(org.orgId, victim.email, victim.id, 'viewer');
    }
  );

  it('an inactive (deactivated) membership is rejected and NOT reactivated', async () => {
    const org = await ssoOrg();
    const user = await insertUser('inactive');
    await addMembership(org.orgId, user.id, 'admin', { isActive: false });

    await expectRejectedAtMembership(org.orgId, user.email);
    const row = await membershipRow(org.orgId, user.id);
    expect(row.is_active).toBe(false);
    expect(row.role).toBe('admin');
    expect(await sessionCount(user.id)).toBe(0);

    // Positive control: reactivation (by an owner/admin, not by SSO) is the only obstacle.
    await pool.query(
      'UPDATE organization_memberships SET is_active = true WHERE organization_id = $1 AND user_id = $2',
      [org.orgId, user.id]
    );
    await expectSignsInAs(org.orgId, user.email, user.id, 'admin');
  });

  it.each([
    ['stored inactive (current invite path)', false],
    ['legacy row stored active', true],
  ])('a pending invitation (%s) is not accepted by SSO and stays pending', async (_label, isActive) => {
    const org = await ssoOrg();
    const user = await insertUser('pending');
    const invitationToken = `tok-${uniqueSuffix()}`;
    await addMembership(org.orgId, user.id, 'admin', { isActive, invitationToken });

    await expectRejectedAtMembership(org.orgId, user.email);
    const row = await membershipRow(org.orgId, user.id);
    expect(row.is_active).toBe(isActive);
    expect(row.invitation_token).toBe(invitationToken);
    expect(row.joined_at).toBeNull();
    expect(await sessionCount(user.id)).toBe(0);

    // Positive control: the state acceptInvitation() produces (token cleared,
    // joined, active) is what SSO requires.
    await pool.query(
      `UPDATE organization_memberships
       SET invitation_token = NULL, invitation_expires_at = NULL, joined_at = NOW(), is_active = true
       WHERE organization_id = $1 AND user_id = $2`,
      [org.orgId, user.id]
    );
    await expectSignsInAs(org.orgId, user.email, user.id, 'admin');
  });

  it('a deactivated user account is rejected and stays deactivated', async () => {
    const org = await ssoOrg();
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [org.member.id]);

    await expectRejectedAtMembership(org.orgId, org.member.email);
    expect((await userRow(org.member.id)).is_active).toBe(false);
    expect(await sessionCount(org.member.id)).toBe(0);

    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [org.member.id]);
    await expectSignsInAs(org.orgId, org.member.email, org.member.id, 'member');
  });

  it('a deleted user account is rejected and stays deleted', async () => {
    const org = await ssoOrg();
    await pool.query('UPDATE users SET deleted_at = NOW() WHERE id = $1', [org.member.id]);

    await expectRejectedAtMembership(org.orgId, org.member.email);
    expect((await userRow(org.member.id)).deleted_at).not.toBeNull();
    expect(await sessionCount(org.member.id)).toBe(0);

    await pool.query('UPDATE users SET deleted_at = NULL WHERE id = $1', [org.member.id]);
    await expectSignsInAs(org.orgId, org.member.email, org.member.id, 'member');
  });

  it('an inactive organization is rejected at membership resolution', async () => {
    const org = await ssoOrg();
    await pool.query('UPDATE organizations SET is_active = false WHERE id = $1', [org.orgId]);

    await expectRejectedAtMembership(org.orgId, org.owner.email);
    expect(await sessionCount(org.owner.id)).toBe(0);

    await pool.query('UPDATE organizations SET is_active = true WHERE id = $1', [org.orgId]);
    await expectSignsInAs(org.orgId, org.owner.email, org.owner.id, 'owner');
  });

  it('a membership with an invalid stored role is rejected, and the role is not rewritten', async () => {
    const org = await ssoOrg();
    await pool.query(
      "UPDATE organization_memberships SET role = 'superuser' WHERE organization_id = $1 AND user_id = $2",
      [org.orgId, org.member.id]
    );

    await expectRejectedAtMembership(org.orgId, org.member.email);
    expect((await membershipRow(org.orgId, org.member.id)).role).toBe('superuser');
    expect(await sessionCount(org.member.id)).toBe(0);

    await pool.query(
      "UPDATE organization_memberships SET role = 'member' WHERE organization_id = $1 AND user_id = $2",
      [org.orgId, org.member.id]
    );
    await expectSignsInAs(org.orgId, org.member.email, org.member.id, 'member');
  });

  it('every rejection redirects with the same generic message, naming no user or org', async () => {
    const org = await ssoOrg();
    const messages: (string | null)[] = [];
    const collect = (r: CallbackResult) => {
      expectRejected(r);
      messages.push(r.location.searchParams.get('message'));
    };

    // Non-member (membership stage).
    collect((await attempt(org.orgId, `sso-authz-nobody-${uniqueSuffix()}@example.com`)).result);
    // Replay (consume stage).
    const replayId = await initiate(org.orgId);
    const response = buildResponse(org.orgId, { email: org.member.email, inResponseTo: replayId });
    await postCallback(org.orgId, response);
    collect(await postCallback(org.orgId, response));
    // Bad signature (protocol stage).
    const sigId = await initiate(org.orgId);
    collect(await postCallback(org.orgId, buildResponse(org.orgId, { email: org.member.email, inResponseTo: sigId, signingKey: rogueKey })));
    // No SSO configuration (config stage).
    const bare = await insertOrg('enterprise');
    collect(await postCallback(bare, buildResponse(bare, { email: org.member.email, inResponseTo: '_x' })));
    // Missing orgId on the callback URL.
    const noOrg = await fetch(`${baseUrl}/callback`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ SAMLResponse: response }).toString(),
    });
    collect({ status: noOrg.status, succeeded: false, location: new URL(noOrg.headers.get('location')!) });

    expect(new Set(messages).size).toBe(1);
    const message = messages[0]!;
    expect(message).toBeTruthy();
    for (const leak of [org.orgId, bare, org.member.email, 'member', 'replay', 'signature', 'configured']) {
      expect(message.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });
});

// ─── Configuration mutations ───────────────────────────────────────────────

describe('/config mutations are owner-only', () => {
  function as(userId: string, orgId: string, jwtRole: string) {
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId,
      email: 'sso-authz-caller@example.com',
      organizationId: orgId,
      role: jwtRole,
      type: 'access',
    } as any);
    const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
    return {
      save: (body: Record<string, unknown>) =>
        fetch(`${baseUrl}/config`, { method: 'POST', headers, body: JSON.stringify(body) }),
      remove: () => fetch(`${baseUrl}/config`, { method: 'DELETE', headers }),
    };
  }

  const newConfig = () => ({
    providerName: 'Replacement IdP',
    idpEntityId: 'https://attacker-idp.example.test/metadata',
    idpSsoUrl: 'https://attacker-idp.example.test/sso',
    idpCertificate: idpCert,
    isActive: true,
  });

  async function storedEntityId(orgId: string): Promise<string | null> {
    const { rows } = await pool.query('SELECT idp_entity_id FROM sso_configurations WHERE organization_id = $1', [orgId]);
    return rows[0]?.idp_entity_id ?? null;
  }

  it('owner may create, update, and delete the configuration', async () => {
    const orgId = await insertOrg('enterprise');
    const owner = await memberOf(orgId, 'owner');
    expect((await as(owner.id, orgId, 'owner').save(newConfig())).status).toBe(200);
    expect(await storedEntityId(orgId)).toBe('https://attacker-idp.example.test/metadata');
    expect((await as(owner.id, orgId, 'owner').save({ ...newConfig(), idpEntityId: 'https://idp2.example.test' })).status).toBe(200);
    expect(await storedEntityId(orgId)).toBe('https://idp2.example.test');
    expect((await as(owner.id, orgId, 'owner').remove()).status).toBe(200);
    expect(await storedEntityId(orgId)).toBeNull();
  });

  it.each(['admin', 'member', 'viewer'] as const)(
    '%s cannot create, replace, or delete it -- even holding an owner claim',
    async (role) => {
      const org = await ssoOrg();
      const caller = org[role];
      for (const claim of [role, 'owner']) {
        expect((await as(caller.id, org.orgId, claim).save(newConfig())).status).toBe(403);
        expect((await as(caller.id, org.orgId, claim).remove()).status).toBe(403);
      }
      expect(await storedEntityId(org.orgId)).toBe(IDP_ENTITY_ID);
    }
  );

  it('an Enterprise org\'s member cannot create a configuration where none exists', async () => {
    const orgId = await insertOrg('enterprise');
    const user = await memberOf(orgId, 'member');
    expect((await as(user.id, orgId, 'owner').save(newConfig())).status).toBe(403);
    expect(await storedEntityId(orgId)).toBeNull();
  });

  it('a non-Enterprise owner is refused by the (pre-existing) tier gate', async () => {
    const orgId = await insertOrg('pro');
    const owner = await memberOf(orgId, 'owner');
    // requireEnterprise answers 402 TIER_REQUIRED, unchanged by this PR.
    expect((await as(owner.id, orgId, 'owner').save(newConfig())).status).toBe(402);
    expect(await storedEntityId(orgId)).toBeNull();
  });
});
