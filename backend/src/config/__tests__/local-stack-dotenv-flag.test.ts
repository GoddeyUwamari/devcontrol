/**
 * The local-stack flag is honoured only from the real process environment.
 * A `.env` that sets it arrives after local-stack-preload.ts has already seen
 * the flag unset and skipped every check; without a refusal, server.ts would
 * then switch to local behaviour (jobs off, loopback listen, STS refusing)
 * with whatever real keys that `.env` also loaded.
 *
 * This runs the backend's real import order in a child process -- the preload,
 * then config/database.ts (the first loadEnv() caller) -- from a working
 * directory whose `.env` sets the flag next to a sentinel secret.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const BACKEND_ROOT = path.join(__dirname, '..', '..', '..');
const SENTINEL = 'sk_test_SENTINEL_value_that_must_never_be_printed';

// Transpiles the backend's .ts sources on require, so the child runs the real
// modules without a build or a ts-node dependency.
const CHILD = `
const fs = require('fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, file) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: file,
  });
  module._compile(outputText, file);
};
const [srcDir, workDir] = process.argv.slice(1);
process.chdir(workDir);
require(srcDir + '/config/local-stack-preload');
require(srcDir + '/config/database');
// server.ts's start-up decision, as it would be taken after these imports.
if (require(srcDir + '/config/local-stack-guard').isLocalStack()) console.log('[local-stack] background jobs disabled');
process.exit(0);
`;

let workDir: string;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-stack-dotenv-'));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function bootWith(dotenvFile: string) {
  fs.writeFileSync(path.join(workDir, '.env'), dotenvFile);
  const result = spawnSync(process.execPath, ['-e', CHILD, path.join(BACKEND_ROOT, 'src'), workDir], {
    cwd: BACKEND_ROOT,
    // Only what node needs: no flag and no keys from the test's own environment.
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

it('refuses to boot when DEVCONTROL_LOCAL_STACK comes from a .env file, printing no other value', () => {
  const { status, output } = bootWith(`DEVCONTROL_LOCAL_STACK=1\nSTRIPE_SECRET_KEY=${SENTINEL}\n`);
  expect(output).toContain(
    '[local-stack] refusing to start: DEVCONTROL_LOCAL_STACK must not be set in a .env file; use npm run dev:local',
  );
  expect(status).not.toBe(0);
  expect(output).not.toContain(SENTINEL);
  expect(output).not.toContain('[local-stack] background jobs disabled');
});

it('control: the same .env without the flag boots normally', () => {
  const { status, output } = bootWith(`STRIPE_SECRET_KEY=${SENTINEL}\n`);
  expect(status).toBe(0);
  expect(output).not.toContain('[local-stack]');
  expect(output).not.toContain(SENTINEL);
});
