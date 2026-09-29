'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { monitoringService } from '@/lib/services/monitoring.service';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface SystemStatusBadgeProps {
  className?: string;
}

/**
 * DevControl's own service status, from the same live /health check as the
 * /status page. Not a statement about the customer's AWS resources.
 */
export function SystemStatusBadge({ className }: SystemStatusBadgeProps) {
  const { data: health, isLoading } = useQuery({
    queryKey: ['devcontrol-service-status'],
    queryFn: monitoringService.getSystemHealth,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const operational = health?.status === 'operational';
  const label = isLoading
    ? 'Checking DevControl…'
    : operational
      ? 'DevControl operational'
      : 'DevControl not responding';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="system-status-badge"
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-help',
              isLoading
                ? 'bg-slate-50 text-slate-600 border border-slate-200'
                : operational
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800'
                  : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400 border border-red-200 dark:border-red-800',
              className
            )}
          >
            {isLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : operational ? (
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            ) : (
              <AlertCircle className="w-3 h-3" />
            )}
            <span>{label}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs p-3">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Whether DevControl&apos;s own API and database are responding. Not a status of your AWS resources.
            </p>
            <div className="pt-2 border-t border-border">
              <a
                href="/status"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View DevControl status →
              </a>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
