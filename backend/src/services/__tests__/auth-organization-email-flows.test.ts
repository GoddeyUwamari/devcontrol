/**
 * Live-Postgres coverage for the three email TODOs wired to EmailService:
 * AuthService.register() (verification), AuthService.requestPasswordReset(),
 * and OrganizationService.inviteUser() (invitation). Runs against the actual
 * local dev Postgres instance -- same rationale as resourceReconciliation.
 * service.test.ts and custom-anomaly-rules.service.test.ts: the token
 * generation/persistence/expiry semantics these flows depend on are exactly
 * what a mocked pg client would silently get wrong.
 *
 * The only thing mocked is emailService's public methods (jest.spyOn on the
 * real, shared singleton) -- the actual network boundary (Resend) is never
 * exercised here; that's covered in isolation by email.service.test.ts.
 * Spying on the singleton (rather than jest.mock('../email.service')) means
 * authService/organizationService's own import of emailService is the exact
 * same object being asserted against.
 *
 * Disposable users/organizations created per test, tracked and deleted in
 * afterAll (organization_memberships/sessions cascade via FK, but are also
 * deleted explicitly first since organization_memberships.invited_by is
 * NO ACTION, not CASCADE, on users).
 */

import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { authService } from '../auth.service';
import { organizationService } from '../organization.service';
import { emailService } from '../email.service';

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
  const passwordHash = await bcrypt.hash('Sup3rSecret!1', 4); // low rounds: fixture only, never a real login path
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, $2, $3) RETURNING id`,
    [email, passwordHash, fullName]
  );
  createdUserIds.push(rows[0].id);
  return { id: rows[0].id as string, email };
}

async function insertOrg(overrides: { max_users?: number } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, max_services, max_users)
     VALUES ($1, $2, $3, 'free', 10, $4) RETURNING id`,
    [`Fixture Org ${suffix}`, `fixture-org-${suffix}`, `Fixture Org Display ${suffix}`, overrides.max_users ?? 5]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertMembership(organizationId: string, userId: string, role: string) {
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [organizationId, userId, role]
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
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

describe('AuthService.register() -> verification email', () => {
  it('sends the actually-persisted verification token to emailService, outside the transaction', async () => {
    const sendVerificationSpy = jest
      .spyOn(emailService, 'sendVerificationEmail')
      .mockResolvedValue(true);

    const email = uniqueEmail('verify-flow');
    const result = await authService.register({
      email,
      password: 'Sup3rSecret!1',
      fullName: 'Flow Test User',
    });
    createdUserIds.push(result.user.id);
    createdOrgIds.push(result.organization.id);

    expect(sendVerificationSpy).toHaveBeenCalledTimes(1);
    const callArgs = sendVerificationSpy.mock.calls[0][0];
    expect(callArgs.to).toBe(email);
    expect(callArgs.fullName).toBe('Flow Test User');

    const { rows } = await pool.query(
      'SELECT email_verification_token, email_verification_expires_at FROM users WHERE id = $1',
      [result.user.id]
    );
    expect(rows[0].email_verification_token).toBe(callArgs.verificationToken);
    expect(rows[0].email_verification_token).toMatch(/^[0-9a-f]{64}$/);

    const expiryMs = new Date(rows[0].email_verification_expires_at).getTime() - Date.now();
    expect(expiryMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(expiryMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it('still returns a successful registration even if emailService reports failure', async () => {
    jest.spyOn(emailService, 'sendVerificationEmail').mockResolvedValue(false);

    const email = uniqueEmail('verify-flow-fail');
    const result = await authService.register({
      email,
      password: 'Sup3rSecret!1',
      fullName: 'Flow Test User 2',
    });
    createdUserIds.push(result.user.id);
    createdOrgIds.push(result.organization.id);

    expect(result.accessToken).toBeTruthy();
    expect(result.user.email).toBe(email.toLowerCase());
  });
});

describe('AuthService.requestPasswordReset() -> password reset email', () => {
  const GENERIC_RESPONSE = 'If the email exists, a password reset link has been sent.';

  it('sends the actually-persisted reset token and preserves the generic response', async () => {
    const sendResetSpy = jest.spyOn(emailService, 'sendPasswordResetEmail').mockResolvedValue(true);

    const user = await insertUser({ full_name: 'Reset Flow User' });
    const message = await authService.requestPasswordReset(user.email);

    expect(message).toBe(GENERIC_RESPONSE);
    expect(sendResetSpy).toHaveBeenCalledTimes(1);
    const callArgs = sendResetSpy.mock.calls[0][0];
    expect(callArgs.to).toBe(user.email);

    const { rows } = await pool.query(
      'SELECT password_reset_token, password_reset_expires_at FROM users WHERE id = $1',
      [user.id]
    );
    expect(rows[0].password_reset_token).toBe(callArgs.resetToken);
    expect(rows[0].password_reset_token).toMatch(/^[0-9a-f]{64}$/);

    const expiryMs = new Date(rows[0].password_reset_expires_at).getTime() - Date.now();
    expect(expiryMs).toBeGreaterThan(0);
    expect(expiryMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('returns the identical generic response and never calls emailService for a non-existent account', async () => {
    const sendResetSpy = jest.spyOn(emailService, 'sendPasswordResetEmail').mockResolvedValue(true);

    const message = await authService.requestPasswordReset(uniqueEmail('does-not-exist'));

    expect(message).toBe(GENERIC_RESPONSE);
    expect(sendResetSpy).not.toHaveBeenCalled();
  });

  it('returns the identical generic response even when email delivery fails (enumeration-safety under failure)', async () => {
    const sendResetSpy = jest.spyOn(emailService, 'sendPasswordResetEmail').mockResolvedValue(false);

    const user = await insertUser({ full_name: 'Reset Flow Fail User' });
    const message = await authService.requestPasswordReset(user.email);

    expect(message).toBe(GENERIC_RESPONSE);
    expect(sendResetSpy).toHaveBeenCalledTimes(1);
  });
});

describe('OrganizationService.inviteUser() -> invitation email', () => {
  it('existing-user branch: persists the token, sends the invitation email with the matching token', async () => {
    const sendInviteSpy = jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);

    const orgId = await insertOrg();
    const owner = await insertUser({ full_name: 'Org Owner' });
    await insertMembership(orgId, owner.id, 'owner');
    const invitee = await insertUser({ full_name: 'Invitee' }); // exists in users, not yet a member

    const result = await organizationService.inviteUser(orgId, {
      email: invitee.email,
      role: 'member',
      invitedBy: owner.id,
    });

    expect(sendInviteSpy).toHaveBeenCalledTimes(1);
    const callArgs = sendInviteSpy.mock.calls[0][0];
    expect(callArgs.to).toBe(invitee.email);
    expect(callArgs.role).toBe('member');
    expect(callArgs.invitationToken).toBe(result.invitationToken);

    const { rows } = await pool.query(
      `SELECT invitation_token, invitation_expires_at FROM organization_memberships
       WHERE organization_id = $1 AND user_id = $2`,
      [orgId, invitee.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].invitation_token).toBe(result.invitationToken);

    const expiryMs = new Date(rows[0].invitation_expires_at).getTime() - Date.now();
    expect(expiryMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(expiryMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });

  it('non-existent-user branch: does NOT send an invitation email, because no token is persisted for that branch', async () => {
    const sendInviteSpy = jest.spyOn(emailService, 'sendInvitationEmail').mockResolvedValue(true);

    const orgId = await insertOrg();
    const owner = await insertUser({ full_name: 'Org Owner 2' });
    await insertMembership(orgId, owner.id, 'owner');

    const newEmail = uniqueEmail('brand-new-invitee');
    const result = await organizationService.inviteUser(orgId, {
      email: newEmail,
      role: 'viewer',
      invitedBy: owner.id,
    });

    expect(result.invitationToken).toBeTruthy();
    expect(sendInviteSpy).not.toHaveBeenCalled();

    // Confirms this really is the known, pre-existing persistence gap (not
    // solved by this change): nothing in the database references this token,
    // so sending an email for it would have handed out a dead link.
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM organization_memberships
       WHERE organization_id = $1 AND invitation_token = $2`,
      [orgId, result.invitationToken]
    );
    expect(rows[0].count).toBe(0);
  });
});
