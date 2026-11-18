/**
 * The executive brief's rules R1-R9 (brief-build.md), one test (or table) per
 * rule, on the synthetic fixtures A-E and single-fact variants of them. Pure:
 * no database, AWS, model or clock.
 */
import { Pool } from 'pg';
import {
  BANNED_WORDS,
  CLEAN_SENTENCE,
  COST_FLOOR_CLAUSE,
  COST_METHOD,
  COVERAGE_LINE,
  NOT_TRACKED_LINE,
  SERVICE_LINES_NOTE,
  SOME_FIGURES_MISSING,
  attentionItems,
  composeWeeklyBrief,
  costSection,
  deliverySection,
  footer,
  isClean,
  summarySentence,
  tiles,
  type WeeklyBrief,
} from '../rules';
import { weeklyFacts, type WeeklyFacts } from '../facts';
import { formatSavingsCurrency } from '../../../utils/formatSavingsCurrency';
import { normalizeServiceName } from '../../aws-cost.service';
import { WeeklyAISummaryJob } from '../../../jobs/weekly-ai-summary.job';
import { WEEKLY_EMAIL_PATHS } from '../../../config/weekly-email-paths';
import type {
  WeeklyConnectionHealth,
  WeeklyDORAMetrics,
  WeeklyEvidence,
  WeeklyRecommendationEvidence,
  WeeklySecurityEvidence,
  WeeklyStillDetectedEvidence,
} from '../../../repositories/weekly-summary.repository';
import {
  FIXTURE_IDS,
  FIXTURE_ORG_NAME,
  FIXTURE_URLS,
  FIXTURES,
  HEALTH_OK,
  NONE_OPEN,
  NONE_STILL_DETECTED,
  SOURCES,
  available,
  connectedEvidence,
  fixtureEvidence,
  fixtureFacts,
  noData,
  trend,
  type FixtureId,
} from '../../../jobs/__tests__/weekly-email-fixtures';

const facts = (over: Partial<WeeklyEvidence> = {}): WeeklyFacts => weeklyFacts(connectedEvidence(over));
const brief = (f: WeeklyFacts): WeeklyBrief => composeWeeklyBrief(f, { organizationName: FIXTURE_ORG_NAME, planName: 'Optimization Engine' });

const health = (h: Partial<WeeklyConnectionHealth>) => available<WeeklyConnectionHealth>(SOURCES.health, { ...HEALTH_OK, ...h });
const security = (s: WeeklySecurityEvidence) => available<WeeklySecurityEvidence>(SOURCES.security, s);
const recs = (r: Partial<WeeklyRecommendationEvidence>) => available<WeeklyRecommendationEvidence>(SOURCES.recommendations, { ...NONE_OPEN, ...r });
const still = (s: Partial<WeeklyStillDetectedEvidence>) => available<WeeklyStillDetectedEvidence>(SOURCES.still, { ...NONE_STILL_DETECTED, ...s });
const delivery = (d: WeeklyDORAMetrics) => available<WeeklyDORAMetrics>(SOURCES.delivery, d);

let job: WeeklyAISummaryJob;
beforeAll(() => {
  delete process.env.RESEND_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  job = new WeeklyAISummaryJob({} as Pool);
});

function render(f: WeeklyFacts, plan = 'Optimization Engine', organizationName: string | null = FIXTURE_ORG_NAME) {
  const data = job.buildTemplateData({
    userName: 'Alex',
    brief: composeWeeklyBrief(f, { organizationName, planName: plan }),
    organizationName,
    ...FIXTURE_URLS,
  });
  data.year = 2026;
  const { html, text } = job.renderEmail(data);
  // The HTML as a reader sees it: no style block, no tags, entities decoded.
  const htmlText = html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x3D;/g, '=').replace(/&rarr;/g, '→').replace(/&copy;/g, '©')
    .replace(/\s+/g, ' ');
  return { html, text, htmlText, subject: data.subject };
}

/** Every string the rules generated, names (organization, person, AWS service) left out (founder Q14). */
function generatedStrings(b: WeeklyBrief): string[] {
  const out: string[] = [b.subject, b.eyebrow, b.title, b.summary.bold, b.summary.plain, b.delivery.line, b.delivery.link.label, b.button.label];
  for (const t of b.tiles) out.push(t.label, t.sublabel ?? '', t.value, ...t.lines);
  for (const a of b.attention) out.push(a.title, ...a.body, a.time ?? '', a.link.label);
  if (b.cost) {
    out.push(...b.cost.lines.map(l => l.text), b.cost.link.label);
    if (b.cost.services) out.push(b.cost.services.heading, ...b.cost.services.rows.map(r => r.amount));
  }
  if (b.notConnected) out.push(...b.notConnected.status, b.notConnected.action.label, ...b.notConnected.sections.flatMap(s => [s.title, s.line]));
  out.push(...b.footer.lines, b.footer.alarms.text, b.footer.alarms.link?.label ?? '');
  return out.filter(Boolean);
}

/** Raw AWS error text with every identifier the email must never carry. */
const RAW_AWS_ERROR = 'AccessDenied: User arn:aws:sts::123456789012:assumed-role/DevControlRole/x is not authorized (External ID mismatch); Throttling; Error';
const ARN_EXAMPLE = {
  check: 'Idle RDS instance',
  resource: 'arn:aws:rds:us-east-1:123456789012:db:orders-replica',
  region: 'us-east-1',
  resolvedAt: '2026-11-10T00:00:00.000Z',
};
/** Every day final at $1, except Nov 13 ($100) with no reportState and Nov 15 not reported; Nov 6 ($50) is Nov 13's weekday a week earlier. */
const UNDETERMINED_TREND = trend(day => ({
  state: day === '2026-11-13' ? null : day >= '2026-11-15' ? 'not_reported' : 'final',
  services: day === '2026-11-13' ? { EC2: 100 } : day === '2026-11-06' ? { EC2: 50 } : day >= '2026-11-15' ? {} : { EC2: 1 },
}));

