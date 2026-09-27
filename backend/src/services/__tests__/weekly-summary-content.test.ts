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
import { WeeklyAISummaryJob } from '../../jobs/weekly-ai-summary.job';
import { AIInsightsService } from '../ai-insights.service';

// AIInsightsService starts a cache-cleanup setInterval in its constructor; not under test here.
jest.spyOn(AIInsightsService.prototype as any, 'startCacheCleanup').mockImplementation(() => {});

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
  deploymentCount: 6,
  failedDeployments: 1,
  deploymentFrequency: '0.9 per day',
  timeBetweenSuccessfulDeployments: '26.5 hours',
  mttr: '45 minutes',
  changeFailureRate: 16.7,
  benchmarks: {
    deploymentFrequency: { level: 'high', isCustom: false },
    changeFailureRate: { level: 'medium', isCustom: false },
    mttr: { level: 'elite', isCustom: false },
  },
};

interface Overrides {
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
    ...spend,
    alerts: repository.getWeeklyAlerts(),
    delivery: o.delivery ?? await available<WeeklyDORAMetrics>('DevControl deployment records', DELIVERY),
    security: o.security ?? await available<WeeklySecurityEvidence>('DevControl security posture score and configuration checks', {
      score: 72, accountLevelFindings: 2, resourceComplianceIssues: 5,
    }),
    recommendations: o.recommendations ?? await available<WeeklyRecommendationEvidence>('DevControl cost recommendations', {
      active: 3, totalEstimatedMonthlySavings: 845.2,
    }),
  };
}

/** The full rendered email (HTML with tags stripped, plus the plain-text version). */
function render(e: WeeklyEvidence, recommendation: string | null = null): string {
  const data = job.buildTemplateData({
    userName: 'Alex',
    content: composeWeeklySummary(e),
    recommendation,
    dashboardUrl: 'https://app.example.test/dashboard',
    unsubscribeUrl: 'https://api.example.test/unsubscribe?token=x',
    preferencesUrl: 'https://app.example.test/settings/notifications',
    privacyUrl: 'https://app.example.test/privacy',
  });
  const { html, text } = job.renderEmail(data);
  const htmlText = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
  return `${htmlText}\n${text}`;
}

/** Claims the email must never make without the evidence behind them. */
const UNSUPPORTED = {
  noSpend: /no cloud spend recorded/i,
  monthlySpend: /current monthly cloud spend/i,
  definiteSavings: /you can save|save \$\d/i,
  doraLeadTime: /lead time|DORA METRICS/i,
  noAlerts: /no alerts|0 alerts/i,
  noSecurityRisks: /no security risks/i,
  rightsizingOrRi: /rightsiz|right-siz|reserved instance|savings plan/i,
};

