/**
 * Scheduled reports are delivered to Slack only through the organization's
 * own webhook (organizations.settings.slack_webhook_url). This source scan
 * keeps any platform-wide Slack destination out of the backend, whatever the
 * environment variable is called:
 *   - no non-test source names a SLACK environment variable, except the local
 *     stack's deny-list (config/local-stack-guard.ts);
 *   - no non-test source hard-codes a Slack webhook host;
 *   - the one exception to both: the allow-list of Slack webhook hosts an
 *     organization's own webhook may use, and the save error that names
 *     them (utils/safe-outbound.ts), by exact line. They name hosts to
 *     accept, not a destination to send to;
 *   - the report-delivery files read only the SMTP settings from the
 *     environment, by name, and import no config module but the database.
 * A static scan can't prove behaviour; scheduled-reports.slack-delivery.test.ts
 * covers that.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..', '..');
const DENY_LIST = path.join('config', 'local-stack-guard.ts');

const REPORT_DELIVERY_FILES = [
  'services/scheduled-reports.service.ts',
  'services/report-generator.service.ts',
  'jobs/scheduled-reports.job.ts',
  'controllers/scheduled-reports.controller.ts',
  'routes/scheduled-reports.routes.ts',
  'repositories/scheduled-reports.repository.ts',
];
const ALLOWED_ENV = ['SMTP_HOST', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_USER'];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

/** The file's lines without comment-only lines (line and block comments). */
function codeLines(file: string): string[] {
  return fs
    .readFileSync(file, 'utf-8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line));
}

function read(relative: string): string {
  return codeLines(path.join(SRC, relative)).join('\n');
}

/** "file:line: text" for every code line matching `pattern`. */
function matches(files: string[], pattern: RegExp): string[] {
  return files.flatMap((file) =>
    codeLines(file).flatMap((line, i) =>
      pattern.test(line) ? [`${path.relative(SRC, file)}:${i + 1}: ${line.trim()}`] : []
    )
  );
}

function envNames(source: string): string[] {
  return [...source.matchAll(/process\.env\.([A-Za-z_]\w*)/g)].map((m) => m[1]);
}

const allFiles = sourceFiles(SRC);
const SLACK_NAME = /SLACK/;

const OUTBOUND = path.join('utils', 'safe-outbound.ts');
/** The only code lines either scan may find, as "file: text". Any other line, in that file too, fails. */
const SLACK_HOST_ALLOW_LIST = [
  `${OUTBOUND}: export const SLACK_WEBHOOK_HOSTS = ['hooks.slack.com', 'hooks.slack-gov.com'] as const;`,
  `${OUTBOUND}: export const slackWebhookUrlError = 'Slack webhook URL must be an https://hooks.slack.com/ or https://hooks.slack-gov.com/ address.';`,
  `${OUTBOUND}: if (!(SLACK_WEBHOOK_HOSTS as readonly string[]).includes(host)) throw notAllowed();`,
];
const withoutLineNumber = (match: string) => match.replace(/:\d+: /, ': ');
const outsideAllowList = (found: string[]) => found.filter((match) => !SLACK_HOST_ALLOW_LIST.includes(withoutLineNumber(match)));

describe('no platform-level Slack webhook for report delivery', () => {
  it('no source outside the local-stack deny-list names a SLACK environment variable', () => {
    const scanned = allFiles.filter((file) => path.relative(SRC, file) !== DENY_LIST);

    expect(outsideAllowList(matches(scanned, SLACK_NAME))).toEqual([]);
  });

  it('no source hard-codes a Slack webhook host', () => {
    expect(outsideAllowList(matches(allFiles, /hooks\.slack\.com/i))).toEqual([]);
  });

  it.each(REPORT_DELIVERY_FILES)('%s reads only the SMTP settings from the environment', (relative) => {
    const source = read(relative);

    expect(envNames(source).filter((name) => !ALLOWED_ENV.includes(name))).toEqual([]);
    // Every use of process.env is a plain `process.env.NAME` read: no
    // computed key, no alias, no destructuring, no passing it along.
    expect((source.match(/process\.env\b/g) ?? []).length).toBe(envNames(source).length);
  });

  it.each(REPORT_DELIVERY_FILES)('%s imports no config module other than the database', (relative) => {
    const configImports = [...read(relative).matchAll(/from\s+['"]([^'"]*\/config\/[^'"]*)['"]/g)]
      .map((m) => m[1])
      .filter((spec) => !/\/config\/database$/.test(spec));

    expect(configImports).toEqual([]);
  });

  describe('the scan finds what it looks for', () => {
    it('it sees the SLACK name in the deny-list it leaves out', () => {
      expect(matches([path.join(SRC, DENY_LIST)], SLACK_NAME)).toEqual([
        expect.stringContaining("'SLACK_WEBHOOK_URL'"),
      ]);
    });

    it('it reads the SMTP settings in the report service', () => {
      expect([...new Set(envNames(read('services/scheduled-reports.service.ts')))].sort()).toEqual(ALLOWED_ENV);
    });

    it('the allow-list exception covers exactly the host allow-list lines, which are still found', () => {
      const outbound = [path.join(SRC, OUTBOUND)];
      expect(matches(outbound, SLACK_NAME).map(withoutLineNumber)).toEqual([SLACK_HOST_ALLOW_LIST[0], SLACK_HOST_ALLOW_LIST[2]]);
      expect(matches(outbound, /hooks\.slack\.com/i).map(withoutLineNumber)).toEqual(SLACK_HOST_ALLOW_LIST.slice(0, 2));
    });

    it('it walks the whole source tree', () => {
      const relative = allFiles.map((file) => path.relative(SRC, file));
      for (const file of [...REPORT_DELIVERY_FILES, DENY_LIST, OUTBOUND, 'server.ts']) expect(relative).toContain(file);
    });
  });
});
