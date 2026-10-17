/**
 * dev/local/seed-guard.js and seed-icp.js's runSeed(): the demo seed deletes
 * and rewrites an organization, so every refusal must happen before any
 * write. The client here records every statement; a refused run must have
 * issued no INSERT, UPDATE, DELETE or BEGIN, and refusals before connecting
 * must not have built a client at all.
 */
import path from 'path';
import { localStackRefusal } from '../local-stack-guard';

const DEV_LOCAL = path.join(__dirname, '..', '..', '..', '..', 'dev', 'local');
/* eslint-disable @typescript-eslint/no-require-imports */
const guard = require(path.join(DEV_LOCAL, 'seed-guard.js'));
const volume = require(path.join(DEV_LOCAL, 'volume-credentials.js'));
const { runSeed } = require(path.join(DEV_LOCAL, 'seed-icp.js'));
/* eslint-enable @typescript-eslint/no-require-imports */

type Env = Record<string, string | undefined>;
/** runSeed()'s options (it is plain JS, so its own types are unknown here). */
type SeedOptions = Record<string, unknown>;

const MARKER = 'c'.repeat(32);
const BACKEND_ENV: Env = {
  NODE_ENV: 'development',
  DB_HOST: '127.0.0.1',
  DB_PORT: '55432',
  DB_NAME: 'devcontrol_local',
  DB_USER: 'devcontrol_local',
  FRONTEND_URL: 'http://localhost:3010',
};
const PROCESS_ENV: Env = { PATH: '/bin', DEVCONTROL_LOCAL_STACK: '1', NODE_ENV: 'development' };
const CONNECTION = { host: '127.0.0.1', port: 55432, database: 'devcontrol_local', user: 'postgres', password: 'x' };

interface DbState {
  database?: string;
  comment?: string | null;
  foreignOrganizations?: number;
}

/** A pg-like client that answers the guard's three reads and records every statement. */
function recordingClient(db: DbState = {}) {
  const statements: string[] = [];
  return {
    statements,
    connect: jest.fn(async () => undefined),
    end: jest.fn(async () => undefined),
    query: jest.fn(async (sql: string) => {
      statements.push(sql);
      if (/current_database\(\)/.test(sql)) return { rows: [{ name: db.database ?? 'devcontrol_local' }] };
      if (/shobj_description/.test(sql)) {
        return { rows: [{ shobj_description: db.comment === undefined ? `${volume.MARKER_PREFIX}${MARKER}` : db.comment }] };
      }
      if (/FROM organizations WHERE slug <> ALL/.test(sql)) return { rows: [{ foreign: db.foreignOrganizations ?? 0 }] };
      return { rows: [], rowCount: 1 };
    }),
  };
}

const WRITES = /^\s*(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ALTER|CREATE|DROP|TRUNCATE)\b/i;

async function run(overrides: SeedOptions & { db?: DbState } = {}) {
  const client = recordingClient(overrides.db);
  const makeClient = jest.fn(() => client);
  const writeDemoLogin = jest.fn();
  const result = await runSeed({
    processEnv: PROCESS_ENV,
    backendEnv: BACKEND_ENV,
    connection: CONNECTION,
    recordedMarker: MARKER,
    makeClient,
    anchor: new Date('2026-10-17T12:00:00Z'),
    readDemoLogin: () => null,
    writeDemoLogin,
    hashPassword: async () => 'hash',
    ...overrides,
  });
  return { result, client, makeClient, writeDemoLogin };
}

