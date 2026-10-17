/**
 * dev/local/volume-credentials.js: which database volume dev/local/.state/db/
 * belongs to. The live cases (volume deleted, .state deleted, both, another
 * checkout's volume) need Docker and are run by hand; these pin the decisions
 * and that the superuser password never reaches a command line.
 */
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const volume = require(path.join(__dirname, '..', '..', '..', '..', 'dev', 'local', 'volume-credentials.js'));

const MARKER = 'a'.repeat(32);
const OTHER_MARKER = 'b'.repeat(32);

describe('credentialPlan', () => {
  it.each([
    // No volume: Postgres initialises a new one from a new .state/db/.
    [{ volumeExisted: false, databaseMarker: null, recordedMarker: null }, 'fresh'],
    [{ volumeExisted: false, databaseMarker: null, recordedMarker: MARKER }, 'fresh'],
    // The volume this .state/db/ recorded.
    [{ volumeExisted: true, databaseMarker: MARKER, recordedMarker: MARKER }, 'reuse'],
    // .state/db/ lost, volume kept.
    [{ volumeExisted: true, databaseMarker: MARKER, recordedMarker: null }, 'adopt'],
    // Another checkout's volume, or one it re-stamped since.
    [{ volumeExisted: true, databaseMarker: OTHER_MARKER, recordedMarker: MARKER }, 'adopt'],
    // A volume from before markers existed.
    [{ volumeExisted: true, databaseMarker: null, recordedMarker: null }, 'adopt'],
    [{ volumeExisted: true, databaseMarker: null, recordedMarker: MARKER }, 'adopt'],
  ])('%j -> %s', (input, plan) => {
    expect(volume.credentialPlan(input)).toBe(plan);
  });
});

describe('parseMarkerComment', () => {
  it('reads a marker comment', () => {
    expect(volume.parseMarkerComment(`${volume.MARKER_PREFIX}${MARKER}`)).toBe(MARKER);
  });

  it.each([null, '', 'some other comment', `${volume.MARKER_PREFIX}short`, `${volume.MARKER_PREFIX}${MARKER}x`])(
    'rejects %j',
    (comment) => {
      expect(volume.parseMarkerComment(comment)).toBeNull();
    }
  );
});

describe('superuserSql', () => {
  it('sets the password as an escaped literal and stamps the marker', () => {
    expect(volume.superuserSql("pa'ss", MARKER)).toBe(
      `ALTER ROLE postgres PASSWORD 'pa''ss';\nCOMMENT ON DATABASE devcontrol_local IS '${volume.MARKER_PREFIX}${MARKER}';\n`
    );
  });

  it('refuses a marker that is not 32 hex characters', () => {
    expect(() => volume.superuserSql('x', "'; DROP DATABASE devcontrol_local; --")).toThrow('invalid volume marker');
  });
});

describe('psqlInContainer', () => {
  it('sends the SQL on stdin only, over the container socket as postgres', () => {
    const calls: Array<{ command: string; args: string[]; options: { input: string; env: Record<string, string> } }> = [];
    const run = (command: string, args: string[], options: { input: string; env: Record<string, string> }) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'ok\n', stderr: '' };
    };
    const sql = volume.superuserSql('secret-value', MARKER);

    expect(volume.psqlInContainer({ composeFile: '/c.yml', composeEnv: { PATH: '/bin' }, sql, run })).toBe('ok');
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('docker');
    expect(calls[0].args).toEqual([
      'compose', '-f', '/c.yml', 'exec', '-T', 'postgres',
      'psql', '-U', 'postgres', '-d', 'devcontrol_local', '-At', '-q', '-v', 'ON_ERROR_STOP=1',
    ]);
    // No host or port: psql uses the Unix socket.
    expect(calls[0].args.join(' ')).not.toMatch(/-h|--host|-p /);
    expect(calls[0].args.join(' ')).not.toContain('secret-value');
    expect(calls[0].options.input).toBe(sql);
  });

  it('reports a failure without psql output', () => {
    const run = () => ({ status: 3, stdout: '', stderr: 'ERROR: something about secret-value' });
    expect(() => volume.psqlInContainer({ composeFile: '/c.yml', composeEnv: {}, sql: 'SELECT 1', run })).toThrow(
      /^psql over the container socket failed$/
    );
  });
});

describe('volumeExists', () => {
  it('is true when docker can inspect the volume', () => {
    expect(volume.volumeExists(() => ({ status: 0, stdout: '[]', stderr: '' }))).toBe(true);
  });

  it('is false only for "no such volume"', () => {
    expect(volume.volumeExists(() => ({ status: 1, stdout: '[]', stderr: 'Error response from daemon: get devcontrol-local_pgdata: no such volume' }))).toBe(false);
  });

  it('throws when docker itself fails, rather than treating the volume as gone', () => {
    expect(() => volume.volumeExists(() => ({ status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon' }))).toThrow(
      'docker volume inspect devcontrol-local_pgdata failed'
    );
  });
});
