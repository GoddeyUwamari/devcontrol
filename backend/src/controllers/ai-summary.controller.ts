import { Request, Response } from 'express';
import { AISummaryService, SYSTEM_STATUS_UNAVAILABLE } from '../services/ai-summary.service';

const service = new AISummaryService();

export class AISummaryController {
  /**
   * GET /api/platform/ai-summary
   * Never returns a 500 for this feature — the frontend must be able to treat
   * "no summary available" identically whether the cause was a missing API key,
   * a Claude API error, or genuinely insufficient real data. Errors degrade to
   * { summary: null } instead of an HTTP failure.
   */
  async getSummary(req: Request, res: Response): Promise<void> {
    const organizationId = (req as any).user?.organizationId;
    if (!organizationId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Every fact, including the month-over-month change, is computed
    // server-side for the authenticated org; no client-supplied figure (such
    // as the former costDeltaPct query param) is trusted as evidence.
    try {
      const result = await service.getSummary(organizationId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('[AI Summary] Controller error:', error.message);
      res.json({
        success: true,
        data: {
          overallHealth: { score: null, context: null },
          topRisk: null,
          cloudSpend: null,
          systemStatus: SYSTEM_STATUS_UNAVAILABLE,
          topRiskStatus: 'unavailable',
          generatedAt: new Date().toISOString(),
        },
      });
    }
  }
}
