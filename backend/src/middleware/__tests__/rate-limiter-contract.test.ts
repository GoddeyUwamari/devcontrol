/**
 * The contract the real authRateLimiter keeps behind one trusted proxy hop:
 * draft-6 RateLimit-* headers only, our 429 body once the limit is used up, and
 * one bucket per client however its address is written.
 *
 * Each test loads a fresh copy of the limiter module: the limiters are
 * module-level singletons with in-memory stores.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

// The pool is only used by apiRateLimiter's tier lookup, which no test here calls.
jest.mock('../../config/database', () => ({ pool: {} }));

let server: http.Server | undefined;
let baseUrl: string;

async function startApp(): Promise<void> {
  let authRateLimiter!: express.RequestHandler;
  jest.isolateModules(() => {
    ({ authRateLimiter } = require('../rateLimiter'));
  });
  const app = express();
  app.set('trust proxy', 1);
  app.post('/api/auth/login', authRateLimiter, (_req, res) => {
    res.json({ success: true });
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(startApp);

afterEach(async () => {
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

const login = (clientIp: string) =>
  fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'X-Forwarded-For': clientIp } });

describe('authRateLimiter', () => {
  it('sends draft-6 RateLimit-* headers and no legacy X-RateLimit-* headers', async () => {
    const first = await login('203.0.113.7');
    const second = await login('203.0.113.7');

    expect(first.status).toBe(200);
    expect(first.headers.get('ratelimit-limit')).toBe('20');
    expect(first.headers.get('ratelimit-remaining')).toBe('19');
    expect(second.headers.get('ratelimit-remaining')).toBe('18');
    expect(Number(first.headers.get('ratelimit-reset'))).toBeGreaterThan(0);
    expect(first.headers.get('ratelimit-policy')).toBe('20;w=900');
    const legacy: string[] = [];
    first.headers.forEach((_value, name) => {
      if (name.startsWith('x-ratelimit')) legacy.push(name);
    });
    expect(legacy).toEqual([]);
  });

  it('answers request 21 from one client with our 429 body', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await login('203.0.113.7')).status).toBe(200);
    }

    const limited = await login('203.0.113.7');

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      success: false,
      error: 'Too many authentication attempts. Please try again in 15 minutes.',
      retry_after: 900,
    });
    // Another client keeps its own bucket.
    expect((await login('198.51.100.20')).status).toBe(200);
  });

  it('counts an IPv4 client and the same client written as an IPv4-mapped IPv6 address in one bucket', async () => {
    const plain = await login('203.0.113.7');
    const mapped = await login('::ffff:203.0.113.7');

    expect(plain.headers.get('ratelimit-remaining')).toBe('19');
    expect(mapped.headers.get('ratelimit-remaining')).toBe('18');
  });

  it('counts two IPv6 addresses in the same /56 in one bucket, and one outside it separately', async () => {
    const first = await login('2001:db8:0:1::1');
    const sameSubnet = await login('2001:db8:0:2::1');
    const otherSubnet = await login('2001:db8:0:100::1');

    expect(first.headers.get('ratelimit-remaining')).toBe('19');
    expect(sameSubnet.headers.get('ratelimit-remaining')).toBe('18');
    expect(otherSubnet.headers.get('ratelimit-remaining')).toBe('19');
  });
});
