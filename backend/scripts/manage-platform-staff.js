#!/usr/bin/env node
/**
 * Platform-staff provisioning -- the ONLY way to grant or revoke a
 * platform_staff row (backend/src/middleware/platformAuth.middleware.ts's
 * requirePlatformStaff checks that table). Deliberately NOT an HTTP
 * endpoint: running this requires direct database connectivity and
 * credentials (the same env vars database/migrate.js already uses), which
 * is exactly the trust boundary this needs -- no customer request path can
 * reach it, and no code anywhere in the application grants platform_staff
 * rows.
 *
 * Deliberately lives under backend/scripts/, NOT database/: the CI
 * "Package migration artifact" step (.github/workflows/ci.yml,
 * deploy-migration-tooling) tars up the entire database/ directory (minus
 * seeds/ and migrations-admin/) as the production migration-deploy
 * artifact, and migrate-deploy.test.ts asserts that artifact contains only
 * migrate.js + migrations/**. Putting an unrelated ops script in database/
 * would silently ship it inside that artifact and break that guarantee --
 * confirmed by actually running that test against this file at its
 * original location before moving it here.
 *
 * Usage:
 *   node backend/scripts/manage-platform-staff.js grant <email> [--by <granter-email>]
 *   node backend/scripts/manage-platform-staff.js revoke <email>
 *   node backend/scripts/manage-platform-staff.js status <email>
 *
 * This script:
 *   - never creates a user -- `grant`/`revoke`/`status` all require the
 *     email to already belong to an existing, real users row (from the
 *     normal signup/login flow) and fail clearly otherwise.
 *   - never accepts an organization role as proof of authority -- there is
 *     no flag or code path here that reads organization_memberships at all.
 *   - uses parameterized SQL exclusively (no string-built queries).
 *   - never prints a password hash, DB credential, or any value from a
 *     users column other than id/email.
 *
 * Environment Variables (same as database/migrate.js):
 * - DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
 */

const { Client } = require('pg');

function getClient() {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
}

async function findUserByEmail(client, email) {
  const { rows } = await client.query(
    'SELECT id, email FROM users WHERE email = $1',
    [email]
  );
  return rows[0] || null;
}

async function grant(client, email, grantedByEmail) {
  const user = await findUserByEmail(client, email);
  if (!user) {
    console.error(`✗ No existing user with email ${email} -- refusing to create one. Grant requires a real, already-registered account.`);
    process.exitCode = 1;
    return;
  }

  let grantedById = null;
  if (grantedByEmail) {
    const granter = await findUserByEmail(client, grantedByEmail);
    if (!granter) {
      console.error(`✗ --by email ${grantedByEmail} does not match an existing user -- refusing to record an unverifiable grantor.`);
      process.exitCode = 1;
      return;
    }
    grantedById = granter.id;
  }

  const { rows } = await client.query(
    `INSERT INTO platform_staff (user_id, added_by, status, added_at, revoked_at)
     VALUES ($1, $2, 'active', NOW(), NULL)
     ON CONFLICT (user_id) DO UPDATE
       SET status = 'active', added_by = $2, added_at = NOW(), revoked_at = NULL, updated_at = NOW()
     RETURNING added_at`,
    [user.id, grantedById]
  );

  console.log(`✓ Granted platform-staff access to ${user.email} (user_id ${user.id}) at ${rows[0].added_at.toISOString()}${grantedByEmail ? ` by ${grantedByEmail}` : ''}`);
}

async function revoke(client, email) {
  const user = await findUserByEmail(client, email);
  if (!user) {
    console.error(`✗ No existing user with email ${email}.`);
    process.exitCode = 1;
    return;
  }

  const { rows } = await client.query(
    `UPDATE platform_staff
     SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
     WHERE user_id = $1
     RETURNING revoked_at`,
    [user.id]
  );

  if (rows.length === 0) {
    console.log(`- ${user.email} (user_id ${user.id}) has no platform_staff record -- nothing to revoke.`);
    return;
  }

  console.log(`✓ Revoked platform-staff access for ${user.email} (user_id ${user.id}) at ${rows[0].revoked_at.toISOString()}. Takes effect immediately -- no JWT regeneration required.`);
}

async function status(client, email) {
  const user = await findUserByEmail(client, email);
  if (!user) {
    console.error(`✗ No existing user with email ${email}.`);
    process.exitCode = 1;
    return;
  }

  const { rows } = await client.query(
    `SELECT role, status, added_at, revoked_at FROM platform_staff WHERE user_id = $1`,
    [user.id]
  );

  if (rows.length === 0) {
    console.log(`${user.email} (user_id ${user.id}): not platform staff.`);
    return;
  }

  const row = rows[0];
  console.log(
    `${user.email} (user_id ${user.id}): role=${row.role}, status=${row.status}, ` +
    `added_at=${row.added_at.toISOString()}, revoked_at=${row.revoked_at ? row.revoked_at.toISOString() : 'null'}`
  );
}

async function main() {
  const [, , command, email, flag, flagValue] = process.argv;

  if (!command || !email || !['grant', 'revoke', 'status'].includes(command)) {
    console.error('Usage: node backend/scripts/manage-platform-staff.js <grant|revoke|status> <email> [--by <granter-email>]');
    process.exitCode = 1;
    return;
  }

  const grantedByEmail = command === 'grant' && flag === '--by' ? flagValue : undefined;
  if (command === 'grant' && flag && flag !== '--by') {
    console.error(`Unknown flag ${flag}. Only --by <granter-email> is supported for grant.`);
    process.exitCode = 1;
    return;
  }

  const client = getClient();
  await client.connect();
  try {
    if (command === 'grant') await grant(client, email, grantedByEmail);
    else if (command === 'revoke') await revoke(client, email);
    else await status(client, email);
  } catch (error) {
    console.error(`✗ ${command} failed:`, error.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
