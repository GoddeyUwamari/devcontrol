'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, ArrowRight, Receipt } from 'lucide-react';
import { getSubscription } from '@/lib/services/stripe.service';
import { Subscription } from '@/types/billing';

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    async function fetchSubscription() {
      try {
        // Wait a moment for webhook to process
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const result = await getSubscription();
        if (result.success && result.data) {
          setSubscription(result.data);
        }
      } catch (error) {
        console.error('Error fetching subscription:', error);
      } finally {
        setLoading(false);
      }
    }

    if (sessionId) {
      fetchSubscription();
    } else {
      setLoading(false);
    }
  }, [sessionId]);

  const getNextBillingDate = () => {
    if (!subscription?.currentPeriodEnd) return null;
    return new Date(subscription.currentPeriodEnd * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center pb-6">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-green-100 dark:bg-green-900/20 p-3">
              <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-500" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">Payment Successful!</h1>
          <p className="text-lg text-muted-foreground">
            Thank you for subscribing to DevControl
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="text-muted-foreground mt-4">Loading your subscription...</p>
            </div>
          ) : (
            <>
              {/* Subscription Details */}
              <div className="bg-muted/50 rounded-lg p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Plan:</span>
                  <span className="font-semibold text-lg capitalize">
                    {subscription?.tier || 'Pro'}
                  </span>
                </div>

                {subscription?.status && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Status:</span>
                    <span className="font-semibold capitalize text-green-600 dark:text-green-500">
                      {subscription.status === 'trialing' ? 'Trial Active' : 'Active'}
                    </span>
                  </div>
                )}

                {getNextBillingDate() && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Next billing date:</span>
                    <span className="font-medium">{getNextBillingDate()}</span>
                  </div>
                )}

                {subscription?.status === 'trialing' && (
                  <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      Your 14-day free trial has started! You won't be charged until{' '}
                      {getNextBillingDate()}.
                    </p>
                  </div>
                )}
              </div>

              {/* What's Next */}
              <div className="border-t pt-6">
                <h2 className="font-semibold mb-4">What's Next?</h2>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm">
                      Your account has been upgraded with full access to all features
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm">
                      Connect your AWS account to start discovering resources
                    </span>
                  </li>
                  <li className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                    <span className="text-sm">
                      Check your email for a receipt and getting started guide
                    </span>
                  </li>
                </ul>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Button
                  className="flex-1"
                  onClick={() => router.push('/dashboard')}
                >
                  Go to Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => router.push('/settings/billing')}
                >
                  <Receipt className="mr-2 h-4 w-4" />
                  View Billing
                </Button>
              </div>

              {/* Help Text */}
              <p className="text-sm text-muted-foreground text-center pt-4">
                Need help getting started? Check out our{' '}
                <a href="/docs" className="text-primary hover:underline">
                  documentation
                </a>{' '}
                or{' '}
                <a href="/support" className="text-primary hover:underline">
                  contact support
                </a>
                .
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
