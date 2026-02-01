'use client';

import { useState, useEffect } from 'react';
import { optimizationService } from '@/lib/services/optimization.service';
import {
  OptimizationRecommendation,
  OptimizationSummary,
  OptimizationRisk,
  OptimizationEffort,
} from '@/types/optimization.types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DollarSign,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Sparkles,
  Shield,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

export default function CostOptimizationPage() {
  const [recommendations, setRecommendations] = useState<OptimizationRecommendation[]>([]);
  const [summary, setSummary] = useState<OptimizationSummary | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('pending');

  useEffect(() => {
    loadRecommendations();
  }, [filter]);

  const loadRecommendations = async () => {
    setIsLoading(true);
    try {
      const data = await optimizationService.getRecommendations(filter);
      setRecommendations(data.recommendations);
      setSummary(data.summary);
    } catch (error: any) {
      console.error('Failed to load recommendations:', error);
      toast.error('Failed to load recommendations');
    } finally {
      setIsLoading(false);
    }
  };

  const runScan = async () => {
    setIsScanning(true);
    toast.info('Scanning AWS resources...', {
      icon: <Loader2 className="h-4 w-4 animate-spin" />,
    });

    try {
      const data = await optimizationService.scan();
      setRecommendations(data.recommendations);
      setSummary(data.summary);
      toast.success(
        `Found ${data.recommendations.length} optimization opportunities! Potential savings: $${data.summary.totalMonthlySavings.toFixed(2)}/month`,
        {
          icon: <Sparkles className="h-4 w-4" />,
          duration: 5000,
        }
      );
    } catch (error: any) {
      console.error('Scan failed:', error);
      toast.error(error.message || 'Scan failed');
    } finally {
      setIsScanning(false);
    }
  };

  const updateStatus = async (id: string, status: 'approved' | 'applied' | 'dismissed') => {
    try {
      await optimizationService.updateStatus(id, status);
      toast.success(`Recommendation ${status}`);
      loadRecommendations();
    } catch (error: any) {
      console.error('Failed to update status:', error);
      toast.error('Failed to update status');
    }
  };

  const getRiskColor = (risk: OptimizationRisk) => {
    switch (risk) {
      case 'safe':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'caution':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'risky':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getEffortColor = (effort: OptimizationEffort) => {
    switch (effort) {
      case 'low':
        return 'text-green-600';
      case 'medium':
        return 'text-yellow-600';
      case 'high':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getRiskIcon = (risk: OptimizationRisk) => {
    switch (risk) {
      case 'safe':
        return <Shield className="w-4 h-4" />;
      case 'caution':
        return <AlertTriangle className="w-4 h-4" />;
      case 'risky':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <AlertTriangle className="w-4 h-4" />;
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="h-8 w-8 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900">Cost Optimization</h1>
        </div>
        <p className="text-gray-600">
          AI-powered recommendations to reduce AWS costs automatically
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Total Opportunities</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">
                    {summary.totalRecommendations}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.byStatus.pending} pending · {summary.byStatus.applied} applied
                  </p>
                </div>
                <div className="bg-blue-100 p-3 rounded-lg">
                  <AlertTriangle className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Monthly Savings</p>
                  <p className="text-3xl font-bold text-green-600 mt-1">
                    ${summary.totalMonthlySavings.toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {summary.byRisk.safe} safe · {summary.byRisk.caution} caution ·{' '}
                    {summary.byRisk.risky} risky
                  </p>
                </div>
                <div className="bg-green-100 p-3 rounded-lg">
                  <TrendingDown className="w-6 h-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Annual Savings</p>
                  <p className="text-3xl font-bold text-green-600 mt-1">
                    ${summary.totalAnnualSavings.toLocaleString()}
                  </p>
                  <p className="text-xs text-green-600 mt-1">
                    Potential ROI: {Math.round(summary.totalAnnualSavings / 1000)}x
                  </p>
                </div>
                <div className="bg-green-100 p-3 rounded-lg">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Actions Bar */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button
                onClick={() => setFilter('pending')}
                variant={filter === 'pending' ? 'default' : 'outline'}
                size="sm"
              >
                Pending
              </Button>
              <Button
                onClick={() => setFilter('approved')}
                variant={filter === 'approved' ? 'default' : 'outline'}
                size="sm"
              >
                Approved
              </Button>
              <Button
                onClick={() => setFilter('applied')}
                variant={filter === 'applied' ? 'default' : 'outline'}
                size="sm"
              >
                Applied
              </Button>
              <Button
                onClick={() => setFilter('')}
                variant={filter === '' ? 'default' : 'outline'}
                size="sm"
              >
                All
              </Button>
            </div>
            <Button onClick={runScan} disabled={isScanning} className="gap-2">
              {isScanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" />
                  Run New Scan
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : recommendations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Sparkles className="h-12 w-12 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600 mb-4">No recommendations found</p>
            <Button onClick={runScan} className="gap-2">
              <Zap className="h-4 w-4" />
              Run First Scan
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {recommendations.map((rec) => (
            <Card
              key={rec.id}
              className="hover:shadow-lg transition-shadow border-l-4"
              style={{
                borderLeftColor:
                  rec.risk === 'safe'
                    ? '#22c55e'
                    : rec.risk === 'caution'
                    ? '#eab308'
                    : '#ef4444',
              }}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    {/* Header */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className="mt-1">{getRiskIcon(rec.risk)}</div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold text-gray-900">{rec.title}</h3>
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium border ${getRiskColor(
                              rec.risk
                            )}`}
                          >
                            {rec.risk}
                          </span>
                          <span className="text-xs text-gray-500 ml-auto">
                            Priority: {rec.priority}/10
                          </span>
                        </div>
                        <p className="text-gray-600 text-sm">{rec.description}</p>
                      </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-gray-500">Monthly Savings</p>
                        <p className="text-lg font-bold text-green-600">
                          ${rec.monthlySavings.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Annual Savings</p>
                        <p className="text-lg font-bold text-green-600">
                          ${rec.annualSavings.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Effort</p>
                        <p className={`text-sm font-medium ${getEffortColor(rec.effort)}`}>
                          {rec.effort}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Confidence</p>
                        <p className="text-sm font-medium text-gray-900">{rec.confidence}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Region</p>
                        <p className="text-sm font-medium text-gray-900">{rec.region}</p>
                      </div>
                    </div>

                    {/* Reasoning */}
                    <div className="bg-blue-50 border border-blue-200 p-3 rounded mb-3">
                      <p className="text-xs font-semibold text-blue-900 mb-1">Why this matters:</p>
                      <p className="text-sm text-blue-800">{rec.reasoning}</p>
                    </div>

                    {/* Action */}
                    <div className="bg-purple-50 border border-purple-200 p-3 rounded mb-3">
                      <p className="text-xs font-semibold text-purple-900 mb-1">
                        Recommended Action:
                      </p>
                      <p className="text-sm text-purple-800">{rec.action}</p>
                    </div>

                    {/* CLI Command */}
                    {rec.actionCommand && (
                      <div className="bg-gray-900 text-gray-100 p-3 rounded font-mono text-xs overflow-x-auto">
                        {rec.actionCommand}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-2 min-w-[120px]">
                    {rec.status === 'pending' && (
                      <>
                        <Button
                          onClick={() => updateStatus(rec.id, 'approved')}
                          size="sm"
                          className="w-full bg-green-600 hover:bg-green-700 gap-2"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Approve
                        </Button>
                        <Button
                          onClick={() => updateStatus(rec.id, 'applied')}
                          size="sm"
                          variant="outline"
                          className="w-full gap-2"
                        >
                          <Clock className="w-4 h-4" />
                          Applied
                        </Button>
                        <Button
                          onClick={() => updateStatus(rec.id, 'dismissed')}
                          size="sm"
                          variant="ghost"
                          className="w-full gap-2"
                        >
                          <XCircle className="w-4 h-4" />
                          Dismiss
                        </Button>
                      </>
                    )}

                    {rec.status === 'approved' && (
                      <div>
                        <Button
                          onClick={() => updateStatus(rec.id, 'applied')}
                          size="sm"
                          className="w-full mb-2"
                        >
                          Mark Applied
                        </Button>
                        <span className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Approved
                        </span>
                      </div>
                    )}

                    {rec.status === 'applied' && (
                      <div className="text-green-600 flex flex-col items-center gap-2">
                        <CheckCircle2 className="w-6 h-6" />
                        <span className="font-medium text-sm">Applied</span>
                        <span className="text-xs text-gray-500">
                          {new Date(rec.appliedAt!).toLocaleDateString()}
                        </span>
                      </div>
                    )}

                    {rec.status === 'dismissed' && (
                      <div className="text-gray-500 flex flex-col items-center gap-2">
                        <XCircle className="w-6 h-6" />
                        <span className="font-medium text-sm">Dismissed</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
