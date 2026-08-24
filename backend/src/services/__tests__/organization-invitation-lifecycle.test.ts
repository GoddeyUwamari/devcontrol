/**
 * Live-Postgres coverage for the invitation lifecycle completion: the
 * organization_invitations table (202608231400_create_organization_
 * invitations.sql) and OrganizationService.acceptInvitation()'s new
 * fallback to acceptPendingInvitation(), covering the non-existent-user
 * branch of inviteUser() that was previously unwired (token generated,
 * never persisted, nothing to accept).
 *
 * Same rationale/pattern as auth-organization-email-flows.test.ts: real
 * Postgres for the actual state machine, jest.spyOn the shared emailService
 * singleton so Resend itself is never exercised.
 *
 * A separate regression test at the bottom re-verifies the existing-user
 * path (organization_memberships) end-to-end through acceptInvitation() --
 * that path had no direct test coverage before this change and must remain
 * byte-for-byte behaviorally unchanged now that acceptInvitation() also
 * knows about the new table.
 */

import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { organizationService } from '../organization.service';
import { emailService } from '../email.service';
import { pool as appPool } from '../../config/database';

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

const createdUserIds: string[] = [];
const createdOrgIds: string[] = [];

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function insertUser(overrides: { email?: string; full_name?: string } = {}) {
  const email = overrides.email ?? uniqueEmail('fixture-user');
  const fullName = overrides.full_name ?? 'Fixture User';
  const passwordHash = await bcrypt.hash('Sup3rSecret!1', 4);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
    [email, passwordHash, fullName]
  );
  createdUserIds.push(rows[0].id);
  return { id: rows[0].id as string, email };
}

async function insertOrgWithOwner(overrides: { max_users?: number } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'free', 10, $4) RETURNING id`,
    [`Fixture Org ${suffix}`, `fixture-org-${suffix}`, `Fixture Org Display ${suffix}`, overrides.max_users ?? 5]
  );
  const orgId = rows[0].id as string;
  createdOrgIds.push(orgId);

  const owner = await insertUser({ full_name: 'Org Owner' });
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'owner', NOW(), true)`,
    [orgId, owner.id]
  );

  return { orgId, ownerId: owner.id };
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  // organization_invitations cascade-deletes via organization_id when
  // organizations are deleted, so no separate cleanup is needed for it.
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM sessions WHERE user_id = ANY($1) OR organization_id = ANY($2)', [
    createdUserIds,
    createdOrgIds,
  ]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

