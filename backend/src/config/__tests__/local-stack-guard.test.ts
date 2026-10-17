/**
 * The local stack's fail-closed checks (local-stack-guard.ts): each refusal
 * is one line naming the failed check and never the value that failed it.
 */
import {
  applyAwsBlackHole,
  isLocalStack,
  localDatabaseRoleRefusal,
  localStackRefusal,
  LOCAL_STACK_FRONTEND_URL,
} from '../local-stack-guard';

const SECRET = 'sk_test_FAKE_value_that_must_never_be_printed';

function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    DEVCONTROL_LOCAL_STACK: '1',
    NODE_ENV: 'development',
    DB_HOST: '127.0.0.1',
    DB_NAME: 'devcontrol_local',
    FRONTEND_URL: LOCAL_STACK_FRONTEND_URL,
    ...overrides,
  };
}

describe('isLocalStack', () => {
  it('is on only for exactly DEVCONTROL_LOCAL_STACK=1', () => {
    expect(isLocalStack({})).toBe(false);
    expect(isLocalStack({ DEVCONTROL_LOCAL_STACK: '' })).toBe(false);
    expect(isLocalStack({ DEVCONTROL_LOCAL_STACK: 'true' })).toBe(false);
    expect(isLocalStack({ DEVCONTROL_LOCAL_STACK: '1' })).toBe(true);
  });
});

describe('localStackRefusal', () => {
  it('accepts the environment dev/local/run.js writes', () => {
    expect(localStackRefusal(validEnv())).toBeNull();
    expect(localStackRefusal(validEnv({ DB_HOST: 'localhost', DB_NAME: 'devcontrol_local_test' }))).toBeNull();
    expect(localStackRefusal(validEnv({ PROMETHEUS_URL: 'http://localhost:9090' }))).toBeNull();
    // Present but empty means disabled, as everywhere else in the backend.
    expect(localStackRefusal(validEnv({ STRIPE_SECRET_KEY: '', ANTHROPIC_API_KEY: '' }))).toBeNull();
  });

  it.each([
    [{ DEVCONTROL_LOCAL_STACK: 'true' }, 'DEVCONTROL_LOCAL_STACK must be exactly 1'],
    [{ NODE_ENV: 'production' }, 'NODE_ENV is production'],
    [{ DB_HOST: undefined }, 'DB_HOST is not a loopback host'],
    [{ DB_HOST: 'db.example.test' }, 'DB_HOST is not a loopback host'],
    [{ DB_HOST: '10.0.0.5' }, 'DB_HOST is not a loopback host'],
    [{ DB_NAME: 'platform_portal' }, 'DB_NAME does not start with devcontrol_local'],
    [{ DB_NAME: 'prod_devcontrol_local' }, 'DB_NAME does not start with devcontrol_local'],
    [{ FRONTEND_URL: undefined }, 'FRONTEND_URL is not http://localhost:3010'],
    [{ FRONTEND_URL: 'https://app.example.test' }, 'FRONTEND_URL is not http://localhost:3010'],
    [{ PROMETHEUS_URL: 'http://prometheus.example.test:9090' }, 'PROMETHEUS_URL is not a loopback URL'],
  ])('refuses %j', (overrides, reason) => {
    expect(localStackRefusal(validEnv(overrides))).toBe(reason);
  });

  it.each([
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_PRO_MONTHLY',
    'SMTP_HOST',
    'SMTP_PASS',
    'ANTHROPIC_API_KEY',
    'RESEND_API_KEY',
    'SLACK_WEBHOOK_URL',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'AWS_PROFILE',
  ])('refuses when %s is set, naming the variable and never its value', (name) => {
    const reason = localStackRefusal(validEnv({ [name]: SECRET }));
    expect(reason).toBe(`${name} is set (external integrations are disabled locally)`);
    expect(reason).not.toContain(SECRET);
  });

  it('no refusal contains any value from the environment', () => {
    const cases = [
      { DB_HOST: SECRET },
      { DB_NAME: SECRET },
      { FRONTEND_URL: SECRET },
      { PROMETHEUS_URL: `http://${SECRET}.example.test` },
      { DEVCONTROL_LOCAL_STACK: SECRET },
    ];
    for (const overrides of cases) {
      const reason = localStackRefusal(validEnv(overrides));
      expect(reason).not.toBeNull();
      expect(reason).not.toContain(SECRET);
      expect(reason).not.toContain('\n');
    }
  });
});

describe('applyAwsBlackHole', () => {
  it('switches off instance metadata and shared files and points every endpoint at a closed loopback port', () => {
    const env: Record<string, string | undefined> = {};
    applyAwsBlackHole(env);
    expect(env).toEqual({
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_ENDPOINT_URL: 'http://127.0.0.1:9',
      AWS_CONFIG_FILE: '/dev/null',
      AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    });
  });
});

describe('localDatabaseRoleRefusal', () => {
  const role = (rolsuper: boolean, rolbypassrls: boolean) => async () => ({ rows: [{ rolsuper, rolbypassrls }] });

  it('accepts a role row-level security applies to', async () => {
    await expect(localDatabaseRoleRefusal(role(false, false))).resolves.toBeNull();
  });

  it('refuses a superuser or a BYPASSRLS role', async () => {
    await expect(localDatabaseRoleRefusal(role(true, false))).resolves.toBe('DB_USER is a superuser');
    await expect(localDatabaseRoleRefusal(role(false, true))).resolves.toBe('DB_USER has BYPASSRLS');
    await expect(localDatabaseRoleRefusal(async () => ({ rows: [] }))).resolves.toBe('database role could not be inspected');
  });
});
