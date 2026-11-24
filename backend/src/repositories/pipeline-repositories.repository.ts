/**
 * pipeline_repositories: one row per (organization, GitHub repository id).
 * Keyed by GitHub's stable numeric repository id, never by name, so a
 * rename or a transfer updates the row and every event keeps pointing at it.
 * A repository is never mapped to a service automatically, and never removed:
 * losing access only marks it 'removed'.
 *
 * Row level security is forced; every statement also names organization_id.
 */
import { PoolClient } from 'pg';
import type { RepositoryForEvent } from '../services/github-app/detect';

interface RepositoryUpsert {
  githubRepoId: number;
  installationId: number;
  fullName: string;
  defaultBranch: string | null;
  /** When GitHub says this was true (event time, or now for an API listing). */
  at: string;
}

interface PipelineRepositoryRow {
  id: string;
  github_repo_id: string;
  installation_id: string | null;
  full_name: string;
  default_branch: string | null;
  service_id: string | null;
  service_name: string | null;
  deploy_rule: Record<string, unknown> | null;
  access_state: 'accessible' | 'removed';
  removed_at: Date | null;
  last_event_at: Date | null;
}

/**
 * Creates the row, or updates it with facts newer than what it holds: an
 * older, late delivery never reverts a rename, and never re-adds a repository
 * removed after it.
 */
export async function upsertRepository(client: PoolClient, organizationId: string, repo: RepositoryUpsert): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO pipeline_repositories AS r
       (organization_id, github_repo_id, installation_id, full_name, default_branch, last_event_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
     ON CONFLICT (organization_id, github_repo_id) DO UPDATE SET
       installation_id = CASE WHEN r.last_event_at IS NULL OR EXCLUDED.last_event_at >= r.last_event_at
                              THEN EXCLUDED.installation_id ELSE r.installation_id END,
       full_name       = CASE WHEN r.last_event_at IS NULL OR EXCLUDED.last_event_at >= r.last_event_at
                              THEN EXCLUDED.full_name ELSE r.full_name END,
       default_branch  = CASE WHEN EXCLUDED.default_branch IS NOT NULL
                               AND (r.last_event_at IS NULL OR EXCLUDED.last_event_at >= r.last_event_at)
                              THEN EXCLUDED.default_branch ELSE r.default_branch END,
       access_state    = CASE WHEN r.removed_at IS NULL OR EXCLUDED.last_event_at > r.removed_at
                              THEN 'accessible' ELSE r.access_state END,
       removed_at      = CASE WHEN r.removed_at IS NULL OR EXCLUDED.last_event_at > r.removed_at
                              THEN NULL ELSE r.removed_at END,
       last_event_at   = GREATEST(r.last_event_at, EXCLUDED.last_event_at),
       updated_at      = NOW()
     WHERE r.organization_id = $1
     RETURNING id`,
    [organizationId, repo.githubRepoId, repo.installationId, repo.fullName, repo.defaultBranch, repo.at]
  );
  return rows[0]?.id ?? '';
}

/** GitHub no longer gives the installation access. The row and its mapping stay. */
export async function markRepositoryRemoved(
  client: PoolClient,
  organizationId: string,
  githubRepoId: number,
  at: string
): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE pipeline_repositories
        SET access_state = 'removed', removed_at = $3::timestamptz, updated_at = NOW()
      WHERE organization_id = $1 AND github_repo_id = $2
        AND (last_event_at IS NULL OR last_event_at <= $3::timestamptz)`,
    [organizationId, githubRepoId, at]
  );
  return rowCount ?? 0;
}

export async function listRepositories(client: PoolClient, organizationId: string): Promise<PipelineRepositoryRow[]> {
  const { rows } = await client.query<PipelineRepositoryRow>(
    `SELECT r.id, r.github_repo_id::text AS github_repo_id, r.installation_id::text AS installation_id, r.full_name,
            r.default_branch, r.service_id, s.name AS service_name, r.deploy_rule, r.access_state, r.removed_at, r.last_event_at
       FROM pipeline_repositories r
       LEFT JOIN services s ON s.id = r.service_id AND s.organization_id = r.organization_id
      WHERE r.organization_id = $1
      ORDER BY lower(r.full_name), r.id`,
    [organizationId]
  );
  return rows;
}

/**
 * Maps a repository to one of the organization's services, or unmaps it
 * (serviceId null). Returns false when the repository row or the service is
 * not the organization's (the caller answers 404 either way). The
 * same-organization trigger enforces the service rule in the database too.
 */
