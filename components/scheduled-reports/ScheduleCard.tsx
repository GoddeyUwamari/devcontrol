'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DollarSign,
  Shield,
  FileCheck,
  Mail,
  MessageSquare,
  Calendar,
  Clock,
  Edit,
  Trash2,
  Play,
  History,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { ScheduledReport } from '@/lib/services/scheduled-reports.service';
import { formatDistanceToNow } from 'date-fns';

interface ScheduleCardProps {
  schedule: ScheduledReport;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onViewHistory: () => void;
}

export function ScheduleCard({ schedule, onEdit, onDelete, onToggle, onTest, onViewHistory }: ScheduleCardProps) {
  const reportTypeConfig = {
    cost_summary: {
      label: 'Cost Summary',
      icon: DollarSign,
      color: 'blue',
      bgColor: 'bg-blue-100',
      textColor: 'text-blue-700',
    },
    security_audit: {
      label: 'Security Audit',
      icon: Shield,
      color: 'green',
      bgColor: 'bg-green-100',
      textColor: 'text-green-700',
    },
    compliance_status: {
      label: 'Compliance Status',
      icon: FileCheck,
      color: 'purple',
      bgColor: 'bg-purple-100',
      textColor: 'text-purple-700',
    },
  };

  const config = reportTypeConfig[schedule.report_type];
  const Icon = config.icon;

  const getScheduleDescription = () => {
    const time = schedule.schedule_time.substring(0, 5);

    switch (schedule.schedule_type) {
      case 'daily':
        return `Daily at ${time}`;
      case 'weekly':
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const day = schedule.schedule_day_of_week !== null ? days[schedule.schedule_day_of_week] : '?';
        return `Weekly on ${day} at ${time}`;
      case 'monthly':
        const dayOfMonth = schedule.schedule_day_of_month || '?';
        return `Monthly on day ${dayOfMonth} at ${time}`;
      default:
        return 'Unknown schedule';
    }
  };

  const getNextRunText = () => {
    if (!schedule.next_run_at) return 'Not scheduled';
    try {
      return formatDistanceToNow(new Date(schedule.next_run_at), { addSuffix: true });
    } catch {
      return 'Invalid date';
    }
  };

  const getStatusBadge = () => {
    if (!schedule.last_run_status) return null;

    const statusConfig = {
      success: {
        icon: CheckCircle2,
        label: 'Success',
        variant: 'default' as const,
        className: 'bg-green-100 text-green-700 border-green-200',
      },
      failed: {
        icon: XCircle,
        label: 'Failed',
        variant: 'destructive' as const,
        className: 'bg-red-100 text-red-700 border-red-200',
      },
      partial: {
        icon: AlertCircle,
        label: 'Partial',
        variant: 'secondary' as const,
        className: 'bg-blue-100 text-blue-700 border-blue-200',
      },
    };

    const status = statusConfig[schedule.last_run_status];
    const StatusIcon = status.icon;

    return (
      <Badge className={status.className} variant="outline">
        <StatusIcon className="mr-1 h-3 w-3" />
        {status.label}
      </Badge>
    );
  };

  return (
    <Card className={`relative ${!schedule.enabled ? 'opacity-60' : ''}`}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${config.bgColor}`}>
              <Icon className={`h-5 w-5 ${config.textColor}`} />
            </div>
            <div>
              <CardTitle className="text-lg">{schedule.name}</CardTitle>
              <Badge variant="outline" className="mt-1">
                {config.label}
              </Badge>
            </div>
          </div>
          <Switch
            checked={schedule.enabled}
            onCheckedChange={onToggle}
          />
        </div>
      </CardHeader>

      <CardContent>
        {schedule.description && (
          <p className="text-sm text-gray-600 mb-4">{schedule.description}</p>
        )}

        {/* Schedule Info */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-gray-400" />
            <span className="text-gray-700">{getScheduleDescription()}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4 text-gray-400" />
            <span className="text-gray-700">Next run {getNextRunText()}</span>
          </div>
        </div>

        {/* Delivery Methods */}
        <div className="flex items-center gap-2 mb-4">
          {schedule.delivery_email && (
            <Badge variant="secondary" className="text-xs">
              <Mail className="mr-1 h-3 w-3" />
              Email ({schedule.email_recipients.length})
            </Badge>
          )}
          {schedule.delivery_slack && (
            <Badge variant="secondary" className="text-xs">
              <MessageSquare className="mr-1 h-3 w-3" />
              Slack ({schedule.slack_channels.length})
            </Badge>
          )}
        </div>

        {/* Last Run Status */}
        {schedule.last_run_at && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>Last run: {new Date(schedule.last_run_at).toLocaleString()}</span>
            </div>
            {getStatusBadge()}
            {schedule.last_run_error && (
              <p className="text-xs text-red-600 mt-1 line-clamp-2">{schedule.last_run_error}</p>
            )}
          </div>
        )}

        {/* Run Count */}
        <div className="text-xs text-gray-500 mb-4">
          Executed {schedule.run_count} time{schedule.run_count !== 1 ? 's' : ''}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} className="flex-1">
            <Edit className="mr-1 h-3 w-3" />
            Edit
          </Button>
          <Button variant="outline" size="sm" onClick={onTest}>
            <Play className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" onClick={onViewHistory}>
            <History className="h-3 w-3" />
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="text-red-600 hover:text-red-700">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
