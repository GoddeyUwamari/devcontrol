/**
 * AI Reports Service - Frontend Client
 *
 * Handles AI-powered report generation and history
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface GeneratedReport {
  reportId?: string;
  executive_summary: string;
  key_metrics: {
    totalCost: number;
    costChange: string;
    securityScore: number;
    deploymentCount: number;
    resourceCount: number;
  };
  cost_insights: Array<{
    type: 'increase' | 'decrease' | 'anomaly' | 'optimization';
    title: string;
    description: string;
    impact: string;
    recommendation?: string;
  }>;
  security_findings: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    title: string;
    description: string;
    affected_resources: number;
    recommendation: string;
  }>;
  deployment_activity: {
    summary: string;
    successful: number;
    failed: number;
    dora_metrics: {
      deployment_frequency: string;
      lead_time: string;
      change_failure_rate: string;
      mttr: string;
    };
  };
  infrastructure_changes: {
    summary: string;
    resources_added: number;
    resources_removed: number;
    resources_modified: number;
    notable_changes: string[];
  };
  recommendations: Array<{
    priority: 'high' | 'medium' | 'low';
    category: 'cost' | 'security' | 'performance' | 'compliance';
    title: string;
    description: string;
    estimated_impact: string;
  }>;
  alerts_summary: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    top_alert?: {
      title: string;
      severity: string;
    };
  };
  metadata?: {
    aiModel: string;
    generationTime: number;
    wasFallback: boolean;
    createdAt: string;
  };
}

// The actual shape returned by GET /api/ai-reports/:id (matches backend GeneratedReport)
export interface ReportDetail {
  id: string;
  reportType: string;
  dateRange: { from: string; to: string };
  summary: string;
  executiveSummary: string;
  keyHighlights: string[];
  costAnalysis?: {
    overview: string;
    trends: string;
    recommendations: string[];
  };
  securityAnalysis?: {
    overview: string;
    topRisks: string;
    recommendations: string[];
  };
  performanceAnalysis?: {
    overview: string;
    doraMetrics: string;
    recommendations: string[];
  };
  topRecommendations: Array<{
    title: string;
    impact: 'high' | 'medium' | 'low';
    description: string;
    estimatedSavings?: number;
    effort: 'low' | 'medium' | 'high';
  }>;
  metadata: {
    aiModel: string;
    generationTime: number;
    wasFallback: boolean;
    createdAt: string;
    sentTo: string | null;
    sentAt: string | null;
    deliveryStatus: string | null;
  };
}

export interface ReportHistoryItem {
  id: string;
  report_type: string;
  date_range_from: string;
  date_range_to: string;
  created_at: string;
  report_data: GeneratedReport;
}

export interface GenerateReportRequest {
  dateRange?: {
    from: string;
    to: string;
  };
  reportType?: 'weekly_summary' | 'monthly_summary' | 'executive_summary';
}

class AIReportsServiceClient {
  private getAuthToken(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('accessToken') || '';
  }

  private getHeaders(): HeadersInit {
    const token = this.getAuthToken();
    return {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` })
    };
  }

  /**
   * Generate a new AI-powered report
   */
  async generateReport(request: GenerateReportRequest = {}): Promise<GeneratedReport> {
    const token = this.getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/ai-reports/generate`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to generate report' }));
      const err = new Error(error.error || 'Failed to generate report');
      (err as any).status = response.status;
      throw err;
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get report history
   */
  async getReportHistory(
    limit: number = 10,
    reportType?: 'weekly_summary' | 'monthly_summary' | 'executive_summary'
  ): Promise<ReportHistoryItem[]> {
    const token = this.getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(reportType && { reportType })
    });

    const response = await fetch(`${API_BASE_URL}/api/ai-reports/history?${params}`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch history' }));
      const err = new Error(error.error || 'Failed to fetch history');
      (err as any).status = response.status;
      throw err;
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get a single report by ID
   */
  async getReport(reportId: string): Promise<GeneratedReport> {
    const token = this.getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/ai-reports/${reportId}`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Report not found' }));
      throw new Error(error.error || 'Report not found');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Get full report detail (correctly typed for the detail page)
   */
  async getReportDetail(reportId: string): Promise<ReportDetail> {
    const token = this.getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/ai-reports/${reportId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Report not found' }));
      throw new Error(error.error || 'Report not found');
    }

    const result = await response.json();
    return result.data as ReportDetail;
  }

  /**
   * Bulk delete reports
   */
  async bulkDeleteReports(ids: string[]): Promise<number> {
    const token = this.getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/ai-reports/bulk`, {
      method: 'DELETE',
      headers: this.getHeaders(),
      body: JSON.stringify({ ids }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete reports' }));
      throw new Error(error.error || 'Failed to delete reports');
    }

    const result = await response.json();
    return result.data.deleted;
  }

  /**
   * Delete a report
   */
  async deleteReport(reportId: string): Promise<void> {
    const token = this.getAuthToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`${API_BASE_URL}/api/ai-reports/${reportId}`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete report' }));
      throw new Error(error.error || 'Failed to delete report');
    }
  }
}

export const aiReportsService = new AIReportsServiceClient();
