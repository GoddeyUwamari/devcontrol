/**
 * local-stack-preload.ts is server.ts's first import. With the flag unset it
 * must do nothing at all; with it set, it loads the local file, refuses with
 * one line on a failed check, and otherwise blacks out AWS.
 */
import fs from 'fs';
import path from 'path';

const FLAG = 'DEVCONTROL_LOCAL_STACK';

class Exit extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

let snapshot: NodeJS.ProcessEnv;
let exit: jest.SpyInstance;
let consoleError: jest.SpyInstance;
let consoleLog: jest.SpyInstance;

beforeEach(() => {
  snapshot = { ...process.env };
  exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Exit(code); }) as never);
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env = snapshot;
  jest.restoreAllMocks();
  jest.resetModules();
  jest.dontMock('dotenv');
});

function importPreload(config: jest.Mock = jest.fn()) {
  jest.doMock('dotenv', () => ({ __esModule: true, default: { config } }));
  let thrown: unknown;
  jest.isolateModules(() => {
    try {
      require('../local-stack-preload');
    } catch (err) {
      thrown = err;
    }
  });
  return { config, thrown };
}

it('flag unset: no dotenv call, no environment change, no output, no exit', () => {
  delete process.env[FLAG];
  const before = { ...process.env };
  const { config, thrown } = importPreload();
  expect(thrown).toBeUndefined();
  expect(config).not.toHaveBeenCalled();
  expect(process.env).toEqual(before);
  expect(exit).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
  expect(consoleLog).not.toHaveBeenCalled();
});

describe('flag set', () => {
  const secret = 'sk_test_FAKE_value_that_must_never_be_printed';

  function localEnv(overrides: Record<string, string> = {}) {
    process.env[FLAG] = '1';
    Object.assign(process.env, {
      NODE_ENV: 'development',
      DB_HOST: '127.0.0.1',
      DB_NAME: 'devcontrol_local',
      FRONTEND_URL: 'http://localhost:3010',
      ...overrides,
    });
    for (const name of Object.keys(process.env)) {
      if (/^(STRIPE_|SMTP_|ANTHROPIC_)/.test(name) || ['RESEND_API_KEY', 'SLACK_WEBHOOK_URL', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_PROFILE'].includes(name)) {
        if (!(name in overrides)) delete process.env[name];
      }
    }
    delete process.env.PROMETHEUS_URL;
  }

  beforeEach(() => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(true);
  });

  it('refuses with one line naming the check, exit 1, and never prints the value', () => {
    localEnv({ STRIPE_SECRET_KEY: secret });
    const { thrown } = importPreload();
    expect(thrown).toEqual(new Exit(1));
    expect(consoleError).toHaveBeenCalledTimes(1);
    const line = String(consoleError.mock.calls[0][0]);
    expect(line).toBe('[local-stack] refusing to start: STRIPE_SECRET_KEY is set (external integrations are disabled locally)');
    expect(line).not.toContain(secret);
  });

  it('refuses when the local env file is missing, before reading anything', () => {
    localEnv();
    (fs.existsSync as unknown as jest.Mock).mockReturnValue(false);
    const { config, thrown } = importPreload();
    expect(thrown).toEqual(new Exit(1));
    expect(config).not.toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0][0])).toContain('dev/local/.state/backend.env is missing');
  });

  it('accepts a local environment: reads only the local file and blacks out AWS', () => {
    localEnv();
    const { config, thrown } = importPreload();
    expect(thrown).toBeUndefined();
    expect(config).toHaveBeenCalledTimes(1);
    expect(path.basename(config.mock.calls[0][0].path)).toBe('backend.env');
    expect(process.env.AWS_EC2_METADATA_DISABLED).toBe('true');
    expect(process.env.AWS_ENDPOINT_URL).toBe('http://127.0.0.1:9');
  });
});
