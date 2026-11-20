import { normalizeDelivery, isoTimestamp, MAX_TITLE_LENGTH } from '../normalize';
import { NORMALIZER_VERSION, PullRequestFacts, WorkflowJobFacts, WorkflowRunFacts, InstallationFacts } from '../contract';
import {
  PLANTED, SHA_A, SHA_MERGE, deploymentCreated, deploymentStatusCreated, installationCreated, installationRepositories,
  pullRequestClosed, workflowJobCompleted, workflowRunCompleted,
} from './fixtures/payloads';

const INST = 4242;
const REPO = 99001;

function stored(event: string, payload: unknown) {
  const result = normalizeDelivery(event, payload);
  if (result.kind !== 'record') throw new Error(`expected a record, got ${result.reason}`);
  return result.record;
}

describe('normalizeDelivery: allowlist, D6/D7 fields, ignored events', () => {
  it('is version 1', () => {
    expect(NORMALIZER_VERSION).toBe(1);
  });

  it('workflow_job completed: the D7 fields (run_attempt, started_at, steps) and the D8a-2 fields', () => {
    const payload = workflowJobCompleted(INST, REPO, { jobId: 555001 });
    const r = stored('workflow_job', payload);
    const f = r.facts as WorkflowJobFacts;
    expect(r).toMatchObject({ event: 'workflow_job', action: 'completed', installationId: INST, githubRepoId: REPO,
      eventKey: 'workflow_job:555001:completed', occurredAt: '2026-11-20T10:07:30.000Z' });
    expect(f).toMatchObject({
      kind: 'workflow_job', job_id: 555001, run_id: 555000, run_attempt: 2, job_name: 'deploy-backend', workflow_name: 'CI',
      head_sha: SHA_A, head_branch: 'main', conclusion: 'success', started_at: '2026-11-20T10:00:05.000Z',
      completed_at: '2026-11-20T10:07:30.000Z', steps_truncated: false,
      repository: { id: REPO, full_name: `acme/repo-${REPO}`, default_branch: 'main' },
      sender: { id: 9001, login: 'octo-dev' },
    });
    expect(f.steps).toHaveLength(3);
    expect(f.steps[1]).toEqual({ number: 2, name: 'Smoke test new deploy', status: 'completed', conclusion: 'failure',
      started_at: '2026-11-20T10:01:00.000Z', completed_at: '2026-11-20T10:02:00.000Z' });
  });

  it('caps steps at 100 and says so', () => {
    const f = stored('workflow_job', workflowJobCompleted(INST, REPO, { steps: 130 })).facts as WorkflowJobFacts;
    expect(f.steps).toHaveLength(100);
    expect(f.steps_truncated).toBe(true);
  });

  it('pull_request closed + merged: the D6 fields (merged, merged_at, merge_commit_sha, number) and the title cut to 256', () => {
    const r = stored('pull_request', pullRequestClosed(INST, REPO, { prId: 31337, title: 'x'.repeat(400) }));
    const f = r.facts as PullRequestFacts;
    expect(f).toMatchObject({ kind: 'pull_request', pr_id: 31337, number: 42, merged: true, merged_at: '2026-11-20T09:58:00.000Z',
      merge_commit_sha: SHA_MERGE, head_ref: 'feature', base_ref: 'main' });
    expect(f.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(r.eventKey).toBe('pull_request:31337:closed:2026-11-20T09:58:00.000Z');
  });

  it('pull_request closed without merge: merged false, no merged_at or merge_commit_sha', () => {
    const f = stored('pull_request', pullRequestClosed(INST, REPO, { merged: false })).facts as PullRequestFacts;
    expect(f).toMatchObject({ merged: false, merged_at: null, merge_commit_sha: null });
  });

  it('workflow_run: run context without the commit message or author', () => {
    const f = stored('workflow_run', workflowRunCompleted(INST, REPO)).facts as WorkflowRunFacts;
    expect(f.head_commit).toEqual({ id: SHA_A, timestamp: '2026-11-20T14:59:00.000Z' });
    expect(f.pull_requests).toEqual([{ id: 3001, number: 42, head_sha: 'b'.repeat(40), base_ref: 'main' }]);
    expect(f.triggering_actor).toEqual({ id: 9001, login: 'octo-dev' });
  });

  it('deployment and deployment_status keep ids, sha, environment and state only', () => {
    const d = stored('deployment', deploymentCreated(INST, REPO));
    expect(d.facts).toMatchObject({ kind: 'deployment', sha: SHA_A, environment: 'production', production_environment: true });
    expect(JSON.stringify(d.facts)).not.toMatch(/secret_looking|free text/);
    const s = stored('deployment_status', deploymentStatusCreated(INST, REPO));
    expect(s.facts).toMatchObject({ kind: 'deployment_status', state: 'success', environment: 'production', sha: SHA_A });
    expect(JSON.stringify(s.facts)).not.toMatch(/not stored/);
  });

  it('installation created: account, permissions, events, installer (sender) and repositories', () => {
    const r = stored('installation', installationCreated(INST, 8123, [{ id: 1, full_name: 'acme/a' }]));
    const f = r.facts as InstallationFacts;
    expect(r.githubRepoId).toBeNull();
    expect(r.eventKey).toBeNull();
    expect(f).toMatchObject({ account: { id: 777, login: 'acme', type: 'Organization' }, repository_selection: 'selected',
      permissions: { actions: 'read', deployments: 'read', metadata: 'read', pull_requests: 'read' },
      sender: { id: 8123, login: 'installer-8123' }, repositories: [{ id: 1, full_name: 'acme/a' }] });
  });

  it('installation_repositories: added and removed by id', () => {
    const f = stored('installation_repositories', installationRepositories(INST, [{ id: 5, full_name: 'acme/five' }], [])).facts;
    expect(f).toMatchObject({ added: [{ id: 5, full_name: 'acme/five' }], removed: [] });
  });

  it('never stores a commit message, an email, a PR body, an avatar or API URL, or a caller-supplied organization id', () => {
    const all = [
      stored('workflow_job', workflowJobCompleted(INST, REPO)),
      stored('workflow_run', workflowRunCompleted(INST, REPO)),
      stored('pull_request', pullRequestClosed(INST, REPO)),
      stored('deployment', deploymentCreated(INST, REPO)),
      stored('installation', installationCreated(INST, 8123)),
    ];
    for (const r of all) {
      const json = JSON.stringify(r);
      expect(json).not.toContain(PLANTED.commitMessage);
      expect(json).not.toContain(PLANTED.email);
      expect(json).not.toContain(PLANTED.prBody);
      expect(json).not.toContain(PLANTED.foreignOrg);
      expect(json).not.toMatch(/avatars\.example\.com|api\.github\.com|organization_id/);
    }
  });

  it.each([
    ['an unsupported event', 'push', { action: 'x', installation: { id: INST } }, 'unsupported_event'],
    ['ping', 'ping', { zen: 'z' }, 'unsupported_event'],
    ['an action that is not stored', 'workflow_job', { ...workflowJobCompleted(INST, REPO), action: 'queued' }, 'unsupported_action'],
    ['pull_request synchronize', 'pull_request', { ...pullRequestClosed(INST, REPO), action: 'synchronize' }, 'unsupported_action'],
    ['no installation', 'workflow_job', { ...workflowJobCompleted(INST, REPO), installation: undefined }, 'no_installation'],
    ['a non-numeric installation id', 'workflow_job', { ...workflowJobCompleted(INST, REPO), installation: { id: '42' } }, 'no_installation'],
    ['no repository on a repository event', 'workflow_job', { ...workflowJobCompleted(INST, REPO), repository: null }, 'malformed'],
    ['a non-object payload', 'workflow_job', [1, 2], 'malformed'],
  ])('ignores %s', (_label, event, payload, reason) => {
    expect(normalizeDelivery(event as string, payload)).toEqual({ kind: 'ignored', reason });
  });

  it('timestamps: ISO UTC or null, never the raw string', () => {
    expect(isoTimestamp('2026-11-20T10:00:00+02:00')).toBe('2026-11-20T08:00:00.000Z');
    expect(isoTimestamp('2026-11-20')).toBeNull();
    expect(isoTimestamp('yesterday')).toBeNull();
    expect(isoTimestamp('2026-13-45T99:00:00Z')).toBeNull();
    expect(isoTimestamp(1700000000)).toBeNull();
    const payload = workflowJobCompleted(INST, REPO);
    payload.workflow_job.completed_at = 'not a date';
    const r = stored('workflow_job', payload);
    expect(r.occurredAt).toBeNull();
    expect((r.facts as WorkflowJobFacts).completed_at).toBeNull();
  });

  it('control characters are removed from names', () => {
    const payload = workflowJobCompleted(INST, REPO);
    payload.workflow_job.name = 'deploy\n\u0000backend';
    expect((stored('workflow_job', payload).facts as WorkflowJobFacts).job_name).toBe('deploy  backend');
  });
});
