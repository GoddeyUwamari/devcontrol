/**
 * Home region HR-1 over the real routes (real authenticate middleware, the
 * caller's CURRENT membership, real RLS wiring, live Postgres; only
 * authService.verifyToken and the background scan are stubbed):
 *
 *   PUT  /api/aws/accounts/home-region           the change (T2): one transaction
 *        that moves aws_accounts.region, removes ONLY the old home region's ACTIVE
 *        cost findings of the 8 home-scoped issues (decisions, NULL-region rows,
 *        other issues and the new region's rows stay), settles an open proposal
 *        and writes the audit event with { from, to }, the counts per issue and
 *        every removed finding; a scan of the new region starts after commit.
 *   Refusals (T4), each with NOTHING changed (region, cost rows, audit rows,
 *        proposal): non-owners, an invalid / unchanged / not-enabled / excluded
 *        region, no stored region list, a held scan lease or discovery job lease,
 *        no connection.
 *   GET  /api/aws/accounts/home-region           the dialog's preview (counts).
 *   Tenant isolation (T8): one organization's change and preview never read or
 *        touch another's rows, even with identical region, issue and resource ids.
 *   (Dismiss, the GET view and the proposal row under RLS:
 *   aws-home-region-proposal-routes.test.ts.)
 *
 * Placeholders only.
 */
import awsRoutes, { HOME_REGION_FORBIDDEN_MESSAGE, HOME_REGION_OWNER_ONLY_CODE, HOME_REGION_SCAN_ADMISSION_WAIT_MS, homeRegionTestHooks, resetHomeRegionTestHooks } from '../aws.routes';
import nlQueryRoutes from '../nl-query.routes';
import { NLQueryService } from '../../services/nl-query.service';
import { ScanAlreadyRunningError } from '../../services/scan-session';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import { HOME_REGION_SCOPED_ISSUE_LIST } from '../../repositories/cost-recommendations.repository';
import {
  ISSUE_EBS_UNATTACHED_VOLUME,
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_LAMBDA_LOW_USAGE,
  ISSUE_S3_LIFECYCLE_OPTIMIZATION,
} from '../../config/optimization-rules';
import { SCAN_KIND_DISCOVERY, DISCOVERY_JOB_NAME } from '../../services/scan-session';
import { createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import { HOME_REGION_FIXTURE_TABLES, PROPOSAL, homeRegionRouteFixtures } from './home-region-route-fixtures';

const harness = createRoleGateHarness('home-region-change');
const { pool } = harness;
const { connectedOrg, insertRec, setProposal, stateOf, put, preview, accounts } = homeRegionRouteFixtures(harness);

let discover: jest.SpyInstance;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => {
    app.use('/api/aws', awsRoutes);
    app.use('/api/nl-query', nlQueryRoutes);
  });
});

