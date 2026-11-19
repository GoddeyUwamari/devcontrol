'use client';

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock, Info, Loader2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SCAN_BANNER_TONE_CLASSES, type ScanBannerTone } from '@/components/ui/scan-status-banner';
import { DISMISS_BANNER, REVIEW_IT, TRY_AGAIN, type BannerContent } from './costScanBanner';

/**
 * The latest analysis's result, one line across the top of Cost Optimization
 * (tidy mock, founder-approved Nov 19), in the style of GitHub's flash banner:
 * light fill, matching border, circle icon, bold message, sub-line. Its tones
 * and texts come from bannerContent(); this file only lays them out.
 *
 * A dismissible result (never a warning, a failure or an unknown status) has a
 * ×; it stays closed until the result changes (`resultKey` or the text).
 */

const ICON: Record<ScanBannerTone, LucideIcon> = {
  success: CheckCircle2,
  info: Info,
  findings: CircleDollarSign,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: Clock,
};

export function CostAnalysisBanner({
  content,
  meta,
  resultKey,
  onRetry,
  onReview,
  className,
}: {
  content: BannerContent;
  /** "Scheduled analysis, about 2 hours ago": the sub-line's first part. */
  meta?: string;
  /** Identifies the result shown (run and state): a new result re-opens a closed banner. */
  resultKey: string;
  onRetry: () => void;
  onReview: () => void;
  className?: string;
}) {
  const signature = [resultKey, content.tone, content.title, content.description ?? ''].join('\u0000');
  const [closed, setClosed] = useState<string | null>(null);
  if (content.dismissible && closed === signature) return null;

  const Icon = content.busy ? Loader2 : content.icon ?? ICON[content.tone];
  const subLine = [meta, content.description].filter(Boolean).join(' · ');

  return (
    <section
      aria-label="Latest analysis"
      data-testid="scan-status-banner"
      data-tone={content.tone}
      className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-4 py-3', SCAN_BANNER_TONE_CLASSES[content.tone], className)}
    >
      {/* Always mounted while shown, so a change of result is announced. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={content.busy || content.loading || undefined}
        className="order-1 flex min-w-0 flex-1 items-start gap-3"
      >
        {content.loading ? (
          <Skeleton className="h-10 w-full rounded-md" />
        ) : (
          <>
            <Icon size={18} aria-hidden="true" className={cn('mt-0.5 shrink-0', content.busy && 'motion-safe:animate-spin')} />
            <div className="min-w-0 flex-1">
              <p className="text-ui font-semibold">{content.title}</p>
              {subLine ? <p className="text-meta" data-testid="scan-status-subline">{subLine}</p> : null}
            </div>
          </>
        )}
      </div>
      {!content.loading && (content.review || content.retry) ? (
        // Phones: its own row under the text (aligned with it); from sm up: on the line, before the ×.
        <div className="order-3 flex w-full shrink-0 items-center gap-2 pl-[30px] sm:order-2 sm:w-auto sm:pl-0">
          {content.review ? (
            <Button type="button" variant="outline" size="sm" onClick={onReview} className="bg-white">{REVIEW_IT}</Button>
          ) : null}
          {content.retry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry} className="bg-white">{TRY_AGAIN}</Button>
          ) : null}
        </div>
      ) : null}
      {content.dismissible && !content.loading ? (
        <button
          type="button"
          aria-label={DISMISS_BANNER}
          onClick={() => setClosed(signature)}
          className="order-2 -mr-1 shrink-0 rounded-md p-1 hover:bg-white/70 transition-colors sm:order-3"
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
