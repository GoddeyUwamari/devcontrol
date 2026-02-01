import { useState, useCallback } from 'react';
import { aiReportsService, GeneratedReport, ReportHistoryItem, GenerateReportRequest } from '@/lib/services/ai-reports.service';

export function useAIReports() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Generate a new AI report
   */
  const generateReport = useCallback(async (request: GenerateReportRequest = {}): Promise<GeneratedReport | null> => {
    setIsGenerating(true);
    setError(null);

    try {
      const report = await aiReportsService.generateReport(request);
      return report;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to generate report';
      setError(errorMessage);
      console.error('[useAIReports] Generate error:', err);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  /**
   * Get report history
   */
  const getReportHistory = useCallback(async (
    limit: number = 10,
    reportType?: 'weekly_summary' | 'monthly_summary' | 'executive_summary'
  ): Promise<ReportHistoryItem[]> => {
    setIsFetchingHistory(true);
    setError(null);

    try {
      const history = await aiReportsService.getReportHistory(limit, reportType);
      return history;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch report history';
      setError(errorMessage);
      console.error('[useAIReports] Fetch history error:', err);
      return [];
    } finally {
      setIsFetchingHistory(false);
    }
  }, []);

  /**
   * Get a single report
   */
  const getReport = useCallback(async (reportId: string): Promise<GeneratedReport | null> => {
    setError(null);

    try {
      const report = await aiReportsService.getReport(reportId);
      return report;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch report';
      setError(errorMessage);
      console.error('[useAIReports] Get report error:', err);
      return null;
    }
  }, []);

  /**
   * Delete a report
   */
  const deleteReport = useCallback(async (reportId: string): Promise<boolean> => {
    setError(null);

    try {
      await aiReportsService.deleteReport(reportId);
      return true;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to delete report';
      setError(errorMessage);
      console.error('[useAIReports] Delete error:', err);
      return false;
    }
  }, []);

  return {
    generateReport,
    getReportHistory,
    getReport,
    deleteReport,
    isGenerating,
    isFetchingHistory,
    error
  };
}
