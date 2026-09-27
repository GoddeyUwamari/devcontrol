/**
 * POST /api/ai-reports/generate: the organization comes only from the
 * authenticated user, the fallback flag is persisted (so a template report is
 * never labeled "AI-generated"), and a failure never returns a raw internal
 * error message.
 *
 * The service is mocked at the prototype level; no DB, AWS, or model access.
 */
import { AIReportsController } from '../ai-reports.controller';
import { AIReportGeneratorService } from '../../services/ai-report-generator.service';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('POST /api/ai-reports/generate', () => {
  it('uses the authenticated organization, ignoring any organizationId in the body', async () => {
    const data = { organizationId: ORG, reportType: 'weekly_summary', dateRange: { from: '2026-09-19', to: '2026-09-26' }, sections: {} };
    const fetchReportData = jest.spyOn(AIReportGeneratorService.prototype, 'fetchReportData').mockResolvedValue(data);
    jest.spyOn(AIReportGeneratorService.prototype, 'generateWeeklyReport').mockResolvedValue({
      report: { summary: 's', keyHighlights: [], topRecommendations: [], executiveSummary: 'e' },
      wasFallback: true,
    });
    const save = jest.spyOn(AIReportGeneratorService.prototype, 'saveGeneratedReport').mockResolvedValue('report-id');
    const res = mockRes();

    await new AIReportsController().generateReport(
      { user: { organizationId: ORG }, body: { organizationId: OTHER_ORG, reportType: 'weekly_summary' } } as any,
      res
    );

    expect(fetchReportData).toHaveBeenCalledWith(ORG, expect.any(Object), 'weekly_summary');
    expect(save).toHaveBeenCalledWith(ORG, expect.any(Object), data.dateRange, 'weekly_summary', undefined, true);
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(OTHER_ORG);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.objectContaining({ wasFallback: true }) }));
  });

  it('returns 401 without an authenticated organization, even if the body names one', async () => {
    const fetchReportData = jest.spyOn(AIReportGeneratorService.prototype, 'fetchReportData');
    const res = mockRes();

    await new AIReportsController().generateReport({ body: { organizationId: ORG } } as any, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(fetchReportData).not.toHaveBeenCalled();
  });

  it('never returns a raw internal error message', async () => {
    jest.spyOn(AIReportGeneratorService.prototype, 'fetchReportData')
      .mockRejectedValue(new Error('relation "generated_reports" does not exist at character 13'));
    const res = mockRes();

    await new AIReportsController().generateReport({ user: { organizationId: ORG }, body: {} } as any, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Failed to generate report' });
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(/relation|generated_reports|character/);
  });
});
