/**
 * Weekly Summary recipient eligibility (R), against real Postgres.
 *
 * getUserInfo() and getActiveOrganizations() run their actual SQL on one
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
import { WeeklySummaryRepository } from '../weekly-summary.repository';

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
       ($11, 'deleted-user@example.test', 'Deleted User', true, true, '2026-09-01')`,
    [OWNER_EARLY, OWNER_LATE, OWNER_OPTED_OUT_EARLIEST, OWNER_OPTED_OUT, OWNER_UNVERIFIED, ELIGIBLE_MEMBER,
     PENDING_INVITEE, ACCEPTED_OWNER, INACTIVE_OWNER, DELETED_ORG_OWNER, DELETED_USER]
  );
  await client.query(
    `INSERT INTO organization_memberships
       (organization_id, user_id, role, created_at, joined_at, is_active, invitation_token) VALUES
       -- accepted owners (joined_at set, no token)
       ($1, $2, 'owner', '2026-01-01', '2026-01-01', true, NULL),
       ($1, $3, 'owner', '2026-02-01', '2026-02-01', true, NULL),
       ($1, $4, 'owner', '2025-12-01', '2025-12-01', true, NULL),
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
    ]
  );
  // getActiveOrganizations() queries this.pool: route it to the same session.
  repository = new WeeklySummaryRepository({ query: (...args: any[]) => (client.query as any)(...args) } as unknown as Pool);
});

afterAll(async () => {
  client?.release(true); // destroy the connection so its temp tables never return to the pool
  await appPool.end();
});

describe('WeeklySummaryRepository recipient eligibility', () => {
  it('R: selects the earliest-membership opted-in, verified, accepted owner -- deterministically', async () => {
    for (let i = 0; i < 5; i++) {
      const info = await repository.getUserInfo(ORG_ELIGIBLE, client);
      expect(info).toEqual({ userId: OWNER_EARLY, email: 'early@example.test', fullName: 'Early Owner' });
    }
  });

  it('R: never selects an owner who opted out, even when they are the earliest owner', async () => {
    const info = await repository.getUserInfo(ORG_ELIGIBLE, client);
    expect(info?.userId).not.toBe(OWNER_OPTED_OUT_EARLIEST);
    expect(await repository.getUserInfo(ORG_OPTED_OUT, client)).toBeNull();
  });

  it('R: never selects an unverified owner', async () => {
    expect(await repository.getUserInfo(ORG_UNVERIFIED, client)).toBeNull();
  });

  it('R: never selects a non-owner member', async () => {
    expect(await repository.getUserInfo(ORG_MEMBER_ONLY, client)).toBeNull();
  });

  it('B2: never selects a pending-invite owner, even when the invitation predates the accepted owner', async () => {
    const info = await repository.getUserInfo(ORG_PENDING_AND_ACCEPTED, client);
    expect(info).toEqual({ userId: ACCEPTED_OWNER, email: 'accepted@example.test', fullName: 'Accepted Owner' });
  });

  it('B2: an org whose only owner is a pending invitation is skipped', async () => {
    expect(await repository.getUserInfo(ORG_ONLY_PENDING, client)).toBeNull();
  });

  it('B2: never selects an owner whose membership is inactive', async () => {
    expect(await repository.getUserInfo(ORG_INACTIVE, client)).toBeNull();
  });

  it('B2: a soft-deleted organization is skipped, even with an eligible owner', async () => {
    expect(await repository.getUserInfo(ORG_DELETED, client)).toBeNull();
  });

  it('B2: never selects a soft-deleted user', async () => {
    expect(await repository.getUserInfo(ORG_DELETED_USER, client)).toBeNull();
  });

  it('R/B2: getActiveOrganizations applies the same predicates, so every scheduled org has an eligible recipient', async () => {
    const orgs = await repository.getActiveOrganizations();
    // ORDER BY o.created_at DESC; every ineligible org above is absent.
    expect(orgs).toEqual([ORG_PENDING_AND_ACCEPTED, ORG_ELIGIBLE]);
    for (const org of orgs) expect(await repository.getUserInfo(org, client)).not.toBeNull();
  });

  it('P: only the requested organization is considered', async () => {
    // The eligible owners of other orgs are never returned for this one.
    expect(await repository.getUserInfo(ORG_MEMBER_ONLY, client)).toBeNull();
  });
});
