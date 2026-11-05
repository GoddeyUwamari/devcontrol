import api, { handleApiResponse } from '../api';

export interface AISummaryResult {
  overallHealth: { score: number | null; context: string | null };
  topRisk: string | null;
  cloudSpend: string | null;
  systemStatus: string | null;
  /**
   * identified         = topRisk states a finding present in the evidence
   * no_urgent_findings = topRisk is the backend's W11 line: the latest security
   *                      evaluation completed and is current, and every open finding is low
   * all_urgent_reviewed = topRisk is the backend's W11b line: same evaluation, and every
   *                      open critical/high/medium finding was accepted or dismissed
   * none_identified    = security evidence was evaluated and records no active findings
   * unavailable        = risk could not be evaluated -- never shown as "no risks"
   */
  topRiskStatus: 'identified' | 'no_urgent_findings' | 'all_urgent_reviewed' | 'none_identified' | 'unavailable';
  generatedAt: string;
}

export const aiSummaryService = {
  /**
   * Every fact, including the month-over-month change, is computed server-side
   * for the authenticated org -- no client-computed figure is sent.
   */
  getSummary: async (): Promise<AISummaryResult> => {
    const response = await api.get('/api/platform/ai-summary');
    return handleApiResponse(response);
  },
};