/** Variants that reach every branch of the rules at least once. */
const VARIANTS: Record<string, WeeklyFacts> = {
  ...Object.fromEntries(FIXTURE_IDS.map(id => [id, fixtureFacts(id)])),
  stale: facts({ connectionHealth: health({ state: 'not_checked_recently', lastResult: 'ok', checkedAt: '2026-11-14T06:00:00.000Z' }) }),
  notCheckedYet: facts({ connectionHealth: health({ state: 'not_checked_yet', lastResult: null, checkedAt: null }) }),
  healthUnreadable: facts({ connectionHealth: noData(SOURCES.health, 'error', 'x') }),
  lostNeverOk: facts({ connectionHealth: health({ state: 'lost', lastResult: 'lost', lastOkAt: null }), scan: noData(SOURCES.scan, 'error', 'x') }),
  preliminary: facts({ security: noData(SOURCES.security, 'unavailable', 'the security posture score is still preliminary') }),
  everythingFailed: facts({
    security: noData(SOURCES.security, 'error', 'x'),
    recommendations: noData(SOURCES.recommendations, 'error', 'x'),
    costTrend: noData(SOURCES.trend, 'error', 'x'),
    delivery: noData(SOURCES.delivery, 'error', 'x'),
    costAnalysis: noData(SOURCES.analysis, 'error', 'x'),
  }),
  noAnalysisYet: facts({ costAnalysis: available(SOURCES.analysis, { latest: null, lastCompleted: null, latestChecks: null }) }),
  stillOnlyMany: facts({ stillDetected: still({ count: 3, estimatedMonthlySavings: 0, ceilingMonthlySavings: 40, example: { check: 'Idle Instance', resource: 'i-1234567890abcdef0', region: null, resolvedAt: '2026-11-10T00:00:00.000Z' } }) }),
  subCent: facts({ recommendations: recs({ active: 1, estimatedMonthlySavings: 0, estimatedFindings: 1 }) }),
  emptyCost: facts({ costTrend: noData(SOURCES.trend, 'unavailable', 'AWS Cost Explorer returned no daily data') }),
  // H-1: every source failed with raw AWS error text carrying an ARN, an account ID and "External ID".
  failedWithIdentifiers: facts({
    connectionHealth: noData(SOURCES.health, 'error', RAW_AWS_ERROR),
    scan: noData(SOURCES.scan, 'error', RAW_AWS_ERROR),
    costAnalysis: noData(SOURCES.analysis, 'error', RAW_AWS_ERROR),
    deploymentHistory: noData(SOURCES.history, 'error', RAW_AWS_ERROR),
    costTrend: noData(SOURCES.trend, 'error', RAW_AWS_ERROR),
    delivery: noData(SOURCES.delivery, 'error', RAW_AWS_ERROR),
    security: noData(SOURCES.security, 'error', RAW_AWS_ERROR),
    recommendations: noData(SOURCES.recommendations, 'error', RAW_AWS_ERROR),
    stillDetected: noData(SOURCES.still, 'error', RAW_AWS_ERROR),
  }),
  unavailableWithIdentifiers: facts({ costTrend: noData(SOURCES.trend, 'unavailable', RAW_AWS_ERROR) }),
  // H-1: the still-detected example's resource is an ARN; only its final segment may print.
  stillDetectedArn: facts({ stillDetected: still({ count: 1, estimatedMonthlySavings: 7, example: ARN_EXAMPLE }) }),
  stillDetectedArnMany: facts({ stillDetected: still({ count: 2, estimatedMonthlySavings: 0, example: ARN_EXAMPLE }) }),
  // M-1: the cost-analysis read failed and nothing is open.
  analysisUnreadable: facts({ costAnalysis: noData(SOURCES.analysis, 'error', 'x') }),
  // L-1: Nov 13's point carries no reportState.
  undeterminedDay: facts({ costTrend: available(SOURCES.trend, { days: UNDETERMINED_TREND }) }),
  // L-2: the connection is broken and the security read failed.
  brokenSecurityFailed: facts({
    connectionHealth: health({ state: 'failing', lastResult: 'failing', lastOkAt: '2026-11-15T06:00:00.000Z' }),
    security: noData(SOURCES.security, 'error', 'x'),
  }),
};

// ── R1 ───────────────────────────────────────────────────────────────────────

describe('R1: the summary sentence', () => {
  it('A (attention): the attention facts in bold, then spend and delivery (mock example A)', () => {
    expect(summarySentence(fixtureFacts('A'))).toEqual({
      bold: '4 account-level security findings and 10 resource compliance issues are open. ' +
        '1 cost finding you marked resolved was detected again. 3 cost opportunities are open in Cost Optimization.',
      plain: "Spend for the 5 finished days was $2.31, down 26% on the same 5 days last week; 1 day is still updating and 1 isn't reported yet. 21 deployments, none failed.",
    });
  });

  it('B (clean): the clean sentence in bold, then spend and delivery (mock example B)', () => {
    expect(summarySentence(fixtureFacts('B'))).toEqual({
      bold: CLEAN_SENTENCE,
      plain: "Spend for the 5 finished days was $2.31, down 26% on the same 5 days last week; 1 day is still updating and 1 isn't reported yet. 21 deployments, none failed.",
    });
  });

  it('C (connection broken): the D-10 clause first (scan and analysis, each with its time), failed deployments in bold, missing spend stated', () => {
    const s = summarySentence(fixtureFacts('C'));
    expect(s.bold).toBe(
      "DevControl couldn't reach your AWS account (last successful check Nov 15, 06:00 UTC), so security figures below are from the last completed scan (Nov 15, 06:10 UTC) " +
      'and savings from the last completed cost analysis (Nov 15, 06:20 UTC). ' +
      '2 account-level security findings and 3 resource compliance issues are open. 2 cost opportunities are open in Cost Optimization. 4 deployments, 1 failed.'
    );
    expect(s.plain).toBe(SOME_FIGURES_MISSING);
  });

  describe('D-10: the connection-broken clause names the scan and the cost analysis separately', () => {
    const failing = (lastOkAt: string | null) => health({ state: 'failing', lastResult: 'failing', lastOkAt });
    const noScan = available(SOURCES.scan, { latest: { state: 'did_not_finish', at: '2026-11-16T06:14:00.000Z', startedAt: '2026-11-16T06:00:00.000Z' }, lastCompleted: null });
    const noAnalysis = available(SOURCES.analysis, { latest: null, lastCompleted: null, latestChecks: null });
    const clause = (over: Partial<WeeklyEvidence>) => summarySentence(facts(over)).bold.split('. ')[0].replace(/\.?$/, '.');
    it.each([
      ['both completed, never connected successfully', { connectionHealth: failing(null) },
        "DevControl couldn't reach your AWS account, so security figures below are from the last completed scan (Nov 16, 06:14 UTC) and savings from the last completed cost analysis (Nov 16, 06:20 UTC)."],
      ['no completed scan', { connectionHealth: failing('2026-11-15T06:00:00.000Z'), scan: noScan },
        "DevControl couldn't reach your AWS account (last successful check Nov 15, 06:00 UTC), so there are no security figures this week and savings below are from the last completed cost analysis (Nov 16, 06:20 UTC)."],
      ['no completed cost analysis', { connectionHealth: failing('2026-11-15T06:00:00.000Z'), costAnalysis: noAnalysis },
        "DevControl couldn't reach your AWS account (last successful check Nov 15, 06:00 UTC), so security figures below are from the last completed scan (Nov 16, 06:14 UTC) and there are no savings figures this week."],
      ['neither completed', { connectionHealth: failing('2026-11-15T06:00:00.000Z'), scan: noScan, costAnalysis: noAnalysis },
        "DevControl couldn't reach your AWS account (last successful check Nov 15, 06:00 UTC), so there are no security or savings figures this week."],
      ['neither readable', { connectionHealth: failing('2026-11-15T06:00:00.000Z'), scan: noData(SOURCES.scan, 'error', 'x'), costAnalysis: noData(SOURCES.analysis, 'error', 'x') },
        "DevControl couldn't reach your AWS account (last successful check Nov 15, 06:00 UTC)."],
    ] as Array<[string, Partial<WeeklyEvidence>, string]>)('%s', (_name, over, expected) => {
      expect(clause(over)).toBe(expected);
    });
    it('L-2: security read failed or preliminary: the no-security-figures variant, never "security figures below are from the last completed scan"', () => {
      expect(clause({ connectionHealth: failing('2026-11-15T06:00:00.000Z'), security: noData(SOURCES.security, 'error', 'x') })).toBe(
        "DevControl couldn't reach your AWS account (last successful check Nov 15, 06:00 UTC), so there are no security figures this week and savings below are from the last completed cost analysis (Nov 16, 06:20 UTC)."
      );
      expect(clause({ connectionHealth: failing(null), security: noData(SOURCES.security, 'unavailable', 'the security posture score is still preliminary'), costAnalysis: noAnalysis })).toBe(
        "DevControl couldn't reach your AWS account, so there are no security or savings figures this week."
      );
      const f = VARIANTS.brokenSecurityFailed;
      expect(tiles(f)[0]).toMatchObject({ value: '—', lines: ["Couldn't retrieve this week"] });
      const { htmlText, text } = render(f);
      for (const out of [summarySentence(f).bold, htmlText, text]) {
        expect(out).not.toContain('security figures below are from the last completed scan');
        expect(out).toContain('there are no security figures this week');
      }
    });
    it('the old single "from the last completed scan" wording for both is gone', () => {
      for (const name of Object.keys(VARIANTS)) expect(summarySentence(VARIANTS[name]).bold).not.toMatch(/security and savings below/);
    });
  });

  it('stale connection: a plain sentence', () => {
    expect(summarySentence(VARIANTS.stale).plain).toMatch(/^DevControl hasn't checked your AWS connection since Nov 14\. /);
  });

  it.each(Object.keys(VARIANTS))('%s: no generated string uses a judging word', (name) => {
    const b = brief(VARIANTS[name]);
    const { text } = render(VARIANTS[name]);
    const pattern = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'i');
    for (const s of generatedStrings(b)) expect(s).not.toMatch(pattern);
    // The whole plain-text part too, with the names the email repeats removed.
    const scrubbed = text.split(FIXTURE_ORG_NAME).join('').split('Alex').join('');
    expect(scrubbed).not.toMatch(pattern);
  });
});

