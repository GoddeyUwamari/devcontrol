'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Rocket,
  DollarSign,
  Shield,
  Server,
  Database,
  CloudCog,
  AlertCircle,
  CheckCircle2,
  Activity,
  ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export type ActivityType =
  | 'deployment'
  | 'cost_update'
  | 'security_scan'
  | 'resource_created'
  | 'resource_deleted'
  | 'alert'
  | 'other';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  status?: 'success' | 'warning' | 'error' | 'info';
  isNew?: boolean;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
  isLoading?: boolean;
  maxItems?: number;
  showFilter?: boolean;
  onViewAll?: () => void;
  onActivityClick?: (activity: ActivityItem) => void;
}

const activityConfig: Record<ActivityType, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
}> = {
  deployment: {
    icon: Rocket,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  cost_update: {
    icon: DollarSign,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  security_scan: {
    icon: Shield,
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
  },
  resource_created: {
    icon: Server,
    color: 'text-teal-600',
    bgColor: 'bg-teal-100',
  },
  resource_deleted: {
    icon: Database,
    color: 'text-red-600',
    bgColor: 'bg-red-100',
  },
  alert: {
    icon: AlertCircle,
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
  },
  other: {
    icon: Activity,
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
  },
};

const statusConfig = {
  success: {
    icon: CheckCircle2,
    color: 'text-green-600',
  },
  warning: {
    icon: AlertCircle,
    color: 'text-orange-600',
  },
  error: {
    icon: AlertCircle,
    color: 'text-red-600',
  },
  info: {
    icon: Activity,
    color: 'text-blue-600',
  },
};

function ActivityItemComponent({
  activity,
  onClick,
  isLast,
}: {
  activity: ActivityItem;
  onClick?: (activity: ActivityItem) => void;
  isLast?: boolean;
}) {
  const config = activityConfig[activity.type];
  const Icon = config.icon;
  const StatusIcon = activity.status ? statusConfig[activity.status].icon : null;

  return (
    <div className="relative group">
      {/* Timeline Line */}
      {!isLast && (
        <div className="absolute left-[19px] top-[42px] w-0.5 h-[calc(100%-32px)] bg-gray-200 group-hover:bg-gray-300 transition-colors" />
      )}

      {/* Activity Item */}
      <div
        className={`flex gap-3 pb-4 ${onClick ? 'cursor-pointer' : ''}`}
        onClick={() => onClick?.(activity)}
      >
        {/* Icon */}
        <div className={`relative flex-shrink-0 h-10 w-10 rounded-lg ${config.bgColor} flex items-center justify-center z-10 ring-4 ring-white group-hover:scale-110 transition-transform`}>
          <Icon className={`h-5 w-5 ${config.color}`} />
          {activity.isNew && (
            <div className="absolute -top-1 -right-1 h-3 w-3 bg-red-500 rounded-full border-2 border-white animate-pulse" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 group-hover:text-[#7c3aed] transition-colors">
                {activity.title}
              </p>
              {activity.description && (
                <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                  {activity.description}
                </p>
              )}
            </div>
            {activity.status && StatusIcon && (
              <div className="flex-shrink-0">
                <StatusIcon className={`h-4 w-4 ${statusConfig[activity.status].color}`} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatDistanceToNow(activity.timestamp, { addSuffix: true })}</span>
            {activity.metadata && Object.keys(activity.metadata).length > 0 && (
              <>
                <span>•</span>
                <span className="text-gray-500">{Object.keys(activity.metadata).length} details</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="flex gap-3 pb-4">
      <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  );
}

export function ActivityFeed({
  activities,
  isLoading,
  maxItems = 10,
  showFilter = false,
  onViewAll,
  onActivityClick,
}: ActivityFeedProps) {
  const [filter, setFilter] = useState<ActivityType | 'all'>('all');

  const filteredActivities = filter === 'all'
    ? activities
    : activities.filter(a => a.type === filter);

  const displayedActivities = filteredActivities.slice(0, maxItems);

  const filterOptions: { value: ActivityType | 'all'; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'deployment', label: 'Deployments' },
    { value: 'cost_update', label: 'Costs' },
    { value: 'security_scan', label: 'Security' },
    { value: 'resource_created', label: 'Resources' },
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest updates across your infrastructure</CardDescription>
          </div>
          {activities.length > maxItems && onViewAll && (
            <Button variant="ghost" size="sm" onClick={onViewAll}>
              View all
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>

        {/* Filter Buttons */}
        {showFilter && (
          <div className="flex items-center gap-2 pt-2 flex-wrap">
            {filterOptions.map((option) => (
              <Button
                key={option.value}
                variant={filter === option.value ? 'default' : 'outline'}
                size="sm"
                onClick={() => setFilter(option.value)}
                className="h-8"
              >
                {option.label}
                {option.value !== 'all' && (
                  <Badge variant="secondary" className="ml-2 px-1.5 py-0.5 text-xs">
                    {activities.filter(a => a.type === option.value).length}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <ActivitySkeleton key={i} />
            ))}
          </div>
        ) : displayedActivities.length === 0 ? (
          <div className="text-center py-8">
            <Activity className="h-12 w-12 mx-auto mb-3 text-gray-400" />
            <p className="text-sm font-medium text-gray-900">No activity yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              {filter === 'all'
                ? 'Activity will appear here as you use the platform'
                : `No ${filter.replace('_', ' ')} activity found`}
            </p>
          </div>
        ) : (
          <div className="space-y-0">
            {displayedActivities.map((activity, index) => (
              <ActivityItemComponent
                key={activity.id}
                activity={activity}
                onClick={onActivityClick}
                isLast={index === displayedActivities.length - 1}
              />
            ))}
          </div>
        )}

        {/* Footer Note */}
        {!isLoading && displayedActivities.length > 0 && filteredActivities.length > maxItems && (
          <div className="mt-4 pt-4 border-t border-gray-200 text-center">
            <p className="text-sm text-muted-foreground">
              Showing {displayedActivities.length} of {filteredActivities.length} activities
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Demo data generator
export function generateDemoActivities(): ActivityItem[] {
  const now = new Date();
  return [
    {
      id: '1',
      type: 'deployment',
      title: 'EC2 instance i-abc123 deployed',
      description: 'Instance successfully launched in us-east-1',
      timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      status: 'success',
      metadata: { instance: 'i-abc123', region: 'us-east-1' },
    },
    {
      id: '2',
      type: 'cost_update',
      title: 'AWS costs updated: $0.00',
      timestamp: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
      status: 'info',
    },
    {
      id: '3',
      type: 'deployment',
      title: 'Service "payment-api" deployment succeeded',
      description: 'v1.2.3 deployed to production',
      timestamp: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000),
      status: 'success',
      metadata: { service: 'payment-api', version: 'v1.2.3' },
    },
    {
      id: '4',
      type: 'resource_created',
      title: 'New RDS instance db-prod-01 created',
      description: 'PostgreSQL 14.5 instance provisioned',
      timestamp: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
      status: 'success',
      metadata: { type: 'RDS', engine: 'PostgreSQL 14.5' },
    },
    {
      id: '5',
      type: 'security_scan',
      title: 'Security scan completed: 87/100 score',
      description: '3 issues need attention',
      timestamp: new Date(now.getTime() - 17 * 24 * 60 * 60 * 1000),
      status: 'warning',
      metadata: { score: 87, issues: 3 },
    },
    {
      id: '6',
      type: 'alert',
      title: 'High CPU usage alert resolved',
      description: 'CPU usage returned to normal levels',
      timestamp: new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000),
      status: 'success',
    },
  ];
}