beforeEach(() => {
  discover = jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
    job_id: 'stub-job', resources_discovered: 0, resources_updated: 0, resources_deleted: 0, errors: [], warnings: [],
  } as any);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    for (const table of HOME_REGION_FIXTURE_TABLES) {
      await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    }
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe('PUT /api/aws/accounts/home-region: the change (T2)', () => {
  it('us-east-1 → us-west-2: region moved, only the old home region ACTIVE home-scoped findings removed, proposal accepted, audited, scan started', async () => {
    const org = await connectedOrg();
    // Removed: the old home region's ACTIVE rows of home-scoped issues.
    await insertRec(org.orgId, { resource: 'i-hr-a1', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1' });
    await insertRec(org.orgId, { resource: 'vol-hr-a2', issue: ISSUE_EBS_UNATTACHED_VOLUME, region: 'us-east-1' });
    await insertRec(org.orgId, { resource: 'placeholder-fn', issue: ISSUE_LAMBDA_LOW_USAGE, region: 'us-east-1' });
    // Kept: a decision, a NULL-region row, a non-home-scoped issue, the new region's row.
    await insertRec(org.orgId, { resource: 'i-hr-a3', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1', status: 'DISMISSED' });
    await insertRec(org.orgId, { resource: 'i-hr-a4', issue: ISSUE_EC2_IDLE_INSTANCE, region: null });
    await insertRec(org.orgId, { resource: 'placeholder-bucket', issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION, region: 'us-east-1' });
    await insertRec(org.orgId, { resource: 'i-hr-a5', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-west-2' });
    await setProposal(org, 'proposed', PROPOSAL('us-west-2'));

    const res = await put(org, { region: 'us-west-2' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true,
      data: {
        from: 'us-east-1',
        to: 'us-west-2',
        source: 'proposal',
        cost_findings_removed: { total: 3, by_issue: { [ISSUE_EBS_UNATTACHED_VOLUME]: 1, [ISSUE_EC2_IDLE_INSTANCE]: 1, [ISSUE_LAMBDA_LOW_USAGE]: 1 } },
        scan_started: true,
      },
    });
    expect(res.headers.get('cache-control')).toBe('private, no-store');

    const after = await stateOf(org);
    expect(after.region).toBe('us-west-2');
    expect(after.recs).toEqual([
      { resource_id: 'i-hr-a3', issue: ISSUE_EC2_IDLE_INSTANCE, aws_region: 'us-east-1', status: 'DISMISSED' },
      { resource_id: 'i-hr-a4', issue: ISSUE_EC2_IDLE_INSTANCE, aws_region: null, status: 'ACTIVE' },
      { resource_id: 'i-hr-a5', issue: ISSUE_EC2_IDLE_INSTANCE, aws_region: 'us-west-2', status: 'ACTIVE' },
      { resource_id: 'placeholder-bucket', issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION, aws_region: 'us-east-1', status: 'ACTIVE' },
    ]);
    expect(after.proposal).toEqual({ state: 'accepted', decided: true });

    const audit = (await pool.query(
      `SELECT user_id, action, resource_type, resource_id, changes, metadata FROM audit_logs WHERE organization_id = $1`, [org.orgId])).rows;
    expect(audit).toEqual([{
      user_id: org.owner,
      action: 'aws_account.home_region_changed',
      resource_type: 'aws_account',
      resource_id: org.rowId,
      changes: { from: 'us-east-1', to: 'us-west-2' },
      metadata: {
        source: 'proposal',
        reason: 'home_region_changed',
        multi_region: false,
        cost_findings_removed: { total: 3, by_issue: { [ISSUE_EBS_UNATTACHED_VOLUME]: 1, [ISSUE_EC2_IDLE_INSTANCE]: 1, [ISSUE_LAMBDA_LOW_USAGE]: 1 } },
        // Sorted by issue, then resource id.
        removed_findings: [
          { issue: ISSUE_EC2_IDLE_INSTANCE, resource_id: 'i-hr-a1', region: 'us-east-1' },
          { issue: ISSUE_LAMBDA_LOW_USAGE, resource_id: 'placeholder-fn', region: 'us-east-1' },
          { issue: ISSUE_EBS_UNATTACHED_VOLUME, resource_id: 'vol-hr-a2', region: 'us-east-1' },
        ],
        removed_findings_truncated: false,
      },
    }]);
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith(org.orgId, { onLeaseOutcome: expect.any(Function) });
  });

  it('every home-scoped issue is removed in the old region, and only those', async () => {
    const org = await connectedOrg();
    for (const issue of HOME_REGION_SCOPED_ISSUE_LIST) await insertRec(org.orgId, { resource: 'placeholder-same-id', issue, region: 'us-east-1' });
    const res = await put(org, { region: 'us-west-2' });
    expect(res.status).toBe(200);
    const body = await res.json();
    // C1: idle RDS and old EBS snapshots are home-scoped too (8 + 2); C2: idle NAT gateways (10 + 1);
    // C3a: unused log groups (11 + 1).
    expect(body.data.cost_findings_removed.total).toBe(12);
    expect(Object.keys(body.data.cost_findings_removed.by_issue).sort()).toEqual([...HOME_REGION_SCOPED_ISSUE_LIST]);
    expect((await stateOf(org)).recs).toEqual([]);
  });

  it('a change to another region than the open proposal is manual and supersedes it; a NULL stored region reads as us-east-1', async () => {
    const org = await connectedOrg({ region: null });
    await insertRec(org.orgId, { resource: 'i-hr-a1', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1' });
    await setProposal(org, 'proposed', PROPOSAL('eu-west-1'));
    const res = await put(org, { region: 'us-west-2' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ from: 'us-east-1', to: 'us-west-2', source: 'manual', cost_findings_removed: { total: 1 } });
    expect(await stateOf(org)).toMatchObject({ region: 'us-west-2', proposal: { state: 'superseded', decided: true } });
  });

  it('no open proposal (none, dismissed, no_signal): the change is manual and leaves the proposal state as it was', async () => {
    for (const [state, proposal, decided] of [[null, null, false], ['dismissed', PROPOSAL('us-west-2'), true], ['no_signal', null, false]] as const) {
      const org = await connectedOrg();
      if (state) await setProposal(org, state, proposal, decided);
      const res = await put(org, { region: 'us-west-2' });
      expect(res.status).toBe(200);
      expect((await res.json()).data.source).toBe('manual');
      expect((await stateOf(org)).proposal).toEqual(state ? { state, decided } : null);
    }
  });

  it('more than 500 removed findings: every one is removed and counted, the audit list is capped and says so', async () => {
    const org = await connectedOrg();
    await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, aws_region, metadata, status)
       SELECT $1, 'placeholder-' || lpad(g::text, 4, '0'), 'placeholder', 'EC2', $2, 'placeholder', 1, 'LOW', 'us-east-1', '{}', 'ACTIVE' FROM generate_series(1, 503) g`,
      [org.orgId, ISSUE_EC2_IDLE_INSTANCE]
    );
    const res = await put(org, { region: 'us-west-2' });
    expect((await res.json()).data.cost_findings_removed).toEqual({ total: 503, by_issue: { [ISSUE_EC2_IDLE_INSTANCE]: 503 } });
    const { metadata } = (await pool.query(`SELECT metadata FROM audit_logs WHERE organization_id = $1`, [org.orgId])).rows[0];
    expect(metadata.removed_findings).toHaveLength(500);
    expect(metadata.removed_findings_truncated).toBe(true);
    expect(metadata.cost_findings_removed.total).toBe(503);
  });
});

describe('scan_started says whether the follow-up scan actually started (review L-6)', () => {
  it('another scan holds the lease: the change is made, scan_started is false', async () => {
    const org = await connectedOrg();
    discover.mockImplementation(async (orgId: string, options?: { onLeaseOutcome?: (o: 'started' | 'skipped') => void }) => {
      options?.onLeaseOutcome?.('skipped');
      throw new ScanAlreadyRunningError(orgId, org.accountId);
    });
    const res = await put(org, { region: 'us-west-2' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ to: 'us-west-2', scan_started: false });
    expect((await stateOf(org)).region).toBe('us-west-2');
  });

  it('the scan fails before its lease (e.g. AssumeRole): scan_started is false', async () => {
    const org = await connectedOrg();
    discover.mockRejectedValue(Object.assign(new Error('placeholder'), { name: 'AwsAssumeRoleFailedError' }));
    expect((await (await put(org, { region: 'us-west-2' })).json()).data.scan_started).toBe(false);
  });

  it('the scan never says whether it took the lease within the wait: PUT 200, scan_started is false, no error (re-check RR-L1)', async () => {
    const org = await connectedOrg();
    homeRegionTestHooks.scanAdmissionWaitMs = 50;
    try {
      // A scan that neither reports its lease nor ends (e.g. a slow AssumeRole).
      discover.mockImplementation(() => new Promise(() => undefined) as any);
      const started = Date.now();
      const res = await put(org, { region: 'us-west-2' });
      const elapsed = Date.now() - started;
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ success: true, data: { from: 'us-east-1', to: 'us-west-2', scan_started: false } });
      expect(elapsed).toBeLessThan(HOME_REGION_SCAN_ADMISSION_WAIT_MS);
      expect((await stateOf(org)).region).toBe('us-west-2');
      expect((console.warn as jest.Mock).mock.calls.some((args) => String(args[0]).includes('not confirmed started within 50 ms'))).toBe(true);
    } finally {
      resetHomeRegionTestHooks();
    }
  });

  it('the scan took the lease and is still running: scan_started is true, without waiting for the scan to end', async () => {
    const org = await connectedOrg();
    discover.mockImplementation((_orgId: string, options?: { onLeaseOutcome?: (o: 'started' | 'skipped') => void }) => {
      options?.onLeaseOutcome?.('started');
      return new Promise(() => undefined) as any;
    });
    const started = Date.now();
    expect((await (await put(org, { region: 'us-west-2' })).json()).data.scan_started).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe('Ask AI after a change (review L-5)', () => {
  it("the organization's cached question parses are dropped on a change (every live NL service), and never on a refusal", async () => {
    const org = await connectedOrg();
    const invalidate = jest.spyOn(NLQueryService.prototype, 'invalidateOrganization');
    expect((await put(org, { region: 'us-east-1' })).status).toBe(400);
    expect(invalidate).not.toHaveBeenCalled();
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    expect(invalidate).toHaveBeenCalledWith(org.orgId);
    expect(invalidate.mock.calls.every(([orgId]) => orgId === org.orgId)).toBe(true);
  });

  it('a question after a change never returns the removed old-home findings', async () => {
    const org = await connectedOrg();
    await insertRec(org.orgId, { resource: 'i-hr-a1', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1', savings: 99 });
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
    const res = await harness.sendAs(org.orgId, org.owner, 'POST', '/nl-query/execute', { query: 'how much can we save on idle instances?' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.data).toMatchObject({ outcome: 'not_supported', rows: [] });
    expect(JSON.stringify(body)).not.toContain('i-hr-a1');
    expect((await stateOf(org)).recs).toEqual([]);
  });
});

describe('split spend: the owner chooses through PUT (founder addition to HR-D5)', () => {
  const SPLIT = { ...PROPOSAL('us-west-2'), region: null, outcome: 'near_tie' };
  const flags = async (orgId: string) =>
    (await pool.query(`SELECT flag, enabled FROM organization_feature_flags WHERE organization_id = $1 ORDER BY flag`, [orgId])).rows;

  it('the owner confirms a region: the home region moves, the prompt is accepted, the change is audited as a split choice', async () => {
    const org = await connectedOrg();
    await setProposal(org, 'split', SPLIT);
    const res = await put(org, { region: 'us-west-2' });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ from: 'us-east-1', to: 'us-west-2', source: 'split_choice' });
    expect(await stateOf(org)).toMatchObject({ region: 'us-west-2', proposal: { state: 'accepted', decided: true } });
    const { metadata } = (await pool.query(`SELECT metadata FROM audit_logs WHERE organization_id = $1 AND action = 'aws_account.home_region_changed'`, [org.orgId])).rows[0];
    expect(metadata.source).toBe('split_choice');
  });

  it.each(['admin', 'member', 'viewer'] as const)('%s cannot confirm: 403, the prompt stays open and the home region unchanged', async (role) => {
    const org = await connectedOrg();
    await setProposal(org, 'split', SPLIT);
    const before = await stateOf(org);
    expect((await put(org, { region: 'us-west-2' }, org[role])).status).toBe(403);
    expect(await stateOf(org)).toEqual(before);
    expect(before.proposal).toEqual({ state: 'split', decided: false });
  });

  it('without confirmation nothing is selected or changed: reading the prompt, the preview and the accounts leaves region and state as they were', async () => {
    const org = await connectedOrg();
    await setProposal(org, 'split', SPLIT);
    const before = await stateOf(org);
    for (const role of ['owner', 'viewer'] as const) {
      expect((await (await accounts(org, org[role])).json()).home_region_proposal).toMatchObject({ state: 'split', region: null });
    }
    expect((await (await preview(org, 'us-west-2')).json()).data).toMatchObject({ current_home_region: 'us-east-1', target: { refusal: null } });
    expect(await stateOf(org)).toEqual(before);
    expect(discover).not.toHaveBeenCalled();
  });

  it('a choice never touches the multi-region flag (no row, or a row that says off, stays as it was)', async () => {
    const noRow = await connectedOrg();
    const off = await connectedOrg();
    await pool.query(
      `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', false, 'test', 'test')`, [off.orgId]);
    for (const org of [noRow, off]) {
      await setProposal(org, 'split', SPLIT);
      const before = await flags(org.orgId);
      expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
      expect(await flags(org.orgId)).toEqual(before);
    }
    expect(await flags(off.orgId)).toEqual([{ flag: 'multi_region_discovery', enabled: false }]);
    expect(await flags(noRow.orgId)).toEqual([]);
  });
});

describe('refusals change nothing (T4)', () => {
  async function seeded(options?: Parameters<typeof connectedOrg>[0]) {
    const org = await connectedOrg(options);
    await insertRec(org.orgId, { resource: 'i-hr-a1', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1' });
    await setProposal(org, 'proposed', PROPOSAL('us-west-2'));
    return org;
  }

  it.each(['admin', 'member', 'viewer'] as const)('%s: 403 with the owner-only message', async (role) => {
    const org = await seeded();
    const before = await stateOf(org);
    const res = await put(org, { region: 'us-west-2' }, org[role]);
    expect(res.status).toBe(403);
    // PR 3c: the message is kept and the code added (HOME_REGION_OWNER_ONLY), on the PUT and the GET preview.
    expect(await res.json()).toEqual({ success: false, code: HOME_REGION_OWNER_ONLY_CODE, message: HOME_REGION_FORBIDDEN_MESSAGE });
    expect(await stateOf(org)).toEqual(before);
    const refusedPreview = await preview(org, 'us-west-2', org[role]);
    expect(refusedPreview.status).toBe(403);
    expect(await refusedPreview.json()).toEqual({ success: false, code: HOME_REGION_OWNER_ONLY_CODE, message: HOME_REGION_FORBIDDEN_MESSAGE });
    expect(await stateOf(org)).toEqual(before);
    expect(discover).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing region', {}, 400, 'INVALID_REGION'],
    ['a non-string region', { region: 7 }, 400, 'INVALID_REGION'],
    ['not a region code', { region: 'US-WEST-2' }, 400, 'INVALID_REGION'],
    ['an injection attempt', { region: "us-west-2' OR '1'='1" }, 400, 'INVALID_REGION'],
    ['the current home region', { region: 'us-east-1' }, 400, 'HOME_REGION_UNCHANGED'],
    ['a region not enabled in the account', { region: 'ap-east-1' }, 422, 'REGION_NOT_ENABLED'],
    ['a region absent from the list', { region: 'sa-east-1' }, 422, 'REGION_NOT_ENABLED'],
    ['a region excluded by the allow-list', { region: 'eu-west-1' }, 422, 'REGION_EXCLUDED'],
  ])('%s: %i %s', async (_name, body, status, code) => {
    const org = await seeded();
    const before = await stateOf(org);
    const res = await put(org, body);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ success: false, code });
    expect(await stateOf(org)).toEqual(before);
    expect(discover).not.toHaveBeenCalled();
  });

  it('no stored region list yet: 409 REGION_LIST_UNKNOWN', async () => {
    const org = await seeded({ regions: [] });
    const before = await stateOf(org);
    const res = await put(org, { region: 'us-west-2' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: 'REGION_LIST_UNKNOWN' });
    expect(await stateOf(org)).toEqual(before);
  });

  it.each([
    ['a held discovery scan lease', `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, $2, '${SCAN_KIND_DISCOVERY}', 'test-holder', NOW(), NOW(), NOW() + interval '1 hour')`],
    ['a held discovery job lease', `INSERT INTO job_leases (organization_id, job_name, holder, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, '${DISCOVERY_JOB_NAME}', 'test-holder', NOW(), NOW(), NOW() + interval '1 hour')`],
  ])('%s: 409 SCAN_IN_PROGRESS; preview says scan_in_progress', async (_name, sql) => {
    const org = await seeded();
    await pool.query(sql, sql.includes('aws_scan_leases') ? [org.orgId, org.accountId] : [org.orgId]);
    const before = await stateOf(org);
    const res = await put(org, { region: 'us-west-2' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: 'SCAN_IN_PROGRESS' });
    expect(await stateOf(org)).toEqual(before);
    const p = await (await preview(org, 'us-west-2')).json();
    expect(p.data).toMatchObject({ scan_in_progress: true, target: { refusal: 'scan_in_progress' } });
  });

  it('a released or expired lease does not block', async () => {
    const org = await seeded();
    await pool.query(
      `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at, released_at)
       VALUES ($1, $2, $3, 'test-holder', NOW() - interval '2 hours', NOW() - interval '2 hours', NOW() + interval '1 hour', NOW() - interval '1 hour')`,
      [org.orgId, org.accountId, SCAN_KIND_DISCOVERY]
    );
    await pool.query(
      `INSERT INTO job_leases (organization_id, job_name, holder, acquired_at, heartbeat_at, expires_at)
       VALUES ($1, $2, 'test-holder', NOW() - interval '2 hours', NOW() - interval '2 hours', NOW() - interval '1 hour')`,
      [org.orgId, DISCOVERY_JOB_NAME]
    );
    expect((await put(org, { region: 'us-west-2' })).status).toBe(200);
  });

  it('no AWS connection: 409 AWS_NOT_CONNECTED; an inactive row is not a connection either', async () => {
    const bare = await harness.buildOrg();
    const res = await harness.sendAs(bare.orgId, bare.owner, 'PUT', '/aws/accounts/home-region', { region: 'us-west-2' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: 'AWS_NOT_CONNECTED' });
    const org = await seeded();
    await pool.query(`UPDATE aws_accounts SET status = 'disconnected' WHERE id = $1`, [org.rowId]);
    const before = await stateOf(org);
    expect((await put(org, { region: 'us-west-2' })).status).toBe(409);
    expect(await stateOf(org)).toEqual(before);
  });
});

describe('GET /api/aws/accounts/home-region: the dialog preview', () => {
  it('flag off: the region list with what can be chosen, the target counts and the resources kept in the old region', async () => {
    const org = await connectedOrg();
    await insertRec(org.orgId, { resource: 'i-hr-a1', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1' });
    await insertRec(org.orgId, { resource: 'placeholder-fn', issue: ISSUE_LAMBDA_LOW_USAGE, region: 'us-east-1' });
    await insertRec(org.orgId, { resource: 'i-hr-a2', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1', status: 'RESOLVED' });
    for (const [name, type, where, status] of [
      ['web-1', 'ec2', 'us-east-1', 'running'], ['db-1', 'rds', 'us-east-1', 'available'], ['gone', 'ec2', 'us-east-1', 'terminated'],
      ['bucket', 's3', 'us-east-1', 'active'], ['west-1', 'ec2', 'us-west-2', 'running'],
    ]) {
      await pool.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata)
         VALUES ($1, $2, $3, $3, $4, $5, $6, '{}', '{}')`,
        [org.orgId, `arn:aws:${type}:${where}:${org.accountId}:placeholder/${name}`, name, type, where, status]
      );
    }
    const before = await stateOf(org);
    const res = await preview(org, 'us-west-2');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({
      success: true,
      data: {
        current_home_region: 'us-east-1',
        multi_region: false,
        scan_in_progress: false,
        regions: [
          { region: 'ap-east-1', opt_in_status: 'not-opted-in', current: false, refusal: 'region_not_enabled' },
          { region: 'eu-west-1', opt_in_status: 'opt-in-not-required', current: false, refusal: 'region_excluded' },
          { region: 'us-east-1', opt_in_status: 'opt-in-not-required', current: true, refusal: null },
          { region: 'us-west-2', opt_in_status: 'opt-in-not-required', current: false, refusal: null },
        ],
        target: {
          region: 'us-west-2',
          refusal: null,
          cost_findings_leaving: { total: 2, by_issue: { [ISSUE_EC2_IDLE_INSTANCE]: 1, [ISSUE_LAMBDA_LOW_USAGE]: 1 } },
          resources_kept_in_old_region: 2,
        },
      },
    });
    expect(await stateOf(org)).toEqual(before);
  });

  it('flag on: resources_kept_in_old_region is null (the old home region is still scanned); a refused target says why', async () => {
    const org = await connectedOrg();
    await pool.query(
      `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', true, 'test', 'test')`, [org.orgId]);
    const res = await preview(org, 'eu-west-1');
    const body = await res.json();
    expect(body.data.multi_region).toBe(true);
    expect(body.data.target).toEqual({ region: 'eu-west-1', refusal: 'region_excluded', cost_findings_leaving: { total: 0, by_issue: {} }, resources_kept_in_old_region: null });
    expect((await (await preview(org)).json()).data.target).toBeUndefined();
    expect((await (await preview(org, 'nope')).json()).data.target.refusal).toBe('invalid_region');
  });
});

describe('tenant isolation (T8)', () => {
  it('one organization changing its home region never touches another with the same account region, issues and resource ids', async () => {
    const a = await connectedOrg();
    const b = await connectedOrg();
    for (const org of [a, b]) {
      await insertRec(org.orgId, { resource: 'i-hr-a1', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1' });
      await setProposal(org, 'proposed', PROPOSAL('us-west-2'));
    }
    const bBefore = await stateOf(b);
    expect((await put(a, { region: 'us-west-2' })).status).toBe(200);
    expect(await stateOf(b)).toEqual(bBefore);
    expect((await stateOf(a)).region).toBe('us-west-2');

    // A's preview acts on A only.
    const p = (await (await preview(a, 'us-east-1')).json()).data;
    expect(p.current_home_region).toBe('us-west-2');
    expect(p.target.cost_findings_leaving.total).toBe(0);
  });

  it('a user of organization A acting with a token for B is refused (no current membership: 401 at authentication); B is unchanged', async () => {
    const a = await connectedOrg();
    const b = await connectedOrg();
    await insertRec(b.orgId, { resource: 'i-hr-a1', issue: ISSUE_EC2_IDLE_INSTANCE, region: 'us-east-1' });
    const bBefore = await stateOf(b);
    const res = await harness.sendAs(b.orgId, a.owner, 'PUT', '/aws/accounts/home-region', { region: 'us-west-2' });
    expect(res.status).toBe(401);
    expect(await stateOf(b)).toEqual(bBefore);
  });
});
