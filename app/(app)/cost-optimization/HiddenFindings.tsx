'use client';

import { useId, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RotateCcw, XCircle } from 'lucide-react';
import type { HiddenFinding, HiddenFindings } from '@/lib/services/cost-recommendations.service';
import { cn, formatSavingsCurrency } from '@/lib/utils';
import { DEFAULT_PRICE_DISCLOSURE, NO_DOLLAR_ESTIMATE, formatSavingsFigure, isDefaultPriceEstimate, savingsFigure } from '@/lib/savings-basis';
import { LOW_ACTIVITY_DISPLAY_LABEL, lowActivitySavingsHeadline } from '@/lib/finding-display';
import { Button } from '@/components/ui/button';
import { SeverityBadge } from '@/components/ui/severity-badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { SeverityLevel } from '@/lib/utils/severity-colors';
import { TRY_AGAIN } from './costScanBanner';
import {
  DISMISS,
  DISMISSED_BADGE,
  HIDDEN_LOAD_FAILED,
  HIDE,
  NOT_CONFIRMED,
  NOT_CONFIRMED_REASON,
  NOT_COUNTED_WHILE_RESOLVED,
  REOPEN,
  REVIEW_EMPTY,
  dismissedFoundAgainLine,
  SHOW,
  STILL_DETECTED_TITLE,
  VIEWER_CANT_REOPEN,
  ceilingLine,
  decisionMeta,
  earlierDecisions,
  estimatedIfAddressed,
  notRecheckedLine,
  reviewToggleLabel,
  stillDetectedHeading,
  stillDetectedMeta,
  stillDetectedSubtext,
} from './hiddenFindingsCopy';

/** The slot's id: the banner's "Review it" scrolls here. */
export const STILL_DETECTED_ANCHOR = 'still-detected';

/** "Review it": bring the Still detected group into view and move focus to its heading. */
export function scrollToStillDetected(): void {
  const slot = document.getElementById(STILL_DETECTED_ANCHOR);
  if (!slot) return;
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  slot.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  slot.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/**
 * Hidden findings on Cost Optimization (PR 3b): the "Still detected" group
 * under the KPI cards and the collapsed "Resolved and dismissed" review list.
 * Presentational: renders GET /hidden as returned. Whether a finding is still
 * detected is the backend's judgement (detection.state); this file never
 * derives it from dates, runs or anything else.
 */

/** The /hidden query as the page sees it. A failed request is never treated as empty. */
export type HiddenView =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: HiddenFindings };

const CAN_REOPEN = ['owner', 'admin', 'member'];

export interface ItemActions {
  /** The current role; null while unknown, which fails closed (disabled). */
  role: string | null;
  /** Ids with a reopen or dismiss in flight (until its refresh finishes). */
  pendingIds: ReadonlySet<string>;
  onReopen: (id: string) => void;
  onDismiss: (id: string) => void;
}

/** The group's items: exactly the resolved findings the backend marks still detected. */
export function stillDetectedItems(data: HiddenFindings): HiddenFinding[] {
  return data.items.filter((item) => item.decision === 'RESOLVED' && item.detection.state === 'still_detected');
}

function Chip({ children }: { children: string }) {
  return <span className="bg-slate-100 text-ink-muted text-label font-medium px-2 py-0.5 rounded-full break-all">{children}</span>;
}

function ItemSavings({ item }: { item: HiddenFinding }) {
  if (item.detection.potentialSavings === null) return null;
  const rec = { potentialSavings: item.detection.potentialSavings, metadata: { savings_basis: item.detection.savingsBasis, price_source: item.detection.priceSource ?? null } };
  // A still-detected low-activity finding (its latest detection carries the new rule's identity,
  // which is what makes the backend label it): the C-3 "Up to ... if it's no longer needed" figure,
  // but never for an estimate (founder screenshot review, round 3): the group summary counts an
  // estimate as "Estimated $X/mo", so its card shows the plain "$X/mo" (formatRecommendationSavings).
  // "Never show $0" (savingsFigure): a figure not above $0 reads "No dollar estimate" in grey, with no ceiling
  // or default-price line under it. /hidden sends no recorded sub-cent amount, so a still-detected figure
  // stored as 0.00 is never shown as one (no API change in this PR).
  const fig = savingsFigure(rec);
  const lowActivity = item.detection.state === 'still_detected' && item.issueLabel === LOW_ACTIVITY_DISPLAY_LABEL && fig.kind !== 'estimate';
  if (fig.kind === 'none') {
    return (
      <div className="sm:text-right">
        <p className="text-ui font-semibold text-ink-muted whitespace-nowrap" data-testid="item-no-figure">{NO_DOLLAR_ESTIMATE}</p>
        <p className="text-label text-ink-muted font-medium" data-testid="not-counted">{NOT_COUNTED_WHILE_RESOLVED}</p>
      </div>
    );
  }
  return (
    <div className="sm:text-right">
      {/* A recorded sub-cent amount would be grey, as on every page (review N-6); /hidden sends none today. */}
      <p className={cn('text-ui font-semibold tabular-nums whitespace-nowrap', fig.subCent ? 'text-ink-muted' : 'text-slate-900')}>
        {lowActivity ? lowActivitySavingsHeadline(fig, formatSavingsCurrency) : formatSavingsFigure(fig, formatSavingsCurrency)}
      </p>
      <p className="text-label text-ink-muted font-medium" data-testid="not-counted">{NOT_COUNTED_WHILE_RESOLVED}</p>
      {fig.kind === 'ceiling' && (
        <p className="text-label text-ink-muted font-medium">Estimated ceiling, not an expected saving</p>
      )}
      {isDefaultPriceEstimate(rec) && (
        <p className="text-label text-ink-muted font-medium sm:max-w-[16rem]" data-testid="default-price-disclosure">{DEFAULT_PRICE_DISCLOSURE}</p>
      )}
    </div>
  );
}

