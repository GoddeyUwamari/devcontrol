'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The latest scan's result, shown at the top of a page. Presentational only:
 * each page maps its own scan state to a tone, title and description.
 * Light mode only, like the pages that use it.
 *
 * Tone meaning: success only when every check ran and nothing was flagged or
 * hidden; findings when there are open findings; info when findings are hidden
 * or something couldn't be checked; warning for a partial scan; danger for a
 * failed or interrupted one; neutral for everything else.
 */
export type ScanBannerTone = 'success' | 'info' | 'findings' | 'warning' | 'danger' | 'neutral';

export const SCAN_BANNER_TONE_CLASSES: Record<ScanBannerTone, string> = {
  success: 'bg-green-50 border-green-200 text-green-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  findings: 'bg-violet-50 border-violet-200 text-violet-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  danger: 'bg-red-50 border-red-200 text-red-800',
  neutral: 'bg-slate-50 border-slate-200 text-slate-700',
};

const DEFAULT_ICON: Record<ScanBannerTone, LucideIcon> = {
  success: CheckCircle2,
  info: Info,
  findings: CircleDollarSign,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: Clock,
};

export interface ScanStatusBannerProps {
  tone: ScanBannerTone;
  title: string;
  description?: ReactNode;
  /** e.g. "Manual cost analysis, 5 minutes ago" */
  meta?: string;
  /** A scan is running: spinner and aria-busy. */
  busy?: boolean;
  /** The state isn't known yet: a skeleton in place of the content. */
  loading?: boolean;
  action?: { label: string; onClick: () => void };
  icon?: LucideIcon;
  /** Names the region for assistive technology. */
  label?: string;
  className?: string;
}

export function ScanStatusBanner({
  tone,
  title,
  description,
  meta,
  busy = false,
  loading = false,
  action,
  icon,
  label = 'Latest analysis',
  className,
}: ScanStatusBannerProps) {
  const Icon = busy ? Loader2 : icon ?? DEFAULT_ICON[tone];

  return (
    <section
      aria-label={label}
      data-testid="scan-status-banner"
      data-tone={tone}
      className={cn('flex flex-col gap-3 rounded-xl border px-4 py-3.5 sm:flex-row sm:items-center', SCAN_BANNER_TONE_CLASSES[tone], className)}
    >
      {/* Always mounted, so a change of result is announced. Polite for every tone. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={busy || loading || undefined}
        className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3.5"
      >
        {loading ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-start gap-3.5 sm:items-center">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/70" aria-hidden="true">
                <Icon size={18} className={busy ? 'motion-safe:animate-spin' : undefined} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-ui font-semibold">{title}</p>
                {description ? <p className="text-meta">{description}</p> : null}
              </div>
            </div>
            {meta ? <span className="text-label font-medium sm:shrink-0 sm:whitespace-nowrap">{meta}</span> : null}
          </>
        )}
      </div>
      {action && !loading ? (
        <Button type="button" variant="outline" size="sm" onClick={action.onClick} className="w-full sm:w-auto">
          {action.label}
        </Button>
      ) : null}
    </section>
  );
}
