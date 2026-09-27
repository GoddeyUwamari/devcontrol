/**
 * Weekly Summary recipient eligibility (R), against real Postgres.
 *
 * getUserInfo() and getActiveOrganizations() run their actual SQL on one
 * dedicated connection whose session-local TEMP tables (users,
 * organizations, organization_memberships) shadow the real ones -- pg_temp
 * is searched first for unqualified names. That keeps the fixture to the
 * columns under test (email_weekly_summary is not in the CI bootstrap
 * schema) without any DDL on shared tables, so parallel suites are
 * unaffected. The temp tables vanish when the connection is released.
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

// Users ids chosen so that id order and membership order disagree: the
// earliest membership must win, not the smallest id.
const OWNER_EARLY = 'b0000000-0000-4000-8000-00000000000f';
const OWNER_LATE = 'b0000000-0000-4000-8000-000000000001';
const OWNER_OPTED_OUT_EARLIEST = 'b0000000-0000-4000-8000-000000000000';
const OWNER_OPTED_OUT = 'b0000000-0000-4000-8000-000000000002';
const OWNER_UNVERIFIED = 'b0000000-0000-4000-8000-000000000003';
const ELIGIBLE_MEMBER = 'b0000000-0000-4000-8000-000000000004';

beforeAll(async () => {
  client = await appPool.connect();
  await client.query(`
    CREATE TEMP TABLE organizations (id uuid PRIMARY KEY, created_at timestamptz NOT NULL);
    CREATE TEMP TABLE users (
      id uuid PRIMARY KEY, email text, full_name text,
      email_weekly_summary boolean, is_email_verified boolean
    );
    CREATE TEMP TABLE organization_memberships (
      organization_id uuid, user_id uuid, role text, created_at timestamptz
    );
  `);
  await client.query(
    `INSERT INTO organizations (id, created_at) VALUES
       ($1, '2026-01-01'), ($2, '2026-01-02'), ($3, '2026-01-03'), ($4, '2026-01-04')`,
    [ORG_ELIGIBLE, ORG_OPTED_OUT, ORG_UNVERIFIED, ORG_MEMBER_ONLY]
  );
  await client.query(
    `INSERT INTO users (id, email, full_name, email_weekly_summary, is_email_verified) VALUES
       ($1, 'early@example.test', 'Early Owner', true, true),
       ($2, 'late@example.test', 'Late Owner', true, true),
       ($3, 'optedout-earliest@example.test', 'Opted Out Earliest', false, true),
       ($4, 'optedout@example.test', 'Opted Out', false, true),
       ($5, 'unverified@example.test', 'Unverified', true, false),
       ($6, 'member@example.test', 'Member', true, true)`,
    [OWNER_EARLY, OWNER_LATE, OWNER_OPTED_OUT_EARLIEST, OWNER_OPTED_OUT, OWNER_UNVERIFIED, ELIGIBLE_MEMBER]
  );
  await client.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, created_at) VALUES
       ($1, $2, 'owner', '2026-01-01'),
       ($1, $3, 'owner', '2026-02-01'),
       ($1, $4, 'owner', '2025-12-01'),
       ($5, $6, 'owner', '2026-01-01'),
       ($7, $8, 'owner', '2026-01-01'),
       ($9, $10, 'member', '2026-01-01')`,
    [
      ORG_ELIGIBLE, OWNER_EARLY, OWNER_LATE, OWNER_OPTED_OUT_EARLIEST,
      ORG_OPTED_OUT, OWNER_OPTED_OUT,
      ORG_UNVERIFIED, OWNER_UNVERIFIED,
      ORG_MEMBER_ONLY, ELIGIBLE_MEMBER,
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
  it('R: selects the earliest-membership opted-in, verified owner -- deterministically', async () => {
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

  it('R: getActiveOrganizations applies the same predicates, so every scheduled org has an eligible recipient', async () => {
    const orgs = await repository.getActiveOrganizations();
    expect(orgs).toEqual([ORG_ELIGIBLE]);
    for (const org of orgs) expect(await repository.getUserInfo(org, client)).not.toBeNull();
  });

  it('P: only the requested organization is considered', async () => {
    const info = await repository.getUserInfo(ORG_MEMBER_ONLY, client);
    expect(info).toBeNull(); // the eligible owner of ORG_ELIGIBLE is never returned for another org
  });
});
