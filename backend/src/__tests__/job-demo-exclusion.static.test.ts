/**
 * Demo workspace PR-1a, inventory: every scheduled or background job in
 * non-test source either leaves the demo organization out through the ONE
 * shared helper (demo/demo-workspace.ts), or is listed below as a reviewed
 * exception with a written reason.
 *
 * Found by a source scan (comments removed): every `cron.schedule(`,
 * `setInterval(` and `.start()` call. A `.start()` in server.ts is matched to
 * the job class constructed for it. The test fails on:
 *   - a scheduler site, or a job class started in server.ts, that is not in
 *     the inventory;
 *   - an inventory entry that no longer matches a site (stale);
 *   - an "excluded" entry whose evidence is gone: the job no longer calls its
 *     selection code, or that code no longer applies the helper;
 *   - a "deferred" entry whose file now uses the helper (move it to
 *     "excluded" with its evidence).
 * The platform aggregates PR-1a covers (they are not scheduled, but select
 * across organizations) are checked the same way.
 *
 * What a static scan cannot prove:
 *   - that the helper sits in the query that actually selects organizations
 *     at run time, only that the listed code contains it where the evidence
 *     patterns say (job-demo-exclusion.test.ts runs each selection against a
 *     demo and a real organization);
 *   - schedulers reached through an alias or wrapper (`const s =
 *     cron.schedule`), recursive setTimeout loops, jobs started anywhere but
 *     a `.start()` call, or work queued by a request (PR-1b's guard covers
 *     requests);
 *   - that a new org-selecting query inside an existing job uses the helper.
 * It is a tripwire, not a proof.
 */
import fs from 'fs';
import path from 'path';
import { codeLines, codeLinesOf, withoutComments } from './helpers/source-scan';

const SRC = path.join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const rel = (file: string) => path.relative(SRC, file).split(path.sep).join('/');
const code = (file: string) => withoutComments(fs.readFileSync(path.join(SRC, file), 'utf-8'));

