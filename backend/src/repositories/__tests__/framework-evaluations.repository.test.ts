/**
 * framework-evaluations.repository.ts against real Postgres: the generation rule
 * (write guard, current run, stale), the per-resource transaction and what a
 * failure of it leaves behind, recovery on the next run, pruning, and tenant
 * scoping.
 *
 * Two harnesses, because one connection cannot show both things:
 *
 *   - "real tables": the tables of the test database, through a superuser pool
 *     (the only login role available locally and in CI). Needed where a real
 *     COMMIT or a second connection is required: overlapping runs, lock timeout,
 *     rollback and recovery. A superuser bypasses row-level security, so these
 *     tests prove the SQL's own organization predicates and the generation rule,
 *     not the policies.
 *   - "as the application role": the actual migration applied in an isolated
 *     schema inside one rolled-back transaction, acting as devcontrol (NOLOGIN, so
 *     SET LOCAL ROLE) under forced row-level security. The repository's own
 *     BEGIN/COMMIT/ROLLBACK are mapped onto a savepoint so the outer transaction
 *     survives. Proves the same functions work with the application's privileges
 *     and expose nothing of another organization.
 */
import { Client, Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import {
  ABANDONED_RUN_AFTER_MINUTES,
  FrameworkRun,
  PersistResourceInput,
  RUN_RETENTION_DAYS,
  StoredFailure,
  failFrameworkRun,
  finishFrameworkRun,
  frameworkEvaluationStorageAvailable,
  persistResourceEvaluation,
  readFrameworkEvaluations,
  recordReconciliationRequired,
  startFrameworkRun,
  writeBaselinePreservingFrameworkFindings,
} from '../framework-evaluations.repository';
import { ComplianceIssue, FindingEvaluationState, FrameworkApplicabilityState, FrameworkCheckEvaluation } from '../../types/aws-resources.types';
import { PLACEHOLDER_ACCOUNT_ROW, TestLeases } from '../../services/__tests__/helpers/scan-source';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';
import { acquireScanLease } from '../../services/scan-lease';
import { SCAN_KIND_DISCOVERY } from '../../services/scan-session';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};
const pool = new Pool(dbConfig);
const createdOrgIds: string[] = [];
const leases = new TestLeases(pool);

