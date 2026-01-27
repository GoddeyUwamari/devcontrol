'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Calendar, Clock, Mail, MessageSquare, FileText } from 'lucide-react';
import { useScheduledReports } from '@/lib/hooks/useScheduledReports';
import { CreateScheduleModal } from '@/components/scheduled-reports/CreateScheduleModal';
import { ScheduleCard } from '@/components/scheduled-reports/ScheduleCard';
import { ExecutionHistoryModal } from '@/components/scheduled-reports/ExecutionHistoryModal';
import { ScheduledReport } from '@/lib/services/scheduled-reports.service';
import { useToast } from '@/components/ui/use-toast';

export default function ScheduledReportsPage() {
  const { schedules, loading, error, fetchSchedules, createSchedule, updateSchedule, deleteSchedule, toggleSchedule, testSchedule } = useScheduledReports();
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduledReport | null>(null);
  const [historySchedule, setHistorySchedule] = useState<ScheduledReport | null>(null);
  const { toast } = useToast();

  const handleCreate = async (data: any) => {
    try {
      await createSchedule(data);
      setCreateModalOpen(false);
      toast({
        title: 'Schedule created',
        description: 'Your scheduled report has been created successfully.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to create schedule',
        variant: 'destructive',
      });
    }
  };

  const handleUpdate = async (id: string, data: any) => {
    try {
      await updateSchedule(id, data);
      setEditingSchedule(null);
      toast({
        title: 'Schedule updated',
        description: 'Your scheduled report has been updated successfully.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to update schedule',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this scheduled report?')) {
      return;
    }

    try {
      await deleteSchedule(id);
      toast({
        title: 'Schedule deleted',
        description: 'The scheduled report has been deleted.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to delete schedule',
        variant: 'destructive',
      });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await toggleSchedule(id, enabled);
      toast({
        title: enabled ? 'Schedule enabled' : 'Schedule disabled',
        description: `The scheduled report has been ${enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to toggle schedule',
        variant: 'destructive',
      });
    }
  };

  const handleTest = async (id: string) => {
    try {
      await testSchedule(id);
      toast({
        title: 'Report generation triggered',
        description: 'Check execution history in a few moments for results.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to trigger report',
        variant: 'destructive',
      });
    }
  };

  const activeSchedules = schedules.filter(s => s.enabled).length;
  const totalSchedules = schedules.length;

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading scheduled reports...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Hero Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Scheduled Reports</h1>
            <p className="text-gray-600 max-w-2xl">
              Automate your reporting workflow with scheduled delivery of cost summaries, security audits, and compliance reports.
            </p>
          </div>
          <Button onClick={() => setCreateModalOpen(true)} size="lg">
            <Plus className="mr-2 h-5 w-5" />
            New Schedule
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Schedules</p>
                  <p className="text-3xl font-bold text-blue-600">{activeSchedules}</p>
                </div>
                <Calendar className="h-10 w-10 text-blue-600 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Schedules</p>
                  <p className="text-3xl font-bold text-gray-900">{totalSchedules}</p>
                </div>
                <FileText className="h-10 w-10 text-gray-400 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Enterprise Feature</p>
                  <p className="text-lg font-semibold text-purple-600">Automated Delivery</p>
                </div>
                <Clock className="h-10 w-10 text-purple-600 opacity-20" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-800">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {schedules.length === 0 && !loading && (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Calendar className="h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No scheduled reports yet</h3>
            <p className="text-gray-600 mb-6 text-center max-w-md">
              Get started by creating your first scheduled report. Automate cost summaries, security audits, or compliance reports.
            </p>
            <Button onClick={() => setCreateModalOpen(true)} size="lg">
              <Plus className="mr-2 h-5 w-5" />
              Create Your First Schedule
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Schedules Grid */}
      {schedules.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              onEdit={() => setEditingSchedule(schedule)}
              onDelete={() => handleDelete(schedule.id)}
              onToggle={(enabled) => handleToggle(schedule.id, enabled)}
              onTest={() => handleTest(schedule.id)}
              onViewHistory={() => setHistorySchedule(schedule)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <CreateScheduleModal
        open={createModalOpen || editingSchedule !== null}
        onClose={() => {
          setCreateModalOpen(false);
          setEditingSchedule(null);
        }}
        onSubmit={editingSchedule ? (data) => handleUpdate(editingSchedule.id, data) : handleCreate}
        initialData={editingSchedule || undefined}
        isEditing={editingSchedule !== null}
      />

      <ExecutionHistoryModal
        open={historySchedule !== null}
        onClose={() => setHistorySchedule(null)}
        schedule={historySchedule}
      />
    </div>
  );
}