const SCHEDULER = /\bcron\.schedule\(|\bsetInterval\(/;
const START = /\.start\(\)/;
const HELPER_IMPORT = /from '(\.\.?\/)+demo\/demo-workspace'|from '\.\/demo-workspace'/;
const HELPER_USE = /\bDEMO_EXCLUSION_SQL\b|\bexcludeDemoOrganizationSql\(|\bisDemoOrganization\(/;

/** `pattern` must match the file's code (comments removed); with `count`, exactly that many times. */
interface Evidence { file: string; pattern: RegExp; why: string; count?: number }
type Entry =
  | { status: 'excluded'; jobClass?: string; selection: string[]; evidence: Evidence[]; reason: string }
  | { status: 'deferred' | 'not-org-selecting'; jobClass?: string; reason: string };

/**
 * Scheduler sites. Key: the file holding a `cron.schedule(`, or
 * `<file>#setInterval` / `<file>#start` for the other kinds.
 */
const INVENTORY: Record<string, Entry> = {
  'jobs/risk-score-snapshot.job.ts': {
    status: 'excluded', jobClass: 'RiskScoreSnapshotJob', selection: ['services/risk-tracking.service.ts'],
    reason: 'Daily risk snapshot per organization.',
    evidence: [
      { file: 'jobs/risk-score-snapshot.job.ts', pattern: /storeAllOrganizationSnapshots\(\)/, why: 'the job runs the snapshot loop' },
      { file: 'services/risk-tracking.service.ts', pattern: /storeAllOrganizationSnapshots\(\)[\s\S]{0,200}listRiskSnapshotOrganizations\(client\)/, why: 'the loop selects through listRiskSnapshotOrganizations' },
      { file: 'services/risk-tracking.service.ts', pattern: /function listRiskSnapshotOrganizations[\s\S]{0,300}\$\{DEMO_EXCLUSION_SQL\}/, why: 'the selection applies the helper' },
    ],
  },
  'jobs/anomaly-detection.job.ts': {
    status: 'excluded', jobClass: 'AnomalyDetectionJob', selection: ['jobs/anomaly-detection.job.ts'],
    reason: 'CloudWatch-based anomaly scan per organization.',
    evidence: [
      { file: 'jobs/anomaly-detection.job.ts', pattern: /runDetection\(\)\s*\{[\s\S]{0,800}listAnomalyDetectionOrganizations\(client\)/, why: 'the run selects through listAnomalyDetectionOrganizations' },
      { file: 'jobs/anomaly-detection.job.ts', pattern: /function listAnomalyDetectionOrganizations[\s\S]{0,300}\$\{DEMO_EXCLUSION_SQL\}/, why: 'the selection applies the helper' },
    ],
  },
  'jobs/scheduled-reports.job.ts': {
    status: 'excluded', jobClass: 'ScheduledReportsJob', selection: ['repositories/scheduled-reports.repository.ts'],
    reason: 'Due scheduled reports (email/Slack).',
    evidence: [
      { file: 'jobs/scheduled-reports.job.ts', pattern: /processScheduledReports\(\)/, why: 'the job processes due reports' },
      { file: 'services/scheduled-reports.service.ts', pattern: /processScheduledReports\(\)[\s\S]{0,400}findDueReports\(\)/, why: 'due reports come from findDueReports' },
      { file: 'repositories/scheduled-reports.repository.ts', pattern: /findDueReports\(\)[\s\S]{0,400}\$\{excludeDemoOrganizationSql\('scheduled_reports\.organization_id'\)\}/, why: 'findDueReports applies the helper' },
    ],
  },
  'jobs/weekly-ai-summary.job.ts': {
    status: 'excluded', jobClass: 'WeeklyAISummaryJob', selection: ['repositories/weekly-summary.repository.ts'],
    reason: 'Weekly summary email per organization owner.',
    evidence: [
      { file: 'jobs/weekly-ai-summary.job.ts', pattern: /getActiveOrganizationsPage\(/, why: 'the job pages organizations' },
      { file: 'jobs/weekly-ai-summary.job.ts', pattern: /getRecipients\(/, why: 'the job sends to getRecipients' },
      { file: 'repositories/weekly-summary.repository.ts', pattern: /const WEEKLY_SUMMARY_RECIPIENT_PREDICATES = `[^`]*\$\{DEMO_EXCLUSION_SQL\}`/, why: 'the shared recipient predicates apply the helper' },
      { file: 'repositories/weekly-summary.repository.ts', pattern: /getActiveOrganizationsPage\([\s\S]{0,600}\$\{WEEKLY_SUMMARY_RECIPIENT_PREDICATES\}/, why: 'the page query uses the predicates' },
      { file: 'repositories/weekly-summary.repository.ts', pattern: /getRecipients\([\s\S]{0,600}\$\{WEEKLY_SUMMARY_RECIPIENT_PREDICATES\}/, why: 'the recipient query uses the predicates' },
    ],
  },
  'jobs/grace-period-enforcement.job.ts': {
    status: 'excluded', jobClass: 'GracePeriodEnforcementJob', selection: ['jobs/grace-period-enforcement.job.ts'],
    reason: 'Restricts organizations whose payment grace period has ended.',
    evidence: [
      { file: 'jobs/grace-period-enforcement.job.ts', pattern: /UPDATE organizations o[\s\S]{0,400}\$\{DEMO_EXCLUSION_SQL\}/, why: 'the UPDATE applies the helper' },
    ],
  },
  'server.ts#setInterval': {
    status: 'excluded', selection: ['metrics/index.ts'],
    reason: 'Prometheus business gauges every 30 s, aggregated over all organizations.',
    evidence: [
      { file: 'server.ts', pattern: /setInterval\(async \(\) => \{\s*await updateBusinessMetrics\(pool\);/, why: 'the interval updates the business gauges' },
      { file: 'metrics/index.ts', pattern: /\$\{excludeDemoOrganizationSql\('[a-z_]+\.organization_id'\)\}/g, count: 9, why: 'all nine aggregate queries apply the helper' },
    ],
  },
  'jobs/resourceDiscovery.job.ts': {
    status: 'deferred', jobClass: 'ResourceDiscoveryJob',
    reason: 'DEFERRED: discovery is T1\'s file (multi-region PR 1). Add the helper to its organization query after that PR lands. Until then the demo must hold no eligible aws_accounts row in any environment where this job runs.',
  },
  'jobs/alert-sync.job.ts': {
    status: 'deferred', jobClass: 'AlertSyncJob',
    reason: 'DEFERRED: tied to the separate alert-sync fix (alert-history.service.ts:84-99 resolves firing alerts of every organization, unscoped). Production check PENDING. Behaviour unchanged here.',
  },
  'services/nl-query.service.ts#setInterval': {
    status: 'not-org-selecting',
    reason: 'In-memory cache eviction every minute; reads and writes no organization data.',
  },
  'services/scan-session.ts#start': {
    status: 'not-org-selecting',
    reason: 'A compliance scan\'s own lease heartbeat, started by that scan; touches only its lease row.',
  },
};

/** Cross-organization aggregates and startup sweeps PR-1a covers that are not scheduler sites. */
const AGGREGATES: Record<string, { evidence: Evidence[] }> = {
  'startup scan recovery (server.ts)': {
    evidence: [
      { file: 'server.ts', pattern: /new CustomComplianceService\(pool\)\.recoverInterruptedScans\(\)/, why: 'startup runs the recovery' },
      { file: 'services/custom-compliance.service.ts', pattern: /recoverInterruptedScans\(\)[\s\S]{0,600}listScanRecoveryOrganizations\(client\)/, why: 'recovery selects through listScanRecoveryOrganizations' },
      { file: 'services/custom-compliance.service.ts', pattern: /function listScanRecoveryOrganizations[\s\S]{0,300}\$\{DEMO_EXCLUSION_SQL\}/, why: 'the selection applies the helper' },
    ],
  },
  'activation funnel (GET /api/admin/activation-funnel)': {
    evidence: [
      { file: 'services/activationFunnel.service.ts', pattern: /getActivationFunnelSummary\(\)[\s\S]{0,200}listActivationFunnelOrganizations\(\)/, why: 'the summary selects through listActivationFunnelOrganizations' },
      { file: 'services/activationFunnel.service.ts', pattern: /function listActivationFunnelOrganizations[\s\S]{0,300}\$\{DEMO_EXCLUSION_SQL\}/, why: 'the selection applies the helper' },
    ],
  },
  'onboarding metrics and funnel (GET /api/onboarding/metrics, /funnel)': {
    evidence: [
      { file: 'services/onboarding.service.ts', pattern: /getMetrics\(\)[\s\S]{0,900}\$\{excludeDemoOrganizationSql\('onboarding_progress\.organization_id'\)\}/, why: 'getMetrics applies the helper' },
      { file: 'services/onboarding.service.ts', pattern: /getFunnelMetrics\(\)[\s\S]{0,900}\$\{excludeDemoOrganizationSql\('onboarding_progress\.organization_id'\)\}/, why: 'getFunnelMetrics applies the helper' },
    ],
  },
  'founding-member count (GET /api/organizations/founding-count)': {
    evidence: [
      { file: 'routes/organizations.routes.ts', pattern: /'\/founding-count'[\s\S]{0,500}\$\{DEMO_EXCLUSION_SQL\}/, why: 'the count applies the helper' },
    ],
  },
};

interface Site { key: string; file: string; line: number }

/** Every scheduler site in non-test source, and the job classes server.ts starts. */
function scan(): { sites: Site[]; startedClasses: Array<{ name: string; line: number }> } {
  const sites: Site[] = [];
  const startedClasses: Array<{ name: string; line: number }> = [];
  for (const file of sourceFiles(SRC)) {
    const name = rel(file);
    const lines = codeLines(file);
    for (const { line, text } of lines) {
      if (/\bcron\.schedule\(/.test(text)) sites.push({ key: name, file: name, line });
      if (/\bsetInterval\(/.test(text)) sites.push({ key: `${name}#setInterval`, file: name, line });
      if (START.test(text)) {
        if (name === 'server.ts') {
          const variable = text.match(/(\w+)\.start\(\)/)?.[1];
          const declaration = lines.find((l) => new RegExp(`\\b(?:const|let)\\s+${variable}\\s*=\\s*new\\s+(\\w+)\\(`).test(l.text));
          const jobClass = declaration?.text.match(/new\s+(\w+)\(/)?.[1];
          startedClasses.push({ name: jobClass ?? `<unresolved ${variable} at server.ts:${line}>`, line });
        } else {
          sites.push({ key: `${name}#start`, file: name, line });
        }
      }
    }
  }
  return { sites, startedClasses };
}

function holds(e: Evidence): boolean {
  const text = code(e.file);
  if (e.count === undefined) return new RegExp(e.pattern.source, e.pattern.flags.replace('g', '')).test(text);
  return (text.match(new RegExp(e.pattern.source, e.pattern.flags.includes('g') ? e.pattern.flags : `${e.pattern.flags}g`)) ?? []).length === e.count;
}

function failingEvidence(evidence: Evidence[]): string[] {
  return evidence.filter((e) => !holds(e)).map((e) => `${e.file}: ${e.why} (${e.pattern}${e.count === undefined ? '' : ` x${e.count}`})`);
}

describe('job demo exclusion inventory (real source)', () => {
  const { sites, startedClasses } = scan();

  it('finds the schedulers it is meant to find', () => {
    expect(sites.length).toBeGreaterThanOrEqual(9);
    expect(startedClasses.length).toBeGreaterThanOrEqual(7);
  });

  it('every scheduler site is in the inventory', () => {
    expect(sites.filter((s) => !(s.key in INVENTORY)).map((s) => `${s.file}:${s.line} (${s.key})`)).toEqual([]);
  });

  it('every job class server.ts starts is in the inventory', () => {
    const known = new Set(Object.values(INVENTORY).map((e) => e.jobClass).filter(Boolean));
    expect(startedClasses.filter((c) => !known.has(c.name)).map((c) => `server.ts:${c.line} ${c.name}`)).toEqual([]);
  });

  it('no inventory entry is stale', () => {
    const keys = new Set(sites.map((s) => s.key));
    const started = new Set(startedClasses.map((c) => c.name));
    expect(Object.entries(INVENTORY)
      .filter(([key, entry]) => !keys.has(key) || (entry.jobClass !== undefined && !started.has(entry.jobClass)))
      .map(([key]) => key)).toEqual([]);
  });

  it('every entry gives a reason', () => {
    for (const entry of Object.values(INVENTORY)) expect(entry.reason.trim().length).toBeGreaterThan(20);
  });

  it('every "excluded" job imports the shared helper in its selection code and its evidence holds', () => {
    const problems: string[] = [];
    for (const [key, entry] of Object.entries(INVENTORY)) {
      if (entry.status !== 'excluded') continue;
      for (const file of entry.selection) {
        if (!HELPER_IMPORT.test(code(file))) problems.push(`${key}: ${file} does not import demo/demo-workspace`);
      }
      problems.push(...failingEvidence(entry.evidence).map((p) => `${key}: ${p}`));
    }
    expect(problems).toEqual([]);
  });

  it('every covered aggregate applies the shared helper', () => {
    const problems: string[] = [];
    for (const [name, { evidence }] of Object.entries(AGGREGATES)) {
      for (const file of new Set(evidence.map((e) => e.file))) {
        if (file !== 'server.ts' && !HELPER_IMPORT.test(code(file))) problems.push(`${name}: ${file} does not import demo/demo-workspace`);
      }
      problems.push(...failingEvidence(evidence).map((p) => `${name}: ${p}`));
    }
    expect(problems).toEqual([]);
  });

  it('a "deferred" entry is still deferred: once its file uses the helper, move it to "excluded" with evidence', () => {
    expect(Object.entries(INVENTORY)
      .filter(([, entry]) => entry.status === 'deferred')
      .filter(([key]) => HELPER_USE.test(code(key.split('#')[0])))
      .map(([key]) => key)).toEqual([]);
  });
});

describe('inventory scan self-test', () => {
  it('finds schedulers in code and ignores comments and strings that only mention them', () => {
    const lines = codeLinesOf([
      "this.task = cron.schedule('* * * * *', run);",
      "// cron.schedule('* * * * *', run);",
      '/* setInterval(tick, 1000) */',
      'setInterval(tick, 1000);',
      "const doc = 'call setInterval later';",
      'job.start();',
    ].join('\n'));
    expect(lines.filter((l) => SCHEDULER.test(l.text)).map((l) => l.line)).toEqual([1, 4]);
    expect(lines.filter((l) => START.test(l.text)).map((l) => l.line)).toEqual([6]);
  });

  it('missing evidence, or the wrong number of uses, fails', () => {
    const missing: Evidence = { file: 'jobs/anomaly-detection.job.ts', pattern: /\$\{NOT_THE_HELPER\}/, why: 'probe' };
    const tooFew: Evidence = { file: 'metrics/index.ts', pattern: /\$\{excludeDemoOrganizationSql\(/g, count: 10, why: 'probe' };
    const exact: Evidence = { file: 'metrics/index.ts', pattern: /\$\{excludeDemoOrganizationSql\(/g, count: 9, why: 'probe' };
    expect(failingEvidence([missing, tooFew, exact])).toHaveLength(2);
  });
});
