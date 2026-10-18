/**
 * Invitation links carry the token in the URL fragment
 * (/accept-invitation#token=...), never in the query string, so the token is
 * not sent to a server or written to access logs when the link is opened.
 *
 * Scans every non-test source file under backend/src for an accept-invitation
 * link with the token in a query string.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC_DIR = path.join(__dirname, '../../');

// accept-invitation?token=..., or ?foo=bar&token=... / &invitationToken=...
const QUERY_TOKEN_LINK = /accept-invitation\?(?:[^\s'"`#]*[&?])?[A-Za-z_]*token=|accept-invitation\?token/i;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    }
    if (/\.test\.[jt]s$/.test(entry.name)) return [];
    return /\.(ts|js|html|hbs|json)$/.test(entry.name) ? [full] : [];
  });
}

describe('invitation link guard', () => {
  const files = sourceFiles(SRC_DIR);

  it('scans the email service and invitation template', () => {
    const rel = files.map((f) => path.relative(SRC_DIR, f));
    expect(rel).toContain(path.join('services', 'email.service.ts'));
    expect(rel).toContain(path.join('templates', 'invitation-email.html'));
  });

  it('the pattern catches query-string forms and allows the fragment form', () => {
    expect(QUERY_TOKEN_LINK.test('/accept-invitation?token=abc')).toBe(true);
    expect(QUERY_TOKEN_LINK.test('/accept-invitation?org=1&token=abc')).toBe(true);
    expect(QUERY_TOKEN_LINK.test('/accept-invitation?invitationToken=abc')).toBe(true);
    expect(QUERY_TOKEN_LINK.test('/accept-invitation#token=abc')).toBe(false);
    expect(QUERY_TOKEN_LINK.test("'/accept-invitation'")).toBe(false);
  });

  it('no source file builds an accept-invitation link with the token in the query string', () => {
    const offenders = files.filter((f) => QUERY_TOKEN_LINK.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(SRC_DIR, f))).toEqual([]);
  });
});
