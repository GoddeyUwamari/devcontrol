/**
 * Keeps dev/local/.state/db/ and the Postgres volume in step.
 *
 * The container's POSTGRES_PASSWORD is applied only when a volume is first
 * initialised, so a superuser password that lives in .state alone goes stale
 * whenever the two part ways: .state deleted with the volume kept, or a
 * volume another checkout created (every checkout shares the compose project
 * name, and so the volume). The record that ties them is a random marker
 * stored both in the database's comment and in .state/db/volume.json:
 *
 *   fresh  no volume yet: Postgres initialises one with the password from a
 *          new .state/db/.
 *   reuse  the volume carries the marker .state/db recorded.
 *   adopt  any other volume: nothing in .state/db applies to it, so it is
 *          replaced and the volume gets a new marker.
 *
 * Every run then sets the superuser password from .state/db through the
 * container's own Unix socket, which the postgres image trusts
 * (`local all all trust` in its pg_hba.conf). The port published on
 * 127.0.0.1 still requires the password. The password reaches psql on stdin,
 * never on a command line.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a CommonJS script run by plain node */
const crypto = require('crypto');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { dbStatePath, writeStateFile } = require('./state');

const VOLUME_NAME = 'devcontrol-local_pgdata';
const DATABASE = 'devcontrol_local';
const RECORD_FILE = 'db/volume.json';
const MARKER_PREFIX = 'devcontrol-local-volume:';
const MARKER_PATTERN = /^[0-9a-f]{32}$/;

/** Whether the compose volume exists. Docker itself failing is an error, not "no volume". */
function volumeExists(run = spawnSync) {
  const result = run('docker', ['volume', 'inspect', VOLUME_NAME], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status === 0) return true;
  if (/no such volume/i.test(result.stderr || '')) return false;
  throw new Error(`docker volume inspect ${VOLUME_NAME} failed`);
}

/** .state/db/volume.json's marker, or null when there is no usable record. */
function readRecordedMarker() {
  try {
    const { marker } = JSON.parse(fs.readFileSync(dbStatePath('volume.json'), 'utf8'));
    return MARKER_PATTERN.test(marker) ? marker : null;
  } catch {
    return null;
  }
}

function writeRecordedMarker(marker) {
  writeStateFile(RECORD_FILE, `${JSON.stringify({ volume: VOLUME_NAME, marker })}\n`);
}

/** The marker in a database comment, or null if the comment is not one. */
function parseMarkerComment(comment) {
  if (typeof comment !== 'string' || !comment.startsWith(MARKER_PREFIX)) return null;
  const marker = comment.slice(MARKER_PREFIX.length);
  return MARKER_PATTERN.test(marker) ? marker : null;
}

function credentialPlan({ volumeExisted, databaseMarker, recordedMarker }) {
  if (!volumeExisted) return 'fresh';
  if (databaseMarker && databaseMarker === recordedMarker) return 'reuse';
  return 'adopt';
}

const newMarker = () => crypto.randomBytes(16).toString('hex');

const MARKER_QUERY = `SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = '${DATABASE}'`;

/** SQL setting the superuser password and stamping the marker; quoted for a SQL literal. */
function superuserSql(password, marker) {
  if (!MARKER_PATTERN.test(marker)) throw new Error('invalid volume marker');
  const literal = `'${password.replace(/'/g, "''")}'`;
  return `ALTER ROLE postgres PASSWORD ${literal};\nCOMMENT ON DATABASE ${DATABASE} IS '${MARKER_PREFIX}${marker}';\n`;
}

/**
 * Runs SQL as postgres over the container's Unix socket. `composeEnv` carries
 * what docker compose needs to interpolate the compose file.
 */
function psqlInContainer({ composeFile, composeEnv, sql, run = spawnSync }) {
  const result = run(
    'docker',
    ['compose', '-f', composeFile, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', DATABASE, '-At', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', env: composeEnv },
  );
  // psql's own error names the statement, not its values; still, only the exit status is reported.
  if (result.status !== 0) throw new Error('psql over the container socket failed');
  return result.stdout.trim();
}

module.exports = {
  VOLUME_NAME,
  MARKER_PREFIX,
  MARKER_QUERY,
  volumeExists,
  readRecordedMarker,
  writeRecordedMarker,
  parseMarkerComment,
  credentialPlan,
  newMarker,
  superuserSql,
  psqlInContainer,
};
