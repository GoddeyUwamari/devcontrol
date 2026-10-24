/**
 * Outbound HTTP and mail calls in non-test source are made only where this
 * list allows them:
 *   - organization-configured destinations go through utils/safe-outbound.ts
 *     (the HTTPS helper, the checked agent the Jira client uses, and mail
 *     transports built from the checked address);
 *   - the other call sites reach destinations set by the platform, never by
 *     an organization (Prometheus, the report email server).
 * webhook_endpoints is read and written only by its routes; whatever sends to
 * those URLs has to be added here, through safeHttpsPost.
 *
 * A new call site needs a reviewed entry below. A source scan can be
 * missed when a call is reached through an alias, so this is a tripwire, not a proof; the behaviour is
 * covered by utils/__tests__/safe-outbound.test.ts and
 * routes/__tests__/outbound-destinations.test.ts.
 */
import fs from 'fs';
import path from 'path';
import { COMMENT_FIXTURE, codeLines, codeLinesOf } from './helpers/source-scan';

const SRC = path.join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const OUTBOUND_CALL = /\bfetch\(|\baxios\.|\bhttps?\.(request|get)\(|\bcreateTransport\(/;

const ALLOWED_CALL_SITES: Record<string, { calls: RegExp; reason: string }> = {
  [path.join('utils', 'safe-outbound.ts')]: {
    calls: /\bhttps\.request\(/,
    reason: 'the shared helper: checked and pinned addresses, no redirects, body unread',
  },
  [path.join('services', 'jira-client.service.ts')]: {
    calls: /\baxios\.create\(|\bthis\.axios\.request</,
    reason: 'axios with the checked agent, no redirects, no proxy',
  },
  [path.join('services', 'alert-notification.service.ts')]: {
    calls: /\bnodemailer\.createTransport\($/,
    reason: 'built per send from pinnedSmtpTarget',
  },
  [path.join('services', 'scheduled-reports.service.ts')]: {
    calls: /\bnodemailer\.createTransport\(\{$/,
    reason: 'report email to the SMTP server set in the environment (deliverViaEmail)',
  },
  [path.join('controllers', 'prometheus.controller.ts')]: {
    calls: /\baxios\.get\(`\$\{PROMETHEUS_URL\}\//,
    reason: 'Prometheus URL from the environment',
  },
  [path.join('services', 'monitoring-diagnostic.service.ts')]: {
    calls: /\baxios\.get\(`\$\{PROMETHEUS_URL\}\//,
    reason: 'Prometheus URL from the environment',
  },
  [path.join('services', 'alert-history.service.ts')]: {
    calls: /\baxios\.get\(`\$\{this\.prometheusUrl\}\//,
    reason: 'Prometheus URL set by the platform (constructor default or the sync job)',
  },
};

const allFiles = sourceFiles(SRC);
const relative = (file: string) => path.relative(SRC, file);

function outboundCalls(file: string): string[] {
  return codeLines(file)
    .filter(({ text }) => OUTBOUND_CALL.test(text))
    .map(({ line, text }) => `${relative(file)}:${line}: ${text.trim()}`);
}

describe('outbound call sites', () => {
  it('every outbound HTTP or mail call is at an allowed site', () => {
    const unexpected = allFiles.flatMap((file) => {
      const allowed = ALLOWED_CALL_SITES[relative(file)];
      return outboundCalls(file).filter((call) => !allowed || !allowed.calls.test(call.slice(call.indexOf(': ') + 2)));
    });

    expect(unexpected).toEqual([]);
  });

  it('organization destinations are never sent to with fetch', () => {
    for (const file of ['services/alert-notification.service.ts', 'services/scheduled-reports.service.ts', 'services/jira-client.service.ts']) {
      expect(codeLines(path.join(SRC, file)).filter(({ text }) => /\bfetch\(/.test(text))).toEqual([]);
    }
  });

  it('webhook_endpoints is used only by its routes', () => {
    const users = allFiles.filter((file) => codeLines(file).some(({ text }) => text.includes('webhook_endpoints')));

    expect(users.map(relative)).toEqual([path.join('routes', 'webhooks.routes.ts')]);
  });

  describe('the scan finds what it looks for', () => {
    it.each(Object.entries(ALLOWED_CALL_SITES))('%s still has the call it is allowed', (file, { calls, reason }) => {
      expect(reason).not.toBe('');
      expect(outboundCalls(path.join(SRC, file)).some((call) => calls.test(call.slice(call.indexOf(': ') + 2)))).toBe(true);
    });

    it('it walks the whole source tree', () => {
      const files = allFiles.map(relative);
      for (const file of [...Object.keys(ALLOWED_CALL_SITES), path.join('routes', 'webhooks.routes.ts'), 'server.ts']) {
        expect(files).toContain(file);
      }
    });

    it('it ignores comments but not code that shares a line with one', () => {
      const found = codeLinesOf(COMMENT_FIXTURE.source)
        .filter(({ text }) => OUTBOUND_CALL.test(text))
        .map(({ line }) => line);
      expect(found).toEqual(COMMENT_FIXTURE.calls);
    });

    it('it matches each kind of call', () => {
      for (const line of ['await fetch(url)', 'axios.post(u)', 'https.request(o)', 'http.get(u)', 'nodemailer.createTransport({']) {
        expect(OUTBOUND_CALL.test(line)).toBe(true);
      }
      for (const line of ['prefetch(x)', 'refetchQueries()', 'this.httpsRequest()']) {
        expect(OUTBOUND_CALL.test(line)).toBe(false);
      }
    });
  });
});
