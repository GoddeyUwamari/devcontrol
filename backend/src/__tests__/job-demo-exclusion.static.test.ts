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

/**
 * `pattern` must match the file's code (comments removed); with `count`,
 * exactly that many times. With `check`, the check's problems must be empty.
 */
interface Evidence { file: string; pattern: RegExp; why: string; count?: number; check?: (code: string) => string[] }

/**
 * The fixed list of reviewed reasons a scheduler may select no organizations.
 * A "not-org-selecting" entry must name one, and the test then PROVES it on the
 * code the scheduled callback runs (`proof.fn` in `proof.file`), after checking
 * that the scheduler really calls it (`proof.chain`). A free-text reason is not
 * accepted, and neither reason can be met by code that touches organizations.
 */
const NOT_ORG_SELECTING_REASONS = {
  IN_MEMORY_ONLY: 'the scheduled callback runs no SQL and no I/O: it only reads and writes process memory',
  OWN_LEASE_ROW_ONLY: 'the scheduled callback renews its own lease row: one fenced UPDATE of its lease table and no organization table or column',
} as const;
type NotOrgSelectingReason = keyof typeof NOT_ORG_SELECTING_REASONS;
interface Proof { reason: NotOrgSelectingReason; chain: Evidence[]; file: string; fn: string }

type Entry =
  | { status: 'excluded'; jobClass?: string; selection: string[]; evidence: Evidence[]; reason: string }
  | { status: 'deferred'; jobClass?: string; reason: string }
  | { status: 'not-org-selecting'; jobClass?: string; proof: Proof };

/** Organization tables and columns: neither reviewed reason can be met by code that names them. */
const ORGANIZATION_DATA = /\borganizations\b|\borganization_id\b|\borg_id\b|\bis_demo\b/;

/**
 * The body of function or method `fn` in `src` (comments already removed):
 * from its declaration's `{` to the matching `}`. Null when not found.
 */
function functionBody(src: string, fn: string): string | null {
  const declaration = new RegExp(`(?:\\bfunction\\s+${fn}|^[ \\t]*(?:(?:private|public|protected|static|async)\\s+)*${fn})\\s*\\(`, 'm').exec(src);
  if (!declaration) return null;
  let i = declaration.index + declaration[0].length;
  for (let depth = 1; i < src.length && depth > 0; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') depth -= 1;
  }
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j += 1) {
    if (src[j] === '{') depth += 1;
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
  }
  return null;
}

