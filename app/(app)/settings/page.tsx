'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Lock, Globe, Palette, CheckCircle2, Mail, MessageSquare, Webhook } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from 'sonner';

export default function SettingsPage() {
  // Preferences state
  const [theme, setTheme] = useState('light');
  const [timezone, setTimezone] = useState('America/New_York');
  const [language, setLanguage] = useState('en');
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Security — change password
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Security — sessions
  const [showSessions, setShowSessions] = useState(false);

  useEffect(() => {
    api.get('/api/user/preferences/display')
      .then((res) => {
        const d = res.data?.data;
        if (d) {
          if (d.theme) setTheme(d.theme);
          if (d.timezone) setTimezone(d.timezone);
          if (d.language) setLanguage(d.language);
        }
      })
      .catch(() => {
        // non-fatal — defaults stay in place
      })
      .finally(() => setPrefsLoading(false));
  }, []);

  const handleSavePreferences = async () => {
    setIsSaving(true);
    try {
      await api.put('/api/user/preferences/display', { theme, timezone, language });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch {
      toast.error('Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    setPasswordSaving(true);
    try {
      await api.post('/api/auth/change-password', {
        oldPassword: currentPassword,
        newPassword,
      });
      toast.success('Password changed successfully');
      setShowPasswordForm(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      const msg = err?.response?.data?.error || 'Failed to change password';
      toast.error(msg);
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">Manage your account preferences and settings</p>
        </div>

        {showSuccess && (
          <Alert className="mb-6 bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Settings updated successfully!
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="preferences" className="space-y-6">
          <TabsList>
            <TabsTrigger value="preferences">
              <Palette className="w-4 h-4 mr-2" />
              Preferences
            </TabsTrigger>
            <TabsTrigger value="security">
              <Lock className="w-4 h-4 mr-2" />
              Security
            </TabsTrigger>
            <TabsTrigger value="alerts">
              <Mail className="w-4 h-4 mr-2" />
              Alerts
            </TabsTrigger>
          </TabsList>

          {/* Preferences Tab */}
          <TabsContent value="preferences">
            <Card>
              <CardHeader>
                <CardTitle>Display &amp; Language Preferences</CardTitle>
                <CardDescription>
                  Customize how DevControl looks and behaves
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 max-w-2xl">
                {prefsLoading ? (
                  <p className="text-sm text-gray-500">Loading preferences…</p>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="theme">
                        <Palette className="w-4 h-4 inline mr-2" />
                        Theme
                      </Label>
                      <Select value={theme} onValueChange={setTheme}>
                        <SelectTrigger id="theme">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="system">System</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="timezone">
                        <Globe className="w-4 h-4 inline mr-2" />
                        Timezone
                      </Label>
                      <Select value={timezone} onValueChange={setTimezone}>
                        <SelectTrigger id="timezone">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="America/New_York">Eastern Time (ET)</SelectItem>
                          <SelectItem value="America/Chicago">Central Time (CT)</SelectItem>
                          <SelectItem value="America/Denver">Mountain Time (MT)</SelectItem>
                          <SelectItem value="America/Los_Angeles">Pacific Time (PT)</SelectItem>
                          <SelectItem value="UTC">UTC</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="language">Language</Label>
                      <Select value={language} onValueChange={setLanguage}>
                        <SelectTrigger id="language">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="en">English</SelectItem>
                          <SelectItem value="es">Español</SelectItem>
                          <SelectItem value="fr">Français</SelectItem>
                          <SelectItem value="de">Deutsch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="pt-4 border-t">
                      <Button
                        onClick={handleSavePreferences}
                        disabled={isSaving}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {isSaving ? 'Saving…' : 'Save Changes'}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Security Tab */}
          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
                <CardDescription>
                  Manage your password and security preferences
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6 max-w-2xl">
                {/* Change Password */}
                <div>
                  <h3 className="font-medium text-gray-900 mb-1">Password</h3>
                  <p className="text-sm text-gray-500 mb-3">
                    Update your account password
                  </p>
                  {!showPasswordForm ? (
                    <Button variant="outline" onClick={() => setShowPasswordForm(true)}>
                      Change Password
                    </Button>
                  ) : (
                    <form onSubmit={handleChangePassword} className="space-y-3 mt-2 max-w-sm">
                      <div className="space-y-1">
                        <Label htmlFor="currentPassword">Current Password</Label>
                        <Input
                          id="currentPassword"
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="newPassword">New Password</Label>
                        <Input
                          id="newPassword"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="confirmPassword">Confirm New Password</Label>
                        <Input
                          id="confirmPassword"
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                        />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button type="submit" disabled={passwordSaving} className="bg-blue-600 hover:bg-blue-700">
                          {passwordSaving ? 'Saving…' : 'Update Password'}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            setShowPasswordForm(false);
                            setCurrentPassword('');
                            setNewPassword('');
                            setConfirmPassword('');
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                </div>

                {/* 2FA */}
                <div className="pt-4 border-t">
                  <h3 className="font-medium text-gray-900 mb-1">Two-Factor Authentication</h3>
                  <p className="text-sm text-gray-500 mb-3">
                    Add an extra layer of security to your account
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" disabled>
                      Enable 2FA
                    </Button>
                    <Badge variant="secondary">Coming Soon</Badge>
                  </div>
                </div>

                {/* Active Sessions */}
                <div className="pt-4 border-t">
                  <h3 className="font-medium text-gray-900 mb-1">Active Sessions</h3>
                  <p className="text-sm text-gray-500 mb-3">
                    Devices where you&apos;re currently logged in
                  </p>
                  {!showSessions ? (
                    <Button variant="outline" onClick={() => setShowSessions(true)}>
                      View Sessions
                    </Button>
                  ) : (
                    <div className="mt-2 rounded-md border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-600">
                          <tr>
                            <th className="px-4 py-2 text-left font-medium">Device</th>
                            <th className="px-4 py-2 text-left font-medium">Last Active</th>
                            <th className="px-4 py-2 text-left font-medium">Location</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t">
                            <td className="px-4 py-3 text-gray-900">Current session</td>
                            <td className="px-4 py-3 text-gray-600">Now</td>
                            <td className="px-4 py-3 text-gray-600">Unknown</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Alerts Tab */}
          <TabsContent value="alerts">
            <Card>
              <CardHeader>
                <CardTitle>Advanced Alert Configuration</CardTitle>
                <CardDescription>
                  Configure email, Slack, and webhook notifications for monitoring alerts
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-sm text-gray-600">
                    Set up advanced alerting channels to receive notifications about critical events,
                    resource usage, and system health.
                  </p>

                  <div className="flex gap-3">
                    <Link href="/settings/alerts">
                      <Button className="bg-blue-600 hover:bg-blue-700">
                        Configure Alert Channels →
                      </Button>
                    </Link>
                  </div>

                  <div className="mt-6 p-4 bg-gray-50 rounded-lg">
                    <h4 className="font-medium text-sm text-gray-900 mb-2">Available Channels:</h4>
                    <ul className="space-y-2 text-sm text-gray-600">
                      <li className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-blue-600" />
                        Email - SMTP configuration with multiple recipients
                      </li>
                      <li className="flex items-center gap-2">
                        <MessageSquare className="w-4 h-4 text-purple-600" />
                        Slack - Webhook integration for team channels
                      </li>
                      <li className="flex items-center gap-2">
                        <Webhook className="w-4 h-4 text-green-600" />
                        Webhooks - Custom endpoint integrations
                      </li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
