'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { XCircle, ArrowRight, ArrowLeft } from 'lucide-react';

export default function CheckoutCancelPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full">
        <CardHeader className="text-center pb-6">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-muted p-3">
              <XCircle className="h-12 w-12 text-muted-foreground" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">Checkout Cancelled</h1>
          <p className="text-lg text-muted-foreground">
            No charges were made to your account
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Information */}
          <div className="bg-muted/50 rounded-lg p-6 space-y-4">
            <p className="text-center text-muted-foreground">
              You cancelled the checkout process. Your account remains on the free plan.
            </p>
          </div>

          {/* Benefits Reminder */}
          <div className="border-t pt-6">
            <h2 className="font-semibold mb-4 text-center">
              Still interested in upgrading?
            </h2>
            <ul className="space-y-3 max-w-md mx-auto">
              <li className="flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-primary"></div>
                </div>
                <span className="text-sm">
                  14-day free trial - no credit card required upfront
                </span>
              </li>
              <li className="flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-primary"></div>
                </div>
                <span className="text-sm">Cancel anytime, no long-term contracts</span>
              </li>
              <li className="flex items-start gap-3">
                <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <div className="h-2 w-2 rounded-full bg-primary"></div>
                </div>
                <span className="text-sm">
                  Full access to all features during your trial
                </span>
              </li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => router.push('/pricing')}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Pricing
            </Button>
            <Button className="flex-1" onClick={() => router.push('/dashboard')}>
              Go to Dashboard
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>

          {/* Help Text */}
          <div className="text-center pt-4 space-y-2">
            <p className="text-sm text-muted-foreground">
              Have questions about our plans?
            </p>
            <div className="flex justify-center gap-4 text-sm">
              <a
                href="/docs/pricing"
                className="text-primary hover:underline"
              >
                View pricing FAQ
              </a>
              <span className="text-muted-foreground">•</span>
              <a
                href="/support"
                className="text-primary hover:underline"
              >
                Contact sales
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
