/**
 * POST /api/newsletter/subscribe answers every successful signup the same
 * way -- a new address, an already-subscribed one and a reactivated one get
 * the same status, body and content type -- so the endpoint does not reveal
 * whether an address is on the list. What it stores is unchanged: one row per
 * address, reactivation of an unsubscribed one, nothing else touched.
 *
 * Real route against live Postgres. newsletter_subscribers is not created by
 * the canonical migrations, so the suite creates it from
 * backend/migrations/018_create_newsletter_subscribers.sql if it is missing
 * (CREATE ... IF NOT EXISTS) and deletes only its own rows.
 */
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';
import { Pool } from 'pg';
import newsletterRoutes from '../../routes/newsletter.routes';
import { pool } from '../../config/database';

const MIGRATION = path.join(__dirname, '..', '..', '..', 'migrations', '018_create_newsletter_subscribers.sql');
const SUBSCRIBED = { success: true, message: 'Subscribed successfully' };

let server: http.Server;
let baseUrl: string;
const emails: string[] = [];

function uniqueEmail(): string {
  const email = `newsletter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  emails.push(email);
  return email;
}

async function subscribe(body: unknown): Promise<{ status: number; contentType: string | null; text: string }> {
  const response = await fetch(`${baseUrl}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, contentType: response.headers.get('content-type'), text: await response.text() };
}

async function rows(email: string) {
  return (
    await pool.query('SELECT source, is_active, subscribed_at FROM newsletter_subscribers WHERE email = $1', [email])
  ).rows;
}

beforeAll(async () => {
  await pool.query(fs.readFileSync(MIGRATION, 'utf8'));
  const app = express();
  app.use(express.json());
  app.use('/api/newsletter', newsletterRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/newsletter`;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM newsletter_subscribers WHERE email = ANY($1)', [emails]);
});

describe('the public answer does not depend on whether the address is subscribed', () => {
  it('new, already subscribed and reactivated signups get identical responses', async () => {
    const fresh = await subscribe({ email: uniqueEmail(), source: 'blog' });

    const existing = uniqueEmail();
    await subscribe({ email: existing });
    const again = await subscribe({ email: existing });

    const lapsed = uniqueEmail();
    await subscribe({ email: lapsed });
    await pool.query('UPDATE newsletter_subscribers SET is_active = false WHERE email = $1', [lapsed]);
    const reactivated = await subscribe({ email: lapsed });

    expect(fresh.status).toBe(201);
    expect(JSON.parse(fresh.text)).toEqual(SUBSCRIBED);
    expect(again).toEqual(fresh);
    expect(reactivated).toEqual(fresh);
  });
});

describe('what is stored is unchanged', () => {
  it('a new address is stored once, with its source', async () => {
    const email = uniqueEmail();

    await subscribe({ email, source: 'changelog' });

    expect(await rows(email)).toEqual([expect.objectContaining({ source: 'changelog', is_active: true })]);
  });

  it('subscribing again leaves the one row as it was', async () => {
    const email = uniqueEmail();
    await subscribe({ email, source: 'blog' });
    const [before] = await rows(email);

    await subscribe({ email: `  ${email.toUpperCase()} `, source: 'changelog' });

    expect(await rows(email)).toEqual([before]);
  });

  it('an unsubscribed address is reactivated', async () => {
    const email = uniqueEmail();
    await subscribe({ email });
    await pool.query(
      "UPDATE newsletter_subscribers SET is_active = false, subscribed_at = NOW() - INTERVAL '1 day' WHERE email = $1",
      [email]
    );
    const [lapsed] = await rows(email);

    await subscribe({ email });

    const [after] = await rows(email);
    expect(after.is_active).toBe(true);
    expect(after.subscribed_at.getTime()).toBeGreaterThan(lapsed.subscribed_at.getTime());
  });
});

describe('validation and failures', () => {
  it('an invalid address is still 400', async () => {
    const result = await subscribe({ email: 'not-an-email' });

    expect(result.status).toBe(400);
    expect(JSON.parse(result.text)).toEqual({ success: false, error: 'Valid email address is required' });
  });

  it('a database failure is 500 with a fixed message, and the log holds no address', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const email = uniqueEmail();
    // config/database's pool is a Proxy over a pg Pool; fail the next query
    // where pg defines it.
    let proto: any = Pool.prototype;
    while (!Object.prototype.hasOwnProperty.call(proto, 'query')) proto = Object.getPrototypeOf(proto);
    jest.spyOn(proto, 'query').mockImplementationOnce(async () => {
      throw Object.assign(new Error(`insert failed for ${email}`), { code: '23505', detail: `Key (email)=(${email}) exists` });
    });

    const result = await subscribe({ email });

    expect(result.status).toBe(500);
    expect(JSON.parse(result.text)).toEqual({ success: false, error: 'Internal server error' });
    expect(consoleError).toHaveBeenCalledWith('Newsletter subscribe error:', {
      name: 'Error',
      code: '23505',
      message: 'insert failed for [email]',
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(email);
  });
});
