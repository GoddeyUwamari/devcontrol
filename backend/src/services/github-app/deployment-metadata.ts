/**
 * deployments.metadata for rows the GitHub App path writes (D8a-2): one
 * writer, one reader, both typed.
 *
 * The writer copies named keys from the normalized facts (themselves an
 * allowlist, normalize.ts); it never spreads them, so no field D8a-1 did not
 * name can reach a deployment row. D6 reads the merge stamp and D7 the job
 * timing and steps through readPipelineMetadata, never through raw JSON.
 *
 * Legacy webhook rows (source 'github_actions' without connection) and hand
 * records are not this shape; the reader returns null for them.
 */
import { DeploymentStatusFacts, PullRequestFacts, WorkflowJobFacts } from './contract';

export const PIPELINE_METADATA_VERSION = 1;
export const GITHUB_ACTIONS_SOURCE = 'github_actions';
export const GITHUB_DEPLOYMENTS_SOURCE = 'github_deployments';
export const GITHUB_APP_CONNECTION = 'github_app';

/** D7: a step trimmed to the four fields D7 reads. */
export interface PipelineStep {
  name: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/** D6: set only when a merged pull request with merge_commit_sha = head_sha was stored before the row. */
export interface MergeStamp {
  merged_at: string;
  merge_commit_sha: string;
  pr_number: number;
  merge_source: 'pull_request';
}

interface Common {
  connection: typeof GITHUB_APP_CONNECTION;
  pipeline_metadata_version: typeof PIPELINE_METADATA_VERSION;
  github_repo_id: number;
  head_sha: string | null;
}

export interface JobDeploymentMetadata extends Common, Partial<MergeStamp> {
  source: typeof GITHUB_ACTIONS_SOURCE;
  github_job_id: number;
  github_run_id: number | null;
  run_attempt: number | null;
  workflow_name: string | null;
  job_name: string | null;
  head_branch: string | null;
  html_url: string | null;
  conclusion: string | null;
  job_created_at: string | null;
  job_started_at: string | null;
  steps: PipelineStep[];
  steps_truncated: boolean;
}

export interface EnvironmentDeploymentMetadata extends Common, Partial<MergeStamp> {
  source: typeof GITHUB_DEPLOYMENTS_SOURCE;
  github_deployment_id: number;
  github_deployment_status_id: number;
  github_environment: string | null;
  ref: string | null;
  state: string | null;
}

export type PipelineDeploymentMetadata = JobDeploymentMetadata | EnvironmentDeploymentMetadata;

function mergeStamp(pr: PullRequestFacts | null): Partial<MergeStamp> {
  if (!pr || !pr.merged || !pr.merged_at || !pr.merge_commit_sha) return {};
  return { merged_at: pr.merged_at, merge_commit_sha: pr.merge_commit_sha, pr_number: pr.number, merge_source: 'pull_request' };
}

export function buildJobMetadata(job: WorkflowJobFacts, githubRepoId: number, pr: PullRequestFacts | null): JobDeploymentMetadata {
  return {
    source: GITHUB_ACTIONS_SOURCE,
    connection: GITHUB_APP_CONNECTION,
    pipeline_metadata_version: PIPELINE_METADATA_VERSION,
    github_repo_id: githubRepoId,
    github_job_id: job.job_id,
    github_run_id: job.run_id,
    run_attempt: job.run_attempt,
    workflow_name: job.workflow_name,
    job_name: job.job_name,
    head_sha: job.head_sha,
    head_branch: job.head_branch,
    html_url: job.html_url,
    conclusion: job.conclusion,
    job_created_at: job.created_at,
    job_started_at: job.started_at,
    steps: job.steps.map((s) => ({ name: s.name, conclusion: s.conclusion, started_at: s.started_at, completed_at: s.completed_at })),
    steps_truncated: job.steps_truncated,
    ...mergeStamp(pr),
  };
}

export function buildEnvironmentMetadata(
  status: DeploymentStatusFacts & { deployment_id: number },
  githubRepoId: number,
  pr: PullRequestFacts | null
): EnvironmentDeploymentMetadata {
  return {
    source: GITHUB_DEPLOYMENTS_SOURCE,
    connection: GITHUB_APP_CONNECTION,
    pipeline_metadata_version: PIPELINE_METADATA_VERSION,
    github_repo_id: githubRepoId,
    github_deployment_id: status.deployment_id,
    github_deployment_status_id: status.status_id,
    github_environment: status.environment,
    head_sha: status.sha,
    ref: status.ref,
    state: status.state,
    ...mergeStamp(pr),
  };
}

type Obj = Record<string, unknown>;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const posInt = (x: unknown): number | null => (typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : null);
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const iso = (x: unknown): string | null => (typeof x === 'string' && ISO.test(x) ? x : null);
const sha = (x: unknown): string | null => (typeof x === 'string' && SHA.test(x) ? x : null);

function readMergeStamp(m: Obj): Partial<MergeStamp> {
  const mergedAt = iso(m.merged_at);
  const mergeSha = sha(m.merge_commit_sha);
  const prNumber = posInt(m.pr_number);
  return mergedAt && mergeSha && prNumber && m.merge_source === 'pull_request'
    ? { merged_at: mergedAt, merge_commit_sha: mergeSha, pr_number: prNumber, merge_source: 'pull_request' }
    : {};
}

/**
 * A deployment row's metadata as the GitHub App wrote it, typed and
 * re-validated (named keys only), or null for any other row.
 */
export function readPipelineMetadata(metadata: unknown): PipelineDeploymentMetadata | null {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const m = metadata as Obj;
  if (m.connection !== GITHUB_APP_CONNECTION || m.pipeline_metadata_version !== PIPELINE_METADATA_VERSION) return null;
  const repoId = posInt(m.github_repo_id);
  if (!repoId) return null;
  const common = {
    connection: GITHUB_APP_CONNECTION,
    pipeline_metadata_version: PIPELINE_METADATA_VERSION,
    github_repo_id: repoId,
    head_sha: sha(m.head_sha),
  } as const;

  if (m.source === GITHUB_ACTIONS_SOURCE) {
    const jobId = posInt(m.github_job_id);
    if (!jobId) return null;
    const steps = Array.isArray(m.steps) ? m.steps : [];
    return {
      ...common,
      source: GITHUB_ACTIONS_SOURCE,
      github_job_id: jobId,
      github_run_id: posInt(m.github_run_id),
      run_attempt: posInt(m.run_attempt),
      workflow_name: str(m.workflow_name),
      job_name: str(m.job_name),
      head_branch: str(m.head_branch),
      html_url: str(m.html_url),
      conclusion: str(m.conclusion),
      job_created_at: iso(m.job_created_at),
      job_started_at: iso(m.job_started_at),
      steps: steps
        .filter((s): s is Obj => s !== null && typeof s === 'object' && !Array.isArray(s))
        .map((s) => ({ name: str(s.name) ?? '', conclusion: str(s.conclusion), started_at: iso(s.started_at), completed_at: iso(s.completed_at) })),
      steps_truncated: m.steps_truncated === true,
      ...readMergeStamp(m),
    };
  }
  if (m.source === GITHUB_DEPLOYMENTS_SOURCE) {
    const deploymentId = posInt(m.github_deployment_id);
    const statusId = posInt(m.github_deployment_status_id);
    if (!deploymentId || !statusId) return null;
    return {
      ...common,
      source: GITHUB_DEPLOYMENTS_SOURCE,
      github_deployment_id: deploymentId,
      github_deployment_status_id: statusId,
      github_environment: str(m.github_environment),
      ref: str(m.ref),
      state: str(m.state),
      ...readMergeStamp(m),
    };
  }
  return null;
}
