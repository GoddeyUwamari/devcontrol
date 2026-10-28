'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { ComplianceFramework } from '@/lib/services/compliance-frameworks.service';
import { useFrameworkDetails } from '@/lib/hooks/useComplianceFrameworks';
import { useCurrentRole } from '@/lib/hooks/use-current-role';
import { useState } from 'react';
import { CreateRuleModal } from './CreateRuleModal';
import { useToast } from '@/components/ui/use-toast';

/** The server's floor on adding, editing and deleting rules (requireMember); the UI only mirrors it. */
const CAN_CHANGE_RULES = ['owner', 'admin', 'member'];

export const RULE_VIEWER_REASONS = {
  add: "Viewers can't add rules.",
  edit: "Viewers can't edit rules.",
  delete: "Viewers can't delete rules.",
} as const;

interface FrameworkDetailsModalProps {
  open: boolean;
  onClose: () => void;
  framework: ComplianceFramework | null;
}

export function FrameworkDetailsModal({ open, onClose, framework }: FrameworkDetailsModalProps) {
  const { rules, loading, createRule, updateRule, deleteRule } = useFrameworkDetails(framework?.id || null);
  const [createRuleOpen, setCreateRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any>(null);
  const { toast } = useToast();
  // A role not read yet fails closed (disabled, no reason); a viewer sees why (founder answer Q2).
  const role = useCurrentRole();
  const canChange = role !== null && CAN_CHANGE_RULES.includes(role);
  const isViewer = role !== null && !canChange;

  const handleCreateRule = async (data: any) => {
    try {
      await createRule(data);
      setCreateRuleOpen(false);
      toast({
        title: 'Rule created',
        description: 'The compliance rule has been created successfully.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to create rule',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateRule = async (ruleId: string, data: any) => {
    try {
      await updateRule(ruleId, data);
      setEditingRule(null);
      toast({
        title: 'Rule updated',
        description: 'The compliance rule has been updated successfully.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to update rule',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this rule?')) {
      return;
    }

    try {
      await deleteRule(ruleId);
      toast({
        title: 'Rule deleted',
        description: 'The rule has been deleted.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to delete rule',
        variant: 'destructive',
      });
    }
  };

  const getSeverityColor = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-100 text-red-700 border-red-200',
      high: 'bg-orange-100 text-orange-700 border-orange-200',
      medium: 'bg-amber-100 text-ink-warning-strong border-amber-200',
      low: 'bg-blue-100 text-blue-700 border-blue-200',
    };
    return colors[severity] || 'bg-gray-100 text-gray-700 border-gray-200';
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      encryption: 'bg-purple-100 text-purple-700',
      backups: 'bg-green-100 text-green-700',
      public_access: 'bg-red-100 text-red-700',
      tagging: 'bg-blue-100 text-blue-700',
      iam: 'bg-white text-ink-muted',
      networking: 'bg-indigo-100 text-indigo-700',
      custom: 'bg-gray-100 text-gray-700',
    };
    return colors[category] || 'bg-gray-100 text-gray-700';
  };

  if (!framework) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{framework.name}</DialogTitle>
            <DialogDescription>
              {framework.description || 'View and manage compliance rules for this framework'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Add Rule Button */}
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                Rules ({rules.length})
              </h3>
              <div className="flex flex-col items-end gap-1">
                <Button onClick={() => setCreateRuleOpen(true)} size="sm" disabled={!canChange} aria-describedby={isViewer ? 'rule-add-reason' : undefined}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Rule
                </Button>
                {isViewer && <p id="rule-add-reason" className="text-meta text-ink-muted">{RULE_VIEWER_REASONS.add}</p>}
              </div>
            </div>

            {isViewer && rules.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <p id="rule-edit-reason" className="text-meta text-ink-muted">{RULE_VIEWER_REASONS.edit}</p>
                <p id="rule-delete-reason" className="text-meta text-ink-muted">{RULE_VIEWER_REASONS.delete}</p>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
              </div>
            )}

            {/* Empty State */}
            {!loading && rules.length === 0 && (
              <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed">
                <AlertTriangle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 mb-4">No rules defined yet</p>
                <Button onClick={() => setCreateRuleOpen(true)} disabled={!canChange} aria-describedby={isViewer ? 'rule-add-reason' : undefined}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Your First Rule
                </Button>
              </div>
            )}

            {/* Rules List */}
            {!loading && rules.length > 0 && (
              <div className="space-y-3">
                {rules.map((rule) => (
                  <Card key={rule.id} className={!rule.enabled ? 'opacity-60' : ''}>
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold">{rule.title}</h4>
                            <Badge variant="outline" className={getSeverityColor(rule.severity)}>
                              {rule.severity}
                            </Badge>
                            <Badge variant="secondary" className={getCategoryColor(rule.category)}>
                              {rule.category}
                            </Badge>
                          </div>
                          <p className="text-ui text-gray-600 mb-2">{rule.rule_code}</p>
                          {rule.description && (
                            <p className="text-ui text-gray-700 mb-2">{rule.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingRule(rule)} disabled={!canChange} aria-label="Edit rule" aria-describedby={isViewer ? 'rule-edit-reason' : undefined}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteRule(rule.id)}
                            disabled={!canChange}
                            aria-label="Delete rule"
                            aria-describedby={isViewer ? 'rule-delete-reason' : undefined}
                            className="text-red-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="text-ui space-y-1">
                        <div className="flex items-start gap-2">
                          <span className="font-medium text-gray-700">Type:</span>
                          <span className="text-gray-600">{rule.rule_type.replace('_', ' ')}</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="font-medium text-gray-700">Applies to:</span>
                          <span className="text-gray-600">
                            {rule.resource_types.length > 0
                              ? rule.resource_types.join(', ')
                              : 'All resource types'}
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="font-medium text-gray-700">Conditions:</span>
                          <span className="text-gray-600 font-mono text-meta">
                            {JSON.stringify(rule.conditions)}
                          </span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="font-medium text-gray-700">Recommendation:</span>
                          <span className="text-gray-600">{rule.recommendation}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create/Edit Rule Modal */}
      <CreateRuleModal
        open={createRuleOpen || editingRule !== null}
        onClose={() => {
          setCreateRuleOpen(false);
          setEditingRule(null);
        }}
        onSubmit={editingRule ? (data) => handleUpdateRule(editingRule.id, data) : handleCreateRule}
        initialData={editingRule}
        isEditing={editingRule !== null}
      />
    </>
  );
}
