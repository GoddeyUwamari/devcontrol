/**
 * Synthetic GitHub App delivery payloads for D8a tests. Shapes follow
 * GitHub's documented webhook payloads; every id, login, SHA and URL is a
 * placeholder. Each payload also carries fields the normalizer must NOT keep
 * (commit messages, emails, PR body, an "organization_id"), so the tests can
 * prove they are dropped.
 */
import crypto from 'crypto';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);
export const SHA_MERGE = 'c0ffee0000000000000000000000000000000001';

/** A unique positive id per call, inside the safe-integer range. */
let counter = 0;
export function uniqueId(base = 7_000_000_000): number {
  counter += 1;
  return base + (Date.now() % 1_000_000_000) + counter * 13 + Math.floor(Math.random() * 1000);
}

export const PLANTED = {
  commitMessage: 'PLANTED-COMMIT-MESSAGE do not store',
  email: 'planted-author@example.com',
  prBody: 'PLANTED-PR-BODY do not store',
  foreignOrg: '00000000-0000-4000-8000-00000000dead',
};

export function repository(id: number, fullName = `acme/repo-${id}`) {
  return {
    id,
    name: fullName.split('/')[1],
    full_name: fullName,
    default_branch: 'main',
    private: true,
    owner: { id: 501, login: 'acme', avatar_url: 'https://avatars.example.com/u/501' },
    url: `https://api.github.com/repos/${fullName}`,
    organization_id: PLANTED.foreignOrg,
  };
}

const sender = { id: 9001, login: 'octo-dev', avatar_url: 'https://avatars.example.com/u/9001', email: PLANTED.email };

export function workflowJobCompleted(installationId: number, repoId: number, opts: { jobId?: number; fullName?: string; steps?: number; conclusion?: string } = {}) {
  const jobId = opts.jobId ?? uniqueId();
  return {
    action: 'completed',
    organization_id: PLANTED.foreignOrg,
    installation: { id: installationId, node_id: 'MDIz' },
    repository: repository(repoId, opts.fullName),
    sender,
    workflow_job: {
      id: jobId,
      run_id: jobId - 1,
      run_attempt: 2,
      name: 'deploy-backend',
      workflow_name: 'CI',
      head_sha: SHA_A,
      head_branch: 'main',
      status: 'completed',
      conclusion: opts.conclusion ?? 'success',
      created_at: '2026-11-20T10:00:00Z',
      started_at: '2026-11-20T10:00:05Z',
      completed_at: '2026-11-20T10:07:30Z',
      html_url: `https://github.com/acme/repo/actions/runs/${jobId - 1}/job/${jobId}`,
      runner_name: 'runner-1',
      labels: ['ubuntu-latest'],
      steps: Array.from({ length: opts.steps ?? 3 }, (_, i) => ({
        name: i === 1 ? 'Smoke test new deploy' : `Step ${i + 1}`,
        status: 'completed',
        conclusion: i === 1 ? 'failure' : 'success',
        number: i + 1,
        started_at: '2026-11-20T10:01:00Z',
        completed_at: '2026-11-20T10:02:00Z',
      })),
    },
  };
}

export function workflowRunCompleted(installationId: number, repoId: number) {
  const runId = uniqueId();
  return {
    action: 'completed',
    installation: { id: installationId },
    repository: repository(repoId),
    sender,
    workflow_run: {
      id: runId,
      run_attempt: 1,
      workflow_id: 77,
      name: 'CI',
      path: '.github/workflows/ci.yml',
      event: 'push',
      head_sha: SHA_A,
      head_branch: 'main',
      status: 'completed',
      conclusion: 'success',
      created_at: '2026-11-20T10:00:00Z',
      run_started_at: '2026-11-20T10:00:01Z',
      updated_at: '2026-11-20T10:08:00Z',
      triggering_actor: { id: 9001, login: 'octo-dev' },
      pull_requests: [{ id: 3001, number: 42, head: { sha: SHA_B, ref: 'feature' }, base: { sha: SHA_A, ref: 'main' } }],
      head_commit: {
        id: SHA_A,
        timestamp: '2026-11-20T09:59:00-05:00',
        message: PLANTED.commitMessage,
        author: { name: 'Octo Dev', email: PLANTED.email },
        committer: { name: 'GitHub', email: 'noreply@github.com' },
      },
    },
  };
}

