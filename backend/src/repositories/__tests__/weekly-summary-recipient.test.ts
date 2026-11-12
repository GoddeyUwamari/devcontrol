/**
 * Weekly Summary recipient eligibility (R) and organization paging (WE-3a),
 * against real Postgres.
 *
 * getRecipients() and getActiveOrganizationsPage() run their actual SQL on one
 * dedicated connection whose session-local TEMP tables (users,
 * organizations, organization_memberships) shadow the real ones -- pg_temp
 * is searched first for unqualified names. That keeps the fixture to the
 * columns under test (email_weekly_summary is not in the CI bootstrap
 * schema) without any DDL on shared tables, so parallel suites are
 * unaffected. The temp tables vanish when the connection is destroyed.
 *
 * Membership rows mirror what the real code paths write: accepted
 * memberships (creator, signup, invitation accept, SAML provisioning) set
 * joined_at; a pending invitation (organization.service.ts inviteUser())
 * leaves joined_at NULL with an invitation_token, and is_active defaults true.
 */
import { Pool, PoolClient } from 'pg';
import { pool as appPool } from '../../config/database';
import { WeeklySummaryRepository, WEEKLY_SUMMARY_ORG_PAGE_SIZE } from '../weekly-summary.repository';

let client: PoolClient;
let repository: WeeklySummaryRepository;

const ORG_ELIGIBLE = 'a0000000-0000-4000-8000-000000000001';
const ORG_OPTED_OUT = 'a0000000-0000-4000-8000-000000000002';
const ORG_UNVERIFIED = 'a0000000-0000-4000-8000-000000000003';
const ORG_MEMBER_ONLY = 'a0000000-0000-4000-8000-000000000004';
const ORG_PENDING_AND_ACCEPTED = 'a0000000-0000-4000-8000-000000000005';
const ORG_ONLY_PENDING = 'a0000000-0000-4000-8000-000000000006';
const ORG_INACTIVE = 'a0000000-0000-4000-8000-000000000007';
const ORG_DELETED = 'a0000000-0000-4000-8000-000000000008';
const ORG_DELETED_USER = 'a0000000-0000-4000-8000-000000000009';

// Ids chosen so that id order and membership order disagree: the earliest
// membership must win, not the smallest id.
const OWNER_EARLY = 'b0000000-0000-4000-8000-00000000000f';
const OWNER_LATE = 'b0000000-0000-4000-8000-000000000001';
const OWNER_OPTED_OUT_EARLIEST = 'b0000000-0000-4000-8000-000000000000';
const OWNER_OPTED_OUT = 'b0000000-0000-4000-8000-000000000002';
const OWNER_UNVERIFIED = 'b0000000-0000-4000-8000-000000000003';
const ELIGIBLE_MEMBER = 'b0000000-0000-4000-8000-000000000004';
const PENDING_INVITEE = 'b0000000-0000-4000-8000-000000000005';
const ACCEPTED_OWNER = 'b0000000-0000-4000-8000-000000000006';
const INACTIVE_OWNER = 'b0000000-0000-4000-8000-000000000007';
const DELETED_ORG_OWNER = 'b0000000-0000-4000-8000-000000000008';
const DELETED_USER = 'b0000000-0000-4000-8000-000000000009';
/** Opted in and verified, but an admin and a member of ORG_ELIGIBLE: never recipients (WE-D7). */
const ELIGIBLE_ORG_ADMIN = 'b0000000-0000-4000-8000-00000000000a';
const ELIGIBLE_ORG_MEMBER = 'b0000000-0000-4000-8000-00000000000b';

