/**
 * dev/local/.state/: the local stack's generated secrets and login. The
 * directory is git-ignored (dev/local/.gitignore) and every file in it is
 * created owner-only. Values are generated here at run time; none is ever
 * committed or printed.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(__dirname, '.state');

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(STATE_DIR, 0o700);
}

function statePath(name) {
  return path.join(STATE_DIR, name);
}

function writeStateFile(name, contents) {
  ensureStateDir();
  const file = statePath(name);
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

const randomHex = (bytes) => () => crypto.randomBytes(bytes).toString('hex');

module.exports = { STATE_DIR, ensureStateDir, statePath, writeStateFile, readOrCreateSecret, randomHex };
