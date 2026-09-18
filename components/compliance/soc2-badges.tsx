/**
 * Small SOC 2 status badges, built on the existing Badge primitive
 * (components/ui/badge.tsx) -- no new primitive, only new label/color mappings.
 *
 * Deliberately NOT the CIS/PCI/NIST "passed/failed" pattern: SOC 2's disposition,
 * result, provenance, and lifecycle-status vocabularies are each a different axis of
 * meaning (see backend/src/types/soc2-evidence.types.ts) and must never collapse into a
 * binary PASS/FAIL/compliant reading. Every badge below pairs a visible text label with
 * its color -- color is never the sole signal.
 */
'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Soc2CustomerEvidenceStatus,
  Soc2DispositionClass,
  Soc2EvidenceProvenance,
  Soc2EvidenceResult,
} from '@/lib/services/soc2.service';

const DISPOSITION_LABELS: Record<Soc2DispositionClass, string> = {
  A_OBSERVABLE: 'Directly Observable',
  B_DERIVABLE: 'Derivable',
  C_SELF_ATTESTED: 'Self-Attested',
  D_ADDITIONAL_EVIDENCE: 'Additional Evidence',
  E_NOT_ESTABLISHABLE: 'Not Establishable',
};

export function DispositionBadge({ dispositionClass, className }: { dispositionClass: Soc2DispositionClass; className?: string }) {
  return (
    <Badge variant="outline" className={cn('border-violet-200 bg-violet-50 text-violet-700', className)}>
      {DISPOSITION_LABELS[dispositionClass]}
    </Badge>
  );
}

const RESULT_STYLES: Record<Soc2EvidenceResult, { label: string; className: string }> = {
  SUPPORTS: { label: 'Supports', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  CONTRADICTS: { label: 'Contradicts', className: 'border-red-200 bg-red-50 text-red-700' },
  // Visually neutral -- never defaults to a red/green reading.
  UNKNOWN: { label: 'Unknown', className: 'border-slate-200 bg-slate-50 text-slate-600' },
};

export function EvidenceResultBadge({ result, className }: { result: Soc2EvidenceResult; className?: string }) {
  const style = RESULT_STYLES[result];
  return (
    <Badge variant="outline" className={cn(style.className, className)}>
      {style.label}
    </Badge>
  );
}

const PROVENANCE_LABELS: Record<Soc2EvidenceProvenance, string> = {
  OBSERVED: 'AWS-Observed',
  DERIVED: 'Derived',
  SELF_ATTESTED: 'Self-Attested',
};

export function ProvenanceBadge({ provenance, className }: { provenance: Soc2EvidenceProvenance; className?: string }) {
  const isCustomer = provenance === 'SELF_ATTESTED';
  return (
    <Badge
      variant="outline"
      className={cn(
        isCustomer ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-blue-200 bg-blue-50 text-blue-700',
        className
      )}
    >
      {PROVENANCE_LABELS[provenance]}
    </Badge>
  );
}

const STATUS_STYLES: Record<Soc2CustomerEvidenceStatus, { label: string; className: string }> = {
  SUBMITTED: { label: 'Submitted', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  // "Reviewed by DevControl" only -- never "Approved"/"Certified"/"Compliant". See
  // backend/src/routes/soc2-customer-evidence.routes.ts's own docblock: REVIEWED means
  // only that an authorized platform-staff reviewer reviewed the record.
  REVIEWED: { label: 'Reviewed by DevControl', className: 'border-violet-200 bg-violet-50 text-violet-700' },
  EXPIRED: { label: 'Expired', className: 'border-slate-200 bg-slate-100 text-slate-500' },
  SUPERSEDED: { label: 'Superseded', className: 'border-slate-200 bg-slate-100 text-slate-500' },
};

export function CustomerEvidenceStatusBadge({ status, className }: { status: Soc2CustomerEvidenceStatus; className?: string }) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn(style.className, className)}>
      {style.label}
    </Badge>
  );
}
