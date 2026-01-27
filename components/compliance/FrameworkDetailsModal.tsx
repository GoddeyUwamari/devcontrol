'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Edit, Trash2, AlertTriangle } from 'lucide-react';
import { ComplianceFramework } from '@/lib/services/compliance-frameworks.service';
import { useFrameworkDetails } from '@/lib/hooks/useComplianceFrameworks';
import { useState } from 'react';
import { CreateRuleModal } from './CreateRuleModal';
import { useToast } from '@/components/ui/use-toast';

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
      medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
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
      iam: 'bg-yellow-100 text-yellow-700',
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
              <Button onClick={() => setCreateRuleOpen(true)} size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Add Rule
              </Button>
            </div>

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
                <Button onClick={() => setCreateRuleOpen(true)}>
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
                          <p className="text-sm text-gray-600 mb-2">{rule.rule_code}</p>
                          {rule.description && (
                            <p className="text-sm text-gray-700 mb-2">{rule.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingRule(rule)}>
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteRule(rule.id)}
                            className="text-red-600"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      <div className="text-sm space-y-1">
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
                          <span className="text-gray-600 font-mono text-xs">
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
