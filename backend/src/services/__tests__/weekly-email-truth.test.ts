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
  WeeklySecurityEvidence,
} from '../../repositories/weekly-summary.repository';
import { WeeklyAISummaryJob } from '../../jobs/weekly-ai-summary.job';
import { FIXTURE_IDS, FIXTURE_ORG_NAME, FIXTURE_URLS, fixtureEvidence } from '../../jobs/__tests__/weekly-email-fixtures';

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

function render(e: WeeklyEvidence, organizationName: string | null = FIXTURE_ORG_NAME) {
  const data = job.buildTemplateData({
    userName: 'Alex',
    content: composeWeeklySummary(e, { organizationName }),
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

/** Every fixture plus the section-state permutations below, for the whole-email scans. */
async function allEmails(): Promise<Array<{ name: string; e: WeeklyEvidence }>> {
  const out: Array<{ name: string; e: WeeklyEvidence }> = [];
  for (const id of FIXTURE_IDS) out.push({ name: id, e: await fixtureEvidence(id) });
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
    expect(c4).toContain('approximately $412.50/month — a DevControl list-price estimate, not billed AWS spend. Only 18 of 24 discovered resources have a cost estimate.');
    expect(c4).not.toMatch(/AccessDenied|synthetic refusal/);

    expect(sectionText(render(await fixtureEvidence('C3')).text, 'costs'))
      .toBe('Not connected. Cost Explorer spend appears here after you connect AWS.');
  });

  it('SECURITY: findings, no findings, preliminary, error, not connected', async () => {
    const b = await base();
    expect(sectionText(render(b).text, 'security')).toBe([
      "DevControl's configuration checks currently report 2 account-level findings (security groups, IAM) and 5 resource compliance issues (encryption, backups, tagging, and other infrastructure checks).",
      'Security posture score: 72/100.',
      "This covers DevControl's own configuration checks, not AWS Security Hub or every AWS security finding.",
      'See security findings: https://app.example.test/security',
    ].join('\n'));
    expect(sectionText(render(await fixtureEvidence('C5')).text, 'security')).toContain("DevControl's configuration checks currently report no active findings.");
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
    expect(sectionText(render(await fixtureEvidence('C3')).text, 'delivery')).toContain(
      'No deployments were recorded in DevControl in the 7 days before this summary, so delivery metrics could not be calculated.'
    );
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
    expect((await savings(breakdown({}))).split('\n')[0]).toBe('No open savings findings.');
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
      const named = PLAN_NAMES.filter(p => text.includes(p));
      expect(named.every(p => p === 'Optimization Engine')).toBe(true);
    }
  });
});

describe('output privacy: no identifiers or raw errors reach the email', () => {
  it('no ARN, account id, External ID or error text, even when a source failed with one', async () => {
    for (const { name, e } of await allEmails()) {
      const { html, text } = render(e);
      for (const out of [html, text]) {
        expect({ name, arn: /arn:aws/i.test(out), digits: /\d{12}/.test(out), ext: /external.?id/i.test(out), err: /AccessDenied|Throttling|Error\b/.test(out) })
          .toEqual({ name, arn: false, digits: false, ext: false, err: false });
      }
    }
  });
});

describe('intro (WE-1 review M-1)', () => {
  const INTRO = 'Spend covers the 7 full UTC days before this email. Findings and savings show what DevControl currently has on record.';

  it('connected, and connection unknown: exactly the approved intro, in HTML and text; never "latest scan"', async () => {
    for (const { name, e } of (await allEmails()).filter(x => x.e.awsConnection !== 'not_connected')) {
      const { html, text, data } = render(e);
      expect({ name, intro: data.intro }).toEqual({ name, intro: INTRO });
      expect(html).toContain(INTRO);
      expect(text).toContain(INTRO);
      for (const out of [html, text]) expect(out).not.toMatch(/latest scan|Here's what DevControl measured/);
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
