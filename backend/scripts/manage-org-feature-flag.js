#!/usr/bin/env node
/**
 * Platform-staff switch for one organization's feature flag (multi-region PR 1):
 * the ONLY way multi_region_discovery is turned on or off. Not an HTTP
 * endpoint: it needs direct database access as the table's owner, the trust
 * boundary organization_feature_flags was built for (its migration grants the
 * application SELECT only: database/migrations-admin/
 * 202610191200_create_multi_region_scan_foundation.sql).
 *
 * Lives under backend/scripts/, not database/, for the same reason as
 * manage-platform-staff.js: the migration-deploy artifact must hold only
 * migrate.js and migrations/.
 *
 * Usage:
 *   node backend/scripts/manage-org-feature-flag.js <organization-id> status [--flag <flag>]
 *   node backend/scripts/manage-org-feature-flag.js <organization-id> on|off [--flag <flag>] [--by <staff>] [--note <text>] [--apply]
 *
 *   --flag   default multi_region_discovery; only the flags in ALLOWED_FLAGS.
 *   --apply  without it nothing is written: the run prints the row as it is and
 *            what --apply would change (dry run).
 *
 * Idempotent: turning a flag to the state it already has writes nothing and says
 * so. "off" keeps the row (enabled = false) so who changed it, and when, stays.
 * Prints the organization id, flag, enabled, set_by, set_at and note, before and
 * after: never a credential, never anything else from the database.
 *
 * The table forces row-level security keyed by app.current_organization_id, so
 * every statement runs in one transaction that sets it for that organization.
 *
 * Environment Variables (same as database/migrate.js): DB_HOST, DB_PORT, DB_NAME,
 * DB_USER, DB_PASSWORD. Run as the table's owner.
 */

// A CommonJS script run with plain node (as manage-platform-staff.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg');

const ALLOWED_FLAGS = ['multi_region_discovery'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getClient() {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
}

/** The parsed command line, or { error }. */
function parseArgs(argv) {
  const [organizationId, command, ...rest] = argv;
  const options = { flag: ALLOWED_FLAGS[0], by: null, note: null, apply: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--flag' || arg === '--by' || arg === '--note') {
      const value = rest[++i];
      if (value === undefined) return { error: `${arg} needs a value` };
      options[arg.slice(2)] = value;
    } else return { error: `Unknown argument ${arg}` };
  }
  if (!organizationId || !UUID.test(organizationId)) return { error: 'The first argument must be an organization id (a UUID).' };
  if (!['status', 'on', 'off'].includes(command)) return { error: 'The command must be status, on or off.' };
  if (!ALLOWED_FLAGS.includes(options.flag)) return { error: `Unknown flag ${options.flag}. Allowed: ${ALLOWED_FLAGS.join(', ')}.` };
  if (command === 'status' && (options.apply || options.by || options.note)) return { error: 'status takes no --apply, --by or --note.' };
  return { organizationId, command, ...options };
}

function describe(row) {
  if (!row) return 'no row (OFF)';
  return `enabled=${row.enabled}, set_by=${row.set_by ?? 'null'}, set_at=${row.set_at.toISOString()}, note=${row.note === null ? 'null' : JSON.stringify(row.note)}`;
}

async function readFlag(client, organizationId, flag) {
  const { rows } = await client.query(
    'SELECT enabled, set_by, set_at, note FROM organization_feature_flags WHERE organization_id = $1 AND flag = $2',
    [organizationId, flag]
  );
  return rows[0] || null;
}

/**
 * Runs one command on `client` (connected). Returns the exit code; prints with `log`.
 * Exported so the test drives it against a test database.
 */
async function run(argv, { client, log = console.log, error = console.error }) {
  const args = parseArgs(argv);
  if (args.error) {
    error(`✗ ${args.error}`);
    error('Usage: node backend/scripts/manage-org-feature-flag.js <organization-id> status|on|off [--flag <flag>] [--by <staff>] [--note <text>] [--apply]');
    return 1;
  }
  const { organizationId, command, flag } = args;

  await client.query('BEGIN');
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const org = await client.query('SELECT id FROM organizations WHERE id = $1', [organizationId]);
    if (org.rows.length === 0) {
      await client.query('ROLLBACK');
      error(`✗ No organization with id ${organizationId}.`);
      return 1;
    }

    const before = await readFlag(client, organizationId, flag);
    log(`Organization ${organizationId}, flag ${flag}`);
    log(`  before: ${describe(before)}`);

    if (command === 'status') {
      await client.query('ROLLBACK');
      return 0;
    }

    const wanted = command === 'on';
    // No row is OFF.
    if ((before?.enabled === true) === wanted) {
      await client.query('ROLLBACK');
      log(`  no change: the flag is already ${wanted ? 'ON' : 'OFF'}; nothing written.`);
      return 0;
    }

    if (!args.apply) {
      await client.query('ROLLBACK');
      log(`  dry run: --apply would set enabled=${wanted}, set_by=${args.by ?? 'null'}, note=${args.note === null ? 'null' : JSON.stringify(args.note)}. Nothing written.`);
      return 0;
    }

    await client.query(
      `INSERT INTO organization_feature_flags (organization_id, flag, enabled, set_by, set_at, note)
       VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (organization_id, flag) DO UPDATE
         SET enabled = EXCLUDED.enabled, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at, note = EXCLUDED.note`,
      [organizationId, flag, wanted, args.by, args.note]
    );
    const after = await readFlag(client, organizationId, flag);
    await client.query('COMMIT');
    log(`  after:  ${describe(after)}`);
    return 0;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    error(`✗ ${command} failed: ${err.message}`);
    return 1;
  }
}

async function main() {
  const client = getClient();
  await client.connect();
  try {
    process.exitCode = await run(process.argv.slice(2), { client });
  } finally {
    await client.end();
  }
}

if (require.main === module) main();

module.exports = { run, parseArgs, ALLOWED_FLAGS };
