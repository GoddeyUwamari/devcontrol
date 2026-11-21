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
