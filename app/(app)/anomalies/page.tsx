'use client';

import { useState, useEffect, useCallback } from 'react';
import { anomalyService } from '@/lib/services/anomaly.service';
import { AnomalyDetection, AnomalyStats } from '@/types/anomaly.types';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Zap,
  CheckCircle2,
  Clock,
  XCircle,
  Activity,
  RefreshCw,
  Brain,
  Cpu,
  DollarSign,
  Server,
  AlertCircle,
} from 'lucide-react';

export default function AnomaliesPage() {
  const [anomalies, setAnomalies] = useState<AnomalyDetection[]>([]);
  const [stats, setStats] = useState<AnomalyStats | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [lastScanResult, setLastScanResult] = useState<string | null>(null);

  const loadAnomalies = useCallback(async () => {
    try {
      const data = await anomalyService.getAnomalies(filter);
      setAnomalies(data.anomalies);
      setStats(data.stats);
    } catch (error) {
      console.error('Failed to load anomalies:', error);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadAnomalies();

    // Auto-refresh every 30 seconds
    const interval = setInterval(loadAnomalies, 30000);
    return () => clearInterval(interval);
  }, [loadAnomalies]);

  const triggerScan = async () => {
    setIsScanning(true);
    setLastScanResult(null);
    try {
      const result = await anomalyService.triggerScan();
      setLastScanResult(result.message);
      await loadAnomalies();
    } catch (error) {
      console.error('Scan failed:', error);
      setLastScanResult('Scan failed. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  const acknowledgeAnomaly = async (id: string) => {
    try {
      await anomalyService.acknowledge(id);
      await loadAnomalies();
    } catch (error) {
      console.error('Failed to acknowledge:', error);
    }
  };

  const resolveAnomaly = async (id: string) => {
    try {
      await anomalyService.resolve(id);
      await loadAnomalies();
    } catch (error) {
      console.error('Failed to resolve:', error);
    }
  };

  const markFalsePositive = async (id: string) => {
    try {
      await anomalyService.markFalsePositive(id);
      await loadAnomalies();
    } catch (error) {
      console.error('Failed to mark as false positive:', error);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'warning':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'info':
        return 'text-blue-600 bg-blue-50 border-blue-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-600" />;
      case 'info':
        return <Activity className="w-5 h-5 text-blue-600" />;
      default:
        return null;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'cost_spike':
      case 'cost_drop':
        return <DollarSign className="w-4 h-4" />;
      case 'cpu_spike':
      case 'memory_spike':
        return <Cpu className="w-4 h-4" />;
      case 'invocation_spike':
      case 'traffic_drop':
        return <Activity className="w-4 h-4" />;
      case 'error_rate_spike':
        return <AlertTriangle className="w-4 h-4" />;
      default:
        return <Server className="w-4 h-4" />;
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="flex items-center gap-3 text-gray-500">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Loading anomaly data...
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Brain className="w-8 h-8 text-purple-600" />
          <h1 className="text-3xl font-bold text-gray-900">Anomaly Detection</h1>
        </div>
        <p className="text-gray-600">
          AI-powered detection of unusual patterns in your AWS infrastructure
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Anomalies</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {stats.total}
                </p>
                <p className="text-xs text-gray-500 mt-1">Last 7 days</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Activity className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active</p>
                <p className="text-3xl font-bold text-orange-600 mt-1">
                  {stats.active}
                </p>
                <p className="text-xs text-gray-500 mt-1">Needs attention</p>
              </div>
              <div className="bg-orange-100 p-3 rounded-lg">
                <Zap className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Critical</p>
                <p className="text-3xl font-bold text-red-600 mt-1">
                  {stats.bySeverity.critical || 0}
                </p>
                <p className="text-xs text-gray-500 mt-1">High priority</p>
              </div>
              <div className="bg-red-100 p-3 rounded-lg">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">MTTR</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {stats.mttr > 0 ? `${stats.mttr.toFixed(1)}h` : 'N/A'}
                </p>
                <p className="text-xs text-gray-500 mt-1">Mean time to resolve</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <Clock className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 mb-6 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('active')}
              className={`px-4 py-2 rounded font-medium transition-colors ${
                filter === 'active'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Active ({stats?.active || 0})
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 rounded font-medium transition-colors ${
                filter === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              All ({stats?.total || 0})
            </button>
          </div>
          <div className="flex items-center gap-4">
            {lastScanResult && (
              <span className="text-sm text-gray-600">{lastScanResult}</span>
            )}
            <button
              onClick={triggerScan}
              disabled={isScanning}
              className="bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-6 py-2 rounded font-medium flex items-center gap-2 transition-colors"
            >
              {isScanning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4" />
                  Scan Now
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Anomalies List */}
      <div className="space-y-4">
        {anomalies.length === 0 && (
          <div className="bg-white p-12 rounded-lg border border-gray-200 text-center shadow-sm">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-4" />
            <p className="text-gray-900 text-lg font-medium">
              No anomalies detected
            </p>
            <p className="text-gray-500 text-sm mt-2">
              Your infrastructure is running normally
            </p>
            <button
              onClick={triggerScan}
              disabled={isScanning}
              className="mt-4 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-300 text-white px-6 py-2 rounded font-medium inline-flex items-center gap-2"
            >
              <Brain className="w-4 h-4" />
              Run Detection Scan
            </button>
          </div>
        )}

        {anomalies.map((anomaly) => (
          <div
            key={anomaly.id}
            className={`bg-white rounded-lg border-l-4 ${
              anomaly.severity === 'critical'
                ? 'border-l-red-500'
                : anomaly.severity === 'warning'
                ? 'border-l-yellow-500'
                : 'border-l-blue-500'
            } p-6 shadow-sm border border-gray-200`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  {getSeverityIcon(anomaly.severity)}
                  <h3 className="text-lg font-semibold text-gray-900 truncate">
                    {anomaly.title}
                  </h3>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium border ${getSeverityColor(
                      anomaly.severity
                    )}`}
                  >
                    {anomaly.severity}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                    {getTypeIcon(anomaly.type)}
                    {anomaly.type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-xs text-gray-500">
                    {formatDate(anomaly.detectedAt)}
                  </span>
                </div>

                {/* Description */}
                <p className="text-gray-700 mb-4">{anomaly.description}</p>

                {/* Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-500">Current Value</p>
                    <p className="text-lg font-bold text-gray-900">
                      {anomaly.metric === 'total_cost'
                        ? `$${anomaly.currentValue.toFixed(2)}`
                        : anomaly.currentValue.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-500">Expected</p>
                    <p className="text-lg font-medium text-gray-600">
                      {anomaly.metric === 'total_cost'
                        ? `$${anomaly.expectedValue.toFixed(2)}`
                        : anomaly.expectedValue.toLocaleString()}
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-500">Deviation</p>
                    <p
                      className={`text-lg font-bold flex items-center gap-1 ${
                        Math.abs(anomaly.deviation) > 50
                          ? 'text-red-600'
                          : 'text-yellow-600'
                      }`}
                    >
                      {anomaly.deviation > 0 ? (
                        <TrendingUp className="w-4 h-4" />
                      ) : (
                        <TrendingDown className="w-4 h-4" />
                      )}
                      {anomaly.deviation > 0 ? '+' : ''}
                      {anomaly.deviation.toFixed(1)}%
                    </p>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-xs text-gray-500">Confidence</p>
                    <p className="text-lg font-medium text-gray-900">
                      {anomaly.confidence}%
                    </p>
                  </div>
                </div>

                {/* AI Explanation */}
                {anomaly.aiExplanation && (
                  <div className="bg-purple-50 border border-purple-200 p-4 rounded mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-4 h-4 text-purple-600" />
                      <p className="text-sm font-medium text-purple-800">
                        AI Analysis
                      </p>
                    </div>
                    <p className="text-sm text-purple-900">
                      {anomaly.aiExplanation}
                    </p>
                  </div>
                )}

                {/* Impact */}
                {anomaly.impact && (
                  <div className="bg-yellow-50 border border-yellow-200 p-4 rounded mb-3">
                    <p className="text-sm font-medium text-yellow-800 mb-1">
                      Impact
                    </p>
                    <p className="text-sm text-yellow-900">{anomaly.impact}</p>
                  </div>
                )}

                {/* Recommendation */}
                {anomaly.recommendation && (
                  <div className="bg-green-50 border border-green-200 p-4 rounded mb-3">
                    <p className="text-sm font-medium text-green-800 mb-1">
                      Recommended Action
                    </p>
                    <p className="text-sm text-green-900 whitespace-pre-line">
                      {anomaly.recommendation}
                    </p>
                  </div>
                )}

                {/* Resource Info */}
                {anomaly.resourceName && (
                  <div className="flex items-center gap-4 text-sm text-gray-600 mt-3 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Server className="w-4 h-4" />
                      {anomaly.resourceName}
                    </span>
                    {anomaly.region && (
                      <span className="bg-gray-100 px-2 py-1 rounded text-xs">
                        {anomaly.region}
                      </span>
                    )}
                    <span className="bg-gray-100 px-2 py-1 rounded text-xs">
                      Window: {anomaly.timeWindow}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 shrink-0">
                {anomaly.status === 'active' && (
                  <>
                    <button
                      onClick={() => acknowledgeAnomaly(anomaly.id)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Acknowledge
                    </button>
                    <button
                      onClick={() => resolveAnomaly(anomaly.id)}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      Resolve
                    </button>
                    <button
                      onClick={() => markFalsePositive(anomaly.id)}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors"
                    >
                      <XCircle className="w-4 h-4" />
                      False Positive
                    </button>
                  </>
                )}

                {anomaly.status === 'acknowledged' && (
                  <>
                    <span className="text-blue-600 flex items-center gap-2 px-4 py-2">
                      <Clock className="w-5 h-5" />
                      Acknowledged
                    </span>
                    <button
                      onClick={() => resolveAnomaly(anomaly.id)}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm flex items-center gap-2 transition-colors"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Resolve
                    </button>
                  </>
                )}

                {anomaly.status === 'resolved' && (
                  <span className="text-green-600 flex items-center gap-2 px-4 py-2">
                    <CheckCircle2 className="w-5 h-5" />
                    Resolved
                  </span>
                )}

                {anomaly.status === 'false_positive' && (
                  <span className="text-gray-500 flex items-center gap-2 px-4 py-2">
                    <XCircle className="w-5 h-5" />
                    False Positive
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
