'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  XCircle,
  WifiOff,
  Clock,
  ShieldAlert,
  Ban,
  AlertOctagon,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppError, ErrorType, getErrorTitle, getRecoverySuggestion } from '@/lib/errors/error-types';
import { cn } from '@/lib/utils';

interface ErrorDisplayProps {
  error: AppError;
  onRetry?: () => void;
  onDismiss?: () => void;
  isRetrying?: boolean;
  className?: string;
  variant?: 'banner' | 'card' | 'inline';
}

export function ErrorDisplay({
  error,
  onRetry,
  onDismiss,
  isRetrying = false,
  className,
  variant = 'banner',
}: ErrorDisplayProps) {
  const [countdown, setCountdown] = useState<number | null>(
    error.retryAfter || null
  );

  // Countdown timer for rate limit errors
  useEffect(() => {
    if (error.type !== ErrorType.RATE_LIMIT_ERROR || !error.retryAfter) {
      return;
    }

    setCountdown(error.retryAfter);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [error.retryAfter, error.type]);

  const getErrorIcon = () => {
    switch (error.type) {
      case ErrorType.NETWORK_ERROR:
      case ErrorType.OFFLINE_ERROR:
        return WifiOff;
      case ErrorType.TIMEOUT_ERROR:
      case ErrorType.RATE_LIMIT_ERROR:
        return Clock;
      case ErrorType.AUTH_ERROR:
        return ShieldAlert;
      case ErrorType.PERMISSION_ERROR:
        return Ban;
      case ErrorType.SERVER_ERROR:
        return AlertOctagon;
      case ErrorType.NOT_FOUND_ERROR:
        return HelpCircle;
      default:
        return AlertTriangle;
    }
  };

  const getColorScheme = () => {
    switch (error.type) {
      case ErrorType.AUTH_ERROR:
      case ErrorType.PERMISSION_ERROR:
      case ErrorType.SERVER_ERROR:
        return {
          bg: 'bg-red-50 dark:bg-red-900/20',
          border: 'border-red-200 dark:border-red-800',
          text: 'text-red-800 dark:text-red-200',
          subtext: 'text-red-600 dark:text-red-300',
          icon: 'text-red-600 dark:text-red-400',
          button: 'bg-red-100 hover:bg-red-200 dark:bg-red-800/50 dark:hover:bg-red-800',
        };
      case ErrorType.RATE_LIMIT_ERROR:
        return {
          bg: 'bg-amber-50 dark:bg-amber-900/20',
          border: 'border-amber-200 dark:border-amber-800',
          text: 'text-ink-warning-strong dark:text-amber-200',
          subtext: 'text-ink-warning dark:text-amber-300',
          icon: 'text-ink-warning dark:text-amber-400',
          button: 'bg-amber-100 hover:bg-amber-200 dark:bg-amber-800/50 dark:hover:bg-amber-800',
        };
      case ErrorType.NETWORK_ERROR:
      case ErrorType.TIMEOUT_ERROR:
      case ErrorType.OFFLINE_ERROR:
        return {
          bg: 'bg-orange-50 dark:bg-orange-900/20',
          border: 'border-orange-200 dark:border-orange-800',
          text: 'text-orange-800 dark:text-orange-200',
          subtext: 'text-orange-600 dark:text-orange-300',
          icon: 'text-orange-600 dark:text-orange-400',
          button: 'bg-orange-100 hover:bg-orange-200 dark:bg-orange-800/50 dark:hover:bg-orange-800',
        };
      default:
        return {
          bg: 'bg-red-50 dark:bg-red-900/20',
          border: 'border-red-200 dark:border-red-800',
          text: 'text-red-800 dark:text-red-200',
          subtext: 'text-red-600 dark:text-red-300',
          icon: 'text-red-600 dark:text-red-400',
          button: 'bg-red-100 hover:bg-red-200 dark:bg-red-800/50 dark:hover:bg-red-800',
        };
    }
  };

  const Icon = getErrorIcon();
  const colors = getColorScheme();
  const title = getErrorTitle(error.type);
  const suggestion = getRecoverySuggestion(error.type);

  const canRetry = error.retryable && onRetry && (countdown === null || countdown === 0);

  if (variant === 'inline') {
    return (
      <div
        className={cn('flex items-center gap-2 text-sm', colors.text, className)}
        role="alert"
        aria-live="polite"
      >
        <Icon className={cn('w-4 h-4 flex-shrink-0', colors.icon)} aria-hidden="true" />
        <span>{error.userMessage}</span>
        {canRetry && (
          <button
            onClick={onRetry}
            disabled={isRetrying}
            className="underline hover:no-underline ml-1"
          >
            {isRetrying ? 'Retrying...' : 'Retry'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-4',
        colors.bg,
        colors.border,
        variant === 'card' && 'shadow-sm',
        className
      )}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-4">
        <div className={cn('p-2 rounded-full', colors.bg)}>
          <Icon className={cn('w-5 h-5', colors.icon)} aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className={cn('text-sm font-semibold', colors.text)}>
            {title}
          </h3>
          <p className={cn('text-sm mt-1', colors.subtext)}>
            {error.userMessage}
          </p>

          {/* Recovery suggestion */}
          <p className={cn('text-xs mt-2 opacity-75', colors.subtext)}>
            {suggestion}
          </p>

          {/* Rate limit countdown */}
          {error.type === ErrorType.RATE_LIMIT_ERROR && countdown !== null && countdown > 0 && (
            <p className={cn('text-sm font-medium mt-2', colors.text)}>
              Retry available in {countdown} second{countdown !== 1 ? 's' : ''}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Custom action from error */}
          {error.action && (
            <Button
              onClick={error.action.onClick || (() => error.action?.href && (window.location.href = error.action.href))}
              size="sm"
              variant="outline"
              className={cn(colors.text, colors.button, 'border-0')}
            >
              {error.action.label}
            </Button>
          )}

          {/* Retry button */}
          {error.retryable && onRetry && (
            <Button
              onClick={onRetry}
              disabled={isRetrying || (countdown !== null && countdown > 0)}
              size="sm"
              variant="outline"
              className={cn(colors.text, colors.button, 'border-0')}
            >
              {isRetrying ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  Retrying...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
                  Retry
                </>
              )}
            </Button>
          )}

          {/* Dismiss button */}
          {onDismiss && (
            <Button
              onClick={onDismiss}
              size="sm"
              variant="ghost"
              className={cn(colors.text, 'hover:bg-black/5 dark:hover:bg-white/5')}
              aria-label="Dismiss error"
            >
              <XCircle className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact error badge for inline use
 */
export function ErrorBadge({
  error,
  onRetry,
}: {
  error: AppError;
  onRetry?: () => void;
}) {
  const Icon = error.type === ErrorType.NETWORK_ERROR ? WifiOff : AlertTriangle;

  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-full text-xs">
      <Icon className="w-3 h-3" />
      <span>{getErrorTitle(error.type)}</span>
      {error.retryable && onRetry && (
        <button
          onClick={onRetry}
          className="ml-1 underline hover:no-underline"
        >
          Retry
        </button>
      )}
    </div>
  );
}
