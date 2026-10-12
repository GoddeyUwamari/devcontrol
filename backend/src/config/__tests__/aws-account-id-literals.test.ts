/**
 * No real AWS account ID, AWS resource ID or UUID in any tracked text file.
 *
 * The repository is public. Every file git tracks -- source, tests, SQL,
 * docs, workflows, scripts, JSON -- is scanned for three shapes:
 *   - a 12-digit AWS account ID,
 *   - a vol- / i- / sg- resource ID,
 *   - a UUID.
 * Each must be a recognisable placeholder. The allow-rules below are the
 * whole policy for new code; a real identifier, which none of them describe,
 * fails the test without this file having to name it. Use 123456789012,
 * i-1234567890abcdef0 and 00000000-0000-4000-8000-00000000000a style values.
 *
 * KNOWN_UNRESOLVED lists, by path and count only, the identifiers that were
 * already tracked when this guard was widened and are not confirmed to be
 * placeholders. It is a ratchet, not an approval: a file may hold fewer than
 * its count (then lower it), never more, and no file may be added to it
 * without the same review a real identifier would get.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

type Kind = 'accountId' | 'resourceId' | 'uuid';

/** AWS's own documentation example account IDs. */
const AWS_DOCUMENTATION_EXAMPLES = new Set(['123456789012', '111122223333', '444455556666']);
/** Bounds of a test helper that generates random 12-digit IDs at run time. */
const RANDOM_ID_GENERATOR_BOUNDS = new Set(['100000000000', '899999999999']);
/** A YYYYMMDDHHMM migration timestamp. */
const MIGRATION_TIMESTAMP = /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])[0-5]\d$/;

/**
 * A timestamp is accepted only as a migration's: `isMigrationTimestamp` is
 * true when the value is directly followed by `_name`, as in
 * 202610102024_drop_something.sql, or is the timestamp a tracked migration
 * file is named by (migrations refer to each other by it alone).
 */
function allowedAccountShaped(value: string, isMigrationTimestamp: boolean): boolean {
  return (
    AWS_DOCUMENTATION_EXAMPLES.has(value) ||
    RANDOM_ID_GENERATOR_BOUNDS.has(value) ||
    /^(\d)\1{11}$/.test(value) || // one digit repeated, e.g. 111111111111
    /^0{9}\d{3}$/.test(value) || // zero-padded, e.g. 000000000001
    (isMigrationTimestamp && MIGRATION_TIMESTAMP.test(value))
  );
}

/** The hex part of AWS's documentation example resource IDs. */
const AWS_DOCUMENTATION_RESOURCE_HEX = new Set(['1234567890abcdef0', '0123456789abcdef0']);

function allowedResourceId(value: string): boolean {
  const hex = value.slice(value.indexOf('-') + 1);
  return AWS_DOCUMENTATION_RESOURCE_HEX.has(hex) || new Set(hex).size <= 2; // e.g. i-0bbbbbbbbbbbbbbbb
}

/** The widely used documentation example UUIDs; the first also appears with its leading two digits varied. */
const DOCUMENTATION_UUIDS = new Set(['550e8400-e29b-41d4-a716-446655440000', '123e4567-e89b-12d3-a456-426614174000']);

function allowedUuid(value: string): boolean {
  // A patterned fixture such as 00000000-0000-4000-8000-00000000000a or
  // 11111111-2222-4333-8444-555555555555 uses a handful of distinct digits;
  // a generated UUID uses nearly all sixteen.
  return (
    DOCUMENTATION_UUIDS.has(value) ||
    DOCUMENTATION_UUIDS.has(value.replace(/^\d{2}/, '55')) ||
    new Set(value.replace(/-/g, '')).size <= 6
  );
}

const UUID = /(?<![0-9A-Fa-f])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f])/g;
const RESOURCE_ID = /(?<![0-9A-Za-z-])(?:vol|i|sg)-(?:[0-9a-f]{17}|[0-9a-f]{8})(?![0-9A-Za-z])/g;
// Bounded by non-digits only, so a value glued to letters or underscores is still seen.
const TWELVE_DIGITS = /(?<![0-9])[0-9]{12}(?![0-9])(_[A-Za-z])?/g;

function disallowed(text: string, migrationTimestamps: ReadonlySet<string> = new Set()): { kind: Kind; value: string }[] {
  const found: { kind: Kind; value: string }[] = [];
  for (const [value] of text.matchAll(UUID)) {
    if (!allowedUuid(value.toLowerCase())) found.push({ kind: 'uuid', value });
  }
  for (const [value] of text.matchAll(RESOURCE_ID)) {
    if (!allowedResourceId(value)) found.push({ kind: 'resourceId', value });
  }
  // A UUID's last group can be 12 digits; it has been judged as a UUID above.
  for (const match of text.replace(UUID, ' ').matchAll(TWELVE_DIGITS)) {
    const value = match[0].slice(0, 12);
    const isMigrationTimestamp = match[1] !== undefined || migrationTimestamps.has(value);
    if (!allowedAccountShaped(value, isMigrationTimestamp)) found.push({ kind: 'accountId', value });
  }
  return found;
}

