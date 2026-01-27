export interface ScheduledReport {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  report_type: 'cost_summary' | 'security_audit' | 'compliance_status';
  schedule_type: 'daily' | 'weekly' | 'monthly';
  schedule_time: string;
  schedule_day_of_week: number | null;
  schedule_day_of_month: number | null;
  timezone: string;
  delivery_email: boolean;
  delivery_slack: boolean;
  email_recipients: string[];
  slack_channels: string[];
  format: 'pdf' | 'csv' | 'both';
  filters: Record<string, any>;
  columns: string[];
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: 'success' | 'failed' | 'partial' | null;
  last_run_error: string | null;
  next_run_at: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface ReportExecution {
  id: string;
  scheduled_report_id: string;
  executed_at: string;
  status: 'success' | 'failed' | 'partial';
  records_processed: number;
  file_size_bytes: number | null;
  execution_time_ms: number | null;
  email_sent: boolean;
  email_recipients: string[];
  slack_sent: boolean;
  slack_channels: string[];
  error_message: string | null;
  created_at: string;
}

export interface ExecutionStats {
  total_executions: number;
  success_count: number;
  failed_count: number;
  partial_count: number;
  avg_execution_time_ms: number | null;
  last_success_at: string | null;
}

export interface CreateScheduleRequest {
  name: string;
  description?: string;
  report_type: 'cost_summary' | 'security_audit' | 'compliance_status';
  schedule_type: 'daily' | 'weekly' | 'monthly';
  schedule_time: string;
  schedule_day_of_week?: number;
  schedule_day_of_month?: number;
  timezone: string;
  delivery_email: boolean;
  delivery_slack: boolean;
  email_recipients: string[];
  slack_channels: string[];
  format?: 'pdf' | 'csv' | 'both';
  filters?: Record<string, any>;
  columns?: string[];
}

export interface UpdateScheduleRequest extends Partial<CreateScheduleRequest> {
  enabled?: boolean;
}

export interface ListSchedulesFilters {
  report_type?: 'cost_summary' | 'security_audit' | 'compliance_status';
  enabled?: boolean;
  page?: number;
  limit?: number;
}

class ScheduledReportsService {
  private baseUrl = '/api/scheduled-reports';

  async getSchedules(filters?: ListSchedulesFilters): Promise<ScheduledReport[]> {
    const params = new URLSearchParams();
    if (filters?.report_type) params.append('report_type', filters.report_type);
    if (filters?.enabled !== undefined) params.append('enabled', filters.enabled.toString());
    if (filters?.page) params.append('page', filters.page.toString());
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const url = `${this.baseUrl}${params.toString() ? `?${params.toString()}` : ''}`;

    const response = await fetch(url, {
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch schedules' }));
      throw new Error(error.error || 'Failed to fetch schedules');
    }

    const data = await response.json();
    return data.data;
  }

  async createSchedule(schedule: CreateScheduleRequest): Promise<ScheduledReport> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(schedule),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to create schedule' }));
      throw new Error(error.error || 'Failed to create schedule');
    }

    const data = await response.json();
    return data.data;
  }

  async getSchedule(id: string): Promise<ScheduledReport> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch schedule' }));
      throw new Error(error.error || 'Failed to fetch schedule');
    }

    const data = await response.json();
    return data.data;
  }

  async updateSchedule(id: string, updates: UpdateScheduleRequest): Promise<ScheduledReport> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(updates),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to update schedule' }));
      throw new Error(error.error || 'Failed to update schedule');
    }

    const data = await response.json();
    return data.data;
  }

  async deleteSchedule(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to delete schedule' }));
      throw new Error(error.error || 'Failed to delete schedule');
    }
  }

  async toggleSchedule(id: string, enabled: boolean): Promise<ScheduledReport> {
    const response = await fetch(`${this.baseUrl}/${id}/toggle`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ enabled }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to toggle schedule' }));
      throw new Error(error.error || 'Failed to toggle schedule');
    }

    const data = await response.json();
    return data.data;
  }

  async testSchedule(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/${id}/test`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to test schedule' }));
      throw new Error(error.error || 'Failed to test schedule');
    }
  }

  async getExecutions(id: string, limit?: number): Promise<{ executions: ReportExecution[]; stats: ExecutionStats }> {
    const url = `${this.baseUrl}/${id}/executions${limit ? `?limit=${limit}` : ''}`;

    const response = await fetch(url, {
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch executions' }));
      throw new Error(error.error || 'Failed to fetch executions');
    }

    const data = await response.json();
    return data.data;
  }
}

export const scheduledReportsService = new ScheduledReportsService();
