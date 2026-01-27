'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Mail, MessageSquare, Webhook, CheckCircle2, AlertCircle, Ticket,
  Shield, DollarSign, FileCheck, Bell, Zap, Clock, TrendingDown,
  ArrowRight, Loader2, CheckCircle, XCircle, Settings2
} from 'lucide-react';
import { toast } from 'sonner';
import { alertConfigService } from '@/lib/services/alert-config.service';

// Alert type definitions
interface AlertType {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  enabled: boolean;
  threshold?: number;
  thresholdUnit?: string;
  severities: ('critical' | 'warning' | 'info')[];
}

const defaultAlertTypes: AlertType[] = [
  {
    id: 'cost_threshold',
    name: 'Cost Threshold Exceeded',
    description: 'Get alerted when AWS spending exceeds your budget',
    icon: DollarSign,
    enabled: true,
    threshold: 1000,
    thresholdUnit: 'USD/month',
    severities: ['critical', 'warning'],
  },
  {
    id: 'security_issue',
    name: 'Security Issues Detected',
    description: 'Immediate alerts for public S3 buckets, unencrypted resources',
    icon: Shield,
    enabled: true,
    severities: ['critical', 'warning'],
  },
  {
    id: 'compliance_failure',
    name: 'Compliance Violations',
    description: 'Stay compliant with SOC2, HIPAA, and PCI-DSS requirements',
    icon: FileCheck,
    enabled: true,
    severities: ['critical', 'warning', 'info'],
  },
  {
    id: 'resource_drift',
    name: 'Infrastructure Changes',
    description: 'Track new, modified, or deleted AWS resources',
    icon: Settings2,
    enabled: false,
    severities: ['info'],
  },
];

