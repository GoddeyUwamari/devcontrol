/**
 * POST /api/teams when the requested name is already taken.
 *
 * A team name is unique within its organization
 * (teams_organization_id_name_key), not across organizations.
 *
 * Behaviour under test:
 *   - The unique violation on the team name is answered with 409 and a fixed
 *     message. The body carries nothing else: no identifiers, no existing row.
 *   - The same name in a different organization is not a conflict.
 *   - Both names of the team-name constraint are recognised: the
 *     per-organization one the schema has now, and the global teams_name_key
 *     a database still reports until the migration replacing it is applied.
 *   - Uniqueness is the database's: the create issues no lookup of its own.
 *   - Comparison is exact: names differing only in case are different names.
 *   - A successful create is unchanged (201 with the created team).
 *   - Every other database error is unchanged (500 with the generic message),
 *     including a unique violation on any other constraint.
 *
 * There is no team update route, so a rename has no path to cover.
 *
 * Real routes over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken (to choose the caller) is stubbed, plus the
 * repository for the errors the schema cannot produce. Statements are
 * observed, not altered, at the pg Client, which every connection in this
 * process goes through: the app pool hands requests their own client, so
 * watching pool.query would miss them.
 */
import express from 'express';
import http from 'http';
import { Client, Pool } from 'pg';
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

// Records what is sent while `recording` is set, then runs the real query.
// Installed before any connection exists, since the app pool keeps its own
// reference to a client's query the first time it checks that client out.
const sent: Array<{ text: string; values: unknown }> = [];
let recording = false;
const clientQuery = Client.prototype.query;
Client.prototype.query = function (this: Client, ...args: unknown[]) {
  if (recording) {
    const config = args[0] as string | { text?: unknown; values?: unknown } | null;
    sent.push(
      typeof config === 'string'
        ? { text: config, values: Array.isArray(args[1]) ? args[1] : undefined }
        : { text: String(config?.text ?? ''), values: config?.values }
    );
  }
  return (clientQuery as unknown as (...a: unknown[]) => unknown).apply(this, args);
} as unknown as typeof Client.prototype.query;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function teamName(): string {
  return `teams-duplicate-name-${uniqueSuffix()}`;
}

async function teamsNamed(name: string) {
  const { rows } = await pool.query(
    'SELECT id, organization_id FROM teams WHERE name = $1 ORDER BY created_at, id',
    [name]
  );
  return rows;
}

interface Caller {
  orgId: string;
  userId: string;
}

