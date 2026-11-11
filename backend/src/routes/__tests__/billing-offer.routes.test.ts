/**
 * GET /api/billing/offer: the public trial offer the marketing pages read.
 * It mirrors the server's own switch (BILLING_TRIAL_ENABLED, exactly 'true'),
 * answers without a session, never touches the database, and says nothing
 * beyond "off" while the switch is off.
 *
 * Also here: the pricing page's founding-member count never invents a number
 * when its query fails (GET /api/organizations/founding-count answers
 * 503 { count: null }, not { count: 5 }).
 */
// The organizations router reads these at import (the ci.yml dummy values, as route-test-setup.ts).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-jwt-secret-not-a-real-secret-32c';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'ci-test-encryption-key-32-chars.';

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const query = jest.fn();
jest.mock('../../config/database', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

import billingOfferRoutes, { currentBillingOffer } from '../billing-offer.routes';
import organizationsRoutes from '../organizations.routes';
import { TRIAL_PERIOD_DAYS } from '../../config/trial';
import { SELF_SERVE_TIERS } from '../../services/stripe.service';

let server: http.Server;
let baseUrl: string;
const ORIGINAL = process.env.BILLING_TRIAL_ENABLED;

beforeAll(async () => {
  const app = express();
  app.use('/api/billing', billingOfferRoutes);
  app.use('/api/organizations', organizationsRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  query.mockReset();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BILLING_TRIAL_ENABLED;
  else process.env.BILLING_TRIAL_ENABLED = ORIGINAL;
});

function setSwitch(value: string | undefined) {
  if (value === undefined) delete process.env.BILLING_TRIAL_ENABLED;
  else process.env.BILLING_TRIAL_ENABLED = value;
}

describe('GET /api/billing/offer', () => {
  it.each([undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true', 'true '])(
    'switch %p → only "off", nothing else',
    async (value) => {
      setSwitch(value);
      const res = await fetch(`${baseUrl}/billing/offer`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ trial: { enabled: false } });
    },
  );

  it("switch exactly 'true' → the trial's days, plans and card rule from the server config", async () => {
    setSwitch('true');
    const res = await fetch(`${baseUrl}/billing/offer`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ trial: { enabled: true, days: TRIAL_PERIOD_DAYS, plans: [...SELF_SERVE_TIERS], cardRequired: true } });
    expect(Object.keys(body)).toEqual(['trial']);
    expect(Object.keys(body.trial).sort()).toEqual(['cardRequired', 'days', 'enabled', 'plans']);
  });

  it('needs no session, and a garbage bearer token changes nothing', async () => {
    setSwitch('true');
    const plain = await (await fetch(`${baseUrl}/billing/offer`)).json();
    const res = await fetch(`${baseUrl}/billing/offer`, { headers: { Authorization: 'Bearer not-a-token' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(plain);
  });

  it('is cacheable for a minute, sets no cookie and never queries the database', async () => {
    setSwitch('true');
    const res = await fetch(`${baseUrl}/billing/offer`);
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expect(res.headers.get('set-cookie')).toBeNull();
    setSwitch(undefined);
    await fetch(`${baseUrl}/billing/offer`);
    expect(query).not.toHaveBeenCalled();
  });

  it('reads the switch on every request (a flip shows without a restart)', async () => {
    setSwitch(undefined);
    expect(currentBillingOffer().trial.enabled).toBe(false);
    setSwitch('true');
    expect(currentBillingOffer().trial.enabled).toBe(true);
  });

  it('is the only route under /api/billing', async () => {
    for (const path of ['/billing/invoices', '/billing', '/billing/offer/x']) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(404);
    }
    const post = await fetch(`${baseUrl}/billing/offer`, { method: 'POST' });
    expect(post.status).toBe(404);
  });
});

describe('GET /api/organizations/founding-count', () => {
  it('answers the real count', async () => {
    query.mockResolvedValueOnce({ rows: [{ count: 3 }] });
    const res = await fetch(`${baseUrl}/organizations/founding-count`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 3 });
  });

  it('never invents a number when the query fails', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    const res = await fetch(`${baseUrl}/organizations/founding-count`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ count: null });
  });
});
