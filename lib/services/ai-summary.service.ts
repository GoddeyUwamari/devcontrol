import api, { handleApiResponse } from '../api';

export interface AISummaryResult {
  summary: string | null;
  generatedAt: string;
}

export const aiSummaryService = {
  /**
   * @param costDeltaPct - already-computed month-over-month cost delta from the
   * dashboard's own costTrend data (see computeMonthOverMonthCostChange in
   * dashboard/page.tsx). Passed through so the backend can reference a real spend
   * trend without making a second, separately-billed Cost Explorer call.
   */
  getSummary: async (costDeltaPct?: number | null): Promise<AISummaryResult> => {
    const params = costDeltaPct != null ? { costDeltaPct } : undefined;
    const response = await api.get('/api/platform/ai-summary', { params });
    return handleApiResponse(response);
  },
};
