'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';

interface BulkTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedResourceIds: string[]; // resource IDs from database
  onSuccess: () => void;
}

export function BulkTagDialog({
  open,
  onOpenChange,
  selectedResourceIds,
  onSuccess
}: BulkTagDialogProps) {
  const [tags, setTags] = useState<Array<{ key: string; value: string }>>([
    { key: '', value: '' }
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addTagRow = () => {
    setTags([...tags, { key: '', value: '' }]);
  };

  const removeTagRow = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const updateTag = (index: number, field: 'key' | 'value', value: string) => {
    const newTags = [...tags];
    newTags[index][field] = value;
    setTags(newTags);
  };

  const handleSubmit = async () => {
    // Validate tags
    const validTags = tags.filter(tag => tag.key && tag.value);

    if (validTags.length === 0) {
      toast.error('Please add at least one tag');
      return;
    }

    if (selectedResourceIds.length === 0) {
      toast.error('No resources selected');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/aws-resources/bulk-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceIds: selectedResourceIds,
          tags: validTags.reduce((acc, tag) => {
            acc[tag.key] = tag.value;
            return acc;
          }, {} as Record<string, string>),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to apply tags');
      }

      toast.success(`Successfully tagged ${selectedResourceIds.length} resource${selectedResourceIds.length !== 1 ? 's' : ''}`);
      onSuccess();
      onOpenChange(false);
      // Reset tags
      setTags([{ key: '', value: '' }]);
    } catch (error: any) {
      toast.error(error.message || 'Failed to apply tags');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Tag Resources</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Apply tags to {selectedResourceIds.length} selected resource{selectedResourceIds.length !== 1 ? 's' : ''}
          </p>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {tags.map((tag, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <Label>Tag Key</Label>
                <Input
                  placeholder="Environment"
                  value={tag.key}
                  onChange={(e) => updateTag(index, 'key', e.target.value)}
                />
              </div>
              <div className="flex-1">
                <Label>Tag Value</Label>
                <Input
                  placeholder="production"
                  value={tag.value}
                  onChange={(e) => updateTag(index, 'value', e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeTagRow(index)}
                disabled={tags.length === 1}
                aria-label="Remove tag"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={addTagRow}
            className="w-full"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Another Tag
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Applying...' : 'Apply Tags'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
