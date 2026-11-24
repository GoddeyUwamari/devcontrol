'use client';

import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SCAN_BANNER_TONE_CLASSES, type ScanBannerTone } from '@/components/ui/scan-status-banner';
import { DISMISS_BANNER, RUN_RUNNING, TRY_AGAIN, type ResultBannerContent } from './costScanBanner';

/**
 * Cost Optimization's ONE banner (founder-locked behaviour, Nov 23): what a
 * "Run cost analysis" run the current user started is doing or did. A page-level
 * banner above the title, never a toast. Running has no ×; a result stays until
 * closed. Its texts and tone come from resultBannerContent(); this file only
 * lays them out. Scheduled runs never reach it.
 */

export type ScanResultView =
  | { phase: 'running' }
  | { phase: 'result'; content: ResultBannerContent };

const ICON: Partial<Record<ScanBannerTone, LucideIcon>> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

export function ScanResultBanner({
  view,
  onClose,
  onRetry,
  onSeeNew,
  retryDisabled = false,
  className,
}: {
  view: ScanResultView;
  onClose: () => void;
  /** Try again: starts a new manual run. */
  onRetry: () => void;
  /** "See the new opportunity": scrolls to Opportunities. */
  onSeeNew: () => void;
  retryDisabled?: boolean;
  className?: string;
}) {
  const running = view.phase === 'running';
  const content = view.phase === 'result' ? view.content : null;
  const tone: ScanBannerTone = content ? content.tone : 'info';
  const Icon = running ? Loader2 : ICON[tone] ?? AlertTriangle;
  const failed = tone === 'danger';

  return (
    <section
      aria-label="Cost analysis"
      data-testid="scan-result-banner"
      data-tone={tone}
      data-phase={view.phase}
      className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-4 py-3', SCAN_BANNER_TONE_CLASSES[tone], className)}
    >
      {/* A failure mounts a fresh alert element: a role change on an existing node isn't reliably announced. */}
      <div
        key={failed ? 'alert' : 'status'}
        role={failed ? 'alert' : 'status'}
        aria-live={failed ? 'assertive' : 'polite'}
        aria-atomic="true"
        aria-busy={running || undefined}
        className="order-1 flex min-w-0 flex-1 items-start gap-3"
      >
        <Icon size={18} aria-hidden="true" className={cn('mt-0.5 shrink-0', running && 'motion-safe:animate-spin')} />
        <div className="min-w-0 flex-1">
          <p className="text-ui font-semibold break-words" data-testid="scan-result-title">{running ? RUN_RUNNING : content!.title}</p>
          {content ? <p className="text-meta break-words" data-testid="scan-result-description">{content.description}</p> : null}
        </div>
      </div>
      {content && (content.link || content.retry) ? (
        // Phones: its own row under the text (aligned with it); from sm up: on the line, before the ×.
        <div className="order-3 flex w-full shrink-0 items-center gap-2 pl-[30px] sm:order-2 sm:w-auto sm:pl-0">
          {content.link ? (
            <Button type="button" variant="outline" size="sm" onClick={onSeeNew} className="bg-white max-sm:min-h-11">{content.link}</Button>
          ) : null}
          {content.retry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retryDisabled} className="bg-white max-sm:min-h-11">{TRY_AGAIN}</Button>
          ) : null}
        </div>
      ) : null}
      {content ? (
        <button
          type="button"
          aria-label={DISMISS_BANNER}
          onClick={onClose}
          className="order-2 -mr-1 inline-flex shrink-0 items-center justify-center rounded-md p-1 hover:bg-white/70 transition-colors max-sm:-my-2.5 max-sm:h-11 max-sm:w-11 sm:order-3"
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
