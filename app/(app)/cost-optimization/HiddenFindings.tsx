'use client';

import { useId, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, RotateCcw, XCircle } from 'lucide-react';
import type { HiddenFinding, HiddenFindings } from '@/lib/services/cost-recommendations.service';
import { cn, formatSavingsCurrency } from '@/lib/utils';
import { formatRecommendationSavings, savingsBasisKind } from '@/lib/savings-basis';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TRY_AGAIN } from './costScanBanner';
import {
  DISMISS,
  DISMISSED_BADGE,
  HIDDEN_LOAD_FAILED,
  HIDE,
  NOT_CONFIRMED,
  NOT_CONFIRMED_REASON,
  REOPEN,
  REVIEW_EMPTY,
  SHOW,
  STILL_DETECTED_TITLE,
  VIEWER_CANT_REOPEN,
  ceilingLine,
  decisionMeta,
  earlierDecisions,
  estimatedIfAddressed,
  notRecheckedLine,
  reviewToggleLabel,
  stillDetectedSubtext,
} from './hiddenFindingsCopy';

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

// Zero reads as muted, never green (PR 2 founder decision 5).
const ZERO_CLASS = 'text-slate-500';

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
  const rec = { potentialSavings: item.detection.potentialSavings, metadata: { savings_basis: item.detection.savingsBasis } };
  return (
    <div className="sm:text-right">
      <p className="text-ui font-semibold tabular-nums text-slate-900 whitespace-nowrap">{formatRecommendationSavings(rec, formatSavingsCurrency)}</p>
      {savingsBasisKind(rec) === 'ceiling' && (
        <p className="text-label text-ink-muted font-medium">Estimated ceiling, not an expected saving</p>
      )}
    </div>
  );
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
            <span className="text-ui font-semibold text-slate-900 break-words">{item.issue}</span>
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
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Chip>{item.resourceId}</Chip>
            {item.resourceName && <Chip>{item.resourceName}</Chip>}
            {item.resourceType && <Chip>{item.resourceType}</Chip>}
            {item.awsRegion && <Chip>{item.awsRegion}</Chip>}
          </div>
          <p className="text-label font-normal text-ink-muted">{decisionMeta(item)}</p>
          {history && <p className="text-label font-normal text-ink-muted">{history}</p>}
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
              className="flex items-center gap-1 bg-white text-slate-800 px-3 py-1.5 rounded-lg text-label font-semibold border border-slate-300 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RotateCcw size={12} aria-hidden="true" /> {REOPEN}
            </button>
            {inGroup && (
              <button
                type="button"
                onClick={() => actions.onDismiss(item.id)}
                disabled={busy}
                className="flex items-center gap-1 bg-transparent text-ink-muted px-3 py-1.5 rounded-lg text-label font-medium border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
export function StillDetectedSlot({ view, actions, onRetry }: { view: HiddenView; actions: ItemActions; onRetry: () => void }) {
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
      aria-labelledby={showGroup ? headingId : undefined}
      aria-label={showGroup ? undefined : STILL_DETECTED_TITLE}
      aria-busy={view.status === 'loading' || undefined}
      data-testid="still-detected-slot"
      className="mb-6"
    >
      <div aria-live="polite" aria-atomic="true" data-testid="still-detected-live">
        {view.status === 'error' ? (
          <div className="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5" data-testid="hidden-load-failed">
            <AlertTriangle size={16} className="text-amber-700 shrink-0" aria-hidden="true" />
            <p className="text-ui text-slate-900 flex-1 min-w-0">{HIDDEN_LOAD_FAILED}</p>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>{TRY_AGAIN}</Button>
          </div>
        ) : showGroup ? (
          <div className="bg-white border border-slate-200 rounded-t-xl px-4 pt-4 pb-3 sm:px-5">
            <div className="flex flex-wrap items-center gap-2 mb-1.5">
              <h2 id={headingId} className="text-ui font-semibold text-slate-900">{STILL_DETECTED_TITLE}</h2>
              <span className="text-label font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 tabular-nums" data-testid="still-detected-count">{count}</span>
            </div>
            <p className="text-meta text-ink-muted mb-2">{stillDetectedSubtext(count)}</p>
            <p className={cn('text-ui font-semibold tabular-nums', estimate === 0 ? ZERO_CLASS : 'text-slate-900')}>{estimatedIfAddressed(formatSavingsCurrency(estimate))}</p>
            {ceiling > 0 && <p className="text-meta text-ink-muted mt-0.5">{ceilingLine(formatSavingsCurrency(ceiling))}</p>}
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
export function ReviewList({ data, actions }: { data: HiddenFindings; actions: ItemActions }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const total = data.summary.resolved + data.summary.dismissed;

  return (
    <section className="mt-6" data-testid="review-list">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full sm:w-auto items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-ui font-semibold text-slate-900 hover:bg-slate-50 transition-colors"
      >
        <span>{reviewToggleLabel(total)}</span>
        <span className="inline-flex items-center gap-1 text-label font-medium text-ink-muted">
          {open ? HIDE : SHOW}
          {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
        </span>
      </button>
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