// ── R2 ───────────────────────────────────────────────────────────────────────

describe('R2: attention items', () => {
  it('C: all four, in the fixed order, numbered 1-4', () => {
    const items = attentionItems(fixtureFacts('C'));
    expect(items.map(i => [i.number, i.title])).toEqual([
      [1, "DevControl couldn't reach your AWS account."],
      [2, 'Security · 5 open findings'],
      [3, 'Cost · 2 open opportunities'],
      [4, 'Delivery · 1 failed deployment'],
    ]);
    expect(items[0]).toMatchObject({ body: ['Last successful check: Nov 15, 06:00 UTC.'], link: { label: 'Open Connect AWS →', path: '/connect-aws' } });
    expect(items[1]).toMatchObject({
      body: ['2 account-level (security groups, IAM) · 3 resource compliance (encryption, backups, tagging).'],
      time: 'Last completed scan Nov 15, 06:10 UTC',
      link: { label: 'Review findings →', path: '/security' },
    });
    expect(items[2].body).toEqual(['2 open opportunities, about $120/mo estimated.', "This week's analysis didn't finish."]);
    expect(items[3]).toMatchObject({ body: [], link: { label: 'See deployments →', path: '/deployments' } });
  });

  it('A: security then cost (still detected first, then open with the page\'s ceiling wording)', () => {
    const items = attentionItems(fixtureFacts('A'));
    expect(items.map(i => i.title)).toEqual(['Security · 14 open findings', 'Cost · 1 resolved finding detected again · 3 open opportunities']);
    expect(items[0].time).toBe('Latest scan Nov 16, 06:14 UTC');
    expect(items[1].body).toEqual([
      'Unattached EBS volume on build-cache-volume (us-east-1). You resolved it Nov 12; the latest analysis still sees it. About $4/mo, estimated.',
      '3 open opportunities, about $42/mo estimated; 1 has no dollar estimate yet.',
      'Plus up to $18/mo in estimated ceilings, not expected savings.',
    ]);
    expect(items[1].link).toEqual({ label: 'Review in Cost Optimization →', path: '/cost-optimization' });
  });

  it('one still-detected finding alone: "Review it in Cost Optimization →"', () => {
    const items = attentionItems(facts({ stillDetected: available(SOURCES.still, fixtureEvidence('A').stillDetected.data!) }));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Cost · 1 resolved finding detected again');
    expect(items[0].link.label).toBe('Review it in Cost Optimization →');
  });

  it('several still detected: the first named, "and N more", the ceiling in the page\'s words', () => {
    expect(attentionItems(VARIANTS.stillOnlyMany)[0].body).toEqual([
      'Idle Instance on i-1234567890abcdef0 and 2 more. You resolved them; the latest analysis still sees them.',
      'Plus up to $40/mo in estimated ceilings, not expected savings.',
    ]);
  });

  it('zero-segment rule: a security part that is 0 is left out of the item and the summary; the tile keeps both', () => {
    const accountOnly = facts({ security: security({ score: 80, accountLevelFindings: 1, resourceComplianceIssues: 0 }) });
    const resourceOnly = facts({ security: security({ score: 80, accountLevelFindings: 0, resourceComplianceIssues: 6 }) });
    expect(attentionItems(accountOnly)[0]).toMatchObject({ title: 'Security · 1 open finding', body: ['1 account-level (security groups, IAM).'] });
    expect(attentionItems(resourceOnly)[0]).toMatchObject({ title: 'Security · 6 open findings', body: ['6 resource compliance (encryption, backups, tagging).'] });
    expect(summarySentence(accountOnly).bold).toBe('1 account-level security finding is open.');
    expect(summarySentence(resourceOnly).bold).toBe('6 resource compliance issues are open.');
    expect(tiles(accountOnly)[0].lines[0]).toBe('1 account · 0 compliance');
    // No item body or summary sentence, in any variant, carries a "0 <part>" segment.
    for (const name of Object.keys(VARIANTS)) {
      const f = VARIANTS[name];
      const text = [summarySentence(f).bold, summarySentence(f).plain, ...attentionItems(f).flatMap(i => [i.title, ...i.body])].join(' ');
      expect([name, text]).not.toEqual([name, expect.stringMatching(/(^|[\s·(])0 [a-z]/)]);
    }
  });

  it('an empty item never renders, and with none the section heading does not either (B)', () => {
    expect(attentionItems(fixtureFacts('B'))).toEqual([]);
    expect(render(fixtureFacts('B')).html).not.toContain('NEEDS YOUR ATTENTION');
    expect(render(fixtureFacts('A')).html).toContain('NEEDS YOUR ATTENTION');
  });

  it('a stale, unchecked or unreadable connection is not an attention item (Q1)', () => {
    for (const name of ['stale', 'notCheckedYet', 'healthUnreadable']) {
      expect(attentionItems(VARIANTS[name]).map(i => i.title)).toEqual([]);
    }
  });

  it('no item says "Critical" and none claims "new this week" (no reliable first-seen data, Stage 1 §5)', () => {
    for (const id of FIXTURE_IDS) {
      for (const item of attentionItems(fixtureFacts(id))) {
        expect([item.title, ...item.body].join(' ')).not.toMatch(/critical|new this week/i);
      }
    }
  });
});

// ── R3 ───────────────────────────────────────────────────────────────────────

describe('R3: the clean state, one condition at a time', () => {
  const clean = facts();
  it('B is clean: the clean sentence, the clean tiles, no attention section', () => {
    expect(isClean(clean)).toBe(true);
    const b = brief(clean);
    expect(b.summary.bold).toBe(CLEAN_SENTENCE);
    expect(b.tiles[0]).toMatchObject({ value: '0 open', lines: ['Posture score 92/100'] });
    expect(b.tiles[2]).toEqual({ label: 'ESTIMATED SAVINGS', sublabel: null, value: 'Nothing to review', lines: ['all 7 active checks ran'] });
  });

  const breakers: Record<string, Partial<WeeklyEvidence>> = {
    'connection failing': { connectionHealth: health({ state: 'failing', lastResult: 'failing' }) },
    'connection stale (last result OK)': { connectionHealth: health({ state: 'not_checked_recently', lastResult: 'ok' }) },
    'connection not checked yet': { connectionHealth: health({ state: 'not_checked_yet', lastResult: null, checkedAt: null }) },
    'connection health unreadable': { connectionHealth: noData(SOURCES.health, 'error', 'x') },
    '1 open account-level finding': { security: security({ accountLevelFindings: 1, resourceComplianceIssues: 0 }) },
    '1 open resource compliance issue': { security: security({ accountLevelFindings: 0, resourceComplianceIssues: 1 }) },
    'security unreadable': { security: noData(SOURCES.security, 'error', 'x') },
    'security preliminary': { security: noData(SOURCES.security, 'unavailable', 'the security posture score is still preliminary') },
    '1 open cost finding': { recommendations: recs({ active: 1, estimatedMonthlySavings: 5, estimatedFindings: 1 }) },
    '1 resolved cost finding still detected': { stillDetected: still({ count: 1, estimatedMonthlySavings: 2 }) },
    'savings unreadable': { recommendations: noData(SOURCES.recommendations, 'error', 'x') },
    'still-detected unreadable': { stillDetected: noData(SOURCES.still, 'error', 'x') },
    'no cost analysis has ever completed': { costAnalysis: available(SOURCES.analysis, { latest: null, lastCompleted: null, latestChecks: null }) },
    '1 failed deployment': { delivery: delivery({ deploymentCount: 3, successfulDeployments: 2, failedDeployments: 1 }) },
    'deployments unreadable': { delivery: noData(SOURCES.delivery, 'error', 'x') },
    'Cost Explorer unreadable': { costTrend: noData(SOURCES.trend, 'error', 'x') },
    'cost analysis unreadable (M-1)': { costAnalysis: noData(SOURCES.analysis, 'error', 'x') },
  };

  it.each(Object.keys(breakers))('%s alone breaks it', (name) => {
    const f = facts(breakers[name]);
    expect(isClean(f)).toBe(false);
    expect(summarySentence(f).bold).not.toContain(CLEAN_SENTENCE);
    expect(render(f).html).not.toContain(CLEAN_SENTENCE);
  });

  it('M-1: a failed cost-analysis read with nothing open is "couldn\'t be retrieved", never measured or "Nothing to review"', () => {
    const f = VARIANTS.analysisUnreadable;
    expect(f.analysis).toEqual({ kind: 'unreadable' });
    expect(f.savings).toEqual({ state: 'error' });
    expect(isClean(f)).toBe(false);
    expect(tiles(f)[2]).toEqual({ label: 'ESTIMATED SAVINGS', sublabel: null, value: '—', lines: ["Couldn't retrieve this week"] });
    expect(summarySentence(f).plain).toContain(SOME_FIGURES_MISSING);
    expect(summarySentence(f).bold).toBe('');
    const { htmlText, text } = render(f);
    for (const out of [htmlText, text]) {
      expect(out).not.toContain('Nothing to review');
      expect(out).not.toContain(CLEAN_SENTENCE);
      expect(out).toContain("Couldn't retrieve this week");
      expect(out).toContain(SOME_FIGURES_MISSING);
    }
  });

  it('M-1: with something open, a failed cost-analysis read still shows what is open (the counts are read, only the date is not)', () => {
    const f = facts({ costAnalysis: noData(SOURCES.analysis, 'error', 'x'), recommendations: recs({ active: 2, estimatedMonthlySavings: 30, estimatedFindings: 2 }) });
    expect(f.savings).toMatchObject({ state: 'available', open: { count: 2 }, measured: true });
    expect(tiles(f)[2]).toMatchObject({ sublabel: 'Open opportunities', value: '$30/mo' });
    expect(footer(f).lines[2]).toBe("The date of the last cost analysis couldn't be retrieved.");
  });
});

// ── R4 ───────────────────────────────────────────────────────────────────────

describe('R4: spend is finished days only', () => {
  it('A: the total is Nov 9-13 only; the updating day is listed with its amount so far and the unreported day by date', () => {
    const f = fixtureFacts('A');
    expect(f.cost).toMatchObject({ finished: { total: 2.31 }, updating: { days: ['2026-11-14'], total: 0.26 }, notReported: ['2026-11-15'] });
    expect(costSection(f).lines.map(l => l.text)).toEqual([
      'Finished days, Nov 9–13: $2.31. Same 5 days last week (Nov 2–6): $3.12. Down 26%.',
      'Still updating, Nov 14: $0.26 so far. Not included in the comparison.',
      'Not reported by Cost Explorer yet, Nov 15.',
    ]);
    expect(costSection(f).lines[0].strong).toBe('$2.31');
    expect(tiles(f)[1]).toEqual({ label: 'AWS SPEND · 5 FINISHED DAYS', sublabel: 'Nov 9–13', value: '$2.31', lines: ['Down 26% on the same days', '+ 1 day still updating · 1 not reported yet'] });
  });

  it('D: fewer finished days a week earlier -> no percentage, the approved reason', () => {
    const f = fixtureFacts('D');
    expect(f.cost).toMatchObject({ comparison: { kind: 'mismatch', previousFinished: 1 } });
    expect(costSection(f).lines.map(l => l.text)).toEqual([
      'Finished days, Nov 9–11: $2.25.',
      "No week-over-week comparison: DevControl has 1 finished day from last week, not 3, so the two weeks don't match.",
      'Still updating, Nov 12: $0.06 so far. Not included in the comparison.',
      'Not reported by Cost Explorer yet, Nov 13–15.',
    ]);
    expect(tiles(f)[1].lines).toEqual(['No comparison yet (see Cost)', '+ 1 day still updating · 3 not reported yet']);
    expect(summarySentence(f).plain).toContain("Spend for the 3 finished days was $2.25; 1 day is still updating and 3 aren't reported yet.");
  });

  describe('D-2: updating and not-reported days are counted and named separately; a 0 part is left out', () => {
    // Nov 9-15: `u` updating days then `r` not-reported days at the end of the week, the rest finished.
    const split = (u: number, r: number) => {
      const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
      const notReported = week.slice(7 - r);
      const updating = week.slice(7 - r - u, 7 - r);
      return facts({ costTrend: available(SOURCES.trend, { days: trend(day => ({
        state: notReported.includes(day) ? 'not_reported' : updating.includes(day) ? 'updating' : 'final',
        services: notReported.includes(day) ? {} : { EC2: 1 },
      })) }) });
    };
    it.each([
      [1, 3, "1 day is still updating and 3 aren't reported yet", '+ 1 day still updating · 3 not reported yet'],
      [2, 1, "2 days are still updating and 1 isn't reported yet", '+ 2 days still updating · 1 not reported yet'],
      [2, 0, '2 days are still updating', '+ 2 days still updating'],
      [1, 0, '1 day is still updating', '+ 1 day still updating'],
      [0, 1, "1 day isn't reported yet", '+ 1 day not reported yet'],
      [0, 3, "3 days aren't reported yet", '+ 3 days not reported yet'],
    ] as Array<[number, number, string, string]>)('%i updating, %i not reported', (u, r, sentence, tile) => {
      const f = split(u, r);
      expect(summarySentence(f).plain).toMatch(new RegExp(`; ${sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. `));
      expect(tiles(f)[1].lines[1]).toBe(tile);
      // The Cost section names each kind on its own line, only when there is one.
      const lines = costSection(f).lines.map(l => l.text);
      expect(lines.some(l => l.startsWith('Still updating, '))).toBe(u > 0);
      expect(lines.some(l => l.startsWith('Not reported by Cost Explorer yet, '))).toBe(r > 0);
    });
    it('every day finished: no unfinished part anywhere', () => {
      const f = split(0, 0);
      expect(tiles(f)[1].lines).toHaveLength(1);
      expect(summarySentence(f).plain).not.toMatch(/updating|reported/);
    });
  });

  it('a $0 previous week: no percentage, and the reason says so', () => {
    const days = trend(day => ({ state: day >= '2026-11-14' ? 'not_reported' : 'final', services: day >= '2026-11-09' ? { EC2: 1 } : {} }));
    const f = facts({ costTrend: available(SOURCES.trend, { days }) });
    expect(f.cost).toMatchObject({ comparison: { kind: 'previous_zero' } });
    expect(costSection(f).lines[1].text).toBe('No week-over-week comparison: the same 5 days last week (Nov 2–6) total $0.00.');
  });

  it('no finished day this week: "No finished days yet this week · $X so far, still updating", no percentage', () => {
    const days = trend(day => (day >= '2026-11-10' ? { state: 'not_reported', services: {} } : day === '2026-11-09' ? { state: 'updating', services: { EC2: 0.06 } } : { state: 'final', services: { EC2: 1 } }));
    const f = facts({ costTrend: available(SOURCES.trend, { days }) });
    expect(costSection(f).lines[0].text).toBe('No finished days yet this week · $0.06 so far, still updating.');
    expect(tiles(f)[1]).toMatchObject({ label: 'AWS SPEND · 0 FINISHED DAYS', value: 'No finished days yet', lines: ['$0.06 so far, still updating'] });
    expect(summarySentence(f).plain).toContain('No finished days yet this week · $0.06 so far, still updating.');
    expect(JSON.stringify([brief(f).tiles[1], brief(f).cost, summarySentence(f).plain.split('.')[0]])).not.toMatch(/\d%/);
  });

  it("each day's state is the trend point's own reportState, never a calendar rule", () => {
    // An 'updating' day 6 days back and a 'final' yesterday: the email follows the points.
    const days = trend(day => ({ state: day === '2026-11-10' ? 'updating' : day >= '2026-11-11' ? 'final' : 'final', services: { EC2: 1 } }));
    const f = facts({ costTrend: available(SOURCES.trend, { days }) });
    expect(f.cost).toMatchObject({ updating: { days: ['2026-11-10'] }, finished: { days: ['2026-11-09', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'] } });
    // A point with no state (an older cached shape) is never counted as finished.
    const noState = trend(() => ({ state: null, services: { EC2: 1 } }));
    expect(facts({ costTrend: available(SOURCES.trend, { days: noState }) }).cost).toMatchObject({ finished: { days: [] } });
  });

  it('L-1: a point with no reportState is "Not determined yet": out of every total and comparison, dates only, no amount, no %', () => {
    const f = VARIANTS.undeterminedDay;
    expect(f.cost).toMatchObject({
      finished: { days: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-14'], total: 5 },
      updating: { days: [] },
      notReported: ['2026-11-15'],
      undetermined: ['2026-11-13'],
      // Nov 13 ($100) and its weekday a week earlier, Nov 6 ($50), are in neither total.
      comparison: { kind: 'percent', previousDays: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-07'], previousTotal: 5, changePercent: 0 },
    });
    const lines = costSection(f).lines.map(l => l.text);
    expect(lines).toEqual([
      'Finished days, Nov 9–12, Nov 14: $5.00. Same 5 days last week (Nov 2–5, Nov 7): $5.00. Unchanged.',
      'Not reported by Cost Explorer yet, Nov 15.',
      'Not determined yet, Nov 13.',
    ]);
    // Never called "not reported", never given an amount or a percentage.
    expect(lines.filter(l => l.includes('Nov 13'))).toEqual(['Not determined yet, Nov 13.']);
    expect(lines[2]).not.toMatch(/\$|%/);
    const { htmlText, text } = render(f);
    for (const out of [htmlText, text]) {
      expect(out).toContain('Not determined yet, Nov 13.');
      expect(out).not.toMatch(/\$100|\$105|\$50\b|\$55/);
    }
    // Every point without a state: no finished day, and the tile says not determined, not "not reported".
    const allNull = facts({ costTrend: available(SOURCES.trend, { days: trend(() => ({ state: null, services: { EC2: 1 } })) }) });
    expect(allNull.cost).toMatchObject({ finished: { days: [] }, notReported: [], undetermined: expect.arrayContaining(['2026-11-09', '2026-11-15']) });
    expect(tiles(allNull)[1]).toMatchObject({ value: 'No finished days yet', lines: ['Not determined yet'] });
    expect(costSection(allNull).lines.map(l => l.text)).toEqual(['No finished days yet this week.', 'Not determined yet, Nov 9–15.']);
  });

  it('a $0 finished total adds the credits note (F5); otherwise it is not shown', () => {
    const days = trend(day => ({ state: day >= '2026-11-14' ? 'not_reported' : 'final', services: {} }));
    expect(costSection(facts({ costTrend: available(SOURCES.trend, { days }) })).lines.map(l => l.text))
      .toContain('Cost Explorer reported $0.00 for these days. If AWS credits cover your usage, it shows $0 here.');
    expect(costSection(fixtureFacts('A')).lines.map(l => l.text).join(' ')).not.toContain('credits cover');
  });

  it('a failed Cost Explorer read is never $0', () => {
    const f = fixtureFacts('C');
    expect(costSection(f).lines.map(l => l.text)).toEqual(["AWS Cost Explorer spend for Nov 9–15 couldn't be retrieved."]);
    expect(tiles(f)[1]).toEqual({ label: 'AWS SPEND', sublabel: null, value: '—', lines: ["Couldn't retrieve this week"] });
  });
});

// ── R5 ───────────────────────────────────────────────────────────────────────

describe('R5: service lines', () => {
  it('A: the 3 largest changes vs the same days, signs always shown, $0.00 changes left out, chart names', () => {
    expect(costSection(fixtureFacts('A')).services).toEqual({
      heading: 'Change in spend vs the same days last week',
      rows: [
        { service: normalizeServiceName('Amazon Relational Database Service'), amount: '−$0.60' },
        { service: normalizeServiceName('Amazon Elastic Compute Cloud - Compute'), amount: '−$0.46' },
        { service: normalizeServiceName('AmazonCloudWatch'), amount: '+$0.25' },
      ],
    });
    // S3 changed by $0.00: not listed.
    expect(costSection(fixtureFacts('A')).services!.rows.map(r => r.service)).not.toContain(normalizeServiceName('Amazon Simple Storage Service'));
  });

  it('D (no comparison): totals for the finished days, labelled as not changes', () => {
    expect(costSection(fixtureFacts('D')).services).toEqual({
      heading: 'Total spend by service, finished days (not changes)',
      rows: [
        { service: normalizeServiceName('Amazon Elastic Compute Cloud - Compute'), amount: '$1.80' },
        { service: normalizeServiceName('Amazon Simple Storage Service'), amount: '$0.36' },
        { service: normalizeServiceName('AmazonCloudWatch'), amount: '$0.09' },
      ],
    });
  });

  it('a day involved with no per-service data: the block is left out', () => {
    const days = fixtureEvidence('A').costTrend.data!.days.map(d => (d.date === '2026-11-03' ? { ...d, byService: null } : d));
    expect(costSection(facts({ costTrend: available(SOURCES.trend, { days }) })).services).toBeNull();
  });

  it('the footer explains per-service figures exactly when a block is shown (founder Q8 fallback)', () => {
    expect(footer(fixtureFacts('A')).lines[3]).toBe(`${COST_METHOD} ${COST_FLOOR_CLAUSE} ${SERVICE_LINES_NOTE}`);
    expect(footer(fixtureFacts('C')).lines[3]).toBe(`${COST_METHOD} ${COST_FLOOR_CLAUSE}`);
  });
});

// ── R6 ───────────────────────────────────────────────────────────────────────

describe("R6: savings use the Cost Optimization page's formatter", () => {
  it('A: open opportunities with their estimate, then the still-detected line (C8 estimate)', () => {
    expect(tiles(fixtureFacts('A'))[2]).toEqual({
      label: 'ESTIMATED SAVINGS', sublabel: 'Open opportunities', value: '$42/mo', lines: ['1 still detected · about $4/mo estimated'],
    });
  });

  it('open findings with no estimate: "N open · no dollar estimate yet", never "$0/mo"', () => {
    expect(tiles(fixtureFacts('D'))[2].value).toBe('2 open · no dollar estimate yet');
    for (const name of Object.keys(VARIANTS)) {
      const f = VARIANTS[name];
      if (f.savings.state === 'available' && f.savings.open.count > 0) expect(tiles(f)[2].value).not.toBe('$0/mo');
    }
  });

  it('a positive estimate that rounds to $0.00: "<$0.01/mo" (founder Q7)', () => {
    expect(tiles(VARIANTS.subCent)[2].value).toBe('<$0.01/mo');
  });

  it('every other figure is formatSavingsCurrency itself (whole dollars at $1 and above)', () => {
    for (const amount of [0.48, 1, 12.5, 1234.5]) {
      const f = facts({ recommendations: recs({ active: 1, estimatedMonthlySavings: amount, estimatedFindings: 1 }) });
      expect(tiles(f)[2].value).toBe(`${formatSavingsCurrency(amount)}/mo`);
    }
  });

  it('$0/mo only when nothing is open (still-detected only)', () => {
    const f = facts({ stillDetected: still({ count: 2, estimatedMonthlySavings: 9 }) });
    expect(tiles(f)[2]).toMatchObject({ value: '$0/mo', lines: ['2 still detected · about $9/mo estimated'] });
  });

  it('D-6: a still-detected estimate of $0.00 after rounding shows "N still detected" with no amount, never "no dollar estimate yet"', () => {
    for (const estimate of [0, 0.004]) {
      const f = facts({ stillDetected: still({ count: 2, estimatedMonthlySavings: estimate, example: { check: 'Idle Instance', resource: 'i-1234567890abcdef0', region: null, resolvedAt: '2026-11-10T00:00:00.000Z' } }) });
      expect(tiles(f)[2].lines).toEqual(['2 still detected']);
      expect(attentionItems(f)[0].body).toEqual(['Idle Instance on i-1234567890abcdef0 and 1 more. You resolved them; the latest analysis still sees them.']);
      const one = facts({ stillDetected: still({ count: 1, estimatedMonthlySavings: estimate, example: { check: 'Idle Instance', resource: 'i-1234567890abcdef0', region: null, resolvedAt: '2026-11-10T00:00:00.000Z' } }) });
      expect(attentionItems(one)[0].body).toEqual(['Idle Instance on i-1234567890abcdef0. You resolved it Nov 10; the latest analysis still sees it.']);
    }
    // A cent or more keeps the amount.
    expect(tiles(facts({ stillDetected: still({ count: 2, estimatedMonthlySavings: 0.01 }) }))[2].lines).toEqual(['2 still detected · about $0.01/mo estimated']);
    for (const name of Object.keys(VARIANTS)) {
      const b = brief(VARIANTS[name]);
      const stillText = [...b.tiles.flatMap(t => t.lines), ...b.attention.flatMap(a => a.body)].filter(s => /still (detected|sees)/.test(s));
      for (const s of stillText) expect(s).not.toMatch(/no dollar estimate yet/i);
    }
  });
});

// ── R7, R8 ───────────────────────────────────────────────────────────────────

describe('R7: the security tile leads with the open count', () => {
  it('open count, then the split, then the score; no score line below the plan', () => {
    expect(tiles(fixtureFacts('A'))[0]).toEqual({ label: 'SECURITY', sublabel: null, value: '14 open', lines: ['4 account · 10 compliance', 'Posture score 72/100'] });
    expect(tiles(fixtureFacts('C'))[0]).toEqual({ label: 'SECURITY', sublabel: null, value: '5 open', lines: ['2 account · 3 compliance'] });
  });
});

describe('R8: delivery', () => {
  const line = (d: WeeklyDORAMetrics, anyRecorded = true) =>
    deliverySection(facts({ delivery: delivery(d), deploymentHistory: available(SOURCES.history, { anyRecorded }) }));
  it.each([
    ['all finished, on plan', { deploymentCount: 21, successfulDeployments: 20, failedDeployments: 1, changeFailureRate: 4.8 }, '21 deployments · 1 failed · 4.8% change failure rate'],
    ['some unfinished, on plan', { deploymentCount: 5, successfulDeployments: 3, failedDeployments: 1, changeFailureRate: 25 }, '5 deployments · 1 failed · 25% change failure rate (of 4 finished)'],
    ['none finished, on plan', { deploymentCount: 2, successfulDeployments: 0, failedDeployments: 0, changeFailureRate: null }, '2 deployments · 0 failed'],
    ['below the plan: no rate, no upsell', { deploymentCount: 4, successfulDeployments: 3, failedDeployments: 1 }, '4 deployments · 1 failed'],
    ['one deployment', { deploymentCount: 1, successfulDeployments: 1, failedDeployments: 0, changeFailureRate: 0 }, '1 deployment · 0 failed · 0% change failure rate'],
  ] as Array<[string, WeeklyDORAMetrics, string]>)('%s', (_name, d, expected) => {
    expect(line(d).line).toBe(expected);
  });

  it('0 deployments: one line; "Record a deployment" only when none was ever recorded', () => {
    const none: WeeklyDORAMetrics = { deploymentCount: 0, successfulDeployments: 0, failedDeployments: 0 };
    expect(line(none)).toEqual({ line: 'No deployments recorded in DevControl this week.', link: { label: 'See deployments →', path: '/deployments' } });
    expect(line(none, false).link.label).toBe('Record a deployment on the Deployments page →');
  });
});

// ── R9 ───────────────────────────────────────────────────────────────────────

describe('R9: footer', () => {
  it('A: provenance times, method, coverage, not tracked, then the alarms link', () => {
    expect(footer(fixtureFacts('A'))).toEqual({
      lines: [
        'AWS connection: OK · checked Nov 16, 06:02 UTC.',
        'Security figures are from the latest scan, completed Nov 16, 06:14 UTC.',
        'Savings are from the cost analysis completed Nov 16, 06:20 UTC.',
        `${COST_METHOD} ${COST_FLOOR_CLAUSE} ${SERVICE_LINES_NOTE}`,
        COVERAGE_LINE,
        NOT_TRACKED_LINE,
      ],
      alarms: { text: '', link: { label: 'Your active CloudWatch alarms are on Operational Health →', path: '/admin/monitoring' } },
    });
    expect(NOT_TRACKED_LINE).toBe('Lead time for changes and time to restore service: not tracked.');
    expect(COVERAGE_LINE).toBe("Security covers DevControl's own configuration checks, not AWS Security Hub. Savings are estimates, not confirmed billing savings.");
  });

  it("C: the connection, the unfinished scan and analysis, each with the time the figures come from (F2, F9)", () => {
    expect(footer(fixtureFacts('C')).lines.slice(0, 3)).toEqual([
      "AWS connection: DevControl couldn't reach your account. Last successful check: Nov 15, 06:00 UTC.",
      "The latest scan didn't finish (Nov 16, 06:14 UTC); security figures are from the last completed scan, Nov 15, 06:10 UTC.",
      "Savings are from the last completed cost analysis, Nov 15, 06:20 UTC. This week's analysis didn't finish.",
    ]);
  });

  it('the existing unsubscribe, preferences and legal lines are unchanged, in HTML and text', () => {
    const { html, text } = render(fixtureFacts('A'));
    for (const s of [
      'This is your weekly automated summary from DevControl.',
      `>Unsubscribe</a>`, '>Email Preferences</a>', '>Privacy Policy</a>',
      `You're receiving this because you're an owner of ${FIXTURE_ORG_NAME} and weekly summaries are on in your notification settings.`,
      'DevControl, Inc.<br>', 'Questions? Email <a href="mailto:support@getdevcontrol.com"',
      '&copy; 2026 DevControl. All rights reserved.',
    ]) expect(html).toContain(s);
    expect(text).toContain(`Unsubscribe: ${FIXTURE_URLS.unsubscribeUrl}`);
    expect(text).toContain('Email Preferences: https://app.example.test/settings/notifications');
    expect(text).toContain('Privacy Policy: https://app.example.test/legal/privacy');
  });

  it('the Alerts section is gone (approved); its link lives in the footer, last before the legal lines', () => {
    const { html, text } = render(fixtureFacts('A'));
    expect(html).not.toMatch(/ALERTS|Alert history|Coming soon/);
    expect(html).toContain('href="https://app.example.test/admin/monitoring"');
    expect(text.indexOf('Your active CloudWatch alarms are on Operational Health: https://app.example.test/admin/monitoring'))
      .toBeLessThan(text.indexOf('This is your weekly automated summary from DevControl.'));
  });
});

// ── The not-connected layout (founder Q3) ────────────────────────────────────

describe('not connected (E): the short layout with today\'s strings', () => {
  it('no tiles, no attention, no cost section; the status box, the three "Not connected" lines, delivery', () => {
    const b = brief(fixtureFacts('E'));
    expect(b.layout).toBe('not_connected');
    expect(b.tiles).toEqual([]);
    expect(b.attention).toEqual([]);
    expect(b.cost).toBeNull();
    expect(b.summary).toEqual({ bold: '', plain: `No AWS account is connected to ${FIXTURE_ORG_NAME} yet, so this week has no spend, security or savings data.` });
    expect(b.notConnected).toEqual({
      status: ['AWS connection: not connected.', 'DevControl connects with a read-only role in your AWS account.'],
      action: { label: 'Connect AWS →', path: '/connect-aws' },
      sections: [
        { title: 'COSTS', line: 'Not connected. Cost Explorer spend appears here after you connect AWS.' },
        { title: 'SECURITY', line: "Not connected. DevControl's security checks run after you connect AWS." },
        { title: 'ESTIMATED SAVINGS', line: 'Not connected. Savings checks run after you connect AWS.' },
      ],
    });
    expect(b.delivery.line).toBe('No deployments recorded in DevControl this week.');
    expect(b.footer).toEqual({ lines: [NOT_TRACKED_LINE], alarms: { text: 'Active CloudWatch alarms appear on Operational Health once AWS is connected.', link: null } });
    expect(b.button).toEqual({ label: 'Open DevControl →', path: '/dashboard', style: 'link' });
  });
});

describe('header', () => {
  it.each(FIXTURE_IDS as unknown as FixtureId[])('%s: eyebrow, the window as the title, org and plan', (id) => {
    const b = composeWeeklyBrief(fixtureFacts(id), { organizationName: FIXTURE_ORG_NAME, planName: FIXTURES[id].plan });
    expect([b.eyebrow, b.title, b.orgLine]).toEqual(['DEVCONTROL WEEKLY SUMMARY', 'Nov 9 – 15, 2026', `${FIXTURE_ORG_NAME} · ${FIXTURES[id].plan} plan`]);
  });

  it('never prints a tier id or an unknown plan, nor an unread organization name', () => {
    expect(composeWeeklyBrief(fixtureFacts('A'), { organizationName: null, planName: 'pro' }).orgLine).toBeNull();
    expect(composeWeeklyBrief(fixtureFacts('A'), { organizationName: null, planName: 'Optimization Engine' }).orgLine).toBe('Optimization Engine plan');
  });
});

// ── Guards ported from weekly-email-truth.test.ts (brief review H-1, M-2) ─────
//
// Each runs over fixtures A-E and every VARIANTS entry, on the rendered HTML
// and the plain-text part.

describe('guards over every fixture and variant, HTML and text (brief review H-1)', () => {
  const NAMES = Object.keys(VARIANTS);
  const planOf = (name: string) => (name in FIXTURES ? FIXTURES[name as FixtureId].plan : 'Optimization Engine');

  it('the variants include the sources that fail with identifiers and the ARN example', () => {
    expect(NAMES).toEqual(expect.arrayContaining([...FIXTURE_IDS, 'failedWithIdentifiers', 'unavailableWithIdentifiers', 'stillDetectedArn', 'stillDetectedArnMany']));
  });

  describe('output privacy: no identifiers or raw errors reach the email', () => {
    it.each(NAMES)('%s: no ARN, 12-digit account ID, "External ID" or raw error text, even when a source failed with them', (name) => {
      const { html, text, subject } = render(VARIANTS[name], planOf(name));
      for (const out of [html, text, subject]) {
        expect({ name, arn: /arn:aws/i.test(out), digits: /\d{12}/.test(out), ext: /external.?id/i.test(out), err: /AccessDenied|Throttling|Error\b|not authorized|assumed-role/.test(out) })
          .toEqual({ name, arn: false, digits: false, ext: false, err: false });
      }
    });

    it('an ARN-shaped still-detected resource prints as its final resource segment only', () => {
      expect(attentionItems(VARIANTS.stillDetectedArn)[0].body[0])
        .toBe('Idle RDS instance on orders-replica (us-east-1). You resolved it Nov 10; the latest analysis still sees it. About $7/mo, estimated.');
      expect(attentionItems(VARIANTS.stillDetectedArnMany)[0].body[0])
        .toBe('Idle RDS instance on orders-replica (us-east-1) and 1 more. You resolved them; the latest analysis still sees them.');
      for (const name of ['stillDetectedArn', 'stillDetectedArnMany']) {
        const { htmlText, text } = render(VARIANTS[name]);
        for (const out of [htmlText, text]) {
          expect(out).toContain('Idle RDS instance on orders-replica (us-east-1)');
          expect(out).not.toMatch(/arn:|123456789012|db:orders-replica|rds:us-east-1/);
        }
      }
    });
  });

  describe('claim scan: no banned phrase, internal plan id or invented claim in any email', () => {
    const BANNED = /\bAI\b|AI-powered|artificial intelligence|anomal|personali[sz]ed|guarantee|you (can|will) save|\bStarter\b|\bPro\b|\bEnterprise\b|Free plan|gross charges|before credits|Reply to this email|contact support|\$0\/month|Alert history/i;
    const PLAN_NAMES = ['Visibility', 'Cost Control', 'Optimization Engine', 'Revenue Protection'];

    it.each(NAMES)('%s: subject, HTML and text', (name) => {
      const plan = planOf(name);
      const { htmlText, text, subject } = render(VARIANTS[name], plan);
      for (const out of [subject, htmlText, text]) {
        expect({ name, hit: out.match(BANNED)?.[0] ?? null }).toEqual({ name, hit: null });
      }
      // The only plan name printed is the organization's own, in the header.
      for (const out of [htmlText, text]) {
        expect({ name, named: PLAN_NAMES.filter(p => out.includes(p)) }).toEqual({ name, named: [plan] });
      }
    });
  });

  describe('the organization name could not be read: "your organization", never an invented name', () => {
    const FOOTER = "You're receiving this because you're an owner of your organization and weekly summaries are on in your notification settings.";
    it.each(NAMES)('%s: footer (and the not-connected summary) in HTML and text, for null and ""', (name) => {
      for (const unknown of [null, '']) {
        const { htmlText, text } = render(VARIANTS[name], planOf(name), unknown);
        for (const out of [htmlText, text]) {
          expect(out).toContain(FOOTER);
          expect(out).not.toMatch(/Your Organization|\bnull\b|\bundefined\b/);
          expect(out).not.toContain(FIXTURE_ORG_NAME);
          if (VARIANTS[name].connection.state === 'not_connected') {
            expect(out).toContain('No AWS account is connected to your organization yet, so this week has no spend, security or savings data.');
          }
        }
        // The header line carries the plan alone.
        expect(composeWeeklyBrief(VARIANTS[name], { organizationName: unknown, planName: planOf(name) }).orgLine).toBe(`${planOf(name)} plan`);
      }
    });
  });

  describe('links: an allowlist of pages that exist (M-2)', () => {
    const ALLOWED = new Set<string>(Object.values(WEEKLY_EMAIL_PATHS));
    const UNSUBSCRIBE = FIXTURE_URLS.unsubscribeUrl.replace(/=/g, '&#x3D;');

    it.each(NAMES)('%s: every href is an allowed DevControl page, the unsubscribe link or the support address', (name) => {
      const { html, text } = render(VARIANTS[name], planOf(name));
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
      expect(hrefs.length).toBeGreaterThan(4);
      for (const href of hrefs) {
        if (href === 'mailto:support@getdevcontrol.com' || href === UNSUBSCRIBE || href === FIXTURE_URLS.unsubscribeUrl) continue;
        const path = href.startsWith(FIXTURE_URLS.frontendUrl) ? href.slice(FIXTURE_URLS.frontendUrl.length) : href;
        expect({ name, href, allowed: ALLOWED.has(path) }).toEqual({ name, href, allowed: true });
      }
      // The same in the text part: every URL is the frontend's allowed pages or the unsubscribe link.
      for (const url of text.match(/https?:\/\/\S+/g) ?? []) {
        if (url === FIXTURE_URLS.unsubscribeUrl) continue;
        const path = url.startsWith(FIXTURE_URLS.frontendUrl) ? url.slice(FIXTURE_URLS.frontendUrl.length) : url;
        expect({ name, url, allowed: ALLOWED.has(path) }).toEqual({ name, url, allowed: true });
      }
      expect(`${html}\n${text}`).not.toMatch(/example\.test\/privacy\b/);
    });
  });
});