export default function AlertSettingsPage() {
  const [config, setConfig] = useState({
    email: {
      enabled: false,
      recipients: [] as string[],
      smtpHost: '',
      smtpPort: 587,
      smtpUser: '',
      smtpPass: '',
    },
    slack: {
      enabled: false,
      webhookUrl: '',
      channel: '#devcontrol-alerts',
    },
    webhook: {
      enabled: false,
      url: '',
      headers: {},
    },
    jira: {
      enabled: false,
      baseUrl: '',
      email: '',
      apiToken: '',
      projectKey: '',
      issueType: 'Task',
    },
  });

  const [alertTypes, setAlertTypes] = useState<AlertType[]>(defaultAlertTypes);
  const [recipientInput, setRecipientInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setIsLoading(true);
      const data = await alertConfigService.getConfig();
      if (data) {
        setConfig({
          email: data.email || config.email,
          slack: data.slack || config.slack,
          webhook: data.webhook || config.webhook,
          jira: data.jira || config.jira,
        });
        // Merge saved alertTypes with defaults to preserve icons
        if (data.alertTypes) {
          setAlertTypes(alertTypes.map(at => {
            const saved = data.alertTypes?.find(s => s.id === at.id);
            return saved ? { ...at, ...saved, icon: at.icon } : at;
          }));
        }
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError('');

    try {
      // Strip icons before saving (they can't be serialized)
      const alertTypesForSave = alertTypes.map(({ icon, ...rest }) => rest);
      await alertConfigService.updateConfig({
        ...config,
        alertTypes: alertTypesForSave,
      });
      setShowSuccess(true);
      toast.success('Alert configuration saved successfully');
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to save configuration';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async (type: string) => {
    setTestingChannel(type);
    setError('');

    try {
      // First save the current config
      const alertTypesForSave = alertTypes.map(({ icon, ...rest }) => rest);
      await alertConfigService.updateConfig({
        ...config,
        alertTypes: alertTypesForSave,
      });

      // Then test the channel
      await alertConfigService.testChannel(type as 'email' | 'slack' | 'jira' | 'webhook');
      toast.success(`Test alert sent to ${type}! Check your ${type === 'jira' ? 'Jira board' : type}.`);
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to send test alert';
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setTestingChannel(null);
    }
  };

  const addRecipient = () => {
    if (recipientInput && recipientInput.includes('@')) {
      setConfig({
        ...config,
        email: {
          ...config.email,
          recipients: [...config.email.recipients, recipientInput],
        },
      });
      setRecipientInput('');
    }
  };

  const removeRecipient = (email: string) => {
    setConfig({
      ...config,
      email: {
        ...config.email,
        recipients: config.email.recipients.filter((r) => r !== email),
      },
    });
  };

  const toggleAlertType = (id: string) => {
    setAlertTypes(alertTypes.map(at =>
      at.id === id ? { ...at, enabled: !at.enabled } : at
    ));
  };

  const updateAlertTypeThreshold = (id: string, threshold: number) => {
    setAlertTypes(alertTypes.map(at =>
      at.id === id ? { ...at, threshold } : at
    ));
  };

  const enabledChannelsCount = [
    config.email.enabled,
    config.slack.enabled,
    config.jira.enabled,
    config.webhook.enabled,
  ].filter(Boolean).length;

  const enabledAlertTypesCount = alertTypes.filter(at => at.enabled).length;

  const getChannelStatus = (channel: 'email' | 'slack' | 'jira' | 'webhook') => {
    const channelConfig = config[channel];
    if (!channelConfig.enabled) return 'disabled';

    switch (channel) {
      case 'email':
        return config.email.recipients.length > 0 && config.email.smtpHost ? 'configured' : 'incomplete';
      case 'slack':
        return config.slack.webhookUrl ? 'configured' : 'incomplete';
      case 'jira':
        return config.jira.baseUrl && config.jira.apiToken && config.jira.projectKey ? 'configured' : 'incomplete';
      case 'webhook':
        return config.webhook.url ? 'configured' : 'incomplete';
      default:
        return 'disabled';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Hero Section - Outcome Focused */}
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl p-8 text-white">
          <div className="flex items-start justify-between">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 mb-4">
                <Bell className="h-6 w-6" />
                <span className="text-blue-200 font-medium">Alert Configuration</span>
              </div>
              <h1 className="text-3xl font-bold mb-3">
                Never Miss a Critical Issue Again
              </h1>
              <p className="text-blue-100 text-lg mb-6">
                Get instant notifications when costs spike, security vulnerabilities appear,
                or compliance issues arise. Resolve problems before they become incidents.
              </p>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                  <Clock className="h-5 w-5 text-green-300" />
                  <span className="text-sm">Average 4-hour faster response time</span>
                </div>
                <div className="flex items-center gap-2 bg-white/10 rounded-lg px-4 py-2">
                  <TrendingDown className="h-5 w-5 text-green-300" />
                  <span className="text-sm">67% fewer escalations</span>
                </div>
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="bg-white/10 backdrop-blur rounded-xl p-6 border border-white/20">
                <div className="text-center mb-4">
                  <div className="text-4xl font-bold">{enabledChannelsCount}</div>
                  <div className="text-sm text-blue-200">Channels Active</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold">{enabledAlertTypesCount}</div>
                  <div className="text-sm text-blue-200">Alert Types Enabled</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Status Alerts */}
        {showSuccess && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Alert configuration saved successfully!
            </AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">{error}</AlertDescription>
          </Alert>
        )}

        {/* Alert Types Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              What to Get Alerted About
            </CardTitle>
            <CardDescription>
              Choose which events trigger notifications. Enable only what matters to your team.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {alertTypes.map((alertType) => {
                const Icon = alertType.icon;
                return (
                  <div
                    key={alertType.id}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      alertType.enabled
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-gray-200 bg-white'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${
                          alertType.enabled ? 'bg-blue-100' : 'bg-gray-100'
                        }`}>
                          <Icon className={`h-5 w-5 ${
                            alertType.enabled ? 'text-blue-600' : 'text-gray-500'
                          }`} />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900">{alertType.name}</h4>
                          <p className="text-sm text-gray-600">{alertType.description}</p>
                        </div>
                      </div>
                      <Switch
                        checked={alertType.enabled}
                        onCheckedChange={() => toggleAlertType(alertType.id)}
                      />
                    </div>

                    {alertType.enabled && alertType.threshold !== undefined && (
                      <div className="mt-3 pt-3 border-t border-blue-200">
                        <Label className="text-sm text-gray-700">Threshold</Label>
                        <div className="flex items-center gap-2 mt-1">
                          <Input
                            type="number"
                            value={alertType.threshold}
                            onChange={(e) => updateAlertTypeThreshold(alertType.id, parseInt(e.target.value) || 0)}
                            className="w-32"
                          />
                          <span className="text-sm text-gray-500">{alertType.thresholdUnit}</span>
                        </div>
                      </div>
                    )}

                    {alertType.enabled && (
                      <div className="mt-3 flex gap-1">
                        {alertType.severities.map((severity) => (
                          <Badge
                            key={severity}
                            className={
                              severity === 'critical'
                                ? 'bg-red-100 text-red-700'
                                : severity === 'warning'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-blue-100 text-blue-700'
                            }
                          >
                            {severity}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Channel Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowRight className="h-5 w-5 text-blue-500" />
              Where to Send Alerts
            </CardTitle>
            <CardDescription>
              Configure notification channels. We recommend at least two channels for critical alerts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Channel Status Overview */}
            <div className="grid gap-3 md:grid-cols-4 mb-6">
              {[
                { key: 'email' as const, name: 'Email', icon: Mail },
                { key: 'slack' as const, name: 'Slack', icon: MessageSquare },
                { key: 'jira' as const, name: 'Jira', icon: Ticket },
                { key: 'webhook' as const, name: 'Webhook', icon: Webhook },
              ].map(({ key, name, icon: Icon }) => {
                const status = getChannelStatus(key);
                return (
                  <div
                    key={key}
                    className={`p-4 rounded-lg border ${
                      status === 'configured'
                        ? 'border-green-200 bg-green-50'
                        : status === 'incomplete'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{name}</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      {status === 'configured' ? (
                        <>
                          <CheckCircle className="h-4 w-4 text-green-600" />
                          <span className="text-green-700">Connected</span>
                        </>
                      ) : status === 'incomplete' ? (
                        <>
                          <AlertCircle className="h-4 w-4 text-amber-600" />
                          <span className="text-amber-700">Incomplete</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 text-gray-400" />
                          <span className="text-gray-500">Disabled</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Tabs defaultValue="email" className="space-y-6">
              <TabsList className="grid grid-cols-4 w-full max-w-lg">
                <TabsTrigger value="email" className="gap-2">
                  <Mail className="w-4 h-4" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="slack" className="gap-2">
                  <MessageSquare className="w-4 h-4" />
                  Slack
                </TabsTrigger>
                <TabsTrigger value="jira" className="gap-2">
                  <Ticket className="w-4 h-4" />
                  Jira
                </TabsTrigger>
                <TabsTrigger value="webhook" className="gap-2">
                  <Webhook className="w-4 h-4" />
                  Webhook
                </TabsTrigger>
              </TabsList>

              {/* Email Tab */}
              <TabsContent value="email">
                <div className="space-y-6 max-w-2xl">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <Label className="text-base font-medium">Enable Email Alerts</Label>
                      <p className="text-sm text-gray-500 mt-1">
                        Receive detailed alerts directly in your inbox
                      </p>
                    </div>
                    <Switch
                      checked={config.email.enabled}
                      onCheckedChange={(checked) =>
                        setConfig({
                          ...config,
                          email: { ...config.email, enabled: checked },
                        })
                      }
                    />
                  </div>

                  {config.email.enabled && (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <Label>Recipients</Label>
                        <p className="text-sm text-gray-500">
                          Add team members who should receive alerts
                        </p>
                        <div className="flex gap-2">
                          <Input
                            placeholder="team@company.com"
                            value={recipientInput}
                            onChange={(e) => setRecipientInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && addRecipient()}
                          />
                          <Button onClick={addRecipient}>Add</Button>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {config.email.recipients.map((email) => (
                            <Badge
                              key={email}
                              variant="secondary"
                              className="px-3 py-1.5 gap-2"
                            >
                              {email}
                              <button onClick={() => removeRecipient(email)} className="hover:text-red-600">
                                &times;
                              </button>
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <Separator />

                      <div className="space-y-4">
                        <h4 className="font-medium text-gray-900">SMTP Configuration</h4>
                        <p className="text-sm text-gray-500">
                          Configure your email server settings. For Gmail, use smtp.gmail.com with an App Password.
                        </p>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>SMTP Host</Label>
                            <Input
                              value={config.email.smtpHost}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  email: { ...config.email, smtpHost: e.target.value },
                                })
                              }
                              placeholder="smtp.gmail.com"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>SMTP Port</Label>
                            <Input
                              type="number"
                              value={config.email.smtpPort}
                              onChange={(e) =>
                                setConfig({
                                  ...config,
                                  email: { ...config.email, smtpPort: parseInt(e.target.value) },
                                })
                              }
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>SMTP Username</Label>
                          <Input
                            value={config.email.smtpUser}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                email: { ...config.email, smtpUser: e.target.value },
                              })
                            }
                            placeholder="alerts@yourcompany.com"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>SMTP Password / App Password</Label>
                          <Input
                            type="password"
                            value={config.email.smtpPass}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                email: { ...config.email, smtpPass: e.target.value },
                              })
                            }
                            placeholder="Your app password"
                          />
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => handleTest('email')}
                        disabled={testingChannel === 'email'}
                        className="gap-2"
                      >
                        {testingChannel === 'email' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Mail className="h-4 w-4" />
                        )}
                        Send Test Email
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Slack Tab */}
              <TabsContent value="slack">
                <div className="space-y-6 max-w-2xl">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <Label className="text-base font-medium">Enable Slack Alerts</Label>
                      <p className="text-sm text-gray-500 mt-1">
                        Get real-time alerts in your Slack channels
                      </p>
                    </div>
                    <Switch
                      checked={config.slack.enabled}
                      onCheckedChange={(checked) =>
                        setConfig({
                          ...config,
                          slack: { ...config.slack, enabled: checked },
                        })
                      }
                    />
                  </div>

                  {config.slack.enabled && (
                    <div className="space-y-6">
                      <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                        <p className="text-sm text-purple-800">
                          <strong>Quick Setup:</strong> Create an{' '}
                          <a
                            href="https://api.slack.com/messaging/webhooks"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-purple-600 underline hover:text-purple-800"
                          >
                            Incoming Webhook
                          </a>{' '}
                          in your Slack workspace and paste the URL below.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Slack Webhook URL</Label>
                        <Input
                          value={config.slack.webhookUrl}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              slack: { ...config.slack, webhookUrl: e.target.value },
                            })
                          }
                          placeholder="https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Channel (Optional)</Label>
                        <Input
                          value={config.slack.channel}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              slack: { ...config.slack, channel: e.target.value },
                            })
                          }
                          placeholder="#devcontrol-alerts"
                        />
                        <p className="text-xs text-gray-500">
                          Leave blank to use the channel configured in the webhook
                        </p>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => handleTest('slack')}
                        disabled={testingChannel === 'slack'}
                        className="gap-2"
                      >
                        {testingChannel === 'slack' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MessageSquare className="h-4 w-4" />
                        )}
                        Send Test Message
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Jira Tab */}
              <TabsContent value="jira">
                <div className="space-y-6 max-w-2xl">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <Label className="text-base font-medium">Enable Jira Integration</Label>
                      <p className="text-sm text-gray-500 mt-1">
                        Automatically create Jira tickets for critical alerts
                      </p>
                    </div>
                    <Switch
                      checked={config.jira.enabled}
                      onCheckedChange={(checked) =>
                        setConfig({
                          ...config,
                          jira: { ...config.jira, enabled: checked },
                        })
                      }
                    />
                  </div>

                  {config.jira.enabled && (
                    <div className="space-y-6">
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                        <h4 className="font-medium text-blue-900 mb-2">Why Jira Integration?</h4>
                        <ul className="text-sm text-blue-800 space-y-1">
                          <li>Create tickets automatically when critical issues arise</li>
                          <li>Track resolution time and assign to the right team</li>
                          <li>Severity is mapped to Jira priority automatically</li>
                        </ul>
                      </div>

                      <div className="space-y-2">
                        <Label>Jira Cloud URL</Label>
                        <Input
                          value={config.jira.baseUrl}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              jira: { ...config.jira, baseUrl: e.target.value },
                            })
                          }
                          placeholder="https://yourcompany.atlassian.net"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Atlassian Account Email</Label>
                        <Input
                          type="email"
                          value={config.jira.email}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              jira: { ...config.jira, email: e.target.value },
                            })
                          }
                          placeholder="your-email@company.com"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>API Token</Label>
                        <Input
                          type="password"
                          value={config.jira.apiToken}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              jira: { ...config.jira, apiToken: e.target.value },
                            })
                          }
                          placeholder="Your Jira API token"
                        />
                        <p className="text-xs text-gray-500">
                          Generate from{' '}
                          <a
                            href="https://id.atlassian.com/manage-profile/security/api-tokens"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline"
                          >
                            Atlassian Account Settings
                          </a>
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Project Key</Label>
                          <Input
                            value={config.jira.projectKey}
                            onChange={(e) =>
                              setConfig({
                                ...config,
                                jira: { ...config.jira, projectKey: e.target.value.toUpperCase() },
                              })
                            }
                            placeholder="OPS"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Issue Type</Label>
                          <Select
                            value={config.jira.issueType}
                            onValueChange={(value) =>
                              setConfig({
                                ...config,
                                jira: { ...config.jira, issueType: value },
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Task">Task</SelectItem>
                              <SelectItem value="Bug">Bug</SelectItem>
                              <SelectItem value="Incident">Incident</SelectItem>
                              <SelectItem value="Story">Story</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => handleTest('jira')}
                        disabled={testingChannel === 'jira'}
                        className="gap-2"
                      >
                        {testingChannel === 'jira' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Ticket className="h-4 w-4" />
                        )}
                        Create Test Ticket
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Webhook Tab */}
              <TabsContent value="webhook">
                <div className="space-y-6 max-w-2xl">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <Label className="text-base font-medium">Enable Custom Webhooks</Label>
                      <p className="text-sm text-gray-500 mt-1">
                        Send alerts to your own endpoints or third-party services
                      </p>
                    </div>
                    <Switch
                      checked={config.webhook.enabled}
                      onCheckedChange={(checked) =>
                        setConfig({
                          ...config,
                          webhook: { ...config.webhook, enabled: checked },
                        })
                      }
                    />
                  </div>

                  {config.webhook.enabled && (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <Label>Webhook URL</Label>
                        <Input
                          value={config.webhook.url}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              webhook: { ...config.webhook, url: e.target.value },
                            })
                          }
                          placeholder="https://your-api.com/webhooks/devcontrol"
                        />
                        <p className="text-xs text-gray-500">
                          We&apos;ll POST JSON data with alert details to this URL
                        </p>
                      </div>

                      <div className="p-4 bg-gray-100 rounded-lg">
                        <p className="text-sm font-medium text-gray-700 mb-2">Payload Format:</p>
                        <pre className="text-xs bg-gray-800 text-green-400 p-3 rounded overflow-x-auto">
{`{
  "event": "alert",
  "severity": "critical | warning | info",
  "title": "Alert Title",
  "message": "Alert details...",
  "source": "DevControl",
  "timestamp": "2024-01-15T10:30:00Z",
  "metadata": { ... }
}`}
                        </pre>
                      </div>

                      <Button
                        variant="outline"
                        onClick={() => handleTest('webhook')}
                        disabled={testingChannel === 'webhook'}
                        className="gap-2"
                      >
                        {testingChannel === 'webhook' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Webhook className="h-4 w-4" />
                        )}
                        Send Test Webhook
                      </Button>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex items-center justify-between p-4 bg-white rounded-lg border shadow-sm">
          <div>
            <p className="font-medium text-gray-900">Ready to save your configuration?</p>
            <p className="text-sm text-gray-500">
              {enabledChannelsCount > 0
                ? `${enabledChannelsCount} channel${enabledChannelsCount > 1 ? 's' : ''} and ${enabledAlertTypesCount} alert type${enabledAlertTypesCount > 1 ? 's' : ''} configured`
                : 'Enable at least one channel to receive alerts'}
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            size="lg"
            className="bg-blue-600 hover:bg-blue-700 gap-2"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      </div>
    </div>
  );
}
