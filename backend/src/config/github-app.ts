/**
 * GitHub App configuration (D8a). Names only here; values come from
 * backend/.env on the host, copied there by the founder from SSM SecureString
 * parameters (d8a-build.md D8-N3). Nothing reads SSM at runtime.
 *
 * The feature is on only when GITHUB_APP_ENABLED is "true" AND every required
 * value is present and well-formed (D8-N14). Otherwise every GitHub App route
 * answers "not configured" and touches no table. Read per call, never at
 * module load, so a restart with new values is all a rotation needs.
 *
 * Never log a value from here. Error and warning text names variables only.
 */
const GITHUB_APP_ENABLED_ENV = 'GITHUB_APP_ENABLED';

export const GITHUB_APP_REQUIRED_ENV = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_APP_CLIENT_ID',
  'GITHUB_APP_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_APP_WEBHOOK_SECRET',
] as const;

/**
 * The App's registered Callback URL (GitHub App settings; d8b-step-a.md Q1).
 * The reconnect's authorize URL names it as redirect_uri, exactly: GitHub
 * only redirects to a registered callback URL (I3 Stage A §3, founder D1).
 * Never built from a request or an environment value.
 */
export const GITHUB_APP_CALLBACK_URL = 'https://getdevcontrol.com/auth/github/callback';

export interface GitHubAppConfig {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  /** PEM. A value with literal "\n" sequences (one-line .env) is unescaped. */
  privateKey: string;
  /** Current secret first, then the previous one if set. */
  webhookSecrets: string[];
}

export type GitHubAppConfigResult =
  | { enabled: true; config: GitHubAppConfig }
  | { enabled: false; reason: 'disabled' | 'incomplete'; problems: string[] };

const APP_ID = /^[1-9][0-9]{0,18}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const CLIENT_ID = /^[A-Za-z0-9._-]{1,100}$/;
const MIN_SECRET_LENGTH = 20;

export function readGitHubAppConfig(env: NodeJS.ProcessEnv = process.env): GitHubAppConfigResult {
  if (env[GITHUB_APP_ENABLED_ENV] !== 'true') {
    return { enabled: false, reason: 'disabled', problems: [] };
  }
  const problems: string[] = [];
  const value = (name: string) => (env[name] ?? '').trim();
  for (const name of GITHUB_APP_REQUIRED_ENV) {
    if (!value(name)) problems.push(`${name} is not set`);
  }
  if (value('GITHUB_APP_ID') && !APP_ID.test(value('GITHUB_APP_ID'))) problems.push('GITHUB_APP_ID must be the numeric App ID');
  if (value('GITHUB_APP_SLUG') && !SLUG.test(value('GITHUB_APP_SLUG'))) problems.push('GITHUB_APP_SLUG must be the App slug (a-z, 0-9, -)');
  if (value('GITHUB_APP_CLIENT_ID') && !CLIENT_ID.test(value('GITHUB_APP_CLIENT_ID'))) problems.push('GITHUB_APP_CLIENT_ID is malformed');
  const privateKey = value('GITHUB_APP_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (privateKey && !/^-----BEGIN (RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (RSA )?PRIVATE KEY-----$/.test(privateKey)) {
    problems.push('GITHUB_APP_PRIVATE_KEY must be the PEM private key');
  }
  for (const name of ['GITHUB_APP_WEBHOOK_SECRET', 'GITHUB_APP_WEBHOOK_SECRET_PREVIOUS']) {
    if (value(name) && value(name).length < MIN_SECRET_LENGTH) problems.push(`${name} must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  if (problems.length > 0) return { enabled: false, reason: 'incomplete', problems };
  const webhookSecrets = [value('GITHUB_APP_WEBHOOK_SECRET')];
  if (value('GITHUB_APP_WEBHOOK_SECRET_PREVIOUS')) webhookSecrets.push(value('GITHUB_APP_WEBHOOK_SECRET_PREVIOUS'));
  return {
    enabled: true,
    config: {
      appId: value('GITHUB_APP_ID'),
      slug: value('GITHUB_APP_SLUG'),
      clientId: value('GITHUB_APP_CLIENT_ID'),
      clientSecret: value('GITHUB_APP_CLIENT_SECRET'),
      privateKey,
      webhookSecrets,
    },
  };
}

/**
 * For validateEnv: a warning listing variable names only, or null. Never
 * throws: a half-configured App must not stop the server (D8-N14).
 */
export function gitHubAppConfigWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  const result = readGitHubAppConfig(env);
  if (result.enabled || result.reason === 'disabled') return null;
  return `GitHub App is enabled (${GITHUB_APP_ENABLED_ENV}=true) but its configuration is incomplete, so it stays off: ${result.problems.join('; ')}`;
}