beforeAll(async () => {
  client = await appPool.connect();
  await client.query(`
    CREATE TEMP TABLE organizations (id uuid PRIMARY KEY, created_at timestamptz NOT NULL, deleted_at timestamptz);
    CREATE TEMP TABLE users (
      id uuid PRIMARY KEY, email text, full_name text,
      email_weekly_summary boolean, is_email_verified boolean, deleted_at timestamptz
    );
    CREATE TEMP TABLE organization_memberships (
      organization_id uuid, user_id uuid, role text, created_at timestamptz,
      joined_at timestamptz, is_active boolean DEFAULT true, invitation_token text
    );
  `);
  await client.query(
    `INSERT INTO organizations (id, created_at, deleted_at) VALUES
       ($1, '2026-01-01', NULL), ($2, '2026-01-02', NULL), ($3, '2026-01-03', NULL),
       ($4, '2026-01-04', NULL), ($5, '2026-01-05', NULL), ($6, '2026-01-06', NULL),
       ($7, '2026-01-07', NULL), ($8, '2026-01-08', '2026-09-01'), ($9, '2026-01-09', NULL)`,
    [ORG_ELIGIBLE, ORG_OPTED_OUT, ORG_UNVERIFIED, ORG_MEMBER_ONLY, ORG_PENDING_AND_ACCEPTED,
     ORG_ONLY_PENDING, ORG_INACTIVE, ORG_DELETED, ORG_DELETED_USER]
  );
  // Every user below except the explicitly ineligible ones is opted in and verified.
  await client.query(
    `INSERT INTO users (id, email, full_name, email_weekly_summary, is_email_verified, deleted_at) VALUES
       ($1, 'early@example.test', 'Early Owner', true, true, NULL),
       ($2, 'late@example.test', 'Late Owner', true, true, NULL),
       ($3, 'optedout-earliest@example.test', 'Opted Out Earliest', false, true, NULL),
       ($4, 'optedout@example.test', 'Opted Out', false, true, NULL),
       ($5, 'unverified@example.test', 'Unverified', true, false, NULL),
       ($6, 'member@example.test', 'Member', true, true, NULL),
       ($7, 'invitee@example.test', 'Pending Invitee', true, true, NULL),
       ($8, 'accepted@example.test', 'Accepted Owner', true, true, NULL),
       ($9, 'inactive@example.test', 'Inactive Owner', true, true, NULL),
       ($10, 'deleted-org-owner@example.test', 'Deleted Org Owner', true, true, NULL),
       ($11, 'deleted-user@example.test', 'Deleted User', true, true, '2026-09-01'),
       ($12, 'admin@example.test', 'Eligible Admin', true, true, NULL),
       ($13, 'member2@example.test', 'Eligible Member', true, true, NULL)`,
    [OWNER_EARLY, OWNER_LATE, OWNER_OPTED_OUT_EARLIEST, OWNER_OPTED_OUT, OWNER_UNVERIFIED, ELIGIBLE_MEMBER,
     PENDING_INVITEE, ACCEPTED_OWNER, INACTIVE_OWNER, DELETED_ORG_OWNER, DELETED_USER,
     ELIGIBLE_ORG_ADMIN, ELIGIBLE_ORG_MEMBER]
  );
  await client.query(
    `INSERT INTO organization_memberships
       (organization_id, user_id, role, created_at, joined_at, is_active, invitation_token) VALUES
       -- accepted owners (joined_at set, no token)
       ($1, $2, 'owner', '2026-01-01', '2026-01-01', true, NULL),
       ($1, $3, 'owner', '2026-02-01', '2026-02-01', true, NULL),
       ($1, $4, 'owner', '2025-12-01', '2025-12-01', true, NULL),
       ($1, $21, 'admin', '2025-11-01', '2025-11-01', true, NULL),
       ($1, $22, 'member', '2025-11-02', '2025-11-02', true, NULL),
       ($5, $6, 'owner', '2026-01-01', '2026-01-01', true, NULL),
       ($7, $8, 'owner', '2026-01-01', '2026-01-01', true, NULL),
       ($9, $10, 'member', '2026-01-01', '2026-01-01', true, NULL),
       -- pending owner invitation created BEFORE the accepted owner joined
       ($11, $12, 'owner', '2025-11-01', NULL, true, 'pending-token-1'),
       ($11, $13, 'owner', '2026-03-01', '2026-03-01', true, NULL),
       -- an org whose only owner row is a pending invitation
       ($14, $12, 'owner', '2026-01-01', NULL, true, 'pending-token-2'),
       -- deactivated owner membership
       ($15, $16, 'owner', '2026-01-01', '2026-01-01', false, NULL),
       -- eligible owner of a soft-deleted org
       ($17, $18, 'owner', '2026-01-01', '2026-01-01', true, NULL),
       -- soft-deleted user as the only owner
       ($19, $20, 'owner', '2026-01-01', '2026-01-01', true, NULL)`,
    [
      ORG_ELIGIBLE, OWNER_EARLY, OWNER_LATE, OWNER_OPTED_OUT_EARLIEST,
      ORG_OPTED_OUT, OWNER_OPTED_OUT,
      ORG_UNVERIFIED, OWNER_UNVERIFIED,
      ORG_MEMBER_ONLY, ELIGIBLE_MEMBER,
      ORG_PENDING_AND_ACCEPTED, PENDING_INVITEE, ACCEPTED_OWNER,
      ORG_ONLY_PENDING,
      ORG_INACTIVE, INACTIVE_OWNER,
      ORG_DELETED, DELETED_ORG_OWNER,
      ORG_DELETED_USER, DELETED_USER,
      ELIGIBLE_ORG_ADMIN, ELIGIBLE_ORG_MEMBER,
    ]
  );
  // getActiveOrganizationsPage() queries this.pool: route it to the same session.
  repository = new WeeklySummaryRepository({ query: (...args: any[]) => (client.query as any)(...args) } as unknown as Pool);
});

