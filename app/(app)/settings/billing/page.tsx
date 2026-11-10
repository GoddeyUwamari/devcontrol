'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { SubscriptionStatus } from '@/components/billing/subscription-status';
import { InvoiceList } from '@/components/billing/invoice-list';
import { CancelSubscriptionDialog } from '@/components/billing/cancel-subscription-dialog';
import { Subscription, Invoice } from '@/types/billing';
import {
  getSubscription,
  getInvoices,
  openCustomerPortal,
  resumeSubscription,
} from '@/lib/services/stripe.service';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  CreditCard,
  TrendingUp,
  Zap,
  ExternalLink,
  ArrowUpCircle,
  PlayCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useIsBillingAdmin } from '@/lib/hooks/use-current-role';
import { logError } from '@/lib/safe-log';

export default function BillingPage() {
  // Cancel/Resume/Manage Billing (Customer Portal) are all owner/admin-only
  // server-side (StripeController.requireBillingAdmin) -- hide the same
  // controls here so members/viewers never see an action they'd be
  // rejected for. Backend authorization remains the real boundary; this is
  // display-only.
  const canManageBilling = useIsBillingAdmin();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [usageLoading, setUsageLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  // API requests this hour, from its own endpoint. null: could not be read
  // (shown as unavailable, never as a made-up number).
  const [apiUsage, setApiUsage] = useState<{ used: number; limit: number } | null>(null);
  const router = useRouter();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [subResult, invResult] = await Promise.all([
        getSubscription(),
        getInvoices(),
      ]);

      if (subResult.success && subResult.data) {
        setSubscription(subResult.data);
      }

      if (invResult.success && invResult.data) {
        setInvoices(invResult.data);
      }
    } catch (error) {
      logError('Error fetching billing data', error);
      toast.error('Error', {
        description: 'Failed to load billing information',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchUsage = async () => {
    setUsageLoading(true);
    try {
      const apiUsageRes = await api.get('/api/usage/api-requests');
      const used = apiUsageRes.data?.data?.requestsThisHour;
      const limit = apiUsageRes.data?.data?.limit;
      setApiUsage(typeof used === 'number' && typeof limit === 'number' ? { used, limit } : null);
    } catch {
      setApiUsage(null);
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchUsage();
  }, []);

  const handleOpenPortal = async () => {
    setPortalLoading(true);
    try {
      const result = await openCustomerPortal();

      if (result.success && result.data?.url) {
        window.location.href = result.data.url;
      } else {
        toast.error('Error', {
          description: result.error || 'Failed to open customer portal',
        });
        setPortalLoading(false);
      }
    } catch (error: any) {
      toast.error('Error', {
        description: error.message || 'Failed to open customer portal',
      });
      setPortalLoading(false);
    }
  };

  const handleResumeSubscription = async () => {
    setResumeLoading(true);
    try {
      const result = await resumeSubscription();

      if (result.success) {
        toast.success('Subscription Resumed', {
          description: 'Your subscription has been reactivated.',
        });
        await fetchData();
      } else {
        toast.error('Error', {
          description: result.error || 'Failed to resume subscription',
        });
      }
    } catch (error: any) {
      toast.error('Error', {
        description: error.message || 'Failed to resume subscription',
      });
    } finally {
      setResumeLoading(false);
    }
  };

  // Everything below is the server's billing summary; nothing is derived
  // from a Stripe status here.
  const actions = subscription?.actions;
  const showUpgrade = actions?.showUpgrade === true;
  const managed = subscription?.plan?.source === 'managed';
  const awsResources = subscription?.usage?.awsResources ?? null;
  const resourceLimit = awsResources?.limit ?? null;
  const resourceUsagePercent =
    awsResources && resourceLimit !== null ? (awsResources.used / resourceLimit) * 100 : 0;
  const apiUsagePercent = apiUsage ? (apiUsage.used / apiUsage.limit) * 100 : 0;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 space-y-6">
         <div className="flex justify-center items-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading billing information...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-14 lg:py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Billing & Subscription</h1>
          <p className="text-muted-foreground mt-1">
            Manage your subscription and billing information
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Subscription Status */}
        <div className="lg:col-span-1 space-y-6">
          {subscription && <SubscriptionStatus subscription={subscription} />}

          {/* Action Buttons */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {managed && (
                <p className="text-sm text-muted-foreground">
                  Your plan is set up and billed by our team.{' '}
                  <Link href="/contact" target="_blank" className="text-primary hover:underline">
                    Contact us
                  </Link>{' '}
                  to make changes.
                </p>
              )}

              {actions?.manageSubscription && (
                canManageBilling ? (
                  <>
                    {subscription?.cancelAtPeriodEnd ? (
                      <Button
                        className="w-full"
                        onClick={handleResumeSubscription}
                        disabled={resumeLoading}
                      >
                        <PlayCircle className="mr-2 h-4 w-4" />
                        {resumeLoading ? 'Resuming...' : 'Resume Subscription'}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setCancelDialogOpen(true)}
                      >
                        Cancel Subscription
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleOpenPortal}
                      disabled={portalLoading}
                    >
                      <CreditCard className="mr-2 h-4 w-4" />
                      {portalLoading ? 'Loading...' : 'Manage Billing'}
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Only organization owners and admins can cancel, resume, or manage billing.
                  </p>
                )
              )}

              {showUpgrade && (
                <Button
                  variant={actions?.manageSubscription ? 'outline' : 'default'}
                  className="w-full"
                  onClick={() => router.push('/settings/billing/upgrade')}
                >
                  {actions?.manageSubscription ? (
                    <TrendingUp className="mr-2 h-4 w-4" />
                  ) : (
                    <ArrowUpCircle className="mr-2 h-4 w-4" />
                  )}
                  Upgrade Plan
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Usage and Invoices */}
        <div className="lg:col-span-2 space-y-6">
          {/* Usage Stats */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Usage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {usageLoading ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <Skeleton className="h-2 w-full" />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-16" />
                    </div>
                    <Skeleton className="h-2 w-full" />
                  </div>
                </div>
              ) : (
                <>
                  {/* Resources Usage: counted and limited exactly as the server enforces them */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">AWS Resources Discovered</span>
                      <span className="font-medium">
                        {awsResources === null
                          ? 'Usage unavailable right now.'
                          : resourceLimit === null
                          ? `${awsResources.used} · Unlimited`
                          : `${awsResources.used} / ${resourceLimit}`}
                      </span>
                    </div>
                    {awsResources !== null && resourceLimit !== null && (
                      <Progress value={resourceUsagePercent} className="h-2" />
                    )}
                    {awsResources !== null && resourceLimit !== null && resourceUsagePercent > 80 && showUpgrade && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        You&apos;re approaching your resource limit. Consider upgrading your plan.
                      </p>
                    )}
                  </div>

                  {/* API Usage */}
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">API Requests This Hour</span>
                      <span className="font-medium">
                        {apiUsage === null
                          ? 'Usage unavailable right now.'
                          : `${apiUsage.used} / ${apiUsage.limit}`}
                      </span>
                    </div>
                    {apiUsage !== null && <Progress value={apiUsagePercent} className="h-2" />}
                    {apiUsage !== null && apiUsagePercent > 80 && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        You&apos;re approaching your API request limit.
                      </p>
                    )}
                  </div>
                </>
              )}

              {subscription?.plan?.storedTier === 'free' && showUpgrade && (
                <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
                  <p className="text-sm">
                    <strong>Want more resources?</strong> Upgrade to unlock higher limits
                    and premium features.
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => router.push('/settings/billing/upgrade')}
                  >
                    View Plans
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Invoices */}
          <InvoiceList invoices={invoices} />
        </div>
      </div>

      {/* Cancel Dialog */}
      {subscription && actions?.manageSubscription && (
        <CancelSubscriptionDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          onSuccess={fetchData}
          currentPeriodEnd={subscription.currentPeriodEnd ?? undefined}
        />
      )}
    </div>
  );
}
