#!/usr/bin/env node
/**
 * `npm run dev:local`: the whole app on this machine against a throwaway
 * loopback Postgres, reaching nothing external.
 *
 *   node dev/local/run.js              set up, then start backend + frontend
 *   node dev/local/run.js --setup-only set up (database, schema, owner) and exit
 *   node dev/local/run.js --reset ...  first delete the database volume and
 *                                      everything in .state/db/
 *   node dev/local/run.js --seed ...   after setup, write the demo workspace
 *                                      (dev/local/seed-icp.js)
 *
 * Both servers get an allowlisted environment built here -- never the
 * inherited shell, which may hold real keys or AWS profiles. The backend runs
 * with DEVCONTROL_LOCAL_STACK=1, so it reads dev/local/.state/backend.env
 * (never backend/.env) and refuses to start if anything points outside this
 * machine (backend/src/config/local-stack-guard.ts).
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script run by plain node */
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');
const { ensureStateDir, readOrCreateSecret, randomHex, writeStateFile, statePath, resetDbState } = require('./state');
const volume = require('./volume-credentials');
const { bootstrap, APP_ROLE } = require('./bootstrap');
const { seedOwner, OWNER_EMAIL, LOGIN_FILE } = require('./seed-owner');

const REPO_ROOT = path.join(__dirname, '..', '..');
const COMPOSE_FILE = path.join(__dirname, 'docker-compose.yml');
const DB = { host: '127.0.0.1', port: 55432, database: 'devcontrol_local' };
const BACKEND_PORT = 8080;
const FRONTEND_URL = 'http://localhost:3010';
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

// Next.js loads these from the repository root on its own; any of them could
// carry real keys into the frontend server, so their presence stops the run.
const NEXT_ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'];

/** The only inherited variables either server sees. */
const INHERITED = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TERM', 'USER'];

function fail(message) {
  console.error(`[dev:local] ${message}`);
  process.exit(1);
}

function baseEnv() {
  const env = {};
  for (const name of INHERITED) if (process.env[name] !== undefined) env[name] = process.env[name];
  return env;
}

function checkPrerequisites() {
  const present = NEXT_ENV_FILES.filter((name) => fs.existsSync(path.join(REPO_ROOT, name)));
  if (present.length > 0) {
    fail(`${present.join(', ')} exists in the repository root; Next.js would load it into the local frontend. Run dev:local from a checkout without it (e.g. a git worktree).`);
  }
  const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { stdio: 'pipe' });
  if (docker.status !== 0) fail('Docker is not running. Start Docker Desktop and try again.');
}

// What docker compose needs to interpolate the compose file.
function composeEnv(superuserPassword) {
  return { ...baseEnv(), DEVCONTROL_LOCAL_PG_PASSWORD: superuserPassword };
}

function startDatabase(superuserPassword) {
  console.log('[dev:local] starting Postgres (127.0.0.1:55432) ...');
  const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait'], {
    stdio: 'inherit',
    env: composeEnv(superuserPassword),
  });
  if (result.status !== 0) fail('docker compose up failed');
}

function deleteDatabase() {
  console.log('[dev:local] --reset: deleting the database volume and .state/db/ ...');
  const result = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], {
    stdio: 'inherit',
    env: composeEnv(randomHex(24)()),
  });
  if (result.status !== 0) fail('docker compose down -v failed');
  resetDbState();
}

// Where .state/ kept the volume's files before .state/db/ existed.
const LEGACY_DB_FILES = ['postgres.password', 'app.password', 'encryption.key', 'owner-login.txt'];

function readDbSecrets() {
  return {
    superuserPassword: readOrCreateSecret('db/postgres.password', randomHex(24)),
    appPassword: readOrCreateSecret('db/app.password', randomHex(24)),
    // ENCRYPTION_KEY must be exactly 32 characters: 16 bytes as hex.
    encryptionKey: readOrCreateSecret('db/encryption.key', randomHex(16)),
  };
}

/**
 * Starts Postgres with .state/db/ belonging to its volume
 * (volume-credentials.js) and returns that volume's secrets.
 */
function startDatabaseForState() {
  for (const name of LEGACY_DB_FILES) fs.rmSync(statePath(name), { force: true });
  const volumeExisted = volume.volumeExists();
  if (!volumeExisted) resetDbState();
  let db = readDbSecrets();
  startDatabase(db.superuserPassword);

  const inContainer = (sql) => volume.psqlInContainer({ composeFile: COMPOSE_FILE, composeEnv: composeEnv(db.superuserPassword), sql });
  const databaseMarker = volume.parseMarkerComment(inContainer(volume.MARKER_QUERY));
  const plan = volume.credentialPlan({ volumeExisted, databaseMarker, recordedMarker: volume.readRecordedMarker() });
  if (plan === 'adopt') {
    resetDbState();
    db = readDbSecrets();
  }
  const marker = plan === 'reuse' ? databaseMarker : volume.newMarker();
  inContainer(volume.superuserSql(db.superuserPassword, marker));
  volume.writeRecordedMarker(marker);
  console.log(`[dev:local] database volume: ${plan}`);
  return db;
}