afterAll(async () => {
  client?.release(true); // destroy the connection so its temp tables never return to the pool
  await appPool.end();
});

const EARLY = { userId: OWNER_EARLY, email: 'early@example.test', fullName: 'Early Owner' };
const LATE = { userId: OWNER_LATE, email: 'late@example.test', fullName: 'Late Owner' };

/** Every eligible organization, read the way the scheduled run reads them: page after page until a short one. */
async function allPages(pageSize?: number): Promise<{ ids: string[]; pages: string[][] }> {
  const pages: string[][] = [];
  let afterId: string | null = null;
  for (;;) {
    const page = await repository.getActiveOrganizationsPage(afterId, pageSize);
    pages.push(page);
    if (pages.length > 100) throw new Error('paging did not end');
    if (page.length < (pageSize ?? WEEKLY_SUMMARY_ORG_PAGE_SIZE)) break;
    afterId = page[page.length - 1];
  }
  return { ids: pages.flat(), pages };
}

describe('WeeklySummaryRepository recipient eligibility', () => {
  it('WE-D7: every opted-in, verified, accepted owner receives it, earliest membership first -- deterministically', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await repository.getRecipients(ORG_ELIGIBLE, client)).toEqual([EARLY, LATE]);
    }
  });

  it('WE-D7: an owner who opted out is never a recipient, even as the earliest owner; the others still are', async () => {
    const ids = (await repository.getRecipients(ORG_ELIGIBLE, client)).map(r => r.userId);
    expect(ids).not.toContain(OWNER_OPTED_OUT_EARLIEST);
    expect(ids).toEqual([OWNER_EARLY, OWNER_LATE]);
    expect(await repository.getRecipients(ORG_OPTED_OUT, client)).toEqual([]);
  });

  it('WE-D7: admins and members are never recipients, even opted in and verified', async () => {
    const ids = (await repository.getRecipients(ORG_ELIGIBLE, client)).map(r => r.userId);
    expect(ids).not.toContain(ELIGIBLE_ORG_ADMIN);
    expect(ids).not.toContain(ELIGIBLE_ORG_MEMBER);
    expect(await repository.getRecipients(ORG_MEMBER_ONLY, client)).toEqual([]);
  });

  it('R: never selects an unverified owner', async () => {
    expect(await repository.getRecipients(ORG_UNVERIFIED, client)).toEqual([]);
  });

  it('B2: never selects a pending-invite owner, even when the invitation predates the accepted owner', async () => {
    expect(await repository.getRecipients(ORG_PENDING_AND_ACCEPTED, client)).toEqual([
      { userId: ACCEPTED_OWNER, email: 'accepted@example.test', fullName: 'Accepted Owner' },
    ]);
  });

  it('B2: an org whose only owner is a pending invitation has no recipient', async () => {
    expect(await repository.getRecipients(ORG_ONLY_PENDING, client)).toEqual([]);
  });

  it('B2: never selects an owner whose membership is inactive', async () => {
    expect(await repository.getRecipients(ORG_INACTIVE, client)).toEqual([]);
  });

  it('B2: a soft-deleted organization has no recipient, even with an eligible owner', async () => {
    expect(await repository.getRecipients(ORG_DELETED, client)).toEqual([]);
  });

  it('B2: never selects a soft-deleted user', async () => {
    expect(await repository.getRecipients(ORG_DELETED_USER, client)).toEqual([]);
  });

  it('R/B2: the organization pages apply the same predicates, so every scheduled org has an eligible recipient', async () => {
    const { ids } = await allPages();
    // Id order; every ineligible org above is absent.
    expect(ids).toEqual([ORG_ELIGIBLE, ORG_PENDING_AND_ACCEPTED]);
    for (const org of ids) expect((await repository.getRecipients(org, client)).length).toBeGreaterThan(0);
  });

  it('P: only the requested organization is considered', async () => {
    // The eligible owners of other orgs are never returned for this one.
    expect(await repository.getRecipients(ORG_MEMBER_ONLY, client)).toEqual([]);
    for (const r of await repository.getRecipients(ORG_PENDING_AND_ACCEPTED, client)) {
      expect([OWNER_EARLY, OWNER_LATE]).not.toContain(r.userId);
    }
  });
});

