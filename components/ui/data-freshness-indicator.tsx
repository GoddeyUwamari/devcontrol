'use client';

import { CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getRelativeTime } from '@/lib/utils';

interface DataFreshnessIndicatorProps {
  lastSynced: Date | string;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  className?: string;
}

export function DataFreshnessIndicator({
  lastSynced,
  isRefreshing = false,
  onRefresh,
  className,
}: DataFreshnessIndicatorProps) {
  const syncedDate = new Date(lastSynced);
  const minutesSinceSync = Math.floor(
    (Date.now() - syncedDate.getTime()) / (1000 * 60)
  );

  // Determine freshness level
  const isFresh = minutesSinceSync < 5;
  const isStale = minutesSinceSync > 30;

  const relativeTime = getRelativeTime(lastSynced);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
              'hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
              isFresh &&
                'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800',
              !isFresh &&
                !isStale &&
                'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-200 dark:border-blue-800',
              isStale &&
                'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-200 dark:border-blue-800',
              className
            )}
          >
            {isRefreshing ? (
              <>
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Syncing...</span>
              </>
            ) : isFresh ? (
              <>
                <CheckCircle2 className="w-3 h-3" />
                <span>Data Fresh</span>
              </>
            ) : isStale ? (
              <>
                <AlertCircle className="w-3 h-3" />
                <span>Data Stale</span>
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3 h-3" />
                <span>Data Verified</span>
              </>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs p-3">
          <div className="space-y-2">
            <div className="text-xs">
              <div className="font-medium mb-2">Data Freshness</div>
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between gap-4">
                  <span>Last synced</span>
                  <span className="font-medium text-foreground">{relativeTime}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Next sync</span>
                  <span className="font-medium text-foreground">
                    {isRefreshing ? 'In progress' : 'Auto (5 min)'}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Sync mode</span>
                  <span className="font-medium text-foreground">Real-time</span>
                </div>
              </div>
            </div>
            {onRefresh && (
              <div className="text-xs text-muted-foreground pt-2 border-t border-border">
                Click to refresh now
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
