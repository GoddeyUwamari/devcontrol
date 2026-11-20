/**
 * Allowlist normalizer for GitHub App deliveries (d8a-build.md D8-D15).
 *
 * Copies named fields only, each validated and bounded. It never copies a
 * commit message, an author or committer email, a PR body, an avatar or API
 * URL, or any field it does not name -- including any "organization_id" a
 * payload might carry: the organization comes only from the installation
 * claim. Pure: no I/O, no clock.
 */
import {
  EventFacts,
  GitHubUserRef,
  NORMALIZER_VERSION,
  NormalizedDelivery,
  PERSISTED_ACTIONS,
  RepositoryBrief,
  RepositoryRef,
  SUPPORTED_EVENTS,
  SupportedEvent,
  WorkflowJobStep,
  WorkflowRunPullRequest,
} from './contract';

export { NORMALIZER_VERSION };

type NormalizeResult =
  | { kind: 'record'; record: NormalizedDelivery }
  | { kind: 'ignored'; reason: 'unsupported_event' | 'unsupported_action' | 'no_installation' | 'malformed' };

const MAX_STEPS = 100;
const MAX_RUN_PULL_REQUESTS = 20;
const MAX_INSTALLATION_REPOSITORIES = 100;
const MAX_REPOSITORY_CHANGES = 500;
export const MAX_TITLE_LENGTH = 256;

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** A positive safe integer id, or null. */
function id(x: unknown): number | null {
  return typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : null;
}

/** Printable text, control characters removed, at most `max` characters, or null. */
function text(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null;
  const cleaned = x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, max);
}

/** A lowercase token (status, conclusion, state, event name), or null. */
function token(x: unknown): string | null {
  return typeof x === 'string' && /^[a-z_]{1,32}$/.test(x) ? x : null;
}

function sha(x: unknown): string | null {
  return typeof x === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(x) ? x : null;
}

/** ISO 8601 date-time in UTC, or null. Never the raw payload string. */
export function isoTimestamp(x: unknown): string | null {
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(x)) return null;
  const ms = Date.parse(x);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function bool(x: unknown): boolean | null {
  return typeof x === 'boolean' ? x : null;
}

function githubUrl(x: unknown): string | null {
  return typeof x === 'string' && x.startsWith('https://github.com/') && x.length <= 500 && !/\s/.test(x) ? x : null;
}

function user(x: unknown): GitHubUserRef | null {
  const o = obj(x);
  const userId = id(o?.id);
  const login = text(o?.login, 100);
  return userId && login ? { id: userId, login } : null;
}

function repository(x: unknown): RepositoryRef | null {
  const o = obj(x);
  const repoId = id(o?.id);
  const fullName = text(o?.full_name, 255);
  if (!repoId || !fullName || !fullName.includes('/')) return null;
  return { id: repoId, full_name: fullName, default_branch: text(o?.default_branch, 255) };
}

function repositoryBriefs(x: unknown, max: number): { list: RepositoryBrief[]; truncated: boolean } {
  const all = arr(x)
    .map((r) => repository(r))
    .filter((r): r is RepositoryRef => r !== null)
    .map((r) => ({ id: r.id, full_name: r.full_name }));
  return { list: all.slice(0, max), truncated: all.length > max };
}

function steps(x: unknown): { list: WorkflowJobStep[]; truncated: boolean } {
  const all = arr(x)
    .map(obj)
    .filter((s): s is Obj => s !== null)
    .map((s) => ({
      number: typeof s.number === 'number' && Number.isSafeInteger(s.number) && s.number >= 0 ? s.number : null,
      name: text(s.name, 200) ?? '',
      status: token(s.status),
      conclusion: token(s.conclusion),
      started_at: isoTimestamp(s.started_at),
      completed_at: isoTimestamp(s.completed_at),
    }));
  return { list: all.slice(0, MAX_STEPS), truncated: all.length > MAX_STEPS };
}

function permissions(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, level] of Object.entries(obj(x) ?? {}).slice(0, 100)) {
    if (/^[a-z_]{1,64}$/.test(name) && (level === 'read' || level === 'write' || level === 'admin')) out[name] = level;
  }
  return out;
}

