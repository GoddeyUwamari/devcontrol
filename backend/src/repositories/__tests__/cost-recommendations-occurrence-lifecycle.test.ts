/**
 * Live-DB coverage for the Resolve/Dismiss occurrence-lifecycle fix:
 * CostRecommendationsRepository.reconcileActiveRecommendations() -- the
 * mechanism that stops an unchanged Resolve/Dismiss'd finding from being
 * silently re-inserted as a new ACTIVE row on the next scan, while still
 * allowing a genuinely-recurring identical finding (condition disappeared
 * for a complete, successful observation, then came back) to become a new
 * occurrence.
 *
 * Runs against the actual local dev Postgres instance (not mocked pg
 * clients) -- the property under test is real transaction/lock/constraint
 * behavior (the partial unique index, ON CONFLICT DO NOTHING, the
 * per-organization advisory lock), which a JS-side mock cannot exercise.
 *
 * Reserved Instance Opportunities are explicitly excluded from this
 * lifecycle (synthetic, fleet-level aggregate identity -- see
 * cost-optimization.service.ts and the NON_RI_ISSUES comment in
 * cost-recommendations.repository.ts) and are covered separately in the
 * "RI opportunities are unaffected" section below, via
 * deleteActiveByIssue()+createBulk() instead.
 */
import { Pool, Client } from 'pg';
import { CostRecommendationsRepository } from '../cost-recommendations.repository';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import type { CreateRecommendationRequest } from '../../types';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const repository = new CostRecommendationsRepository();
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Occurrence Lifecycle Org ${suffix}`, `occurrence-lifecycle-org-${suffix}`, `Occurrence Lifecycle Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchRows(orgId: string, resourceId: string, issue: string) {
  await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
  const { rows } = await pool.query(
    `SELECT * FROM cost_recommendations WHERE organization_id = $1 AND resource_id = $2 AND issue = $3 ORDER BY created_at ASC`,
    [orgId, resourceId, issue]
  );
  return rows;
}

