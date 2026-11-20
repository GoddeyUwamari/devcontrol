/**
 * The D6/D7 consumption contract for GitHub App events (d8a-build.md §1.7).
 *
 * pipeline_events.facts holds exactly one of the shapes below, written by
 * normalize.ts (an allowlist: nothing else from a payload is ever stored).
 * Readers use PipelineEventsReader (repositories/pipeline-events.repository.ts)
 * and never parse HTTP requests or raw payloads.
 *
 * Rules: within one NORMALIZER_VERSION fields are only ever added. Removing or
 * renaming a field needs a new version, and readers handle both. Every
 * timestamp is an ISO 8601 UTC string or null (validated on write, never the
 * raw payload string); every SHA is 40 (or 64) lowercase hex or null.
 */
export const NORMALIZER_VERSION = 1;

export const SUPPORTED_EVENTS = [
  'workflow_job',
  'workflow_run',
  'deployment',
  'deployment_status',
  'pull_request',
  'installation',
  'installation_repositories',
] as const;
export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];

/** Actions stored per event (D8-D4); every other action is acknowledged without a row. */
export const PERSISTED_ACTIONS: Readonly<Record<SupportedEvent, readonly string[]>> = {
  workflow_job: ['completed'],
  workflow_run: ['completed'],
  deployment: ['created'],
  deployment_status: ['created'],
  pull_request: ['opened', 'reopened', 'closed'],
  installation: ['created', 'deleted', 'suspend', 'unsuspend', 'new_permissions_accepted'],
  installation_repositories: ['added', 'removed'],
};

export interface GitHubUserRef {
  id: number;
  login: string;
}

export interface RepositoryRef {
  id: number;
  full_name: string;
  default_branch: string | null;
}

export interface RepositoryBrief {
  id: number;
  full_name: string;
}

interface Common {
  repository: RepositoryRef | null;
  sender: GitHubUserRef | null;
}

export interface WorkflowJobStep {
  number: number | null;
  name: string;
  status: string | null;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

/** D7 reads steps, started_at and run_attempt; D8a-2 records deployments from it. */
export interface WorkflowJobFacts extends Common {
  kind: 'workflow_job';
  job_id: number;
  run_id: number | null;
  run_attempt: number | null;
  job_name: string | null;
  workflow_name: string | null;
  head_sha: string | null;
  head_branch: string | null;
  status: string | null;
  conclusion: string | null;
  created_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string | null;
  steps: WorkflowJobStep[];
  steps_truncated: boolean;
}

export interface WorkflowRunPullRequest {
  id: number | null;
  number: number;
  head_sha: string | null;
  base_ref: string | null;
}

export interface WorkflowRunFacts extends Common {
  kind: 'workflow_run';
  run_id: number;
  run_attempt: number | null;
  workflow_id: number | null;
  name: string | null;
  path: string | null;
  event: string | null;
  head_sha: string | null;
  head_branch: string | null;
  status: string | null;
  conclusion: string | null;
  created_at: string | null;
  run_started_at: string | null;
  updated_at: string | null;
  triggering_actor: GitHubUserRef | null;
  pull_requests: WorkflowRunPullRequest[];
  /** Commit id and timestamp only: never the message or the author. */
  head_commit: { id: string | null; timestamp: string | null } | null;
}

export interface DeploymentFacts extends Common {
  kind: 'deployment';
  deployment_id: number;
  sha: string | null;
  ref: string | null;
  environment: string | null;
  task: string | null;
  production_environment: boolean | null;
  transient_environment: boolean | null;
  created_at: string | null;
  creator: GitHubUserRef | null;
}

export interface DeploymentStatusFacts extends Common {
  kind: 'deployment_status';
  status_id: number;
  deployment_id: number | null;
  state: string | null;
  environment: string | null;
  created_at: string | null;
  sha: string | null;
  ref: string | null;
}

/** D6 reads merged, merged_at and merge_commit_sha (joined to a deploy's head_sha). */
export interface PullRequestFacts extends Common {
  kind: 'pull_request';
  pr_id: number;
  number: number;
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head_sha: string | null;
  head_ref: string | null;
  base_ref: string | null;
  created_at: string | null;
  closed_at: string | null;
  /** At most 256 characters (D8-N7). The body is never stored. */
  title: string | null;
  user: GitHubUserRef | null;
}

export interface InstallationFacts extends Common {
  kind: 'installation';
  account: { id: number; login: string; type: string } | null;
  repository_selection: 'all' | 'selected' | null;
  permissions: Record<string, string>;
  events: string[];
  repositories: RepositoryBrief[];
  repositories_truncated: boolean;
}

export interface InstallationRepositoriesFacts extends Common {
  kind: 'installation_repositories';
  repository_selection: 'all' | 'selected' | null;
  added: RepositoryBrief[];
  removed: RepositoryBrief[];
  truncated: boolean;
}

export type EventFacts =
  | WorkflowJobFacts
  | WorkflowRunFacts
  | DeploymentFacts
  | DeploymentStatusFacts
  | PullRequestFacts
  | InstallationFacts
  | InstallationRepositoriesFacts;

/** What the webhook stores for one delivery (plus delivery id, organization, payload hash). */
export interface NormalizedDelivery {
  event: SupportedEvent;
  action: string;
  installationId: number;
  githubRepoId: number | null;
  eventKey: string | null;
  occurredAt: string | null;
  facts: EventFacts;
}

/** One stored event as D6/D7 read it. */
export interface StoredPipelineEvent<F extends EventFacts = EventFacts> {
  id: string;
  deliveryId: string;
  organizationId: string;
  installationId: string;
  githubRepoId: string | null;
  event: SupportedEvent;
  action: string;
  occurredAt: Date | null;
  receivedAt: Date;
  normalizerVersion: number;
  facts: F;
  processingStatus: string;
}
