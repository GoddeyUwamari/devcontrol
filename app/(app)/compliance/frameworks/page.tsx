'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Shield, FileText, Play, Edit, Trash2, Settings } from 'lucide-react';
import { useComplianceFrameworks, useComplianceScans } from '@/lib/hooks/useComplianceFrameworks';
import { CreateFrameworkModal } from '@/components/compliance/CreateFrameworkModal';
import { FrameworkDetailsModal } from '@/components/compliance/FrameworkDetailsModal';
import { ScanResultsModal } from '@/components/compliance/ScanResultsModal';
import { ComplianceFramework } from '@/lib/services/compliance-frameworks.service';
import { useToast } from '@/components/ui/use-toast';
import { Switch } from '@/components/ui/switch';

export default function ComplianceFrameworksPage() {
  const { frameworks, loading, error, fetchFrameworks, createFramework, updateFramework, deleteFramework, executeScan } = useComplianceFrameworks();
  const { scans, fetchScans } = useComplianceScans(true); // Auto-refresh
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingFramework, setEditingFramework] = useState<ComplianceFramework | null>(null);
  const [detailsFramework, setDetailsFramework] = useState<ComplianceFramework | null>(null);
  const [scanResults, setScanResults] = useState<string | null>(null); // Scan ID
  const { toast } = useToast();

  const handleCreate = async (data: any) => {
    try {
      await createFramework(data);
      setCreateModalOpen(false);
      toast({
        title: 'Framework created',
        description: 'Your compliance framework has been created successfully.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to create framework',
        variant: 'destructive',
      });
    }
  };

  const handleUpdate = async (id: string, data: any) => {
    try {
      await updateFramework(id, data);
      setEditingFramework(null);
      toast({
        title: 'Framework updated',
        description: 'Your compliance framework has been updated successfully.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to update framework',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this framework? All associated rules and scan history will be deleted.')) {
      return;
    }

    try {
      await deleteFramework(id);
      toast({
        title: 'Framework deleted',
        description: 'The framework has been deleted.',
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to delete framework',
        variant: 'destructive',
      });
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    try {
      await updateFramework(id, { enabled });
      toast({
        title: enabled ? 'Framework enabled' : 'Framework disabled',
        description: `The framework has been ${enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to toggle framework',
        variant: 'destructive',
      });
    }
  };

  const handleExecuteScan = async (frameworkId: string) => {
    try {
      await executeScan(frameworkId);
      toast({
        title: 'Scan initiated',
        description: 'Compliance scan has been started. Check scan history for results.',
      });
      // Refresh scans after a delay
      setTimeout(() => fetchScans(), 2000);
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to execute scan',
        variant: 'destructive',
      });
    }
  };

  const activeFrameworks = frameworks.filter((f) => f.enabled).length;
  const customFrameworks = frameworks.filter((f) => f.framework_type === 'custom').length;
  const recentScans = scans.slice(0, 5);
  const completedScans = scans.filter((s) => s.status === 'completed').length;

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading compliance frameworks...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Hero Section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Compliance Frameworks</h1>
            <p className="text-gray-600 max-w-2xl">
              Create custom compliance frameworks with flexible rules to scan and monitor your AWS infrastructure for compliance violations.
            </p>
          </div>
          <Button onClick={() => setCreateModalOpen(true)} size="lg">
            <Plus className="mr-2 h-5 w-5" />
            New Framework
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Frameworks</p>
                  <p className="text-3xl font-bold text-gray-900">{frameworks.length}</p>
                </div>
                <Shield className="h-10 w-10 text-blue-600 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Active Frameworks</p>
                  <p className="text-3xl font-bold text-green-600">{activeFrameworks}</p>
                </div>
                <FileText className="h-10 w-10 text-green-600 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Custom Frameworks</p>
                  <p className="text-3xl font-bold text-purple-600">{customFrameworks}</p>
                </div>
                <Settings className="h-10 w-10 text-purple-600 opacity-20" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Scans Completed</p>
                  <p className="text-3xl font-bold text-gray-900">{completedScans}</p>
                </div>
                <Play className="h-10 w-10 text-gray-400 opacity-20" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-800">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {frameworks.length === 0 && !loading && (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Shield className="h-16 w-16 text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No compliance frameworks yet</h3>
            <p className="text-gray-600 mb-6 text-center max-w-md">
              Get started by creating your first compliance framework. Define custom rules to monitor your infrastructure.
            </p>
            <Button onClick={() => setCreateModalOpen(true)} size="lg">
              <Plus className="mr-2 h-5 w-5" />
              Create Your First Framework
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Frameworks Grid */}
      {frameworks.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {frameworks.map((framework) => (
            <Card key={framework.id} className={`relative ${!framework.enabled ? 'opacity-60' : ''}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{framework.name}</CardTitle>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant={framework.framework_type === 'built_in' ? 'default' : 'secondary'}>
                        {framework.framework_type === 'built_in' ? 'Built-in' : 'Custom'}
                      </Badge>
                      {framework.is_default && (
                        <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                          Default
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Switch checked={framework.enabled} onCheckedChange={(enabled) => handleToggle(framework.id, enabled)} />
                </div>
              </CardHeader>

              <CardContent>
                {framework.description && (
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{framework.description}</p>
                )}

                {framework.standard_name && (
                  <div className="mb-4">
                    <Badge variant="outline">
                      {framework.standard_name}
                      {framework.version && ` ${framework.version}`}
                    </Badge>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDetailsFramework(framework)} className="flex-1">
                    <FileText className="mr-1 h-3 w-3" />
                    View Rules
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleExecuteScan(framework.id)}>
                    <Play className="h-3 w-3" />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setEditingFramework(framework)}>
                    <Edit className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(framework.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Recent Scans */}
      {recentScans.length > 0 && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Recent Scans</h2>
          <div className="space-y-3">
            {recentScans.map((scan) => {
              const framework = frameworks.find((f) => f.id === scan.framework_id);
              return (
                <Card key={scan.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setScanResults(scan.id)}>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold">{framework?.name || 'Unknown Framework'}</h3>
                        <p className="text-sm text-gray-600">
                          {new Date(scan.created_at).toLocaleString()} • {scan.status}
                        </p>
                      </div>
                      <div className="text-right">
                        {scan.compliance_score !== null && (
                          <p className="text-2xl font-bold text-blue-600">{scan.compliance_score.toFixed(1)}%</p>
                        )}
                        <p className="text-sm text-gray-600">
                          {scan.compliant_resources}/{scan.total_resources} compliant
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      <CreateFrameworkModal
        open={createModalOpen || editingFramework !== null}
        onClose={() => {
          setCreateModalOpen(false);
          setEditingFramework(null);
        }}
        onSubmit={editingFramework ? (data) => handleUpdate(editingFramework.id, data) : handleCreate}
        initialData={editingFramework || undefined}
        isEditing={editingFramework !== null}
      />

      <FrameworkDetailsModal
        open={detailsFramework !== null}
        onClose={() => setDetailsFramework(null)}
        framework={detailsFramework}
      />

      <ScanResultsModal
        open={scanResults !== null}
        onClose={() => setScanResults(null)}
        scanId={scanResults}
      />
    </div>
  );
}