/**
 * Pre-existing identifiers not confirmed to be placeholders: path -> how many
 * of each kind the file may hold. See the header. Never add a value here.
 */
const KNOWN_UNRESOLVED: Record<string, Partial<Record<Kind, number>>> = {
  // Deploy target in the workflow, and the tests that repeat it. .github/ is
  // the founder's decision; the repeats follow whatever is decided there.
  '.github/workflows/ci.yml': { resourceId: 17 },
  'backend/src/services/__tests__/deploy-safety.test.ts': { resourceId: 3 },
  'backend/src/services/__tests__/remediation.safety.test.ts': { resourceId: 3, uuid: 4 },
  'backend/src/services/__tests__/wait-for-ssm-command.test.ts': { resourceId: 2 },
  'components/dashboard/__tests__/resource-checks-section.test.tsx': { resourceId: 3 },
  // An organization ID in applied migrations. database/migrate.js refuses to
  // run when an applied file's checksum changes, so these are not edited here.
  'database/migrations/026_api_keys_org_scoping.sql': { uuid: 1 },
  'database/migrations/027_webhook_endpoints_org_scoping.sql': { uuid: 1 },
  'database/migrations-admin/022_cost_recommendations_org_scoping.sql': { uuid: 1 },
  'database/migrations-admin/028_alert_history_org_scoping.sql': { uuid: 1 },
  'database/migrations-admin/202609031800_add_cost_recommendations_occurrence_lifecycle.sql': { uuid: 1 },
  'database/migrations-admin/README.md': { uuid: 3 },
  // Fixture-looking values nobody has confirmed are invented.
  'app/(app)/security/page.tsx': { resourceId: 2 },
  'backend/src/monitoring/__tests__/weeklyEmailJobMonitor.test.ts': { uuid: 1 },
  'backend/src/routes/__tests__/organization-context-fail-closed.test.ts': { uuid: 1 },
  'backend/src/services/__tests__/activity-feed.service.test.ts': { uuid: 1 },
  'backend/src/services/__tests__/observability-readiness.service.test.ts': { resourceId: 4, uuid: 4 },
  'backend/src/services/__tests__/system-intelligence.service.evidence-state.test.ts': { uuid: 1 },
  'backend/src/services/__tests__/system-intelligence.service.observability.test.ts': { uuid: 1 },
  'backend/src/utils/__tests__/securityGroupFindingKey.test.ts': { resourceId: 1 },
};

/** Every file git tracks, as repo-relative POSIX paths. */
function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

/** The timestamps tracked migration files are named by: database/migrations[-admin]/<timestamp>_<name>.sql. */
function trackedMigrationTimestamps(files: string[]): Set<string> {
  return new Set(
    files.flatMap((file) => /^database\/migrations[^/]*\/(\d{12})_[^/]+\.sql$/.exec(file)?.[1] ?? [])
  );
}

/** The file's text, or null for a binary file (one with a NUL byte) or one missing from the working tree. */
function readText(file: string): string | null {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(path.join(REPO_ROOT, file));
  } catch {
    return null;
  }
  return bytes.includes(0) ? null : bytes.toString('utf8');
}

// Built at run time so this file holds no real-looking literal of its own.
const ACCOUNT_SHAPED = ['9', '8', '1', '7', '2', '6', '3', '5', '4', '0', '2', '9'].join('');
const HEX_SHAPED = ['0', 'c', '7', 'e', '1', '9', 'a', '4', 'f', '2', 'b', '8', 'd', '3', '6', '5', '0'].join('');
// Timestamp-shaped, far enough in the future to be no tracked migration's.
const TIMESTAMP_SHAPED = ['2099', '12', '31', '23', '59'].join('');
const UUID_SHAPED = [HEX_SHAPED.slice(1, 9), 'c71e', '4a9f', '8b2d', `${HEX_SHAPED.slice(3, 13)}7e`].join('-');

