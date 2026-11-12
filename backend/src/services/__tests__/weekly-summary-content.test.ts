/**
 * Customer-facing Weekly Summary wording, end to end: evidence sections ->
 * composeWeeklySummary() -> the real Handlebars template and plain-text
 * version (WeeklyAISummaryJob.buildTemplateData/renderEmail). Nothing is
 * sent: Resend is never configured here and no send method is called.
 *
 * Cost sections come from the real WeeklySummaryRepository.getWeeklySpendSections()
 * over a mocked Cost Explorer trend; the other sections are built with the
 * shared contract helpers (collectSection/notSupported), exactly the states
 * gatherWeeklyEvidence() produces.
 */
jest.mock('../../services/aws-cost.service', () => ({
  ...jest.requireActual('../../services/aws-cost.service'),
  __esModule: true,
  default: {
    fetchCostTrend: jest.fn(),
    getCostTrendFetchedAt: jest.fn(() => '2026-09-28T08:55:00.000Z'),
  },
}));

import { Pool } from 'pg';
import awsCostService from '../aws-cost.service';
import { collectSection, notSupported } from '../ai-context-contract';
import {
  WeeklySummaryRepository,
  weeklySummaryPeriod,
  type WeeklyDORAMetrics,
  type WeeklyEvidence,
  type WeeklyRecommendationEvidence,
  type WeeklySecurityEvidence,
} from '../../repositories/weekly-summary.repository';
import { buildRecommendationPrompt, checkRecommendationText, composeWeeklySummary } from '../weekly-summary-content';
import { WeeklyAISummaryJob, WEEKLY_SUMMARY_SUBJECT } from '../../jobs/weekly-ai-summary.job';


const fetchCostTrend = awsCostService.fetchCostTrend as jest.Mock;
const NOW = new Date('2026-09-28T09:00:00.000Z');
const ORG = '22222222-2222-4222-8222-222222222222';
const period = weeklySummaryPeriod(NOW);
const repository = new WeeklySummaryRepository({} as Pool);

const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalResendKey = process.env.RESEND_API_KEY;
let job: WeeklyAISummaryJob;

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.RESEND_API_KEY;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  job = new WeeklyAISummaryJob({} as Pool);
});

afterAll(() => {
  if (originalAnthropicKey) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  if (originalResendKey) process.env.RESEND_API_KEY = originalResendKey;
});

function days(amountFor: (day: string) => number | undefined) {
  const points = [];
  for (let t = Date.parse('2026-08-29T00:00:00Z'); t <= Date.parse('2026-09-28T00:00:00Z'); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const total = amountFor(day);
    if (total !== undefined) points.push({ date: day, compute: total, storage: 0, database: 0, network: 0, other: 0, total });
  }
  return points;
}

function inventoryClient(row: Record<string, string>) {
  return { query: jest.fn(async () => ({ rows: [row] })) } as any;
}

const available = <T>(source: string, data: T) =>
  collectSection<T>({ source }, async () => ({ state: 'available', data }));
const failed = <T>(source: string) =>
  collectSection<T>({ source }, async () => { throw new Error('connection terminated unexpectedly'); });
const unavailable = <T>(source: string, reason: string) =>
  collectSection<T>({ source }, async () => ({ state: 'unavailable', reason }));

const DELIVERY: WeeklyDORAMetrics = {
  deploymentCount: 7,
  successfulDeployments: 5,
  failedDeployments: 1,
  deploymentFrequency: '0.71 per day',
  changeFailureRate: 16.7,
};

interface Overrides {
  awsConnection?: WeeklyEvidence['awsConnection'];
  trend?: () => Promise<unknown>;
  inventory?: Record<string, string>;
  delivery?: WeeklyEvidence['delivery'];
  security?: WeeklyEvidence['security'];
  recommendations?: WeeklyEvidence['recommendations'];
}

async function evidence(o: Overrides = {}): Promise<WeeklyEvidence> {
  fetchCostTrend.mockReset();
  fetchCostTrend.mockImplementation(o.trend ?? (async () => days(day => (day >= '2026-09-21' ? 110 : 100))));
  const spend = await repository.getWeeklySpendSections(
    ORG,
    period,
    inventoryClient(o.inventory ?? { total_resources: '0', priced_resources: '0', total_cost: '0' })
  );
  return {
    period,
    awsConnection: o.awsConnection ?? 'connected',
    ...spend,
    alerts: await repository.getWeeklyAlerts(ORG, period),
    delivery: o.delivery ?? await available<WeeklyDORAMetrics>('DevControl deployment records', DELIVERY),
    security: o.security ?? await available<WeeklySecurityEvidence>('DevControl security posture score and configuration checks', {
      score: 72, accountLevelFindings: 2, resourceComplianceIssues: 5,
    }),
    recommendations: o.recommendations ?? await available<WeeklyRecommendationEvidence>('DevControl cost recommendations', {
      active: 3, estimatedMonthlySavings: 845.2, estimatedFindings: 3, ceilingByResourceType: {}, unestimatedFindings: 0,
    }),
  };
}

