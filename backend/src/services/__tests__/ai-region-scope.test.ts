/**
 * Multi-region PR 2 (Step 1 §9.2 A1, MR-D15): the AI's region scope for the resource
 * inventory, from the coverage API, only for an organization with multi_region_discovery
 * on. Without the flag every AI text keeps its home-region wording exactly.
 *
 *   - regionScanFromCoverage: undefined without the multi_region key; the regions by
 *     their last result otherwise;
 *   - regionScopeText: every state named, codes only, home-only savings, no list yet,
 *     unavailable (never "home region only" for a flagged organization);
 *   - AI Chat's "- Regions:" line and the evidence renderer's inventory scope: the
 *     old text without regionScan, the data-driven text with it;
 *   - AIChatContextRepository.gatherInventoryBasis against Postgres: flag off, no
 *     regionScan (the scope object is exactly as before); flag on, the coverage's
 *     regions; flag on with an unreadable coverage, 'unavailable'.
 *
 * No model call; placeholders only.
 */
import { Pool } from 'pg';
import { AIChatService } from '../ai-chat.service';
import { renderProviderProse } from '../ai/evidence/render';
import { AIChatContextRepository } from '../../repositories/ai-chat-context.repository';
import { InventoryRegionScan, regionScanFromCoverage, regionScopeText } from '../ai-region-scope';
import type { InventoryScope } from '../ai-context-contract';
import type { ServicesCoverage } from '../../routes/services-coverage.routes';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const ACCOUNT = '123456789012';
const HOME = 'us-east-1';

const OLD_LINE = `- Regions: ${HOME} only (resources in other regions are not discovered, except S3 buckets, which are listed account-wide, and CloudFront, which is global; the region list and scan status are in the evidence sources below)`;

const KNOWN: InventoryRegionScan = {
  state: 'known',
  homeRegion: HOME,
  enabledRegions: 6,
  checked: [HOME, 'eu-west-1'],
  partial: ['me-central-1'],
  notChecked: [{ region: 'ap-south-1', status: 'denied', code: 'access_denied_scp' }, { region: 'ca-central-1', status: 'failed', code: null }],
  notScannedYet: ['us-west-2'],
  notEnabled: 2,
  scanInProgress: false,
  savingsRegions: [HOME],
};

function coverageWith(multi: Partial<NonNullable<ServicesCoverage['multi_region']>> | null): ServicesCoverage {
  const base = { account: { connected: true, status: 'active', home_region: HOME } } as unknown as ServicesCoverage;
  if (multi === null) return base;
  return {
    ...base,
    multi_region: {
      home_region: HOME,
      savings_regions: [HOME],
      not_enabled_regions: ['ap-east-1'],
      regions: [],
      regions_checked: { enabled: null, complete: 0, partial: 0, not_checked: 0, not_reached: 0, never_scanned: 0, by_state: {} as any },
      progress: null,
      region_warnings: [],
      region_warnings_complete: true,
      ...multi,
    },
  };
}

const region = (name: string, status: string, code: string | null = null) =>
  ({ region: name, home: name === HOME, opt_in: false, status, error_code: code, last_scan_finished_at: null, last_success_at: null, stale: false, result_of: null, scan_state: null, resources: null }) as any;

describe('regionScanFromCoverage', () => {
  it('no multi_region key (the flag is off): undefined', () => {
    expect(regionScanFromCoverage(coverageWith(null))).toBeUndefined();
  });

  it('the regions by their last result; the not-enabled count; a running scan; home-only savings', () => {
    const scan = regionScanFromCoverage(coverageWith({
      regions: [region(HOME, 'ok'), region('ap-south-1', 'denied', 'access_denied'), region('eu-west-1', 'partial', 'discovery_listing_truncated'),
        region('us-west-2', 'never_scanned'), region('ca-central-1', 'timed_out', 'scan_budget')],
      regions_checked: { enabled: 5, complete: 1, partial: 1, not_checked: 1, not_reached: 1, never_scanned: 1, by_state: {} as any },
      progress: { scan_started_at: null, regions_total: 5, regions_done: 1, regions_running: 1, regions_waiting: 3 },
    }));
    expect(scan).toEqual({
      state: 'known',
      homeRegion: HOME,
      enabledRegions: 5,
      checked: [HOME],
      partial: ['eu-west-1'],
      notChecked: [{ region: 'ap-south-1', status: 'denied', code: 'access_denied' }, { region: 'ca-central-1', status: 'timed_out', code: 'scan_budget' }],
      notScannedYet: ['us-west-2'],
      notEnabled: 1,
      scanInProgress: true,
      savingsRegions: [HOME],
    });
  });
});

