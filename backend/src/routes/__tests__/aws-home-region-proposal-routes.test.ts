/**
 * Home region HR-1, the proposal over the real routes (real authenticate
 * middleware, the caller's CURRENT membership, real RLS wiring, live Postgres;
 * only authService.verifyToken is stubbed):
 *
 *   POST /api/aws/accounts/home-region/proposal/dismiss    owner only (HR-D4),
 *        audited, once (HR-D16); nothing to dismiss is 409.
 *   GET  /api/aws/accounts                       home_region_proposal: state,
 *        region and the stored evidence (top 5 with shares and amounts, other
 *        regions, the home region, the non-region amount); waiting /
 *        not_applicable rules.
 *   Tenant isolation (T8): another organization's dismiss and GET never reach a
 *        proposal, and under row level security the proposal row is invisible
 *        and unchangeable across tenants.
 *
 * Placeholders only.
 */
import awsRoutes, { HOME_REGION_FORBIDDEN_MESSAGE } from '../aws.routes';
import { createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import { HOME_REGION_FIXTURE_TABLES, PROPOSAL, REGIONS, VIEW_EVIDENCE, homeRegionRouteFixtures } from './home-region-route-fixtures';

const harness = createRoleGateHarness('home-region-proposal');
const { pool } = harness;
const { connectedOrg, setProposal, stateOf, dismiss, accounts } = homeRegionRouteFixtures(harness);

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => app.use('/api/aws', awsRoutes));
});