export async function setRepositoryService(
  client: PoolClient,
  organizationId: string,
  repositoryRowId: string,
  serviceId: string | null
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE pipeline_repositories r
        SET service_id = $3::uuid, updated_at = NOW()
      WHERE r.organization_id = $1 AND r.id = $2::uuid
        AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM services s WHERE s.id = $3::uuid AND s.organization_id = $1))`,
    [organizationId, repositoryRowId, serviceId]
  );
  return (rowCount ?? 0) === 1;
}

/** The mapping and rule the deploy detector needs for one repository (D8a-2), or null. */
export async function findRepositoryForEvent(
  client: PoolClient,
  organizationId: string,
  githubRepoId: number
): Promise<RepositoryForEvent | null> {
  const { rows } = await client.query(
    `SELECT github_repo_id::text AS github_repo_id, service_id::text AS service_id, default_branch, deploy_rule
       FROM pipeline_repositories
      WHERE organization_id = $1 AND github_repo_id = $2`,
    [organizationId, githubRepoId]
  );
  if (rows.length === 0) return null;
  return {
    githubRepoId: Number(rows[0].github_repo_id),
    serviceId: rows[0].service_id,
    defaultBranch: rows[0].default_branch,
    deployRule: rows[0].deploy_rule,
  };
}

/**
 * Stores a validated deploy rule (deploy-rule.ts) on one of the organization's
 * repositories. Returns the repository's GitHub id, or null when the row is
 * not the organization's (the caller answers 404).
 */
export async function setRepositoryDeployRule(
  client: PoolClient,
  organizationId: string,
  repositoryRowId: string,
  storedRule: Record<string, unknown>
): Promise<number | null> {
  const { rows } = await client.query<{ github_repo_id: string }>(
    `UPDATE pipeline_repositories
        SET deploy_rule = $3::jsonb, updated_at = NOW()
      WHERE organization_id = $1 AND id = $2::uuid
      RETURNING github_repo_id::text AS github_repo_id`,
    [organizationId, repositoryRowId, JSON.stringify(storedRule)]
  );
  return rows.length === 1 ? Number(rows[0].github_repo_id) : null;
}

/** The GitHub id of one of the organization's repository rows, or null. */
export async function githubRepoIdOf(client: PoolClient, organizationId: string, repositoryRowId: string): Promise<number | null> {
  const { rows } = await client.query<{ github_repo_id: string }>(
    `SELECT github_repo_id::text AS github_repo_id FROM pipeline_repositories WHERE organization_id = $1 AND id = $2::uuid`,
    [organizationId, repositoryRowId]
  );
  return rows.length === 1 ? Number(rows[0].github_repo_id) : null;
}

interface JobSeen {
  workflow_name: string | null;
  job_name: string | null;
  head_branch: string | null;
  runs: number;
  last_seen_at: Date;
}

export const JOBS_SEEN_DAYS = 30;
export const JOBS_SEEN_LIMIT = 50;

/**
 * Completed jobs DevControl has received for one repository in the last 30
 * days (the deploy-job picker, D8b): distinct workflow, job and branch, newest
 * first, at most 50.
 */
export async function listJobsSeen(client: PoolClient, organizationId: string, githubRepoId: number): Promise<JobSeen[]> {
  const { rows } = await client.query(
    `SELECT facts ->> 'workflow_name' AS workflow_name, facts ->> 'job_name' AS job_name, facts ->> 'head_branch' AS head_branch,
            count(*)::int AS runs, max(received_at) AS last_seen_at
       FROM pipeline_events
      WHERE organization_id = $1 AND github_repo_id = $2 AND event = 'workflow_job'
        AND received_at >= NOW() - make_interval(days => $3)
      GROUP BY 1, 2, 3
      ORDER BY max(received_at) DESC, 1, 2, 3
      LIMIT $4`,
    [organizationId, githubRepoId, JOBS_SEEN_DAYS, JOBS_SEEN_LIMIT]
  );
  return rows;
}

/**
 * D8b-2: what the GitHub screen's repository table shows per repository, all
 * read from what DevControl has actually stored for this organization. Keyed
 * by the GitHub repository id (text).
 *
 *   held          deployment-candidate events (workflow_job, deployment_status)
 *                 received in the last HELD_EVENT_DAYS that a mapping or rule
 *                 replay would pick up (ruling R1: same window as the replay):
 *                   waiting  unmapped, or pending (not yet processed), except
 *                            events held for a claim (installation_not_claimed:
 *                            only a re-claim releases those)
 *                   noRule   ignored as no_deploy_rule / deploy_rule_invalid
 *   environments  GitHub environment names seen on deployment events (30 days, <= 50)
 *   jobs          workflow + job names seen on completed jobs (30 days, <= 50)
 *   lastDeployment the newest deployment row this repository recorded through the
 *                 GitHub App (by repository, whatever service it went to)
 *   overLimit     distinct jobs / deployments refused as over the monthly limit
 *                 in the current month (the deployment's own month, as the quota
 *                 counts it), with no deployment row for that job / deployment
 */
export interface RepositoryActivity {
  waiting: number;
  noRule: number;
  environments: string[];
  jobs: { workflow_name: string; job_name: string }[];
  lastDeployment: Date | null;
  overLimit: number;
}

export const SEEN_DAYS = JOBS_SEEN_DAYS;
export const SEEN_LIMIT = JOBS_SEEN_LIMIT;

export async function listRepositoryActivity(
  client: PoolClient,
  organizationId: string,
  heldEventDays: number,
  notClaimedReason: string
): Promise<Map<string, RepositoryActivity>> {
  const byRepo = new Map<string, RepositoryActivity>();
  const entry = (repo: string): RepositoryActivity => {
    let e = byRepo.get(repo);
    if (!e) {
      e = { waiting: 0, noRule: 0, environments: [], jobs: [], lastDeployment: null, overLimit: 0 };
      byRepo.set(repo, e);
    }
    return e;
  };

  const held = await client.query<{ repo: string; waiting: number; no_rule: number }>(
    `SELECT github_repo_id::text AS repo,
            count(*) FILTER (WHERE processing_status = 'unmapped'
                               OR (processing_status = 'pending' AND processing_reason IS DISTINCT FROM $3))::int AS waiting,
            count(*) FILTER (WHERE processing_status = 'ignored'
                               AND processing_reason IN ('no_deploy_rule', 'deploy_rule_invalid'))::int AS no_rule
       FROM pipeline_events
      WHERE organization_id = $1 AND github_repo_id IS NOT NULL AND event IN ('workflow_job', 'deployment_status')
        AND received_at >= NOW() - make_interval(days => $2)
      GROUP BY 1`,
    [organizationId, heldEventDays, notClaimedReason]
  );
  for (const r of held.rows) Object.assign(entry(r.repo), { waiting: r.waiting, noRule: r.no_rule });

  const environments = await client.query<{ repo: string; name: string }>(
    `SELECT github_repo_id::text AS repo, facts ->> 'environment' AS name
       FROM pipeline_events
      WHERE organization_id = $1 AND github_repo_id IS NOT NULL AND event IN ('deployment', 'deployment_status')
        AND facts ->> 'environment' IS NOT NULL AND received_at >= NOW() - make_interval(days => $2)
      GROUP BY 1, 2
      ORDER BY 1, max(received_at) DESC, 2`,
    [organizationId, SEEN_DAYS]
  );
  for (const r of environments.rows) {
    const e = entry(r.repo);
    const name = r.name.trim();
    // Names are matched without case: one entry per name, the newest spelling.
    if (name && e.environments.length < SEEN_LIMIT && !e.environments.some((n) => n.toLowerCase() === name.toLowerCase())) {
      e.environments.push(name);
    }
  }

  const jobs = await client.query<{ repo: string; workflow_name: string; job_name: string }>(
    `SELECT github_repo_id::text AS repo, facts ->> 'workflow_name' AS workflow_name, facts ->> 'job_name' AS job_name
       FROM pipeline_events
      WHERE organization_id = $1 AND github_repo_id IS NOT NULL AND event = 'workflow_job'
        AND facts ->> 'workflow_name' IS NOT NULL AND facts ->> 'job_name' IS NOT NULL
        AND received_at >= NOW() - make_interval(days => $2)
      GROUP BY 1, 2, 3
      ORDER BY 1, max(received_at) DESC, 2, 3`,
    [organizationId, SEEN_DAYS]
  );
  for (const r of jobs.rows) {
    const e = entry(r.repo);
    if (e.jobs.length < SEEN_LIMIT) e.jobs.push({ workflow_name: r.workflow_name, job_name: r.job_name });
  }

  const last = await client.query<{ repo: string; at: Date }>(
    `SELECT metadata ->> 'github_repo_id' AS repo, max(deployed_at) AS at
       FROM deployments
      WHERE organization_id = $1 AND metadata ->> 'connection' = 'github_app' AND metadata ? 'github_repo_id'
      GROUP BY 1`,
    [organizationId]
  );
  for (const r of last.rows) if (r.repo) entry(r.repo).lastDeployment = r.at;

  const overLimit = await client.query<{ repo: string; n: number }>(
    `SELECT e.github_repo_id::text AS repo,
            count(DISTINCT (e.event, COALESCE(e.facts ->> 'job_id', e.facts ->> 'deployment_id')))::int AS n
       FROM pipeline_events e
      WHERE e.organization_id = $1 AND e.github_repo_id IS NOT NULL AND e.processing_status = 'over_limit'
        AND e.event IN ('workflow_job', 'deployment_status')
        AND date_trunc('month', COALESCE(
              CASE WHEN e.event = 'workflow_job' THEN (e.facts ->> 'completed_at')::timestamptz ELSE (e.facts ->> 'created_at')::timestamptz END,
              e.received_at)) = date_trunc('month', NOW())
        AND NOT EXISTS (
              SELECT 1 FROM deployments d
               WHERE d.organization_id = e.organization_id
                 AND ((e.event = 'workflow_job' AND d.metadata ? 'github_job_id' AND d.metadata ->> 'github_job_id' = e.facts ->> 'job_id')
                   OR (e.event = 'deployment_status' AND d.metadata ? 'github_deployment_id'
                       AND d.metadata ->> 'github_deployment_id' = e.facts ->> 'deployment_id')))
      GROUP BY 1`,
    [organizationId]
  );
  for (const r of overLimit.rows) entry(r.repo).overLimit = r.n;

  return byRepo;
}
