/**
 * Tenant ownership is explicit in the SQL for the webhook deployment
 * de-dupe, the team -> services list, dependency creation, and deployment
 * creation -- none of them leans on RLS alone.
 *
 * Every query here runs through the shared pool with NO tenant tag, as a
 * role RLS cannot filter (see the precondition test, which fails the suite
 * otherwise). RLS therefore contributes nothing: each isolation assertion
 * can only pass because of the organization predicate in the statement
 * itself. Two organizations deliberately share the same candidate
 * identifiers (metadata value, team id) or reference each other's services.
 */
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { pool } from '../../config/database';
import { DeploymentsRepository } from '../deployments.repository';
import { TeamsRepository } from '../teams.repository';
import { DependenciesRepository } from '../dependencies.repository';
import { DeploymentsController } from '../../controllers/deployments.controller';
import { DependenciesController } from '../../controllers/dependencies.controller';
import { TeamsController } from '../../controllers/teams.controller';

// Listeners issue their own fire-and-forget queries; irrelevant here.
jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

const deploymentsRepository = new DeploymentsRepository();
const teamsRepository = new TeamsRepository();
const dependenciesRepository = new DependenciesRepository();
const deploymentsController = new DeploymentsController();
const dependenciesController = new DependenciesController();
const teamsController = new TeamsController();

const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Predicates Org ${suffix}`, `predicates-org-${suffix}`, `Predicates Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertTeam(organizationId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.test', $2) RETURNING id`,
    [`predicates-team-${uniqueSuffix()}`, organizationId]
  );
  return rows[0].id as string;
}

async function insertService(organizationId: string, teamId: string | null = null): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id, team_id)
     VALUES ($1, 'api', 'owner@example.test', 'active', $2, $3)
     RETURNING id`,
    [`predicates-service-${uniqueSuffix()}`, organizationId, teamId]
  );
  return rows[0].id as string;
}

async function insertDeploymentRow(organizationId: string, serviceId: string, metadata: Record<string, unknown>): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, metadata, organization_id)
     VALUES ($1, 'production', 'us-east-1', 'success', 'github-actions', $2, $3)
     RETURNING id`,
    [serviceId, JSON.stringify(metadata), organizationId]
  );
  return rows[0].id as string;
}

/** Shaped like a request that already passed `authenticate` for organizationId. */
function mockReqRes(organizationId: string, body: any = {}, params: any = {}) {
  const req = {
    user: { userId: randomUUID(), email: 'admin@example.test', organizationId, role: 'admin' },
    organizationId,
    body,
    params,
    query: {},
    app: { get: () => undefined },
  } as unknown as Request;

  const json = jest.fn();
  const status = jest.fn();
  const res = { json, status } as unknown as Response;
  status.mockReturnValue(res);

  return { req, res, json, status };
}

async function countRows(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query(sql, params);
  return parseInt(rows[0].count, 10);
}

let errorSpy: jest.SpyInstance;

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('precondition: RLS cannot be what makes these tests pass', () => {
  it('the connecting role bypasses RLS on every table involved and the connection carries no tenant tag', async () => {
    const { rows } = await pool.query(
      `SELECT c.relname,
              (r.rolsuper OR r.rolbypassrls OR c.relowner = r.oid) AND NOT c.relforcerowsecurity AS rls_cannot_filter,
              COALESCE(current_setting('app.current_organization_id', true), '') AS tenant_tag
       FROM pg_roles r, pg_class c
       WHERE r.rolname = current_user
         AND c.relnamespace = 'public'::regnamespace
         AND c.relname IN ('deployments', 'services', 'teams', 'service_dependencies')
       ORDER BY c.relname`
    );
    expect(rows.map(r => r.relname)).toEqual(['deployments', 'service_dependencies', 'services', 'teams']);
    for (const row of rows) {
      expect(row).toEqual({ relname: row.relname, rls_cannot_filter: true, tenant_tag: '' });
    }
  });
});