const SEVERITIES: readonly SeverityLevel[] = ['high', 'medium', 'low'];

/** The latest detection's severity as a chip; nothing for a value outside High/Medium/Low. */
function ItemSeverity({ severity }: { severity: string | null }) {
  const level = severity?.toLowerCase() as SeverityLevel | undefined;
  if (!level || !SEVERITIES.includes(level)) return null;
  return <SeverityBadge severity={level} label={level.charAt(0).toUpperCase() + level.slice(1)} />;
}

function HiddenItem({ item, actions, inGroup }: { item: HiddenFinding; actions: ItemActions; inGroup: boolean }) {
  const viewerNoteId = useId();
  const busy = actions.pendingIds.has(item.id);
  const canReopen = actions.role !== null && CAN_REOPEN.includes(actions.role);
  const isViewer = actions.role === 'viewer';
  const stillDetected = item.detection.state === 'still_detected';
  const history = earlierDecisions(item.decisionCount);

  return (
    <li className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 min-w-0" data-testid="hidden-item" data-item-id={item.id}>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-ui font-semibold text-slate-900 break-words">{item.issueLabel ?? item.issue}</span>
            {inGroup && <ItemSeverity severity={item.detection.severity} />}
            {inGroup && (
              <span className="text-label font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200" data-testid="still-detected-chip">{STILL_DETECTED_TITLE}</span>
            )}
            {!inGroup && item.decision === 'DISMISSED' && (
              <span className="text-label font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{DISMISSED_BADGE}</span>
            )}
            {!inGroup && (stillDetected ? (
              <span className="text-label font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">{STILL_DETECTED_TITLE}</span>
            ) : (
              <span className="text-label font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{NOT_CONFIRMED}</span>
            ))}
          </div>
          {!stillDetected && item.detection.reason && (
            <p className="text-meta text-ink-muted mb-2">{NOT_CONFIRMED_REASON[item.detection.reason]}</p>
          )}
          {inGroup && <p className="text-meta text-ink-muted mb-2" data-testid="still-detected-meta">{stillDetectedMeta(item)}</p>}
          <div className={cn('flex flex-wrap gap-1.5', !inGroup && 'mb-2')}>
            <Chip>{item.resourceId}</Chip>
            {item.resourceName && <Chip>{item.resourceName}</Chip>}
            {item.resourceType && <Chip>{item.resourceType}</Chip>}
            {item.awsRegion && <Chip>{item.awsRegion}</Chip>}
          </div>
          {!inGroup && <p className="text-label font-normal text-ink-muted">{decisionMeta(item)}</p>}
          {history && <p className={cn('text-label font-normal text-ink-muted', inGroup && 'mt-2')}>{history}</p>}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          {inGroup && <ItemSavings item={item} />}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => actions.onReopen(item.id)}
              disabled={busy || !canReopen}
              aria-describedby={isViewer ? viewerNoteId : undefined}
              title={isViewer ? VIEWER_CANT_REOPEN : undefined}
              className="flex min-h-11 sm:min-h-9 items-center gap-1 bg-white text-slate-800 px-3 py-1.5 rounded-lg text-label font-semibold border border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RotateCcw size={12} aria-hidden="true" /> {REOPEN}
            </button>
            {inGroup && (
              <button
                type="button"
                onClick={() => actions.onDismiss(item.id)}
                disabled={busy}
                className="flex min-h-11 sm:min-h-9 items-center gap-1 bg-transparent text-ink-muted px-3 py-1.5 rounded-lg text-label font-medium border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <XCircle size={12} aria-hidden="true" /> {DISMISS}
              </button>
            )}
          </div>
          {isViewer && <p id={viewerNoteId} className="m-0 text-label text-ink-muted">{VIEWER_CANT_REOPEN}</p>}
        </div>
      </div>
    </li>
  );
}

/**
 * The slot directly under the KPI cards: the Still detected group, C12, C27
 * or nothing. Rendered only when it has something to show (items, C12, C27)
 * or is loading (aria-busy), so there is never an empty "Still detected"
 * region. While shown, its summary sits in a polite live region, so a change
 * from loading to a result, or a count change after a reopen, is announced.
 */
