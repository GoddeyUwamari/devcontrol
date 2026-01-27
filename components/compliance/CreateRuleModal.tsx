'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
const CATEGORIES = ['encryption', 'backups', 'public_access', 'tagging', 'iam', 'networking', 'custom'] as const;
const RULE_TYPES = ['property_check', 'tag_required', 'tag_pattern', 'metadata_check', 'custom_script'] as const;
const RESOURCE_TYPES = ['ec2', 'rds', 's3', 'lambda', 'ecs', 'elb'];

interface CreateRuleModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: any) => Promise<void>;
  initialData?: any;
  isEditing?: boolean;
}

export function CreateRuleModal({ open, onClose, onSubmit, initialData, isEditing = false }: CreateRuleModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [ruleCode, setRuleCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'critical' | 'high' | 'medium' | 'low'>('medium');
  const [category, setCategory] = useState<string>('custom');
  const [ruleType, setRuleType] = useState<string>('property_check');
  const [conditions, setConditions] = useState('{}');
  const [resourceTypes, setResourceTypes] = useState<string[]>([]);
  const [recommendation, setRecommendation] = useState('');

  useEffect(() => {
    if (initialData && open) {
      setRuleCode(initialData.rule_code);
      setTitle(initialData.title);
      setDescription(initialData.description || '');
      setSeverity(initialData.severity);
      setCategory(initialData.category);
      setRuleType(initialData.rule_type);
      setConditions(JSON.stringify(initialData.conditions, null, 2));
      setResourceTypes(initialData.resource_types || []);
      setRecommendation(initialData.recommendation);
    } else if (!open) {
      setRuleCode('');
      setTitle('');
      setDescription('');
      setSeverity('medium');
      setCategory('custom');
      setRuleType('property_check');
      setConditions('{}');
      setResourceTypes([]);
      setRecommendation('');
    }
  }, [initialData, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!ruleCode.trim() || !title.trim() || !recommendation.trim()) {
      alert('Please fill in all required fields');
      return;
    }

    let parsedConditions;
    try {
      parsedConditions = JSON.parse(conditions);
    } catch (err) {
      alert('Invalid JSON in conditions field');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        rule_code: ruleCode.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        severity,
        category,
        rule_type: ruleType,
        conditions: parsedConditions,
        resource_types: resourceTypes.length > 0 ? resourceTypes : undefined,
        recommendation: recommendation.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleResourceType = (type: string) => {
    setResourceTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const setExampleConditions = () => {
    const examples: Record<string, any> = {
      property_check: { property: 'is_encrypted', operator: 'equals', value: true },
      tag_required: { tag_key: 'Environment' },
      tag_pattern: { tag_key: 'Environment', pattern: '^(prod|staging|dev)$' },
      metadata_check: { path: 'nested.field', operator: 'exists', value: null },
      custom_script: { script: 'return resource.is_encrypted === true;' },
    };
    setConditions(JSON.stringify(examples[ruleType] || {}, null, 2));
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit' : 'Create'} Compliance Rule</DialogTitle>
          <DialogDescription>
            Define a rule to check resources for compliance violations
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="rule-code">Rule Code *</Label>
              <Input
                id="rule-code"
                value={ruleCode}
                onChange={(e) => setRuleCode(e.target.value)}
                placeholder="e.g., CUSTOM-001, SOC2-CC6.1"
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="severity">Severity *</Label>
              <select
                id="severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as any)}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="title">Rule Title *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Data at Rest Encryption Required"
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this rule checks for"
              className="mt-1"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="category">Category *</Label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.replace('_', ' ')}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="rule-type">Rule Type *</Label>
              <select
                id="rule-type"
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
              >
                {RULE_TYPES.map((t) => (
                  <option key={t} value={t}>{t.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="conditions">Conditions (JSON) *</Label>
              <Button type="button" variant="outline" size="sm" onClick={setExampleConditions}>
                Load Example
              </Button>
            </div>
            <Textarea
              id="conditions"
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              placeholder='{"property": "is_encrypted", "operator": "equals", "value": true}'
              className="mt-1 font-mono text-sm"
              rows={4}
            />
            <p className="text-xs text-gray-500 mt-1">
              Define the conditions for this rule as a JSON object
            </p>
          </div>

          <div>
            <Label>Resource Types (leave empty for all types)</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {RESOURCE_TYPES.map((type) => (
                <Badge
                  key={type}
                  variant={resourceTypes.includes(type) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleResourceType(type)}
                >
                  {type}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="recommendation">Recommendation *</Label>
            <Textarea
              id="recommendation"
              value={recommendation}
              onChange={(e) => setRecommendation(e.target.value)}
              placeholder="Describe how to remediate this issue"
              className="mt-1"
              rows={3}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : isEditing ? 'Update Rule' : 'Create Rule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