describe('DeploymentsRepository.findByMetadataField (webhook de-dupe)', () => {
  it('returns only the given organization\'s deployment when two organizations hold the same metadata value', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const orgC = await insertOrg();
    const jobId = `job-${uniqueSuffix()}`;
    const deploymentA = await insertDeploymentRow(orgA, await insertService(orgA), { github_job_id: jobId });
    const deploymentB = await insertDeploymentRow(orgB, await insertService(orgB), { github_job_id: jobId });

    const foundForA = await deploymentsRepository.findByMetadataField('github_job_id', jobId, orgA);
    const foundForB = await deploymentsRepository.findByMetadataField('github_job_id', jobId, orgB);

    expect(foundForA).toEqual(expect.objectContaining({ id: deploymentA, organization_id: orgA }));
    expect(foundForB).toEqual(expect.objectContaining({ id: deploymentB, organization_id: orgB }));
    // The same value recorded only by other organizations is not a match.
    expect(await deploymentsRepository.findByMetadataField('github_job_id', jobId, orgC)).toBeNull();
  });

  it('keeps the metadata lookup semantics: a different value or key does not match', async () => {
    const orgA = await insertOrg();
    const jobId = `job-${uniqueSuffix()}`;
    await insertDeploymentRow(orgA, await insertService(orgA), { github_job_id: jobId });

    expect(await deploymentsRepository.findByMetadataField('github_job_id', `${jobId}-other`, orgA)).toBeNull();
    expect(await deploymentsRepository.findByMetadataField('github_run_id', jobId, orgA)).toBeNull();
  });
});