export function StillDetectedSlot({ view, actions, onRetry, retrying = false }: {
  view: HiddenView;
  actions: ItemActions;
  onRetry: () => void;
  /** A retry of /hidden is in flight: C27's button is disabled and busy, and further clicks do nothing. */
  retrying?: boolean;
}) {
  const headingId = useId();
  const items = view.status === 'ready' ? stillDetectedItems(view.data) : [];
  const summary = view.status === 'ready' ? view.data.summary : null;
  const count = summary?.stillDetected.count ?? 0;
  const showGroup = summary !== null && count > 0;
  const showNotRechecked = summary !== null && count === 0 && summary.notConfirmed > 0;
  const estimate = summary?.stillDetected.estimatedMonthlySavings ?? 0;
  const ceiling = summary?.stillDetected.ceilingMonthlySavings ?? 0;

  if (view.status === 'ready' && !showGroup && !showNotRechecked) return null;

  return (
    <section
      id={STILL_DETECTED_ANCHOR}
      aria-labelledby={showGroup ? headingId : undefined}
      aria-label={showGroup ? undefined : STILL_DETECTED_TITLE}
      aria-busy={view.status === 'loading' || undefined}
      data-testid="still-detected-slot"
      className="scroll-mt-24"
    >
      <div aria-live="polite" aria-atomic="true" data-testid="still-detected-live">
        {view.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5" data-testid="hidden-load-failed">
            <AlertTriangle size={16} className="text-amber-700 shrink-0" aria-hidden="true" />
            <p className="text-ui text-slate-900 flex-1 min-w-0">{HIDDEN_LOAD_FAILED}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retrying}
              aria-busy={retrying || undefined}
              onClick={() => { if (!retrying) onRetry(); }}
              data-testid="hidden-retry"
            >
              {retrying && <Loader2 size={14} className="mr-1.5 animate-spin" aria-hidden="true" />}
              {TRY_AGAIN}
            </Button>
          </div>
        ) : showGroup ? (
          <div className="bg-white border border-slate-200 rounded-t-xl px-4 pt-4 pb-3 sm:px-5">
            <h2 id={headingId} tabIndex={-1} className="text-ui font-semibold text-slate-900 mb-1.5 tabular-nums outline-none" data-testid="still-detected-heading">
              {stillDetectedHeading(count)}
            </h2>
            <p className="text-meta text-ink-muted mb-2">{stillDetectedSubtext(count)}</p>
            {/* Each amount in its own kind's words (round 3): C8 "Estimated" only for estimates; a group of
                ceilings only shows C9, never "Estimated $0/mo". With no amount at all, no amount line (ruling Q3). */}
            {estimate > 0 && (
              <p className="text-ui font-semibold tabular-nums text-slate-900" data-testid="still-detected-estimate">{estimatedIfAddressed(formatSavingsCurrency(estimate))}</p>
            )}
            {ceiling > 0 && <p className="text-meta text-ink-muted mt-0.5" data-testid="still-detected-ceiling">{ceilingLine(formatSavingsCurrency(ceiling))}</p>}
          </div>
        ) : showNotRechecked ? (
          <p className="text-meta text-ink-muted" data-testid="not-rechecked">{notRecheckedLine(summary.notConfirmed)}</p>
        ) : null}
      </div>
      {view.status === 'loading' && <Skeleton className="h-20 w-full rounded-xl" data-testid="hidden-loading" />}
      {showGroup && (
        <ul className="flex flex-col gap-3 bg-slate-50 border border-t-0 border-slate-200 rounded-b-xl p-3 sm:p-4 list-none m-0">
          {items.map((item) => <HiddenItem key={item.id} item={item} actions={actions} inGroup />)}
        </ul>
      )}
    </section>
  );
}

/** The collapsed review list of every resolved and dismissed finding. Only rendered when /hidden loaded. */
export function ReviewList({ data, actions, dismissedFoundAgain = null }: {
  data: HiddenFindings;
  actions: ItemActions;
  /** The latest analysis's own count of dismissed findings it found again (null: not recorded); hidden at 0. */
  dismissedFoundAgain?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const total = data.summary.resolved + data.summary.dismissed;

  return (
    <section data-testid="review-list">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full sm:w-auto items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-ui font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
      >
        <span>{reviewToggleLabel(total)}</span>
        <span className="inline-flex items-center gap-1 text-label font-medium text-ink-muted">
          {open ? HIDE : SHOW}
          {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </span>
      </button>
      {dismissedFoundAgain !== null && dismissedFoundAgain > 0 && (
        <p className="text-meta text-ink-muted mt-2" data-testid="dismissed-found-again">{dismissedFoundAgainLine(dismissedFoundAgain)}</p>
      )}
      {open && (
        <div id={listId} className="mt-3">
          {data.items.length === 0 ? (
            <p className="text-meta text-ink-muted">{REVIEW_EMPTY}</p>
          ) : (
            <ul className="flex flex-col gap-3 list-none m-0 p-0">
              {data.items.map((item) => <HiddenItem key={item.id} item={item} actions={actions} inGroup={false} />)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
