'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle, AlertCircle, SkipForward } from 'lucide-react';
import { useScanResults } from '@/lib/hooks/useComplianceFrameworks';

interface ScanResultsModalProps {
  open: boolean;
  onClose: () => void;
  scanId: string | null;
}

export function ScanResultsModal({ open, onClose, scanId }: ScanResultsModalProps) {
  const { scan, findings, loading } = useScanResults(scanId);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pass':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-600" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-orange-600" />;
      case 'skip':
        return <SkipForward className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { label: string; className: string }> = {
      pass: { label: 'Pass', className: 'bg-green-100 text-green-700 border-green-200' },
      fail: { label: 'Fail', className: 'bg-red-100 text-red-700 border-red-200' },
      error: { label: 'Error', className: 'bg-orange-100 text-orange-700 border-orange-200' },
      skip: { label: 'Skip', className: 'bg-gray-100 text-gray-700 border-gray-200' },
    };
    const { label, className } = config[status] || config.skip;
    return (
      <Badge variant="outline" className={className}>
        {label}
      </Badge>
    );
  };

  const failedFindings = findings.filter((f) => f.status === 'fail');
  const passedFindings = findings.filter((f) => f.status === 'pass');

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Scan Results</DialogTitle>
          <DialogDescription>
            Detailed compliance scan findings
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          </div>
        )}

        {!loading && scan && (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{scan.compliance_score?.toFixed(1)}%</p>
                  <p className="text-sm text-gray-600">Score</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-green-600">{passedFindings.length}</p>
                  <p className="text-sm text-gray-600">Passed</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{failedFindings.length}</p>
                  <p className="text-sm text-gray-600">Failed</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-red-600">{scan.critical_issues}</p>
                  <p className="text-sm text-gray-600">Critical</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <p className="text-2xl font-bold text-orange-600">{scan.high_issues}</p>
                  <p className="text-sm text-gray-600">High</p>
                </CardContent>
              </Card>
            </div>

            {/* Failed Findings */}
            {failedFindings.length > 0 && (
              <div>
                <h3 className="font-semibold text-red-800 mb-3">Failed Checks ({failedFindings.length})</h3>
                <div className="space-y-3">
                  {failedFindings.map((finding) => (
                    <Card key={finding.id} className="border-red-200">
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-3">
                          {getStatusIcon(finding.status)}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-semibold">{finding.resource_name || finding.resource_id}</h4>
                              {getStatusBadge(finding.status)}
                              <Badge variant="outline">{finding.severity}</Badge>
                            </div>
                            <p className="text-sm text-gray-600 mb-1">{finding.resource_type} • {finding.category}</p>
                            {finding.issue && (
                              <p className="text-sm text-red-700 mb-2">{finding.issue}</p>
                            )}
                            {finding.recommendation && (
                              <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                                <span className="font-medium">Recommendation:</span> {finding.recommendation}
                              </p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Passed Findings (collapsed) */}
            {passedFindings.length > 0 && (
              <details>
                <summary className="font-semibold text-green-800 cursor-pointer mb-3">
                  Passed Checks ({passedFindings.length})
                </summary>
                <div className="space-y-2">
                  {passedFindings.slice(0, 20).map((finding) => (
                    <div key={finding.id} className="flex items-center gap-2 text-sm text-gray-600 bg-green-50 p-2 rounded">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span>{finding.resource_name || finding.resource_id}</span>
                      <span className="text-gray-400">•</span>
                      <span>{finding.resource_type}</span>
                    </div>
                  ))}
                  {passedFindings.length > 20 && (
                    <p className="text-sm text-gray-500 text-center">
                      ... and {passedFindings.length - 20} more
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
