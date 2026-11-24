/**
 * D8a-2 against the real database, as the devcontrol role: stored GitHub App
 * events become deployment rows through the webhook pipeline (signed
 * deliveries) and through replay.
 *
 * Covers: job and Environments modes, the status table, reruns, idempotency
 * (event and deployment level, and against legacy webhook rows), the legacy
 * organization guard, unmapped repositories (no service ever created), rule
 * and mapping replay (paged past 1,000 events, and after the legacy guard is
 * lifted), later final statuses, the monthly quota under concurrency, the row's own
 * month and a lowered plan, the D6 merge stamp at insert only, the region,
 * and organization isolation.
 */
import { ingestDelivery, WebhookDeps } from '../ingest';
import { EventProcessor, processEvent, processStoredEvent } from '../process';
import { deployRuleBody, storedDeployRule } from '../deploy-rule';
import { MAPPING_REPLAY, replayRepository, RULE_REPLAY } from '../replay';
import { withOrgClient } from '../db';
import { listRepositoryActivity, setRepositoryDeployRule, setRepositoryService } from '../../../repositories/pipeline-repositories.repository';
import { NOT_CLAIMED_REASON } from '../../../repositories/pipeline-events.repository';
import { insertPipelineDeployment } from '../../../repositories/deployments.repository';
import { Pool } from 'pg';
import { installTenantTagReset } from '../../../config/database';
import { createFixtures, dbConfig, enabledConfig, WEBHOOK_SECRET } from './fixtures/db';
import {
  JobOptions, SHA_A, SHA_B, deploymentStatusCreated, pullRequestClosed, signedDelivery, uniqueId, workflowJobCompleted,
} from './fixtures/payloads';

jest.setTimeout(60_000);

const fx = createFixtures('d8a2-record');
const deps = (): WebhookDeps => ({ readConfig: enabledConfig, source: fx.app, processor: processEvent, log: () => undefined });
const deliver = (event: string, payload: unknown) => {
  const d = signedDelivery(event, payload, WEBHOOK_SECRET);
  return ingestDelivery({ rawBody: d.rawBody, headers: d.headers }, deps()).then((result) => ({ ...result, deliveryId: d.deliveryId }));
};

const JOB_RULE = storedDeployRule(deployRuleBody.parse({ mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend' }));
const ENV_RULE = storedDeployRule(deployRuleBody.parse({ mode: 'github_deployments' }));

interface Repo { repoId: number; rowId: string; serviceId: string }

async function repo(org: string, inst: number, rule: unknown | null, mapped = true): Promise<Repo> {
  const repoId = uniqueId(900_000_000_000);
  const serviceId = await fx.service(org, `svc-${repoId}`);
  const { rows } = await fx.admin.query(
    `INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name, default_branch, service_id, deploy_rule)
     VALUES ($1, $2, $3, $4, 'main', $5, $6::jsonb) RETURNING id::text AS id`,
    [org, repoId, inst, `acme/repo-${repoId}`, mapped ? serviceId : null, rule === null ? null : JSON.stringify(rule)]
  );
  return { repoId, rowId: rows[0].id, serviceId };
}

async function eventOf(deliveryId: string) {
  const { rows } = await fx.admin.query(
    `SELECT id::text AS id, processing_status AS status, processing_reason AS reason, deployment_id::text AS deployment_id
       FROM pipeline_events WHERE delivery_id = $1`, [deliveryId]);
  return rows[0];
}

async function deploymentsOf(org: string) {
  const { rows } = await fx.admin.query(
    `SELECT id::text AS id, service_id::text AS service_id, environment, aws_region, status, deployed_by, deployed_at, cost_estimate, metadata
       FROM deployments WHERE organization_id = $1 ORDER BY deployed_at, (metadata ->> 'run_attempt'), id`, [org]);
  return rows;
}

const job = (inst: number, r: Repo, opts: JobOptions = {}) => deliver('workflow_job', workflowJobCompleted(inst, r.repoId, opts));

let orgA: string;
let orgB: string;
let instA: number;
let instB: number;

beforeAll(async () => {
  await fx.grantDeploymentWrites();
  orgA = await fx.org();
  orgB = await fx.org();
  instA = fx.installationId();
  instB = fx.installationId();
  await fx.claim(orgA, instA);
  await fx.claim(orgB, instB);
});
afterAll(() => fx.close());

describe('job mode', () => {
  it('a matching completed job -> one row; the event is processed and linked; no region; no cost', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    const jobId = uniqueId();
    const res = await job(instA, r, { jobId, runId: jobId - 1, runAttempt: 1 });
    expect(res.status).toBe(200);
    const ev = await eventOf(res.deliveryId);
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_job_id === jobId);
    expect(rows).toHaveLength(1);
    expect(ev).toMatchObject({ status: 'processed', reason: null, deployment_id: rows[0].id });
    expect(rows[0]).toMatchObject({
      service_id: r.serviceId, environment: 'production', aws_region: null, status: 'success', deployed_by: 'octo-dev', cost_estimate: null,
    });
    expect(rows[0].deployed_at.toISOString()).toBe('2026-11-20T10:07:30.000Z');
    expect(rows[0].metadata).toMatchObject({
      source: 'github_actions', connection: 'github_app', pipeline_metadata_version: 1, github_repo_id: r.repoId,
      github_job_id: jobId, github_run_id: jobId - 1, run_attempt: 1, workflow_name: 'CI', job_name: 'deploy-backend',
      head_sha: SHA_A, head_branch: 'main', job_started_at: '2026-11-20T10:00:05.000Z', steps_truncated: false,
    });
    expect(rows[0].metadata.steps).toHaveLength(3);
  });

  it('failure and timed out -> failed rows; skipped and cancelled -> no row, kept with the reason', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    const failure = await job(instA, r, { conclusion: 'failure' });
    const timedOut = await job(instA, r, { conclusion: 'timed_out' });
    const skipped = await job(instA, r, { conclusion: 'skipped' });
    const cancelled = await job(instA, r, { conclusion: 'cancelled' });
    expect((await eventOf(failure.deliveryId)).status).toBe('processed');
    expect((await eventOf(timedOut.deliveryId)).status).toBe('processed');
    expect(await eventOf(skipped.deliveryId)).toMatchObject({ status: 'ignored', reason: 'conclusion_skipped', deployment_id: null });
    expect(await eventOf(cancelled.deliveryId)).toMatchObject({ status: 'ignored', reason: 'conclusion_cancelled', deployment_id: null });
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows.map((d) => d.status)).toEqual(['failed', 'failed']);
  });

  it('a rerun (new job id, same run, attempt 2) is its own row carrying its attempt (ruling Q3)', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    const runId = uniqueId();
    await job(instA, r, { runId, runAttempt: 1, conclusion: 'failure' });
    await job(instA, r, { runId, runAttempt: 2, conclusion: 'success' });
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_run_id === runId);
    expect(rows.map((d) => [d.metadata.run_attempt, d.status])).toEqual([[1, 'failed'], [2, 'success']]);
  });

  it('a job that is not the deploy job, or on another branch, records nothing', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    const other = await job(instA, r, { jobName: 'lint-and-build' });
    const branch = await job(instA, r, { headBranch: 'feature/x' });
    expect(await eventOf(other.deliveryId)).toMatchObject({ status: 'ignored', reason: 'not_deploy_job' });
    expect(await eventOf(branch.deliveryId)).toMatchObject({ status: 'ignored', reason: 'branch_not_matched' });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId)).toEqual([]);
  });

  it('a typed region on the rule is recorded', async () => {
    const rule = storedDeployRule(deployRuleBody.parse({ mode: 'job', workflow_name: 'CI', job_name: 'deploy-backend', aws_region: 'eu-west-1', environment: 'staging' }));
    const r = await repo(orgA, instA, rule);
    await job(instA, r);
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows.map((d) => [d.aws_region, d.environment])).toEqual([['eu-west-1', 'staging']]);
  });
});