describe('identifier-shaped literals in tracked files', () => {
  it('rejects an account-shaped value wherever it sits, and accepts the documented placeholders', () => {
    expect(disallowed(`Principal: arn:aws:iam::${ACCOUNT_SHAPED}:root`)).toEqual([{ kind: 'accountId', value: ACCOUNT_SHAPED }]);
    expect(disallowed(`acct${ACCOUNT_SHAPED}prod`)).toEqual([{ kind: 'accountId', value: ACCOUNT_SHAPED }]);
    expect(disallowed(`role_${ACCOUNT_SHAPED}`)).toEqual([{ kind: 'accountId', value: ACCOUNT_SHAPED }]);
    expect(disallowed('arn:aws:iam::123456789012:root and 111122223333')).toEqual([]);
    expect(disallowed('00000000-0000-0000-0000-000000000001, 000000000042')).toEqual([]);
  });

  it("accepts a timestamp only in a migration filename or as a tracked migration's own timestamp", () => {
    const flagged = [{ kind: 'accountId', value: TIMESTAMP_SHAPED }];
    expect(disallowed(`${TIMESTAMP_SHAPED}_drop_something.sql`)).toEqual([]);
    expect(disallowed(`database/migrations-admin/${TIMESTAMP_SHAPED}_drop_something_rollback.sql`)).toEqual([]);
    expect(disallowed(`account ${TIMESTAMP_SHAPED}`)).toEqual(flagged);
    expect(disallowed(`arn:aws:iam::${TIMESTAMP_SHAPED}:root`)).toEqual(flagged);
    expect(disallowed(`Migration ${TIMESTAMP_SHAPED} completed`)).toEqual(flagged);
    expect(disallowed(`Migration ${TIMESTAMP_SHAPED} completed`, new Set([TIMESTAMP_SHAPED]))).toEqual([]);
    expect(trackedMigrationTimestamps([
      `database/migrations/${TIMESTAMP_SHAPED}_create_things.sql`,
      `docs/${TIMESTAMP_SHAPED}_notes.sql`,
      'database/migrations/026_api_keys_org_scoping.sql',
    ])).toEqual(new Set([TIMESTAMP_SHAPED]));
  });

  it('rejects real-looking vol-, i- and sg- IDs, and accepts the documented placeholders', () => {
    for (const id of [`vol-${HEX_SHAPED}`, `i-${HEX_SHAPED}`, `sg-${HEX_SHAPED}`, `sg-${HEX_SHAPED.slice(0, 8)}`]) {
      expect(disallowed(`resource ${id} in us-east-1`)).toEqual([{ kind: 'resourceId', value: id }]);
    }
    expect(disallowed('i-1234567890abcdef0 vol-0123456789abcdef0 sg-00000000 i-0bbbbbbbbbbbbbbbb')).toEqual([]);
    // Not resource IDs: a hyphenated word, a longer token.
    expect(disallowed('multi-deadbeef api-0123abcd-extra')).toEqual([]);
  });

  it('rejects a generated-looking UUID, and accepts patterned and documentation UUIDs', () => {
    expect(disallowed(`organization ${UUID_SHAPED}`)).toEqual([{ kind: 'uuid', value: UUID_SHAPED }]);
    expect(disallowed(`organization ${UUID_SHAPED.toUpperCase()}`)).toEqual([{ kind: 'uuid', value: UUID_SHAPED.toUpperCase() }]);
    expect(
      disallowed(
        '00000000-0000-4000-8000-00000000000a 11111111-2222-4333-8444-555555555555 ' +
          '550e8400-e29b-41d4-a716-446655440000 123e4567-e89b-12d3-a456-426614174000'
      )
    ).toEqual([]);
  });

  it('every tracked text file holds only placeholders, apart from the known unresolved identifiers', () => {
    const files = trackedFiles();
    // The whole repository, not a few source directories.
    expect(files.length).toBeGreaterThan(1000);
    for (const ext of ['.ts', '.tsx', '.js', '.sql', '.md', '.yml', '.json']) {
      expect(files.some((file) => file.endsWith(ext))).toBe(true);
    }

    const migrationTimestamps = trackedMigrationTimestamps(files);
    expect(migrationTimestamps.size).toBeGreaterThan(10);

    const counts: Record<string, Partial<Record<Kind, number>>> = {};
    for (const file of files) {
      const text = readText(file);
      if (text === null) continue;
      for (const { kind } of disallowed(text, migrationTimestamps)) {
        counts[file] = { ...counts[file], [kind]: (counts[file]?.[kind] ?? 0) + 1 };
      }
    }

    // Report where and how many, never the value itself.
    const offenders: string[] = [];
    const stale: string[] = [];
    for (const file of new Set([...Object.keys(counts), ...Object.keys(KNOWN_UNRESOLVED)])) {
      for (const kind of ['accountId', 'resourceId', 'uuid'] as const) {
        const actual = counts[file]?.[kind] ?? 0;
        const known = KNOWN_UNRESOLVED[file]?.[kind] ?? 0;
        if (actual > known) offenders.push(`${file}: ${actual} ${kind} (known unresolved: ${known})`);
        if (actual < known) stale.push(`${file}: ${actual} ${kind}, KNOWN_UNRESOLVED says ${known} -- lower it`);
      }
    }
    expect(offenders.sort()).toEqual([]);
    expect(stale.sort()).toEqual([]);
  });
});
