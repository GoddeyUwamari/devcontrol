'use client';

import { Check, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface SystemStatusBadgeProps {
  className?: string;
}

export function SystemStatusBadge({ className }: SystemStatusBadgeProps) {
  // In production, this would check actual system status
  const status = {
    operational: true,
    uptime: '99.9%',
    lastIncident: null,
    dataFresh: true,
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all cursor-help',
              status.operational
                ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400 border border-green-200 dark:border-green-800'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border border-blue-200 dark:border-blue-800',
              className
            )}
          >
            {status.operational ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                <span>All Systems Operational</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-3 h-3" />
                <span>Degraded Performance</span>
              </>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs p-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-medium">System Status</span>
              <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Operational
              </span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>Uptime (30d)</span>
                <span className="font-medium text-foreground">{status.uptime}</span>
              </div>
              <div className="flex justify-between">
                <span>Last incident</span>
                <span className="font-medium text-foreground">None in 30 days</span>
              </div>
            </div>
            <div className="pt-2 border-t border-border">
              <a
                href="/status"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                View status page →
              </a>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
