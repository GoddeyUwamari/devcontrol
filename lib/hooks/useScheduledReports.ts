import { useState, useEffect, useCallback } from 'react';
import {
  scheduledReportsService,
  ScheduledReport,
  CreateScheduleRequest,
  UpdateScheduleRequest,
  ReportExecution,
  ExecutionStats,
  ListSchedulesFilters,
} from '../services/scheduled-reports.service';

export function useScheduledReports(filters?: ListSchedulesFilters) {
  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await scheduledReportsService.getSchedules(filters);
      setSchedules(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch schedules');
      console.error('Error fetching schedules:', err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const createSchedule = async (data: CreateScheduleRequest): Promise<ScheduledReport> => {
    try {
      const newSchedule = await scheduledReportsService.createSchedule(data);
      setSchedules((prev) => [newSchedule, ...prev]);
      return newSchedule;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to create schedule');
    }
  };

  const updateSchedule = async (id: string, data: UpdateScheduleRequest): Promise<ScheduledReport> => {
    try {
      const updatedSchedule = await scheduledReportsService.updateSchedule(id, data);
      setSchedules((prev) => prev.map((s) => (s.id === id ? updatedSchedule : s)));
      return updatedSchedule;
    } catch (err: any) {
      throw new Error(err.message || 'Failed to update schedule');
    }
  };

  const deleteSchedule = async (id: string): Promise<void> => {
    try {
      await scheduledReportsService.deleteSchedule(id);
      setSchedules((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      throw new Error(err.message || 'Failed to delete schedule');
    }
  };

  const toggleSchedule = async (id: string, enabled: boolean): Promise<void> => {
    try {
      const updatedSchedule = await scheduledReportsService.toggleSchedule(id, enabled);
      setSchedules((prev) => prev.map((s) => (s.id === id ? updatedSchedule : s)));
    } catch (err: any) {
      throw new Error(err.message || 'Failed to toggle schedule');
    }
  };

  const testSchedule = async (id: string): Promise<void> => {
    try {
      await scheduledReportsService.testSchedule(id);
    } catch (err: any) {
      throw new Error(err.message || 'Failed to test schedule');
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  return {
    schedules,
    loading,
    error,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
    testSchedule,
  };
}

export function useReportExecutions(scheduleId: string | null) {
  const [executions, setExecutions] = useState<ReportExecution[]>([]);
  const [stats, setStats] = useState<ExecutionStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchExecutions = useCallback(async () => {
    if (!scheduleId) {
      setExecutions([]);
      setStats(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await scheduledReportsService.getExecutions(scheduleId);
      setExecutions(data.executions);
      setStats(data.stats);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch executions');
      console.error('Error fetching executions:', err);
    } finally {
      setLoading(false);
    }
  }, [scheduleId]);

  useEffect(() => {
    fetchExecutions();
  }, [fetchExecutions]);

  return {
    executions,
    stats,
    loading,
    error,
    fetchExecutions,
  };
}
