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
}

export function MonitoringErrorState({
  type,
  message,
  action,
  onRetry,
  onSettings,
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
          'Verify Prometheus is running and accessible',
          'Check firewall and network settings',
          'Ensure the Prometheus URL is correct',
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
                  {message}
                </h3>
              </div>
              {action && (
                <p className="text-sm text-red-700 dark:text-red-300">
                  {action}
                </p>
              )}
            </div>

            {/* Suggestions */}
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-red-200 dark:border-red-800 p-4">
              <h4 className="font-medium text-sm mb-2 text-gray-900 dark:text-gray-100">
                Troubleshooting Steps:
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
                className="bg-red-600 hover:bg-red-700 text-white"
                aria-label="Retry connection to Prometheus"
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
            </div>
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
