/**
 * No real AWS account ID in tracked source or tests.
 *
 * The repository is public. Every standalone 12-digit literal in the backend
 * and frontend sources (tests included) must be a recognisable non-account
 * value. The allow-list below is the whole policy; a real account ID, which
 * none of these rules describe, fails the test without this file having to
 * name it. Use 123456789012 for an example account ID.
 */
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const SCANNED_DIRS = ['backend/src', 'app', 'components', 'lib'];
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

/** AWS's own documentation example account IDs. */
const AWS_DOCUMENTATION_EXAMPLES = new Set(['123456789012', '111122223333', '444455556666']);
/** Bounds of a test helper that generates random 12-digit IDs at run time. */
const RANDOM_ID_GENERATOR_BOUNDS = new Set(['100000000000', '899999999999']);

function allowed(value: string): boolean {
  return (
    AWS_DOCUMENTATION_EXAMPLES.has(value) ||
    RANDOM_ID_GENERATOR_BOUNDS.has(value) ||
    /^(\d)\1{11}$/.test(value) || // one digit repeated, e.g. 111111111111
    /^0{9}\d{3}$/.test(value) || // a zero-padded UUID node, e.g. ...-000000000001
    // A YYYYMMDDHHMM migration timestamp.
    /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])[0-5]\d$/.test(value)
  );
}

const TWELVE_DIGITS = /(?<![0-9A-Za-z])[0-9]{12}(?![0-9A-Za-z])/g;

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : sourceFiles(full);
    }
    return SOURCE_FILE.test(entry.name) ? [full] : [];
  });
}

function disallowedLiterals(text: string): string[] {
  return (text.match(TWELVE_DIGITS) ?? []).filter((value) => !allowed(value));
}

describe('12-digit literals in tracked sources', () => {
  it('the allow-list rejects an account-shaped value and accepts the documented placeholders', () => {
    // Built at run time so this file holds no account-shaped literal of its own.
    const accountShaped = ['9', '8', '1', '7', '2', '6', '3', '5', '4', '0', '2', '9'].join('');
    expect(disallowedLiterals(`Principal: arn:aws:iam::${accountShaped}:root`)).toEqual([accountShaped]);
    expect(disallowedLiterals('arn:aws:iam::123456789012:root and 111122223333')).toEqual([]);
    expect(disallowedLiterals('202610102024_drop.sql, 00000000-0000-0000-0000-000000000001')).toEqual([]);
  });

  it('contain no real AWS account ID', () => {
    const files = SCANNED_DIRS.flatMap((dir) => sourceFiles(path.join(REPO_ROOT, dir)));
    expect(files.length).toBeGreaterThan(100);

    const offenders = files.flatMap((file) =>
      disallowedLiterals(fs.readFileSync(file, 'utf8')).map((value) => {
        // Report where, never the value itself.
        const masked = `${value.slice(0, 2)}********${value.slice(-2)}`;
        return `${path.relative(REPO_ROOT, file)}: ${masked}`;
      })
    );
    expect(offenders).toEqual([]);
  });
});
