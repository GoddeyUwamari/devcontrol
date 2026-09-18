'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { useCreateCustomerEvidence, useUpdateCustomerEvidenceMetadata } from '@/lib/hooks/useCustomerEvidence';
import { Soc2CustomerEvidence, Soc2CustomerEvidenceType, Soc2ReadinessCriterion } from '@/lib/services/soc2.service';
import { ProvenanceBadge } from './soc2-badges';

const EVIDENCE_TYPES: Array<{ value: Soc2CustomerEvidenceType; label: string }> = [
  { value: 'policy', label: 'Policy' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'training', label: 'Training' },
  { value: 'attestation', label: 'Attestation' },
  { value: 'other', label: 'Other' },
];

interface Soc2CustomerEvidenceFormProps {
  open: boolean;
  onClose: () => void;
  criteria: Soc2ReadinessCriterion[];
  defaultCriterionId?: string;
  editing?: Soc2CustomerEvidence | null;
}

/**
 * Create/edit form for customer-provided evidence. Fields map only to what the backend
 * actually accepts (backend/src/routes/soc2-customer-evidence.routes.ts): criterion
 * (create only -- PATCH does not accept criterionId), evidenceType, title, description,
 * externalReference, reviewDate. There is no input for provenance, status,
 * organization_id, or submitted_by anywhere in this form -- provenance is shown as a
 * fixed, non-editable SELF_ATTESTED badge, and status always starts SUBMITTED
 * server-side. This is a metadata submission, not an "approval workflow" -- no wording
 * here implies audit or auditor approval.
 */
export function Soc2CustomerEvidenceForm({ open, onClose, criteria, defaultCriterionId, editing }: Soc2CustomerEvidenceFormProps) {
  const isEditing = !!editing;
  const [criterionId, setCriterionId] = useState(defaultCriterionId ?? '');
  const [evidenceType, setEvidenceType] = useState<Soc2CustomerEvidenceType | ''>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [externalReference, setExternalReference] = useState('');
  const [reviewDate, setReviewDate] = useState('');
  const { toast } = useToast();
  const createMutation = useCreateCustomerEvidence();
  const updateMutation = useUpdateCustomerEvidenceMetadata();
  const submitting = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (open && editing) {
      setCriterionId(editing.criterionId);
      setEvidenceType(editing.evidenceType);
      setTitle(editing.title);
      setDescription(editing.description ?? '');
      setExternalReference(editing.externalReference ?? '');
      setReviewDate(editing.reviewDate ? editing.reviewDate.slice(0, 10) : '');
    } else if (open && !editing) {
      setCriterionId(defaultCriterionId ?? '');
      setEvidenceType('');
      setTitle('');
      setDescription('');
      setExternalReference('');
      setReviewDate('');
    }
  }, [open, editing, defaultCriterionId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({ title: 'Title is required' });
      return;
    }
    if (!isEditing && !criterionId) {
      toast({ title: 'Select a criterion' });
      return;
    }
    if (!evidenceType) {
      toast({ title: 'Select an evidence type' });
      return;
    }

    try {
      if (isEditing && editing) {
        await updateMutation.mutateAsync({
          evidenceId: editing.evidenceId,
          request: {
            evidenceType,
            title: title.trim(),
            description: description.trim() || null,
            externalReference: externalReference.trim() || null,
            reviewDate: reviewDate || null,
          },
        });
        toast({ title: 'Evidence updated' });
      } else {
        await createMutation.mutateAsync({
          criterionId,
          evidenceType,
          title: title.trim(),
          description: description.trim() || null,
          externalReference: externalReference.trim() || null,
          reviewDate: reviewDate || null,
        });
        toast({ title: 'Evidence submitted' });
      }
      onClose();
    } catch (err: unknown) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed to save evidence' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Evidence' : 'Submit Customer-Provided Evidence'}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update the metadata for this evidence record.'
              : 'Supporting evidence you provide for a SOC 2 Readiness criterion. This is self-attested by your organization, not verified or audited by DevControl.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="ce-criterion">Criterion</Label>
            {isEditing ? (
              <p id="ce-criterion" className="mt-1 text-sm text-slate-700">
                {criteria.find((c) => c.criterionId === criterionId)?.name ?? criterionId}
              </p>
            ) : (
              <Select value={criterionId} onValueChange={setCriterionId}>
                <SelectTrigger id="ce-criterion" className="mt-1">
                  <SelectValue placeholder="Select a criterion" />
                </SelectTrigger>
                <SelectContent>
                  {criteria.map((c) => (
                    <SelectItem key={c.criterionId} value={c.criterionId}>
                      {c.criterionId} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label htmlFor="ce-type">Evidence Type</Label>
            <Select value={evidenceType} onValueChange={(v) => setEvidenceType(v as Soc2CustomerEvidenceType)}>
              <SelectTrigger id="ce-type" className="mt-1">
                <SelectValue placeholder="Select an evidence type" />
              </SelectTrigger>
              <SelectContent>
                {EVIDENCE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="ce-title">Title *</Label>
            <Input
              id="ce-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g., Encryption at rest policy"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="ce-description">Description</Label>
            <Textarea
              id="ce-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Optional details about this evidence"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="ce-reference">External Reference</Label>
            <Input
              id="ce-reference"
              value={externalReference}
              onChange={(e) => setExternalReference(e.target.value)}
              maxLength={2000}
              placeholder="https://… (a link to the document)"
              className="mt-1"
            />
            <p className="text-xs text-slate-400 mt-1">
              Externally hosted — DevControl stores this link only and does not fetch or verify its contents.
            </p>
          </div>

          <div>
            <Label htmlFor="ce-review-date">Review Date (optional)</Label>
            <Input id="ce-review-date" type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className="mt-1" />
            <p className="text-xs text-slate-400 mt-1">Informational only — does not automatically expire this evidence.</p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Provenance:</span>
            <ProvenanceBadge provenance="SELF_ATTESTED" />
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : isEditing ? 'Save Changes' : 'Submit Evidence'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