async function createCaller(label: string): Promise<Caller> {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Teams Duplicate Name ${label} ${suffix}`, `teams-duplicate-name-${label}-${suffix}`]
  );
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Teams Duplicate Name User') RETURNING id`,
    [`teams-duplicate-name-${label}-${suffix}@example.com`]
  );
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'owner', NOW(), true)`,
    [org.rows[0].id, user.rows[0].id]
  );
  return { orgId: org.rows[0].id, userId: user.rows[0].id };
}

async function removeCaller(caller: Caller) {
  await pool.query('DELETE FROM teams WHERE organization_id = $1', [caller.orgId]);
  await pool.query('DELETE FROM organization_memberships WHERE organization_id = $1', [caller.orgId]);
  await pool.query('DELETE FROM organizations WHERE id = $1', [caller.orgId]);
  await pool.query('DELETE FROM users WHERE id = $1', [caller.userId]);
}

function actAs(caller: Partial<Caller>) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: caller.userId,
    email: 'teams-duplicate-name-caller@example.com',
    organizationId: caller.orgId,
    role: 'owner',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
}

function uniqueViolation(constraint: string) {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: '23505',
    constraint,
  });
}

let server: http.Server;
let baseUrl: string;
let caller: Caller;
let otherCaller: Caller;
let orgId: string;
let errorSpy: jest.SpyInstance;

beforeAll(async () => {
  caller = await createCaller('a');
  otherCaller = await createCaller('b');
  orgId = caller.orgId;

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
  actAs(caller);
});

afterEach(() => {
  recording = false;
  sent.length = 0;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await removeCaller(caller);
  await removeCaller(otherCaller);
  await pool.end();
  await appPool.end();
  Client.prototype.query = clientQuery;
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

  it('answers 409 with a fixed message when the name is already taken in the same organization', async () => {
    const name = teamName();
    const first = await createTeam({ name, owner: 'owner@example.com' });
    expect(first.status).toBe(201);
    const firstId = (await first.json()).data.id;
    // Not a stub: the real create runs, and is only watched for what it rejects with.
    const createSpy = jest.spyOn(TeamsRepository.prototype, 'create');

    const res = await createTeam({ name, owner: 'second-owner@example.com', description: 'Second' });

    expect(res.status).toBe(409);
    // The conflict is the database's own, on the per-organization constraint.
    expect(createSpy).toHaveBeenCalledTimes(1);
    await expect(createSpy.mock.results[0].value).rejects.toMatchObject({
      code: '23505',
      constraint: 'teams_organization_id_name_key',
    });
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

  it('creates the same name in two different organizations', async () => {
    const name = teamName();

    const first = await createTeam({ name, owner: 'owner@example.com' });
    actAs(otherCaller);
    const second = await createTeam({ name, owner: 'owner@example.com' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(firstBody.data).toMatchObject({ name, organization_id: caller.orgId });
    expect(secondBody.data).toMatchObject({ name, organization_id: otherCaller.orgId });
    expect(await teamsNamed(name)).toEqual([
      { id: firstBody.data.id, organization_id: caller.orgId },
      { id: secondBody.data.id, organization_id: otherCaller.orgId },
    ]);

    // Each organization still conflicts with itself.
    const repeat = await createTeam({ name, owner: 'owner@example.com' });
    expect(repeat.status).toBe(409);
    expect(await teamsNamed(name)).toHaveLength(2);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('treats names differing only in case as different names', async () => {
    const base = teamName();
    const upper = `Platform-${base}`;
    const lower = `platform-${base}`;

    const first = await createTeam({ name: upper, owner: 'owner@example.com' });
    const second = await createTeam({ name: lower, owner: 'owner@example.com' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await first.json()).data).toMatchObject({ name: upper, organization_id: orgId });
    expect((await second.json()).data).toMatchObject({ name: lower, organization_id: orgId });
    expect(await teamsNamed(upper)).toHaveLength(1);
    expect(await teamsNamed(lower)).toHaveLength(1);
  });

  it('checks uniqueness with no lookup of its own, in any organization', async () => {
    const name = teamName();
    actAs(otherCaller);
    expect((await createTeam({ name, owner: 'owner@example.com' })).status).toBe(201);
    actAs(caller);
    const findAll = jest.spyOn(TeamsRepository.prototype, 'findAll');
    const findById = jest.spyOn(TeamsRepository.prototype, 'findById');

    recording = true;
    const created = await createTeam({ name, owner: 'owner@example.com' });
    const conflict = await createTeam({ name, owner: 'owner@example.com' });
    recording = false;

    expect(created.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(findAll).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
    // Every statement the two requests sent, on any connection, that names
    // the teams table or carries the requested name: one INSERT each, with
    // the caller's own organization, and nothing else.
    expect(sent.length).toBeGreaterThan(2);
    const aboutTeams = sent.filter(
      ({ text, values }) => /\bteams\b/i.test(text) || (Array.isArray(values) && values.includes(name))
    );
    expect(aboutTeams).toHaveLength(2);
    for (const { text, values } of aboutTeams) {
      expect(text.trim()).toMatch(/^INSERT INTO teams\b/);
      expect(text).not.toMatch(/\bSELECT\b/i);
      expect(values).toEqual([name, 'owner@example.com', undefined, caller.orgId]);
    }
  });

  it('answers 409 for the global constraint a not-yet-migrated database reports', async () => {
    // The schema under test no longer has teams_name_key, so the violation is supplied.
    jest.spyOn(TeamsRepository.prototype, 'create').mockRejectedValueOnce(uniqueViolation('teams_name_key'));

    const res = await createTeam({ name: teamName(), owner: 'owner@example.com' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: CONFLICT_MESSAGE,
      message: CONFLICT_MESSAGE,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('answers 409 for the per-organization constraint by name', async () => {
    jest
      .spyOn(TeamsRepository.prototype, 'create')
      .mockRejectedValueOnce(uniqueViolation('teams_organization_id_name_key'));

    const res = await createTeam({ name: teamName(), owner: 'owner@example.com' });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: CONFLICT_MESSAGE,
      message: CONFLICT_MESSAGE,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('still requires an organization', async () => {
    const name = teamName();
    const createSpy = jest.spyOn(TeamsRepository.prototype, 'create');
    // A token carrying no organization never reaches the controller.
    actAs({ userId: caller.userId });

    const res = await createTeam({ name, owner: 'owner@example.com' });

    expect(res.status).toBe(401);
    expect(createSpy).not.toHaveBeenCalled();
    // And the column itself refuses a team with none.
    await expect(
      pool.query('INSERT INTO teams (name, owner, organization_id) VALUES ($1, $2, NULL)', [name, 'owner@example.com'])
    ).rejects.toMatchObject({ code: '23502', column: 'organization_id' });
    expect(await teamsNamed(name)).toEqual([]);
  });

  it('enforces the name with exactly one unique constraint, scoped to the organization', async () => {
    const { rows } = await pool.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conrelid = 'public.teams'::regclass AND contype IN ('p', 'u')
        ORDER BY conname`
    );

    expect(rows).toEqual([
      { conname: 'teams_organization_id_name_key', definition: 'UNIQUE (organization_id, name)' },
      { conname: 'teams_pkey', definition: 'PRIMARY KEY (id)' },
    ]);
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
    jest.spyOn(TeamsRepository.prototype, 'create').mockRejectedValueOnce(uniqueViolation('some_other_key'));

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
