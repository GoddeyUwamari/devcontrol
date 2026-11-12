/**
 * WE-1 truth tests for the weekly summary email (weekly-email-step1.md §8.2):
 * every section in every state, the "$0/month" regressions, plan gating, the
 * five sections always present, link allowlist, claim scan, output privacy and
 * HTML/text parity. Rendered through the real template and text part; nothing
 * is sent (Resend is never configured here). All data is synthetic.
 */
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(),
    getCostTrendFetchedAt: jest.fn(async () => '2026-11-16T09:00:00.000Z'),
  },
}));

import { Pool } from 'pg';
import { collectSection, notConnected, type ContextSection } from '../ai-context-contract';
import {
  composeWeeklySummary,
  WEEKLY_EMAIL_PATHS,
  WEEKLY_SECTION_TITLES,
} from '../weekly-summary-content';
import type {
  WeeklyDORAMetrics,
  WeeklyEvidence,
  WeeklyRecommendationEvidence,
  WeeklyRunEvidence,
  WeeklyRunState,
  WeeklySecurityEvidence,
} from '../../repositories/weekly-summary.repository';
import type { HealthDisplay } from '../connection-health';
import { WeeklyAISummaryJob } from '../../jobs/weekly-ai-summary.job';
// The Connect AWS page's HEALTH_FAILING_HELP; the frontend test weekly-email-health-copy.test.ts keeps them equal.
import { CONNECTION_FAILING_HELP as HEALTH_FAILING_HELP } from '../../config/weekly-email-copy';
import {
  FIXTURE_IDS,
  FIXTURE_ORG_NAME,
  FIXTURE_URLS,
  FIXTURES,
  HEALTH_OK,
  fixtureEvidence,
} from '../../jobs/__tests__/weekly-email-fixtures';

const originalResendKey = process.env.RESEND_API_KEY;
let job: WeeklyAISummaryJob;

beforeAll(() => {
  delete process.env.RESEND_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  job = new WeeklyAISummaryJob({} as Pool);
});

afterAll(() => {
  if (originalResendKey) process.env.RESEND_API_KEY = originalResendKey;
});

const SECURITY = 'DevControl security posture score and configuration checks';
const RECS = 'DevControl cost recommendations';
const DELIVERY = 'DevControl deployment records';

const available = <T>(source: string, data: T) => collectSection<T>({ source }, async () => ({ state: 'available', data }));
const failed = <T>(source: string) => collectSection<T>({ source }, async () => { throw new Error('AccessDenied: arn:aws:iam::123456789012:role/Synthetic'); });
const unavailable = <T>(source: string, reason: string) => collectSection<T>({ source }, async () => ({ state: 'unavailable', reason }));
const off = <T>(source: string) => notConnected<T>({ source }, 'no AWS account is connected');

const breakdown = (o: Partial<WeeklyRecommendationEvidence>): WeeklyRecommendationEvidence => ({
  active: 0, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: {}, unestimatedFindings: 0, ...o,
});

function render(e: WeeklyEvidence, organizationName: string | null = FIXTURE_ORG_NAME, planName: string | null = null) {
  const data = job.buildTemplateData({
    userName: 'Alex',
    content: composeWeeklySummary(e, { organizationName, planName }),
    ...FIXTURE_URLS,
  });
  data.year = 2026;
  const { html, text } = job.renderEmail(data);
  const htmlText = html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<\/?strong>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x3D;/g, '=').replace(/&rarr;/g, '→').replace(/&copy;/g, '©')
    .replace(/\s+/g, ' ');
  return { html, text, htmlText, data };
}

/** The lines rendered under one section title, from the text part. */
function sectionText(text: string, id: keyof typeof WEEKLY_SECTION_TITLES): string {
  const titles = Object.values(WEEKLY_SECTION_TITLES);
  const lines = text.split('\n');
  const start = lines.indexOf(WEEKLY_SECTION_TITLES[id]);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i] !== '' && !titles.includes(lines[i]); i++) out.push(lines[i]);
  return out.join('\n');
}

async function base(): Promise<WeeklyEvidence> {
  return fixtureEvidence('C2');
}

// ---- WE-2 reads: connection health, scan, cost analysis, deployment history ----
const HEALTH = 'DevControl AWS connection health';
const SCAN = 'DevControl discovery scans';
const ANALYSIS = 'DevControl cost analysis runs';
const HISTORY = 'DevControl deployment records (all time)';
/** 2026-11-<day>T<hh:mm>:00Z; the fixtures send on Nov 16 at 09:00, so "this week" starts Nov 9, 09:00. */
const T = (dayTime: string) => `2026-11-${dayTime}:00.000Z`;

const health = (o: Partial<HealthDisplay>) => available<HealthDisplay>(HEALTH, { ...HEALTH_OK, ...o });
const runs = (latest: { state: WeeklyRunState; at: string; startedAt?: string } | null, lastCompletedAt: string | null): WeeklyRunEvidence => ({
  latest: latest ? { state: latest.state, at: latest.at, startedAt: latest.startedAt ?? latest.at } : null,
  lastCompleted: lastCompletedAt ? { at: lastCompletedAt } : null,
});
const scanOf = (r: WeeklyRunEvidence) => available<WeeklyRunEvidence>(SCAN, r);
const analysisOf = (r: WeeklyRunEvidence) => available<WeeklyRunEvidence>(ANALYSIS, r);
const historyOf = (anyRecorded: boolean) => available(HISTORY, { anyRecorded });

