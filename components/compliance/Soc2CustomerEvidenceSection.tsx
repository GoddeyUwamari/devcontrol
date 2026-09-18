'use client';

import { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useCustomerEvidenceList } from '@/lib/hooks/useCustomerEvidence';
import { Soc2CustomerEvidence, Soc2ReadinessCriterion } from '@/lib/services/soc2.service';
import { CustomerEvidenceStatusBadge, ProvenanceBadge } from './soc2-badges';
import { Soc2CustomerEvidenceForm } from './Soc2CustomerEvidenceForm';
import { Soc2ExternalReferenceLink } from './Soc2ExternalReferenceLink';

const DESCRIPTION_TRUNCATE_LENGTH = 160;

function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max).trimEnd() + '…', truncated: true };
}

interface Soc2CustomerEvidenceSectionProps {
  criterionId?: string;
  criteria: Soc2ReadinessCriterion[];
  canManage: boolean;
}

/**
 * Customer-Provided Evidence section -- deliberately visually and structurally distinct
 * from the AWS-Observed Evidence section (see Soc2CriterionDetailPage), always tagged
 * SELF_ATTESTED. Lifecycle status (SUBMITTED/REVIEWED/EXPIRED/SUPERSEDED) is DISPLAY
 * ONLY here -- no review/expire/supersede control exists anywhere in this component.
 * Those transitions require requirePlatformStaff server-side and have no customer-facing
 * representation; a customer's own role can never satisfy that check.
 */
export function Soc2CustomerEvidenceSection({ criterionId, criteria, canManage }: Soc2CustomerEvidenceSectionProps) {
  const { data: evidence, isLoading, error } = useCustomerEvidenceList(criterionId, canManage);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Soc2CustomerEvidence | null>(null);
  const [detail, setDetail] = useState<Soc2CustomerEvidence | null>(null);

  if (!canManage) {
    // Enterprise gating is handled by the caller (shows UpgradePrompt instead of this
    // section entirely) -- this component assumes canManage means "render normally."
    return null;
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-7">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-1">Customer-Provided Evidence</p>
          <p className="text-xs text-slate-500">Self-attested supporting evidence your organization submits — not AWS-observed, not verified by DevControl.</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus size={14} className="mr-1.5" /> Add Evidence
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Failed to load customer evidence'}</p>
        </div>
      ) : !evidence || evidence.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No customer-provided evidence yet"
          description="Submit supporting evidence — such as a policy document, procedure, or attestation — for this criterion."
          action={{ label: 'Add Evidence', onClick: () => { setEditing(null); setFormOpen(true); } }}
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {evidence.map((item) => {
            const { text: shortDescription, truncated } = truncate(item.description ?? '', DESCRIPTION_TRUNCATE_LENGTH);
            const canEdit = item.status === 'SUBMITTED';
            return (
              <div key={item.evidenceId} className="border border-slate-100 rounded-lg p-4 hover:border-slate-200 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <button
                      type="button"
                      onClick={() => setDetail(item)}
                      className="text-sm font-semibold text-slate-900 hover:text-violet-600 text-left"
                    >
                      {item.title}
                    </button>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {item.criterionId} · {item.evidenceType}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <ProvenanceBadge provenance={item.provenance} />
                    <CustomerEvidenceStatusBadge status={item.status} />
                  </div>
                </div>
                {shortDescription && (
                  <p className="text-xs text-slate-600 leading-relaxed mb-2">
                    {shortDescription}
                    {truncated && (
                      <button type="button" onClick={() => setDetail(item)} className="text-violet-600 font-medium ml-1">
                        View more
                      </button>
                    )}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-xs text-slate-400">Submitted {new Date(item.submittedAt).toLocaleDateString()}</p>
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(item);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Soc2CustomerEvidenceForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        criteria={criteria}
        defaultCriterionId={criterionId}
        editing={editing}
      />

      <Dialog open={detail !== null} onOpenChange={() => setDetail(null)}>
        <DialogContent className="max-w-lg">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.title}</DialogTitle>
                <DialogDescription>
                  {detail.criterionId} · {detail.evidenceType}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <ProvenanceBadge provenance={detail.provenance} />
                  <CustomerEvidenceStatusBadge status={detail.status} />
                </div>
                {detail.description && (
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{detail.description}</p>
                )}
                {detail.externalReference && <Soc2ExternalReferenceLink href={detail.externalReference} />}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs pt-2 border-t border-slate-100">
                  <dt className="text-slate-400">Submitted at</dt>
                  <dd className="text-slate-700">{new Date(detail.submittedAt).toLocaleString()}</dd>
                  {detail.reviewDate && (
                    <>
                      <dt className="text-slate-400">Review date</dt>
                      <dd className="text-slate-700">{new Date(detail.reviewDate).toLocaleDateString()}</dd>
                    </>
                  )}
                  <dt className="text-slate-400">Updated at</dt>
                  <dd className="text-slate-700">{new Date(detail.updatedAt).toLocaleString()}</dd>
                </dl>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
