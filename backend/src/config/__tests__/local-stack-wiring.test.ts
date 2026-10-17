/**
 * Static wiring of the local stack that a unit test of one module can't see:
 *   - server.ts imports the preload before anything else, so local mode is
 *     checked before any module reads the environment;
 *   - dotenv is called only through loadEnv();
 *   - dev/local/.state/ (generated passwords, JWT secret, owner login) is
 *     git-ignored, while backend/.env stays ignored and backend/.env.example
 *     is the one tracked example.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const BACKEND_SRC = path.join(REPO_ROOT, 'backend', 'src');

function isIgnored(relativePath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--no-index', '-q', relativePath], { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 1) return false;
    throw err;
  }
}

it("server.ts's first import is the local-stack preload", () => {
  const source = fs.readFileSync(path.join(BACKEND_SRC, 'server.ts'), 'utf8');
  const firstImport = source.split('\n').find((line) => line.startsWith('import '));
  expect(firstImport).toBe("import './config/local-stack-preload';");
});

it('dotenv is called only by config/load-env.ts', () => {
  const sources = (fs.readdirSync(BACKEND_SRC, { recursive: true }) as string[])
    .map((file) => path.join('backend', 'src', file).split(path.sep).join('/'))
    .filter((file) => file.endsWith('.ts') && !file.includes('__tests__'));
  const callers = sources.filter((file) => /\bdotenv\.config\(/.test(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')));
  expect(callers).toEqual(['backend/src/config/load-env.ts']);
});

it.each([
  'dev/local/.state/backend.env',
  'dev/local/.state/owner-login.txt',
  'dev/local/.state/postgres.password',
  'dev/local/.state/app.password',
  'dev/local/.state/jwt.secret',
  'dev/local/.state/encryption.key',
  'dev/local/.state/anything-added-later',
  'backend/.env',
  '.env.local',
])('%s is git-ignored', (file) => {
  expect(isIgnored(file)).toBe(true);
});

it.each(['backend/.env.example', 'dev/local/run.js', 'dev/local/reconstructed-tables.sql'])('%s is not ignored', (file) => {
  expect(isIgnored(file)).toBe(false);
});