const BACKUPS = 'hipaa.automated_backups';
const RETENTION = 'hipaa.backup_retention_policy';
const REGISTERED = ['hipaa.customer_managed_key', 'hipaa.encryption_in_transit', 'hipaa.access_logging', BACKUPS, RETENTION, 'hipaa.s3_versioning'];
const BASELINE: ComplianceIssue = { severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner', recommendation: 'r', provenance: 'SELF_ATTESTED' };

function outcome(check: string, state: FindingEvaluationState, severity: 'critical' | 'high' | null = null): FrameworkCheckEvaluation {
  return {
    framework: 'HIPAA', check, applicability: 'enabled', evaluation_state: state,
    severity: state === 'failed' ? severity ?? 'critical' : null,
    evidence_basis: state === 'failed' || state === 'passed' ? 'aws_api' : 'none',
    provenance: state === 'failed' || state === 'passed' ? 'OBSERVED' : null,
    reason_code: state === 'failed' ? 'no_backup_reported' : state === 'passed' ? 'backup_reported' : state === 'error' ? 'check_exception' : 'backup_state_unknown',
    reason: '', error_code: state === 'error' ? 'check_exception' : null, resource_arn: 'arn',
  };
}

/** A projection that says exactly which stored failures it was built from. */
const project = (failures: StoredFailure[]): ComplianceIssue[] =>
  failures.map((f) => ({
    severity: f.severity, category: 'backups', issue: `${f.framework}: ${f.check}`, recommendation: 'r',
    findingKey: f.check, framework: f.framework, applicability: 'enabled', evaluation_state: 'failed',
  }));

function input(orgId: string, resourceId: string, run: FrameworkRun, evaluations: FrameworkCheckEvaluation[], overrides: Partial<PersistResourceInput> = {}): PersistResourceInput {
  return {
    organizationId: orgId, resourceId, evaluatorVersion: '1', baselineIssues: [BASELINE],
    frameworks: [{ run, evaluations, registeredCheckKeys: REGISTERED }], project, lease: leases.of(orgId), ...overrides,
  };
}

const start = (executor: Pick<PoolClient, 'query'>, orgId: string, applicability: FrameworkApplicabilityState = 'enabled', jobId: string | null = null) =>
  startFrameworkRun(executor, {
    organizationId: orgId, framework: 'HIPAA', applicability,
    reasonCode: applicability === 'enabled' ? 'explicitly_enabled' : applicability === 'disabled' ? 'explicitly_disabled' : 'settings_unavailable',
    discoveryJobId: jobId, evaluatorVersion: '1',
  });

const finish = (executor: Pick<PoolClient, 'query'>, orgId: string, run: FrameworkRun, persisted: number, failed: number) =>
  finishFrameworkRun(executor, orgId, run.id, { inScope: persisted + failed, persisted, failed, stateCounts: {} });

// ─── real tables ────────────────────────────────────────────────────────────

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Framework Eval Org ${suffix}`, `framework-eval-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

async function insertResource(orgId: string, name: string, issues: unknown[] = []): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, compliance_issues)
     VALUES ($1, $2, $3, 'ebs', 'us-east-1', 'available', $4) RETURNING id`,
    [orgId, `arn:aws:ec2:us-east-1:111122223333:volume/${name}-${orgId}`, name, JSON.stringify(issues)]
  );
  return rows[0].id;
}

/** A dedicated connection tagged for the organization, as discovery's is. */
async function connectFor(orgId: string): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query(`SELECT set_config('app.current_organization_id', $1, false)`, [orgId]);
  return client;
}

async function issuesOf(resourceId: string): Promise<any[]> {
  return (await pool.query(`SELECT compliance_issues FROM aws_resources WHERE id = $1`, [resourceId])).rows[0].compliance_issues;
}

async function runStatus(runId: string): Promise<{ status: string; failure_code: string | null; resources_failed: number | null }> {
  return (await pool.query(`SELECT status, failure_code, resources_failed FROM framework_evaluation_runs WHERE id = $1`, [runId])).rows[0];
}

/** check -> [state, stale] for one resource, from the same read the API uses. */
async function stateOf(client: PoolClient, orgId: string, resourceId: string): Promise<Record<string, [string, boolean]>> {
  const { checks } = await readFrameworkEvaluations(client, orgId);
  return Object.fromEntries(checks.filter((c) => c.resource_id === resourceId).map((c) => [c.check, [c.evaluation_state, c.stale]]));
}

afterAll(async () => {
  await leases.cleanup();
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM framework_evaluation_runs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('real tables: the generation rule decides what is current and what is stale', () => {
  let orgId: string;
  let client: PoolClient;
  beforeEach(async () => {
    orgId = await insertOrg();
    client = await connectFor(orgId);
  });
  afterEach(() => client.release());

  it('a check evaluated in the latest complete run is current', async () => {
    const resource = await insertResource(orgId, 'vol-1');
    const run = await start(client, orgId);
    expect(await persistResourceEvaluation(client, input(orgId, resource, run, [outcome(BACKUPS, 'failed')]))).toMatchObject({ outcome: 'persisted' });

    // Until the run finishes there is no finished run to confirm the row: it is not yet current.
    expect(await stateOf(client, orgId, resource)).toEqual({ [BACKUPS]: ['failed', true] });
    expect(await finish(client, orgId, run, 1, 0)).toBe(true);

    expect(await stateOf(client, orgId, resource)).toEqual({ [BACKUPS]: ['failed', false] });
    expect(await runStatus(run.id)).toEqual({ status: 'complete', failure_code: null, resources_failed: 0 });
    expect((await readFrameworkEvaluations(client, orgId)).latestRuns).toEqual([
      expect.objectContaining({ framework: 'HIPAA', applicability: 'enabled', applicability_reason_code: 'explicitly_enabled', status: 'complete', aged: false }),
    ]);
  });

  it('a partial run: the resource whose transaction failed is stale once it finishes, the one it stored is current, and a resource never evaluated has no row at all', async () => {
    const stored = await insertResource(orgId, 'vol-stored');
    const failing = await insertResource(orgId, 'vol-failing');
    const never = await insertResource(orgId, 'vol-never');

    const first = await start(client, orgId);
    await persistResourceEvaluation(client, input(orgId, stored, first, [outcome(BACKUPS, 'failed')]));
    await persistResourceEvaluation(client, input(orgId, failing, first, [outcome(BACKUPS, 'failed')]));
    await finish(client, orgId, first, 2, 0);
    const failingIssuesBefore = await issuesOf(failing);

    const second = await start(client, orgId);
    await persistResourceEvaluation(client, input(orgId, stored, second, [outcome(BACKUPS, 'passed')]));
    // This resource's transaction fails after its check rows were written, before the findings are.
    const failed = await persistResourceEvaluation(client, input(orgId, failing, second, [outcome(BACKUPS, 'passed')], {
      project: () => { throw new Error('projection failed'); },
    }));
    expect(failed).toEqual({ outcome: 'failed', failureCode: 'persist_error' });
    // `never` is in scope and is simply not reached (its transaction failed too, before any row existed).
    const neverResult = await persistResourceEvaluation(client, input(orgId, never, second, [outcome(BACKUPS, 'failed')], {
      project: () => { throw new Error('projection failed'); },
    }));
    expect(neverResult).toEqual({ outcome: 'failed', failureCode: 'persist_error' });

    // Nothing of the failed transaction was kept: same state, same findings.
    expect(await stateOf(client, orgId, failing)).toEqual({ [BACKUPS]: ['failed', false] });
    expect(await issuesOf(failing)).toEqual(failingIssuesBefore);

    await finish(client, orgId, second, 1, 2);

    // The run's status and each row's derived state agree.
    expect(await runStatus(second.id)).toEqual({ status: 'partial', failure_code: null, resources_failed: 2 });
    expect(await stateOf(client, orgId, stored)).toEqual({ [BACKUPS]: ['passed', false] });
    expect(await stateOf(client, orgId, failing)).toEqual({ [BACKUPS]: ['failed', true] });
    // No stored result exists for it, so there is nothing to call stale.
    expect(await stateOf(client, orgId, never)).toEqual({});
    expect((await pool.query(`SELECT count(*)::int AS n FROM compliance_check_evaluations WHERE resource_id = $1`, [never])).rows[0].n).toBe(0);
  });

  it('a previously stored check that a newer run does not touch is stale', async () => {
    const touched = await insertResource(orgId, 'vol-touched');
    const omitted = await insertResource(orgId, 'vol-omitted');
    const first = await start(client, orgId);
    await persistResourceEvaluation(client, input(orgId, touched, first, [outcome(BACKUPS, 'failed')]));
    await persistResourceEvaluation(client, input(orgId, omitted, first, [outcome(BACKUPS, 'failed')]));
    await finish(client, orgId, first, 2, 0);

    const second = await start(client, orgId);
    await persistResourceEvaluation(client, input(orgId, touched, second, [outcome(BACKUPS, 'failed')]));
    await finish(client, orgId, second, 1, 0);

    expect(await stateOf(client, orgId, touched)).toEqual({ [BACKUPS]: ['failed', false] });
    expect(await stateOf(client, orgId, omitted)).toEqual({ [BACKUPS]: ['failed', true] });
  });

  it('a failed run never becomes the current run, and does not make the finished run\'s rows stale', async () => {
    const a = await insertResource(orgId, 'vol-a');
    const b = await insertResource(orgId, 'vol-b');
    const finished = await start(client, orgId);
    await persistResourceEvaluation(client, input(orgId, a, finished, [outcome(BACKUPS, 'failed')]));
    await persistResourceEvaluation(client, input(orgId, b, finished, [outcome(BACKUPS, 'failed')]));
    await finish(client, orgId, finished, 2, 0);

    const failing = await start(client, orgId, 'disabled');
    await persistResourceEvaluation(client, input(orgId, a, failing, []));
    await failFrameworkRun(client, orgId, failing.id, 'unexpected');

    const read = await readFrameworkEvaluations(client, orgId);
    // Still the finished run, with ITS applicability -- not the failed run's.
    expect(read.latestRuns).toEqual([expect.objectContaining({ status: 'complete', applicability: 'enabled' })]);
    expect(read.activity).toEqual([{ framework: 'HIPAA', running: false, last_attempt_failed: true }]);
    expect(await runStatus(failing.id)).toMatchObject({ status: 'failed', failure_code: 'unexpected' });
    // b was not touched by the failed run: its row is the finished run's, and current.
    expect(await stateOf(client, orgId, b)).toEqual({ [BACKUPS]: ['failed', false] });
    // a's row is what the failed run stored before failing (a real, newer evaluation), not stale.
    expect(await stateOf(client, orgId, a)).toEqual({ [BACKUPS]: ['not_evaluated', false] });
  });

  it('an abandoned run is closed as failed by the next run and never becomes the current run', async () => {
    const resource = await insertResource(orgId, 'vol-1');
    const finished = await start(client, orgId);
    await persistResourceEvaluation(client, input(orgId, resource, finished, [outcome(BACKUPS, 'failed')]));
    await finish(client, orgId, finished, 1, 0);

    const abandoned = await start(client, orgId);
    const live = await start(client, orgId);
    await pool.query(`UPDATE framework_evaluation_runs SET heartbeat_at = clock_timestamp() - make_interval(mins => $2) WHERE id = $1`,
      [abandoned.id, ABANDONED_RUN_AFTER_MINUTES + 1]);

    const next = await start(client, orgId);

    expect(await runStatus(abandoned.id)).toMatchObject({ status: 'failed', failure_code: 'abandoned' });
    // A run that is still reporting is left alone.
    expect(await runStatus(live.id)).toMatchObject({ status: 'running' });
    expect(await runStatus(next.id)).toMatchObject({ status: 'running' });
    expect((await readFrameworkEvaluations(client, orgId)).latestRuns).toEqual([expect.objectContaining({ status: 'complete' })]);
    expect(await stateOf(client, orgId, resource)).toEqual({ [BACKUPS]: ['failed', false] });
    // A run closed as abandoned that then tries to finish is told so; nothing changes.
    expect(await finish(client, orgId, abandoned, 1, 0)).toBe(false);
    expect(await runStatus(abandoned.id)).toMatchObject({ status: 'failed', failure_code: 'abandoned' });
  });

  it('overlapping runs: an older generation cannot overwrite a newer one\'s row, and the findings follow the stored row', async () => {
    const contested = await insertResource(orgId, 'vol-contested');
    const onlyOlder = await insertResource(orgId, 'vol-only-older');
    const other = await connectFor(orgId);
    try {
      const older = await start(client, orgId);
      const newer = await start(other, orgId);
      expect(BigInt(newer.generation)).toBeGreaterThan(BigInt(older.generation));

      // The newer run stores a pass first.
      await persistResourceEvaluation(other, input(orgId, contested, newer, [outcome(BACKUPS, 'passed')]));
      await finish(other, orgId, newer, 1, 0);

      // The older run, still going, then evaluates the same resource as failed.
      const late = await persistResourceEvaluation(client, input(orgId, contested, older, [outcome(BACKUPS, 'failed')]));

      // Its write was rejected; its transaction still committed, with findings built from the STORED row.
      expect(late).toEqual({ outcome: 'persisted', frameworkIssues: [] });
      expect(await stateOf(client, orgId, contested)).toEqual({ [BACKUPS]: ['passed', false] });
      expect(await issuesOf(contested)).toEqual([BASELINE]);

      // It may still fill in a resource the newer run never wrote...
      await persistResourceEvaluation(client, input(orgId, onlyOlder, older, [outcome(BACKUPS, 'failed')]));
      await finish(client, orgId, older, 2, 0);
      // ...and that row, being older than the current run, is stale.
      expect(await stateOf(client, orgId, onlyOlder)).toEqual({ [BACKUPS]: ['failed', true] });
      expect((await issuesOf(onlyOlder)).map((i) => i.findingKey)).toEqual([undefined, BACKUPS]);

      // Finishing later does not make the older run the current one.
      const { rows } = await pool.query(
        `SELECT id FROM framework_evaluation_runs WHERE organization_id = $1 AND status IN ('complete', 'partial') ORDER BY generation DESC LIMIT 1`,
        [orgId]
      );
      expect(rows[0].id).toBe(newer.id);
    } finally {
      other.release();
    }
  });

  it('the same run evaluating a resource twice is idempotent', async () => {
    const resource = await insertResource(orgId, 'vol-1');
    const run = await start(client, orgId);
    const once = await persistResourceEvaluation(client, input(orgId, resource, run, [outcome(BACKUPS, 'failed'), outcome(RETENTION, 'unable_to_evaluate')]));
    const snapshot = (await pool.query(`SELECT check_key, evaluation_state, severity, run_generation FROM compliance_check_evaluations WHERE resource_id = $1 ORDER BY check_key`, [resource])).rows;
    const twice = await persistResourceEvaluation(client, input(orgId, resource, run, [outcome(BACKUPS, 'failed'), outcome(RETENTION, 'unable_to_evaluate')]));

    expect(twice).toEqual(once);
    expect((await pool.query(`SELECT check_key, evaluation_state, severity, run_generation FROM compliance_check_evaluations WHERE resource_id = $1 ORDER BY check_key`, [resource])).rows).toEqual(snapshot);
    expect(await issuesOf(resource)).toHaveLength(2);
  });
});

describe('real tables: states, last conclusive result and the findings projection', () => {
  let orgId: string;
  let client: PoolClient;
  let resource: string;
  beforeEach(async () => {
    orgId = await insertOrg();
    client = await connectFor(orgId);
    resource = await insertResource(orgId, 'vol-1');
  });
  afterEach(() => client.release());

  const stored = async () =>
    (await pool.query(
      `SELECT check_key, evaluation_state, severity, evidence_basis, provenance, reason_code, error_code,
              last_conclusive_state, last_conclusive_severity, last_conclusive_at IS NOT NULL AS has_conclusive_at
         FROM compliance_check_evaluations WHERE resource_id = $1 ORDER BY check_key`,
      [resource]
    )).rows;

  async function evaluate(evaluations: FrameworkCheckEvaluation[], applicability: FrameworkApplicabilityState = 'enabled') {
    const run = await start(client, orgId, applicability);
    const result = await persistResourceEvaluation(client, input(orgId, resource, run, applicability === 'enabled' ? evaluations : []));
    await finish(client, orgId, run, 1, 0);
    return result;
  }

  it('only a stored failure is projected as a finding; every other state is stored and never becomes one', async () => {
    const states: FindingEvaluationState[] = ['passed', 'unable_to_evaluate', 'error'];
    for (const state of states) {
      await evaluate([outcome(BACKUPS, state)]);
      expect(await issuesOf(resource)).toEqual([BASELINE]);
      expect((await stored())[0]).toMatchObject({ check_key: BACKUPS, evaluation_state: state, severity: null });
    }
    await evaluate([outcome(BACKUPS, 'failed', 'high')]);
    expect(await issuesOf(resource)).toEqual([BASELINE, expect.objectContaining({ findingKey: BACKUPS, severity: 'high', framework: 'HIPAA', evaluation_state: 'failed' })]);
  });

  it('keeps the last conclusive result through error, missing evidence and a framework that is no longer evaluated', async () => {
    await evaluate([outcome(BACKUPS, 'failed', 'critical')]);
    expect(await stored()).toEqual([expect.objectContaining({
      evaluation_state: 'failed', severity: 'critical', evidence_basis: 'aws_api', provenance: 'OBSERVED',
      last_conclusive_state: 'failed', last_conclusive_severity: 'critical', has_conclusive_at: true,
    })]);

    const kept = { last_conclusive_state: 'failed', last_conclusive_severity: 'critical', has_conclusive_at: true };

    await evaluate([outcome(BACKUPS, 'error')]);
    expect(await stored()).toEqual([expect.objectContaining({ evaluation_state: 'error', severity: null, error_code: 'check_exception', reason_code: 'check_exception', ...kept })]);
    expect(await issuesOf(resource)).toEqual([BASELINE]);

    await evaluate([outcome(BACKUPS, 'unable_to_evaluate')]);
    expect(await stored()).toEqual([expect.objectContaining({ evaluation_state: 'unable_to_evaluate', severity: null, error_code: null, ...kept })]);

    for (const [applicability, reason] of [['disabled', 'explicitly_disabled'], ['unavailable', 'settings_unavailable']] as const) {
      await evaluate([], applicability);
      expect(await stored()).toEqual([expect.objectContaining({
        evaluation_state: 'not_evaluated', severity: null, evidence_basis: 'none', provenance: null, reason_code: reason, ...kept,
      })]);
      expect(await issuesOf(resource)).toEqual([BASELINE]);
    }

    // A real pass replaces it.
    await evaluate([outcome(BACKUPS, 'passed')]);
    expect(await stored()).toEqual([expect.objectContaining({ evaluation_state: 'passed', last_conclusive_state: 'passed', last_conclusive_severity: null, has_conclusive_at: true })]);
  });

  it('a framework that is not enabled creates no row for a resource that never had one', async () => {
    for (const applicability of ['disabled', 'not_configured', 'unavailable', 'invalid'] as const) {
      const run = await startFrameworkRun(client, { organizationId: orgId, framework: 'HIPAA', applicability, reasonCode: 'no_setting', discoveryJobId: null, evaluatorVersion: '1' });
      expect(await persistResourceEvaluation(client, input(orgId, resource, run, []))).toEqual({ outcome: 'persisted', frameworkIssues: [] });
      await finish(client, orgId, run, 1, 0);
    }
    expect(await stored()).toEqual([]);
    expect(await issuesOf(resource)).toEqual([BASELINE]);
  });

  it('a check that stops applying, or is retired, becomes not_applicable: the row and its last conclusive result are kept', async () => {
    await evaluate([outcome(BACKUPS, 'failed', 'critical'), outcome(RETENTION, 'unable_to_evaluate'), outcome('hipaa.retired_check', 'passed')]);

    // The next run produces an outcome for RETENTION only.
    await evaluate([outcome(RETENTION, 'unable_to_evaluate')]);

    expect(await stored()).toEqual([
      expect.objectContaining({
        check_key: BACKUPS, evaluation_state: 'not_applicable', severity: null, reason_code: 'check_not_applicable_to_resource',
        last_conclusive_state: 'failed', last_conclusive_severity: 'critical',
      }),
      expect.objectContaining({ check_key: RETENTION, evaluation_state: 'unable_to_evaluate' }),
      expect.objectContaining({
        check_key: 'hipaa.retired_check', evaluation_state: 'not_applicable', reason_code: 'check_retired', last_conclusive_state: 'passed',
      }),
    ]);
    expect(await issuesOf(resource)).toEqual([BASELINE]);
    // Not stale: the latest run did account for them.
    expect(Object.values(await stateOf(client, orgId, resource)).map(([, stale]) => stale)).toEqual([false, false, false]);

    // It applies again later: evaluated normally.
    await evaluate([outcome(BACKUPS, 'passed'), outcome(RETENTION, 'unable_to_evaluate')]);
    expect((await stored())[0]).toMatchObject({ check_key: BACKUPS, evaluation_state: 'passed', last_conclusive_state: 'passed' });
  });

  it('several frameworks: each one\'s rows and findings are kept apart', async () => {
    const hipaa = await start(client, orgId);
    const second = await startFrameworkRun(client, { organizationId: orgId, framework: 'SECOND', applicability: 'enabled', reasonCode: 'explicitly_enabled', discoveryJobId: null, evaluatorVersion: '1' });
    await persistResourceEvaluation(client, {
      organizationId: orgId, resourceId: resource, evaluatorVersion: '1', baselineIssues: [BASELINE], project, lease: leases.of(orgId),
      frameworks: [
        { run: hipaa, evaluations: [outcome(BACKUPS, 'failed')], registeredCheckKeys: REGISTERED },
        { run: second, evaluations: [{ ...outcome('second.check', 'failed', 'high'), framework: 'SECOND' }], registeredCheckKeys: ['second.check'] },
      ],
    });
    await finish(client, orgId, hipaa, 1, 0);
    await finish(client, orgId, second, 1, 0);

    expect((await issuesOf(resource)).map((i) => [i.framework, i.findingKey, i.severity])).toEqual([
      [undefined, undefined, 'low'], ['HIPAA', BACKUPS, 'critical'], ['SECOND', 'second.check', 'high'],
    ]);

    // Disabling one leaves the other's finding in place.
    const disabled = await start(client, orgId, 'disabled');
    const secondAgain = await startFrameworkRun(client, { organizationId: orgId, framework: 'SECOND', applicability: 'enabled', reasonCode: 'explicitly_enabled', discoveryJobId: null, evaluatorVersion: '1' });
    await persistResourceEvaluation(client, {
      organizationId: orgId, resourceId: resource, evaluatorVersion: '1', baselineIssues: [BASELINE], project, lease: leases.of(orgId),
      frameworks: [
        { run: disabled, evaluations: [], registeredCheckKeys: REGISTERED },
        { run: secondAgain, evaluations: [{ ...outcome('second.check', 'failed', 'high'), framework: 'SECOND' }], registeredCheckKeys: ['second.check'] },
      ],
    });
    expect((await issuesOf(resource)).map((i) => i.framework)).toEqual([undefined, 'SECOND']);
  });
});

describe('real tables: a failed resource transaction, and recovery', () => {
  let orgId: string;
  let client: PoolClient;
  let resource: string;
  const FRAMEWORK_FINDING = { severity: 'critical', category: 'backups', issue: `HIPAA: ${BACKUPS}`, recommendation: 'r', findingKey: BACKUPS, framework: 'HIPAA', applicability: 'enabled', evaluation_state: 'failed' };

  beforeEach(async () => {
    orgId = await insertOrg();
    client = await connectFor(orgId);
    resource = await insertResource(orgId, 'vol-1');
    const run = await start(client, orgId);
    await persistResourceEvaluation(client, input(orgId, resource, run, [outcome(BACKUPS, 'failed')]));
    await finish(client, orgId, run, 1, 0);
  });
  afterEach(() => client.release());

  const reconciliation = async () =>
    (await pool.query(`SELECT failure_count, failure_code FROM framework_evaluation_reconciliations WHERE resource_id = $1`, [resource])).rows;

  /** Fails the statement whose text matches, once, as the database would. */
  function failingOn(pattern: RegExp, code = 'XX000') {
    const original = client.query.bind(client);
    return jest.spyOn(client, 'query').mockImplementation(((...args: any[]) => {
      if (typeof args[0] === 'string' && pattern.test(args[0])) {
        return original(`SELECT 1 / 0`).catch((cause: Error) => { throw Object.assign(new Error('injected'), { code, cause }); });
      }
      return (original as any)(...args);
    }) as any);
  }

  it.each([
    ['the check rows are written and the findings write then fails', /UPDATE aws_resources SET compliance_issues/],
    ['a check row write fails before the findings are written', /INSERT INTO compliance_check_evaluations/],
  ])('when %s: neither changes, the failure is reported, and the connection stays usable', async (_name, pattern) => {
    const before = { issues: await issuesOf(resource), state: await stateOf(client, orgId, resource) };
    const run = await start(client, orgId);
    const spy = failingOn(pattern);

    const result = await persistResourceEvaluation(client, input(orgId, resource, run, [outcome(BACKUPS, 'passed')]));
    spy.mockRestore();

    expect(result).toEqual({ outcome: 'failed', failureCode: 'persist_error' });
    expect(await issuesOf(resource)).toEqual(before.issues);
    expect(await stateOf(client, orgId, resource)).toEqual(before.state);
    // No transaction is left open or aborted on the connection.
    expect((await client.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
    expect((await client.query(`SELECT current_setting('app.current_organization_id', true) AS org`)).rows[0].org).toBe(orgId);
  });

  it('after a failure: the marker is recorded, the baseline is refreshed, the framework finding is preserved unchanged and reads as stale; the next run reconciles', async () => {
    const failing = await start(client, orgId);
    const spy = failingOn(/UPDATE aws_resources SET compliance_issues/);
    const failed = await persistResourceEvaluation(client, input(orgId, resource, failing, [outcome(BACKUPS, 'passed')]));
    spy.mockRestore();
    expect(failed).toEqual({ outcome: 'failed', failureCode: 'persist_error' });

    await recordReconciliationRequired(client, { organizationId: orgId, resourceId: resource, failureCode: 'persist_error', generation: failing.generation });
    const newBaseline: ComplianceIssue = { ...BASELINE, issue: 'Resource is missing required tags: Team' };
    await writeBaselinePreservingFrameworkFindings(client, { organizationId: orgId, resourceId: resource, baselineIssues: [newBaseline] });
    await finish(client, orgId, failing, 0, 1);

    // Observable, durable: a partial run, a marker, and a stale row behind the preserved finding.
    expect(await runStatus(failing.id)).toMatchObject({ status: 'partial', resources_failed: 1 });
    expect(await reconciliation()).toEqual([{ failure_count: 1, failure_code: 'persist_error' }]);
    expect(await issuesOf(resource)).toEqual([newBaseline, FRAMEWORK_FINDING]);
    expect(await stateOf(client, orgId, resource)).toEqual({ [BACKUPS]: ['failed', true] });

    // It fails again on the next scan: counted, not silently repeated.
    const again = await start(client, orgId);
    await recordReconciliationRequired(client, { organizationId: orgId, resourceId: resource, failureCode: 'lock_timeout', generation: again.generation });
    await finish(client, orgId, again, 0, 1);
    expect(await reconciliation()).toEqual([{ failure_count: 2, failure_code: 'lock_timeout' }]);

    // The failure is gone: the next run stores the evaluation, rebuilds the findings and clears the marker.
    const recovered = await start(client, orgId);
    expect(await persistResourceEvaluation(client, input(orgId, resource, recovered, [outcome(BACKUPS, 'passed')]))).toEqual({ outcome: 'persisted', frameworkIssues: [] });
    await finish(client, orgId, recovered, 1, 0);

    expect(await reconciliation()).toEqual([]);
    expect(await issuesOf(resource)).toEqual([BASELINE]);
    expect(await stateOf(client, orgId, resource)).toEqual({ [BACKUPS]: ['passed', false] });
    expect(await runStatus(recovered.id)).toMatchObject({ status: 'complete', resources_failed: 0 });
  });

  it('writeBaselinePreservingFrameworkFindings keeps framework entries exactly, replaces everything else, and tolerates a malformed array', async () => {
    const frameworkEntry = { ...FRAMEWORK_FINDING, verification: 'unverified', extra: { nested: [1, 2] } };
    for (const previous of [
      [BASELINE, frameworkEntry, null, 'text', 7, { issue: 'HIPAA: legacy entry with no framework key', severity: 'high' }],
      { not: 'an array' },
      null,
    ]) {
      await pool.query(`UPDATE aws_resources SET compliance_issues = $1 WHERE id = $2`, [JSON.stringify(previous), resource]);
      const fresh: ComplianceIssue = { ...BASELINE, issue: 'fresh baseline' };
      await writeBaselinePreservingFrameworkFindings(client, { organizationId: orgId, resourceId: resource, baselineIssues: [fresh] });
      expect(await issuesOf(resource)).toEqual(Array.isArray(previous) ? [fresh, frameworkEntry] : [fresh]);
    }
  });

  it('a resource locked by another scan: reported as lock_timeout, nothing written, connection usable', async () => {
    const other = await connectFor(orgId);
    try {
      await other.query('BEGIN');
      await other.query(`SELECT 1 FROM aws_resources WHERE id = $1 FOR UPDATE`, [resource]);
      const before = await issuesOf(resource);
      const run = await start(client, orgId);

      const result = await persistResourceEvaluation(client, input(orgId, resource, run, [outcome(BACKUPS, 'passed')]));

      expect(result).toEqual({ outcome: 'failed', failureCode: 'lock_timeout' });
      await other.query('ROLLBACK');
      expect(await issuesOf(resource)).toEqual(before);
      expect((await client.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
      // The row is still the earlier run's. It is current until this run finishes as
      // partial, and stale from then on -- the run's status and the row agree.
      expect(await stateOf(client, orgId, resource)).toEqual({ [BACKUPS]: ['failed', false] });
      await finish(client, orgId, run, 0, 1);
      expect(await runStatus(run.id)).toMatchObject({ status: 'partial', resources_failed: 1 });
      expect(await stateOf(client, orgId, resource)).toEqual({ [BACKUPS]: ['failed', true] });
    } finally {
      await other.query('ROLLBACK').catch(() => {});
      other.release();
    }
  }, 30000);

  it('a resource deleted during the scan: nothing is written and nothing fails', async () => {
    await pool.query(`DELETE FROM aws_resources WHERE id = $1`, [resource]);
    const run = await start(client, orgId);
    expect(await persistResourceEvaluation(client, input(orgId, resource, run, [outcome(BACKUPS, 'failed')]))).toEqual({ outcome: 'resource_missing' });
    // Its evaluations went with it.
    expect((await pool.query(`SELECT count(*)::int AS n FROM compliance_check_evaluations WHERE resource_id = $1`, [resource])).rows[0].n).toBe(0);
    expect((await client.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
  });

  it('a resource of another organization is never written, even by id', async () => {
    const otherOrg = await insertOrg();
    const foreign = await insertResource(otherOrg, 'vol-foreign', [BASELINE]);
    const run = await start(client, orgId);
    expect(await persistResourceEvaluation(client, input(orgId, foreign, run, [outcome(BACKUPS, 'failed')]))).toEqual({ outcome: 'resource_missing' });
    expect(await issuesOf(foreign)).toEqual([BASELINE]);
    await writeBaselinePreservingFrameworkFindings(client, { organizationId: orgId, resourceId: foreign, baselineIssues: [] });
    expect(await issuesOf(foreign)).toEqual([BASELINE]);
  });
});

describe('real tables: run history pruning', () => {
  it('prunes finished runs past the retention window, keeps the latest finished run and any running run, and never touches check rows or another organization', async () => {
    const orgId = await insertOrg();
    const otherOrg = await insertOrg();
    const client = await connectFor(orgId);
    const otherClient = await connectFor(otherOrg);
    try {
      const resource = await insertResource(orgId, 'vol-1');
      const age = (runId: string, days: number) =>
        pool.query(`UPDATE framework_evaluation_runs SET started_at = clock_timestamp() - make_interval(days => $2) WHERE id = $1`, [runId, days]);

      const oldest = await start(client, orgId);
      await finish(client, orgId, oldest, 0, 0);
      const oldFailed = await start(client, orgId);
      await failFrameworkRun(client, orgId, oldFailed.id, 'unexpected');
      // The latest finished run is itself past the window: it must survive, or nothing would say what was last applied.
      const latestFinished = await start(client, orgId);
      await persistResourceEvaluation(client, input(orgId, resource, latestFinished, [outcome(BACKUPS, 'failed')]));
      await finish(client, orgId, latestFinished, 1, 0);
      const oldRunning = await start(client, orgId);
      for (const run of [oldest, oldFailed, latestFinished, oldRunning]) await age(run.id, RUN_RETENTION_DAYS + 5);
      await pool.query(`UPDATE framework_evaluation_runs SET heartbeat_at = clock_timestamp() WHERE id = $1`, [oldRunning.id]);

      const foreignOld = await start(otherClient, otherOrg);
      await finish(otherClient, otherOrg, foreignOld, 0, 0);
      const foreignLatest = await start(otherClient, otherOrg);
      await finish(otherClient, otherOrg, foreignLatest, 0, 0);
      await age(foreignOld.id, RUN_RETENTION_DAYS + 5);

      const next = await start(client, orgId);

      const remaining = (await pool.query(`SELECT id FROM framework_evaluation_runs WHERE organization_id = $1`, [orgId])).rows.map((r) => r.id).sort();
      expect(remaining).toEqual([latestFinished.id, oldRunning.id, next.id].sort());
      // The other organization's old run is not this organization's to prune.
      expect((await pool.query(`SELECT count(*)::int AS n FROM framework_evaluation_runs WHERE organization_id = $1`, [otherOrg])).rows[0].n).toBe(2);
      // Current state is untouched, and still current.
      expect(await stateOf(client, orgId, resource)).toEqual({ [BACKUPS]: ['failed', false] });
    } finally {
      client.release();
      otherClient.release();
    }
  });

  it('a discovery job of another organization is not recorded on the run', async () => {
    const orgId = await insertOrg();
    const otherOrg = await insertOrg();
    const job = async (org: string) => (await pool.query(`INSERT INTO resource_discovery_jobs (organization_id, status) VALUES ($1, 'running') RETURNING id`, [org])).rows[0].id;
    const own = await job(orgId);
    const foreign = await job(otherOrg);
    const client = await connectFor(orgId);
    try {
      const withOwn = await start(client, orgId, 'enabled', own);
      const withForeign = await start(client, orgId, 'enabled', foreign);
      const jobs = (await pool.query(`SELECT id, discovery_job_id FROM framework_evaluation_runs WHERE id = ANY($1)`, [[withOwn.id, withForeign.id]])).rows;
      expect(jobs.find((r) => r.id === withOwn.id).discovery_job_id).toBe(own);
      expect(jobs.find((r) => r.id === withForeign.id).discovery_job_id).toBeNull();
    } finally {
      client.release();
      await pool.query(`DELETE FROM resource_discovery_jobs WHERE id = ANY($1)`, [[own, foreign]]);
    }
  });
});

// ─── as the application role ────────────────────────────────────────────────

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../../../database/migrations-admin/202610112300_create_framework_evaluation_persistence.sql'),
  'utf8'
);

/** Maps the repository's own transaction onto a savepoint, so the enclosing test transaction survives it. */
function savepointing(client: Client): Pick<PoolClient, 'query'> {
  return {
    query: ((text: any, params?: any) => {
      if (text === 'BEGIN') return client.query('SAVEPOINT repository_tx');
      if (text === 'COMMIT') return client.query('RELEASE SAVEPOINT repository_tx');
      if (text === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT repository_tx');
      return client.query(text, params);
    }) as any,
  };
}

async function asApplicationRole(fn: (executor: Pick<PoolClient, 'query'>, admin: { setOrganization(id: string | null): Promise<void>; seed: { orgA: string; orgB: string; resourceA: string; resourceB: string } }) => Promise<void>): Promise<void> {
  await ensureSharedFixtureTable(pool, 'aws_accounts'); // the shape copied below
  const client = new Client(dbConfig);
  await client.connect();
  const schema = `fw_eval_repo_test_${process.pid}_${Date.now()}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await client.query(`CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL)`);
    await client.query(`
      CREATE TABLE aws_resources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        resource_arn TEXT NOT NULL, resource_type TEXT NOT NULL, compliance_issues JSONB DEFAULT '[]')`);
    await client.query(`ALTER TABLE aws_resources ENABLE ROW LEVEL SECURITY`);
    await client.query(`CREATE POLICY aws_resources_isolation_policy ON aws_resources FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true))`);
    await client.query(`CREATE TABLE resource_discovery_jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE)`);
    await client.query(MIGRATION_SQL);

    const org = async (name: string) => (await client.query(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [name])).rows[0].id as string;
    const res = async (o: string) => (await client.query(`INSERT INTO aws_resources (organization_id, resource_arn, resource_type) VALUES ($1, 'arn', 'ebs') RETURNING id`, [o])).rows[0].id as string;
    const orgA = await org('A');
    const orgB = await org('B');
    const seed = { orgA, orgB, resourceA: await res(orgA), resourceB: await res(orgB) };

    // Every write is fenced with a real scan lease (multi-region plan M4b): this
    // schema's own lease and account tables (the real ones' shape), one placeholder
    // account and one lease per organization, all rolled back with the test.
    await client.query(`CREATE TABLE aws_scan_leases (LIKE public.aws_scan_leases INCLUDING ALL)`);
    await client.query(`CREATE TABLE aws_accounts (LIKE public.aws_accounts INCLUDING ALL)`);
    for (const id of [orgA, orgB]) {
      await client.query(
        `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status)
         VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', 'active')`,
        [id, PLACEHOLDER_ACCOUNT_ROW.role_arn, `ph-${id.replace(/-/g, '').slice(0, 29)}`]
      );
      const lease = await acquireScanLease(
        client,
        { organizationId: id, awsAccountId: PLACEHOLDER_ACCOUNT_ROW.account_id!, scanKind: SCAN_KIND_DISCOVERY },
        'test-lease-holder',
        { ttlSeconds: 60 * 60 }
      );
      leases.remember(id, lease!);
    }
    await client.query(`GRANT SELECT ON aws_accounts TO devcontrol`);
    await client.query(`GRANT SELECT, UPDATE ON aws_scan_leases TO devcontrol`);

    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO devcontrol`);
    await client.query(`GRANT SELECT, UPDATE ON aws_resources TO devcontrol`);
    await client.query(`GRANT SELECT ON resource_discovery_jobs TO devcontrol`);
    await client.query('SET LOCAL ROLE devcontrol');
    const who = await client.query('SELECT current_user AS who, rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user');
    expect(who.rows[0]).toEqual({ who: 'devcontrol', bypasses: false });

    await fn(savepointing(client), {
      seed,
      setOrganization: async (id) => { await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [id ?? '']); },
    });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

describe('as the application role (devcontrol, forced row-level security)', () => {
  it('runs the whole lifecycle with the application\'s privileges: start, store, finish, read', async () => {
    await asApplicationRole(async (executor, { seed, setOrganization }) => {
      await setOrganization(seed.orgA);
      expect(await frameworkEvaluationStorageAvailable(executor)).toBe(true);

      const run = await start(executor, seed.orgA);
      expect(await persistResourceEvaluation(executor, input(seed.orgA, seed.resourceA, run, [outcome(BACKUPS, 'failed'), outcome(RETENTION, 'unable_to_evaluate')])))
        .toMatchObject({ outcome: 'persisted', frameworkIssues: [expect.objectContaining({ findingKey: BACKUPS })] });
      await recordReconciliationRequired(executor, { organizationId: seed.orgA, resourceId: seed.resourceA, failureCode: 'persist_error', generation: run.generation });
      expect(await finish(executor, seed.orgA, run, 1, 0)).toBe(true);

      const read = await readFrameworkEvaluations(executor, seed.orgA);
      expect(read.latestRuns).toEqual([expect.objectContaining({ framework: 'HIPAA', status: 'complete' })]);
      expect(read.checks.map((c) => [c.check, c.evaluation_state, c.severity, c.stale])).toEqual([
        [BACKUPS, 'failed', 'critical', false], [RETENTION, 'unable_to_evaluate', null, false],
      ]);
      expect(read.reconciliations).toEqual([expect.objectContaining({ resource_id: seed.resourceA, failure_count: 1 })]);
      // No generation, of this organization or any other, is in what a reader receives.
      expect(JSON.stringify(read)).not.toMatch(/generation/);
    });
  });

  it('exposes nothing of another organization: reads, latest run, counts, pruning, and writes', async () => {
    await asApplicationRole(async (executor, { seed, setOrganization }) => {
      // B has a finished run, a stored failure and a marker.
      await setOrganization(seed.orgB);
      const runB = await start(executor, seed.orgB);
      await persistResourceEvaluation(executor, input(seed.orgB, seed.resourceB, runB, [outcome(BACKUPS, 'failed')]));
      await recordReconciliationRequired(executor, { organizationId: seed.orgB, resourceId: seed.resourceB, failureCode: 'persist_error', generation: runB.generation });
      await finish(executor, seed.orgB, runB, 1, 0);

      await setOrganization(seed.orgA);
      const empty = { latestRuns: [], activity: [], checks: [], reconciliations: [] };
      // Asking for A (which has nothing) and asking for B from A's context both return nothing.
      expect(await readFrameworkEvaluations(executor, seed.orgA)).toEqual(empty);
      expect(await readFrameworkEvaluations(executor, seed.orgB)).toEqual(empty);

      // A's first run: B's finished run is not its "latest", so A's rows are judged only against A's runs.
      const runA = await start(executor, seed.orgA);
      await persistResourceEvaluation(executor, input(seed.orgA, seed.resourceA, runA, [outcome(BACKUPS, 'passed')]));
      expect((await readFrameworkEvaluations(executor, seed.orgA)).checks.map((c) => c.stale)).toEqual([true]);
      await finish(executor, seed.orgA, runA, 1, 0);
      expect((await readFrameworkEvaluations(executor, seed.orgA)).checks.map((c) => [c.evaluation_state, c.stale])).toEqual([['passed', false]]);

      // Starting a run FOR B from A's context is rejected by the policy; storing to B's resource finds no resource.
      await executor.query('SAVEPOINT cross_org');
      await expect(start(executor, seed.orgB)).rejects.toMatchObject({ code: '42501' });
      await executor.query('ROLLBACK TO SAVEPOINT cross_org');
      expect(await persistResourceEvaluation(executor, input(seed.orgB, seed.resourceB, runA, [outcome(BACKUPS, 'passed')]))).toEqual({ outcome: 'resource_missing' });
      // Closing or finishing B's run from A's context changes nothing.
      expect(await finish(executor, seed.orgB, runB, 9, 0)).toBe(false);
      await failFrameworkRun(executor, seed.orgB, runB.id, 'unexpected');

      // B still sees exactly its own, unchanged.
      await setOrganization(seed.orgB);
      const readB = await readFrameworkEvaluations(executor, seed.orgB);
      expect(readB.latestRuns).toEqual([expect.objectContaining({ status: 'complete' })]);
      expect(readB.checks.map((c) => [c.evaluation_state, c.stale])).toEqual([['failed', false]]);
      expect(readB.reconciliations).toHaveLength(1);
    });
  });

  it('reports storage as unavailable where the tables do not exist, without failing the transaction', async () => {
    const client = new Client(dbConfig);
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE SCHEMA fw_eval_no_storage_${process.pid}`);
      await client.query(`SET LOCAL search_path TO fw_eval_no_storage_${process.pid}`);
      expect(await frameworkEvaluationStorageAvailable(client)).toBe(false);
      // The transaction is still usable.
      expect((await client.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  });
});
