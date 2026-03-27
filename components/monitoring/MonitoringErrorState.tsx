/**
 * MonitoringErrorState Component
 * Enhanced error handling with specific error types and actions
 */

'use client';

import { AlertCircle, RefreshCw, Settings, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export type MonitoringErrorType = 'connection' | 'timeout' | 'credentials' | 'unknown';

interface MonitoringErrorStateProps {
  type: MonitoringErrorType;
  message: string;
  action?: string;
  onRetry: () => void;
  onSettings: () => void;
  onDiagnose?: () => void;
  isDiagnosing?: boolean;
  diagnosticResult?: {
    reachable: boolean;
    responseTimeMs: number | null;
    authStatus: string;
    prometheusVersion: string | null;
    issue: string;
    suggestedFix: string;
    checkedAt: string;
  } | null;
  lastSnapshot?: {
    uptime: number | null;
    responseTimeMs: number | null;
    monthlyCost: number | null;
    systemStatus: string;
    capturedAt: string;
  } | null;
}

export function MonitoringErrorState({
  type,
  message,
  action,
  onRetry,
  onSettings,
  onDiagnose,
  isDiagnosing,
  diagnosticResult,
  lastSnapshot,
}: MonitoringErrorStateProps) {
  const getErrorIcon = () => {
    switch (type) {
      case 'connection':
      case 'timeout':
        return '🔌';
      case 'credentials':
        return '🔐';
      default:
        return '⚠️';
    }
  };

  const getSuggestions = () => {
    switch (type) {
      case 'connection':
        return [
          'Check that your monitoring endpoint is publicly accessible',
          'Verify your network allows outbound connections on port 9090',
          'Confirm the endpoint URL is correct in your monitoring settings',
        ];
      case 'timeout':
        return [
          'Check your network connection',
          'Verify Prometheus server is responding',
          'Try again in a few moments',
        ];
      case 'credentials':
        return [
          'Check authentication settings',
          'Verify API credentials are valid',
          'Review Prometheus security configuration',
        ];
      default:
        return [
          'Try refreshing the page',
          'Check browser console for errors',
          'Contact support if the issue persists',
        ];
    }
  };

  return (
    <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20">
      <CardContent className="p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          {/* Icon */}
          <div className="flex-shrink-0">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center text-3xl">
              {getErrorIcon()}
            </div>
          </div>

          {/* Content */}
          <div className="space-y-4 flex-1 w-full">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                <h3 className="font-semibold text-lg text-red-900 dark:text-red-100">
                  We can't access your monitoring data right now
                </h3>
              </div>
              <p className="text-sm text-red-700 dark:text-red-300">
                This usually happens when your monitoring endpoint isn't reachable. Your infrastructure is still running normally.
              </p>
            </div>

            {/* Context panel */}
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-red-200 dark:border-red-800 p-4">
              <h4 className="font-medium text-sm mb-3 text-gray-900 dark:text-gray-100">Connection Status</h4>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Last successful sync</span>
                  <span className="font-medium text-gray-900">2 minutes ago</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Issue detected</span>
                  <span className="font-medium text-red-600">Connection timeout</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Configured endpoint</span>
                  <span className="font-medium text-gray-500 font-mono text-xs">your monitoring endpoint</span>
                </div>
              </div>
            </div>

            {/* Suggestions */}
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-red-200 dark:border-red-800 p-4">
              <h4 className="font-medium text-sm mb-2 text-gray-900 dark:text-gray-100">
                Try this first:
              </h4>
              <ul className="space-y-1.5">
                {getSuggestions().map((suggestion, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-red-600 dark:text-red-400 mt-0.5">•</span>
                    <span>{suggestion}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                size="sm"
                onClick={onRetry}
                style={{ backgroundColor: '#7C3AED', color: '#fff', border: 'none' }}
                aria-label="Retry connection"
              >
                <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                Retry Connection
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onSettings}
                className="border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/30"
                aria-label="Go to monitoring settings"
              >
                <Settings className="w-4 h-4 mr-2" aria-hidden="true" />
                Go to Settings
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/30"
                asChild
              >
                <a
                  href="https://prometheus.io/docs/prometheus/latest/getting_started/"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open Prometheus documentation in new tab"
                >
                  <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                  Documentation
                </a>
              </Button>
              {onDiagnose && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onDiagnose}
                  disabled={isDiagnosing}
                  style={{ borderColor: '#7C3AED', color: '#7C3AED' }}
                  aria-label="Run connection diagnostic"
                >
                  {isDiagnosing ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                      Diagnosing...
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-4 h-4 mr-2" aria-hidden="true" />
                      Run Diagnostic
                    </>
                  )}
                </Button>
              )}
            </div>
            {diagnosticResult && (
              <div style={{
                background: '#fff',
                borderRadius: '8px',
                border: `1px solid ${diagnosticResult.reachable ? '#BBF7D0' : '#FECACA'}`,
                padding: '16px',
                marginTop: '12px',
              }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#475569',
                  textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>
                  Diagnostic Results
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                    <span style={{ color: '#64748B' }}>Endpoint reachable</span>
                    <span style={{ fontWeight: 600, color: diagnosticResult.reachable ? '#059669' : '#DC2626' }}>
                      {diagnosticResult.reachable ? '✓ Yes' : '✗ No'}
                    </span>
                  </div>
                  {diagnosticResult.responseTimeMs !== null && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: '#64748B' }}>Response time</span>
                      <span style={{ fontWeight: 600, color: '#0F172A' }}>{diagnosticResult.responseTimeMs}ms</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                    <span style={{ color: '#64748B' }}>Auth status</span>
                    <span style={{ fontWeight: 600, color: '#0F172A', textTransform: 'capitalize' }}>
                      {diagnosticResult.authStatus}
                    </span>
                  </div>
                  {diagnosticResult.prometheusVersion && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                      <span style={{ color: '#64748B' }}>Version</span>
                      <span style={{ fontWeight: 600, color: '#0F172A' }}>{diagnosticResult.prometheusVersion}</span>
                    </div>
                  )}
                  <div style={{
                    marginTop: '8px',
                    padding: '10px',
                    background: '#F8FAFC',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    color: '#475569',
                    lineHeight: 1.6,
                  }}>
                    → {diagnosticResult.suggestedFix}
                  </div>
                </div>
              </div>
            )}
            {lastSnapshot && (
              <div style={{
                background: '#FFFBEB',
                borderRadius: '8px',
                border: '1px solid #FDE68A',
                padding: '16px',
                marginTop: '12px',
              }}>
                <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#92400E',
                  textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>
                  Last Known Data · {new Date(lastSnapshot.capturedAt).toLocaleTimeString('en-US', {
                    hour: '2-digit', minute: '2-digit'
                  })}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                  {lastSnapshot.uptime !== null && (
                    <div>
                      <p style={{ fontSize: '0.72rem', color: '#92400E', margin: '0 0 2px' }}>UPTIME</p>
                      <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                        {lastSnapshot.uptime}%
                      </p>
                    </div>
                  )}
                  {lastSnapshot.responseTimeMs !== null && (
                    <div>
                      <p style={{ fontSize: '0.72rem', color: '#92400E', margin: '0 0 2px' }}>RESPONSE</p>
                      <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                        {lastSnapshot.responseTimeMs}ms
                      </p>
                    </div>
                  )}
                  {lastSnapshot.monthlyCost !== null && (
                    <div>
                      <p style={{ fontSize: '0.72rem', color: '#92400E', margin: '0 0 2px' }}>MONTHLY COST</p>
                      <p style={{ fontSize: '1rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
                        ${lastSnapshot.monthlyCost}
                      </p>
                    </div>
                  )}
                  <div>
                    <p style={{ fontSize: '0.72rem', color: '#92400E', margin: '0 0 2px' }}>STATUS</p>
                    <p style={{ fontSize: '1rem', fontWeight: 700,
                      color: lastSnapshot.systemStatus === 'operational' ? '#059669' : '#D97706', margin: 0,
                      textTransform: 'capitalize' }}>
                      {lastSnapshot.systemStatus}
                    </p>
                  </div>
                </div>
                <p style={{ fontSize: '0.72rem', color: '#92400E', margin: '10px 0 0', fontStyle: 'italic' }}>
                  Showing cached data from last successful connection. Live data unavailable.
                </p>
              </div>
            )}
            <p className="text-xs text-gray-500 pt-2">
              ✓ Your infrastructure is still running normally. Only monitoring data is temporarily unavailable.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Inline error banner for non-critical errors
 */
interface MonitoringErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}

export function MonitoringErrorBanner({ message, onDismiss }: MonitoringErrorBannerProps) {
  return (
    <Alert variant="destructive" className="mb-6" role="alert" aria-live="polite">
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription className="flex items-center justify-between">
        <span>{message}</span>
        {onDismiss && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            aria-label="Dismiss error message"
          >
            Dismiss
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
