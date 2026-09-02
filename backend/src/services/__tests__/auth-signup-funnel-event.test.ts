/**
 * Focused coverage for the signup_completed funnel event added to
 * AuthService.register(). Real Postgres, no mocks on register() itself --
 * proves the event only appears after a genuinely successful registration,
 * never on a rejected/partial one.
 */
import { authService } from '../auth.service';
import { pool } from '../../config/database';

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function fetchSignupEvents(organizationId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM analytics_events WHERE organization_id = $1 AND event_name = 'signup_completed'`,
    [organizationId]
  );
  return rows;
}

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM organization_memberships WHERE user_id = ANY($1)', [createdUserIds]);
  }
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
});

describe('AuthService.register() -> signup_completed funnel event', () => {
  it('a successful registration emits signup_completed exactly once, after commit', async () => {
    const suffix = uniqueSuffix();
    const email = `signup-funnel-${suffix}@example.com`;

    const result = await authService.register({
      email,
      password: 'a-very-strong-password-123',
      fullName: 'Signup Funnel Test',
    });

    createdOrgIds.push(result.organization.id);
    createdUserIds.push(result.user.id);

    const rows = await fetchSignupEvents(result.organization.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(result.user.id);
    expect(rows[0].event_category).toBe('funnel');
    expect(rows[0].properties).toEqual({ tier: 'free' });
  });

  it('a rejected registration (duplicate email) never reaches the transaction, so no event is emitted', async () => {
    const suffix = uniqueSuffix();
    const email = `signup-funnel-dup-${suffix}@example.com`;

    const first = await authService.register({
      email,
      password: 'a-very-strong-password-123',
      fullName: 'First Registration',
    });
    createdOrgIds.push(first.organization.id);
    createdUserIds.push(first.user.id);

    await expect(
      authService.register({
        email,
        password: 'another-strong-password-456',
        fullName: 'Duplicate Attempt',
      })
    ).rejects.toThrow('Email already registered');

    // Only the first, genuinely successful registration's event exists --
    // the rejected duplicate attempt created no organization and emitted
    // nothing.
    const rows = await fetchSignupEvents(first.organization.id);
    expect(rows).toHaveLength(1);

    const { rows: orgCountRows } = await pool.query(
      `SELECT count(*) FROM organizations WHERE id != $1 AND name = 'Duplicate Attempt''s Workspace'`,
      [first.organization.id]
    );
    expect(Number(orgCountRows[0].count)).toBe(0);
  });
});
