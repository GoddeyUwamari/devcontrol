'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle, AlertCircle, Clock, FileText, Mail, MessageSquare } from 'lucide-react';
import { ScheduledReport } from '@/lib/services/scheduled-reports.service';
import { useReportExecutions } from '@/lib/hooks/useScheduledReports';
import { formatDistanceToNow } from 'date-fns';

interface ExecutionHistoryModalProps {
  open: boolean;
  onClose: () => void;
  schedule: ScheduledReport | null;
}

export function ExecutionHistoryModal({ open, onClose, schedule }: ExecutionHistoryModalProps) {
  const { executions, stats, loading, error } = useReportExecutions(schedule?.id || null);

  const getStatusIcon = (status: 'success' | 'failed' | 'partial') => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'partial':
        return <AlertCircle className="h-5 w-5 text-blue-600" />;
    }
  };

  const getStatusBadge = (status: 'success' | 'failed' | 'partial') => {
    const config = {
      success: { label: 'Success', className: 'bg-green-100 text-green-700 border-green-200' },
      failed: { label: 'Failed', className: 'bg-red-100 text-red-700 border-red-200' },
      partial: { label: 'Partial', className: 'bg-blue-100 text-blue-700 border-blue-200' },
    };
    const { label, className } = config[status];
    return (
      <Badge variant="outline" className={className}>
        {label}
      </Badge>
    );
  };

  const formatBytes = (bytes: number | null) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Execution History</DialogTitle>
          <DialogDescription>
            {schedule?.name} - View past report executions and performance metrics
          </DialogDescription>
        </DialogHeader>

        {/* Statistics */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-900">{stats.total_executions}</p>
                  <p className="text-sm text-gray-600">Total Runs</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-green-600">{stats.success_count}</p>
                  <p className="text-sm text-gray-600">Successful</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-red-600">{stats.failed_count}</p>
                  <p className="text-sm text-gray-600">Failed</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-4">
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-600">
                    {stats.avg_execution_time_ms ? formatDuration(stats.avg_execution_time_ms) : 'N/A'}
                  </p>
                  <p className="text-sm text-gray-600">Avg Duration</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
            {error}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && executions.length === 0 && (
          <div className="text-center py-12">
            <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No execution history yet</p>
            <p className="text-sm text-gray-500 mt-1">This report hasn't been executed</p>
          </div>
        )}

        {/* Execution List */}
        {!loading && executions.length > 0 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">Recent Executions</h3>
            {executions.map((execution) => (
              <Card key={execution.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(execution.status)}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusBadge(execution.status)}
                          <span className="text-sm text-gray-600">
                            {new Date(execution.executed_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {formatDistanceToNow(new Date(execution.executed_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Execution Details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                    <div>
                      <p className="text-gray-600">Resources</p>
                      <p className="font-medium">{execution.records_processed.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">File Size</p>
                      <p className="font-medium">{formatBytes(execution.file_size_bytes)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Duration</p>
                      <p className="font-medium">{formatDuration(execution.execution_time_ms)}</p>
                    </div>
                    <div>
                      <p className="text-gray-600">Delivery</p>
                      <div className="flex items-center gap-2 mt-1">
                        {execution.email_sent && (
                          <Badge variant="secondary" className="text-xs">
                            <Mail className="h-3 w-3 mr-1" />
                            Email
                          </Badge>
                        )}
                        {execution.slack_sent && (
                          <Badge variant="secondary" className="text-xs">
                            <MessageSquare className="h-3 w-3 mr-1" />
                            Slack
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Delivery Details */}
                  {(execution.email_recipients.length > 0 || execution.slack_channels.length > 0) && (
                    <div className="text-xs text-gray-600 space-y-1">
                      {execution.email_recipients.length > 0 && (
                        <p>
                          Email sent to: {execution.email_recipients.join(', ')}
                        </p>
                      )}
                      {execution.slack_channels.length > 0 && (
                        <p>
                          Slack posted to: {execution.slack_channels.join(', ')}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Error Message */}
                  {execution.error_message && (
                    <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-red-800 mb-1">Error Details</p>
                      <p className="text-sm text-red-700">{execution.error_message}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Last Success Info */}
        {stats && stats.last_success_at && (
          <div className="mt-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
            Last successful execution: {new Date(stats.last_success_at).toLocaleString()}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