beforeEach(() => {
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

describe('POST /api/aws/accounts/home-region/proposal/dismiss (HR-D16)', () => {
  it('the owner keeps the current region: proposal dismissed for good, audited; a second dismiss is 409; the region is unchanged', async () => {
    const org = await connectedOrg();
    await setProposal(org, 'proposed', PROPOSAL('us-west-2'));
    const res = await dismiss(org);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { state: 'dismissed' } });
    expect(await stateOf(org)).toMatchObject({ region: 'us-east-1', proposal: { state: 'dismissed', decided: true } });
    const audit = (await pool.query(`SELECT action, changes, metadata FROM audit_logs WHERE organization_id = $1`, [org.orgId])).rows;
    expect(audit).toEqual([{ action: 'aws_account.home_region_proposal_dismissed', changes: null, metadata: { proposed_region: 'us-west-2', kept_region: 'us-east-1', split: false } }]);
    const again = await dismiss(org);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ success: false, code: 'NO_OPEN_PROPOSAL' });
    expect((await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1`, [org.orgId])).rows[0].n).toBe(1);
  });

  it.each(['admin', 'member', 'viewer'] as const)('%s: 403 with the owner-only message; nothing changes', async (role) => {
    const org = await connectedOrg();
    await setProposal(org, 'proposed', PROPOSAL('us-west-2'));
    const before = await stateOf(org);
    const res = await dismiss(org, org[role]);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, message: HOME_REGION_FORBIDDEN_MESSAGE });
    expect(await stateOf(org)).toEqual(before);
  });

  it('an open split-spend prompt can be dismissed by the owner too (keep the current region), once', async () => {
    const org = await connectedOrg();
    await setProposal(org, 'split', { ...PROPOSAL('us-west-2'), region: null, outcome: 'near_tie' });
    expect((await dismiss(org)).status).toBe(200);
    expect(await stateOf(org)).toMatchObject({ region: 'us-east-1', proposal: { state: 'dismissed', decided: true } });
    const { metadata } = (await pool.query(`SELECT metadata FROM audit_logs WHERE organization_id = $1`, [org.orgId])).rows[0];
    expect(metadata).toEqual({ proposed_region: null, kept_region: 'us-east-1', split: true });
    expect((await dismiss(org)).status).toBe(409);
  });

  it.each(['no_signal', 'unavailable'])('nothing to dismiss when the proposal is %s', async (state) => {
    const org = await connectedOrg();
    await setProposal(org, state, null);
    expect((await dismiss(org)).status).toBe(409);
    expect((await stateOf(org)).proposal).toEqual({ state, decided: false });
  });
});

describe('GET /api/aws/accounts: home_region_proposal (state, region and the stored evidence)', () => {
  it.each([
    ['proposed, enabled, not the home region', 'proposed', PROPOSAL('us-west-2'), REGIONS, 'proposed'],
    ['proposed, no stored list yet', 'proposed', PROPOSAL('us-west-2'), [], 'waiting'],
    ['proposed, region not enabled', 'proposed', PROPOSAL('ap-east-1'), REGIONS, 'not_applicable'],
    ['proposed, region excluded', 'proposed', PROPOSAL('eu-west-1'), REGIONS, 'not_applicable'],
    ['dismissed', 'dismissed', PROPOSAL('us-west-2'), REGIONS, 'dismissed'],
    ['split spend, region list stored', 'split', { ...PROPOSAL('us-west-2'), region: null, outcome: 'near_tie' }, REGIONS, 'split'],
    ['split spend, no stored list yet', 'split', { ...PROPOSAL('us-west-2'), region: null, outcome: 'near_tie' }, [], 'split_waiting'],
  ] as const)('%s → %s', async (_name, state, proposal, regions, expected) => {
    const org = await connectedOrg({ regions: regions as any });
    await setProposal(org, state, proposal, state === 'dismissed');
    for (const role of ['owner', 'viewer'] as const) {
      const body = await (await accounts(org, org[role])).json();
      expect(body.home_region_proposal).toEqual({ state: expected, region: proposal.region, ...VIEW_EVIDENCE(proposal) });
    }
  });

  it('proposed, and the home region is already that region: not_applicable', async () => {
    const org = await connectedOrg({ region: 'us-west-2' });
    await setProposal(org, 'proposed', PROPOSAL('us-west-2'));
    expect((await (await accounts(org)).json()).home_region_proposal.state).toBe('not_applicable');
  });

  it('no_signal and unavailable: no region; null when never proposed or not connected; nothing else changes in the response', async () => {
    const org = await connectedOrg();
    const none = await (await accounts(org)).json();
    expect(none.home_region_proposal).toBeNull();
    expect(Object.keys(none).sort()).toEqual(['connection', 'data', 'home_region_proposal', 'success']);
    await setProposal(org, 'unavailable', null);
    expect((await (await accounts(org)).json()).home_region_proposal).toEqual({
      state: 'unavailable', region: null, period: null, shares: [], other_regions: null, current: null, non_region_amount: null,
    });
    const noSignal = { ...PROPOSAL('us-west-2'), region: null, outcome: 'near_tie' };
    await setProposal(org, 'no_signal', noSignal);
    expect((await (await accounts(org)).json()).home_region_proposal).toEqual({ state: 'no_signal', region: null, ...VIEW_EVIDENCE(noSignal as any) });
    const bare = await harness.buildOrg();
    expect((await (await harness.sendAs(bare.orgId, bare.owner, 'GET', '/aws/accounts')).json()).home_region_proposal).toBeNull();
  });

  it('the view carries exactly its keys; the top 5 and the other regions add up to 100%', async () => {
    const org = await connectedOrg();
    await setProposal(org, 'proposed', PROPOSAL('us-west-2'));
    const view = (await (await accounts(org)).json()).home_region_proposal;
    expect(Object.keys(view).sort()).toEqual(['current', 'non_region_amount', 'other_regions', 'period', 'region', 'shares', 'state']);
    expect([...view.shares.map((s: any) => s.share), view.other_regions.share].reduce((a: number, b: number) => a + b, 0)).toBe(100);
  });
});

describe('tenant isolation (T8)', () => {
  it("another organization's dismiss and GET never reach this organization's proposal", async () => {
    const a = await connectedOrg();
    const b = await connectedOrg();
    await setProposal(b, 'proposed', PROPOSAL('us-west-2'));
    expect((await dismiss(a)).status).toBe(409);
    expect((await (await accounts(a)).json()).home_region_proposal).toBeNull();
    expect((await stateOf(b)).proposal).toEqual({ state: 'proposed', decided: false });
  });

  it('under row level security, organization A cannot read or change B\'s proposal row', async () => {
    const a = await connectedOrg();
    const b = await connectedOrg();
    await setProposal(b, 'proposed', PROPOSAL('us-west-2'));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE devcontrol');
      await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [a.orgId]);
      expect((await client.query(`SELECT count(*)::int AS n FROM aws_connection_checks WHERE aws_account_id = $1`, [b.rowId])).rows[0].n).toBe(0);
      expect((await client.query(
        `UPDATE aws_connection_checks SET home_region_proposal_state = 'dismissed', home_region_decided_at = now() WHERE aws_account_id = $1`, [b.rowId])).rowCount).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect((await stateOf(b)).proposal).toEqual({ state: 'proposed', decided: false });
  });
});
