/**
 * Weekly summary unsubscribe (GET confirm page, confirm-page POST, RFC 8058
 * one-click POST) over HTTP against real Postgres.
 *
 * The real routes, rate limiter, sanitizer and controller SQL run unstubbed.
 * The app pool (config/database) is replaced by a single-connection pool
 * whose session-local TEMP users table shadows the real one -- pg_temp is
 * searched first for unqualified names. That keeps the fixture to the
 * columns under test (the email_* preference columns are not in the CI
 * bootstrap schema) with no DDL on shared tables.
 *
 * Each test sends from its own X-Forwarded-For address, so the in-memory
 * rate limiters (standardRateLimiter, mounted on /api as in server.ts, and
 * unsubscribeRateLimiter) never carry counts between tests.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import crypto from 'crypto';

jest.mock('../../config/database', () => {
  const { Pool } = jest.requireActual('pg');
  return {
    ...jest.requireActual('../../config/database'),
    pool: new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'platform_portal',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      max: 1,
      idleTimeoutMillis: 0,
    }),
  };
});

import { pool } from '../../config/database';
import userPreferencesRoutes from '../user-preferences.routes';
import { sanitizerMiddleware } from '../../middleware/sanitizer';
import { standardRateLimiter } from '../../middleware/rateLimiter';
import { LEGACY_UNSUBSCRIBE_CUTOFF, signUnsubscribeToken } from '../../services/unsubscribe-token';

const PATH = '/api/user/preferences/unsubscribe';
const BEFORE_CUTOFF = new Date('2026-11-01T12:00:00Z');
const PREVIOUS_UPDATE = '2020-01-01T00:00:00.000Z';

let server: http.Server;
let baseUrl: string;
let ipCounter = 0;

type Flags = {
  weekly: boolean;
  anomaly: boolean;
  cost: boolean;
  deployment: boolean;
  updatedAt: string | null;
};

beforeAll(async () => {
  await pool.query(`
    CREATE TEMP TABLE users (
      id uuid PRIMARY KEY, email text NOT NULL,
      email_weekly_summary boolean DEFAULT true,
      email_anomaly_alerts boolean DEFAULT true,
      email_cost_alerts boolean DEFAULT true,
      email_deployment_alerts boolean DEFAULT true,
      email_preferences_updated_at timestamptz
    )
  `);

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(sanitizerMiddleware);
  // Same order as server.ts: the global limiter runs on all of /api first.
  app.use('/api', standardRateLimiter);
  app.get('/api/ping', (_req, res) => res.send('pong'));
  app.use('/api/user/preferences', userPreferencesRoutes);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await pool.end();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Fakes only Date, so the server, pg and fetch keep real timers. */