function writeBackendEnv(secrets) {
  const lines = {
    NODE_ENV: 'development',
    PORT: String(BACKEND_PORT),
    DB_HOST: DB.host,
    DB_PORT: String(DB.port),
    DB_NAME: DB.database,
    DB_USER: APP_ROLE,
    DB_PASSWORD: secrets.appPassword,
    JWT_SECRET: secrets.jwtSecret,
    ENCRYPTION_KEY: secrets.encryptionKey,
    FRONTEND_URL,
  };
  writeStateFile(
    'backend.env',
    `# Generated by dev/local/run.js on every run -- do not edit, never commit.\n${Object.entries(lines).map(([k, v]) => `${k}=${v}`).join('\n')}\n`,
  );
}

async function setUp() {
  checkPrerequisites();
  ensureStateDir();
  if (process.argv.includes('--reset')) deleteDatabase();
  const secrets = {
    ...startDatabaseForState(),
    jwtSecret: readOrCreateSecret('jwt.secret', randomHex(32)),
  };

  const client = new Client({ ...DB, user: 'postgres', password: secrets.superuserPassword });
  await client.connect();
  try {
    console.log('[dev:local] bootstrapping schema ...');
    await bootstrap(client, { ...DB, superuserPassword: secrets.superuserPassword, appPassword: secrets.appPassword });
    const owner = await seedOwner(client);
    if (owner.passwordIssued) {
      console.log(`[dev:local] owner ${owner.created ? 'created' : 'password reissued'}: ${OWNER_EMAIL}`);
      console.log(`[dev:local] its password is in ${path.relative(REPO_ROOT, owner.loginFile)} (git-ignored)`);
    }
  } finally {
    await client.end();
  }
  writeBackendEnv(secrets);
}

/**
 * Runs dev/local/seed-icp.js with the environment the backend gets -- the
 * allowlist plus the local-stack flag -- so its guard judges exactly what the
 * backend would run with.
 */
function seedDemo() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'seed-icp.js')], {
    stdio: 'inherit',
    env: { ...baseEnv(), DEVCONTROL_LOCAL_STACK: '1', NODE_ENV: 'development' },
  });
  if (result.status !== 0) fail('seeding the demo workspace failed');
}

/**
 * Signals a server's whole process group. `npm run dev` runs a shell that runs
 * ts-node-dev, which runs node: signalling only the npm process can leave the
 * node process that holds the port running.
 */
function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group has already exited.
  }
}

function startServers() {
  const children = [];
  const launch = (name, command, args, cwd, env) => {
    // detached: each server leads its own process group, so it can be stopped
    // as a whole. stdin is ignored so a background group never blocks on the tty.
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
    child.on('exit', (code, signal) => {
      console.log(`[dev:local] ${name} exited (${signal || code})`);
      for (const each of children) signalGroup(each, 'SIGTERM');
      process.exitCode = code || 0;
    });
    children.push(child);
  };

  launch('backend', 'npm', ['run', 'dev'], path.join(REPO_ROOT, 'backend'), {
    ...baseEnv(),
    DEVCONTROL_LOCAL_STACK: '1',
    NODE_ENV: 'development',
  });
  launch('frontend', path.join(REPO_ROOT, 'node_modules', '.bin', 'next'), ['dev', '-p', '3010', '-H', '127.0.0.1'], REPO_ROOT, {
    ...baseEnv(),
    NEXT_PUBLIC_API_URL: BACKEND_URL,
    NEXT_PUBLIC_WS_URL: BACKEND_URL,
    NEXT_PUBLIC_GA_ENABLED: 'false',
    NEXT_TELEMETRY_DISABLED: '1',
  });

  // SIGINT (Ctrl-C), SIGTERM (`kill <pid>`, an IDE's stop) and any exit of
  // this process stop both servers; a second signal kills them outright.
  let stopping = false;
  const stop = () => {
    const signal = stopping ? 'SIGKILL' : 'SIGTERM';
    stopping = true;
    for (const child of children) signalGroup(child, signal);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', () => {
    for (const child of children) signalGroup(child, 'SIGTERM');
  });

  console.log(`[dev:local] frontend ${FRONTEND_URL}  backend ${BACKEND_URL}`);
  console.log(`[dev:local] log in as ${OWNER_EMAIL}; password in ${path.relative(REPO_ROOT, statePath(LOGIN_FILE))}`);
  console.log('[dev:local] Postgres keeps running after Ctrl-C; stop it with: docker compose -f dev/local/docker-compose.yml down');
}

setUp()
  .then(() => {
    if (process.argv.includes('--seed')) seedDemo();
    if (process.argv.includes('--setup-only')) {
      console.log('[dev:local] setup complete');
      return;
    }
    startServers();
  })
  .catch((err) => fail(`setup failed: ${err.message}`));