describe('idempotency', () => {
  it('the same job under a new delivery id is one event and one row; processing the event again -> already_recorded', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    const payload = workflowJobCompleted(instA, r.repoId);
    const first = await deliver('workflow_job', payload);
    const second = await deliver('workflow_job', payload);
    expect(second.body).toEqual({ received: true, stored: true, duplicate: true });
    const ev = await eventOf(first.deliveryId);
    const stored = await withOrgClient(fx.app, orgA, async (c) => (await c.query(
      `SELECT id, installation_id, event, action, occurred_at, received_at, facts FROM pipeline_events WHERE organization_id = $1 AND id = $2`,
      [orgA, ev.id])).rows[0]);
    const again = await processStoredEvent(fx.app, orgA, {
      id: stored.id, installationId: String(stored.installation_id), event: stored.event, action: stored.action,
      occurredAt: stored.occurred_at, receivedAt: stored.received_at, facts: stored.facts,
    });
    expect(again).toEqual({ status: 'processed', reason: 'already_recorded' });
    expect(await eventOf(first.deliveryId)).toMatchObject({ deployment_id: ev.deployment_id });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId)).toHaveLength(1);
  });

  it('legacy webhook row first, App delivery second (same org, same job) -> one row; App first, legacy second -> the index refuses it', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    const legacyJob = uniqueId();
    const legacy = (await fx.admin.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id, metadata)
       VALUES ($1, 'production', 'us-east-1', 'success', 'octo-dev', '2026-11-20T10:07:30Z', $2, $3::jsonb) RETURNING id::text AS id`,
      [r.serviceId, orgA, JSON.stringify({ source: 'github_actions', github_job_id: legacyJob, workflow_name: 'deploy-backend' })])).rows[0].id;
    const app = await job(instA, r, { jobId: legacyJob });
    expect(await eventOf(app.deliveryId)).toMatchObject({ status: 'processed', reason: 'already_recorded', deployment_id: legacy });

    // The legacy row says failed; the App's final status for the same job says success (review N-1).
    const failedJob = uniqueId();
    const failedRow = (await fx.admin.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id, metadata)
       VALUES ($1, 'production', 'us-east-1', 'failed', 'octo-dev', '2026-11-20T10:07:30Z', $2, $3::jsonb) RETURNING id::text AS id`,
      [r.serviceId, orgA, JSON.stringify({ source: 'github_actions', github_job_id: failedJob, workflow_name: 'deploy-backend' })])).rows[0].id;
    const later = await job(instA, r, { jobId: failedJob, conclusion: 'success' });
    expect(await eventOf(later.deliveryId)).toMatchObject({ status: 'processed', reason: 'later_final_status', deployment_id: failedRow });
    expect((await fx.admin.query('SELECT status FROM deployments WHERE id = $1', [failedRow])).rows[0].status).toBe('failed');

    const appJob = uniqueId();
    await job(instA, r, { jobId: appJob });
    await expect(fx.admin.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, organization_id, metadata)
       VALUES ($1, 'production', 'us-east-1', 'success', 'octo-dev', $2, $3::jsonb)`,
      [r.serviceId, orgA, JSON.stringify({ source: 'github_actions', github_job_id: appJob, workflow_name: 'deploy-backend' })],
    )).rejects.toMatchObject({ code: '23505', constraint: 'deployments_github_job_uidx' });
    const rows = (await deploymentsOf(orgA)).filter((d) => [legacyJob, failedJob, appJob].includes(d.metadata.github_job_id));
    expect(rows).toHaveLength(3);
  });
});

describe('the insert itself', () => {
  it('a second insert with the same job id returns null instead of failing (ON CONFLICT: a race with the legacy route)', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    const jobId = uniqueId();
    const row = {
      organizationId: orgA, serviceId: r.serviceId, environment: 'production', awsRegion: null, status: 'success' as const,
      deployedBy: 'octo-dev', deployedAt: '2026-11-20T10:00:00.000Z', metadata: { source: 'github_actions', github_job_id: jobId },
    };
    const first = await withOrgClient(fx.app, orgA, (c) => insertPipelineDeployment(c, row));
    const second = await withOrgClient(fx.app, orgA, (c) => insertPipelineDeployment(c, row));
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBeNull();
    // Another organization's service is never used.
    const serviceB = await fx.service(orgB, `svc-x-${jobId}`);
    expect(await withOrgClient(fx.app, orgA, (c) => insertPipelineDeployment(c, { ...row, serviceId: serviceB, metadata: { github_job_id: jobId + 1 } }))).toBeNull();
    expect((await deploymentsOf(orgA)).filter((d) => [jobId, jobId + 1].includes(d.metadata.github_job_id))).toHaveLength(1);
  });
});

describe('legacy webhook organization guard (ruling Q12)', () => {
  const saved = process.env.GITHUB_WEBHOOK_ORG_ID;
  afterEach(() => {
    if (saved === undefined) delete process.env.GITHUB_WEBHOOK_ORG_ID;
    else process.env.GITHUB_WEBHOOK_ORG_ID = saved;
  });

  it('while GITHUB_WEBHOOK_ORG_ID names the organization (any case), the App path writes no row; the event is kept', async () => {
    process.env.GITHUB_WEBHOOK_ORG_ID = orgA.toUpperCase();
    const r = await repo(orgA, instA, JOB_RULE);
    const res = await job(instA, r);
    expect(await eventOf(res.deliveryId)).toMatchObject({ status: 'ignored', reason: 'legacy_webhook_org', deployment_id: null });
    // A rule replay while the variable is still set reads the event and holds it again.
    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 1, recorded: 0 });
    expect(await eventOf(res.deliveryId)).toMatchObject({ status: 'ignored', reason: 'legacy_webhook_org', deployment_id: null });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId)).toEqual([]);
  });

  it('guard on -> held; guard off and the rule re-saved -> the row is recorded once; again -> nothing new (review S-2)', async () => {
    process.env.GITHUB_WEBHOOK_ORG_ID = orgA;
    const r = await repo(orgA, instA, JOB_RULE);
    const res = await job(instA, r);
    expect(await eventOf(res.deliveryId)).toMatchObject({ status: 'ignored', reason: 'legacy_webhook_org', deployment_id: null });

    delete process.env.GITHUB_WEBHOOK_ORG_ID;
    await withOrgClient(fx.app, orgA, (c) => setRepositoryDeployRule(c, orgA, r.rowId, JOB_RULE));
    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 1, recorded: 1 });
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows).toHaveLength(1);
    expect(await eventOf(res.deliveryId)).toMatchObject({ status: 'processed', reason: null, deployment_id: rows[0].id });

    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 0, recorded: 0 });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId)).toHaveLength(1);
  });

  it('a held job the legacy route already recorded -> already_recorded against the legacy row, no second row; mapping replay lifts held events too', async () => {
    process.env.GITHUB_WEBHOOK_ORG_ID = orgA;
    const r = await repo(orgA, instA, JOB_RULE);
    const jobId = uniqueId();
    const legacy = (await fx.admin.query(
      `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id, metadata)
       VALUES ($1, 'production', 'us-east-1', 'success', 'octo-dev', '2026-11-20T10:07:30Z', $2, $3::jsonb) RETURNING id::text AS id`,
      [r.serviceId, orgA, JSON.stringify({ source: 'github_actions', github_job_id: jobId, workflow_name: 'deploy-backend' })])).rows[0].id;
    const held = await job(instA, r, { jobId });
    const unmapped = await repo(orgA, instA, JOB_RULE, false);
    const heldUnmapped = await job(instA, unmapped);
    expect(await eventOf(held.deliveryId)).toMatchObject({ status: 'ignored', reason: 'legacy_webhook_org' });
    expect(await eventOf(heldUnmapped.deliveryId)).toMatchObject({ status: 'ignored', reason: 'legacy_webhook_org' });

    delete process.env.GITHUB_WEBHOOK_ORG_ID;
    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 1, recorded: 0 });
    expect(await eventOf(held.deliveryId)).toMatchObject({ status: 'processed', reason: 'already_recorded', deployment_id: legacy });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_job_id === jobId)).toHaveLength(1);

    await withOrgClient(fx.app, orgA, (c) => setRepositoryService(c, orgA, unmapped.rowId, unmapped.serviceId));
    expect(await replayRepository(orgA, unmapped.repoId, MAPPING_REPLAY, fx.app)).toEqual({ considered: 1, recorded: 1 });
    expect(await replayRepository(orgA, unmapped.repoId, MAPPING_REPLAY, fx.app)).toEqual({ considered: 0, recorded: 0 });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === unmapped.repoId)).toHaveLength(1);
  });

  it('another organization is not affected', async () => {
    process.env.GITHUB_WEBHOOK_ORG_ID = orgA;
    const r = await repo(orgB, instB, JOB_RULE);
    const res = await job(instB, r);
    expect((await eventOf(res.deliveryId)).status).toBe('processed');
  });
});

describe('unmapped repositories and replay (rulings D8-D5, Q11)', () => {
  it('unmapped -> event kept, no row, no service created; mapping it replays the event into a row', async () => {
    const r = await repo(orgA, instA, JOB_RULE, false);
    const servicesBefore = (await fx.admin.query('SELECT count(*)::int AS n FROM services WHERE organization_id = $1', [orgA])).rows[0].n;
    const res = await job(instA, r);
    expect(await eventOf(res.deliveryId)).toMatchObject({ status: 'unmapped', reason: 'repository_not_mapped' });
    expect((await fx.admin.query('SELECT count(*)::int AS n FROM services WHERE organization_id = $1', [orgA])).rows[0].n).toBe(servicesBefore);

    await withOrgClient(fx.app, orgA, (c) => setRepositoryService(c, orgA, r.rowId, r.serviceId));
    expect(await replayRepository(orgA, r.repoId, MAPPING_REPLAY, fx.app)).toEqual({ considered: 1, recorded: 1 });
    expect((await eventOf(res.deliveryId)).status).toBe('processed');
    expect(await replayRepository(orgA, r.repoId, MAPPING_REPLAY, fx.app)).toEqual({ considered: 0, recorded: 0 });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId)).toHaveLength(1);
  });

  it('no rule -> kept as no_deploy_rule; setting the rule replays it; jobs the rule does not name stay ignored; rows are never removed', async () => {
    const r = await repo(orgA, instA, null);
    const deploy = await job(instA, r);
    const lint = await job(instA, r, { jobName: 'lint-and-build' });
    expect(await eventOf(deploy.deliveryId)).toMatchObject({ status: 'ignored', reason: 'no_deploy_rule' });

    await withOrgClient(fx.app, orgA, (c) => setRepositoryDeployRule(c, orgA, r.rowId, JOB_RULE));
    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 2, recorded: 1 });
    expect((await eventOf(deploy.deliveryId)).status).toBe('processed');
    expect(await eventOf(lint.deliveryId)).toMatchObject({ status: 'ignored', reason: 'not_deploy_job' });

    const lintRule = storedDeployRule(deployRuleBody.parse({ mode: 'job', workflow_name: 'CI', job_name: 'lint-and-build' }));
    await withOrgClient(fx.app, orgA, (c) => setRepositoryDeployRule(c, orgA, r.rowId, lintRule));
    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 1, recorded: 1 });
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows.map((d) => d.metadata.job_name).sort()).toEqual(['deploy-backend', 'lint-and-build']);
  });

  it('a rule replay pages past 1,000 older events the rule does not match: the newer deploy is recorded; a second replay adds nothing (review S-1)', async () => {
    const r = await repo(orgA, instA, null);
    const lint = await job(instA, r, { jobName: 'lint-and-build' });
    const lintId = (await eventOf(lint.deliveryId)).id;
    // 1,001 older lint events, all received at the same instant (microseconds included),
    // so the 1,000-row page boundary falls inside a tie and only the id orders it.
    await fx.admin.query(`UPDATE pipeline_events SET received_at = date_trunc('second', now()) - interval '1 day' + interval '123456 microseconds' WHERE id = $1`, [lintId]);
    await fx.admin.query(
      `INSERT INTO pipeline_events (delivery_id, organization_id, installation_id, github_repo_id, event, action, event_key, occurred_at,
                                    received_at, normalizer_version, facts, processing_status, processing_reason)
       SELECT gen_random_uuid(), organization_id, installation_id, github_repo_id, event, action, NULL, occurred_at,
              received_at, normalizer_version, facts, processing_status, processing_reason
         FROM pipeline_events, generate_series(1, 1000) WHERE id = $1`, [lintId]);
    const deploy = await job(instA, r);
    expect(await eventOf(deploy.deliveryId)).toMatchObject({ status: 'ignored', reason: 'no_deploy_rule' });

    await withOrgClient(fx.app, orgA, (c) => setRepositoryDeployRule(c, orgA, r.rowId, JOB_RULE));
    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 1002, recorded: 1 });
    expect((await eventOf(deploy.deliveryId)).status).toBe('processed');
    const ignored = (await fx.admin.query(
      `SELECT count(*)::int AS n FROM pipeline_events WHERE github_repo_id = $1 AND processing_reason = 'not_deploy_job'`, [r.repoId])).rows[0].n;
    expect(ignored).toBe(1001);

    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 1001, recorded: 0 });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId)).toHaveLength(1);
  }, 180_000);
});

describe('monthly quota (rulings D8-D9, Q10)', () => {
  // organizations.max_deployments_per_month defaults to 50 and, when the plan is
  // not lowered, wins over the tier's number -- the same resolution as manual
  // POST (subscription.middleware.ts). NULL here = the tier's own limit.
  async function planOrg(tier: string, lifecycle: string | null = null, override: number | null = null): Promise<{ org: string; inst: number }> {
    const org = await fx.org();
    await fx.admin.query(
      `UPDATE organizations SET subscription_tier = $2, billing_lifecycle_state = COALESCE($3, billing_lifecycle_state), max_deployments_per_month = $4 WHERE id = $1`,
      [org, tier, lifecycle, override]);
    const inst = fx.installationId();
    await fx.claim(org, inst);
    return { org, inst };
  }
  async function fill(org: string, serviceId: string, n: number, at: string) {
    for (let i = 0; i < n; i += 1) {
      await fx.admin.query(`INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
        VALUES ($1, 'production', 'us-east-1', 'success', 'seed', $2, $3)`, [serviceId, at, org]);
    }
  }

  it('free (10 a month): 12 concurrent deliveries -> exactly 10 rows and 2 over_limit; an already recorded job stays already_recorded', async () => {
    const { org, inst } = await planOrg('free');
    const r = await repo(org, inst, JOB_RULE);
    const results = await Promise.all(Array.from({ length: 12 }, () => job(inst, r)));
    expect(results.every((x) => x.status === 200)).toBe(true);
    const events = await Promise.all(results.map((x) => eventOf(x.deliveryId)));
    expect(events.filter((e) => e.status === 'processed')).toHaveLength(10);
    expect(events.filter((e) => e.status === 'over_limit').map((e) => e.reason)).toEqual(['monthly_deployment_limit', 'monthly_deployment_limit']);
    expect(await deploymentsOf(org)).toHaveLength(10);

    const recorded = events.find((e) => e.status === 'processed')!;
    const stored = (await fx.admin.query('SELECT id, installation_id, event, action, occurred_at, received_at, facts FROM pipeline_events WHERE id = $1', [recorded.id])).rows[0];
    const again = await processStoredEvent(fx.app, org, {
      id: stored.id, installationId: String(stored.installation_id), event: stored.event, action: stored.action,
      occurredAt: stored.occurred_at, receivedAt: stored.received_at, facts: stored.facts,
    });
    expect(again).toEqual({ status: 'processed', reason: 'already_recorded' });
  });

  it('12 stored events of 12 repositories processed at the same moment on 12 connections (limit 5) -> exactly 5 rows: the quota lock serializes them', async () => {
    // One repository each: events of ONE repository are already serialized by
    // the repository-row upsert, so only the quota lock orders these.
    const { org, inst } = await planOrg('free', null, 5);
    const repos: Repo[] = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await repo(org, inst, JOB_RULE, false);
      repos.push(r);
      await job(inst, r); // unmapped: stored, no row
    }
    for (const r of repos) await fx.admin.query('UPDATE pipeline_repositories SET service_id = $2 WHERE id = $1', [r.rowId, r.serviceId]);
    const stored = (await fx.admin.query(
      `SELECT id, installation_id, event, action, occurred_at, received_at, facts FROM pipeline_events
        WHERE organization_id = $1 AND event = 'workflow_job'`, [org])).rows;
    expect(stored).toHaveLength(12);
    const wide = installTenantTagReset(new Pool({ ...dbConfig(), max: 12, options: '-c role=devcontrol' }));
    try {
      // Every transaction holds a connection before any of them counts.
      const slow: EventProcessor = async (client, o, ev) => { await client.query('SELECT pg_sleep(0.2)'); return processEvent(client, o, ev); };
      const outcomes = await Promise.all(stored.map((e) => processStoredEvent(wide, org, {
        id: e.id, installationId: String(e.installation_id), event: e.event, action: e.action,
        occurredAt: e.occurred_at, receivedAt: e.received_at, facts: e.facts,
      }, slow)));
      expect(outcomes.filter((o) => o.status === 'processed')).toHaveLength(5);
      expect(outcomes.filter((o) => o.status === 'over_limit')).toHaveLength(7);
    } finally {
      await wide.end();
    }
    expect(await deploymentsOf(org)).toHaveLength(5);
  });

  it('counts the month of the deploy itself: October full -> an October job is over_limit, a November job is recorded', async () => {
    const { org, inst } = await planOrg('free');
    const r = await repo(org, inst, JOB_RULE);
    await fill(org, r.serviceId, 10, '2026-10-15T12:00:00Z');
    const october = await job(inst, r, { completedAt: '2026-10-30T10:00:00Z' });
    const november = await job(inst, r, { completedAt: '2026-11-02T10:00:00Z' });
    expect(await eventOf(october.deliveryId)).toMatchObject({ status: 'over_limit', reason: 'monthly_deployment_limit' });
    expect((await eventOf(november.deliveryId)).status).toBe('processed');
  });

  it('the organization\'s own limit column wins while the plan is not lowered (as for manual records)', async () => {
    const { org, inst } = await planOrg('free', null, 2);
    const r = await repo(org, inst, JOB_RULE);
    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await eventOf((await job(inst, r)).deliveryId)).status);
    expect(statuses).toEqual(['processed', 'processed', 'over_limit']);
  });

  it('a lowered plan (stored pro, restricted) gets the free limit even with a larger column; enterprise is unlimited', async () => {
    const lowered = await planOrg('pro', 'restricted', 500);
    const r = await repo(lowered.org, lowered.inst, JOB_RULE);
    await fill(lowered.org, r.serviceId, 10, '2026-11-05T12:00:00Z');
    expect((await eventOf((await job(lowered.inst, r)).deliveryId)).status).toBe('over_limit');

    const big = await planOrg('enterprise');
    const e = await repo(big.org, big.inst, JOB_RULE);
    await fill(big.org, e.serviceId, 12, '2026-11-05T12:00:00Z');
    expect((await eventOf((await job(big.inst, e)).deliveryId)).status).toBe('processed');
  });
});

describe('Environments mode (ruling Q5)', () => {
  const status = (inst: number, r: Repo, opts: Parameters<typeof deploymentStatusCreated>[2]) =>
    deliver('deployment_status', deploymentStatusCreated(inst, r.repoId, opts));

  it('a terminal status -> one row with source github_deployments; unknown environment kept; inactive no row; a later different final status -> later_final_status', async () => {
    const r = await repo(orgA, instA, ENV_RULE);
    const deploymentId = uniqueId();
    const ok = await status(instA, r, { deploymentId, environment: 'Production', state: 'success' });
    const again = await status(instA, r, { deploymentId, environment: 'Production', state: 'failure' });
    const unknown = await status(instA, r, { environment: 'github-pages', state: 'success' });
    const inactive = await status(instA, r, { environment: 'production', state: 'inactive' });
    const jobInEnvMode = await job(instA, r);

    expect((await eventOf(ok.deliveryId)).status).toBe('processed');
    expect(await eventOf(again.deliveryId)).toMatchObject({ status: 'processed', reason: 'later_final_status', deployment_id: (await eventOf(ok.deliveryId)).deployment_id });
    expect(await eventOf(unknown.deliveryId)).toMatchObject({ status: 'ignored', reason: 'unknown_environment' });
    expect(await eventOf(inactive.deliveryId)).toMatchObject({ status: 'ignored', reason: 'state_inactive' });
    expect(await eventOf(jobInEnvMode.deliveryId)).toMatchObject({ status: 'ignored', reason: 'other_mode' });
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ environment: 'production', status: 'success', aws_region: null });
    expect(rows[0].metadata).toMatchObject({ source: 'github_deployments', connection: 'github_app', github_deployment_id: deploymentId, github_environment: 'Production' });
  });
});

describe('later final statuses (ruling 6, review N-1)', () => {
  const status = (inst: number, r: Repo, opts: Parameters<typeof deploymentStatusCreated>[2]) =>
    deliver('deployment_status', deploymentStatusCreated(inst, r.repoId, opts));
  const reprocess = async (deliveryId: string) => {
    const stored = (await fx.admin.query(
      'SELECT id, installation_id, event, action, occurred_at, received_at, facts FROM pipeline_events WHERE delivery_id = $1', [deliveryId])).rows[0];
    return processStoredEvent(fx.app, orgA, {
      id: stored.id, installationId: String(stored.installation_id), event: stored.event, action: stored.action,
      occurredAt: stored.occurred_at, receivedAt: stored.received_at, facts: stored.facts,
    });
  };

  it('error then success: the row stays failed, the success is kept as later_final_status; reprocessing either event changes nothing', async () => {
    const r = await repo(orgA, instA, ENV_RULE);
    const deploymentId = uniqueId();
    const first = await status(instA, r, { deploymentId, state: 'error' });
    const later = await status(instA, r, { deploymentId, state: 'success' });
    const row = (await eventOf(first.deliveryId)).deployment_id;
    expect(await eventOf(first.deliveryId)).toMatchObject({ status: 'processed', reason: null });
    expect(await eventOf(later.deliveryId)).toMatchObject({ status: 'processed', reason: 'later_final_status', deployment_id: row });

    // A true redelivery (the same stored event processed again) stays already_recorded.
    expect(await reprocess(first.deliveryId)).toEqual({ status: 'processed', reason: 'already_recorded' });
    expect(await reprocess(later.deliveryId)).toEqual({ status: 'processed', reason: 'later_final_status' });
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows.map((d) => [d.id, d.status])).toEqual([[row, 'failed']]);
  });

  it('the same final status again (a redelivered or repeated status) stays already_recorded', async () => {
    const r = await repo(orgA, instA, ENV_RULE);
    const deploymentId = uniqueId();
    await status(instA, r, { deploymentId, state: 'success' });
    const repeat = await status(instA, r, { deploymentId, state: 'success' });
    expect(await eventOf(repeat.deliveryId)).toMatchObject({ status: 'processed', reason: 'already_recorded' });
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId)).toHaveLength(1);
  });
});

describe('D6 merge stamp at insert only (ruling Q8)', () => {
  it('a merged pull request stored before the deploy is stamped; one arriving after does not change the row', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    await deliver('pull_request', pullRequestClosed(instA, r.repoId, { mergeSha: SHA_A }));
    const stamped = await job(instA, r, { headSha: SHA_A });
    const late = await job(instA, r, { headSha: SHA_B });
    await deliver('pull_request', pullRequestClosed(instA, r.repoId, { mergeSha: SHA_B }));

    const byEvent = async (deliveryId: string) => {
      const ev = await eventOf(deliveryId);
      return (await fx.admin.query('SELECT metadata FROM deployments WHERE id = $1', [ev.deployment_id])).rows[0].metadata;
    };
    expect(await byEvent(stamped.deliveryId)).toMatchObject({ merged_at: '2026-11-20T09:58:00.000Z', merge_commit_sha: SHA_A, pr_number: 42, merge_source: 'pull_request' });
    const lateMeta = await byEvent(late.deliveryId);
    expect(lateMeta).not.toHaveProperty('merged_at');
    expect(JSON.stringify(lateMeta)).not.toMatch(/Revert|PLANTED/);
  });
});

describe('organization isolation', () => {
  it('another organization with the same GitHub repository id and a rule gets nothing from this one\'s events', async () => {
    const a = await repo(orgA, instA, JOB_RULE);
    const serviceB = await fx.service(orgB, `svc-b-${a.repoId}`);
    await fx.admin.query(
      `INSERT INTO pipeline_repositories (organization_id, github_repo_id, installation_id, full_name, default_branch, service_id, deploy_rule)
       VALUES ($1, $2, $3, $4, 'main', $5, $6::jsonb)`,
      [orgB, a.repoId, instB, `acme/repo-${a.repoId}`, serviceB, JSON.stringify(JOB_RULE)]);
    const res = await job(instA, a);
    expect((await eventOf(res.deliveryId)).status).toBe('processed');
    expect((await deploymentsOf(orgB)).filter((d) => d.metadata.github_repo_id === a.repoId)).toEqual([]);
    expect(await replayRepository(orgB, a.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 0, recorded: 0 });
    // Row level security: B's tagged connection does not see A's rows.
    const seen = await withOrgClient(fx.app, orgB, async (c) =>
      (await c.query(`SELECT count(*)::int AS n FROM deployments WHERE metadata ->> 'github_repo_id' = $1`, [String(a.repoId)])).rows[0].n);
    expect(seen).toBe(0);
  });
});

describe('D8b-2: the 7-day pick-up window (R1), one chosen environment (R2), mappings apply going forward', () => {
  const activityOf = async (org: string, repoId: number) =>
    (await withOrgClient(fx.app, org, (c) => listRepositoryActivity(c, org, { mapping: MAPPING_REPLAY, rule: RULE_REPLAY }))).get(String(repoId));
  const eventRow = async (deliveryId: string) => (await fx.admin.query(
    `SELECT id::text AS id, processing_status AS status, processing_reason AS reason, received_at, processed_at, deployment_id
       FROM pipeline_events WHERE delivery_id = $1`, [deliveryId])).rows[0];

  it('R1: an event held longer than 7 days stays stored, unchanged, and is neither recorded nor counted when the mapping completes', async () => {
    const r = await repo(orgA, instA, JOB_RULE, false);
    const oldJob = uniqueId();
    const old = await job(instA, r, { jobId: oldJob });
    const fresh = await job(instA, r);
    // The old one was received 7 days and 1 minute ago; the fresh one 6 days ago.
    await fx.admin.query(`UPDATE pipeline_events SET received_at = NOW() - interval '7 days 1 minute' WHERE delivery_id = $1`, [old.deliveryId]);
    await fx.admin.query(`UPDATE pipeline_events SET received_at = NOW() - interval '6 days' WHERE delivery_id = $1`, [fresh.deliveryId]);
    const before = await eventRow(old.deliveryId);
    expect(before).toMatchObject({ status: 'unmapped', reason: 'repository_not_mapped' });
    expect((await activityOf(orgA, r.repoId))?.heldForMapping).toBe(1);

    await withOrgClient(fx.app, orgA, (c) => setRepositoryService(c, orgA, r.rowId, r.serviceId));
    expect(await replayRepository(orgA, r.repoId, MAPPING_REPLAY, fx.app)).toEqual({ considered: 1, recorded: 1 });

    // Still there, byte for byte the same row: not deleted, not re-processed, no deployment.
    expect(await eventRow(old.deliveryId)).toEqual(before);
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows.map((d) => d.metadata.github_job_id)).not.toContain(oldJob);
    expect(rows).toHaveLength(1);
    expect((await eventRow(fresh.deliveryId)).status).toBe('processed');
    // Counted nowhere: nothing held is left in the window.
    const after = await activityOf(orgA, r.repoId);
    expect(after?.heldForMapping ?? 0).toBe(0);
    expect(after?.heldForRule ?? 0).toBe(0);
    // A rule replay doesn't reach it either.
    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 0, recorded: 0 });
    expect(await eventRow(old.deliveryId)).toEqual(before);
  });

  it('R1: held counts: no service -> what a mapping picks up (claim holds included, fix round 2 N-1); service without a rule -> no_deploy_rule too; older than 7 days never', async () => {
    const r = await repo(orgA, instA, null, false);
    await job(instA, r);
    await job(instA, r, { jobName: 'lint' });
    const aged = await job(instA, r);
    await fx.admin.query(`UPDATE pipeline_events SET received_at = NOW() - interval '8 days' WHERE delivery_id = $1`, [aged.deliveryId]);
    const claimHold = await job(instA, r);
    await fx.admin.query(`UPDATE pipeline_events SET processing_status = 'pending', processing_reason = $2, processed_at = NULL WHERE delivery_id = $1`,
      [claimHold.deliveryId, NOT_CLAIMED_REASON]);
    // The two and the claim hold: this organization holds the claim here, so the mapping's replay
    // processes the claim hold like any unprocessed event, and the count includes it.
    expect(await activityOf(orgA, r.repoId)).toMatchObject({ heldForMapping: 3, heldForRule: 3 });

    await withOrgClient(fx.app, orgA, (c) => setRepositoryService(c, orgA, r.rowId, r.serviceId));
    expect(await replayRepository(orgA, r.repoId, MAPPING_REPLAY, fx.app)).toEqual({ considered: 3, recorded: 0 });
    // In the window, now waiting for a rule: the same three. The aged one is untouched and uncounted.
    expect(await activityOf(orgA, r.repoId)).toMatchObject({ heldForMapping: 0, heldForRule: 3 });
    expect((await eventRow(aged.deliveryId)).status).toBe('unmapped');
  });

  it('fix round 2 (N-1): one 7-day boundary decides the held count and the release; each count is exactly what its replay picks up', async () => {
    const r = await repo(orgA, instA, null, false);
    const received = async (ago: string, opts: JobOptions = {}) => {
      const d = await job(instA, r, opts);
      await fx.admin.query(`UPDATE pipeline_events SET received_at = NOW() - $2::interval WHERE delivery_id = $1`, [d.deliveryId, ago]);
      return d;
    };
    const setStatus = (d: { deliveryId: string }, status: string, reason: string | null) => fx.admin.query(
      `UPDATE pipeline_events SET processing_status = $2::text, processing_reason = $3::text, processed_at = CASE WHEN $2::text = 'pending' THEN NULL ELSE NOW() END
        WHERE delivery_id = $1`, [d.deliveryId, status, reason]);
    // Either side of the boundary, one minute apart from it.
    const inside = await received('6 days 23 hours 59 minutes');
    const outside = await received('7 days 1 minute');
    // Picked up by a mapping (and a rule): a claim hold this organization can release, a legacy-guard event.
    await setStatus(await received('1 hour'), 'pending', NOT_CLAIMED_REASON);
    await setStatus(await received('1 hour'), 'ignored', 'legacy_webhook_org');
    // Picked up by a rule only: a job an earlier rule decided was not the deploy job.
    await setStatus(await received('1 hour', { jobName: 'lint' }), 'ignored', 'not_deploy_job');
    const outsideRow = async () => (await fx.admin.query('SELECT row_to_json(e)::text AS j FROM pipeline_events e WHERE delivery_id = $1',
      [outside.deliveryId])).rows[0].j as string;
    const outsideBefore = await outsideRow();
    expect((await eventRow(inside.deliveryId)).status).toBe('unmapped');

    const beforeMapping = await activityOf(orgA, r.repoId);
    expect(beforeMapping).toMatchObject({ heldForMapping: 3, heldForRule: 4 });
    await withOrgClient(fx.app, orgA, (c) => setRepositoryService(c, orgA, r.rowId, r.serviceId));
    const mapped = await replayRepository(orgA, r.repoId, MAPPING_REPLAY, fx.app);
    expect(mapped.considered).toBe(beforeMapping!.heldForMapping);

    const beforeRule = await activityOf(orgA, r.repoId);
    expect(beforeRule).toMatchObject({ heldForMapping: 0, heldForRule: 4 });
    await withOrgClient(fx.app, orgA, (c) => setRepositoryDeployRule(c, orgA, r.rowId, JOB_RULE));
    const ruled = await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app);
    expect(ruled).toEqual({ considered: beforeRule!.heldForRule, recorded: 3 });

    // The event one minute past the boundary: never counted, never picked up, byte for byte the same row.
    expect(await activityOf(orgA, r.repoId)).toMatchObject({ heldForMapping: 0, heldForRule: 1 });
    expect(await outsideRow()).toBe(outsideBefore);
    expect((await eventRow(inside.deliveryId)).status).toBe('processed');
  });

  it('R2: a rule for one environment records only that environment; another is kept as environment_not_matched and a rule for it records it later', async () => {
    const prodOnly = storedDeployRule(deployRuleBody.parse({ mode: 'github_deployments', environment_name: 'Production' }));
    expect(prodOnly).toEqual({ v: 1, mode: 'github_deployments', environment_name: 'Production', environment_map: {}, aws_region: null });
    const r = await repo(orgA, instA, prodOnly);
    const prodId = uniqueId();
    const stageId = uniqueId();
    const prod = await deliver('deployment_status', deploymentStatusCreated(instA, r.repoId, { environment: 'production', deploymentId: prodId }));
    const stage = await deliver('deployment_status', deploymentStatusCreated(instA, r.repoId, { environment: 'staging', deploymentId: stageId }));
    expect((await eventOf(prod.deliveryId)).status).toBe('processed');
    expect(await eventOf(stage.deliveryId)).toMatchObject({ status: 'ignored', reason: 'environment_not_matched', deployment_id: null });
    let rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows.map((d) => [d.metadata.github_deployment_id, d.environment])).toEqual([[prodId, 'production']]);

    const stagingOnly = storedDeployRule(deployRuleBody.parse({ mode: 'github_deployments', environment_name: 'staging' }));
    await withOrgClient(fx.app, orgA, (c) => setRepositoryDeployRule(c, orgA, r.rowId, stagingOnly));
    expect(await replayRepository(orgA, r.repoId, RULE_REPLAY, fx.app)).toEqual({ considered: 1, recorded: 1 });
    rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    // The production row stays as it was; the staging one is added.
    expect(rows.map((d) => [d.metadata.github_deployment_id, d.environment]).sort()).toEqual([[prodId, 'production'], [stageId, 'staging']].sort());
  });

  it('R2: a chosen name the default names do not know records as production; a rule without a name still records every known name', async () => {
    const custom = await repo(orgA, instA, storedDeployRule(deployRuleBody.parse({ mode: 'github_deployments', environment_name: 'prod-eu' })));
    const eu = await deliver('deployment_status', deploymentStatusCreated(instA, custom.repoId, { environment: 'PROD-EU' }));
    expect((await eventOf(eu.deliveryId)).status).toBe('processed');
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === custom.repoId).map((d) => d.environment)).toEqual(['production']);

    const all = await repo(orgA, instA, ENV_RULE);
    await deliver('deployment_status', deploymentStatusCreated(instA, all.repoId, { environment: 'production' }));
    await deliver('deployment_status', deploymentStatusCreated(instA, all.repoId, { environment: 'staging' }));
    expect((await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === all.repoId).map((d) => d.environment).sort())
      .toEqual(['production', 'staging']);
  });

  it('a mapping change applies going forward: rows already recorded keep their service; only new events go to the new one', async () => {
    const r = await repo(orgA, instA, JOB_RULE);
    const first = await job(instA, r);
    expect((await eventOf(first.deliveryId)).status).toBe('processed');
    const other = await fx.service(orgA, `svc-other-${r.repoId}`);
    await withOrgClient(fx.app, orgA, (c) => setRepositoryService(c, orgA, r.rowId, other));
    expect(await replayRepository(orgA, r.repoId, MAPPING_REPLAY, fx.app)).toEqual({ considered: 0, recorded: 0 });
    const second = await job(instA, r, { completedAt: '2026-11-20T11:07:30Z' });
    expect((await eventOf(second.deliveryId)).status).toBe('processed');
    const rows = (await deploymentsOf(orgA)).filter((d) => d.metadata.github_repo_id === r.repoId);
    expect(rows.map((d) => d.service_id)).toEqual([r.serviceId, other]);
    expect(rows[0].id).toBe((await eventOf(first.deliveryId)).deployment_id);
  });
});
