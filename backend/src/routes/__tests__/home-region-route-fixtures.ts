/**
 * Shared fixtures of the home region route suites (aws-home-region-change.test.ts,
 * aws-home-region-proposal-routes.test.ts): a connected organization with a stored
 * region list, cost rows, a stored proposal, and the requests. Not a test file.
 * Placeholders only.
 */
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';

type Harness = ReturnType<typeof createRoleGateHarness>;

export type Org = RoleGateOrg & { accountId: string; rowId: string };

/** The stored region list every organization gets unless a test says otherwise. */
export const REGIONS: Array<[string, string, boolean, boolean]> = [
  // region, opt_in_status, enabled, scan_enabled
  ['ap-east-1', 'not-opted-in', false, true],
  ['eu-west-1', 'opt-in-not-required', true, false],
  ['us-east-1', 'opt-in-not-required', true, true],
  ['us-west-2', 'opt-in-not-required', true, true],
];

/** A stored proposal as home-region-proposal.ts writes it: 7 regions, the home region among the other regions. */
export const PROPOSAL = (region: string, current = 'us-east-1') => ({
  rule_version: 2,
  basis: 'cost_explorer_30d_usage',
  period: { start: '2026-10-17', end: '2026-11-16' },
  region,
  current,
  outcome: 'proposed',
  total_amount: 1000,
  top: [
    { region, share: 70, amount: 700 },
    { region: 'eu-west-1', share: 10, amount: 100 },
    { region: 'us-east-2', share: 8, amount: 80 },
    { region: 'ap-south-1', share: 5, amount: 50 },
    { region: 'sa-east-1', share: 3, amount: 30 },
  ],
  other_regions: { count: 2, share: 4, amount: 40 },
  current_share: 3,
  current_amount: 30,
  non_region_amount: 25.5,
});
/** The GET view of a stored proposal: its evidence, as stored. */
export const VIEW_EVIDENCE = (proposal: Omit<ReturnType<typeof PROPOSAL>, 'region'> & { region: string | null }) => ({
  period: proposal.period,
  shares: proposal.top,
  other_regions: proposal.other_regions,
  current: { region: proposal.current, share: proposal.current_share, amount: proposal.current_amount },
  non_region_amount: proposal.non_region_amount,
});

/** The tables a suite's organizations leave rows in, besides the harness's own. */
export const HOME_REGION_FIXTURE_TABLES = ['cost_recommendations', 'aws_account_regions', 'aws_scan_leases', 'job_leases', 'aws_resources', 'organization_feature_flags', 'aws_connection_checks'];

export function homeRegionRouteFixtures(harness: Harness) {
  const { pool } = harness;
  const uniqueAccountId = () => String(100000000000 + Math.floor(Math.random() * 899999999999));

  async function connectedOrg({ region = 'us-east-1' as string | null, regions = REGIONS } = {}): Promise<Org> {
    const org = await harness.buildOrg();
    const accountId = uniqueAccountId();
    const { rows } = await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
       VALUES ($1, $2, $3, 'placeholder-external-id', $4, NOW(), 'active') RETURNING id`,
      [org.orgId, `arn:aws:iam::${accountId}:role/DevControlRole`, accountId, region]
    );
    for (const [name, optIn, enabled, scanEnabled] of regions) {
      await pool.query(
        `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, opt_in_status, enabled, scan_enabled, last_listed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [org.orgId, accountId, name, optIn, enabled, scanEnabled]
      );
    }
    return { ...org, accountId, rowId: rows[0].id };
  }

  async function insertRec(orgId: string, rec: { resource: string; issue: string; region: string | null; status?: 'ACTIVE' | 'RESOLVED' | 'DISMISSED'; savings?: number }) {
    await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, aws_region, metadata, status)
       VALUES ($1, $2, $2, 'EC2', $3, 'placeholder', $4, 'LOW', $5, '{}', $6)`,
      [orgId, rec.resource, rec.issue, rec.savings ?? 10, rec.region, rec.status ?? 'ACTIVE']
    );
  }

  async function setProposal(org: Org, state: string, proposal: Record<string, unknown> | null, decided = false) {
    await pool.query(
      `INSERT INTO aws_connection_checks (aws_account_id, organization_id, home_region_proposal_state, home_region_proposal, home_region_proposed_at, home_region_decided_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW(), CASE WHEN $5 THEN NOW() END)
       ON CONFLICT (aws_account_id) DO UPDATE SET home_region_proposal_state = EXCLUDED.home_region_proposal_state,
         home_region_proposal = EXCLUDED.home_region_proposal, home_region_proposed_at = EXCLUDED.home_region_proposed_at,
         home_region_decided_at = EXCLUDED.home_region_decided_at`,
      [org.rowId, org.orgId, state, proposal === null ? null : JSON.stringify(proposal), decided]
    );
  }

  /** Everything a refusal must leave alone, in one comparable value. */
  async function stateOf(org: Org) {
    const region = (await pool.query(`SELECT region FROM aws_accounts WHERE id = $1`, [org.rowId])).rows[0].region;
    const recs = (await pool.query(
      `SELECT resource_id, issue, aws_region, status FROM cost_recommendations WHERE organization_id = $1 ORDER BY resource_id, issue, status`, [org.orgId])).rows;
    const audit = (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1`, [org.orgId])).rows[0].n;
    const proposal = (await pool.query(
      `SELECT home_region_proposal_state AS state, home_region_decided_at IS NOT NULL AS decided FROM aws_connection_checks WHERE aws_account_id = $1`, [org.rowId])).rows[0] ?? null;
    return { region, recs, audit, proposal };
  }

  const put = (org: Org, body: unknown, as: string = org.owner) => harness.sendAs(org.orgId, as, 'PUT', '/aws/accounts/home-region', body);
  const preview = (org: Org, region?: string, as: string = org.owner) =>
    harness.sendAs(org.orgId, as, 'GET', `/aws/accounts/home-region${region === undefined ? '' : `?region=${encodeURIComponent(region)}`}`);
  const dismiss = (org: Org, as: string = org.owner) => harness.sendAs(org.orgId, as, 'POST', '/aws/accounts/home-region/proposal/dismiss', {});
  const accounts = (org: Org, as: string = org.owner) => harness.sendAs(org.orgId, as, 'GET', '/aws/accounts');

  return { uniqueAccountId, connectedOrg, insertRec, setProposal, stateOf, put, preview, dismiss, accounts };
}
