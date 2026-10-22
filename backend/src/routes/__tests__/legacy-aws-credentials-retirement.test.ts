/**
 * POST /api/organizations/:id/aws-credentials is retired: every role in the
 * organization gets 410, nothing is stored, and no connection event is
 * recorded. A caller outside the organization still gets the org check's 404.
 * GET reports whether legacy credentials are stored without decrypting them;
 * DELETE still clears them. Nothing on the POST path -- the handler or any
 * middleware in front of it -- ever logs the request body.
 *
 * Real route, real authenticate middleware and real DB -- only the JWT
 * verification boundary (authService.verifyToken) is stubbed.
 */
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { inspect } from 'util';
import morgan from 'morgan';
import { Pool } from 'pg';
import organizationsRoutes from '../organizations.routes';
import { authService } from '../../services/auth.service';
import { sanitizerMiddleware } from '../../middleware/sanitizer';
import { requestLogger } from '../../middleware/request-logger';
import { metricsMiddleware } from '../../middleware/metrics';
import { errorHandler, notFoundHandler } from '../../middleware/error-handler';

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

type Role = 'owner' | 'admin' | 'member' | 'viewer';

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Legacy AWS Org ${suffix}`, `legacy-aws-org-${suffix}`, `Legacy AWS Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertMember(orgId: string, role: Role): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Legacy AWS User') RETURNING id`,
    [`legacy-aws-${suffix}@example.com`]
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

/** Authenticates the next requests as `userId` in `orgId`; the role comes from the membership row. */
function stubAuth(userId: string, orgId: string): void {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'legacy-aws@example.com',
    organizationId: orgId,
    role: 'owner',
    type: 'access',
  } as any);
}

async function orgRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT aws_credentials_encrypted, aws_region_default, updated_at FROM organizations WHERE id = $1`,
    [orgId]
  );
  return rows[0] as { aws_credentials_encrypted: string | null; aws_region_default: string | null; updated_at: Date };
}

async function connectionEvents(orgId: string) {
  const { rows } = await pool.query(
    `SELECT id FROM analytics_events WHERE organization_id = $1 AND event_name = 'aws_connection_completed'`,
    [orgId]
  );
  return rows;
}

async function onboardingAwsConnectedAt(orgId: string) {
  const { rows } = await pool.query(
    `SELECT aws_connected_at FROM onboarding_progress WHERE organization_id = $1`,
    [orgId]
  );
  return rows[0]?.aws_connected_at ?? null;
}

let server: http.Server;
let baseUrl: string;
let fullStackServer: http.Server;
let fullStackUrl: string;

async function listen(app: express.Express): Promise<{ server: http.Server; url: string }> {
  const listening = http.createServer(app);
  await new Promise<void>((resolve) => listening.listen(0, resolve));
  const address = listening.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server: listening, url: `http://127.0.0.1:${port}/api/organizations` };
}

/**
 * The global middleware server.ts runs on this path, in the same order (the
 * drift test below keeps the two in step). Left out: helmet and CORS (headers
 * only), the raw-body parsers (webhook paths only), the rate limiter (never
 * reads the body) and the /metrics route.
 */
function fullStackApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(sanitizerMiddleware);
  app.use(morgan('dev'));
  app.use(requestLogger);
  app.use(metricsMiddleware);
  app.use('/api/organizations', organizationsRoutes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/organizations', organizationsRoutes);
  ({ server, url: baseUrl } = await listen(app));
  ({ server: fullStackServer, url: fullStackUrl } = await listen(fullStackApp()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => fullStackServer.close(() => resolve()));
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const submitted = {
  accessKeyId: 'AKIARETIREDTESTKEY01',
  secretAccessKey: 'retired-endpoint-secret-sentinel',
  region: 'eu-west-1',
};

function postCredentials(orgId: string, body: string | undefined = JSON.stringify(submitted), auth = true) {
  return fetch(`${baseUrl}/${orgId}/aws-credentials`, {
    method: 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(auth ? { Authorization: 'Bearer test-token' } : {}),
    },
    body,
  });
}

/** A stored value that is not valid ciphertext: reading it must never try to decrypt it. */
const UNDECRYPTABLE = 'legacy-fixture-not-ciphertext';

async function storeLegacyValue(orgId: string): Promise<void> {
  await pool.query(
    `UPDATE organizations SET aws_credentials_encrypted = $1, aws_region_default = 'ap-south-1' WHERE id = $2`,
    [UNDECRYPTABLE, orgId]
  );
}

describe('POST /api/organizations/:id/aws-credentials -- retired', () => {
  it('owner: 410, nothing stored, the submitted keys are not echoed', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'owner'), orgId);
    const before = await orgRow(orgId);

    const response = await postCredentials(orgId);
    const text = await response.text();

    expect(response.status).toBe(410);
    expect(JSON.parse(text)).toMatchObject({ success: false });
    expect(text).not.toContain(submitted.accessKeyId);
    expect(text).not.toContain(submitted.secretAccessKey);
    expect(await orgRow(orgId)).toEqual(before);
    expect(before.aws_credentials_encrypted).toBeNull();
  });

  it('an existing stored value is left exactly as it was', async () => {
    const orgId = await insertOrg();
    await storeLegacyValue(orgId);
    stubAuth(await insertMember(orgId, 'owner'), orgId);
    const before = await orgRow(orgId);

    const response = await postCredentials(orgId);

    expect(response.status).toBe(410);
    expect(await orgRow(orgId)).toEqual(before);
    expect(before.aws_credentials_encrypted).toBe(UNDECRYPTABLE);
  });

  it('records no connection event and does not mark the onboarding step', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'owner'), orgId);

    expect((await postCredentials(orgId)).status).toBe(410);
    // Give any fire-and-forget listener time to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await connectionEvents(orgId)).toHaveLength(0);
    expect(await onboardingAwsConnectedAt(orgId)).toBeNull();
  });

  it.each(['admin', 'member', 'viewer'] as const)('%s: 410 and nothing stored', async (role) => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, role), orgId);
    const before = await orgRow(orgId);

    const response = await postCredentials(orgId);

    expect(response.status).toBe(410);
    expect(await orgRow(orgId)).toEqual(before);
  });

  it('a caller from another organization gets 404, and neither organization changes', async () => {
    const callerOrg = await insertOrg();
    const targetOrg = await insertOrg();
    stubAuth(await insertMember(callerOrg, 'owner'), callerOrg);
    const callerBefore = await orgRow(callerOrg);
    const targetBefore = await orgRow(targetOrg);

    const response = await postCredentials(targetOrg);

    expect(response.status).toBe(404);
    expect(await orgRow(callerOrg)).toEqual(callerBefore);
    expect(await orgRow(targetOrg)).toEqual(targetBefore);
  });

  it('unauthenticated: 401', async () => {
    const orgId = await insertOrg();
    expect((await postCredentials(orgId, JSON.stringify(submitted), false)).status).toBe(401);
  });

  it('no body: still 410', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'owner'), orgId);
    expect((await postCredentials(orgId, undefined)).status).toBe(410);
  });
});

describe('GET /api/organizations/:id/aws-credentials -- presence only', () => {
  it('reports a stored value without decrypting it', async () => {
    const orgId = await insertOrg();
    await storeLegacyValue(orgId);
    stubAuth(await insertMember(orgId, 'admin'), orgId);

    const response = await fetch(`${baseUrl}/${orgId}/aws-credentials`, {
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { hasCredentials: true, region: 'ap-south-1' },
    });
  });

  it('reports none when nothing is stored', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'admin'), orgId);

    const response = await fetch(`${baseUrl}/${orgId}/aws-credentials`, {
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { hasCredentials: false, region: null } });
  });
});

describe('DELETE /api/organizations/:id/aws-credentials -- still available', () => {
  it('the owner can clear a stored value', async () => {
    const orgId = await insertOrg();
    await storeLegacyValue(orgId);
    stubAuth(await insertMember(orgId, 'owner'), orgId);

    const response = await fetch(`${baseUrl}/${orgId}/aws-credentials`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.status).toBe(200);
    expect((await orgRow(orgId)).aws_credentials_encrypted).toBeNull();
  });
});

