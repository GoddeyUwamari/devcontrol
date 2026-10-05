/**
 * POST /api/teams when the requested name is already taken.
 *
 * Behaviour under test:
 *   - The unique violation on the team name is answered with 409 and a fixed
 *     message. The body carries nothing else: no identifiers, no existing row.
 *   - A successful create is unchanged (201 with the created team).
 *   - Every other database error is unchanged (500 with the generic message),
 *     including a unique violation on any other constraint.
 *
 * There is no team update route, so a rename has no path to cover.
 *
 * Real routes over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken (to choose the caller) is stubbed, plus the
 * repository for the one error the schema cannot produce.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import teamsRoutes from '../teams.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { TeamsRepository } from '../../repositories/teams.repository';
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

const CONFLICT_MESSAGE = 'A team with this name already exists.';

const pool = new Pool(dbConfig());

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function teamName(): string {
  return `teams-duplicate-name-${uniqueSuffix()}`;
}

async function teamsNamed(name: string) {
  const { rows } = await pool.query('SELECT id, organization_id FROM teams WHERE name = $1', [name]);
  return rows;
}

let server: http.Server;
let baseUrl: string;
let orgId: string;
let userId: string;
let errorSpy: jest.SpyInstance;

beforeAll(async () => {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Teams Duplicate Name ${suffix}`, `teams-duplicate-name-${suffix}`]
  );
  orgId = org.rows[0].id;
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Teams Duplicate Name User') RETURNING id`,
    [`teams-duplicate-name-${suffix}@example.com`]
  );
  userId = user.rows[0].id;
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'owner', NOW(), true)`,
    [orgId, userId]
  );

  const app = express();
  app.use(express.json());
  app.use('/api/teams', teamsRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'teams-duplicate-name-caller@example.com',
    organizationId: orgId,
    role: 'owner',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [orgId]);
  await pool.query('DELETE FROM organization_memberships WHERE organization_id = $1', [orgId]);
  await pool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await pool.end();
  await appPool.end();
});

function createTeam(body: Record<string, unknown>) {
  return fetch(`${baseUrl}/teams`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/teams', () => {
  it('creates a team as before', async () => {
    const name = teamName();

    const res = await createTeam({ name, owner: 'owner@example.com', description: 'First' });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Team created successfully');
    expect(body.data).toMatchObject({
      name,
      owner: 'owner@example.com',
      description: 'First',
      organization_id: orgId,
    });
    expect(await teamsNamed(name)).toEqual([{ id: body.data.id, organization_id: orgId }]);
  });

  it('answers 409 with a fixed message when the name is already taken', async () => {
    const name = teamName();
    const first = await createTeam({ name, owner: 'owner@example.com' });
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.id;

    const res = await createTeam({ name, owner: 'second-owner@example.com', description: 'Second' });

    expect(res.status).toBe(409);
    // The whole body: nothing about the existing team or any organization.
    expect(await res.json()).toEqual({
      success: false,
      error: CONFLICT_MESSAGE,
      message: CONFLICT_MESSAGE,
    });
    // The existing team is untouched and no second row was written.
    expect(await teamsNamed(name)).toEqual([{ id: firstId, organization_id: orgId }]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('leaves an unrelated database error as a 500', async () => {
    // Longer than the name column allows: a database error that is not a
    // unique violation.
    const name = `${teamName()}-${'x'.repeat(260)}`;

    const res = await createTeam({ name, owner: 'owner@example.com' });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to create team' });
    expect(await teamsNamed(name)).toEqual([]);
  });

  it('leaves a unique violation on any other constraint as a 500', async () => {
    jest.spyOn(TeamsRepository.prototype, 'create').mockRejectedValueOnce(
      Object.assign(new Error('duplicate key value violates unique constraint "some_other_key"'), {
        code: '23505',
        constraint: 'some_other_key',
      })
    );

    const res = await createTeam({ name: teamName(), owner: 'owner@example.com' });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to create team' });
  });

  it('still rejects a request with missing required fields with 400', async () => {
    const res = await createTeam({ name: teamName() });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Missing required fields: name, owner' });
  });
});
