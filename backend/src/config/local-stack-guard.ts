/**
 * Fail-closed checks for the local development stack (`npm run dev:local`,
 * dev/local/). The stack is on only when DEVCONTROL_LOCAL_STACK=1; with the
 * flag unset nothing here runs and the backend behaves exactly as before.
 *
 * In local mode the backend must reach nothing but its own loopback Postgres:
 * no production database, no Stripe, email, Anthropic, Slack or AWS. Each
 * check names the variable that failed and never its value, so a refusal can
 * be pasted anywhere without leaking a secret.
 */

export const LOCAL_STACK_FLAG = 'DEVCONTROL_LOCAL_STACK';
export const LOCAL_STACK_FRONTEND_URL = 'http://localhost:3010';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_DB_NAME = /^devcontrol_local/;

/** Any variable with one of these prefixes enables an external integration. */
const FORBIDDEN_PREFIXES = ['STRIPE_', 'SMTP_', 'ANTHROPIC_'];
const FORBIDDEN_NAMES = [
  'RESEND_API_KEY',
  'SLACK_WEBHOOK_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
];

type Env = Record<string, string | undefined>;

export function isLocalStack(env: Env = process.env): boolean {
  return env[LOCAL_STACK_FLAG] === '1';
}

function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

/**
 * The first check the environment fails, as a one-line reason naming only
 * variables, or null when the local stack may start.
 */
export function localStackRefusal(env: Env): string | null {
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
 * Points the AWS SDK at nothing: no instance metadata, no shared config or
 * credentials files, and a closed loopback port as every service endpoint.
 * assumeRoleAsPlatform refuses before any client is built; this is the
 * second wall for anything that would bypass it.
 */
export function applyAwsBlackHole(env: Env): void {
  env.AWS_EC2_METADATA_DISABLED = 'true';
  env.AWS_ENDPOINT_URL = 'http://127.0.0.1:9';
  env.AWS_CONFIG_FILE = '/dev/null';
  env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
}

/**
 * The database role must be what production's `devcontrol` is: no superuser
 * and no BYPASSRLS, so row-level security applies to every query.
 */
export async function localDatabaseRoleRefusal(
  query: (sql: string) => Promise<{ rows: Array<{ rolsuper: boolean; rolbypassrls: boolean }> }>,
): Promise<string | null> {
  const { rows } = await query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  if (rows.length !== 1) return 'database role could not be inspected';
  if (rows[0].rolsuper) return 'DB_USER is a superuser';
  if (rows[0].rolbypassrls) return 'DB_USER has BYPASSRLS';
  return null;
}

export function refuseToStart(reason: string): never {
  console.error(`[local-stack] refusing to start: ${reason}`);
  process.exit(1);
}