/** Named WE-2 states over C2 (or C4 for the estimate), each changing one read. */
async function we2States(): Promise<Array<{ name: string; e: WeeklyEvidence }>> {
  const b = await base();
  const c4 = await fixtureEvidence('C4');
  const LAST = T('08T06:10');
  return [
    { name: 'health failing', e: { ...b, connectionHealth: await health({ state: 'failing', lastResult: 'failing', failingSince: T('14T06:01') }) } },
    { name: 'health lost', e: { ...b, connectionHealth: await health({ state: 'lost', lastResult: 'lost', failingSince: T('12T06:01'), lostAt: T('14T06:01') }) } },
    { name: 'health stale, last ok', e: { ...b, connectionHealth: await health({ state: 'not_checked_recently', lastResult: 'ok', checkedAt: T('13T06:02') }) } },
    { name: 'health stale, last failing', e: { ...b, connectionHealth: await health({ state: 'not_checked_recently', lastResult: 'failing', checkedAt: T('13T06:02'), failingSince: T('12T06:00') }) } },
    { name: 'health not checked yet', e: { ...b, connectionHealth: await health({ state: 'not_checked_yet', lastResult: null, checkedAt: null }) } },
    { name: 'health read error', e: { ...b, connectionHealth: await failed<HealthDisplay>(HEALTH) } },
    { name: 'scan in progress, older completed', e: { ...b, scan: await scanOf(runs({ state: 'in_progress', at: T('16T06:00') }, LAST)) } },
    { name: 'scan in progress, first scan', e: { ...b, scan: await scanOf(runs({ state: 'in_progress', at: T('16T06:00') }, null)) } },
    { name: 'scan did not finish, first scan', e: { ...b, scan: await scanOf(runs({ state: 'did_not_finish', at: T('16T06:14'), startedAt: T('16T06:00') }, null)) } },
    { name: 'scan did not finish before this week', e: { ...b, scan: await scanOf(runs({ state: 'did_not_finish', at: T('05T06:14'), startedAt: T('05T06:00') }, T('01T06:10'))) } },
    { name: 'scan never', e: { ...b, scan: await scanOf(runs(null, null)) } },
    { name: 'scan read error', e: { ...b, scan: await failed<WeeklyRunEvidence>(SCAN) } },
    { name: 'scan read error, estimate', e: { ...c4, scan: await failed<WeeklyRunEvidence>(SCAN) } },
    { name: 'analysis in progress, older completed', e: { ...b, costAnalysis: await analysisOf(runs({ state: 'in_progress', at: T('16T06:14') }, T('08T06:20'))) } },
    { name: 'analysis did not finish, first', e: { ...b, costAnalysis: await analysisOf(runs({ state: 'did_not_finish', at: T('16T06:15'), startedAt: T('16T06:14') }, null)) } },
    { name: 'analysis never', e: { ...b, costAnalysis: await analysisOf(runs(null, null)) } },
    { name: 'analysis read error', e: { ...b, costAnalysis: await failed<WeeklyRunEvidence>(ANALYSIS) } },
    { name: 'deployments never recorded, connected', e: { ...b, delivery: await available<WeeklyDORAMetrics>(DELIVERY, { deploymentCount: 0, successfulDeployments: 0, failedDeployments: 0 }), deploymentHistory: await historyOf(false) } },
    { name: 'deployment history read error', e: { ...b, delivery: await available<WeeklyDORAMetrics>(DELIVERY, { deploymentCount: 0, successfulDeployments: 0, failedDeployments: 0 }), deploymentHistory: await failed(HISTORY) } },
    { name: 'every WE-2 read failed', e: { ...b, connectionHealth: await failed<HealthDisplay>(HEALTH), scan: await failed<WeeklyRunEvidence>(SCAN), costAnalysis: await failed<WeeklyRunEvidence>(ANALYSIS), deploymentHistory: await failed(HISTORY) } },
  ];
}

/** Every fixture plus the section-state permutations below, for the whole-email scans. */
async function allEmails(): Promise<Array<{ name: string; e: WeeklyEvidence }>> {
  const out: Array<{ name: string; e: WeeklyEvidence }> = [];
  for (const id of FIXTURE_IDS) out.push({ name: id, e: await fixtureEvidence(id) });
  out.push(...await we2States());
  const b = await base();
  out.push({ name: 'security error', e: { ...b, security: await failed<WeeklySecurityEvidence>(SECURITY) } });
  out.push({ name: 'security preliminary', e: { ...b, security: await unavailable<WeeklySecurityEvidence>(SECURITY, 'the security posture score is still preliminary') } });
  out.push({ name: 'savings error', e: { ...b, recommendations: await failed<WeeklyRecommendationEvidence>(RECS) } });
  out.push({
    name: 'savings: an estimate row at $0',
    e: { ...b, recommendations: await available<WeeklyRecommendationEvidence>(RECS, breakdown({ active: 1, estimatedFindings: 1 })) },
  });
  out.push({ name: 'delivery error', e: { ...b, delivery: await failed<WeeklyDORAMetrics>(DELIVERY) } });
  out.push({ name: 'connection unknown', e: { ...b, awsConnection: 'unknown' } });
  return out;
}

