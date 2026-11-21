/**
 * D8a-2 deploy detection, rules and deployment metadata (pure, no database).
 * Rulings Q1-Q7, Q9, Q16 (d8a2-build.md): the status table, the decision
 * order, one mode per repository, exact job matching with the branch filter,
 * environment names, the stored-rule reader, and the metadata allowlist.
 */
import { normalizeDelivery } from '../normalize';
import { DeploymentStatusFacts, PullRequestFacts, WorkflowJobFacts } from '../contract';
import { deployRuleBody, environmentFor, readStoredDeployRule, storedDeployRule } from '../deploy-rule';
import { deploymentStatus, detectDeployment, jobStatus, RepositoryForEvent } from '../detect';
import { buildEnvironmentMetadata, buildJobMetadata, readPipelineMetadata } from '../deployment-metadata';
import { PLANTED, SHA_A, deploymentStatusCreated, pullRequestClosed, workflowJobCompleted, JobOptions } from './fixtures/payloads';

const INST = 4242;
const REPO = 555;
const SERVICE = '00000000-0000-4000-8000-0000000000e1';
const RECEIVED = new Date('2026-11-20T11:00:00.000Z');

function jobFacts(opts: JobOptions = {}): WorkflowJobFacts {
  const r = normalizeDelivery('workflow_job', workflowJobCompleted(INST, REPO, opts));
  if (r.kind !== 'record') throw new Error('not normalized');
  return r.record.facts as WorkflowJobFacts;
}
function statusFacts(opts: Parameters<typeof deploymentStatusCreated>[2] = {}): DeploymentStatusFacts {
  const r = normalizeDelivery('deployment_status', deploymentStatusCreated(INST, REPO, opts));
  if (r.kind !== 'record') throw new Error('not normalized');
  return r.record.facts as DeploymentStatusFacts;
}
const jobRule = (o: Record<string, unknown> = {}) => storedDeployRule(deployRuleBody.parse({ mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend', ...o }));
const envRule = (o: Record<string, unknown> = {}) => storedDeployRule(deployRuleBody.parse({ mode: 'github_deployments', ...o }));
const repo = (deployRule: unknown, o: Partial<RepositoryForEvent> = {}): RepositoryForEvent => ({
  githubRepoId: REPO, serviceId: SERVICE, defaultBranch: 'main', deployRule, ...o,
});
const detect = (facts: WorkflowJobFacts | DeploymentStatusFacts, repository: RepositoryForEvent | null, legacy = false) =>
  detectDeployment({ facts, repository, receivedAt: RECEIVED, legacyWebhookOrganization: legacy });

describe('status table (ruling Q1)', () => {
  it.each([
    ['success', 'success'], ['failure', 'failed'], ['timed_out', 'failed'],
    ['cancelled', null], ['skipped', null], ['neutral', null], ['action_required', null], ['stale', null], [null, null],
  ])('job conclusion %s -> %s', (conclusion, expected) => {
    expect(jobStatus(conclusion)).toBe(expected);
  });
  it.each([
    ['success', 'success'], ['failure', 'failed'], ['error', 'failed'],
    ['inactive', null], ['pending', null], ['queued', null], ['in_progress', null], [null, null],
  ])('deployment state %s -> %s', (state, expected) => {
    expect(deploymentStatus(state)).toBe(expected);
  });
  it('no result -> no row, the reason names the conclusion or state', () => {
    expect(detect(jobFacts({ conclusion: 'skipped' }), repo(jobRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'conclusion_skipped' });
    expect(detect(jobFacts({ conclusion: 'cancelled' }), repo(jobRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'conclusion_cancelled' });
    expect(detect(jobFacts({ conclusion: null }), repo(jobRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'conclusion_none' });
    expect(detect(statusFacts({ state: 'inactive' }), repo(envRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'state_inactive' });
    expect(detect(statusFacts({ state: 'in_progress' }), repo(envRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'state_in_progress' });
  });
});

describe('decision order', () => {
  it('legacy webhook organization first, even for a mapped repository with a matching rule (ruling Q12)', () => {
    expect(detect(jobFacts(), repo(jobRule()), true)).toEqual({ kind: 'skip', status: 'ignored', reason: 'legacy_webhook_org' });
  });
  it('unmapped before any rule; no rule, mode none and an unreadable rule record nothing', () => {
    expect(detect(jobFacts(), repo(jobRule(), { serviceId: null }))).toEqual({ kind: 'skip', status: 'unmapped', reason: 'repository_not_mapped' });
    expect(detect(jobFacts(), null)).toEqual({ kind: 'skip', status: 'unmapped', reason: 'repository_not_mapped' });
    expect(detect(jobFacts(), repo(null))).toEqual({ kind: 'skip', status: 'ignored', reason: 'no_deploy_rule' });
    expect(detect(jobFacts(), repo(storedDeployRule({ mode: 'none' })))).toEqual({ kind: 'skip', status: 'ignored', reason: 'no_deploy_rule' });
    for (const bad of [{ mode: 'job' }, { v: 2, mode: 'none' }, { v: 1, mode: 'job', workflow_name: 'CI' }, [], 'job']) {
      expect(detect(jobFacts(), repo(bad))).toEqual({ kind: 'skip', status: 'ignored', reason: 'deploy_rule_invalid' });
    }
  });
  it('one mode per repository: a job in Environments mode and a deployment status in job mode record nothing', () => {
    expect(detect(jobFacts(), repo(envRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'other_mode' });
    expect(detect(statusFacts(), repo(jobRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'other_mode' });
  });
});

describe('job rule: exact workflow + job name, branch filter (ruling Q4)', () => {
  it('records a matching completed job with the rule environment, completion time, sender and the job key', () => {
    expect(detect(jobFacts({ jobId: 31337 }), repo(jobRule({ environment: 'staging' })))).toEqual({
      kind: 'record',
      candidate: {
        serviceId: SERVICE, githubRepoId: REPO, environment: 'staging', status: 'success',
        deployedAt: '2026-11-20T10:07:30.000Z', deployedBy: 'octo-dev', awsRegion: null,
        key: { field: 'github_job_id', value: 31337 }, headSha: SHA_A,
      },
    });
  });
  it('environment defaults to production; a typed region is carried; no region -> null', () => {
    const r = detect(jobFacts(), repo(jobRule({ aws_region: 'eu-west-1' })));
    expect(r.kind === 'record' && [r.candidate.environment, r.candidate.awsRegion]).toEqual(['production', 'eu-west-1']);
    const n = detect(jobFacts(), repo(jobRule()));
    expect(n.kind === 'record' && n.candidate.awsRegion).toBeNull();
  });
  it('same job name in another workflow, or another job in the same workflow -> not the deploy job', () => {
    expect(detect(jobFacts({ workflowName: 'Nightly' }), repo(jobRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'not_deploy_job' });
    expect(detect(jobFacts({ jobName: 'lint-and-build' }), repo(jobRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'not_deploy_job' });
    expect(detect(jobFacts({ jobName: 'Deploy-Backend' }), repo(jobRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'not_deploy_job' });
  });
  it('branch: default branch by default; any; a named branch', () => {
    expect(detect(jobFacts({ headBranch: 'feature' }), repo(jobRule())).kind).toBe('skip');
    expect(detect(jobFacts({ headBranch: 'feature' }), repo(jobRule()))).toMatchObject({ reason: 'branch_not_matched' });
    expect(detect(jobFacts({ headBranch: 'feature' }), repo(jobRule({ branch: 'any' }))).kind).toBe('record');
    expect(detect(jobFacts({ headBranch: 'release' }), repo(jobRule({ branch: 'named', branch_name: 'release' }))).kind).toBe('record');
    expect(detect(jobFacts({ headBranch: 'main' }), repo(jobRule({ branch: 'named', branch_name: 'release' }))).kind).toBe('skip');
  });
  it('timed out -> failed; no completion time -> the receipt time; no sender -> "github"', () => {
    const t = detect(jobFacts({ conclusion: 'timed_out' }), repo(jobRule()));
    expect(t.kind === 'record' && t.candidate.status).toBe('failed');
    const facts = { ...jobFacts(), completed_at: null, sender: null };
    const r = detect(facts, repo(jobRule()));
    expect(r.kind === 'record' && [r.candidate.deployedAt, r.candidate.deployedBy]).toEqual(['2026-11-20T11:00:00.000Z', 'github']);
  });
});

describe('Environments rule (ruling Q5)', () => {
  it('records a terminal status with the normalized environment and the deployment key', () => {
    const r = detect(statusFacts({ deploymentId: 777, environment: 'Prod', state: 'error' }), repo(envRule()));
    expect(r).toMatchObject({ kind: 'record', candidate: { environment: 'production', status: 'failed', key: { field: 'github_deployment_id', value: 777 }, deployedAt: '2026-11-20T10:09:00.000Z' } });
  });
  it('an unknown environment name records nothing and is kept as unknown_environment; the rule map wins', () => {
    expect(detect(statusFacts({ environment: 'github-pages' }), repo(envRule()))).toEqual({ kind: 'skip', status: 'ignored', reason: 'unknown_environment' });
    const mapped = detect(statusFacts({ environment: 'GitHub-Pages' }), repo(envRule({ environment_map: { 'github-pages': 'staging' } })));
    expect(mapped.kind === 'record' && mapped.candidate.environment).toBe('staging');
    const override = detect(statusFacts({ environment: 'live' }), repo(envRule({ environment_map: { LIVE: 'staging' } })));
    expect(override.kind === 'record' && override.candidate.environment).toBe('staging');
  });
  it.each([
    ['prod', 'production'], ['production', 'production'], ['live', 'production'],
    ['stage', 'staging'], ['staging', 'staging'], ['preprod', 'staging'],
    ['dev', 'development'], ['development', 'development'], ['preview', 'development'], ['qa', 'development'],
    ['preview-123', null], ['', null], [null, null], ['constructor', null],
  ])('default name %s -> %s', (name, expected) => {
    expect(environmentFor(name, {})).toBe(expected);
  });
});

describe('rule schema (PUT body)', () => {
  it('is strict: an organization id, an unknown field, a bad region or environment are refused', () => {
    for (const body of [
      { mode: 'job', workflow_name: 'CI', job_name: 'deploy', organization_id: PLANTED.foreignOrg },
      { mode: 'none', extra: 1 },
      { mode: 'job', workflow_name: 'CI', job_name: 'deploy', aws_region: 'mars-1' },
      { mode: 'job', workflow_name: 'CI', job_name: 'deploy', environment: 'prod' },
      { mode: 'job', workflow_name: '', job_name: 'deploy' },
      { mode: 'job', workflow_name: 'CI', job_name: 'x'.repeat(201) },
      { mode: 'job', workflow_name: 'CI', job_name: 'deploy', branch: 'named' },
      { mode: 'job', workflow_name: 'CI', job_name: 'deploy', branch_name: 'release' },
      { mode: 'github_deployments', environment_map: { prod: 'live' } },
      { mode: 'github_deployments', environment_map: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`e${i}`, 'staging'])) },
      { mode: 'auto' },
    ]) {
      expect(deployRuleBody.safeParse(body).success).toBe(false);
    }
  });
  it('stores a versioned rule that reads back identically; map keys are lower-cased', () => {
    const stored = envRule({ environment_map: { 'GitHub-Pages': 'staging' } });
    expect(stored).toEqual({ v: 1, mode: 'github_deployments', environment_map: { 'github-pages': 'staging' }, aws_region: null });
    expect(readStoredDeployRule(stored)).toEqual({ mode: 'github_deployments', environment_map: { 'github-pages': 'staging' }, aws_region: null });
    expect(jobRule()).toEqual({ v: 1, mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend', environment: 'production', branch: 'default', branch_name: null, aws_region: null });
  });
});

describe('deployment metadata: one writer, one reader (rulings Q7-Q9)', () => {
  const JOB_KEYS = ['source', 'connection', 'pipeline_metadata_version', 'github_repo_id', 'github_job_id', 'github_run_id', 'run_attempt',
    'workflow_name', 'job_name', 'head_sha', 'head_branch', 'html_url', 'conclusion', 'job_created_at', 'job_started_at', 'steps', 'steps_truncated'].sort();
  const pr = () => {
    const r = normalizeDelivery('pull_request', pullRequestClosed(INST, REPO, { mergeSha: SHA_A }));
    if (r.kind !== 'record') throw new Error('not normalized');
    return r.record.facts as PullRequestFacts;
  };

  it('job rows: exactly the named keys, steps trimmed to D7 fields; nothing planted in a payload reaches it', () => {
    const m = buildJobMetadata(jobFacts({ jobId: 9, runId: 8, runAttempt: 3 }), REPO, null);
    expect(Object.keys(m).sort()).toEqual(JOB_KEYS);
    expect(m).toMatchObject({ source: 'github_actions', connection: 'github_app', pipeline_metadata_version: 1, github_job_id: 9, github_run_id: 8,
      run_attempt: 3, workflow_name: 'CI', job_name: 'deploy-backend', job_started_at: '2026-11-20T10:00:05.000Z', steps_truncated: false });
    expect(m.steps[1]).toEqual({ name: 'Smoke test new deploy', conclusion: 'failure', started_at: '2026-11-20T10:01:00.000Z', completed_at: '2026-11-20T10:02:00.000Z' });
    const text = JSON.stringify(m);
    for (const planted of [PLANTED.email, PLANTED.commitMessage, PLANTED.prBody, PLANTED.foreignOrg, 'runner-1', 'avatars.example.com']) {
      expect(text).not.toContain(planted);
    }
  });

  it('merge stamp only from a merged pull request; its title and body never reach the row', () => {
    const m = buildJobMetadata(jobFacts(), REPO, pr());
    expect(m).toMatchObject({ merged_at: '2026-11-20T09:58:00.000Z', merge_commit_sha: SHA_A, pr_number: 42, merge_source: 'pull_request' });
    expect(JSON.stringify(m)).not.toMatch(/Revert|PLANTED/);
    expect(Object.keys(buildJobMetadata(jobFacts(), REPO, { ...pr(), merged: false }))).not.toContain('merged_at');
  });

  it('environment rows: their own keys, source github_deployments', () => {
    const facts = statusFacts({ deploymentId: 77, statusId: 78 });
    const m = buildEnvironmentMetadata({ ...facts, deployment_id: 77 }, REPO, null);
    expect(Object.keys(m).sort()).toEqual(['connection', 'github_deployment_id', 'github_deployment_status_id', 'github_environment', 'github_repo_id',
      'head_sha', 'pipeline_metadata_version', 'ref', 'source', 'state'].sort());
    expect(m.source).toBe('github_deployments');
  });

  it('the reader types App rows (after a JSON round trip) and returns null for legacy, manual and malformed rows', () => {
    const written = buildJobMetadata(jobFacts(), REPO, pr());
    expect(readPipelineMetadata(JSON.parse(JSON.stringify(written)))).toEqual(written);
    const env = buildEnvironmentMetadata({ ...statusFacts(), deployment_id: 5 }, REPO, null);
    expect(readPipelineMetadata(JSON.parse(JSON.stringify(env)))).toEqual(env);
    expect(readPipelineMetadata({ source: 'github_actions', github_job_id: 1, workflow_name: 'deploy-backend' })).toBeNull();
    expect(readPipelineMetadata({ source: 'manual' })).toBeNull();
    expect(readPipelineMetadata({ ...written, pipeline_metadata_version: 2 })).toBeNull();
    expect(readPipelineMetadata({ ...written, github_job_id: '1' })).toBeNull();
    expect(readPipelineMetadata(null)).toBeNull();
    // Unknown keys are dropped and a malformed stamp is not read.
    const extra = readPipelineMetadata({ ...written, planted: PLANTED.email, merged_at: 'yesterday' });
    expect(JSON.stringify(extra)).not.toContain(PLANTED.email);
    expect(extra).not.toHaveProperty('merged_at');
  });
});
