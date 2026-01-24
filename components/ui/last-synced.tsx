'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Clock, AlertTriangle, AlertCircle } from 'lucide-react';
import { getRelativeTime, isDataStale, formatFullTimestamp } from '@/lib/utils';

interface LastSyncedProps {
  timestamp: Date | string;
  onRefresh?: () => void | Promise<void>;
  autoRefresh?: boolean;
  label?: string;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function LastSynced({
  timestamp,
  onRefresh,
  autoRefresh = true,
  label = 'Last synced',
  showIcon = true,
  size = 'sm',
}: LastSyncedProps) {
  const [relativeTime, setRelativeTime] = useState(getRelativeTime(timestamp));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const staleness = isDataStale(timestamp);

  // Update relative time every minute
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      setRelativeTime(getRelativeTime(timestamp));
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [timestamp, autoRefresh]);

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  const iconSizes = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  // Determine color and icon based on staleness
  const getStatusClasses = () => {
    switch (staleness) {
      case 'error':
        return {
          text: 'text-red-500',
          Icon: AlertCircle,
        };
      case 'warning':
        return {
          text: 'text-yellow-500',
          Icon: AlertTriangle,
        };
      default:
        return {
          text: 'text-gray-500',
          Icon: Clock,
        };
    }
  };

  const { text, Icon: StatusIcon } = getStatusClasses();

  return (
    <div
      className={`flex items-center gap-2 ${sizeClasses[size]} ${text}`}
      title={formatFullTimestamp(timestamp)}
    >
      {showIcon && <StatusIcon className={iconSizes[size]} />}

      <span>
        {label} {relativeTime}
      </span>

      {onRefresh && (
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="ml-1 p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors disabled:opacity-50"
          title="Refresh data"
          aria-label="Refresh data"
        >
          <RefreshCw
            className={`${iconSizes[size]} ${isRefreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}
