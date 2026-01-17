'use client';

import { useEffect } from 'react';
import { X, AlertTriangle, Clock, CheckCircle2, Calendar, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';

interface Alert {
  id: string;
  alertName: string;
  description?: string;
  severity: 'critical' | 'warning' | 'info';
  status: 'firing' | 'acknowledged' | 'resolved';
  startedAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  durationMinutes?: number;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

interface AlertDetailSlideOverProps {
  alert: Alert | null;
  isOpen: boolean;
  onClose: () => void;
  onAcknowledge?: (id: string) => void;
  onResolve?: (id: string) => void;
  onDelete?: (id: string) => void;
  isActionLoading?: boolean;
}

export function AlertDetailSlideOver({
  alert,
  isOpen,
  onClose,
  onAcknowledge,
  onResolve,
  onDelete,
  isActionLoading = false,
}: AlertDetailSlideOverProps) {
  // Close on ESC key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!alert) return null;

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-600 text-white';
      case 'warning':
        return 'bg-amber-500 text-white';
      case 'info':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'firing':
        return {
          label: 'Firing',
          className: 'bg-red-100 text-red-700 border-red-200',
          icon: <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />,
        };
      case 'acknowledged':
        return {
          label: 'Acknowledged',
          className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
          icon: <div className="h-2 w-2 rounded-full bg-yellow-500" />,
        };
      case 'resolved':
        return {
          label: 'Resolved',
          className: 'bg-green-100 text-green-700 border-green-200',
          icon: <div className="h-2 w-2 rounded-full bg-green-500" />,
        };
      default:
        return {
          label: status,
          className: 'bg-gray-100 text-gray-700 border-gray-200',
          icon: <div className="h-2 w-2 rounded-full bg-gray-500" />,
        };
    }
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return 'N/A';
    const hours = Math.floor(minutes / 60);
    const mins = Math.floor(minutes % 60);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const statusDisplay = getStatusDisplay(alert.status);

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity duration-300"
          onClick={onClose}
        />
      )}

      {/* Slide-over panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="px-6 py-6 border-b border-gray-200 bg-gray-50">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-3">
                  <Badge className={`text-sm font-semibold px-3 py-1 ${getSeverityColor(alert.severity)}`}>
                    {alert.severity.toUpperCase()}
                  </Badge>
                  <Badge className={`text-sm font-medium px-3 py-1 border ${statusDisplay.className}`}>
                    <span className="flex items-center gap-2">
                      {statusDisplay.icon}
                      {statusDisplay.label}
                    </span>
                  </Badge>
                </div>
                <h2 className="text-2xl font-bold text-gray-900">{alert.alertName}</h2>
                {alert.description && (
                  <p className="mt-2 text-sm text-gray-600">{alert.description}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="ml-4 p-2 rounded-lg hover:bg-gray-200 transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6">
              {/* Timeline Section */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Clock className="h-5 w-5 text-gray-500" />
                  Timeline
                </h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-1">
                      <div className="h-2 w-2 rounded-full bg-red-500" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium text-gray-900">Started</span>
                        <span className="text-sm text-gray-500">
                          {format(new Date(alert.startedAt), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600">
                        {formatDistanceToNow(new Date(alert.startedAt), { addSuffix: true })}
                      </p>
                    </div>
                  </div>

                  {alert.acknowledgedAt && (
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        <div className="h-2 w-2 rounded-full bg-yellow-500" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-gray-900">Acknowledged</span>
                          <span className="text-sm text-gray-500">
                            {format(new Date(alert.acknowledgedAt), 'MMM d, yyyy h:mm a')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">
                          {formatDistanceToNow(new Date(alert.acknowledgedAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  )}

                  {alert.resolvedAt && (
                    <div className="flex items-start gap-3">
                      <div className="mt-1">
                        <div className="h-2 w-2 rounded-full bg-green-500" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-gray-900">Resolved</span>
                          <span className="text-sm text-gray-500">
                            {format(new Date(alert.resolvedAt), 'MMM d, yyyy h:mm a')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">
                          {formatDistanceToNow(new Date(alert.resolvedAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  )}

                  {alert.durationMinutes && (
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-900">
                          Duration: {formatDuration(alert.durationMinutes)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Labels Section */}
              {alert.labels && Object.keys(alert.labels).length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Server className="h-5 w-5 text-gray-500" />
                    Labels
                  </h3>
                  <div className="bg-gray-50 rounded-lg border border-gray-200 divide-y divide-gray-200">
                    {Object.entries(alert.labels).map(([key, value]) => (
                      <div key={key} className="px-4 py-3 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">{key}</span>
                        <span className="text-sm text-gray-900 font-mono bg-white px-2 py-1 rounded border border-gray-200">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Annotations Section */}
              {alert.annotations && Object.keys(alert.annotations).length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Annotations</h3>
                  <div className="space-y-3">
                    {Object.entries(alert.annotations).map(([key, value]) => (
                      <div key={key} className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                        <div className="text-sm font-medium text-gray-700 mb-1">{key}</div>
                        <div className="text-sm text-gray-900">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1"
              >
                Close
              </Button>
              <div className="flex gap-2">
                {alert.status === 'firing' && onAcknowledge && (
                  <Button
                    variant="outline"
                    onClick={() => onAcknowledge(alert.id)}
                    disabled={isActionLoading}
                    className="bg-yellow-50 border-yellow-200 text-yellow-700 hover:bg-yellow-100"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Acknowledge
                  </Button>
                )}
                {(alert.status === 'firing' || alert.status === 'acknowledged') && onResolve && (
                  <Button
                    onClick={() => onResolve(alert.id)}
                    disabled={isActionLoading}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Resolve
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (confirm('Are you sure you want to delete this alert from history?')) {
                        onDelete(alert.id);
                      }
                    }}
                    disabled={isActionLoading}
                    className="border-red-200 text-red-700 hover:bg-red-50"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