describe('POST /api/organizations/:id/aws-credentials -- the request body is never logged', () => {
  let consoleSpies: jest.SpyInstance[];
  let streamSpies: jest.SpyInstance[];

  beforeEach(() => {
    consoleSpies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    );
    streamSpies = [process.stdout, process.stderr].map((stream) =>
      jest.spyOn(stream, 'write').mockImplementation(() => true)
    );
  });

  /** Everything written by console or straight to stdout/stderr since the test began. */
  function capturedOutput(): string {
    return [...consoleSpies, ...streamSpies]
      .flatMap((s) => s.mock.calls)
      .flat()
      .map((arg) => `${String(arg)}\n${inspect(arg, { depth: 8, showHidden: true })}`)
      .join('\n');
  }

  function randomToken(length: number): string {
    let out = '';
    while (out.length < length) out += Math.random().toString(36).slice(2).toUpperCase();
    return out.slice(0, length);
  }

  function sentinels() {
    return {
      accessKeyId: `AKIA${randomToken(16)}`,
      secretAccessKey: `secret-${randomToken(24)}`,
      sessionToken: `session-${randomToken(24)}`,
    };
  }

  /** Posts to the full middleware stack and waits for the on-finish loggers. */
  async function post(
    orgId: string,
    body: string,
    contentType: string,
    auth = true
  ): Promise<{ status: number; text: string }> {
    const response = await fetch(`${fullStackUrl}/${orgId}/aws-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': contentType, ...(auth ? { Authorization: 'Bearer test-token' } : {}) },
      body,
    });
    const text = await response.text();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { status: response.status, text };
  }

  function expectNotLogged(values: Record<string, string>): void {
    const output = capturedOutput();
    // The capture works: a line naming this request (the request logger's, or
    // the error handler's when the body never parsed) is in it.
    expect(output).toMatch(/POST \S*aws-credentials/);
    for (const value of Object.values(values)) expect(output).not.toContain(value);
  }

  it.each(['owner', 'admin', 'member', 'viewer'] as const)('%s, JSON body: 410 and nothing logged', async (role) => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, role), orgId);
    const secret = sentinels();

    const { status } = await post(orgId, JSON.stringify(secret), 'application/json');

    expect(status).toBe(410);
    expectNotLogged(secret);
  });

  it('form-encoded body: 410 and nothing logged', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'owner'), orgId);
    const secret = sentinels();

    const { status } = await post(orgId, new URLSearchParams(secret).toString(), 'application/x-www-form-urlencoded');

    expect(status).toBe(410);
    expectNotLogged(secret);
  });

  it('malformed JSON body: 400 and nothing logged', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'owner'), orgId);
    const secret = sentinels();

    const { status } = await post(orgId, JSON.stringify(secret).slice(0, -1), 'application/json');

    expect(status).toBe(400);
    expectNotLogged(secret);
  });

  it('a caller from another organization: 404 and nothing logged', async () => {
    const callerOrg = await insertOrg();
    const targetOrg = await insertOrg();
    stubAuth(await insertMember(callerOrg, 'owner'), callerOrg);
    const secret = sentinels();

    const { status } = await post(targetOrg, JSON.stringify(secret), 'application/json');

    expect(status).toBe(404);
    expectNotLogged(secret);
  });

  it('unauthenticated: 401 and nothing logged', async () => {
    const orgId = await insertOrg();
    const secret = sentinels();

    const { status } = await post(orgId, JSON.stringify(secret), 'application/json', false);

    expect(status).toBe(401);
    expectNotLogged(secret);
  });
});

describe('the log-capture app mirrors the server middleware', () => {
  it("server.ts's global middleware ahead of the API routes is the set the app above runs or leaves out", () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'server.ts'), 'utf-8');
    const start = source.indexOf('const app = express();');
    const end = source.indexOf("app.use('/api', routes);");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const known = [
      'helmet',
      'corsMiddleware',
      'express.raw',
      'express.json',
      'express.urlencoded',
      'sanitizerMiddleware',
      'morgan',
      'requestLogger',
      'metricsMiddleware',
      'standardRateLimiter',
      'metricsRoutes',
    ];
    const used: string[] = [];
    const section = source.slice(start, end);
    let at = section.indexOf('app.use(');
    while (at !== -1) {
      // The full call, by matching parentheses.
      let depth = 0;
      let i = at + 'app.use'.length;
      do {
        if (section[i] === '(') depth++;
        else if (section[i] === ')') depth--;
        i++;
      } while (depth > 0 && i < section.length);
      const call = section.slice(at, i);
      const name = known.find((k) => new RegExp(`\\b${k.replace('.', '\\.')}\\b`).test(call));
      used.push(name ?? `unknown: ${call.replace(/\s+/g, ' ').slice(0, 80)}`);
      at = section.indexOf('app.use(', i);
    }

    // A new global middleware fails here: add it to fullStackApp() (or to the
    // list of deliberate omissions there) and then to this list.
    expect(used).toEqual([
      'helmet',
      'corsMiddleware',
      'express.raw',
      'express.raw',
      'express.json',
      'express.urlencoded',
      'sanitizerMiddleware',
      'morgan',
      'requestLogger',
      'metricsMiddleware',
      'standardRateLimiter',
      'metricsRoutes',
    ]);
  });
});