describe('truth-state matrix, per section', () => {
  it('COSTS: available, $0.00 measured, partial, error with estimate, not connected', async () => {
    const c2 = render(await fixtureEvidence('C2')).text;
    expect(sectionText(c2, 'costs')).toBe([
      'AWS Cost Explorer spend, Nov 9 – Nov 15, 2026 (UTC): $1,234.56.',
      'That is up 4.2% from $1,184.80 for the previous 7 days (Nov 2, 2026 – Nov 8, 2026).',
      'Unblended cost by service, after any credits and refunds AWS applied. If credits take a category below $0 on a day, that category counts as $0. Recent days may still be updating.',
      'See costs: https://app.example.test/costs',
    ].join('\n'));

    const c5 = sectionText(render(await fixtureEvidence('C5')).text, 'costs');
    expect(c5).toContain('AWS Cost Explorer spend, Nov 9 – Nov 15, 2026 (UTC): $0.00.');
    expect(c5).toContain('Cost Explorer reported $0.00 for these days. If AWS credits cover your usage, it shows $0 here.');
    expect(c5).not.toMatch(/before credits|gross/i);

    const c4 = sectionText(render(await fixtureEvidence('C4')).text, 'costs');
    expect(c4.split('\n')[0]).toBe("AWS Cost Explorer spend for Nov 9 – Nov 15, 2026 couldn't be retrieved.");
    expect(c4.split('\n')[1]).toBe('From the last completed scan (Nov 8, 2026): estimated run-rate of about $412.50/month for 18 of 24 discovered resources. This is a DevControl list-price estimate, not billed AWS spend.');
    expect(c4).not.toMatch(/AccessDenied|synthetic refusal/);

    expect(sectionText(render(await fixtureEvidence('C3')).text, 'costs'))
      .toBe('Not connected. Cost Explorer spend appears here after you connect AWS.');
  });

  it('SECURITY: findings, no findings, preliminary, error, not connected', async () => {
    const b = await base();
    expect(sectionText(render(b).text, 'security')).toBe([
      'Latest scan (Nov 16, 2026, 06:14 UTC): 2 account-level findings (security groups, IAM) and 5 resource compliance issues (encryption, backups, tagging, and other infrastructure checks).',
      'Security posture score: 72/100.',
      "This covers DevControl's own configuration checks, not AWS Security Hub or every AWS security finding.",
      'See security findings: https://app.example.test/security',
    ].join('\n'));
    expect(sectionText(render(await fixtureEvidence('C5')).text, 'security')).toContain('Latest scan (Nov 16, 2026, 06:14 UTC): no active findings.');
    expect(sectionText(render({ ...b, security: await unavailable<WeeklySecurityEvidence>(SECURITY, 'the security posture score is still preliminary') }).text, 'security'))
      .toBe("Your first scan hasn't finished yet. Findings appear here after it completes.");
    const error = sectionText(render({ ...b, security: await failed<WeeklySecurityEvidence>(SECURITY) }).text, 'security');
    expect(error).toBe("Security findings couldn't be retrieved for this summary. They're on the Security page.");
    expect(sectionText(render(await fixtureEvidence('C3')).text, 'security'))
      .toBe("Not connected. DevControl's security checks run after you connect AWS.");
  });

  it('ALERTS: Coming soon chip with the Operational Health link, or the not-connected line; never the old sentence', async () => {
    const connected = render(await base());
    expect(sectionText(connected.text, 'alerts')).toBe([
      'Alert history (Coming soon)',
      'See your active CloudWatch alarms on Operational Health: https://app.example.test/admin/monitoring',
    ].join('\n'));
    expect(connected.html).toContain('Alert history <span class="soon">Coming soon</span>');
    expect(sectionText(render(await fixtureEvidence('C3')).text, 'alerts')).toBe([
      'Alert history (Coming soon)',
      'Active CloudWatch alarms appear on Operational Health once AWS is connected.',
    ].join('\n'));
    for (const { e } of await allEmails()) {
      const { text, htmlText } = render(e);
      expect(`${text}\n${htmlText}`).not.toContain('Alert history for this period is not available yet.');
    }
  });

  it('DELIVERY: counts, none this week, error', async () => {
    expect(sectionText(render(await fixtureEvidence('C2')).text, 'delivery')).toBe([
      '6 deployments recorded in DevControl in the 7 days before this summary: 4 succeeded, 2 failed.',
      'Deployment frequency (successful deployments): 0.57 per day.',
      'Change failure rate: 33.3% (2 of 6 finished deployments failed).',
      'Lead time for changes and time to restore service: Not tracked.',
      'See deployments: https://app.example.test/deployments',
    ].join('\n'));
    expect(sectionText(render(await fixtureEvidence('C4')).text, 'delivery')).toBe([
      'No deployments were recorded in DevControl in the 7 days before this summary, so delivery metrics could not be calculated.',
      'See deployments: https://app.example.test/deployments',
    ].join('\n'));
    expect(sectionText(render(await fixtureEvidence('C3')).text, 'delivery')).toBe([
      'No deployments have been recorded in DevControl yet.',
      'Record a deployment on the Deployments page: https://app.example.test/deployments',
    ].join('\n'));
    const b = await base();
    expect(sectionText(render({ ...b, delivery: await failed<WeeklyDORAMetrics>(DELIVERY) }).text, 'delivery'))
      .toBe('Deployment data could not be retrieved for this period.');
  });
});