describe('Weekly Summary email wording', () => {
  it('A/G/C: actual spend is labeled with its real 7-day period and gross-before-credits basis, never as monthly spend', async () => {
    const out = render(await evidence());
    expect(out).toContain('AWS Cost Explorer gross charges for the last 7 complete days (Sep 21, 2026 – Sep 27, 2026, UTC): $770.00, before credits and refunds.');
    expect(out).toContain('up 10.0% from $700.00 for the previous 7 days (Sep 14, 2026 – Sep 20, 2026)');
    expect(out).not.toMatch(UNSUPPORTED.monthlySpend);
    expect(out).not.toMatch(/monthly/i);
  });

  it('B: a real $0 week says $0.00 of actual charges -- not "no spend recorded", not an estimate', async () => {
    const e = await evidence({
      trend: async () => days(() => 0),
      inventory: { total_resources: '4', priced_resources: '4', total_cost: '120' },
    });
    const out = render(e);
    expect(out).toContain('gross charges for the last 7 complete days (Sep 21, 2026 – Sep 27, 2026, UTC): $0.00');
    expect(out).toContain('a week-over-week percentage cannot be calculated');
    expect(out).not.toMatch(UNSUPPORTED.noSpend);
    expect(composeWeeklySummary(e).costSummary).not.toMatch(/estimate|run-rate/i);
  });

  it('D: unavailable cost says unavailable -- never $0 or "no spend"', async () => {
    const out = render(await evidence({ trend: async () => { throw new Error('AWS_NOT_CONNECTED: none'); } }));
    expect(out).toContain('Cloud spend data was unavailable for this period (no AWS account is connected).');
    expect(out).not.toMatch(UNSUPPORTED.noSpend);
    expect(out).not.toMatch(/\$0\b|\$0\.00/);
  });

  it('D: a cost retrieval error says it could not be retrieved', async () => {
    const out = render(await evidence({ trend: async () => { throw new Error('ThrottlingException'); } }));
    expect(out).toContain('Cloud spend data could not be retrieved for this period.');
    expect(out).not.toMatch(/Throttling/);
    expect(out).not.toMatch(UNSUPPORTED.noSpend);
  });

  it('E: the inventory fallback is explicitly an estimated monthly run-rate, not billed spend', async () => {
    const out = render(await evidence({
      trend: async () => { throw new Error('AWS_NOT_CONNECTED: none'); },
      inventory: { total_resources: '10', priced_resources: '8', total_cost: '412.5' },
    }));
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
    expect(out).toContain('Estimated savings opportunity: $845/month across 3 open cost recommendations (a DevControl estimate, not realized savings).');
    expect(out).not.toMatch(UNSUPPORTED.definiteSavings);
  });

  it('I: failed recommendation evaluation is not "no opportunities"', async () => {
    const out = render(await evidence({ recommendations: await failed<WeeklyRecommendationEvidence>('DevControl cost recommendations') }));
    expect(out).toContain('Cost recommendations could not be retrieved for this period.');
    expect(out).not.toMatch(/no (savings )?opportunit|no recommendations/i);
  });

  it('I: zero open recommendations makes no savings claim at all', async () => {
    const e = await evidence({ recommendations: await available<WeeklyRecommendationEvidence>('DevControl cost recommendations', { active: 0, totalEstimatedMonthlySavings: 0 }) });
    expect(composeWeeklySummary(e).savingsSummary).toBeNull();
    expect(render(e)).not.toMatch(/savings|opportunit/i);
  });

  it('J: alerts are stated as unavailable, never "no alerts"', async () => {
    const out = render(await evidence());
    expect(out).toContain("Alert data was unavailable for this period: DevControl's alert sync does not yet associate alerts with an organization");
    expect(out).not.toMatch(UNSUPPORTED.noAlerts);
  });

  it('K: unavailable security is not "no security risks"', async () => {
    const out = render(await evidence({
      security: await unavailable<WeeklySecurityEvidence>('DevControl security posture score and configuration checks', 'the security posture score is still preliminary'),
    }));
    expect(out).toContain('Security findings were unavailable for this period (the security posture score is still preliminary).');
    expect(out).not.toMatch(UNSUPPORTED.noSecurityRisks);
    expect(out).not.toMatch(/no active findings/i);
  });

  it('K: a security error is stated as an error', async () => {
    const out = render(await evidence({ security: await failed<WeeklySecurityEvidence>('DevControl security posture score and configuration checks') }));
    expect(out).toContain('Security findings could not be retrieved for this period.');
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
    expect(out).toContain("DevControl's configuration checks currently report no active findings (security posture score 100/100).");
    expect(out).not.toMatch(UNSUPPORTED.noSecurityRisks);
  });

  it('L: the deployment-gap metric is named for what it is, never DORA lead time or graded against lead-time bands', async () => {
    const out = render(await evidence());
    expect(out).toContain('Average time between successful deployments of the same service: 26.5 hours.');
    expect(out).toContain('6 deployments recorded in DevControl in the 7 days before this summary: 0.9 per day (industry benchmark: High).');
    expect(out).not.toMatch(UNSUPPORTED.doraLeadTime);
  });

  it('M: missing delivery data is stated -- no fabricated fallback values', async () => {
    const noData = render(await evidence({ delivery: await available<WeeklyDORAMetrics>('DevControl deployment records', {
      ...DELIVERY, deploymentCount: 0, failedDeployments: 0, deploymentFrequency: '0.0 per day', timeBetweenSuccessfulDeployments: 'N/A', mttr: 'N/A', changeFailureRate: 0,
      benchmarks: { deploymentFrequency: null, changeFailureRate: null, mttr: null },
    }) }));
    expect(noData).toContain('No deployments were recorded in DevControl in the 7 days before this summary, so delivery metrics could not be calculated.');
    expect(noData).not.toMatch(/2\.0 hours|0\.0 per day|Change failure rate: 0%/);

    const oneDeploy = render(await evidence({ delivery: await available<WeeklyDORAMetrics>('DevControl deployment records', {
      ...DELIVERY, deploymentCount: 1, failedDeployments: 0, deploymentFrequency: '0.1 per day', timeBetweenSuccessfulDeployments: 'N/A', mttr: 'N/A', changeFailureRate: 0,
    }) }));
    expect(oneDeploy).toContain('Average time between successful deployments: not enough data');
    expect(oneDeploy).not.toMatch(/N\/A/);

    const error = render(await evidence({ delivery: await failed<WeeklyDORAMetrics>('DevControl deployment records') }));
    expect(error).toContain('Deployment data could not be retrieved for this period.');
    expect(error).not.toMatch(/per day|failure rate/i);
  });

  it('19: no unsupported claim appears in the worst case (every source missing)', async () => {
    const out = render(await evidence({
      trend: async () => { throw new Error('AWS_NOT_CONNECTED: none'); },
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
  });
});

describe('Weekly Summary AI recommendation guard', () => {
  it('N/O: model text contradicting the evidence (no spend, rightsizing, definite savings) is dropped', async () => {
    const e = await evidence({ trend: async () => { throw new Error('AWS_NOT_CONNECTED: none'); } });
    const content = composeWeeklySummary(e);
    const aiService = (job as any).aiService;
    const spy = jest.spyOn(aiService, 'generateDashboardSummary');

    for (const modelText of [
      'No cloud spend this week, so focus on security.',
      'Rightsizing your EC2 instances could cut costs.',
      'You can save $845/month by acting on the open recommendations.',
      'Buy Reserved Instances to save 20-40% on compute.',
      'Lead time looks healthy; keep deploying.',
      'There were no alerts, so focus on the 2 account-level findings.',
    ]) {
      spy.mockResolvedValueOnce(modelText);
      expect(await job.generateAIRecommendation(e, content)).toBeNull();
    }

    // The final email keeps the evidence-backed unavailable state.
    const out = render(e, null);
    expect(out).toContain('Cloud spend data was unavailable for this period');
    expect(out).not.toMatch(UNSUPPORTED.noSpend);
    spy.mockRestore();
  });

  it('O: figures the model invents (not in the evidence) are rejected; grounded text passes', async () => {
    const e = await evidence();
    const content = composeWeeklySummary(e);
    const prompt = buildRecommendationPrompt(e, content)!;

    expect(checkRecommendationText('Costs rose 35% this week; act now.', prompt).text).toBeNull();
    expect(checkRecommendationText('Review the 3 open cost recommendations, estimated at $900/month.', prompt).text).toBeNull();

    const grounded = 'Resolve the 2 account-level findings first, then review the 3 open cost recommendations (estimated $845/month opportunity).';
    expect(checkRecommendationText(grounded, prompt).text).toBe(grounded);
  });

  it('10: the prompt carries every evidence state and the no-fabrication rules', async () => {
    const e = await evidence({ trend: async () => { throw new Error('AWS_NOT_CONNECTED: none'); } });
    const prompt = buildRecommendationPrompt(e, composeWeeklySummary(e))!;
    expect(prompt).toContain('Cloud spend data was unavailable for this period');
    expect(prompt).toContain('Alert data was unavailable for this period');
    expect(prompt).toMatch(/never describe it as zero, none/);
    expect(prompt).toMatch(/Do not recommend rightsizing, Reserved Instances, or Savings Plans/);
    expect(prompt).not.toMatch(/Current monthly cloud spend/);
  });

  it('10: no model call when there is nothing real to recommend on', async () => {
    const e = await evidence({
      security: await failed<WeeklySecurityEvidence>('DevControl security posture score and configuration checks'),
      recommendations: await available<WeeklyRecommendationEvidence>('DevControl cost recommendations', { active: 0, totalEstimatedMonthlySavings: 0 }),
    });
    const spy = jest.spyOn((job as any).aiService, 'generateDashboardSummary');
    expect(await job.generateAIRecommendation(e, composeWeeklySummary(e))).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('notSupported alert section', () => {
  it('stays distinct from unavailable and error states', () => {
    const s = notSupported({ source: 'x' }, 'why');
    expect(s.state).toBe('not_supported');
    expect(s.data).toBeNull();
  });
});