function eventNames(x: unknown): string[] {
  return arr(x).filter((e): e is string => typeof e === 'string' && /^[a-z_]{1,64}$/.test(e)).slice(0, 100);
}

function selection(x: unknown): 'all' | 'selected' | null {
  return x === 'all' || x === 'selected' ? x : null;
}

const isSupported = (event: string): event is SupportedEvent => (SUPPORTED_EVENTS as readonly string[]).includes(event);

/**
 * One delivery's payload -> the record to store, or why it is not stored.
 * `event` is the X-GitHub-Event header value.
 */
export function normalizeDelivery(event: string, payload: unknown): NormalizeResult {
  if (!isSupported(event)) return { kind: 'ignored', reason: 'unsupported_event' };
  const p = obj(payload);
  if (!p) return { kind: 'ignored', reason: 'malformed' };
  const action = token(p.action);
  if (!action || !PERSISTED_ACTIONS[event].includes(action)) return { kind: 'ignored', reason: 'unsupported_action' };
  const installationId = id(obj(p.installation)?.id);
  if (!installationId) return { kind: 'ignored', reason: 'no_installation' };

  const repo = repository(p.repository);
  const sender = user(p.sender);
  const common = { repository: repo, sender };
  const record = (facts: EventFacts, occurredAt: string | null, eventKey: string | null): NormalizeResult => ({
    kind: 'record',
    record: { event, action, installationId, githubRepoId: repo?.id ?? null, eventKey, occurredAt, facts },
  });
  const needsRepository = event !== 'installation' && event !== 'installation_repositories';
  if (needsRepository && !repo) return { kind: 'ignored', reason: 'malformed' };

  switch (event) {
    case 'workflow_job': {
      const job = obj(p.workflow_job);
      const jobId = id(job?.id);
      if (!job || !jobId) return { kind: 'ignored', reason: 'malformed' };
      const s = steps(job.steps);
      const completedAt = isoTimestamp(job.completed_at);
      return record({
        kind: 'workflow_job', ...common,
        job_id: jobId,
        run_id: id(job.run_id),
        run_attempt: id(job.run_attempt),
        job_name: text(job.name, 200),
        workflow_name: text(job.workflow_name, 200),
        head_sha: sha(job.head_sha),
        head_branch: text(job.head_branch, 255),
        status: token(job.status),
        conclusion: token(job.conclusion),
        created_at: isoTimestamp(job.created_at),
        started_at: isoTimestamp(job.started_at),
        completed_at: completedAt,
        html_url: githubUrl(job.html_url),
        steps: s.list,
        steps_truncated: s.truncated,
      }, completedAt, `workflow_job:${jobId}:${action}`);
    }
    case 'workflow_run': {
      const run = obj(p.workflow_run);
      const runId = id(run?.id);
      if (!run || !runId) return { kind: 'ignored', reason: 'malformed' };
      const attempt = id(run.run_attempt);
      const prs: WorkflowRunPullRequest[] = arr(run.pull_requests)
        .map(obj)
        .filter((pr): pr is Obj => pr !== null && id(pr.number) !== null)
        .slice(0, MAX_RUN_PULL_REQUESTS)
        .map((pr) => ({ id: id(pr.id), number: id(pr.number)!, head_sha: sha(obj(pr.head)?.sha), base_ref: text(obj(pr.base)?.ref, 255) }));
      const headCommit = obj(run.head_commit);
      const updatedAt = isoTimestamp(run.updated_at);
      return record({
        kind: 'workflow_run', ...common,
        run_id: runId,
        run_attempt: attempt,
        workflow_id: id(run.workflow_id),
        name: text(run.name, 200),
        path: text(run.path, 255),
        event: token(run.event),
        head_sha: sha(run.head_sha),
        head_branch: text(run.head_branch, 255),
        status: token(run.status),
        conclusion: token(run.conclusion),
        created_at: isoTimestamp(run.created_at),
        run_started_at: isoTimestamp(run.run_started_at),
        updated_at: updatedAt,
        triggering_actor: user(run.triggering_actor),
        pull_requests: prs,
        head_commit: headCommit ? { id: sha(headCommit.id), timestamp: isoTimestamp(headCommit.timestamp) } : null,
      }, updatedAt, `workflow_run:${runId}:${attempt ?? 0}:${action}`);
    }
    case 'deployment': {
      const d = obj(p.deployment);
      const deploymentId = id(d?.id);
      if (!d || !deploymentId) return { kind: 'ignored', reason: 'malformed' };
      const createdAt = isoTimestamp(d.created_at);
      return record({
        kind: 'deployment', ...common,
        deployment_id: deploymentId,
        sha: sha(d.sha),
        ref: text(d.ref, 255),
        environment: text(d.environment, 255),
        task: text(d.task, 100),
        production_environment: bool(d.production_environment),
        transient_environment: bool(d.transient_environment),
        created_at: createdAt,
        creator: user(d.creator),
      }, createdAt, `deployment:${deploymentId}`);
    }
    case 'deployment_status': {
      const status = obj(p.deployment_status);
      const statusId = id(status?.id);
      if (!status || !statusId) return { kind: 'ignored', reason: 'malformed' };
      const d = obj(p.deployment);
      const createdAt = isoTimestamp(status.created_at);
      return record({
        kind: 'deployment_status', ...common,
        status_id: statusId,
        deployment_id: id(d?.id),
        state: token(status.state),
        environment: text(status.environment ?? d?.environment, 255),
        created_at: createdAt,
        sha: sha(d?.sha),
        ref: text(d?.ref, 255),
      }, createdAt, `deployment_status:${statusId}`);
    }
    case 'pull_request': {
      const pr = obj(p.pull_request);
      const prId = id(pr?.id);
      const number = id(pr?.number ?? p.number);
      if (!pr || !prId || !number) return { kind: 'ignored', reason: 'malformed' };
      const createdAt = isoTimestamp(pr.created_at);
      const closedAt = isoTimestamp(pr.closed_at);
      const merged = pr.merged === true;
      const occurredAt = action === 'closed' ? closedAt : action === 'reopened' ? isoTimestamp(pr.updated_at) : createdAt;
      return record({
        kind: 'pull_request', ...common,
        pr_id: prId,
        number,
        merged,
        merged_at: merged ? isoTimestamp(pr.merged_at) : null,
        merge_commit_sha: merged ? sha(pr.merge_commit_sha) : null,
        head_sha: sha(obj(pr.head)?.sha),
        head_ref: text(obj(pr.head)?.ref, 255),
        base_ref: text(obj(pr.base)?.ref, 255),
        created_at: createdAt,
        closed_at: closedAt,
        title: text(pr.title, MAX_TITLE_LENGTH),
        user: user(pr.user),
      }, occurredAt, occurredAt ? `pull_request:${prId}:${action}:${occurredAt}` : null);
    }
    case 'installation': {
      const inst = obj(p.installation)!;
      const account = obj(inst.account);
      const accountId = id(account?.id);
      const accountLogin = text(account?.login ?? account?.slug, 100);
      const accountType = typeof account?.type === 'string' && ['User', 'Organization', 'Enterprise'].includes(account.type)
        ? account.type : null;
      const repos = repositoryBriefs(p.repositories, MAX_INSTALLATION_REPOSITORIES);
      return record({
        kind: 'installation', ...common,
        account: accountId && accountLogin && accountType ? { id: accountId, login: accountLogin, type: accountType } : null,
        repository_selection: selection(inst.repository_selection),
        permissions: permissions(inst.permissions),
        events: eventNames(inst.events),
        repositories: repos.list,
        repositories_truncated: repos.truncated,
      }, null, null);
    }
    case 'installation_repositories': {
      const added = repositoryBriefs(p.repositories_added, MAX_REPOSITORY_CHANGES);
      const removed = repositoryBriefs(p.repositories_removed, MAX_REPOSITORY_CHANGES);
      return record({
        kind: 'installation_repositories', ...common,
        repository_selection: selection(p.repository_selection),
        added: added.list,
        removed: removed.list,
        truncated: added.truncated || removed.truncated,
      }, null, null);
    }
  }
}
