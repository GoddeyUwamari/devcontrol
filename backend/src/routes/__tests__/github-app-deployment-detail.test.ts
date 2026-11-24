/**
 * D8b-2 deployment detail: GET /api/deployments/:id adds github_repository
 * ({ full_name }) for rows the GitHub App wrote, read on a connection tagged
 * for the caller's organization. Never for a hand-recorded or legacy-webhook
 * row, and never another organization's repository name, even when that
 * organization has a repository with the same GitHub id.
 */
import deploymentsRoutes from '../deployments.routes';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';

jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

const harness = createRoleGateHarness('d8b2-detail');
let A: RoleGateOrg;
let B: RoleGateOrg;
let serviceA: string;
const gh = 960_000_000 + Math.floor(Math.random() * 1e6);
const ghBOnly = gh + 1;

const insert = async (org: string, service: string, metadata: Record<string, unknown>) => (await harness.pool.query(
  `INSERT INTO deployments (service_id, environment, status, deployed_by, organization_id, metadata)
   VALUES ($1, 'production', 'success', 'd8b2-detail', $2, $3::jsonb) RETURNING id::text AS id`,
  [service, org, JSON.stringify(metadata)])).rows[0].id as string;
let nextJobId = gh * 10;
const appMeta = (repoId: number) => ({
  connection: 'github_app', pipeline_metadata_version: 1, source: 'github_actions', github_repo_id: repoId, github_job_id: (nextJobId += 1),
  head_sha: 'a'.repeat(40), html_url: 'https://github.com/acme/web-app/actions/runs/1/job/2', job_started_at: '2026-11-20T10:00:05.000Z',
});

beforeAll(async () => {
  A = await harness.buildOrg();
  B = await harness.buildOrg();
  serviceA = (await harness.pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id) VALUES ('svc-detail', 'api', 'd8b2', 'active', $1) RETURNING id::text AS id`,
    [A.orgId])).rows[0].id;
  await harness.pool.query(
    `INSERT INTO pipeline_repositories (organization_id, github_repo_id, full_name) VALUES ($1, $2, 'acme/web-app'), ($3, $2, 'b-corp/secret'), ($3, $4, 'b-corp/only-b')`,
    [A.orgId, gh, B.orgId, ghBOnly]);
  await harness.listen((app) => app.use('/api/deployments', deploymentsRoutes));
});

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await harness.pool.query('DELETE FROM deployments WHERE organization_id = ANY($1)', [orgIds]);
    await harness.pool.query('DELETE FROM pipeline_repositories WHERE organization_id = ANY($1)', [orgIds]);
    await harness.pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [orgIds]);
  });
});

afterEach(() => jest.restoreAllMocks());

const detail = async (org: RoleGateOrg, id: string) => {
  const res = await harness.sendAs(org.orgId, org.viewer, 'GET', `/deployments/${id}`);
  return { status: res.status, body: await res.json() };
};

describe('GET /api/deployments/:id (D8b-2)', () => {
  it('a GitHub App row: its own organization\'s repository name, and the stored metadata as before', async () => {
    const id = await insert(A.orgId, serviceA, appMeta(gh));
    const { status, body } = await detail(A, id);
    expect(status).toBe(200);
    expect(body.data.github_repository).toEqual({ full_name: 'acme/web-app' });
    expect(body.data.metadata).toMatchObject({ html_url: 'https://github.com/acme/web-app/actions/runs/1/job/2', head_sha: 'a'.repeat(40) });
    expect(JSON.stringify(body)).not.toMatch(/b-corp/);
  });

  it('never another organization\'s repository: a GitHub id only B has -> no repository at all', async () => {
    const id = await insert(A.orgId, serviceA, appMeta(ghBOnly));
    const { body } = await detail(A, id);
    expect(body.data).not.toHaveProperty('github_repository');
    expect(JSON.stringify(body)).not.toMatch(/only-b/);
  });

  it('hand-recorded and legacy-webhook rows are unchanged: no repository lookup', async () => {
    for (const metadata of [{ source: 'manual' }, { source: 'github_actions', workflow_name: 'deploy', github_repo_id: gh }]) {
      const id = await insert(A.orgId, serviceA, metadata);
      const { status, body } = await detail(A, id);
      expect(status).toBe(200);
      expect(body.data).not.toHaveProperty('github_repository');
    }
  });

  it('another organization\'s deployment stays 404', async () => {
    const id = await insert(A.orgId, serviceA, appMeta(gh));
    expect((await detail(B, id)).status).toBe(404);
  });
});
