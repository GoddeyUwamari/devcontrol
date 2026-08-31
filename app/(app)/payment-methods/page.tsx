'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CreditCard, ExternalLink, AlertCircle } from 'lucide-react';
import { openCustomerPortal } from '@/lib/services/stripe.service';
import { Breadcrumb } from '@/components/navigation/breadcrumb';
import { useIsBillingAdmin } from '@/lib/hooks/use-current-role';

/**
 * Payment methods are managed entirely through the Stripe Customer Portal
 * (already implemented -- see lib/services/stripe.service.ts's
 * openCustomerPortal / POST /api/stripe/customer-portal), not a custom
 * integration here. This page previously collected a raw card number and
 * CVC directly into component state and POSTed them to /api/payment-methods,
 * a route that never existed on the backend -- meaning cardholder data was
 * being serialized into an HTTP request body for a 404 with no backend or
 * PCI scope ever built to receive it. That form, its card/CVC state, and
 * the (dead) add/delete/set-default payment-method API client have been
 * removed rather than wired up, per policy: DevControl does not process
 * card data itself; the Portal is Stripe-hosted and PCI scope stays
 * entirely on Stripe's side.
 */
export default function PaymentMethodsPage() {
  const [portalLoading, setPortalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Opening the Customer Portal is owner/admin-only server-side
  // (StripeController.requireBillingAdmin) -- hide the action for the same
  // roles rather than let them click through to a guaranteed 403.
  const canManageBilling = useIsBillingAdmin();

  const handleOpenPortal = async () => {
    setError(null);
    setPortalLoading(true);
    try {
      const result = await openCustomerPortal();
      if (result.success && result.data?.url) {
        window.location.href = result.data.url;
      } else {
        setError(result.error || 'Failed to open the billing portal');
        setPortalLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to open the billing portal');
      setPortalLoading(false);
    }
  };

  return (
    <div className="space-y-6 px-4 md:px-6 lg:px-8">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Payment Methods', current: true },
        ]}
      />

      <div>
        <h1 className="text-3xl font-bold tracking-tight">Payment Methods</h1>
        <p className="text-muted-foreground mt-2">
          Payment methods are managed securely through Stripe -- DevControl never
          collects or stores your card details.
        </p>
      </div>

      <Card>
        <CardContent className="p-12 flex flex-col items-center justify-center text-center space-y-4">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <CreditCard className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="space-y-2 max-w-md">
            <p className="font-medium text-foreground">Manage payment methods in Stripe</p>
            <p className="text-sm text-muted-foreground">
              Add, remove, or update the cards on file for this organization in Stripe&apos;s
              secure Customer Portal.
            </p>
          </div>

          {canManageBilling ? (
            <Button onClick={handleOpenPortal} disabled={portalLoading}>
              {portalLoading ? 'Loading...' : 'Manage in Stripe'}
              <ExternalLink className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Only organization owners and admins can manage payment methods.
            </p>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