describe('refusals before connecting (checks 1-3): no client is built', () => {
  it.each<[string, SeedOptions, RegExp]>([
    ['flag unset', { processEnv: { PATH: '/bin' } }, /^check 1:/],
    ['flag 0', { processEnv: { ...PROCESS_ENV, DEVCONTROL_LOCAL_STACK: '0' } }, /^check 1:/],
    ['flag true', { processEnv: { ...PROCESS_ENV, DEVCONTROL_LOCAL_STACK: 'true' } }, /^check 1:/],
    // Set only in backend.env, not the process: still refused.
    ['flag only in backend.env', { processEnv: { PATH: '/bin' }, backendEnv: { ...BACKEND_ENV, DEVCONTROL_LOCAL_STACK: '1' } }, /^check 1:/],
    ['NODE_ENV=production', { processEnv: { ...PROCESS_ENV, NODE_ENV: 'production' } }, /^check 2: local-stack guard: NODE_ENV is production$/],
    ['DB_HOST remote in backend.env', { backendEnv: { ...BACKEND_ENV, DB_HOST: 'db.example.com' } }, /^check 2: local-stack guard: DB_HOST/],
    ['DB_HOST remote in the process env', { processEnv: { ...PROCESS_ENV, DB_HOST: 'db.example.com' } }, /^check 2: local-stack guard: DB_HOST/],
    ['DB_NAME not local', { backendEnv: { ...BACKEND_ENV, DB_NAME: 'platform_portal' } }, /^check 2: local-stack guard: DB_NAME/],
    ['AWS_PROFILE set', { processEnv: { ...PROCESS_ENV, AWS_PROFILE: 'example' } }, /^check 2: local-stack guard: AWS_PROFILE is set/],
    ['STRIPE_ key set', { backendEnv: { ...BACKEND_ENV, STRIPE_SECRET_KEY: 'sk_example' } }, /^check 2: local-stack guard: STRIPE_SECRET_KEY is set/],
    ['backend.env missing', { backendEnv: {} }, /^check 2:/],
    ['host localhost', { connection: { ...CONNECTION, host: 'localhost' } }, /^check 3: connection host/],
    ['host remote', { connection: { ...CONNECTION, host: 'db.example.com' } }, /^check 3: connection host/],
    ['port 5432', { connection: { ...CONNECTION, port: 5432 } }, /^check 3: connection port/],
    ['database devcontrol_localx', { connection: { ...CONNECTION, database: 'devcontrol_localx' } }, /^check 3: connection database/],
    ['database platform_portal', { connection: { ...CONNECTION, database: 'platform_portal' } }, /^check 3: connection database/],
  ])('%s', async (_name, overrides, reason) => {
    const { result, makeClient, writeDemoLogin } = await run(overrides);
    expect(result.refused).toMatch(reason);
    expect(makeClient).not.toHaveBeenCalled();
    expect(writeDemoLogin).not.toHaveBeenCalled();
  });

  it('process environment wins over backend.env, as dotenv does', () => {
    // backend.env says development; the process says production: the backend would see production.
    expect(
      guard.preConnectRefusal({ processEnv: { ...PROCESS_ENV, NODE_ENV: 'production' }, backendEnv: BACKEND_ENV, connection: CONNECTION })
    ).toBe('check 2: local-stack guard: NODE_ENV is production');
  });

  it('names the check and never a value', async () => {
    const secretish = 'db-host-secret-value.example.com';
    const { result } = await run({ backendEnv: { ...BACKEND_ENV, DB_HOST: secretish } });
    expect(result.refused).not.toContain(secretish);
  });
});

describe('refusals after connecting (checks 4-6): reads only, then nothing', () => {
  it.each<[string, DbState, SeedOptions, RegExp]>([
    ['another database', { database: 'platform_portal' }, {}, /^check 4:/],
    ['no marker on the database', { comment: null }, {}, /^check 5:/],
    ['a different marker on the database', { comment: `${volume.MARKER_PREFIX}${'d'.repeat(32)}` }, {}, /^check 5:/],
    ['no marker recorded in .state', {}, { recordedMarker: null }, /^check 5:/],
    ['a different marker recorded in .state', {}, { recordedMarker: 'e'.repeat(32) }, /^check 5:/],
    ['a foreign organization', { foreignOrganizations: 1 }, {}, /^check 6:/],
  ])('%s', async (_name, db, overrides, reason) => {
    const { result, client, writeDemoLogin } = await run({ db, ...overrides });
    expect(result.refused).toMatch(reason);
    expect(client.statements.filter((sql) => WRITES.test(sql))).toEqual([]);
    expect(client.end).toHaveBeenCalled();
    expect(writeDemoLogin).not.toHaveBeenCalled();
  });

  it('the foreign-organization check allows exactly the local stack\'s own organizations', async () => {
    const { client } = await run();
    const call = client.query.mock.calls.find(([sql]) => /slug <> ALL/.test(sql)) as unknown as [string, unknown[]];
    expect(call[1]).toEqual([['default', 'example-local-org', 'example-saas']]);
  });
});

