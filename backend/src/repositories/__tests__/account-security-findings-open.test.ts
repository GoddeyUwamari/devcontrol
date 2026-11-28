/**
 * PR B2b: one shared definition of an open account security finding.
 *
 *   open = status 'active' AND disposition is not dismissed / accepted_risk
 *          (isOpenFinding; openFindingSql is the same rule in SQL, over the
 *          same CLOSED_FINDING_DISPOSITIONS constant)
 *
 *   - GET /api/security/account-findings/stats (getOpenStats; the Dashboard
 *     banner, tile and key findings card) counts open findings only, in every
 *     severity (Critical included), aggregated in SQL per organization;
 *   - GET /api/security/account-findings still lists dismissed and
 *     accepted-risk findings, unchanged, each with is_open from the same rule;
 *   - getStats() (risk score, daily snapshot) is unchanged;
 *   - another organization's findings never enter any count.
 *
 * Runs against the local Postgres built from the CI schema (no AWS). Rows are
 * inserted directly: dispositions are a counting input here, not under test.
 */
import { Pool } from 'pg';
import type { Request, Response } from 'express';
import {
  AccountSecurityFindingsRepository,
  CLOSED_FINDING_DISPOSITIONS,
  isOpenFinding,
  openFindingSql,
  type AccountFindingDisposition,
  type AccountFindingStatus,
} from '../account-security-findings.repository';
import { AccountSecurityFindingsController } from '../../controllers/account-security-findings.controller';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const repository = new AccountSecurityFindingsRepository();
const controller = new AccountSecurityFindingsController();
const createdOrgIds: string[] = [];

type Seed = { severity: 'critical' | 'high' | 'medium' | 'low'; category: 'networking' | 'iam'; status: AccountFindingStatus; disposition: AccountFindingDisposition | null };

/** Org A: three open findings (one critical, one acknowledged high, one medium) and four that are not open. */
const ORG_A: Seed[] = [
  { severity: 'critical', category: 'networking', status: 'active', disposition: null },
  { severity: 'critical', category: 'networking', status: 'active', disposition: 'dismissed' },
  { severity: 'critical', category: 'iam', status: 'active', disposition: 'accepted_risk' },
  { severity: 'high', category: 'iam', status: 'active', disposition: 'acknowledged' },
  { severity: 'high', category: 'networking', status: 'active', disposition: 'accepted_risk' },
  { severity: 'medium', category: 'iam', status: 'active', disposition: null },
  { severity: 'low', category: 'networking', status: 'resolved', disposition: null },
];
/** Org B: every severity open, so any leak into org A's counts shows. */
const ORG_B: Seed[] = [
  { severity: 'critical', category: 'iam', status: 'active', disposition: null },
  { severity: 'critical', category: 'iam', status: 'active', disposition: null },
  { severity: 'high', category: 'networking', status: 'active', disposition: null },
  { severity: 'medium', category: 'networking', status: 'active', disposition: null },
  { severity: 'low', category: 'iam', status: 'active', disposition: null },
  { severity: 'low', category: 'iam', status: 'active', disposition: 'dismissed' },
];

let orgA: string;
let orgB: string;
let orgEmpty: string;

async function insertOrg(label: string): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Open Findings ${label} ${suffix}`, `open-findings-${label.toLowerCase()}-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function seed(orgId: string, seeds: Seed[]): Promise<void> {
  let i = 0;
  for (const s of seeds) {
    i++;
    await pool.query(
      `INSERT INTO account_security_findings
         (organization_id, finding_key, category, severity, title, recommendation, resource_identifier, region, status, resolved_at, disposition, disposition_at, detected_at)
       VALUES ($1, $2, $3, $4, $5, 'Fix it.', $6, 'us-east-1', $7, $8, $9, $10, NOW() - ($11 || ' minutes')::interval)`,
      [orgId, `open-test-${orgId.slice(0, 8)}-${i}`, s.category, s.severity, `Finding ${i} (${s.severity}, ${s.disposition ?? 'none'})`,
        `sg-open-test-${i}`, s.status, s.status === 'resolved' ? new Date() : null, s.disposition, s.disposition ? new Date() : null, String(i)]
    );
  }
}

beforeAll(async () => {
  orgA = await insertOrg('A');
  orgB = await insertOrg('B');
  orgEmpty = await insertOrg('Empty');
  await seed(orgA, ORG_A);
  await seed(orgB, ORG_B);
});

afterAll(async () => {
  if (createdOrgIds.length > 0) await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
});

describe('the one predicate', () => {
  const STATUSES: AccountFindingStatus[] = ['active', 'resolved'];
  const DISPOSITIONS: Array<AccountFindingDisposition | null> = [null, 'acknowledged', 'dismissed', 'accepted_risk'];

  it('open = active and not dismissed / accepted risk; acknowledged stays open', () => {
    expect(CLOSED_FINDING_DISPOSITIONS).toEqual(['dismissed', 'accepted_risk']);
    expect(isOpenFinding('active', null)).toBe(true);
    expect(isOpenFinding('active', 'acknowledged')).toBe(true);
    expect(isOpenFinding('active', 'dismissed')).toBe(false);
    expect(isOpenFinding('active', 'accepted_risk')).toBe(false);
    for (const d of DISPOSITIONS) expect(isOpenFinding('resolved', d)).toBe(false);
  });

  it('openFindingSql agrees with isOpenFinding on every status x disposition, in Postgres', async () => {
    const combos = STATUSES.flatMap((status) => DISPOSITIONS.map((disposition) => ({ status, disposition })));
    const values = combos.map((_, i) => `($${2 * i + 2}::text, $${2 * i + 3}::text)`).join(', ');
    const { rows } = await pool.query(
      `SELECT status, disposition, (${openFindingSql(1)}) AS open FROM (VALUES ${values}) AS t(status, disposition)`,
      [CLOSED_FINDING_DISPOSITIONS, ...combos.flatMap((c) => [c.status, c.disposition])]
    );
    expect(rows).toHaveLength(combos.length);
    for (const row of rows) expect(row.open).toBe(isOpenFinding(row.status, row.disposition));
  });
});

