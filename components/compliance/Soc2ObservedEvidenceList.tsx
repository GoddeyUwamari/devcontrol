'use client';

import { useState } from 'react';
import { Copy, ShieldCheck } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useSoc2Evidence } from '@/lib/hooks/useSoc2Readiness';
import { formatLocalWhen } from '@/lib/utils/localTime';
import { EvidenceResultBadge, ProvenanceBadge } from './soc2-badges';
import { evidenceHeading, evidenceResultLine, evidenceResultTitle } from './soc2-evidence-display';

/**
 * AWS-Observed Evidence -- Phase 2 technical observations only (provenance is always
 * OBSERVED here; never blended with customer-provided/SELF_ATTESTED evidence, see
 * Soc2CustomerEvidenceSection for that separate, distinctly-labeled section). Only
 * fields the Phase 2 API actually returns are shown -- no account ID, no internal
 * database id, no organization id (the API doesn't provide any of these).
 */
export function Soc2ObservedEvidenceList({ criterionId }: { criterionId: string }) {
  const { data: evidence, isLoading, error } = useSoc2Evidence(criterionId);
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = (arn: string) => {
    navigator.clipboard?.writeText(arn).then(() => {
      setCopied(arn);
      setTimeout(() => setCopied((c) => (c === arn ? null : c)), 1500);
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
        <p className="text-ui text-ink-danger">{error instanceof Error ? error.message : 'Failed to load AWS-observed evidence'}</p>
      </div>
    );
  }

  if (!evidence || evidence.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No AWS-observed evidence yet"
        description="Technical evidence for this criterion has not been collected yet. This is not the same as a failed or negative result."
      />
    );
  }

  const now = Date.now();

  return (
    <div className="flex flex-col gap-2.5">
      {evidence.map((obs, idx) => (
        <div
          key={`${obs.resourceArn ?? 'org-level'}-${idx}`}
          className="border border-slate-100 rounded-lg p-4"
          title={evidenceResultTitle(obs.explanation)}
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0 flex items-start gap-1.5">
              <p className="text-label text-slate-900 break-all">
                {evidenceHeading(obs.resourceType, obs.resourceArn)}
              </p>
              {obs.resourceArn && (
                <button
                  type="button"
                  onClick={() => handleCopy(obs.resourceArn as string)}
                  className="text-meta text-ink-muted hover:text-violet-600 inline-flex items-center gap-1 shrink-0"
                  title={obs.resourceArn}
                  aria-label="Copy ARN"
                >
                  <Copy size={11} className="shrink-0" />
                  {copied === obs.resourceArn && <span className="text-ink-success">Copied</span>}
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <ProvenanceBadge provenance={obs.provenance} />
              <EvidenceResultBadge result={obs.result} />
            </div>
          </div>
          <p className="text-meta text-slate-600 leading-relaxed mb-2">{evidenceResultLine(obs.explanation)}</p>
          <p className="text-meta text-ink-muted">Observed {formatLocalWhen(obs.observedAt ?? obs.collectedAt, now)}</p>
        </div>
      ))}
    </div>
  );
}