describe('WeeklySummaryRepository organization paging (WE-3a)', () => {
  /** Synthetic bulk organization ids, built at run time. */
  const bulkId = (prefix: string, n: number) => `${prefix}0000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
  const BULK = 230;
  const eligibleBulk = Array.from({ length: BULK }, (_, i) => bulkId('e', i + 1));
  /** Interleaved ineligible bulk orgs: an opted-out owner each. */
  const ineligibleBulk = Array.from({ length: 40 }, (_, i) => bulkId('d', i + 1));
  const BULK_OWNER = 'b0000000-0000-4000-8000-0000000000bb';
  const BULK_OPTED_OUT = 'b0000000-0000-4000-8000-0000000000bc';

  beforeAll(async () => {
    // Created newest-first by id, so creation order and id order disagree:
    // the old LIMIT 100 by created_at DESC would have reached only the newest 100.
    const all = [...eligibleBulk, ...ineligibleBulk];
    await client.query(
      `INSERT INTO organizations (id, created_at, deleted_at)
       SELECT id::uuid, '2026-06-01'::timestamptz - (ord * interval '1 minute'), NULL
       FROM unnest($1::text[]) WITH ORDINALITY AS t(id, ord)`,
      [all]
    );
    await client.query(
      `INSERT INTO users (id, email, full_name, email_weekly_summary, is_email_verified, deleted_at) VALUES
         ($1, 'bulk-owner@example.test', 'Bulk Owner', true, true, NULL),
         ($2, 'bulk-optedout@example.test', 'Bulk Opted Out', false, true, NULL)`,
      [BULK_OWNER, BULK_OPTED_OUT]
    );
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, created_at, joined_at, is_active, invitation_token)
       SELECT id::uuid, $2::uuid, 'owner', '2026-06-01', '2026-06-01', true, NULL FROM unnest($1::text[]) AS t(id)`,
      [eligibleBulk, BULK_OWNER]
    );
    await client.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, created_at, joined_at, is_active, invitation_token)
       SELECT id::uuid, $2::uuid, 'owner', '2026-06-01', '2026-06-01', true, NULL FROM unnest($1::text[]) AS t(id)`,
      [ineligibleBulk, BULK_OPTED_OUT]
    );
  });

  it(`more than ${WEEKLY_SUMMARY_ORG_PAGE_SIZE} eligible orgs: every one is visited exactly once, across pages, in id order`, async () => {
    const { ids, pages } = await allPages();
    const expected = [ORG_ELIGIBLE, ORG_PENDING_AND_ACCEPTED, ...eligibleBulk].sort();
    expect(expected.length).toBeGreaterThan(2 * WEEKLY_SUMMARY_ORG_PAGE_SIZE);
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pages.map(p => p.length)).toEqual([100, 100, expected.length - 200]);
    for (const id of ineligibleBulk) expect(ids).not.toContain(id);
  });

  it('a smaller page size visits the same orgs; the page size is bounded', async () => {
    const { ids, pages } = await allPages(7);
    expect(ids).toEqual((await allPages()).ids);
    expect(pages.every(p => p.length <= 7)).toBe(true);
    expect(await repository.getActiveOrganizationsPage(null, 1_000_000)).toHaveLength(232);
    expect((await repository.getActiveOrganizationsPage(null, 0)).length).toBe(1);
  });

  it('a page after the last id is empty', async () => {
    const { ids } = await allPages();
    expect(await repository.getActiveOrganizationsPage(ids[ids.length - 1])).toEqual([]);
  });
});