describe('team services', () => {
  it('returns the organization\'s own services for the team, newest first, and never another organization\'s service carrying the same team id', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const teamA = await insertTeam(orgA);
    const older = await insertService(orgA, teamA);
    await pool.query(`UPDATE services SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [older]);
    const newer = await insertService(orgA, teamA);
    await insertService(orgA); // same org, no team
    const foreign = await insertService(orgB, teamA); // another org pointing at org A's team

    const services = await teamsRepository.findServicesByTeamId(teamA, orgA);
    expect(services.map(s => s.id)).toEqual([newer, older]);
    expect(services.map(s => s.id)).not.toContain(foreign);

    const { req, res, json, status } = mockReqRes(orgA, {}, { id: teamA });
    await teamsController.getTeamServices(req, res);
    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.map((s: any) => s.id)).toEqual([newer, older]);
  });

  it('still answers 404 for a team that belongs to another organization', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const teamB = await insertTeam(orgB);
    await insertService(orgB, teamB);

    const { req, res, json, status } = mockReqRes(orgA, {}, { id: teamB });
    await teamsController.getTeamServices(req, res);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Team not found' });
  });
});

describe('dependency creation requires both services to belong to the organization', () => {
  async function create(organizationId: string, source: string, target: string) {
    const { req, res, json, status } = mockReqRes(organizationId, {
      source_service_id: source,
      target_service_id: target,
      dependency_type: 'runtime',
      description: 'calls',
      is_critical: true,
      metadata: { port: 443 },
    });
    await dependenciesController.create(req, res, jest.fn());
    return { json, status };
  }

  function dependencyCount(source: string, target: string): Promise<number> {
    return countRows(
      'SELECT COUNT(*) FROM service_dependencies WHERE source_service_id = $1 AND target_service_id = $2',
      [source, target]
    );
  }

  it('source and target in the same organization: created exactly as before', async () => {
    const orgA = await insertOrg();
    const source = await insertService(orgA);
    const target = await insertService(orgA);

    const { json, status } = await create(orgA, source, target);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: 'Dependency created successfully',
      data: expect.objectContaining({
        organization_id: orgA,
        source_service_id: source,
        target_service_id: target,
        dependency_type: 'runtime',
        description: 'calls',
        is_critical: true,
        metadata: { port: 443 },
        created_by: 'admin@example.test',
      }),
    });
    expect(await dependencyCount(source, target)).toBe(1);
  });

  it.each([
    ['foreign source, own target', true, false],
    ['own source, foreign target', false, true],
    ['both foreign', true, true],
  ])('%s: rejected and nothing is written', async (_label, foreignSource, foreignTarget) => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const source = await insertService(foreignSource ? orgB : orgA);
    const target = await insertService(foreignTarget ? orgB : orgA);

    const { json, status } = await create(orgA, source, target);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ success: false, error: 'Service not found' });
    expect(await dependencyCount(source, target)).toBe(0);
    expect(await dependenciesRepository.create(
      { source_service_id: source, target_service_id: target, dependency_type: 'runtime' } as any,
      'admin@example.test',
      orgA
    )).toBeNull();
    expect(await dependencyCount(source, target)).toBe(0);
  });

  it('does not disclose whether a foreign service id exists: same response as an id that exists nowhere', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const own = await insertService(orgA);
    const foreign = await insertService(orgB);

    const withForeign = await create(orgA, own, foreign);
    const withMissing = await create(orgA, own, randomUUID());

    expect(withForeign.status.mock.calls).toEqual(withMissing.status.mock.calls);
    expect(withForeign.json.mock.calls).toEqual(withMissing.json.mock.calls);
    expect(JSON.stringify(withForeign.json.mock.calls)).not.toContain(foreign);
  });

  it('existing rules are unchanged: self-dependency and an unknown type are still 400', async () => {
    const orgA = await insertOrg();
    const own = await insertService(orgA);

    const self = await create(orgA, own, own);
    expect(self.status).toHaveBeenCalledWith(400);
    expect(self.json).toHaveBeenCalledWith({ success: false, error: 'Service cannot depend on itself' });

    const { req, res, status } = mockReqRes(orgA, {
      source_service_id: own,
      target_service_id: await insertService(orgA),
      dependency_type: 'bogus',
    });
    await dependenciesController.create(req, res, jest.fn());
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('deployment creation requires the service to belong to the organization', () => {
  function body(serviceId: string | undefined, extra: Record<string, unknown> = {}) {
    return {
      service_id: serviceId,
      environment: 'production',
      aws_region: 'us-east-1',
      status: 'deploying',
      deployed_by: 'platform-portal',
      ...extra,
    };
  }

  function deploymentCount(serviceId: string): Promise<number> {
    return countRows('SELECT COUNT(*) FROM deployments WHERE service_id = $1', [serviceId]);
  }

  it('a service of the same organization: created exactly as before', async () => {
    const orgA = await insertOrg();
    const service = await insertService(orgA);

    const { req, res, json, status } = mockReqRes(orgA, body(service, { metadata: { ref: 'abc' }, resources: { version: '1.2.3' } }));
    await deploymentsController.create(req, res);

    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith({
      success: true,
      message: 'Deployment created successfully',
      data: expect.objectContaining({
        service_id: service,
        organization_id: orgA,
        environment: 'production',
        aws_region: 'us-east-1',
        status: 'deploying',
        deployed_by: 'platform-portal',
        cost_estimate: '0.00',
        metadata: { ref: 'abc' },
        resources: { version: '1.2.3' },
        deployed_at: expect.any(Date),
      }),
    });
    expect(await deploymentCount(service)).toBe(1);
  });

  it('another organization\'s service: rejected, nothing written, and indistinguishable from an id that exists nowhere', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const foreign = await insertService(orgB);

    const withForeign = mockReqRes(orgA, body(foreign));
    await deploymentsController.create(withForeign.req, withForeign.res);
    const withMissing = mockReqRes(orgA, body(randomUUID()));
    await deploymentsController.create(withMissing.req, withMissing.res);

    expect(withForeign.status).toHaveBeenCalledWith(404);
    expect(withForeign.json).toHaveBeenCalledWith({ success: false, error: 'Service not found' });
    expect(withForeign.status.mock.calls).toEqual(withMissing.status.mock.calls);
    expect(withForeign.json.mock.calls).toEqual(withMissing.json.mock.calls);
    expect(await deploymentCount(foreign)).toBe(0);

    expect(await deploymentsRepository.create({ ...body(foreign), organization_id: orgA } as any)).toBeNull();
    expect(await deploymentCount(foreign)).toBe(0);
  });

  it('an organization id in the request body is ignored: it cannot be used to attach to, or write into, another organization', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const foreign = await insertService(orgB);
    const own = await insertService(orgA);

    const attack = mockReqRes(orgA, body(foreign, { organization_id: orgB }));
    await deploymentsController.create(attack.req, attack.res);
    expect(attack.status).toHaveBeenCalledWith(404);
    expect(await deploymentCount(foreign)).toBe(0);

    const mislabeled = mockReqRes(orgA, body(own, { organization_id: orgB }));
    await deploymentsController.create(mislabeled.req, mislabeled.res);
    expect(mislabeled.status).toHaveBeenCalledWith(201);
    expect(mislabeled.json.mock.calls[0][0].data.organization_id).toBe(orgA);
  });

  it('a missing service_id is still a 400, as before', async () => {
    const orgA = await insertOrg();

    for (const serviceId of [undefined, null]) {
      const { req, res, json, status } = mockReqRes(orgA, body(serviceId as any));
      await deploymentsController.create(req, res);
      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: 'Missing required fields: service_id, environment, aws_region, status, deployed_by',
      });
    }
  });

  it('the repository keeps an explicit deployed_at and defaults it to now otherwise (webhook path)', async () => {
    const orgA = await insertOrg();
    const service = await insertService(orgA);
    const deployedAt = new Date('2026-01-02T03:04:05.000Z');

    const explicit = await deploymentsRepository.create({ ...body(service), status: 'success', organization_id: orgA, deployed_at: deployedAt } as any);
    const defaulted = await deploymentsRepository.create({ ...body(service), status: 'success', organization_id: orgA } as any);

    expect(new Date(explicit!.deployed_at as any).toISOString()).toBe(deployedAt.toISOString());
    expect(Date.now() - new Date(defaulted!.deployed_at as any).getTime()).toBeLessThan(60_000);
  });
});
