'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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

export default function BillingPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
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
      console.error('Error fetching billing data:', error);
      toast.error('Error', {
        description: 'Failed to load billing information',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
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

  // Usage limits based on tier
  const getLimits = () => {
    const limits: Record<
      string,
      { resources: number | 'unlimited'; apiRequests: number }
    > = {
      free: { resources: 10, apiRequests: 100 },
      starter: { resources: 50, apiRequests: 1000 },
      pro: { resources: 500, apiRequests: 5000 },
      enterprise: { resources: 'unlimited', apiRequests: 20000 },
    };
    return limits[subscription?.tier || 'free'];
  };

  // Mock current usage - in production, fetch from backend
  const currentUsage = {
    resources: 8,
    apiRequests: 45,
  };

  const limits = getLimits();
  const resourceUsagePercent =
    limits.resources === 'unlimited'
      ? 0
      : (currentUsage.resources / limits.resources) * 100;
  const apiUsagePercent = (currentUsage.apiRequests / limits.apiRequests) * 100;

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
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
    <div className="container mx-auto p-6 space-y-6">
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
              {subscription?.tier === 'free' ? (
                <Button
                  className="w-full"
                  onClick={() => router.push('/pricing')}
                >
                  <ArrowUpCircle className="mr-2 h-4 w-4" />
                  Upgrade Plan
                </Button>
              ) : (
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

                  {subscription?.tier !== 'enterprise' && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => router.push('/pricing')}
                    >
                      <TrendingUp className="mr-2 h-4 w-4" />
                      Upgrade Plan
                    </Button>
                  )}
                </>
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
                Usage This Month
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Resources Usage */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">AWS Resources Discovered</span>
                  <span className="font-medium">
                    {currentUsage.resources}{' '}
                    {limits.resources !== 'unlimited' && `/ ${limits.resources}`}
                  </span>
                </div>
                {limits.resources !== 'unlimited' && (
                  <Progress value={resourceUsagePercent} className="h-2" />
                )}
                {limits.resources !== 'unlimited' && resourceUsagePercent > 80 && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    You're approaching your resource limit. Consider upgrading your plan.
                  </p>
                )}
              </div>

              {/* API Usage */}
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">API Requests This Hour</span>
                  <span className="font-medium">
                    {currentUsage.apiRequests} / {limits.apiRequests}
                  </span>
                </div>
                <Progress value={apiUsagePercent} className="h-2" />
                {apiUsagePercent > 80 && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    You're approaching your API request limit.
                  </p>
                )}
              </div>

              {subscription?.tier === 'free' && (
                <div className="mt-4 p-4 bg-primary/5 border border-primary/20 rounded-lg">
                  <p className="text-sm">
                    <strong>Want more resources?</strong> Upgrade to unlock higher limits
                    and premium features.
                  </p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => router.push('/pricing')}
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
      {subscription && (
        <CancelSubscriptionDialog
          open={cancelDialogOpen}
          onOpenChange={setCancelDialogOpen}
          onSuccess={fetchData}
          currentPeriodEnd={subscription.currentPeriodEnd}
        />
      )}
    </div>
  );
}