/** Why `proof` does not hold for `src` (the proof file's code), or [] when it does. */
function proofProblemsIn(src: string, proof: Proof): string[] {
  if (!Object.prototype.hasOwnProperty.call(NOT_ORG_SELECTING_REASONS, proof.reason)) {
    return [`reason ${JSON.stringify(proof.reason)} is not on the reviewed list (${Object.keys(NOT_ORG_SELECTING_REASONS).join(', ')})`];
  }
  const body = functionBody(src, proof.fn);
  if (!body) return [`${proof.fn} not found in ${proof.file}`];
  const problems: string[] = [];
  if (ORGANIZATION_DATA.test(body)) problems.push(`${proof.fn} names an organization table or column`);
  const queries = (body.match(/\.query\s*(?:<[^>]*>)?\(/g) ?? []).length;
  if (proof.reason === 'IN_MEMORY_ONLY') {
    if (queries > 0 || /\bpool\b|\bconnect\(|\bfetch\(|\baxios\b|\b(?:SELECT|INSERT|UPDATE|DELETE)\b/.test(body)) {
      problems.push(`${proof.fn} runs SQL or I/O, so it is not IN_MEMORY_ONLY`);
    }
  } else if (proof.reason === 'OWN_LEASE_ROW_ONLY') {
    if (queries !== 1) problems.push(`${proof.fn} runs ${queries} queries, not exactly one`);
    if (!/UPDATE \$\{\s*lease\.key\.table\s*\}/.test(body)) problems.push(`${proof.fn} does not UPDATE its own lease table`);
    if (!/fencing_token\s*=/.test(body)) problems.push(`${proof.fn}'s UPDATE is not fenced by its token`);
    if (/\b(?:SELECT|INSERT|DELETE)\b/.test(body.replace(/RETURNING[\s\S]*?`/g, '`'))) problems.push(`${proof.fn} does more than one UPDATE`);
  }
  return problems;
}

function proofProblems(key: string, proof: Proof | undefined): string[] {
  if (!proof) return [`${key}: "not-org-selecting" needs a proof with a reason from the reviewed list; a free-text reason is not accepted`];
  return [
    ...failingEvidence(proof.chain).map((p) => `${key}: ${p}`),
    ...proofProblemsIn(code(proof.file), proof).map((p) => `${key}: ${p}`),
  ];
}

/**
 * Every aggregate query in `src` (metrics/index.ts's code) applies the helper,
 * for each table it reads, inside that same SQL: `FROM <table>` needs
 * `${excludeDemoOrganizationSql('<table>.organization_id')}` in the same
 * template. A count is not enough: the helper moved from one query to another
 * keeps the count and must still fail here.
 */
function metricsPlacementProblems(src: string): string[] {
  const queries = [...src.matchAll(/dbPool\.query\(\s*`([^`]*)`/g)].map((m) => m[1]);
  const problems = queries.length >= 9 ? [] : [`expected at least 9 aggregate queries in updateBusinessMetrics, found ${queries.length}`];
  for (const sql of queries) {
    const ctes = new Set([...sql.matchAll(/\b([a-z_]+)\s+AS\s*\(/gi)].map((m) => m[1]));
    const tables = new Set([...sql.matchAll(/\bFROM\s+([a-z_]+)/g)].map((m) => m[1]).filter((t) => !ctes.has(t)));
    if (tables.size === 0) problems.push(`a metrics query reads no table: ${sql.trim().slice(0, 60)}`);
    for (const table of tables) {
      if (!sql.includes(`\${excludeDemoOrganizationSql('${table}.organization_id')}`)) {
        problems.push(`the metrics query on ${table} does not exclude the demo for ${table}: ${sql.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
      }
    }
  }
  return problems;
}

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
      { file: 'metrics/index.ts', pattern: /\$\{excludeDemoOrganizationSql\('[a-z_]+\.organization_id'\)\}/g, count: 9, why: 'nine helper uses' },
      { file: 'metrics/index.ts', pattern: /updateBusinessMetrics/, check: metricsPlacementProblems, why: 'every aggregate query excludes the demo for each table it reads, inside that query' },
    ],
  },
  'jobs/resourceDiscovery.job.ts': {
    status: 'deferred', jobClass: 'ResourceDiscoveryJob',
    reason: 'DEFERRED: discovery is T1\'s file (multi-region PR 1). Add the helper to its organization query after that PR lands. Until then the demo must hold no eligible aws_accounts row in any environment where this job runs.',
  },
  'jobs/alert-sync.job.ts': {
    status: 'deferred', jobClass: 'AlertSyncJob',
    reason: 'DEFERRED: tied to the separate alert-sync fix (alert-history.service.ts:84-99 resolves firing alerts of every organization, unscoped). Production check CHECKED (2026-11-14, read-only): latent, 0 rows in alert_history. Behaviour unchanged here.',
  },
  'services/nl-query.service.ts#setInterval': {
    status: 'not-org-selecting',
    proof: {
      reason: 'IN_MEMORY_ONLY', file: 'services/nl-query.service.ts', fn: 'cleanCache',
      chain: [{ file: 'services/nl-query.service.ts', pattern: /setInterval\(\(\) => this\.cleanCache\(\), /, why: 'the interval runs cleanCache only' }],
    },
  },
  'services/scan-session.ts#start': {
    status: 'not-org-selecting',
    proof: {
      reason: 'OWN_LEASE_ROW_ONLY', file: 'services/scan-lease.ts', fn: 'renewReportingAge',
      chain: [
        { file: 'services/scan-session.ts', pattern: /new LeaseHeartbeat\([^)]*\)\.start\(\)/, why: 'the scan starts its lease heartbeat' },
        { file: 'services/scan-lease.ts', pattern: /class LeaseHeartbeat[\s\S]*?async beat\(\)[\s\S]{0,600}renewReportingAge\(client, this\.lease/, why: 'each beat renews through renewReportingAge' },
      ],
    },
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
  if (e.check && e.check(text).length > 0) return false;
  if (e.count === undefined) return new RegExp(e.pattern.source, e.pattern.flags.replace('g', '')).test(text);
  return (text.match(new RegExp(e.pattern.source, e.pattern.flags.includes('g') ? e.pattern.flags : `${e.pattern.flags}g`)) ?? []).length === e.count;
}

function failingEvidence(evidence: Evidence[]): string[] {
  return evidence.filter((e) => !holds(e)).map((e) =>
    `${e.file}: ${e.why} (${e.pattern}${e.count === undefined ? '' : ` x${e.count}`})${e.check ? `: ${e.check(code(e.file)).join('; ')}` : ''}`);
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

  it('every "excluded" or "deferred" entry gives a written reason', () => {
    for (const entry of Object.values(INVENTORY)) {
      if (entry.status !== 'not-org-selecting') expect(entry.reason.trim().length).toBeGreaterThan(20);
    }
  });

  it('every "not-org-selecting" entry names a reason from the reviewed list, and its proof holds on the code the scheduler runs', () => {
    const problems: string[] = [];
    for (const [key, entry] of Object.entries(INVENTORY)) {
      if (entry.status === 'not-org-selecting') problems.push(...proofProblems(key, entry.proof));
    }
    expect(problems).toEqual([]);
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

  it('metrics placement: a helper moved from one query to another (count unchanged) fails, a new unprotected query fails', () => {
    const q = (from: string, helperFor?: string) =>
      `await dbPool.query(\`SELECT 1 FROM ${from} WHERE x = 1${helperFor ? ` AND \${excludeDemoOrganizationSql('${helperFor}.organization_id')}` : ''}\`)`;
    const nine = (moved: boolean) => [
      q('services', 'services'), q('services', 'services'),
      q('cost_recommendations', moved ? undefined : 'cost_recommendations'),
      ...Array.from({ length: 6 }, () => q('deployments', 'deployments')),
      ...(moved ? [q('services', 'services')] : []),
    ].join('\n');
    expect(metricsPlacementProblems(nine(false))).toEqual([]);
    expect(metricsPlacementProblems(nine(true))).toEqual([expect.stringContaining('the metrics query on cost_recommendations does not exclude the demo')]);
    expect(metricsPlacementProblems(`${nine(false)}\n${q('alert_history')}`)).toEqual([expect.stringContaining('on alert_history')]);
    expect(metricsPlacementProblems(`await dbPool.query(\`WITH d AS (SELECT * FROM deployments WHERE \${excludeDemoOrganizationSql('deployments.organization_id')}) SELECT 1 FROM d\`)`))
      .toEqual(['expected at least 9 aggregate queries in updateBusinessMetrics, found 1']);
  });

  it('a "not-org-selecting" proof fails for a job that touches organizations, whatever reason it names, and for a reason off the list', () => {
    const writer = 'export class ProbeJob {\n  private async sweep(): Promise<void> {\n    await this.pool.query(`UPDATE organizations SET is_active = false WHERE created_at < NOW()`);\n  }\n}';
    for (const reason of Object.keys(NOT_ORG_SELECTING_REASONS) as NotOrgSelectingReason[]) {
      expect(proofProblemsIn(writer, { reason, chain: [], file: 'jobs/probe.job.ts', fn: 'sweep' })).not.toEqual([]);
    }
    expect(proofProblemsIn(writer, { reason: 'Only tidies a cache, nothing else at all.' as NotOrgSelectingReason, chain: [], file: 'jobs/probe.job.ts', fn: 'sweep' }))
      .toEqual([expect.stringContaining('is not on the reviewed list')]);
    const memory = 'class C {\n  private cleanCache(): void {\n    for (const [k] of this.cache) this.cache.delete(k);\n  }\n}';
    expect(proofProblemsIn(memory, { reason: 'IN_MEMORY_ONLY', chain: [], file: 'x.ts', fn: 'cleanCache' })).toEqual([]);
    expect(proofProblemsIn(memory, { reason: 'IN_MEMORY_ONLY', chain: [], file: 'x.ts', fn: 'missing' })).toEqual(['missing not found in x.ts']);
  });
});