export function pullRequestClosed(installationId: number, repoId: number, opts: { merged?: boolean; prId?: number; title?: string } = {}) {
  const prId = opts.prId ?? uniqueId();
  const merged = opts.merged ?? true;
  return {
    action: 'closed',
    number: 42,
    installation: { id: installationId },
    repository: repository(repoId),
    sender,
    pull_request: {
      id: prId,
      number: 42,
      title: opts.title ?? 'Revert "Add feature"',
      body: PLANTED.prBody,
      user: { id: 9001, login: 'octo-dev', email: PLANTED.email },
      created_at: '2026-11-19T08:00:00Z',
      updated_at: '2026-11-20T09:58:00Z',
      closed_at: '2026-11-20T09:58:00Z',
      merged_at: merged ? '2026-11-20T09:58:00Z' : null,
      merged,
      merge_commit_sha: SHA_MERGE,
      head: { sha: SHA_B, ref: 'feature' },
      base: { sha: SHA_A, ref: 'main' },
    },
  };
}

export function deploymentCreated(installationId: number, repoId: number) {
  return {
    action: 'created',
    installation: { id: installationId },
    repository: repository(repoId),
    sender,
    deployment: {
      id: uniqueId(), sha: SHA_A, ref: 'main', environment: 'production', task: 'deploy',
      production_environment: true, transient_environment: false, created_at: '2026-11-20T10:02:00Z',
      creator: { id: 9001, login: 'octo-dev' }, payload: { secret_looking: 'not stored' }, description: 'free text not stored',
    },
  };
}

export function deploymentStatusCreated(installationId: number, repoId: number) {
  return {
    action: 'created',
    installation: { id: installationId },
    repository: repository(repoId),
    sender,
    deployment_status: { id: uniqueId(), state: 'success', environment: 'production', created_at: '2026-11-20T10:09:00Z', description: 'not stored' },
    deployment: { id: uniqueId(), sha: SHA_A, ref: 'main', environment: 'production' },
  };
}

export function installationCreated(installationId: number, installerId: number, repos: Array<{ id: number; full_name: string }> = []) {
  return {
    action: 'created',
    installation: {
      id: installationId,
      account: { id: 777, login: 'acme', type: 'Organization', avatar_url: 'https://avatars.example.com/u/777' },
      repository_selection: 'selected',
      permissions: { actions: 'read', deployments: 'read', metadata: 'read', pull_requests: 'read' },
      events: ['workflow_job', 'workflow_run', 'deployment', 'deployment_status', 'pull_request'],
      access_tokens_url: 'https://api.github.com/app/installations/1/access_tokens',
    },
    repositories: repos.map((r) => ({ ...r, name: r.full_name.split('/')[1], private: true })),
    sender: { id: installerId, login: `installer-${installerId}` },
  };
}

export function installationEvent(installationId: number, action: 'deleted' | 'suspend' | 'unsuspend' | 'new_permissions_accepted') {
  return {
    action,
    installation: {
      id: installationId,
      account: { id: 777, login: 'acme', type: 'Organization' },
      repository_selection: 'selected',
      permissions: { actions: 'read', deployments: 'read', metadata: 'read', pull_requests: 'read' },
      events: ['workflow_job'],
    },
    sender: { id: 9001, login: 'octo-dev' },
  };
}

export function installationRepositories(installationId: number, added: Array<{ id: number; full_name: string }>, removed: Array<{ id: number; full_name: string }>) {
  return {
    action: added.length > 0 ? 'added' : 'removed',
    installation: { id: installationId },
    repository_selection: 'selected',
    repositories_added: added,
    repositories_removed: removed,
    sender,
  };
}

/** Raw bytes + headers as GitHub would send them, signed with `secret`. */
export function signedDelivery(event: string, payload: unknown, secret: string, deliveryId: string = crypto.randomUUID()) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return {
    rawBody,
    deliveryId,
    headers: {
      'x-github-event': event,
      'x-github-delivery': deliveryId,
      'x-hub-signature-256': signature,
      'content-type': 'application/json',
    } as Record<string, string>,
  };
}
