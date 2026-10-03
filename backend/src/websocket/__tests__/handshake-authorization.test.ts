/**
 * Live-update sockets: who may connect, and what happens to an open socket
 * when its owner's membership changes.
 *
 * A real Socket.IO server shares an HTTP server with the real organization
 * routes (wired the way server.ts wires them, via app.set('wsServer')), and
 * real socket.io-client connections use real signed tokens against live
 * Postgres.
 */
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { Pool } from 'pg';
import { io as connectClient, Socket as ClientSocket } from 'socket.io-client';
import organizationRoutes from '../../routes/organizations.routes';
import { WebSocketServer } from '../server';
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
const openClients: ClientSocket[] = [];
const jwtSecret: string = (authService as any).jwtSecret;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'pro', 10, 20) RETURNING id`,
    [`Socket Authz ${suffix}`, `socket-authz-${suffix}`, `Socket Authz ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Socket Authz User') RETURNING id`,
    [`socket-authz-${label}-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string, role: string): Promise<string> {
  const userId = await insertUser(role);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );
  return userId;
}

/** An org with an owner (who makes membership changes), an admin, and a member. */
async function buildOrg() {
  const orgId = await insertOrg();
  return {
    orgId,
    owner: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
  };
}

function token(userId: string, organizationId: string, opts: { role?: string; type?: string; expiresIn?: number } = {}) {
  return jwt.sign(
    { userId, email: 'claimed@example.com', organizationId, role: opts.role ?? 'owner', type: opts.type ?? 'access' },
    jwtSecret,
    { expiresIn: opts.expiresIn ?? 3600, jwtid: randomUUID() }
  );
}

let server: http.Server;
let ws: WebSocketServer;
let baseUrl: string;

/** Connects and resolves once connected, or rejects with the server's refusal. */
function connect(authToken?: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client = connectClient(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      auth: authToken === undefined ? {} : { token: authToken },
    });
    openClients.push(client);
    client.once('connect', () => resolve(client));
    client.once('connect_error', (error) => reject(error));
  });
}

function disconnected(client: ClientSocket): Promise<string> {
  return new Promise((resolve) => {
    if (!client.connected) return resolve('already disconnected');
    client.once('disconnect', (reason) => resolve(reason));
  });
}

/** The server-side identity of `userId`'s sockets in `orgId`. */
function serverSockets(userId: string, orgId: string): any[] {
  return [...(ws as any).io.of('/').sockets.values()]
    .filter((s: any) => s.data?.userId === userId && s.data?.organizationId === orgId);
}

function api(callerId: string, orgId: string, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}/api/organizations${path}`, {
    method,
    headers: { Authorization: `Bearer ${token(callerId, orgId)}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/organizations', organizationRoutes);
  server = http.createServer(app);
  ws = new WebSocketServer(server);
  app.set('wsServer', ws);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  for (const client of openClients.splice(0)) client.disconnect();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    (ws as any).io.close();
    server.close(() => resolve());
  });
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

describe('handshake', () => {
  it('a current member connects with an access token and gets their current role, not the claim', async () => {
    const org = await buildOrg();
    const client = await connect(token(org.member, org.orgId, { role: 'owner' }));
    expect(client.connected).toBe(true);

    const [socket] = serverSockets(org.member, org.orgId);
    expect(socket.data.role).toBe('member');
    expect(socket.rooms.has(`org:${org.orgId}`)).toBe(true);
  });

  it('organization events reach a connected member', async () => {
    const org = await buildOrg();
    const client = await connect(token(org.member, org.orgId));
    const received = new Promise((resolve) => client.once('deployment:started', resolve));
    ws.emitToOrganization(org.orgId, 'deployment:started', { id: 'd-1' });
    await expect(received).resolves.toEqual({ id: 'd-1' });
  });

  it('a refresh token is refused', async () => {
    const org = await buildOrg();
    const { refreshToken } = await authService.generateTokenPair({
      userId: org.member,
      email: 'socket@example.com',
      organizationId: org.orgId,
      role: 'member',
    });
    await expect(connect(refreshToken)).rejects.toThrow('Authentication failed');
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [org.member]);
  });

  it('a removed member is refused', async () => {
    const org = await buildOrg();
    const memberToken = token(org.member, org.orgId);
    expect((await api(org.owner, org.orgId, 'DELETE', `/${org.orgId}/members/${org.member}`)).status).toBe(200);
    await expect(connect(memberToken)).rejects.toThrow('Authentication failed');
  });

  it('a non-member, an unknown organization, a malformed or missing token are refused', async () => {
    const a = await buildOrg();
    const b = await buildOrg();
    await expect(connect(token(a.owner, b.orgId))).rejects.toThrow('Authentication failed');
    await expect(connect(token(a.owner, randomUUID()))).rejects.toThrow('Authentication failed');
    await expect(connect(token('user-1', a.orgId))).rejects.toThrow('Authentication failed');
    await expect(connect('not-a-jwt')).rejects.toThrow('Authentication failed');
    await expect(connect()).rejects.toThrow('Authentication token required');
  });

  it('an expired token is refused', async () => {
    const org = await buildOrg();
    await expect(connect(token(org.member, org.orgId, { expiresIn: -10 }))).rejects.toThrow('Authentication failed');
  });
});

describe('an already-open socket', () => {
  it('is disconnected when its owner is removed; other members stay connected', async () => {
    const org = await buildOrg();
    const removed = await connect(token(org.member, org.orgId));
    const stays = await connect(token(org.admin, org.orgId));
    const closed = disconnected(removed);

    const res = await api(org.owner, org.orgId, 'DELETE', `/${org.orgId}/members/${org.member}`);
    expect(res.status).toBe(200);

    await expect(closed).resolves.toBe('io server disconnect');
    expect(stays.connected).toBe(true);
    expect(serverSockets(org.member, org.orgId)).toHaveLength(0);
  });

  it('only the organization the user was removed from is affected', async () => {
    const a = await buildOrg();
    const b = await buildOrg();
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
       VALUES ($1, $2, 'member', NOW(), true)`,
      [b.orgId, a.member]
    );
    const inA = await connect(token(a.member, a.orgId));
    const inB = await connect(token(a.member, b.orgId));
    const closed = disconnected(inA);

    expect((await api(a.owner, a.orgId, 'DELETE', `/${a.orgId}/members/${a.member}`)).status).toBe(200);

    await expect(closed).resolves.toBe('io server disconnect');
    expect(inB.connected).toBe(true);
  });

  it('carries the new role after a demotion, without being disconnected', async () => {
    const org = await buildOrg();
    const client = await connect(token(org.admin, org.orgId, { role: 'admin' }));
    expect(serverSockets(org.admin, org.orgId)[0].data.role).toBe('admin');

    const res = await api(org.owner, org.orgId, 'PATCH', `/${org.orgId}/members/${org.admin}/role`, { role: 'viewer' });
    expect(res.status).toBe(200);

    expect(serverSockets(org.admin, org.orgId)[0].data.role).toBe('viewer');
    expect(client.connected).toBe(true);
  });

  it('is disconnected when the access token it was opened with expires', async () => {
    const org = await buildOrg();
    const client = await connect(token(org.member, org.orgId, { expiresIn: 2 }));
    await expect(disconnected(client)).resolves.toBe('io server disconnect');
  });
});