describe('ESTIMATED SAVINGS: "$0/month" regressions', () => {
  async function savings(r: WeeklyRecommendationEvidence | ContextSection<WeeklyRecommendationEvidence>) {
    const b = await base();
    const section = 'state' in r ? r : await available<WeeklyRecommendationEvidence>(RECS, r);
    return sectionText(render({ ...b, recommendations: section }).text, 'savings');
  }

  it('only upper bounds and unpriced findings: no "$0/month"; the count and the upper bound are stated (C1)', async () => {
    const out = sectionText(render(await fixtureEvidence('C1')).text, 'savings');
    expect(out).toBe([
      '3 open findings; none has a dollar estimate yet.',
      'Up to $310/month if S3 data qualifies for Standard-IA (upper bound).',
      'From the cost analysis completed Nov 16, 2026, 06:20 UTC.',
      'See Cost Optimization: https://app.example.test/cost-optimization',
    ].join('\n'));
    expect(out).not.toMatch(/\$0\b/);
  });

  it('no estimate and no upper bound: none has a dollar estimate yet', async () => {
    const out = await savings(breakdown({ active: 2, unestimatedFindings: 2 }));
    expect(out.split('\n')[0]).toBe('2 open findings; none has a dollar estimate yet.');
    expect(out).not.toMatch(/\$\d/);
  });

  it('a mix: estimate total, upper bound kept apart, and the findings with no figure counted', async () => {
    const out = await savings(breakdown({ active: 5, estimatedMonthlySavings: 845, estimatedFindings: 3, ceilingByResourceType: { S3: 310 }, unestimatedFindings: 1 }));
    expect(out).toBe([
      'Estimated savings: $845/month across 3 open findings. This is a DevControl estimate, not realized savings.',
      'Plus up to $310/month if S3 data qualifies for Standard-IA (upper bound, not included above).',
      '1 more open finding has no dollar estimate yet.',
      'From the cost analysis completed Nov 16, 2026, 06:20 UTC.',
      'See Cost Optimization: https://app.example.test/cost-optimization',
    ].join('\n'));
    const two = await savings(breakdown({ active: 3, estimatedMonthlySavings: 10, estimatedFindings: 1, unestimatedFindings: 2 }));
    expect(two).toContain('Estimated savings: $10/month across 1 open finding.');
    expect(two).toContain('2 more open findings have no dollar estimate yet.');
  });

  // WE-1 review H-1: the headline needs a total above $0, whatever the count says.
  it('an estimate count with a $0 total: no headline and no "$0/month"; none has a dollar estimate yet', async () => {
    const out = await savings(breakdown({ active: 1, estimatedFindings: 1, estimatedMonthlySavings: 0 }));
    expect(out).toBe([
      '1 open finding; none has a dollar estimate yet.',
      'From the cost analysis completed Nov 16, 2026, 06:20 UTC.',
      'See Cost Optimization: https://app.example.test/cost-optimization',
    ].join('\n'));
    const withCeiling = await savings(breakdown({ active: 2, estimatedFindings: 1, ceilingByResourceType: { S3: 310 } }));
    expect(withCeiling.split('\n').slice(0, 2)).toEqual([
      '2 open findings; none has a dollar estimate yet.',
      'Up to $310/month if S3 data qualifies for Standard-IA (upper bound).',
    ]);
    expect(withCeiling).not.toMatch(/\$0\b/);
  });

  it('none open, error, not connected', async () => {
    expect((await savings(breakdown({}))).split('\n').slice(0, 2)).toEqual([
      'No open savings findings in the last analysis.',
      'From the cost analysis completed Nov 16, 2026, 06:20 UTC.',
    ]);
    expect(await savings(await failed<WeeklyRecommendationEvidence>(RECS))).toBe('Cost recommendations could not be retrieved for this period.');
    expect(await savings(off<WeeklyRecommendationEvidence>(RECS))).toBe('Not connected. Savings checks run after you connect AWS.');
  });

  it('the headline estimate is bold in HTML, and a savings error is not styled as a figure', async () => {
    expect(render(await fixtureEvidence('C2')).html).toContain('Estimated savings: <strong>$845/month</strong> across 3 open findings.');
    const b = await base();
    const { html } = render({ ...b, recommendations: await failed<WeeklyRecommendationEvidence>(RECS) });
    expect(html).not.toContain('class="savings"');
  });
});

describe('plan gating (posture score: riskScore; DORA: doraMetrics -- both Optimization Engine)', () => {
  const SCORE_UPSELL = 'Security posture score and its trend are included in Optimization Engine. Compare plans: https://app.example.test/settings/billing';
  const DORA_UPSELL = 'Deployment frequency and change failure rate are DORA metrics, included in Optimization Engine. Compare plans: https://app.example.test/settings/billing';

  it('below the plan (C1): no score, no frequency or rate; each replaced by the line naming the plan', async () => {
    const { text, htmlText } = render(await fixtureEvidence('C1'));
    for (const out of [text, htmlText]) {
      expect(out).not.toMatch(/posture score: \d|\/100|per day|Change failure rate:/);
    }
    expect(sectionText(text, 'security')).toContain(SCORE_UPSELL);
    expect(sectionText(text, 'delivery')).toBe([
      '6 deployments recorded in DevControl in the 7 days before this summary: 4 succeeded, 2 failed.',
      'See deployments: https://app.example.test/deployments',
      DORA_UPSELL,
    ].join('\n'));
  });

  it('on the plan (C2): score and DORA shown, no plan line', async () => {
    const { text } = render(await fixtureEvidence('C2'));
    expect(text).toContain('Security posture score: 72/100.');
    expect(text).toContain('Change failure rate: 33.3%');
    expect(text).not.toContain('Compare plans');
  });

  it('plan lines link to the plan comparison page', async () => {
    const { html } = render(await fixtureEvidence('C1'));
    expect(html.match(/href="https:\/\/app\.example\.test\/settings\/billing"/g)).toHaveLength(2);
  });
});

describe('every email has the five sections, each with a line', () => {
  it('in HTML and text, in order, for every fixture and state', async () => {
    for (const { name, e } of await allEmails()) {
      const { text, html, data } = render(e);
      expect(data.sections.map(s => s.title)).toEqual(['COSTS', 'SECURITY', 'ESTIMATED SAVINGS', 'ALERTS', 'DELIVERY']);
      let at = -1;
      for (const title of Object.values(WEEKLY_SECTION_TITLES)) {
        const next = text.indexOf(`\n${title}\n`, at + 1);
        expect({ name, title, found: next > at }).toEqual({ name, title, found: true });
        at = next;
        expect(html).toContain(`<div class="section-title">${title}</div>`);
      }
      for (const id of Object.keys(WEEKLY_SECTION_TITLES) as Array<keyof typeof WEEKLY_SECTION_TITLES>) {
        expect({ name, id, empty: sectionText(text, id).trim() === '' }).toEqual({ name, id, empty: false });
      }
    }
  });
});

