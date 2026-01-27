'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  const [frameworkType, setFrameworkType] = useState<'built_in' | 'custom'>('custom');
  const [isDefault, setIsDefault] = useState(false);
  const [standardName, setStandardName] = useState('');
  const [version, setVersion] = useState('');

  useEffect(() => {
    if (initialData && open) {
      setName(initialData.name);
      setDescription(initialData.description || '');
      setFrameworkType(initialData.framework_type);
      setIsDefault(initialData.is_default);
      setStandardName(initialData.standard_name || '');
      setVersion(initialData.version || '');
    } else if (!open) {
      // Reset
      setName('');
      setDescription('');
      setFrameworkType('custom');
      setIsDefault(false);
      setStandardName('');
      setVersion('');
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
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        framework_type: frameworkType,
        is_default: isDefault,
        standard_name: standardName.trim() || undefined,
        version: version.trim() || undefined,
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
              placeholder="e.g., SOC 2, HIPAA, Custom Security Framework"
              className="mt-1"
            />
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

          <div>
            <Label>Framework Type</Label>
            <RadioGroup value={frameworkType} onValueChange={(val) => setFrameworkType(val as any)} className="mt-2">
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <RadioGroupItem value="custom" />
                  <span className="ml-2">Custom</span>
                </label>
                <label className="flex items-center cursor-pointer">
                  <RadioGroupItem value="built_in" />
                  <span className="ml-2">Built-in</span>
                </label>
              </div>
            </RadioGroup>
          </div>

          {frameworkType === 'built_in' && (
            <>
              <div>
                <Label htmlFor="standard-name">Standard Name</Label>
                <Input
                  id="standard-name"
                  value={standardName}
                  onChange={(e) => setStandardName(e.target.value)}
                  placeholder="e.g., SOC2, HIPAA, PCI-DSS, CIS"
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="e.g., 1.0, Type II"
                  className="mt-1"
                />
              </div>
            </>
          )}

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