function pinDate(at: Date) {
  jest.useFakeTimers({
    now: at,
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval',
      'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
}

function nextIp(): string {
  ipCounter += 1;
  return `10.20.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

async function insertUser(): Promise<{ id: string; email: string }> {
  const id = crypto.randomUUID();
  const email = `unsubscribe-${id.slice(0, 8)}@example.com`;
  await pool.query(
    `INSERT INTO users (id, email, email_preferences_updated_at) VALUES ($1, $2, $3)`,
    [id, email, PREVIOUS_UPDATE]
  );
  return { id, email };
}

async function flags(userId: string): Promise<Flags> {
  const { rows } = await pool.query(
    `SELECT email_weekly_summary AS weekly, email_anomaly_alerts AS anomaly, email_cost_alerts AS cost,
            email_deployment_alerts AS deployment, email_preferences_updated_at AS "updatedAt"
     FROM users WHERE id = $1`,
    [userId]
  );
  const row = rows[0];
  return { ...row, updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null };
}

const UNTOUCHED: Flags = { weekly: true, anomaly: true, cost: true, deployment: true, updatedAt: PREVIOUS_UPDATE };

/** Only the weekly summary flag flipped; the other three are unchanged. */
function expectOnlyWeeklyOff(after: Flags) {
  expect(after.weekly).toBe(false);
  expect(after.anomaly).toBe(true);
  expect(after.cost).toBe(true);
  expect(after.deployment).toBe(true);
  expect(after.updatedAt).not.toBe(PREVIOUS_UPDATE);
}

async function call(
  ip: string,
  init: { method: 'GET' | 'POST' | 'PUT'; path?: string; query?: string; form?: Record<string, string>; multipart?: Record<string, string> }
) {
  const url = `${baseUrl}${init.path ?? PATH}${init.query !== undefined ? `?token=${encodeURIComponent(init.query)}` : ''}`;
  let body: string | FormData | undefined;
  const headers: Record<string, string> = { 'X-Forwarded-For': ip };
  if (init.form) {
    body = new URLSearchParams(init.form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (init.multipart) {
    const form = new FormData();
    for (const [k, v] of Object.entries(init.multipart)) form.append(k, v);
    body = form;
  }
  const res = await fetch(url, { method: init.method, headers, body, redirect: 'manual' });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

const ONE_CLICK = { 'List-Unsubscribe': 'One-Click' };
const NO_LEAK_HEADERS: Array<[string, string]> = [
  ['cache-control', 'no-store'],
  ['x-robots-tag', 'noindex, nofollow'],
  ['referrer-policy', 'no-referrer'],
];

function forge(token: string): string {
  const [version, userId, iat, mac] = token.split('.');
  const bytes = Buffer.from(mac, 'base64url');
  bytes[0] ^= 0x01;
  return [version, userId, iat, bytes.toString('base64url')].join('.');
}

describe('weekly summary unsubscribe', () => {
  it('(a) a forged token is rejected and changes nothing', async () => {
    const user = await insertUser();
    const forged = forge(signUnsubscribeToken(user.id, 'weekly-summary'));
    const ip = nextIp();

    const confirm = await call(ip, { method: 'POST', form: { token: forged } });
    expect(confirm.status).toBe(400);
    expect(confirm.text).toContain('This unsubscribe link is invalid or has expired.');

    const oneClick = await call(ip, { method: 'POST', query: forged, form: ONE_CLICK });
    expect(oneClick.status).toBe(400);
    expect(oneClick.text).toBe('This unsubscribe link is invalid or has expired.');

    const page = await call(ip, { method: 'GET', query: forged });
    expect(page.status).toBe(400);

    // A token for someone else's id with no valid MAC at all.
    const unsigned = ['v1', Buffer.from(user.id).toString('base64url'), String(Math.floor(Date.now() / 1000)), 'AAAA'].join('.');
    expect((await call(ip, { method: 'POST', form: { token: unsigned } })).status).toBe(400);

    expect(await flags(user.id)).toEqual(UNTOUCHED);
  });

  it('(b) GET makes no change and never queries the database, for signed, legacy and garbage tokens', async () => {
    const user = await insertUser();
    const ip = nextIp();
    const query = jest.spyOn(pool, 'query');

    const signed = signUnsubscribeToken(user.id, 'weekly-summary');
    const signedPage = await call(ip, { method: 'GET', query: signed });
    expect(signedPage.status).toBe(200);
    expect(signedPage.text).toContain('Unsubscribe from weekly summary emails?');
    expect(signedPage.text).toContain(`<input type="hidden" name="token" value="${signed}">`);
    expect(signedPage.text).toContain(`<form method="POST" action="${PATH}">`);

    pinDate(BEFORE_CUTOFF);
    const legacyPage = await call(ip, { method: 'GET', query: Buffer.from(user.id).toString('base64') });
    expect(legacyPage.status).toBe(200);
    expect(legacyPage.text).toContain('Unsubscribe from weekly summary emails?');
    jest.useRealTimers();

    const garbage = await call(ip, { method: 'GET', query: 'garbage' });
    expect(garbage.status).toBe(400);
    const missing = await call(ip, { method: 'GET' });
    expect(missing.status).toBe(400);

    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
    expect(await flags(user.id)).toEqual(UNTOUCHED);
  });

  it('(c) a signed token on the confirm-page POST turns off only the weekly summary', async () => {
    const user = await insertUser();
    const res = await call(nextIp(), { method: 'POST', form: { token: signUnsubscribeToken(user.id, 'weekly-summary') } });

    expect(res.status).toBe(200);
    expect(res.text).toContain("You've been unsubscribed from weekly summary emails");
    expect(res.text).toContain('/settings/notifications');
    expectOnlyWeeklyOff(await flags(user.id));
  });

  it('(d) one-click POST works with a signed token (urlencoded or multipart) and rejects a legacy token', async () => {
    const urlencodedUser = await insertUser();
    const ip = nextIp();
    const urlencoded = await call(ip, {
      method: 'POST',
      query: signUnsubscribeToken(urlencodedUser.id, 'weekly-summary'),
      form: ONE_CLICK,
    });
    expect(urlencoded.status).toBe(200);
    expect(urlencoded.headers.get('content-type')).toMatch(/^text\/plain/);
    expectOnlyWeeklyOff(await flags(urlencodedUser.id));

    const multipartUser = await insertUser();
    const multipart = await call(ip, {
      method: 'POST',
      query: signUnsubscribeToken(multipartUser.id, 'weekly-summary'),
      multipart: ONE_CLICK,
    });
    expect(multipart.status).toBe(200);
    expectOnlyWeeklyOff(await flags(multipartUser.id));

    const legacyUser = await insertUser();
    pinDate(BEFORE_CUTOFF);
    const legacy = await call(ip, { method: 'POST', query: Buffer.from(legacyUser.id).toString('base64'), form: ONE_CLICK });
    expect(legacy.status).toBe(400);
    expect(await flags(legacyUser.id)).toEqual(UNTOUCHED);
  });

  it('(e) a legacy token works only on the confirm-page POST, and only before the cutoff', async () => {
    const ip = nextIp();

    const before = await insertUser();
    pinDate(new Date(LEGACY_UNSUBSCRIBE_CUTOFF.getTime() - 1000));
    const ok = await call(ip, { method: 'POST', form: { token: Buffer.from(before.id).toString('base64') } });
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("You've been unsubscribed from weekly summary emails");
    expectOnlyWeeklyOff(await flags(before.id));
    jest.useRealTimers();

    const after = await insertUser();
    pinDate(LEGACY_UNSUBSCRIBE_CUTOFF);
    const rejected = await call(ip, { method: 'POST', form: { token: Buffer.from(after.id).toString('base64') } });
    expect(rejected.status).toBe(400);
    expect(rejected.text).toContain('This unsubscribe link is invalid or has expired.');
    const page = await call(ip, { method: 'GET', query: Buffer.from(after.id).toString('base64') });
    expect(page.status).toBe(400);
    expect(await flags(after.id)).toEqual(UNTOUCHED);
  });

  it('(f) the response does not reveal whether the user exists', async () => {
    const user = await insertUser();
    const ghost = crypto.randomUUID();
    const ip = nextIp();

    const known = await call(ip, { method: 'POST', form: { token: signUnsubscribeToken(user.id, 'weekly-summary') } });
    const unknown = await call(ip, { method: 'POST', form: { token: signUnsubscribeToken(ghost, 'weekly-summary') } });
    expect(unknown.status).toBe(known.status);
    expect(unknown.text).toBe(known.text);

    const knownOneClick = await call(ip, { method: 'POST', query: signUnsubscribeToken(user.id, 'weekly-summary'), form: ONE_CLICK });
    const unknownOneClick = await call(ip, { method: 'POST', query: signUnsubscribeToken(ghost, 'weekly-summary'), form: ONE_CLICK });
    expect(unknownOneClick.status).toBe(knownOneClick.status);
    expect(unknownOneClick.text).toBe(knownOneClick.text);

    const legacyUser = await insertUser();
    pinDate(BEFORE_CUTOFF);
    const legacyKnown = await call(ip, { method: 'POST', form: { token: Buffer.from(legacyUser.id).toString('base64') } });
    const legacyUnknown = await call(ip, { method: 'POST', form: { token: Buffer.from(crypto.randomUUID()).toString('base64') } });
    expect(legacyUnknown.status).toBe(legacyKnown.status);
    expect(legacyUnknown.text).toBe(legacyKnown.text);
  });

  it('(g) no token in URLs or logs, no email in logs, and no-store / noindex / no-referrer on every response', async () => {
    const user = await insertUser();
    const ip = nextIp();
    const logged: string[] = [];
    for (const level of ['log', 'warn', 'error', 'info'] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(a => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
      });
    }
    const signed = signUnsubscribeToken(user.id, 'weekly-summary');
    const legacy = Buffer.from(user.id).toString('base64');

    const page = await call(ip, { method: 'GET', query: signed });
    // The token appears once, in the hidden form field -- never in a link or the form action.
    expect(page.text.split(signed)).toHaveLength(2);
    for (const [, url] of page.text.matchAll(/(?:href|action)="([^"]*)"/g)) {
      expect(url).not.toContain(signed);
      expect(url).not.toContain('token');
    }
    expect(page.text).toContain('<meta name="referrer" content="no-referrer">');

    const responses = [
      page,
      await call(ip, { method: 'GET', query: 'garbage' }),
      await call(ip, { method: 'POST', form: { token: forge(signed) } }),
      await call(ip, { method: 'POST', query: forge(signed), form: ONE_CLICK }),
      await call(ip, { method: 'POST', form: { token: signed } }),
      await call(ip, { method: 'POST', query: signed, form: ONE_CLICK }),
    ];
    pinDate(BEFORE_CUTOFF);
    responses.push(await call(ip, { method: 'POST', form: { token: legacy } }));
    jest.useRealTimers();

    for (const res of responses) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain(signed);
      expect(line).not.toContain(forge(signed));
      expect(line).not.toContain(legacy);
      expect(line).not.toContain(user.email);
      expect(line).not.toContain(process.env.JWT_SECRET as string);
    }
  });

  it('(h) a repeated unsubscribe is harmless: same response, no further change', async () => {
    const user = await insertUser();
    const ip = nextIp();
    const token = signUnsubscribeToken(user.id, 'weekly-summary');

    const first = await call(ip, { method: 'POST', form: { token } });
    const afterFirst = await flags(user.id);
    const second = await call(ip, { method: 'POST', form: { token } });
    const third = await call(ip, { method: 'POST', query: token, form: ONE_CLICK });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
    expect(third.status).toBe(200);
    expectOnlyWeeklyOff(afterFirst);
    expect(await flags(user.id)).toEqual(afterFirst);
  });

  it('rate limit: a valid signed token is limited per verified user, never per IP', async () => {
    const user = await insertUser();
    const signed = signUnsubscribeToken(user.id, 'weekly-summary');
    const ip = nextIp();
    const query = jest.spyOn(pool, 'query');
    const handlerUpdates = () => query.mock.calls.filter(([sql]) => String(sql).includes('UPDATE users')).length;

    // 1000 replays of one token from one IP reach the handler at most 10 times.
    const statuses: number[] = [];
    let lastLimited: Awaited<ReturnType<typeof call>> | undefined;
    for (let i = 0; i < 1000; i++) {
      const res = await call(ip, { method: 'POST', query: signed, form: ONE_CLICK });
      statuses.push(res.status);
      if (res.status === 429) lastLimited = res;
    }
    expect(statuses.filter(s => s === 200)).toHaveLength(10);
    expect(statuses.filter(s => s === 429)).toHaveLength(990);
    expect(handlerUpdates()).toBeLessThanOrEqual(10);
    for (const [header, value] of NO_LEAK_HEADERS) {
      expect(lastLimited?.headers.get(header)).toBe(value);
    }

    // The budget belongs to the user: another IP is limited too ...
    expect((await call(nextIp(), { method: 'GET', query: signed })).status).toBe(429);
    query.mockRestore();

    // ... and another user's valid token from the same IP still succeeds.
    const other = await insertUser();
    const otherToken = signUnsubscribeToken(other.id, 'weekly-summary');
    expect((await call(ip, { method: 'POST', query: otherToken, form: ONE_CLICK })).status).toBe(200);
    expectOnlyWeeklyOff(await flags(other.id));
  }, 120000);

  it('rate limit: GET, confirm POST and one-click POST share the per-user budget of 10', async () => {
    const user = await insertUser();
    const signed = signUnsubscribeToken(user.id, 'weekly-summary');
    const ip = nextIp();
    const requests = [
      ...Array.from({ length: 4 }, () => call(ip, { method: 'GET', query: signed })),
      ...Array.from({ length: 3 }, () => call(ip, { method: 'POST', form: { token: signed } })),
      ...Array.from({ length: 3 }, () => call(ip, { method: 'POST', query: signed, form: ONE_CLICK })),
    ];
    for (const res of await Promise.all(requests)) {
      expect(res.status).toBe(200);
    }
    expect((await call(ip, { method: 'GET', query: signed })).status).toBe(429);
    expect((await call(ip, { method: 'POST', form: { token: signed } })).status).toBe(429);
    expect((await call(ip, { method: 'POST', query: signed, form: ONE_CLICK })).status).toBe(429);
  });

  it('rate limit: invalid and legacy tokens are limited per IP, and 30 failures from an IP do not block a valid token from it', async () => {
    const user = await insertUser();
    const signed = signUnsubscribeToken(user.id, 'weekly-summary');

    // 30 failures from one (e.g. a mail provider's shared) IP exhaust its budget ...
    const failIp = nextIp();
    for (let i = 0; i < 30; i++) {
      expect((await call(failIp, { method: 'POST', form: { token: forge(signed) } })).status).toBe(400);
    }
    const limited = await call(failIp, { method: 'POST', query: forge(signed), form: ONE_CLICK });
    expect(limited.status).toBe(429);
    for (const [header, value] of NO_LEAK_HEADERS) {
      expect(limited.headers.get(header)).toBe(value);
    }

    // ... but a valid signed request from that same IP still goes through.
    expect((await call(failIp, { method: 'POST', query: signed, form: ONE_CLICK })).status).toBe(200);
    expectOnlyWeeklyOff(await flags(user.id));
    expect((await call(failIp, { method: 'GET', query: signed })).status).toBe(200);
    expect((await call(failIp, { method: 'POST', form: { token: signed } })).status).toBe(200);
    expect((await call(failIp, { method: 'POST', form: { token: forge(signed) } })).status).toBe(429);

    // Legacy POSTs count even when they succeed.
    const legacyIp = nextIp();
    pinDate(BEFORE_CUTOFF);
    for (let i = 0; i < 30; i++) {
      expect((await call(legacyIp, { method: 'POST', form: { token: Buffer.from(user.id).toString('base64') } })).status).toBe(200);
    }
    expect((await call(legacyIp, { method: 'POST', form: { token: Buffer.from(user.id).toString('base64') } })).status).toBe(429);
  });

  it('the global standardRateLimiter never answers for this route, so its 429 cannot drop the no-store/noindex/no-referrer headers', async () => {
    const user = await insertUser();
    const signed = signUnsubscribeToken(user.id, 'weekly-summary');
    const ip = nextIp();

    // Exhaust the global limit (300/min) for this IP on another /api route.
    for (let i = 0; i < 300; i++) {
      expect((await call(ip, { method: 'GET', path: '/api/ping' })).status).toBe(200);
    }
    const globallyLimited = await call(ip, { method: 'GET', path: '/api/ping' });
    expect(globallyLimited.status).toBe(429);

    // The unsubscribe route is still answered by its own handlers and limiter.
    const responses = [
      await call(ip, { method: 'GET', query: signed }),
      await call(ip, { method: 'POST', form: { token: forge(signed) } }),
      await call(ip, { method: 'POST', query: signed, form: ONE_CLICK }),
    ];
    expect(responses.map(r => r.status)).toEqual([200, 400, 200]);
    for (const res of responses) {
      for (const [header, value] of NO_LEAK_HEADERS) {
        expect(res.headers.get(header)).toBe(value);
      }
    }
    expectOnlyWeeklyOff(await flags(user.id));

    // The exemption is GET and POST on the exact path only.
    expect((await call(ip, { method: 'PUT' })).status).toBe(429);
    expect((await call(ip, { method: 'GET', path: '/api//user/preferences/unsubscribe', query: signed })).status).toBe(429);
  });
});
