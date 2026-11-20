'use client';

import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Clock, Info, Loader2, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SCAN_BANNER_TONE_CLASSES, type ScanBannerTone } from '@/components/ui/scan-status-banner';
import {
  DISMISS_BANNER,
  REVIEW_IT,
  RUN_FAILED,
  RUN_RESULT_AUTO_HIDE_MS,
  RUN_RUNNING,
  TRY_AGAIN,
  type BannerContent,
  type ToastKind,
} from './costScanBanner';

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
            <Button type="button" variant="outline" size="sm" onClick={onReview} className="bg-white max-sm:min-h-11">{REVIEW_IT}</Button>
          ) : null}
          {content.retry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry} className="bg-white max-sm:min-h-11">{TRY_AGAIN}</Button>
          ) : null}
        </div>
      ) : null}
      {content.dismissible && !content.loading ? (
        <button
          type="button"
          aria-label={DISMISS_BANNER}
          onClick={() => setClosed(signature)}
          className="order-2 -mr-1 inline-flex shrink-0 items-center justify-center rounded-md p-1 hover:bg-white/70 transition-colors max-sm:-my-2.5 max-sm:h-11 max-sm:w-11 sm:order-3"
        >
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}

/**
 * What "Run cost analysis" is doing or did, in this page's session. `id` is
 * the click it belongs to, so a new click re-opens a closed banner and
 * restarts the auto-hide.
 */
export type RunResult =
  | { phase: 'running'; id: number }
  | { phase: 'finished'; id: number; kind: ToastKind; text: string }
  | { phase: 'failed'; id: number; message: string | null };

const RUN_TONE: Record<ToastKind, ScanBannerTone> = { success: 'success', info: 'info', warning: 'warning' };
const RUN_ICON: Record<ToastKind, LucideIcon> = { success: CheckCircle2, info: Info, warning: AlertTriangle };

/**
 * The "Run cost analysis" result, in the top banner slot (founder ruling 1,
 * light-lane layout): the page shows it in place of the Latest analysis banner
 * while a run is going or its result is showing, never both. Running and a
 * finished run are a polite status; a failure is an alert. A finished run of
 * the success or info kind hides itself after 10 seconds; a warning (partial
 * run) or a failure stays until closed.
 */
export function RunResultBanner({ result, onClose, className }: {
  result: RunResult;
  onClose: () => void;
  className?: string;
}) {
  const autoHide = result.phase === 'finished' && result.kind !== 'warning';
  useEffect(() => {
    if (!autoHide) return undefined;
    const timer = setTimeout(onClose, RUN_RESULT_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [autoHide, result.id, onClose]);

  const tone: ScanBannerTone = result.phase === 'running' ? 'info' : result.phase === 'failed' ? 'danger' : RUN_TONE[result.kind];
  const Icon = result.phase === 'running' ? Loader2 : result.phase === 'failed' ? XCircle : RUN_ICON[result.kind];
  const title = result.phase === 'running' ? RUN_RUNNING : result.phase === 'failed' ? RUN_FAILED : result.text;
  const detail = result.phase === 'failed' ? result.message : null;
  const failed = result.phase === 'failed';

  return (
    <section
      aria-label="Cost analysis"
      data-testid="run-result-banner"
      data-tone={tone}
      data-phase={result.phase}
      className={cn('flex items-start gap-2 rounded-lg border py-1.5 pl-4 pr-1.5', SCAN_BANNER_TONE_CLASSES[tone], className)}
    >
      {/* A failure mounts a fresh alert element: a role change on an existing node isn't reliably announced. */}
      <div
        key={failed ? 'alert' : 'status'}
        role={failed ? 'alert' : 'status'}
        aria-live={failed ? 'assertive' : 'polite'}
        aria-atomic="true"
        className="flex min-w-0 flex-1 items-start gap-3 py-1.5"
      >
        <Icon size={18} aria-hidden="true" className={cn('mt-0.5 shrink-0', result.phase === 'running' && 'motion-safe:animate-spin')} />
        <p className="min-w-0 flex-1 text-ui font-semibold break-words" data-testid="run-result-text">
          {title}
          {detail ? <span className="font-normal"> {detail}</span> : null}
        </p>
      </div>
      <button
        type="button"
        aria-label={DISMISS_BANNER}
        onClick={onClose}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md hover:bg-white/70 transition-colors"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </section>
  );
}
