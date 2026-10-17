/**
 * One owner in one empty organization, created the way registration creates
 * them (auth.service.ts register) but already email-verified. The password is
 * generated here and written only to dev/local/.state/owner-login.txt; if
 * that file is lost, the next run issues a new password.
 */
const crypto = require('crypto');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { statePath, writeStateFile } = require('./state');

const OWNER_EMAIL = 'owner@example.test';
const OWNER_NAME = 'Local Owner';
const ORG_NAME = 'Example Local Org';
const ORG_SLUG = 'example-local-org';
const LOGIN_FILE = 'owner-login.txt';
// Same as auth.service.ts.
const BCRYPT_ROUNDS = 10;
// TIER_LIMITS.free in backend/src/middleware/subscription.middleware.ts.
const FREE_TIER = { maxServices: 5, maxUsers: 1, maxDeploymentsPerMonth: 10 };

function generatePassword() {
  return `local-${crypto.randomBytes(18).toString('base64url')}`;
}

/** Returns { created, passwordIssued, loginFile }. Never returns or logs the password. */
async function seedOwner(client) {
  const loginFile = statePath(LOGIN_FILE);
  const existing = await client.query('SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [OWNER_EMAIL]);
  if (existing.rows.length > 0 && fs.existsSync(loginFile)) {
    return { created: false, passwordIssued: false, loginFile };
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await client.query('BEGIN');
  try {
    if (existing.rows.length > 0) {
      await client.query(
        'UPDATE users SET password_hash = $2, failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
        [existing.rows[0].id, passwordHash],
      );
    } else {
      const { rows: [user] } = await client.query(
        `INSERT INTO users (email, password_hash, full_name, is_active, is_email_verified)
         VALUES ($1, $2, $3, true, true) RETURNING id`,
        [OWNER_EMAIL, passwordHash, OWNER_NAME],
      );
      const { rows: [org] } = await client.query(
        `INSERT INTO organizations (name, slug, display_name, description, subscription_tier,
                                    max_services, max_users, max_deployments_per_month)
         VALUES ($1, $2, $1, 'Local development organization', 'free', $3, $4, $5) RETURNING id`,
        [ORG_NAME, ORG_SLUG, FREE_TIER.maxServices, FREE_TIER.maxUsers, FREE_TIER.maxDeploymentsPerMonth],
      );
      await client.query(
        `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at)
         VALUES ($1, $2, 'owner', NOW())`,
        [org.id, user.id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  writeStateFile(LOGIN_FILE, `email=${OWNER_EMAIL}\npassword=${password}\n`);
  return { created: existing.rows.length === 0, passwordIssued: true, loginFile };
}

module.exports = { seedOwner, OWNER_EMAIL, LOGIN_FILE };
