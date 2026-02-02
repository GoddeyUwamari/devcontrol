'use client';

/**
 * Email Notification Settings Page
 * Allows users to manage their email preferences
 */

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Bell, Mail, AlertTriangle, DollarSign, Rocket, Check, Loader2 } from 'lucide-react';
import { userPreferencesService, type EmailPreferences } from '@/lib/services/user-preferences.service';
import { toast } from 'sonner';

export default function NotificationsSettingsPage() {
  const [preferences, setPreferences] = useState<EmailPreferences>({
    weeklySummary: true,
    anomalyAlerts: true,
    costAlerts: true,
    deploymentAlerts: true
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPreferences();
  }, []);

  async function loadPreferences() {
    try {
      const data = await userPreferencesService.getEmailPreferences();
      setPreferences(data);
    } catch (error: any) {
      console.error('Failed to load preferences:', error);
      toast.error('Failed to load email preferences');
    } finally {
      setLoading(false);
    }
  }

  async function updatePreference(key: keyof EmailPreferences, value: boolean) {
    setSaving(true);

    // Optimistic update
    const previousValue = preferences[key];
    setPreferences(prev => ({ ...prev, [key]: value }));

    try {
      const updated = await userPreferencesService.updateSinglePreference(key, value);
      setPreferences(updated);
      toast.success('Email preferences updated');
    } catch (error: any) {
      console.error('Failed to update preference:', error);
      // Revert on error
      setPreferences(prev => ({ ...prev, [key]: previousValue }));
      toast.error('Failed to update preference');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-sm text-gray-600">Loading preferences...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Notification Settings</h1>
        <p className="text-gray-600 mt-2">
          Manage how and when you receive notifications from DevControl
        </p>
      </div>

      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <CardTitle>Email Notifications</CardTitle>
              <CardDescription>
                Choose which emails you want to receive
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Weekly Summary */}
          <div className="flex items-start justify-between pb-6 border-b">
            <div className="flex items-start gap-4 flex-1 pr-4">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-purple-600" />
              </div>
              <div className="space-y-1 flex-1">
                <div className="font-semibold text-gray-900">Weekly AI Summary</div>
                <p className="text-sm text-gray-600">
                  Receive a comprehensive AI-powered summary every Monday at 9 AM with cost savings,
                  anomaly detections, deployment metrics, and personalized recommendations.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Check className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-gray-500">Sent every Monday at 9:00 AM</span>
                </div>
              </div>
            </div>
            <Switch
              checked={preferences.weeklySummary}
              onCheckedChange={(value) => updatePreference('weeklySummary', value)}
              disabled={saving}
            />
          </div>

          {/* Anomaly Alerts */}
          <div className="flex items-start justify-between pb-6 border-b">
            <div className="flex items-start gap-4 flex-1 pr-4">
              <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div className="space-y-1 flex-1">
                <div className="font-semibold text-gray-900">Anomaly Detection Alerts</div>
                <p className="text-sm text-gray-600">
                  Get notified immediately when our AI detects unusual patterns in your infrastructure,
                  such as cost spikes, traffic anomalies, or performance issues.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Check className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-gray-500">Real-time alerts</span>
                </div>
              </div>
            </div>
            <Switch
              checked={preferences.anomalyAlerts}
              onCheckedChange={(value) => updatePreference('anomalyAlerts', value)}
              disabled={saving}
            />
          </div>

          {/* Cost Alerts */}
          <div className="flex items-start justify-between pb-6 border-b">
            <div className="flex items-start gap-4 flex-1 pr-4">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div className="space-y-1 flex-1">
                <div className="font-semibold text-gray-900">Cost Alerts</div>
                <p className="text-sm text-gray-600">
                  Receive alerts when your AWS spending increases significantly or when budget
                  thresholds are exceeded.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Check className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-gray-500">Budget threshold alerts</span>
                </div>
              </div>
            </div>
            <Switch
              checked={preferences.costAlerts}
              onCheckedChange={(value) => updatePreference('costAlerts', value)}
              disabled={saving}
            />
          </div>

          {/* Deployment Alerts */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4 flex-1 pr-4">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <Rocket className="w-5 h-5 text-blue-600" />
              </div>
              <div className="space-y-1 flex-1">
                <div className="font-semibold text-gray-900">Deployment Alerts</div>
                <p className="text-sm text-gray-600">
                  Get notified about deployment failures, rollbacks, and performance degradations
                  after deployments.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Check className="w-4 h-4 text-green-600" />
                  <span className="text-xs text-gray-500">Failure & rollback alerts</span>
                </div>
              </div>
            </div>
            <Switch
              checked={preferences.deploymentAlerts}
              onCheckedChange={(value) => updatePreference('deploymentAlerts', value)}
              disabled={saving}
            />
          </div>
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <Bell className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-blue-900">
                You can unsubscribe from all emails at any time
              </p>
              <p className="text-sm text-blue-700">
                Every email includes an unsubscribe link in the footer. You can also manage
                your preferences here anytime.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
