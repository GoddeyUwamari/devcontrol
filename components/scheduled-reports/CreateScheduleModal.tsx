'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  DollarSign,
  Shield,
  FileCheck,
  ChevronLeft,
  ChevronRight,
  Mail,
  MessageSquare,
  Calendar,
  Clock,
  Check,
} from 'lucide-react';
import { ScheduledReport, CreateScheduleRequest } from '@/lib/services/scheduled-reports.service';

interface CreateScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: CreateScheduleRequest) => Promise<void>;
  initialData?: ScheduledReport;
  isEditing?: boolean;
}

const REPORT_TYPES = [
  {
    value: 'cost_summary' as const,
    label: 'Cost Summary',
    icon: DollarSign,
    description: 'Analyze spending by team, service, and environment with top spenders',
    color: 'blue',
  },
  {
    value: 'security_audit' as const,
    label: 'Security Audit',
    icon: Shield,
    description: 'Review encryption status, public resources, and backup compliance',
    color: 'green',
  },
  {
    value: 'compliance_status' as const,
    label: 'Compliance Status',
    icon: FileCheck,
    description: 'Track compliance issues by severity and category with remediation tips',
    color: 'purple',
  },
];

const TIMEZONES = [
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'Europe/London', label: 'London (GMT)' },
  { value: 'Europe/Paris', label: 'Paris (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

export function CreateScheduleModal({ open, onClose, onSubmit, initialData, isEditing = false }: CreateScheduleModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [reportType, setReportType] = useState<'cost_summary' | 'security_audit' | 'compliance_status'>('cost_summary');
  const [scheduleType, setScheduleType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [scheduleTime, setScheduleTime] = useState('09:00');
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(1); // Monday
  const [scheduleDayOfMonth, setScheduleDayOfMonth] = useState(1);
  const [timezone, setTimezone] = useState('UTC');
  const [deliveryEmail, setDeliveryEmail] = useState(true);
  const [deliverySlack, setDeliverySlack] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState('');
  const [slackChannels, setSlackChannels] = useState('');
  const [format, setFormat] = useState<'pdf' | 'csv' | 'both'>('pdf');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Load initial data if editing
  useEffect(() => {
    if (initialData && open) {
      setReportType(initialData.report_type);
      setScheduleType(initialData.schedule_type);
      setScheduleTime(initialData.schedule_time.substring(0, 5));
      setScheduleDayOfWeek(initialData.schedule_day_of_week || 1);
      setScheduleDayOfMonth(initialData.schedule_day_of_month || 1);
      setTimezone(initialData.timezone);
      setDeliveryEmail(initialData.delivery_email);
      setDeliverySlack(initialData.delivery_slack);
      setEmailRecipients(initialData.email_recipients.join(', '));
      setSlackChannels(initialData.slack_channels.join(', '));
      setFormat(initialData.format);
      setName(initialData.name);
      setDescription(initialData.description || '');
    } else if (!open) {
      // Reset form when closing
      resetForm();
    }
  }, [initialData, open]);

  const resetForm = () => {
    setCurrentStep(1);
    setReportType('cost_summary');
    setScheduleType('daily');
    setScheduleTime('09:00');
    setScheduleDayOfWeek(1);
    setScheduleDayOfMonth(1);
    setTimezone('UTC');
    setDeliveryEmail(true);
    setDeliverySlack(false);
    setEmailRecipients('');
    setSlackChannels('');
    setFormat('pdf');
    setName('');
    setDescription('');
  };

  const handleSubmit = async () => {
    // Validation
    if (!name.trim()) {
      alert('Please enter a schedule name');
      return;
    }

    if (!deliveryEmail && !deliverySlack) {
      alert('Please enable at least one delivery method');
      return;
    }

    if (deliveryEmail && !emailRecipients.trim()) {
      alert('Please enter email recipients');
      return;
    }

    if (deliverySlack && !slackChannels.trim()) {
      alert('Please enter Slack channels');
      return;
    }

    const data: CreateScheduleRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      report_type: reportType,
      schedule_type: scheduleType,
      schedule_time: `${scheduleTime}:00`,
      schedule_day_of_week: scheduleType === 'weekly' ? scheduleDayOfWeek : undefined,
      schedule_day_of_month: scheduleType === 'monthly' ? scheduleDayOfMonth : undefined,
      timezone,
      delivery_email: deliveryEmail,
      delivery_slack: deliverySlack,
      email_recipients: deliveryEmail ? emailRecipients.split(',').map(e => e.trim()).filter(Boolean) : [],
      slack_channels: deliverySlack ? slackChannels.split(',').map(c => c.trim()).filter(Boolean) : [],
      format,
    };

    setSubmitting(true);
    try {
      await onSubmit(data);
      resetForm();
    } catch (error) {
      console.error('Submit error:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return true; // Report type always selected
      case 2:
        return true; // Schedule always valid
      case 3:
        if (!deliveryEmail && !deliverySlack) return false;
        if (deliveryEmail && !emailRecipients.trim()) return false;
        if (deliverySlack && !slackChannels.trim()) return false;
        return true;
      case 4:
        return true; // Format and filters optional
      case 5:
        return name.trim().length > 0;
      default:
        return false;
    }
  };

  const getSchedulePreview = () => {
    const time = scheduleTime;
    let preview = '';

    switch (scheduleType) {
      case 'daily':
        preview = `Every day at ${time} ${timezone}`;
        break;
      case 'weekly':
        const day = DAYS_OF_WEEK.find(d => d.value === scheduleDayOfWeek)?.label || 'Unknown';
        preview = `Every ${day} at ${time} ${timezone}`;
        break;
      case 'monthly':
        preview = `Day ${scheduleDayOfMonth} of every month at ${time} ${timezone}`;
        break;
    }

    return preview;
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold mb-4">Select Report Type</h3>
              <RadioGroup value={reportType} onValueChange={(val) => setReportType(val as any)}>
                <div className="space-y-3">
                  {REPORT_TYPES.map((type) => (
                    <label
                      key={type.value}
                      className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-all ${
                        reportType === type.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <RadioGroupItem value={type.value} className="mt-1" />
                      <div className="ml-4 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <type.icon className={`h-5 w-5 text-${type.color}-600`} />
                          <span className="font-semibold">{type.label}</span>
                        </div>
                        <p className="text-sm text-gray-600">{type.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </RadioGroup>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Configure Schedule</h3>

              {/* Schedule Type */}
              <div className="mb-4">
                <Label>Frequency</Label>
                <RadioGroup value={scheduleType} onValueChange={(val) => setScheduleType(val as any)} className="mt-2">
                  <div className="flex gap-4">
                    <label className="flex items-center">
                      <RadioGroupItem value="daily" />
                      <span className="ml-2">Daily</span>
                    </label>
                    <label className="flex items-center">
                      <RadioGroupItem value="weekly" />
                      <span className="ml-2">Weekly</span>
                    </label>
                    <label className="flex items-center">
                      <RadioGroupItem value="monthly" />
                      <span className="ml-2">Monthly</span>
                    </label>
                  </div>
                </RadioGroup>
              </div>

              {/* Time */}
              <div className="mb-4">
                <Label htmlFor="schedule-time">Time</Label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="mt-1"
                />
              </div>

              {/* Day of Week (for weekly) */}
              {scheduleType === 'weekly' && (
                <div className="mb-4">
                  <Label htmlFor="day-of-week">Day of Week</Label>
                  <select
                    id="day-of-week"
                    value={scheduleDayOfWeek}
                    onChange={(e) => setScheduleDayOfWeek(parseInt(e.target.value))}
                    className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
                  >
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Day of Month (for monthly) */}
              {scheduleType === 'monthly' && (
                <div className="mb-4">
                  <Label htmlFor="day-of-month">Day of Month</Label>
                  <Input
                    id="day-of-month"
                    type="number"
                    min="1"
                    max="31"
                    value={scheduleDayOfMonth}
                    onChange={(e) => setScheduleDayOfMonth(parseInt(e.target.value) || 1)}
                    className="mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    For months with fewer days, the report will run on the last day of the month.
                  </p>
                </div>
              )}

              {/* Timezone */}
              <div className="mb-4">
                <Label htmlFor="timezone">Timezone</Label>
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Preview */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-blue-800">
                  <Calendar className="h-5 w-5" />
                  <span className="font-medium">Next run will be:</span>
                </div>
                <p className="text-blue-900 mt-1">{getSchedulePreview()}</p>
              </div>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Delivery Settings</h3>

              {/* Email Delivery */}
              <div className="border rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Mail className="h-5 w-5 text-blue-600" />
                    <span className="font-semibold">Email Delivery</span>
                  </div>
                  <Checkbox checked={deliveryEmail} onCheckedChange={(checked) => setDeliveryEmail(!!checked)} />
                </div>
                {deliveryEmail && (
                  <div>
                    <Label htmlFor="email-recipients">Recipients (comma-separated)</Label>
                    <Input
                      id="email-recipients"
                      type="text"
                      placeholder="admin@example.com, team@example.com"
                      value={emailRecipients}
                      onChange={(e) => setEmailRecipients(e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-gray-500 mt-1">Separate multiple emails with commas</p>
                  </div>
                )}
              </div>

              {/* Slack Delivery */}
              <div className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-green-600" />
                    <span className="font-semibold">Slack Delivery</span>
                  </div>
                  <Checkbox checked={deliverySlack} onCheckedChange={(checked) => setDeliverySlack(!!checked)} />
                </div>
                {deliverySlack && (
                  <div>
                    <Label htmlFor="slack-channels">Channels (comma-separated)</Label>
                    <Input
                      id="slack-channels"
                      type="text"
                      placeholder="#reports, #alerts"
                      value={slackChannels}
                      onChange={(e) => setSlackChannels(e.target.value)}
                      className="mt-1"
                    />
                    <p className="text-xs text-gray-500 mt-1">Include # prefix for each channel</p>
                  </div>
                )}
              </div>

              {!deliveryEmail && !deliverySlack && (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Please enable at least one delivery method
                </p>
              )}
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Format & Filters (Optional)</h3>

              {/* Format */}
              <div className="mb-4">
                <Label>Report Format</Label>
                <RadioGroup value={format} onValueChange={(val) => setFormat(val as any)} className="mt-2">
                  <div className="flex gap-4">
                    <label className="flex items-center">
                      <RadioGroupItem value="pdf" />
                      <span className="ml-2">PDF</span>
                    </label>
                    <label className="flex items-center">
                      <RadioGroupItem value="csv" />
                      <span className="ml-2">CSV</span>
                    </label>
                    <label className="flex items-center">
                      <RadioGroupItem value="both" />
                      <span className="ml-2">Both</span>
                    </label>
                  </div>
                </RadioGroup>
              </div>

              <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
                Advanced filters (resource type, region, environment) can be added after creation by editing the schedule.
              </p>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Review & Save</h3>

              {/* Name */}
              <div className="mb-4">
                <Label htmlFor="schedule-name">Schedule Name *</Label>
                <Input
                  id="schedule-name"
                  type="text"
                  placeholder="e.g., Weekly Cost Report"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1"
                />
              </div>

              {/* Description */}
              <div className="mb-6">
                <Label htmlFor="schedule-description">Description (Optional)</Label>
                <Textarea
                  id="schedule-description"
                  placeholder="Brief description of this scheduled report"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1"
                  rows={3}
                />
              </div>

              {/* Summary */}
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
                <h4 className="font-semibold text-gray-900 mb-3">Summary</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="text-gray-600">Report Type:</div>
                  <div className="font-medium">{REPORT_TYPES.find(t => t.value === reportType)?.label}</div>

                  <div className="text-gray-600">Schedule:</div>
                  <div className="font-medium">{getSchedulePreview()}</div>

                  <div className="text-gray-600">Format:</div>
                  <div className="font-medium">{format.toUpperCase()}</div>

                  <div className="text-gray-600">Delivery:</div>
                  <div className="font-medium">
                    {deliveryEmail && 'Email'}{deliveryEmail && deliverySlack && ' + '}{deliverySlack && 'Slack'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit' : 'Create'} Scheduled Report</DialogTitle>
          <DialogDescription>
            Step {currentStep} of 5: {
              currentStep === 1 ? 'Select report type' :
              currentStep === 2 ? 'Configure schedule' :
              currentStep === 3 ? 'Set delivery options' :
              currentStep === 4 ? 'Choose format' :
              'Review and save'
            }
          </DialogDescription>
        </DialogHeader>

        {/* Progress Indicator */}
        <div className="flex items-center justify-between mb-6">
          {[1, 2, 3, 4, 5].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center font-semibold ${
                  step < currentStep
                    ? 'bg-green-500 text-white'
                    : step === currentStep
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {step < currentStep ? <Check className="h-5 w-5" /> : step}
              </div>
              {step < 5 && (
                <div
                  className={`w-12 h-1 ${
                    step < currentStep ? 'bg-green-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="min-h-[300px]">{renderStep()}</div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1 || submitting}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          {currentStep < 5 ? (
            <Button onClick={() => setCurrentStep(currentStep + 1)} disabled={!canProceed()}>
              Next
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!canProceed() || submitting}>
              {submitting ? 'Saving...' : isEditing ? 'Update Schedule' : 'Create Schedule'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
