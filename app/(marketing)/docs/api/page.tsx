import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * DevControl has no public API yet: no API keys are issued, and no endpoint
 * is documented for customer use. This page used to describe invented
 * endpoints, base URLs, SDKs, rate-limit tiers and webhook delivery; it now
 * says plainly what is and isn't available. Document an endpoint here only
 * once it ships with real authentication for customers.
 */
export default function ApiReferencePage() {
  return (
    <div className="min-h-screen bg-background py-12 md:py-16">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <h1 className="text-3xl font-bold text-foreground md:text-4xl">API</h1>

        <Card className="mt-8">
          <CardContent className="space-y-4 pt-6">
            <p className="text-base font-semibold text-foreground">A public API is not available yet.</p>
            <p className="text-muted-foreground">
              DevControl does not issue API keys today, and there are no endpoints for customer use. Everything
              DevControl does is available in the web app.
            </p>
            <p className="text-muted-foreground">
              If you need programmatic access, tell us what you want to automate. It helps us decide what to build
              first.
            </p>
            <div className="flex flex-col gap-3 pt-2 sm:flex-row">
              <Button asChild>
                <Link href="/contact">Contact us</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/docs">Back to documentation</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