describe('a run that passes every check', () => {
  it('resets then writes, inside one transaction, after the guard reads', async () => {
    const { result, client, writeDemoLogin } = await run();
    expect(result.refused).toBeUndefined();
    const writes = client.statements.filter((sql) => WRITES.test(sql)).map((sql) => sql.trim().split(/\s+/).slice(0, 3).join(' '));
    expect(writes[0]).toBe('BEGIN');
    expect(writes[1]).toBe('DELETE FROM organizations');
    expect(writes[2]).toBe('DELETE FROM users');
    expect(writes[writes.length - 1]).toBe('COMMIT');
    const firstWrite = client.statements.findIndex((sql) => WRITES.test(sql));
    expect(client.statements.slice(0, firstWrite).every((sql) => /^\s*SELECT/i.test(sql))).toBe(true);
    expect(writeDemoLogin).toHaveBeenCalledWith('founder@example.com', expect.stringMatching(/^demo-/));
  });

  it('keeps an existing demo password instead of issuing a new one', async () => {
    const { result, writeDemoLogin } = await run({ readDemoLogin: () => ({ email: 'founder@example.com', password: 'demo-kept' }) });
    expect(result.passwordIssued).toBe(false);
    expect(writeDemoLogin).not.toHaveBeenCalled();
  });

  it('rolls back and writes no login when an insert fails', async () => {
    const client = recordingClient();
    const query = client.query.getMockImplementation()!;
    client.query.mockImplementation(async (sql: string) => {
      if (/^INSERT INTO aws_resources/.test(sql)) throw new Error('boom');
      return query(sql);
    });
    const writeDemoLogin = jest.fn();
    await expect(
      runSeed({
        processEnv: PROCESS_ENV, backendEnv: BACKEND_ENV, connection: CONNECTION, recordedMarker: MARKER,
        makeClient: () => client, anchor: new Date('2026-10-17T12:00:00Z'), readDemoLogin: () => null, writeDemoLogin,
        hashPassword: async () => 'hash',
      })
    ).rejects.toThrow('boom');
    expect(client.statements).toContain('ROLLBACK');
    expect(client.statements).not.toContain('COMMIT');
    expect(writeDemoLogin).not.toHaveBeenCalled();
  });
});

describe('localStackRefusal parity: the JS port answers exactly as the backend guard', () => {
  const valid: Env = { DEVCONTROL_LOCAL_STACK: '1', ...BACKEND_ENV };
  const cases: Array<[string, Env]> = [
    ['valid', valid],
    ['flag missing', { ...valid, DEVCONTROL_LOCAL_STACK: undefined }],
    ['flag 0', { ...valid, DEVCONTROL_LOCAL_STACK: '0' }],
    ['flag " 1"', { ...valid, DEVCONTROL_LOCAL_STACK: ' 1' }],
    ['production', { ...valid, NODE_ENV: 'production' }],
    ['DB_HOST missing', { ...valid, DB_HOST: undefined }],
    ['DB_HOST localhost', { ...valid, DB_HOST: 'localhost' }],
    ['DB_HOST ::1', { ...valid, DB_HOST: '::1' }],
    ['DB_HOST remote', { ...valid, DB_HOST: 'db.example.com' }],
    ['DB_HOST 0.0.0.0', { ...valid, DB_HOST: '0.0.0.0' }],
    ['DB_NAME missing', { ...valid, DB_NAME: undefined }],
    ['DB_NAME suffixed', { ...valid, DB_NAME: 'devcontrol_local_test' }],
    ['DB_NAME other', { ...valid, DB_NAME: 'platform_portal' }],
    ['two forbidden, sorted', { ...valid, STRIPE_SECRET_KEY: 'x', AWS_PROFILE: 'y' }],
    ['forbidden but empty', { ...valid, ANTHROPIC_API_KEY: '' }],
    ['SMTP_ prefix', { ...valid, SMTP_HOST: 'mail.example.com' }],
    ['RESEND_API_KEY', { ...valid, RESEND_API_KEY: 'x' }],
    ['SLACK_WEBHOOK_URL', { ...valid, SLACK_WEBHOOK_URL: 'x' }],
    ['AWS session token', { ...valid, AWS_SESSION_TOKEN: 'x' }],
    ['FRONTEND_URL other', { ...valid, FRONTEND_URL: 'https://app.example.com' }],
    ['FRONTEND_URL missing', { ...valid, FRONTEND_URL: undefined }],
    ['PROMETHEUS_URL loopback', { ...valid, PROMETHEUS_URL: 'http://127.0.0.1:9090' }],
    ['PROMETHEUS_URL [::1]', { ...valid, PROMETHEUS_URL: 'http://[::1]:9090' }],
    ['PROMETHEUS_URL remote', { ...valid, PROMETHEUS_URL: 'http://prom.example.com' }],
    ['PROMETHEUS_URL garbage', { ...valid, PROMETHEUS_URL: 'not a url' }],
    ['empty env', {}],
  ];

  it.each(cases)('%s', (_name, env) => {
    const js = guard.localStackRefusal(env);
    expect(js).toBe(localStackRefusal(env));
  });
});
