/**
 * Fail-closed checks for dev/local/seed-icp.js. The seed deletes and rewrites
 * an organization, so it refuses unless every check passes. A refusal names
 * the check that failed and never a value.
 *
 * Before connecting:
 *   1. DEVCONTROL_LOCAL_STACK is exactly 1 in the real process environment;
 *   2. the environment the backend would run with passes the local-stack
 *      guard (localStackRefusal, ported from
 *      backend/src/config/local-stack-guard.ts; a parity test keeps the two
 *      the same);
 *   3. the connection is exactly 127.0.0.1:55432, database devcontrol_local.
 * After connecting, before any write:
 *   4. current_database() is devcontrol_local;
 *   5. the database carries the volume marker .state/db/volume.json recorded
 *      (dev/local/volume-credentials.js): this Postgres is this checkout's;
 *   6. no organization exists beyond the ones the local stack creates.
 */
const LOCAL_STACK_FLAG = 'DEVCONTROL_LOCAL_STACK';
const LOCAL_STACK_FRONTEND_URL = 'http://localhost:3010';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_DB_NAME = /^devcontrol_local/;
const FORBIDDEN_PREFIXES = ['STRIPE_', 'SMTP_', 'ANTHROPIC_'];
const FORBIDDEN_NAMES = [
  'RESEND_API_KEY',
  'SLACK_WEBHOOK_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
];

const SEED_CONNECTION = { host: '127.0.0.1', port: 55432, database: 'devcontrol_local' };

/**
 * Organizations the local stack itself creates: migrations-admin/005's
 * `default`, dev/local/seed-owner.js's empty organization and this seed's.
 */
const LOCAL_ORGANIZATION_SLUGS = ['default', 'example-local-org', 'example-saas'];

function isLoopbackUrl(value) {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

/** A line-for-line port of localStackRefusal() in backend/src/config/local-stack-guard.ts. */
function localStackRefusal(env) {
  if (env[LOCAL_STACK_FLAG] !== '1') return `${LOCAL_STACK_FLAG} must be exactly 1`;
  if (env.NODE_ENV === 'production') return 'NODE_ENV is production';
  if (!env.DB_HOST || !LOOPBACK_HOSTS.has(env.DB_HOST)) return 'DB_HOST is not a loopback host';
  if (!env.DB_NAME || !LOCAL_DB_NAME.test(env.DB_NAME)) return 'DB_NAME does not start with devcontrol_local';

  const forbidden = Object.keys(env)
    .filter((name) => FORBIDDEN_NAMES.includes(name) || FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix)))
    .filter((name) => env[name] !== undefined && env[name] !== '')
    .sort();
  if (forbidden.length > 0) return `${forbidden[0]} is set (external integrations are disabled locally)`;

  if (env.FRONTEND_URL !== LOCAL_STACK_FRONTEND_URL) return `FRONTEND_URL is not ${LOCAL_STACK_FRONTEND_URL}`;
  if (env.PROMETHEUS_URL && !isLoopbackUrl(env.PROMETHEUS_URL)) return 'PROMETHEUS_URL is not a loopback URL';
  return null;
}

/**
 * Checks 1-3. `processEnv` is the seed's own environment; `backendEnv` is
 * .state/backend.env. The backend loads that file with dotenv, which never
 * overrides a variable already set, so the process environment wins here too.
 */
function preConnectRefusal({ processEnv, backendEnv, connection }) {
  if (processEnv[LOCAL_STACK_FLAG] !== '1') return `check 1: ${LOCAL_STACK_FLAG} is not exactly 1 in the process environment`;

  const guard = localStackRefusal({ ...backendEnv, ...processEnv });
  if (guard) return `check 2: local-stack guard: ${guard}`;

  if (connection.host !== SEED_CONNECTION.host) return 'check 3: connection host is not 127.0.0.1';
  if (connection.port !== SEED_CONNECTION.port) return 'check 3: connection port is not 55432';
  if (connection.database !== SEED_CONNECTION.database) return 'check 3: connection database is not devcontrol_local';
  return null;
}

/** Checks 4-6, on a connected client. `recordedMarker` is .state/db/volume.json's. */
async function postConnectRefusal({ client, recordedMarker, markerQuery, parseMarkerComment }) {
  const { rows: [db] } = await client.query('SELECT current_database() AS name');
  if (!db || db.name !== SEED_CONNECTION.database) return 'check 4: current_database() is not devcontrol_local';

  const { rows: [comment] } = await client.query(markerQuery);
  const marker = parseMarkerComment(comment ? Object.values(comment)[0] : null);
  if (!marker || !recordedMarker || marker !== recordedMarker) {
    return 'check 5: the database does not carry the volume marker recorded in .state/db/volume.json';
  }

  const { rows } = await client.query(
    'SELECT count(*)::int AS foreign FROM organizations WHERE slug <> ALL($1::text[])',
    [LOCAL_ORGANIZATION_SLUGS],
  );
  if (rows[0].foreign !== 0) return 'check 6: the database holds organizations the local stack did not create';
  return null;
}

module.exports = {
  SEED_CONNECTION,
  LOCAL_ORGANIZATION_SLUGS,
  localStackRefusal,
  preConnectRefusal,
  postConnectRefusal,
};