describe('links: an allowlist of pages that exist', () => {
  const ALLOWED = new Set<string>(Object.values(WEEKLY_EMAIL_PATHS));

  it('every frontend link in every email is on the allowlist; the old /privacy is not', async () => {
    for (const { name, e } of await allEmails()) {
      const { html, text } = render(e);
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&#x3D;/g, '='));
      expect(hrefs.length).toBeGreaterThan(4);
      for (const href of hrefs) {
        if (href.startsWith('mailto:')) { expect(href).toBe('mailto:support@getdevcontrol.com'); continue; }
        if (href.startsWith(FIXTURE_URLS.unsubscribeUrl.split('?')[0])) continue;
        expect(href.startsWith(FIXTURE_URLS.frontendUrl)).toBe(true);
        const path = href.slice(FIXTURE_URLS.frontendUrl.length);
        expect({ name, path, allowed: ALLOWED.has(path) }).toEqual({ name, path, allowed: true });
      }
      expect(`${html}\n${text}`).not.toMatch(/example\.test\/privacy\b/);
    }
  });

  it('the not-connected email links to Connect AWS', async () => {
    const { html, text } = render(await fixtureEvidence('C3'));
    expect(html).toContain('href="https://app.example.test/connect-aws"');
    expect(text).toContain('Connect AWS: https://app.example.test/connect-aws');
  });
});

describe('claim scan: no banned phrase, internal plan id or invented claim in any email', () => {
  const BANNED = /\bAI\b|AI-powered|artificial intelligence|anomal|personali[sz]ed|guarantee|you (can|will) save|\bStarter\b|\bPro\b|\bEnterprise\b|Free plan|gross charges|before credits|Reply to this email|contact support|\$0\/month|Alert history for this period/i;
  const PLAN_NAMES = ['Visibility', 'Cost Control', 'Optimization Engine', 'Revenue Protection'];

  it('HTML and text', async () => {
    for (const { name, e } of await allEmails()) {
      const { text, htmlText } = render(e);
      for (const out of [text, htmlText]) {
        const hit = out.match(BANNED)?.[0] ?? null;
        expect({ name, hit }).toEqual({ name, hit: null });
      }
      // Plan names appear only in the plan lines (Optimization Engine); the
      // header names a plan only when one is passed, and render() passes none.
      const named = PLAN_NAMES.filter(p => text.includes(p));
      expect({ name, ok: named.every(p => p === 'Optimization Engine') }).toEqual({ name, ok: true });
    }
  });
});