async function fetchActiveCount(orgId: string) {
  await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS count FROM cost_recommendations WHERE organization_id = $1 AND status = 'ACTIVE'`,
    [orgId]
  );
  return parseInt(rows[0].count, 10);
}

function fakeFinding(overrides: Partial<CreateRecommendationRequest> = {}): CreateRecommendationRequest {
  return {
    resource_id: 'i-abc',
    resource_name: 'test-instance',
    resource_type: 'EC2',
    issue: 'Idle Instance',
    description: 'This EC2 instance has averaged 2.4% CPU utilization over the past 7 days.',
    potential_savings: 8.5,
    severity: 'LOW',
    aws_region: 'us-east-1',
    metadata: {},
    ...overrides,
  };
}

function observation(overrides: Partial<DetectorObservation> = {}): DetectorObservation {
  return {
    issue: 'Idle Instance',
    success: true,
    recommendations: [],
    ...overrides,
  };
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('reconcileActiveRecommendations -- basic insert/suppress behavior', () => {
  it('inserts a fresh ACTIVE row when no prior occurrence exists', async () => {
    const orgId = await insertOrg();

    const { insertedCount } = await repository.reconcileActiveRecommendations(orgId, [
      observation({ recommendations: [fakeFinding()] }),
    ]);

    expect(insertedCount).toBe(1);
    const rows = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ACTIVE');
    expect(rows[0].occurrence_ended_at).toBeNull();
  });

  it('different resources with the same issue stay independent', async () => {
    const orgId = await insertOrg();

    await repository.reconcileActiveRecommendations(orgId, [
      observation({ recommendations: [fakeFinding({ resource_id: 'i-one' }), fakeFinding({ resource_id: 'i-two' })] }),
    ]);

    expect((await fetchRows(orgId, 'i-one', 'Idle Instance'))[0].status).toBe('ACTIVE');
    expect((await fetchRows(orgId, 'i-two', 'Idle Instance'))[0].status).toBe('ACTIVE');
  });

  it('the same resource with different issues stays independent', async () => {
    const orgId = await insertOrg();

    await repository.reconcileActiveRecommendations(orgId, [
      observation({ issue: 'Idle Instance', recommendations: [fakeFinding({ issue: 'Idle Instance' })] }),
      observation({ issue: 'Oversized Instance', recommendations: [fakeFinding({ issue: 'Oversized Instance', resource_type: 'RDS' })] }),
    ]);

    expect((await fetchRows(orgId, 'i-abc', 'Idle Instance'))[0].status).toBe('ACTIVE');
    expect((await fetchRows(orgId, 'i-abc', 'Oversized Instance'))[0].status).toBe('ACTIVE');
  });
});

describe('Resolve -> rescan lifecycle (test items 7-9)', () => {
  it('Resolve -> unchanged complete scan -> stays suppressed, no duplicate ACTIVE row', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [active] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(active.id, 'RESOLVED', orgId);

    const { insertedCount } = await repository.reconcileActiveRecommendations(orgId, [
      observation({ recommendations: [fakeFinding()] }),
    ]);

    expect(insertedCount).toBe(0);
    const rows = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('RESOLVED');
    expect(rows[0].occurrence_ended_at).toBeNull();
  });

  it('Resolve -> condition disappears via a complete successful scan -> occurrence_ended_at is set, no ACTIVE row', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [active] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(active.id, 'RESOLVED', orgId);

    // Successful category, this resource no longer appears.
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [] })]);

    const rows = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('RESOLVED');
    expect(rows[0].occurrence_ended_at).not.toBeNull();
    expect(await fetchActiveCount(orgId)).toBe(0);
  });

  it('after occurrence ended, identical recurrence creates a NEW ACTIVE row and preserves the old RESOLVED row', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [firstActive] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(firstActive.id, 'RESOLVED', orgId);
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [] })]); // ends occurrence

    // Identical finding recurs, same metadata.
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);

    const rows = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(rows).toHaveLength(2);
    const resolved = rows.find((r) => r.status === 'RESOLVED');
    const active = rows.find((r) => r.status === 'ACTIVE');
    expect(resolved.id).toBe(firstActive.id);
    expect(resolved.occurrence_ended_at).not.toBeNull();
    expect(active).toBeDefined();
    expect(active.occurrence_ended_at).toBeNull();
  });
});

describe('Dismiss lifecycle (test items 10-11)', () => {
  it('Dismiss -> unchanged complete scan -> stays suppressed', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [active] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(active.id, 'DISMISSED', orgId);

    const { insertedCount } = await repository.reconcileActiveRecommendations(orgId, [
      observation({ recommendations: [fakeFinding()] }),
    ]);

    expect(insertedCount).toBe(0);
    const rows = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('DISMISSED');
  });

  it('Dismiss -> complete absence -> identical recurrence -> new occurrence can become ACTIVE', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [active] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(active.id, 'DISMISSED', orgId);
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [] })]); // ends occurrence

    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);

    const rows = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    const newActive = rows.find((r) => r.status === 'ACTIVE');
    expect(newActive).toBeDefined();
    expect(newActive.occurrence_ended_at).toBeNull();
  });
});

describe('Detector failure/partial-observation must NOT be interpreted as disappearance (test items 1-6)', () => {
  it('successful detector + empty result: eligible existing occurrence gets occurrence_ended_at', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [active] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(active.id, 'RESOLVED', orgId);

    await repository.reconcileActiveRecommendations(orgId, [observation({ success: true, recommendations: [] })]);

    const [row] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(row.occurrence_ended_at).not.toBeNull();
  });

  it('failed detector + empty result: existing occurrence is NOT ended', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [active] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(active.id, 'RESOLVED', orgId);

    const { insertedCount } = await repository.reconcileActiveRecommendations(orgId, [
      observation({ success: false, recommendations: [] }),
    ]);

    expect(insertedCount).toBe(0);
    const [row] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(row.status).toBe('RESOLVED');
    expect(row.occurrence_ended_at).toBeNull();
  });

  it('timeout/failure-equivalent (success:false with a prior ACTIVE, never-resolved row): the ACTIVE row is left untouched, not deleted', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);

    await repository.reconcileActiveRecommendations(orgId, [observation({ success: false, recommendations: [] })]);

    const [row] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(row.status).toBe('ACTIVE');
  });

  it('skipped detector (category entirely absent from the observations array): existing occurrence is NOT ended', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [active] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(active.id, 'RESOLVED', orgId);

    // Idle-EC2 category simply never appears in this scan's observations.
    await repository.reconcileActiveRecommendations(orgId, [
      observation({ issue: 'Oversized Instance', recommendations: [] }),
    ]);

    const [row] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(row.occurrence_ended_at).toBeNull();
  });

  it('partial scope: mixed success/failure in one scan only affects the successful category\'s rows', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [
      observation({ issue: 'Idle Instance', recommendations: [fakeFinding({ issue: 'Idle Instance' })] }),
      observation({ issue: 'Oversized Instance', recommendations: [fakeFinding({ issue: 'Oversized Instance', resource_type: 'RDS' })] }),
    ]);
    const [idleRow] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    const [rdsRow] = await fetchRows(orgId, 'i-abc', 'Oversized Instance');
    await repository.updateStatus(idleRow.id, 'RESOLVED', orgId);
    await repository.updateStatus(rdsRow.id, 'RESOLVED', orgId);

    // Idle-EC2 succeeds and finds nothing (condition cleared); RDS detector fails this scan.
    await repository.reconcileActiveRecommendations(orgId, [
      observation({ issue: 'Idle Instance', success: true, recommendations: [] }),
      observation({ issue: 'Oversized Instance', success: false, recommendations: [] }),
    ]);

    expect((await fetchRows(orgId, 'i-abc', 'Idle Instance'))[0].occurrence_ended_at).not.toBeNull();
    expect((await fetchRows(orgId, 'i-abc', 'Oversized Instance'))[0].occurrence_ended_at).toBeNull();
  });

  it('AWS-not-connected (empty observations array): no DB row is touched, no occurrence ended', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);
    const [active] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    await repository.updateStatus(active.id, 'RESOLVED', orgId);

    const { insertedCount } = await repository.reconcileActiveRecommendations(orgId, []);

    expect(insertedCount).toBe(0);
    const [row] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(row.status).toBe('RESOLVED');
    expect(row.occurrence_ended_at).toBeNull();
  });
});

describe('Existing rows after migration (test item 12)', () => {
  it('a pre-existing RESOLVED row with occurrence_ended_at=NULL (the migration default) stays suppressed until a complete observation establishes absence', async () => {
    const orgId = await insertOrg();
    // Simulates a row that existed before this migration -- inserted
    // directly as RESOLVED with no prior ACTIVE-then-resolve cycle through
    // the repository, occurrence_ended_at left at its column default (NULL).
    await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
    await pool.query(
      `INSERT INTO cost_recommendations
         (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, status, aws_region, metadata)
       VALUES ($1, 'i-legacy', 'legacy', 'EC2', 'Idle Instance', 'x', 8.5, 'LOW', 'RESOLVED', 'us-east-1', '{}')`,
      [orgId]
    );

    const { insertedCount } = await repository.reconcileActiveRecommendations(orgId, [
      observation({ recommendations: [fakeFinding({ resource_id: 'i-legacy' })] }),
    ]);

    expect(insertedCount).toBe(0);
    const rows = await fetchRows(orgId, 'i-legacy', 'Idle Instance');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('RESOLVED');
  });
});

describe('Concurrency (test items 13-14)', () => {
  // A same-tuple race (both concurrent calls reporting the identical finding)
  // is NOT a valid test of the advisory lock: PostgreSQL's own unique-index
  // row locking plus ON CONFLICT DO NOTHING already guarantees exactly one
  // surviving row for that case regardless of whether any lock exists at
  // all -- such a test would pass identically with the lock code deleted.
  // The two tests below instead target the actual failure mode the lock
  // exists to prevent (see design-review Part A): two concurrent scans for
  // the SAME org+category reporting DIFFERENT findings, where an unlocked
  // interleaving could let both scans' inserts survive simultaneously --a
  // merged/inconsistent state that doesn't correspond to either individual
  // scan's complete view. Different resource_ids never hit the unique
  // index, so ON CONFLICT DO NOTHING cannot rescue this scenario -- only
  // genuine serialization (the lock) can.

  // Must match cost-recommendations.repository.ts's RECONCILIATION_LOCK_SALT
  // exactly -- deliberately not imported (that constant is private/internal
  // to the repository module) so this test exercises the real, literal SQL
  // a raw client would issue, the same way the earlier design-review phase
  // independently verified the production lock key by reading the source.
  const RECONCILIATION_LOCK_SALT = 1;

  function delay(ms: number): Promise<'timed-out'> {
    return new Promise((resolve) => setTimeout(() => resolve('timed-out'), ms));
  }

  it('the exact lock key construction production uses genuinely blocks a second session (deterministic, not timing-dependent)', async () => {
    const orgId = await insertOrg();
    const holder = new Client(dbConfig());
    const waiter = new Client(dbConfig());
    await holder.connect();
    await waiter.connect();

    try {
      const holderLock = await holder.query(
        `SELECT pg_advisory_lock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`,
        [orgId]
      );
      expect(holderLock.rows).toBeDefined(); // acquired synchronously -- nothing else held it yet

      // Fire the second session's lock request but do not await it yet.
      const waiterLockPromise = waiter.query(
        `SELECT pg_advisory_lock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`,
        [orgId]
      );

      // Deterministic proof of blocking: race the waiter's own query against
      // a real timer. If the lock were not actually exclusive, the waiter's
      // query would resolve well within 300ms; genuine blocking means the
      // timer wins every time, not just usually.
      const outcome = await Promise.race([waiterLockPromise.then(() => 'acquired' as const), delay(300)]);
      expect(outcome).toBe('timed-out');

      await holder.query('SELECT pg_advisory_unlock(hashtextextended($1, $2))', [orgId, RECONCILIATION_LOCK_SALT]);

      // Now that the holder released, the previously-blocked request must
      // resolve promptly.
      await waiterLockPromise;
      await waiter.query('SELECT pg_advisory_unlock(hashtextextended($1, $2))', [orgId, RECONCILIATION_LOCK_SALT]);
    } finally {
      await holder.end();
      await waiter.end();
    }
  });

  it('two concurrent reconciliation scans for the same org+category with DIFFERENT findings never both survive as ACTIVE -- proves the lock serializes reconcileActiveRecommendations() itself, not just the raw primitive', async () => {
    const orgId = await insertOrg();

    // External barrier: hold the exact production lock key before starting
    // either scan, forcing both of reconcileActiveRecommendations()'s own
    // pg_advisory_lock() calls to genuinely queue/block at the same moment
    // -- real Postgres-level synchronization, not a hope that Promise.all's
    // scheduling happens to overlap. This directly satisfies "use
    // controlled barriers... to force the relevant ordering" rather than
    // relying on incidental timing.
    const barrier = new Client(dbConfig());
    await barrier.connect();
    await barrier.query(`SELECT pg_advisory_lock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`, [orgId]);

    try {
      const scanA = repository.reconcileActiveRecommendations(orgId, [
        observation({ recommendations: [fakeFinding({ resource_id: 'i-scan-a' })] }),
      ]);
      const scanB = repository.reconcileActiveRecommendations(orgId, [
        observation({ recommendations: [fakeFinding({ resource_id: 'i-scan-b' })] }),
      ]);

      // Give both calls time to actually reach and issue their own
      // pg_advisory_lock() request against the barrier-held key (a handful
      // of connect+query round-trips on local Postgres; 300ms is generous
      // headroom, not a timing dependency the assertion relies on -- the
      // barrier itself is what guarantees no work happens until release).
      await delay(300);

      await barrier.query('SELECT pg_advisory_unlock(hashtextextended($1, $2))', [orgId, RECONCILIATION_LOCK_SALT]);
      await Promise.all([scanA, scanB]);
    } finally {
      await barrier.end();
    }

    // set_config must run on the same query round-trip's connection as the
    // SELECT that follows -- pool.query() calls aren't guaranteed to reuse
    // the same underlying client, matching this file's existing
    // fetchRows()/fetchActiveCount() convention above.
    await pool.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
    const rows = await pool.query(
      `SELECT resource_id, status FROM cost_recommendations
       WHERE organization_id = $1 AND issue = 'Idle Instance' AND status = 'ACTIVE'`,
      [orgId]
    );

    // The actual guarantee under test: never a merged state containing both
    // scans' findings simultaneously -- exactly one scan's complete view
    // (whichever committed last, per serialization order) determines the
    // category's final state. Without the lock, an interleaving where
    // neither scan's DELETE observes the other's not-yet-committed INSERT
    // can let both i-scan-a and i-scan-b survive as ACTIVE at once, since
    // they don't share a resource_id and never hit the unique index.
    expect(rows.rows).toHaveLength(1);
    expect(['i-scan-a', 'i-scan-b']).toContain(rows.rows[0].resource_id);
  });

  it('a duplicate finding within the same scan batch does not abort the reconciliation transaction', async () => {
    const orgId = await insertOrg();

    // Same (resource_id, issue) appearing twice in one detector's output --
    // the second INSERT within this same transaction hits
    // idx_cost_recommendations_active_identity; ON CONFLICT DO NOTHING must
    // silently skip it rather than aborting the whole call.
    const { insertedCount } = await repository.reconcileActiveRecommendations(orgId, [
      observation({ recommendations: [fakeFinding(), fakeFinding()] }),
    ]);

    expect(insertedCount).toBe(1);
    const rows = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(rows.filter((r) => r.status === 'ACTIVE')).toHaveLength(1);
  });
});

describe('RI opportunities are unaffected by the occurrence lifecycle (test item 15)', () => {
  it('deleteActiveByIssue + createBulk (the RI path) unconditionally replaces RI findings every call, no suppression', async () => {
    const orgId = await insertOrg();
    const riFinding = fakeFinding({
      resource_id: 'ri-opportunity-t3.large',
      resource_type: 'EC2',
      issue: 'Reserved Instance Opportunity',
    });

    await repository.deleteActiveByIssue(orgId, 'Reserved Instance Opportunity');
    await repository.createBulk([riFinding], orgId);
    const [firstRow] = await fetchRows(orgId, 'ri-opportunity-t3.large', 'Reserved Instance Opportunity');
    await repository.updateStatus(firstRow.id, 'RESOLVED', orgId);

    // Unlike the non-RI lifecycle, RI's path has no suppression check --
    // the identical finding is unconditionally recreated as ACTIVE every
    // call, exactly matching pre-existing behavior.
    await repository.deleteActiveByIssue(orgId, 'Reserved Instance Opportunity');
    await repository.createBulk([riFinding], orgId);

    const rows = await fetchRows(orgId, 'ri-opportunity-t3.large', 'Reserved Instance Opportunity');
    const active = rows.filter((r) => r.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(rows.find((r) => r.status === 'RESOLVED')).toBeDefined();
  });

  it('deleteActiveByIssue scoped to RI does not touch a non-RI ACTIVE row for the same organization', async () => {
    const orgId = await insertOrg();
    await repository.reconcileActiveRecommendations(orgId, [observation({ recommendations: [fakeFinding()] })]);

    await repository.deleteActiveByIssue(orgId, 'Reserved Instance Opportunity');

    const [row] = await fetchRows(orgId, 'i-abc', 'Idle Instance');
    expect(row.status).toBe('ACTIVE');
  });
});
