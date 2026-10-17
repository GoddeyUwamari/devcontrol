/**
 * dev/local/.state/: the local stack's generated secrets and login. The
 * directory is git-ignored (dev/local/.gitignore) and every file in it is
 * created owner-only. Values are generated here at run time; none is ever
 * committed or printed.
 *
 * Everything that belongs to one database volume -- its passwords, the key
 * for data encrypted in it, the logins seeded into it and the record of which
 * volume that is -- lives in .state/db/, so it is replaced as a unit when the
 * volume is (dev/local/volume-credentials.js).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '.state');
const DB_STATE_DIR = path.join(STATE_DIR, 'db');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

function ensureStateDir() {
  ensureDir(STATE_DIR);
}

/** A path under .state/; `name` may include the db/ directory, e.g. 'db/app.password'. */
function statePath(name) {
  return path.join(STATE_DIR, name);
}

/** A path under .state/db/, the files that belong to the current database volume. */
function dbStatePath(name) {
  return path.join(DB_STATE_DIR, name);
}

function writeStateFile(name, contents) {
  ensureStateDir();
  const file = statePath(name);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

/** Reads a generated value, creating it on first use. */
function readOrCreateSecret(name, generate) {
  const file = statePath(name);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const value = generate();
  writeStateFile(name, `${value}\n`);
  return value;
}

/** Removes everything that belonged to the previous database volume. */
function resetDbState() {
  fs.rmSync(DB_STATE_DIR, { recursive: true, force: true });
}

const randomHex = (bytes) => () => crypto.randomBytes(bytes).toString('hex');

module.exports = {
  STATE_DIR,
  DB_STATE_DIR,
  ensureStateDir,
  statePath,
  dbStatePath,
  writeStateFile,
  readOrCreateSecret,
  resetDbState,
  randomHex,
};