function templateData(e: WeeklyEvidence) {
  return job.buildTemplateData({
    userName: 'Alex',
    content: composeWeeklySummary(e, { organizationName: 'Example Org (synthetic)' }),
    frontendUrl: 'https://app.example.test',
    unsubscribeUrl: 'https://api.example.test/unsubscribe?token=x',
  });
}

/** The full rendered email (HTML with tags stripped, plus the plain-text version). */
function render(e: WeeklyEvidence): string {
  const data = templateData(e);
  const { html, text } = job.renderEmail(data);
  const htmlText = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
  return `${htmlText}\n${text}`;
}

/** Claims the email must never make without the evidence behind them. */
const UNSUPPORTED = {
  noSpend: /no cloud spend recorded/i,
  monthlySpend: /current monthly cloud spend/i,
  definiteSavings: /you can save|save \$\d/i,
  // Lead time may only ever be stated as not tracked, never with a value.
  doraLeadTime: /lead time(?! for changes and time to restore service: Not tracked\.)|DORA METRICS/i,
  noAlerts: /no alerts|0 alerts/i,
  noSecurityRisks: /no security risks/i,
  rightsizingOrRi: /rightsiz|right-siz|reserved instance|savings plan/i,
};

describe('Weekly Summary email wording', () => {
  it('A/G/C: actual spend is labeled with its real 7-day period and its after-credits basis, never as monthly spend', async () => {
    const out = render(await evidence());
    expect(out).toContain('AWS Cost Explorer spend, Sep 21 – Sep 27, 2026 (UTC): $770.00.');
    expect(out).toContain(
      'Unblended cost by service, after any credits and refunds AWS applied. If credits take a category below $0 on a day, ' +
      'that category counts as $0. Recent days may still be updating.'
    );
    expect(out).not.toMatch(/gross charges|before credits/i);
    // H2: never implies finalized figures.
    expect(out).not.toMatch(/complete days/i);
    expect(out).toContain('up 10.0% from $700.00 for the previous 7 days (Sep 14, 2026 – Sep 20, 2026)');
    expect(out).not.toMatch(UNSUPPORTED.monthlySpend);
    expect(out).not.toMatch(/monthly/i);
  });

  it('B: a measured $0 week says $0.00 and that credits can cause it -- not "no spend recorded", not an estimate', async () => {
    const e = await evidence({
      trend: async () => days(() => 0),
      inventory: { total_resources: '4', priced_resources: '4', total_cost: '120' },
    });
    const out = render(e);
    expect(out).toContain('AWS Cost Explorer spend, Sep 21 – Sep 27, 2026 (UTC): $0.00.');
    expect(out).toContain('Cost Explorer reported $0.00 for these days. If AWS credits cover your usage, it shows $0 here.');
    expect(out).toContain('a week-over-week percentage cannot be calculated');
    expect(out).not.toMatch(UNSUPPORTED.noSpend);
    const costs = composeWeeklySummary(e).sections.find(x => x.id === 'costs')!.lines.map(l => l.text).join(' ');
    expect(costs).not.toMatch(/estimate|run-rate/i);
  });

  it('D: no AWS connection says not connected -- never $0 or "no spend"', async () => {
    const out = render(await evidence({ awsConnection: 'not_connected', trend: async () => { throw new Error('AWS_NOT_CONNECTED: none'); } }));
    expect(out).toContain('Not connected. Cost Explorer spend appears here after you connect AWS.');
    expect(out).not.toMatch(UNSUPPORTED.noSpend);
    expect(out).not.toMatch(/\$0\b|\$0\.00/);
  });

  it('D: a cost retrieval error says it could not be retrieved', async () => {
    const out = render(await evidence({ trend: async () => { throw new Error('ThrottlingException'); } }));
    expect(out).toContain("AWS Cost Explorer spend for Sep 21 – Sep 27, 2026 couldn't be retrieved.");
    expect(out).not.toMatch(/Throttling/);
    expect(out).not.toMatch(UNSUPPORTED.noSpend);
  });

  it('E: the inventory fallback is explicitly an estimated monthly run-rate, not billed spend', async () => {
    const out = render(await evidence({
      trend: async () => { throw new Error('AccessDenied: synthetic refusal'); },
      inventory: { total_resources: '10', priced_resources: '8', total_cost: '412.5' },
    }));
    expect(out).toContain("AWS Cost Explorer spend for Sep 21 – Sep 27, 2026 couldn't be retrieved.");
    expect(out).toContain('Estimated monthly run-rate for currently discovered resources: approximately $412.50/month');
    expect(out).toContain('a DevControl list-price estimate, not billed AWS spend');
    expect(out).toContain('Only 8 of 10 discovered resources have a cost estimate.');
    expect(out).toContain('No week-over-week comparison is available.');
    expect(out).not.toMatch(UNSUPPORTED.monthlySpend);
  });

  it('F: a week with missing days is not presented as a complete week-over-week comparison', async () => {
    const out = render(await evidence({ trend: async () => days(day => (day === '2026-09-26' ? undefined : 100)) }));
    expect(out).toContain('Cost Explorer returned data for 6 of 7 days, so this total covers only those days.');
    expect(out).toContain('it is not a complete week-over-week comparison');
  });

  it('F/12: no fabricated previous-period trend when the previous week has no data', async () => {
    const out = render(await evidence({ trend: async () => days(day => (day >= '2026-09-21' ? 50 : undefined)) }));
    expect(out).toContain('A comparison with the previous 7 days (Sep 14, 2026 – Sep 20, 2026) is unavailable.');
    expect(out).not.toMatch(/\bup \d|\bdown \d|unchanged/);
  });

  it('H: savings are an estimated opportunity, never a definite "you can save"', async () => {
    const out = render(await evidence());
    expect(out).toContain('Estimated savings: $845/month across 3 open findings. This is a DevControl estimate, not realized savings.');
    expect(out).not.toMatch(UNSUPPORTED.definiteSavings);
  });

  it('I: failed recommendation evaluation is not "no opportunities"', async () => {
    const out = render(await evidence({ recommendations: await failed<WeeklyRecommendationEvidence>('DevControl cost recommendations') }));
    expect(out).toContain('Cost recommendations could not be retrieved for this period.');
    expect(out).not.toMatch(/no (savings )?opportunit|no recommendations/i);
  });

  it('I: zero open findings keeps the section, states the count, and makes no dollar claim', async () => {
    const e = await evidence({ recommendations: await available<WeeklyRecommendationEvidence>('DevControl cost recommendations', {
      active: 0, estimatedMonthlySavings: 0, estimatedFindings: 0, ceilingByResourceType: {}, unestimatedFindings: 0,
    }) });
    const out = render(e);
    expect(out).toContain('ESTIMATED SAVINGS');
    expect(out).toContain('No open savings findings.');
    expect(out).not.toMatch(/\$0\/month|opportunit/i);
  });

  it('J: alerts are stated as unavailable, never "no alerts"', async () => {
    const out = render(await evidence());
    expect(out).toContain('Alert history (Coming soon)');
    expect(out).toContain('See your active CloudWatch alarms on Operational Health: https://app.example.test/admin/monitoring');
    expect(out).not.toContain('Alert history for this period is not available yet.');
    expect(out).not.toMatch(/alert sync|associate alerts with an organization/);
    expect(out).not.toMatch(UNSUPPORTED.noAlerts);
  });

  it('K: unavailable security is not "no security risks"', async () => {
    const out = render(await evidence({
      security: await unavailable<WeeklySecurityEvidence>('DevControl security posture score and configuration checks', 'the security posture score is still preliminary'),
    }));
    expect(out).toContain("Your first scan hasn't finished yet. Findings appear here after it completes.");
    expect(out).not.toMatch(UNSUPPORTED.noSecurityRisks);
    expect(out).not.toMatch(/no active findings/i);
  });

  it('K: a security error is stated as an error', async () => {
    const out = render(await evidence({ security: await failed<WeeklySecurityEvidence>('DevControl security posture score and configuration checks') }));
    expect(out).toContain("Security findings couldn't be retrieved for this summary. They're on the Security page.");
    expect(out).not.toMatch(/connection terminated/);
  });

  it('8: security wording states its real coverage -- DevControl checks, not AWS Security Hub', async () => {
    const out = render(await evidence());
    expect(out).toContain('2 account-level findings (security groups, IAM) and 5 resource compliance issues');
    expect(out).toContain("This covers DevControl's own configuration checks, not AWS Security Hub or every AWS security finding.");
  });

  it('8: zero findings is stated only from a completed evaluation', async () => {
    const out = render(await evidence({
      security: await available<WeeklySecurityEvidence>('DevControl security posture score and configuration checks', { score: 100, accountLevelFindings: 0, resourceComplianceIssues: 0 }),
    }));
    expect(out).toContain("DevControl's configuration checks currently report no active findings.");
    expect(out).toContain('Security posture score: 100/100.');
    expect(out).not.toMatch(UNSUPPORTED.noSecurityRisks);
  });

  it('L: delivery uses the page definitions -- successes for frequency, failed / finished for the rate', async () => {
    const out = render(await evidence());
    expect(out).toContain('7 deployments recorded in DevControl in the 7 days before this summary: 5 succeeded, 1 failed, 1 with no finished status.');
    expect(out).toContain('Deployment frequency (successful deployments): 0.71 per day.');
    expect(out).toContain('Change failure rate: 16.7% (1 of 6 finished deployments failed).');
  });

  it('L1: nothing in the delivery section is graded -- no benchmark, tier or band, in the HTML or the text', async () => {
    for (const delivery of [
      DELIVERY,
      { ...DELIVERY, deploymentCount: 40, successfulDeployments: 40, failedDeployments: 0, deploymentFrequency: '5.71 per day', changeFailureRate: 0 },
      { ...DELIVERY, deploymentCount: 4, successfulDeployments: 1, failedDeployments: 3, deploymentFrequency: '0.14 per day', changeFailureRate: 75 },
    ]) {
      const e = await evidence({ delivery: await available<WeeklyDORAMetrics>('DevControl deployment records', delivery) });
      expect(composeWeeklySummary(e).sections.find(x => x.id === 'delivery')!.lines.map(l => l.text).join(' ')).not.toMatch(/benchmark|\btier\b|\b(elite|high|medium|low)\b|industry|performer/i);
      expect(render(e)).not.toMatch(/benchmark/i);
    }
  });

  it('L2: lead time and time to restore are "Not tracked" -- no deployment-gap or recovery time, no band', async () => {
    const out = render(await evidence());
    expect(out).toContain('Lead time for changes and time to restore service: Not tracked.');
    expect(out).not.toMatch(/time between successful deployments|next successful deployment|MTTR|\d+(\.\d+)? (hours|minutes)/i);
    expect(out).not.toMatch(UNSUPPORTED.doraLeadTime);
  });

  it('L3: with nothing finished the rate is a dash -- never 0%', async () => {
    const out = render(await evidence({ delivery: await available<WeeklyDORAMetrics>('DevControl deployment records', {
      deploymentCount: 2, successfulDeployments: 0, failedDeployments: 0, deploymentFrequency: '0 per day', changeFailureRate: null,
    }) }));
    expect(out).toContain('2 deployments recorded in DevControl in the 7 days before this summary: 0 succeeded, 0 failed, 2 with no finished status.');
    expect(out).toContain('Change failure rate: — (no deployment finished).');
    expect(out).not.toMatch(/Change failure rate: 0%|benchmark/);

    const clean = render(await evidence({ delivery: await available<WeeklyDORAMetrics>('DevControl deployment records', {
      deploymentCount: 1, successfulDeployments: 1, failedDeployments: 0, deploymentFrequency: '0.14 per day', changeFailureRate: 0,
    }) }));
    expect(clean).toContain('1 deployment recorded in DevControl in the 7 days before this summary: 1 succeeded, 0 failed.');
    expect(clean).toContain('Change failure rate: 0% (0 of 1 finished deployment failed).');
  });

  it('M: missing delivery data is stated -- no fabricated fallback values', async () => {
    const noData = render(await evidence({ delivery: await available<WeeklyDORAMetrics>('DevControl deployment records', {
      deploymentCount: 0, successfulDeployments: 0, failedDeployments: 0, deploymentFrequency: '0 per day', changeFailureRate: null,
    }) }));
    expect(noData).toContain('No deployments were recorded in DevControl in the 7 days before this summary, so delivery metrics could not be calculated.');
    expect(noData).not.toMatch(/per day|Change failure rate/);

    const error = render(await evidence({ delivery: await failed<WeeklyDORAMetrics>('DevControl deployment records') }));
    expect(error).toContain('Deployment data could not be retrieved for this period.');
    expect(error).not.toMatch(/per day|failure rate/i);
  });

  it('19: no unsupported claim appears in the worst case (every source missing)', async () => {
    const out = render(await evidence({
      trend: async () => { throw new Error('ThrottlingException'); },
      delivery: await failed<WeeklyDORAMetrics>('DevControl deployment records'),
      security: await failed<WeeklySecurityEvidence>('DevControl security posture score and configuration checks'),
      recommendations: await failed<WeeklyRecommendationEvidence>('DevControl cost recommendations'),
    }));
    for (const pattern of Object.values(UNSUPPORTED)) expect(out).not.toMatch(pattern);
    expect(out).not.toMatch(/\$\d/);
  });

  it('16: unsubscribe and preferences links are still rendered', async () => {
    const out = render(await evidence());
    expect(out).toContain('Unsubscribe: https://api.example.test/unsubscribe?token=x');
    expect(out).toContain('Email Preferences: https://app.example.test/settings/notifications');
    expect(out).toContain('Privacy Policy: https://app.example.test/legal/privacy');
  });
});