describe('getOpenStats: open counts only, every severity, per organization', () => {
  it('org A: dismissed and accepted-risk are in no count (Critical included); acknowledged is', async () => {
    expect(await repository.getOpenStats(orgA)).toEqual({
      total: 3,
      bySeverity: { critical: 1, high: 1, medium: 1, low: 0 },
      byCategory: { networking: 1, iam: 2 },
    });
  });

  it("org B's findings never enter org A's counts, and the reverse", async () => {
    expect(await repository.getOpenStats(orgB)).toEqual({
      total: 5,
      bySeverity: { critical: 2, high: 1, medium: 1, low: 1 },
      byCategory: { networking: 2, iam: 3 },
    });
    expect(await repository.getOpenStats(orgEmpty)).toEqual({
      total: 0,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
      byCategory: { networking: 0, iam: 0 },
    });
  });

  it('getStats (risk score, daily snapshot) is unchanged: it still counts every active finding', async () => {
    expect(await repository.getStats(orgA)).toEqual({
      total: 6,
      bySeverity: { critical: 3, high: 2, medium: 1, low: 0 },
      byCategory: { networking: 3, iam: 3 },
    });
  });
});

describe('getActive: the list keeps dismissed and accepted-risk findings, each with is_open', () => {
  it('returns all six active findings of org A, severity-sorted, none of org B', async () => {
    const list = await repository.getActive(orgA);
    expect(list).toHaveLength(6);
    expect(list.every((f) => f.organization_id === orgA)).toBe(true);
    expect(list.map((f) => f.severity)).toEqual(['critical', 'critical', 'critical', 'high', 'high', 'medium']);
    const byDisposition = (d: AccountFindingDisposition | null) => list.filter((f) => f.disposition === d).map((f) => f.is_open);
    expect(byDisposition('dismissed')).toEqual([false]);
    expect(byDisposition('accepted_risk')).toEqual([false, false]);
    expect(byDisposition('acknowledged')).toEqual([true]);
    expect(byDisposition(null)).toEqual([true, true]);
  });

  it('is_open is the same rule as the counts: the open rows tally exactly to getOpenStats', async () => {
    for (const org of [orgA, orgB]) {
      const list = await repository.getActive(org);
      const tally = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const f of list) {
        expect(f.is_open).toBe(isOpenFinding(f.status, f.disposition));
        if (f.is_open) tally[f.severity] += 1;
      }
      expect(tally).toEqual((await repository.getOpenStats(org)).bySeverity);
    }
  });

  it('filters and limit work as before', async () => {
    expect((await repository.getActive(orgA, { severity: 'critical' })).map((f) => f.is_open).sort()).toEqual([false, false, true]);
    expect(await repository.getActive(orgA, { category: 'iam' })).toHaveLength(3);
    expect(await repository.getActive(orgA, { limit: 2 })).toHaveLength(2);
  });

  it('getById carries is_open too (the same mapRow)', async () => {
    const dismissed = (await repository.getActive(orgA)).find((f) => f.disposition === 'dismissed')!;
    expect((await repository.getById(orgA, dismissed.id))!.is_open).toBe(false);
    expect(await repository.getById(orgB, dismissed.id)).toBeNull();
  });
});

describe('HTTP: response shapes are unchanged apart from the additive is_open', () => {
  function call(handler: 'getStats' | 'getActive', organizationId: string, query: Record<string, string> = {}) {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const req = { user: { organizationId }, query } as unknown as Request;
    return { run: () => controller[handler](req, { json, status } as unknown as Response), json, status };
  }

  it('GET /stats: { success, data: { total, bySeverity, byCategory } } with open counts', async () => {
    const { run, json, status } = call('getStats', orgA);
    await run();
    expect(status).not.toHaveBeenCalled();
    const body = json.mock.calls[0][0];
    expect(Object.keys(body)).toEqual(['success', 'data']);
    expect(body).toEqual({
      success: true,
      data: { total: 3, bySeverity: { critical: 1, high: 1, medium: 1, low: 0 }, byCategory: { networking: 1, iam: 2 } },
    });
  });

  it('GET / (Security page list): { success, data, total }; every field kept, is_open added', async () => {
    const { run, json, status } = call('getActive', orgA);
    await run();
    expect(status).not.toHaveBeenCalled();
    const body = json.mock.calls[0][0];
    expect(Object.keys(body)).toEqual(['success', 'data', 'total']);
    expect(body.total).toBe(6);
    for (const f of body.data) {
      expect(Object.keys(f).sort()).toEqual([
        'category', 'created_at', 'derived_status', 'detected_at', 'disposition', 'disposition_actor_id', 'disposition_at', 'disposition_note',
        'evidence', 'finding_key', 'framework_mapping', 'id', 'is_open', 'last_seen_at', 'organization_id', 'recommendation', 'region',
        'resolved_at', 'resource_identifier', 'severity', 'status', 'title', 'updated_at',
      ]);
      expect(typeof f.is_open).toBe('boolean');
      // snake_case like derived_status; no camelCase alias is emitted.
      expect(f).not.toHaveProperty('isOpen');
    }
    expect(body.data.filter((f: { derived_status: string }) => f.derived_status === 'dismissed' || f.derived_status === 'accepted_risk')).toHaveLength(3);
  });
});