describe('OrganizationService.inviteUser() -> non-existent-user branch (organization_invitations)', () => {
  it('persists a durable invitation and sends the invitation email with the matching token', async () => {
    const sendInviteSpy = jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();
    const invitedEmail = uniqueEmail('pending-invitee');

    const result = await organizationService.inviteUser(orgId, {
      email: invitedEmail,
      role: 'member',
      invitedBy: ownerId,
    });

    expect(sendInviteSpy).toHaveBeenCalledTimes(1);
    expect(sendInviteSpy.mock.calls[0][0].invitationToken).toBe(result.invitationToken);

    const { rows } = await pool.query(
      `SELECT invitation_token, role, invitation_expires_at, accepted_at
       FROM organization_invitations WHERE organization_id = $1 AND lower(email) = lower($2)`,
      [orgId, invitedEmail]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].invitation_token).toBe(result.invitationToken);
    expect(rows[0].role).toBe('member');
    expect(rows[0].accepted_at).toBeNull();

    const expiryMs = new Date(rows[0].invitation_expires_at).getTime() - Date.now();
    expect(expiryMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(expiryMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it('refreshes the token and role on a repeat invite to the same not-yet-registered address', async () => {
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();
    const invitedEmail = uniqueEmail('repeat-invitee');

    const first = await organizationService.inviteUser(orgId, {
      email: invitedEmail,
      role: 'viewer',
      invitedBy: ownerId,
    });
    const second = await organizationService.inviteUser(orgId, {
      email: invitedEmail,
      role: 'admin',
      invitedBy: ownerId,
    });

    expect(second.invitationToken).not.toBe(first.invitationToken);

    const { rows } = await pool.query(
      `SELECT invitation_token, role FROM organization_invitations
       WHERE organization_id = $1 AND lower(email) = lower($2)`,
      [orgId, invitedEmail]
    );
    expect(rows).toHaveLength(1); // upsert, not a second row
    expect(rows[0].invitation_token).toBe(second.invitationToken);
    expect(rows[0].role).toBe('admin');
  });
});

describe('OrganizationService.acceptInvitation() -> pending invitation path', () => {
  it('accepts a pending invitation: creates the membership and marks the invitation accepted', async () => {
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();
    const invitedEmail = uniqueEmail('accept-pending');

    const invite = await organizationService.inviteUser(orgId, {
      email: invitedEmail,
      role: 'member',
      invitedBy: ownerId,
    });

    // The invitee has since registered under the invited address.
    const invitee = await insertUser({ email: invitedEmail, full_name: 'Accepting Invitee' });

    const result = await organizationService.acceptInvitation(invite.invitationToken, invitee.id);

    expect(result).toEqual({ organizationId: orgId, role: 'member' });

    const membership = await pool.query(
      `SELECT role, is_active, joined_at FROM organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [orgId, invitee.id]
    );
    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0].role).toBe('member');
    expect(membership.rows[0].is_active).toBe(true);
    expect(membership.rows[0].joined_at).not.toBeNull();

    const invitationRow = await pool.query(
      `SELECT accepted_at, accepted_user_id FROM organization_invitations WHERE invitation_token = $1`,
      [invite.invitationToken]
    );
    expect(invitationRow.rows[0].accepted_at).not.toBeNull();
    expect(invitationRow.rows[0].accepted_user_id).toBe(invitee.id);
  });

  it('rejects a second acceptance attempt on an already-accepted pending invitation', async () => {
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();
    const invitedEmail = uniqueEmail('double-accept');

    const invite = await organizationService.inviteUser(orgId, {
      email: invitedEmail,
      role: 'member',
      invitedBy: ownerId,
    });
    const invitee = await insertUser({ email: invitedEmail, full_name: 'Double Accept Invitee' });

    await organizationService.acceptInvitation(invite.invitationToken, invitee.id);

    await expect(
      organizationService.acceptInvitation(invite.invitationToken, invitee.id)
    ).rejects.toThrow('Invalid or expired invitation');
  });

  it('genuinely concurrent acceptance of the same pending invitation: exactly one attempt succeeds', async () => {
    // Unlike the sequential double-accept test above, all acceptInvitation()
    // calls below are fired without awaiting between them and raced via
    // Promise.allSettled -- exercising real overlapping Postgres transactions
    // racing on acceptPendingInvitation()'s `SELECT ... FOR UPDATE` against
    // the actual database (not mocked, not serialized by the test itself).
    //
    // The appPool.query('SELECT 1') warm-up below is load-bearing, not
    // decoration: verified empirically (by temporarily removing FOR UPDATE
    // from the implementation) that without pre-warming, node-postgres's
    // lazy connection establishment means the first request usually reuses
    // an already-idle connection and fully completes its transaction before
    // the pool finishes opening fresh physical connections for the rest --
    // so every "loser" cleanly sees an already-accepted row and the test
    // passes for the wrong reason regardless of whether FOR UPDATE is
    // present. Forcing CONCURRENCY connections to exist and be idle first
    // makes the acceptInvitation() calls actually start their transactions
    // together, which is what actually exercises the row lock: confirmed
    // that with the warm-up in place, removing FOR UPDATE makes this test
    // fail reliably (multiple acceptances racing past the SELECT before any
    // commits, then colliding on organization_memberships' unique
    // constraint with a raw duplicate-key error) and restoring it makes the
    // test pass reliably, across repeated runs both ways.
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();
    const invitedEmail = uniqueEmail('concurrent-accept');

    const invite = await organizationService.inviteUser(orgId, {
      email: invitedEmail,
      role: 'member',
      invitedBy: ownerId,
    });
    const invitee = await insertUser({ email: invitedEmail, full_name: 'Concurrent Invitee' });

    const CONCURRENCY = 25;
    await Promise.all(Array.from({ length: CONCURRENCY }, () => appPool.query('SELECT 1')));

    const outcomes = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        organizationService.acceptInvitation(invite.invitationToken, invitee.id)
      )
    );

    const fulfilled = outcomes.filter(
      (o): o is PromiseFulfilledResult<any> => o.status === 'fulfilled'
    );
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === 'rejected'
    );

    // Exactly one acceptance succeeds, all others fail/reject -- and every
    // rejection is the clean, expected error, not a raw DB constraint
    // violation (which is what a broken/missing lock would produce, as
    // confirmed above).
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(CONCURRENCY - 1);
    for (const r of rejected) {
      expect(r.reason.message).toBe('Invalid or expired invitation');
    }
    expect(fulfilled[0].value).toEqual({ organizationId: orgId, role: 'member' });

    // Exactly one membership was created -- no duplicate/partial state, and
    // the pre-existing organization_memberships (organization_id, user_id)
    // UNIQUE constraint would itself have rejected a second INSERT even if
    // the row lock had somehow failed to serialize the two attempts.
    const membership = await pool.query(
      'SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [orgId, invitee.id]
    );
    expect(membership.rows).toHaveLength(1);

    // The invitation is accepted exactly once, attributed to the one
    // winning acceptance -- not left half-updated or double-updated.
    const invitationRow = await pool.query(
      `SELECT accepted_at, accepted_user_id FROM organization_invitations WHERE invitation_token = $1`,
      [invite.invitationToken]
    );
    expect(invitationRow.rows).toHaveLength(1);
    expect(invitationRow.rows[0].accepted_at).not.toBeNull();
    expect(invitationRow.rows[0].accepted_user_id).toBe(invitee.id);
  });

  it("rejects when the invitation's email does not match the accepting account's email", async () => {
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();

    const invite = await organizationService.inviteUser(orgId, {
      email: uniqueEmail('invited-address'),
      role: 'member',
      invitedBy: ownerId,
    });

    // A real, registered, unrelated user learns/guesses the token.
    const unrelatedUser = await insertUser({ full_name: 'Unrelated User' });

    await expect(
      organizationService.acceptInvitation(invite.invitationToken, unrelatedUser.id)
    ).rejects.toThrow('This invitation was sent to a different email address');

    const membership = await pool.query(
      'SELECT id FROM organization_memberships WHERE organization_id = $1 AND user_id = $2',
      [orgId, unrelatedUser.id]
    );
    expect(membership.rows).toHaveLength(0);
  });

  it('rejects an expired pending invitation', async () => {
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();
    const invitedEmail = uniqueEmail('expired-invitee');

    const invite = await organizationService.inviteUser(orgId, {
      email: invitedEmail,
      role: 'member',
      invitedBy: ownerId,
    });
    await pool.query(
      `UPDATE organization_invitations SET invitation_expires_at = NOW() - INTERVAL '1 hour'
       WHERE invitation_token = $1`,
      [invite.invitationToken]
    );

    const invitee = await insertUser({ email: invitedEmail, full_name: 'Expired Invitee' });

    await expect(
      organizationService.acceptInvitation(invite.invitationToken, invitee.id)
    ).rejects.toThrow('Invalid or expired invitation');
  });

  it('rejects if the accepting user is already a member of the target organization', async () => {
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();
    const invitedEmail = uniqueEmail('already-member');

    const invite = await organizationService.inviteUser(orgId, {
      email: invitedEmail,
      role: 'member',
      invitedBy: ownerId,
    });
    const invitee = await insertUser({ email: invitedEmail, full_name: 'Already Member Invitee' });

    // Already a member via some other path (e.g. added directly) before accepting.
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
       VALUES ($1, $2, 'viewer', NOW(), true)`,
      [orgId, invitee.id]
    );

    await expect(
      organizationService.acceptInvitation(invite.invitationToken, invitee.id)
    ).rejects.toThrow('User is already a member of this organization');
  });

  it('throws the generic invalid-invitation error for a token that exists in neither table', async () => {
    const someUser = await insertUser({ full_name: 'No Invitation User' });

    await expect(
      organizationService.acceptInvitation('totally-unknown-token', someUser.id)
    ).rejects.toThrow('Invalid or expired invitation');
  });
});

describe('OrganizationService.acceptInvitation() -> existing-user path (regression, unchanged)', () => {
  it('still accepts an organization_memberships invitation exactly as before', async () => {
    jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);
    const { orgId, ownerId } = await insertOrgWithOwner();
    const invitee = await insertUser({ full_name: 'Existing User Invitee' }); // already has an account

    const invite = await organizationService.inviteUser(orgId, {
      email: invitee.email,
      role: 'admin',
      invitedBy: ownerId,
    });

    const result = await organizationService.acceptInvitation(invite.invitationToken, invitee.id);

    expect(result).toEqual({ organizationId: orgId, role: 'admin' });

    const membership = await pool.query(
      `SELECT role, is_active, joined_at, invitation_token, invitation_expires_at
       FROM organization_memberships WHERE organization_id = $1 AND user_id = $2`,
      [orgId, invitee.id]
    );
    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0].role).toBe('admin');
    expect(membership.rows[0].is_active).toBe(true);
    expect(membership.rows[0].joined_at).not.toBeNull();
    expect(membership.rows[0].invitation_token).toBeNull();
    expect(membership.rows[0].invitation_expires_at).toBeNull();

    // No stray organization_invitations row should exist for the existing-user path.
    const pending = await pool.query(
      'SELECT id FROM organization_invitations WHERE organization_id = $1 AND lower(email) = lower($2)',
      [orgId, invitee.email]
    );
    expect(pending.rows).toHaveLength(0);
  });
});
