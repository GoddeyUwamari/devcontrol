/**
 * Unit coverage for the DORA wording fix in generateWeeklySummary's fallback
 * path (used whenever ANTHROPIC_API_KEY is unset or the Claude call fails —
 * getFallbackWeeklySummary, ai-insights.service.ts). Before this fix, the
 * DORA summary line only ever mentioned deployment frequency and lead time,
 * and nothing anywhere distinguished a measured value from an invented
 * qualitative judgment ("healthy", "low"). These tests pin the new,
 * benchmark-labeled, no-unsupported-adjective wording.
 *
 * No DB needed: AIInsightsService's constructor only touches `pool` when a
 * method that queries it is called, and with ANTHROPIC_API_KEY unset it never
 * calls Anthropic, so generateWeeklySummary() resolves entirely through the
 * deterministic fallback path.
 */
import { AIInsightsService, WeeklySummaryData } from '../ai-insights.service';

describe('AIInsightsService.generateWeeklySummary — DORA wording (fallback path)', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  let service: AIInsightsService;

  beforeAll(() => {
    delete process.env.ANTHROPIC_API_KEY;
    service = new AIInsightsService({} as any);
  });

  afterAll(() => {
    if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  function baseData(dora: WeeklySummaryData['dora']): WeeklySummaryData {
    return {
      costs: { previous: 100, current: 110, changePercent: 10 },
      alerts: { total: 0, critical: 0 },
      dora,
    };
  }

  it('labels a benchmarked metric with its exact industry-benchmark tier, never an invented adjective', async () => {
    const data = baseData({
      deploymentFrequency: '5.1 per day',
      leadTime: 'N/A',
      mttr: 'N/A',
      changeFailureRate: 2.8,
      benchmarks: {
        deploymentFrequency: { level: 'elite', isCustom: false },
        leadTime: null,
        changeFailureRate: { level: 'elite', isCustom: false },
        mttr: null,
      },
    });

    const result = await service.generateWeeklySummary(data);

    expect(result.dora.summary).toContain('Deployment frequency: 5.1 per day (industry benchmark: Elite)');
    expect(result.dora.summary).toContain('Change failure rate: 2.8% (industry benchmark: Elite)');
    // The old wording is gone entirely — no bare "healthy"/"low" ever appears
    // unless it's the literal benchmark label text above.
    expect(result.dora.summary.toLowerCase()).not.toMatch(/\bhealthy\b/);
    expect(result.dora.summary.toLowerCase()).not.toMatch(/\blow\b/);
  });

  it('never claims a benchmark for a metric with no data — omits MTTR entirely rather than showing N/A as if measured', async () => {
    const data = baseData({
      deploymentFrequency: '0.0 per day',
      leadTime: 'N/A',
      mttr: 'N/A',
      changeFailureRate: 0,
      benchmarks: { deploymentFrequency: null, leadTime: null, changeFailureRate: null, mttr: null },
    });

    const result = await service.generateWeeklySummary(data);

    expect(result.dora.summary).not.toContain('benchmark:');
    expect(result.dora.summary).not.toContain('MTTR');
  });

  it('labels an org-custom benchmark distinctly from an industry one', async () => {
    const data = baseData({
      deploymentFrequency: '1.2 per day',
      leadTime: '3.0 hours',
      mttr: 'N/A',
      changeFailureRate: 5,
      benchmarks: {
        deploymentFrequency: { level: 'high', isCustom: true },
        leadTime: { level: 'elite', isCustom: false },
        changeFailureRate: { level: 'elite', isCustom: false },
        mttr: null,
      },
    });

    const result = await service.generateWeeklySummary(data);

    expect(result.dora.summary).toContain('(org benchmark: High)');
    expect(result.dora.summary).toContain('(industry benchmark: Elite)');
  });

  it('still includes MTTR in the summary once it has a real value', async () => {
    const data = baseData({
      deploymentFrequency: '2.0 per day',
      leadTime: '4.0 hours',
      mttr: '45 minutes',
      changeFailureRate: 0,
      benchmarks: {
        deploymentFrequency: { level: 'elite', isCustom: false },
        leadTime: { level: 'elite', isCustom: false },
        changeFailureRate: { level: 'elite', isCustom: false },
        mttr: { level: 'elite', isCustom: false },
      },
    });

    const result = await service.generateWeeklySummary(data);

    expect(result.dora.summary).toContain('MTTR: 45 minutes (industry benchmark: Elite)');
  });
});