describe('output privacy: no identifiers or raw errors reach the email', () => {
  it('no ARN, account id, External ID or error text, even when a source failed with one', async () => {
    for (const { name, e } of await allEmails()) {
      const { html, text } = render(e);
      // The Connect AWS page's failing-connection help names "External ID" as a
      // concept (mock (c)); with that one approved sentence removed, nothing may.
      for (const out of [html, text].map(o => o.split(HEALTH_FAILING_HELP).join('').split(HEALTH_FAILING_HELP.replace(/'/g, '&#x27;')).join(''))) {
        expect({ name, arn: /arn:aws/i.test(out), digits: /\d{12}/.test(out), ext: /external.?id/i.test(out), err: /AccessDenied|Throttling|Error\b/.test(out) })
          .toEqual({ name, arn: false, digits: false, ext: false, err: false });
      }
    }
  });
});

describe('intro: scan-dated (WE-2; mock v1 (a) and (c))', () => {
  const MEASURED = `Here's what DevControl measured for ${FIXTURE_ORG_NAME}. Spend covers the 7 full UTC days before this email. Findings and savings come from the latest scan.`;
  const NOT_FINISHED = "DevControl couldn't finish this week's scan, so some figures below come from the last completed scan and say so.";
  const ON_RECORD = 'Spend covers the 7 full UTC days before this email. Findings and savings show what DevControl currently has on record.';

  it('the latest scan completed: mock (a), in HTML and text', async () => {
    for (const id of ['C1', 'C2', 'C5'] as const) {
      const { html, text, data } = render(await fixtureEvidence(id));
      expect(data.intro).toBe(MEASURED);
      expect(html).toContain(MEASURED.replace(/'/g, '&#x27;'));
      expect(text).toContain(MEASURED);
    }
    expect(render(await base(), null).data.intro).toBe(
      "Here's what DevControl measured for your organization. Spend covers the 7 full UTC days before this email. Findings and savings come from the latest scan."
    );
  });

  it("this week's scan didn't finish and an older one completed: mock (c)", async () => {
    const { text, data } = render(await fixtureEvidence('C4'));
    expect(data.intro).toBe(NOT_FINISHED);
    expect(text).toContain(NOT_FINISHED);
  });

  it('every other state claims no scan: the approved WE-1 intro, never "latest scan" or "this week\'s scan"', async () => {
    const states = (await we2States()).filter(s => s.name.startsWith('scan ') || s.name === 'every WE-2 read failed');
    expect(states.length).toBe(8);
    for (const { name, e } of states) {
      const { data } = render(e);
      expect({ name, intro: data.intro }).toEqual({ name, intro: ON_RECORD });
    }
  });

  it('not connected: the not-connected intro is unchanged', async () => {
    expect(render(await fixtureEvidence('C3')).data.intro)
      .toBe(`No AWS account is connected to ${FIXTURE_ORG_NAME} yet, so this week has no spend, security or savings data.`);
  });
});

describe('footer names no organization when its name could not be read (WE-1 review L-4)', () => {
  it("\"you're an owner of your organization\", lower case, in HTML and text; no invented name", async () => {
    for (const unknown of [null, '']) {
      const { htmlText, text } = render(await base(), unknown);
      for (const out of [htmlText, text]) {
        expect(out).toContain("You're receiving this because you're an owner of your organization and weekly summaries are on in your notification settings.");
        expect(out).not.toContain('Your Organization');
      }
    }
  });

  it('the not-connected intro says "your organization" too, in HTML and text', async () => {
    const intro = 'No AWS account is connected to your organization yet, so this week has no spend, security or savings data.';
    for (const unknown of [null, '']) {
      const { htmlText, text, data } = render(await fixtureEvidence('C3'), unknown);
      expect(data.intro).toBe(intro);
      for (const out of [htmlText, text]) {
        expect(out).toContain(intro);
        expect(out).not.toContain('Your Organization');
      }
    }
  });
});

describe('text part matches the HTML', () => {
  it('every line of every section appears in both', async () => {
    for (const { name, e } of await allEmails()) {
      const { htmlText, text, data } = render(e);
      for (const section of data.sections) {
        for (const line of section.lines) {
          if (line.text) {
            expect({ name, line: line.text, html: htmlText.includes(line.text), text: text.includes(line.text) })
              .toEqual({ name, line: line.text, html: true, text: true });
          }
          if (line.link) expect(text).toContain(line.link.href);
        }
      }
      expect(htmlText).toContain(`You're receiving this because you're an owner of ${FIXTURE_ORG_NAME}`);
      expect(text).toContain(`You're receiving this because you're an owner of ${FIXTURE_ORG_NAME}`);
    }
  });
});

describe('WE-2 connection box (mock v1 (a)/(c) and the (c) table)', () => {
  /** The status lines from the text part: between the intro and COSTS. */
  function statusText(text: string): string[] {
    const lines = text.split('\n');
    const end = lines.indexOf('COSTS');
    const start = lines.findIndex(l => l.startsWith('AWS connection'));
    return lines.slice(start, end).filter(l => l !== '');
  }
  const scanLine = 'Latest scan: completed Nov 16, 2026, 06:14 UTC';
  const CONNECT = 'Open Connect AWS: https://app.example.test/connect-aws';

  it('the help text is the Connect AWS page text', () => {
    expect(HEALTH_FAILING_HELP).toContain("couldn't assume your role during its scans");
  });

  it.each([
    ['ok (C2)', null, ['AWS connection: OK · checked Nov 16, 2026, 06:02 UTC', scanLine]],
    ['health failing', 'health failing', ['AWS connection: failing since Nov 14, 2026.', HEALTH_FAILING_HELP, scanLine, CONNECT]],
    ['health lost', 'health lost', ['AWS connection: lost, failing since Nov 12, 2026.', HEALTH_FAILING_HELP, scanLine, CONNECT]],
    ['stale, last ok', 'health stale, last ok', ['AWS connection: not checked recently (last result OK, Nov 13, 2026).', scanLine]],
    ['stale, last failing', 'health stale, last failing', ['AWS connection: not checked recently (last result failing, Nov 13, 2026).', scanLine]],
    ['not checked yet', 'health not checked yet', ['AWS connection: not checked yet. DevControl checks at each scan.', scanLine]],
    ['read error', 'health read error', ["AWS connection health couldn't be retrieved for this summary.", scanLine]],
  ] as const)('%s', async (_label, state, expected) => {
    const e = state ? (await we2States()).find(s => s.name === state)!.e : await base();
    const { text, html } = render(e);
    expect(statusText(text)).toEqual(expected);
    expect(html.includes('href="https://app.example.test/connect-aws"')).toBe((expected as readonly string[]).includes(CONNECT));
  });

  it('C4: failing since, the help, both scan dates and the Connect AWS action (mock (c))', async () => {
    expect(statusText(render(await fixtureEvidence('C4')).text)).toEqual([
      'AWS connection: failing since Nov 14, 2026.',
      HEALTH_FAILING_HELP,
      "Latest scan: didn't finish (Nov 16, 2026, 06:14 UTC). Last completed scan: Nov 8, 2026, 06:10 UTC.",
      CONNECT,
    ]);
  });

  it.each([
    ['scan in progress, older completed', 'Latest scan: in progress (started Nov 16, 2026, 06:00 UTC). Last completed scan: Nov 8, 2026, 06:10 UTC.'],
    ['scan in progress, first scan', 'Latest scan: in progress (started Nov 16, 2026, 06:00 UTC). No scan has completed yet.'],
    ['scan did not finish, first scan', "Latest scan: didn't finish (Nov 16, 2026, 06:14 UTC). No scan has completed yet."],
    ['scan never', 'Latest scan: none yet.'],
    ['scan read error', "Scan dates couldn't be retrieved for this summary."],
  ])('scan line: %s', async (state, line) => {
    const { text } = render((await we2States()).find(s => s.name === state)!.e);
    expect(statusText(text)[1]).toBe(line);
  });

  it('connection unknown (the CI schema: aws_accounts missing): the box still states health and scan', async () => {
    const { text } = render({ ...(await base()), awsConnection: 'unknown', connectionHealth: await failed<HealthDisplay>(HEALTH) });
    expect(statusText(text)).toEqual(["AWS connection health couldn't be retrieved for this summary.", scanLine]);
  });

  it('not connected: the (b) box only, no health or scan line', async () => {
    const { text } = render(await fixtureEvidence('C3'));
    expect(text).toContain('AWS connection: not connected.');
    expect(text).not.toMatch(/Latest scan|AWS connection: OK|AWS connection health/);
  });

  it('Cost Explorer failed: "Other sections are unaffected." only with a fresh OK health check', async () => {
    const c4 = await fixtureEvidence('C4');
    const first = (e: WeeklyEvidence) => sectionText(render(e).text, 'costs').split('\n')[0];
    expect(first({ ...c4, connectionHealth: await health({}) }))
      .toBe("AWS Cost Explorer spend for Nov 9 – Nov 15, 2026 couldn't be retrieved. Other sections are unaffected.");
    for (const h of [await fixtureEvidence('C4').then(x => x.connectionHealth), await health({ state: 'not_checked_recently', lastResult: 'ok' }), await failed<HealthDisplay>(HEALTH)]) {
      expect(first({ ...c4, connectionHealth: h })).toBe("AWS Cost Explorer spend for Nov 9 – Nov 15, 2026 couldn't be retrieved.");
    }
  });
});

describe('WE-2 scan dating: security, posture score, inventory estimate', () => {
  const FINDINGS = '2 account-level findings (security groups, IAM) and 5 resource compliance issues (encryption, backups, tagging, and other infrastructure checks).';

  it('latest completed: "Latest scan (…)", score undated', async () => {
    const out = sectionText(render(await base()).text, 'security').split('\n');
    expect(out.slice(0, 2)).toEqual([`Latest scan (Nov 16, 2026, 06:14 UTC): ${FINDINGS}`, 'Security posture score: 72/100.']);
  });

  it('a later scan in progress or unfinished: "From the last completed scan (…)", score "as of" that day', async () => {
    for (const name of ['scan in progress, older completed']) {
      const out = sectionText(render((await we2States()).find(s => s.name === name)!.e).text, 'security').split('\n');
      expect(out.slice(0, 2)).toEqual([
        `From the last completed scan (Nov 8, 2026, 06:10 UTC): ${FINDINGS}`,
        'Security posture score: 72/100 (as of Nov 8, 2026).',
      ]);
    }
  });

  it('no date known: undated, never "currently"; a read error says so', async () => {
    const states = await we2States();
    const err = sectionText(render(states.find(s => s.name === 'scan read error')!.e).text, 'security').split('\n');
    expect(err.slice(0, 3)).toEqual([
      `DevControl's configuration checks report ${FINDINGS}`,
      "The date of the scan these come from couldn't be retrieved.",
      'Security posture score: 72/100.',
    ]);
    const never = sectionText(render(states.find(s => s.name === 'scan never')!.e).text, 'security').split('\n');
    expect(never[0]).toBe(`DevControl's configuration checks report ${FINDINGS}`);
    expect(never).not.toContain("The date of the scan these come from couldn't be retrieved.");
    for (const { name, e } of await allEmails()) {
      const { text, htmlText } = render(e);
      expect({ name, currently: /currently (report|discovered)/.test(`${text}\n${htmlText}`) }).toEqual({ name, currently: false });
    }
  });

  it('the inventory estimate: dated by the last completed scan, or undated with the read-error note', async () => {
    const states = await we2States();
    expect(sectionText(render(states.find(s => s.name === 'scan read error, estimate')!.e).text, 'costs').split('\n').slice(1, 4)).toEqual([
      'Estimated run-rate of about $412.50/month for 18 of 24 discovered resources. This is a DevControl list-price estimate, not billed AWS spend.',
      "The date of the scan these come from couldn't be retrieved.",
      'No week-over-week comparison is available.',
    ]);
  });
});

describe('WE-2 savings: cost analysis state (WE-D3 and mock v1)', () => {
  const states = () => we2States();
  async function savingsOf(e: WeeklyEvidence, r?: WeeklyRecommendationEvidence) {
    const withRecs = r ? { ...e, recommendations: await available<WeeklyRecommendationEvidence>(RECS, r) } : e;
    return sectionText(render(withRecs).text, 'savings').split('\n').filter(l => !l.startsWith('See Cost Optimization'));
  }
  const NONE = breakdown({});
  const C2_HEADLINE = 'Estimated savings: $845/month across 3 open findings. This is a DevControl estimate, not realized savings.';

  it.each([
    ['completed (C2)', null, [C2_HEADLINE, 'From the cost analysis completed Nov 16, 2026, 06:20 UTC.'], ['No open savings findings in the last analysis.', 'From the cost analysis completed Nov 16, 2026, 06:20 UTC.']],
    ['in progress, older completed', 'analysis in progress, older completed', [C2_HEADLINE, 'From the last completed cost analysis, Nov 8, 2026. A new analysis is in progress.'], ['No open savings findings.', 'From the last completed cost analysis, Nov 8, 2026. A new analysis is in progress.']],
    ['did not finish, none completed', 'analysis did not finish, first', [C2_HEADLINE, "The last cost analysis didn't finish."], ["The last cost analysis didn't finish."]],
    ['never', 'analysis never', [C2_HEADLINE], ['Shown after your first cost analysis finishes.']],
    ['read error', 'analysis read error', [C2_HEADLINE, "The date of the last cost analysis couldn't be retrieved."], ['No open savings findings.', "The date of the last cost analysis couldn't be retrieved."]],
  ] as const)('%s', async (_label, state, withFindings, withNone) => {
    const e = state ? (await states()).find(s => s.name === state)!.e : await base();
    expect(await savingsOf(e)).toEqual(withFindings);
    expect(await savingsOf(e, NONE)).toEqual(withNone);
  });

  it("C4: this week's analysis didn't finish (mock (c)); an older failure is not \"this week's\"", async () => {
    const c4 = await fixtureEvidence('C4');
    expect(await savingsOf(c4)).toEqual([
      'Estimated savings: $120/month across 2 open findings. This is a DevControl estimate, not realized savings.',
      "From the last completed cost analysis, Nov 8, 2026. This week's analysis didn't finish.",
    ]);
    const older = { ...c4, costAnalysis: await analysisOf(runs({ state: 'did_not_finish', at: T('05T06:15'), startedAt: T('05T06:14') }, T('01T06:20'))) };
    expect((await savingsOf(older))[1]).toBe("From the last completed cost analysis, Nov 1, 2026. The latest analysis didn't finish.");
  });

  it('in progress with no completed analysis', async () => {
    const e = { ...(await base()), costAnalysis: await analysisOf(runs({ state: 'in_progress', at: T('16T06:14') }, null)) };
    expect(await savingsOf(e)).toEqual([C2_HEADLINE, 'A cost analysis is in progress.']);
    expect(await savingsOf(e, NONE)).toEqual(['Cost analysis in progress. Savings appear when it finishes.']);
  });

  it('"No open savings findings in the last analysis." appears only after a completed analysis', async () => {
    for (const { name, e } of await allEmails()) {
      const out = render({ ...e, recommendations: e.recommendations.state === 'not_connected' ? e.recommendations : await available<WeeklyRecommendationEvidence>(RECS, NONE) }).text;
      const completed = !!e.costAnalysis && e.costAnalysis.state === 'available' && e.costAnalysis.data!.latest?.state === 'completed';
      expect({ name, shown: out.includes('No open savings findings in the last analysis.') }).toEqual({ name, shown: completed });
    }
  });
});

describe('WE-2 deployments ever recorded', () => {
  it('never recorded: the mock (b) line and the Deployments link; recorded before or unread: the 7-day line', async () => {
    const states = await we2States();
    expect(sectionText(render(states.find(s => s.name === 'deployments never recorded, connected')!.e).text, 'delivery')).toBe([
      'No deployments have been recorded in DevControl yet.',
      'Record a deployment on the Deployments page: https://app.example.test/deployments',
    ].join('\n'));
    expect(sectionText(render(states.find(s => s.name === 'deployment history read error')!.e).text, 'delivery').split('\n')[0])
      .toBe('No deployments were recorded in DevControl in the 7 days before this summary, so delivery metrics could not be calculated.');
  });

  it('a week with deployments is unchanged whatever the history says', async () => {
    const b = await base();
    const out = sectionText(render({ ...b, deploymentHistory: await historyOf(false) }).text, 'delivery');
    expect(out.split('\n')[0]).toBe('6 deployments recorded in DevControl in the 7 days before this summary: 4 succeeded, 2 failed.');
  });
});

describe('WE-2 subject and header (WE-D12)', () => {
  const HEADER_DATES = 'Nov 9 – Nov 15, 2026 (UTC)';

  it.each(['Visibility', 'Cost Control', 'Optimization Engine', 'Revenue Protection'])('plan %s: header names it, subject carries the dates', async (plan) => {
    const { html, text, data } = render(await base(), FIXTURE_ORG_NAME, plan);
    const header = `${FIXTURE_ORG_NAME} · ${plan} plan · ${HEADER_DATES}`;
    expect(data.header).toBe(header);
    expect(data.subject).toBe('Your DevControl weekly summary · Nov 9 – 15, 2026');
    expect(text.split('\n').slice(0, 2)).toEqual(['Your DevControl Weekly Summary', header]);
    expect(html).toContain(`<p>${header}</p>`);
    expect(`${html}\n${text}`).not.toContain('Cost, security, and delivery summary');
  });

  it('org name unreadable: no name and no "Your Organization"; plan unreadable or not a plan name: no plan, never a tier id', async () => {
    const b = await base();
    expect(render(b, null, 'Visibility').data.header).toBe(`Visibility plan · ${HEADER_DATES}`);
    expect(render(b, '', 'Visibility').data.header).toBe(`Visibility plan · ${HEADER_DATES}`);
    expect(render(b, FIXTURE_ORG_NAME, null).data.header).toBe(`${FIXTURE_ORG_NAME} · ${HEADER_DATES}`);
    for (const tierId of ['free', 'starter', 'pro', 'enterprise', 'Pro']) {
      const { data, text } = render(b, null, tierId);
      expect(data.header).toBe(HEADER_DATES);
      expect(text).not.toMatch(new RegExp(`\\b${tierId}\\b`));
    }
    for (const out of [render(b, null, null).text, render(b, null, null).html]) expect(out).not.toContain('Your Organization');
  });

  it('every fixture: its plan in the header', async () => {
    for (const id of FIXTURE_IDS) {
      expect(render(await fixtureEvidence(id), FIXTURE_ORG_NAME, FIXTURES[id].plan).data.header)
        .toBe(`${FIXTURE_ORG_NAME} · ${FIXTURES[id].plan} plan · ${HEADER_DATES}`);
    }
  });

  it('windows across a month and a year', async () => {
    const { formatSubjectWindow } = await import('../weekly-summary-content');
    expect(formatSubjectWindow({ start: '2026-11-09', endExclusive: '2026-11-16' })).toBe('Nov 9 – 15, 2026');
    expect(formatSubjectWindow({ start: '2026-10-26', endExclusive: '2026-11-02' })).toBe('Oct 26 – Nov 1, 2026');
    expect(formatSubjectWindow({ start: '2026-12-28', endExclusive: '2027-01-04' })).toBe('Dec 28, 2026 – Jan 3, 2027');
  });
});
