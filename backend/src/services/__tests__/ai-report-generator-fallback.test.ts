/**
 * Coverage for the AI Report Generator's fallback-report truthfulness fix
 * (generateFallbackReport() in ai-report-generator.service.ts).
 *
 * Confirmed issue: the fallback report's executive summary said "Infrastructure
 * is well-optimized." whenever `data.resources.unusedResources` was empty --
 * including when it was empty because fetchReportData()'s underlying queries
 * had failed (getFallbackReportData()'s all-zero placeholder), not because a
 * real cost analysis genuinely found zero opportunities. That turned an AI/data
 * failure into a positive infrastructure claim.
 *
 * Fixed by adding `ReportData.dataUnavailable` (set true only by
 * fetchReportData()'s catch block) and branching the executive summary three
 * ways: data unavailable -> explicit "unavailable" wording; valid data with
 * real unused resources -> unchanged real-savings message; valid data with
 * genuinely zero unused resources -> "No cost-optimization opportunities
 * identified this period," never "well-optimized."
 *
 * This suite calls the real, public generateWeeklyReport() with
 * ANTHROPIC_API_KEY unset, which deterministically takes the fallback-report
 * path with no network/AI call and no database access (fetchReportData() is
 * not invoked here -- ReportData is supplied directly as a fixture).
 */
import { Pool } from 'pg';
import { AIReportGeneratorService, ReportData } from '../ai-report-generator.service';

const ORIGINAL_ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

function baseReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    organizationId: 'org-1',
    dateRange: { from: '2026-09-01', to: '2026-09-07' },
    costs: {
      current: 1000,
      previous: 900,
      change: 100,
      changePercent: 11.1,
      breakdown: { compute: 500, storage: 200, database: 200, network: 50, other: 50 },
    },
    security: {
      score: 90,
      previousScore: 88,
      criticalIssues: 0,
      highIssues: 0,
      mediumIssues: 0,
      topIssues: [],
    },
    deployments: {
      total: 5,
      successful: 5,
      failed: 0,
      averageLeadTime: 2,
      deploymentFrequency: 1,
      changeFailureRate: 0,
    },
    resources: {
      total: 20,
      change: 1,
      byType: { ec2: 10, s3: 10 },
      topCostResources: [],
      unusedResources: [],
    },
    alerts: { total: 0, critical: 0, resolved: 0, avgResolutionTime: 0 },
    ...overrides,
  };
}

describe('AIReportGeneratorService fallback report truthfulness', () => {
  let service: AIReportGeneratorService;

  beforeAll(() => {
    // Never connected -- generateWeeklyReport() only touches the DB via
    // fetchReportData(), which this suite never calls.
    service = new AIReportGeneratorService(new Pool({ host: 'unused' }));
  });

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(() => {
    if (ORIGINAL_ANTHROPIC_API_KEY !== undefined) {
      process.env.ANTHROPIC_API_KEY = ORIGINAL_ANTHROPIC_API_KEY;
    }
  });

  it('never claims "well-optimized" when data is unavailable -- uses an explicit unavailable state instead', async () => {
    const data = baseReportData({ dataUnavailable: true });
    const report = await service.generateWeeklyReport(data);

    expect(report.executiveSummary).not.toContain('well-optimized');
    expect(report.executiveSummary).not.toContain('No cost-optimization opportunities identified');
    expect(report.executiveSummary).toContain('unavailable');
  });

  it('reports genuinely zero opportunities honestly, not as "well-optimized"', async () => {
    const data = baseReportData({ dataUnavailable: false, resources: { ...baseReportData().resources, unusedResources: [] } });
    const report = await service.generateWeeklyReport(data);

    expect(report.executiveSummary).not.toContain('well-optimized');
    expect(report.executiveSummary).toContain('No cost-optimization opportunities identified this period.');
  });

  it('still reports real savings opportunities when they genuinely exist', async () => {
    const data = baseReportData({
      dataUnavailable: false,
      resources: {
        ...baseReportData().resources,
        unusedResources: [{ id: 'vol-1', type: 'ebs', potentialSavings: 42 }],
      },
    });
    const report = await service.generateWeeklyReport(data);

    expect(report.executiveSummary).toContain('Opportunity to save $42/month by optimizing unused resources.');
    expect(report.executiveSummary).not.toContain('well-optimized');
    expect(report.executiveSummary).not.toContain('unavailable');
  });
});
