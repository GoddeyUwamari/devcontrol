/**
 * loadEnv() is the backend's only dotenv entry point (config/database.ts and
 * server.ts). With DEVCONTROL_LOCAL_STACK unset it must be exactly the plain
 * `dotenv.config()` both files made before; with it set, it must read only
 * the local stack's own file and never `.env` in the working directory.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const FLAG = 'DEVCONTROL_LOCAL_STACK';
const PROBE = 'LOAD_ENV_TEST_PROBE';

describe('loadEnv with dotenv observed', () => {
  afterEach(() => {
    delete process.env[FLAG];
    jest.resetModules();
    jest.dontMock('dotenv');
  });

  function loadWithMockedDotenv() {
    const config = jest.fn();
    jest.doMock('dotenv', () => ({ __esModule: true, default: { config } }));
    let mod: typeof import('../load-env') | undefined;
    jest.isolateModules(() => {
      mod = require('../load-env');
    });
    return { config, ...mod! };
  }

  it('flag unset: one dotenv.config() call with no arguments -- the call the backend always made', () => {
    delete process.env[FLAG];
    const { config, loadEnv } = loadWithMockedDotenv();
    expect(config).not.toHaveBeenCalled(); // importing has no side effect
    loadEnv();
    expect(config).toHaveBeenCalledTimes(1);
    expect(config.mock.calls[0]).toEqual([]);
  });

  it('flag set: reads only dev/local/.state/backend.env', () => {
    process.env[FLAG] = '1';
    const { config, loadEnv, LOCAL_STACK_ENV_FILE } = loadWithMockedDotenv();
    loadEnv();
    expect(config).toHaveBeenCalledTimes(1);
    expect(config.mock.calls[0]).toEqual([{ path: LOCAL_STACK_ENV_FILE }]);
    expect(path.relative(path.join(__dirname, '..', '..', '..', '..'), LOCAL_STACK_ENV_FILE)).toBe(
      path.join('dev', 'local', '.state', 'backend.env'),
    );
  });
});

describe('loadEnv against a real .env in the working directory', () => {
  const originalCwd = process.cwd();
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-'));
    fs.writeFileSync(path.join(dir, '.env'), `${PROBE}=from-dotenv-file\n`);
    process.chdir(dir);
    delete process.env[PROBE];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env[PROBE];
    delete process.env[FLAG];
  });

  it('flag unset: loads .env exactly as dotenv.config() does, without overriding the shell', () => {
    const { loadEnv } = require('../load-env');
    const dotenv = require('dotenv');

    loadEnv();
    const viaLoadEnv = process.env[PROBE];
    delete process.env[PROBE];
    dotenv.config();
    expect(viaLoadEnv).toBe('from-dotenv-file');
    expect(viaLoadEnv).toBe(process.env[PROBE]);

    process.env[PROBE] = 'from-shell';
    loadEnv();
    expect(process.env[PROBE]).toBe('from-shell');
  });

  it('flag set: never reads .env from the working directory', () => {
    process.env[FLAG] = '1';
    const { loadEnv } = require('../load-env');
    loadEnv();
    expect(process.env[PROBE]).toBeUndefined();
  });
});