describe('regionScopeText', () => {
  it('names every state, with codes only; S3/CloudFront and home-only savings', () => {
    expect(regionScopeText(KNOWN)).toBe(
      `2 of 6 enabled regions checked completely on their last scan (home ${HOME}); ` +
        'checked in part (a listing was cut off): me-central-1; ' +
        'not checked completely on their last scan: ap-south-1 (denied, access_denied_scp), ca-central-1 (failed); ' +
        'not scanned yet: us-west-2; ' +
        '2 opt-in region(s) not enabled in this account (never scanned); ' +
        'S3 buckets are listed account-wide and CloudFront is global; ' +
        `savings (cost recommendations) are checked in ${HOME} only`
    );
  });

  it('every region checked: no empty lists; a running scan is said', () => {
    expect(regionScopeText({ ...KNOWN, checked: ['a', 'b'], enabledRegions: 2, partial: [], notChecked: [], notScannedYet: [], notEnabled: 0, scanInProgress: true })).toBe(
      `2 of 2 enabled regions checked completely on their last scan (home ${HOME}); a scan is running now, so these results may change; ` +
        `S3 buckets are listed account-wide and CloudFront is global; savings (cost recommendations) are checked in ${HOME} only`
    );
  });

  it('no region list stored yet: the home region only so far, said as such', () => {
    expect(regionScopeText({ ...KNOWN, enabledRegions: null })).toMatch(/^us-east-1 only so far \(the account's region list has not been recorded yet/);
  });

  it('unavailable: unknown, never "home region only"', () => {
    const text = regionScopeText({ state: 'unavailable' });
    expect(text).toMatch(/^unknown/);
    expect(text).not.toContain(HOME);
  });
});

describe('AI Chat\'s Regions line and the evidence renderer', () => {
  const scope = (regionScan?: InventoryRegionScan): InventoryScope => ({
    kind: 'resource_inventory', connectedAccountId: ACCOUNT, discoveryRegion: HOME, ...(regionScan ? { regionScan } : {}),
  });
  const chatLines = (s: InventoryScope): string[] => (new AIChatService({} as any) as any).formatScope(s);
  const prose = (s: InventoryScope) =>
    renderProviderProse({ id: 'inventory.test', title: 'Inventory', section: { state: 'available', source: 'test', asOf: null, scope: s, coverage: null, reason: null, data: null } as any });

  it('without regionScan (flag off): the home-region line, byte for byte as before', () => {
    expect(chatLines(scope())).toEqual([
      '- Scope: AWS resources DevControl discovered under the connected IAM role',
      `- Connected AWS account: ${ACCOUNT}`,
      OLD_LINE,
    ]);
    expect(prose(scope())).toContain(`- Scope: AWS resources DevControl discovered in account ${ACCOUNT}, region ${HOME} (S3 account-wide, CloudFront global)`);
  });

  it('with regionScan (flag on): the regions the scan covered, never "only" the home region', () => {
    const lines = chatLines(scope(KNOWN));
    expect(lines[2]).toBe(`- Regions: ${regionScopeText(KNOWN)} (the region list and scan status are in the evidence sources below)`);
    expect(lines.join('\n')).not.toContain('resources in other regions are not discovered');
    expect(prose(scope(KNOWN))).toContain(`- Scope: AWS resources DevControl discovered in account ${ACCOUNT}; regions: ${regionScopeText(KNOWN)}`);
  });
});

// ---------------------------------------------------------------------------
describe('AIChatContextRepository.gatherInventoryBasis (Postgres)', () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  const orgIds: string[] = [];

  beforeAll(async () => {
    await ensureSharedFixtureTable(pool, 'aws_accounts');
  });

  async function org(flag: boolean | null): Promise<string> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'starter', 'active') RETURNING id`,
      [`AI Region ${suffix}`, `ai-region-${suffix}`]
    );
    const orgId = rows[0].id;
    orgIds.push(orgId);
    await pool.query(
      `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status)
       VALUES ($1, $2, $3, 'external-id-1', $4, NOW(), 'active')`,
      // aws_accounts.account_id is unique: a per-organization placeholder, as the route tests use.
      [orgId, `arn:aws:iam::${ACCOUNT}:role/DevControlRole`, `air-${orgId}`.slice(0, 32), HOME]
    );
    if (flag !== null) {
      await pool.query(`INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, note) VALUES ($1, 'multi_region_discovery', $2, 'test', 'test')`, [orgId, flag]);
    }
    const listed = '2026-03-02T09:59:00Z';
    for (const [name, status, code] of [[HOME, 'ok', null], ['ap-south-1', 'denied', 'access_denied']] as const) {
      await pool.query(
        `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at, last_scan_status, last_scan_started_at, last_scan_finished_at, last_error_code)
         VALUES ($1, $2, $3, 'opt-in-not-required', true, $4, $5, '2026-03-02T10:00:00Z', '2026-03-02T10:03:00Z', $6)`,
        [orgId, ACCOUNT, name, listed, status, code]
      );
    }
    return orgId;
  }

  afterAll(async () => {
    for (const table of ['aws_account_regions', 'organization_feature_flags']) await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [orgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
    await pool.end();
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([['no flag row', null], ['a flag row saying off', false]] as const)('%s: the inventory scope has no regionScan (exactly the three keys of before)', async (_label, flag) => {
    const orgId = await org(flag);
    const { inventoryScope } = await new AIChatContextRepository(pool).gatherInventoryBasis(orgId);
    expect(Object.keys(inventoryScope)).toEqual(['kind', 'connectedAccountId', 'discoveryRegion']);
  }, 30_000);

  it('flag on: the coverage API\'s regions', async () => {
    const orgId = await org(true);
    const { inventoryScope } = await new AIChatContextRepository(pool).gatherInventoryBasis(orgId);
    expect(inventoryScope.regionScan).toEqual({
      state: 'known', homeRegion: HOME, enabledRegions: 2, checked: [HOME], partial: [],
      notChecked: [{ region: 'ap-south-1', status: 'denied', code: 'access_denied' }],
      notScannedYet: [], notEnabled: 0, scanInProgress: false, savingsRegions: [HOME],
    });
  }, 30_000);

  it('flag on, the coverage cannot be read: unavailable (logged by error name), never the home region alone', async () => {
    const orgId = await org(true);
    const routes = await import('../../routes/services-coverage.routes');
    jest.spyOn(routes, 'readServicesCoverage').mockRejectedValue(Object.assign(new Error('placeholder detail'), { name: 'PlaceholderError' }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { inventoryScope } = await new AIChatContextRepository(pool).gatherInventoryBasis(orgId);
    expect(inventoryScope.regionScan).toEqual({ state: 'unavailable' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('region_scan_unreadable'));
    expect(warn.mock.calls.flat().join(' ')).not.toContain('placeholder detail');
  }, 30_000);
});
