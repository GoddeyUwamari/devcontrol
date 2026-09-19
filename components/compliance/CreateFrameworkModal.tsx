'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { ComplianceFramework } from '@/lib/services/compliance-frameworks.service';

interface CreateFrameworkModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  initialData?: ComplianceFramework;
  isEditing?: boolean;
}

export function CreateFrameworkModal({ open, onClose, onSubmit, initialData, isEditing = false }: CreateFrameworkModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    if (initialData && open) {
      setName(initialData.name);
      setDescription(initialData.description || '');
      setIsDefault(initialData.is_default);
    } else if (!open) {
      // Reset
      setName('');
      setDescription('');
      setIsDefault(false);
    }
  }, [initialData, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      alert('Please enter a framework name');
      return;
    }

    setSubmitting(true);
    try {
      // framework_type is always 'custom' -- this modal only ever creates
      // customer-authored frameworks. The backend independently rejects
      // 'built_in' and any reserved/branded standard name regardless of
      // what this client sends; the server is the actual boundary, not this
      // UI (see checkFrameworkBrandingViolation in
      // backend/src/controllers/compliance-frameworks.controller.ts).
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        framework_type: 'custom',
        is_default: isDefault,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit' : 'Create'} Compliance Framework</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update framework details' : 'Define a new compliance framework with custom rules'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Label htmlFor="name">Framework Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Internal Data Handling Policy"
              className="mt-1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Custom frameworks are your own rules -- this can&apos;t be named after an
              officially-supported standard (e.g. SOC 2, NIST, CIS, PCI DSS, HIPAA).
            </p>
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the purpose and scope of this framework"
              className="mt-1"
              rows={3}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="is-default" checked={isDefault} onCheckedChange={(checked) => setIsDefault(!!checked)} />
            <Label htmlFor="is-default" className="cursor-pointer">
              Apply this framework by default to all scans
            </Label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : isEditing ? 'Update Framework' : 'Create Framework'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