describe('Weekly Summary model-written recommendation (removed, PR #136 review B1, WE-D9)', () => {
  it('B1: the job has no recommendation step, and no AI section or AI claim renders in HTML or plain text', async () => {
    expect((job as any).generateAIRecommendation).toBeUndefined();
    const { html, text } = job.renderEmail(templateData(await evidence()));
    for (const out of [html, text]) {
      expect(out).not.toMatch(/AI recommendation/i);
      expect(out).not.toMatch(/AI-Powered/i);
      expect(out).not.toMatch(/\bAI\b/);
      expect(out).toContain('$845/month');
    }
  });

  it('B1: the subject makes no AI claim', () => {
    expect(WEEKLY_SUMMARY_SUBJECT).toBe('Your DevControl Weekly Summary');
    expect(WEEKLY_SUMMARY_SUBJECT).not.toMatch(/\bAI\b/);
  });

  // checkRecommendationText()/buildRecommendationPrompt() are kept, unused, pending a
  // grounded redesign; these pin their current behavior only.
  it('retained helper: invented $/% figures are rejected; grounded text passes', async () => {
    const e = await evidence();
    const content = composeWeeklySummary(e);
    const prompt = buildRecommendationPrompt(e, content)!;

    expect(checkRecommendationText('Costs rose 35% this week; act now.', prompt).text).toBeNull();
    expect(checkRecommendationText('Review the 3 open cost recommendations, estimated at $900/month.', prompt).text).toBeNull();

    const grounded = 'Resolve the 2 account-level findings first, then review the 3 open cost recommendations (estimated $845/month opportunity).';
    expect(checkRecommendationText(grounded, prompt).text).toBe(grounded);
  });

  it('retained helper: the "Not tracked" line stays in the email but is not among the facts given to the model', async () => {
    const e = await evidence();
    const content = composeWeeklySummary(e);
    const prompt = buildRecommendationPrompt(e, content)!;

    expect(content.sections.find(x => x.id === 'delivery')!.lines.map(l => l.text)).toContain('Lead time for changes and time to restore service: Not tracked.');
    expect(render(e)).toContain('Lead time for changes and time to restore service: Not tracked.');

    const facts = prompt.slice(prompt.indexOf('Facts:'));
    expect(facts).toContain('- Delivery: 7 deployments recorded in DevControl in the 7 days before this summary: 5 succeeded, 1 failed, 1 with no finished status. ' +
      'Deployment frequency (successful deployments): 0.71 per day. Change failure rate: 16.7% (1 of 6 finished deployments failed).\n');
    expect(facts).not.toMatch(/lead time|time to restore|not tracked/i);
    // The model is still told not to bring lead time up, and is rejected if it does.
    expect(checkRecommendationText('Shorten your lead time for changes.', prompt).text).toBeNull();
  });

  it('retained helper: the prompt carries every evidence state and the no-fabrication rules', async () => {
    const e = await evidence({ awsConnection: 'not_connected', trend: async () => { throw new Error('AWS_NOT_CONNECTED: none'); } });
    const prompt = buildRecommendationPrompt(e, composeWeeklySummary(e))!;
    expect(prompt).toContain('Not connected. Cost Explorer spend appears here after you connect AWS.');
    expect(prompt).toContain('Alerts: Alert history: Coming soon.');
    expect(prompt).toMatch(/never describe it as zero, none/);
    expect(prompt).toMatch(/Do not recommend rightsizing, Reserved Instances, or Savings Plans/);
    expect(prompt).not.toMatch(/Current monthly cloud spend/);
  });
});

describe('notSupported alert section', () => {
  it('stays distinct from unavailable and error states', () => {
    const s = notSupported({ source: 'x' }, 'why');
    expect(s.state).toBe('not_supported');
    expect(s.data).toBeNull();
  });
});
