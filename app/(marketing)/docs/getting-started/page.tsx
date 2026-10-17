import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * A static guide for visitors, most of whom are not signed in. It used to
 * render a progress tracker with a hard-coded "completed" first step, link
 * to app settings pages and to docs pages that do not exist, and promise a
 * reply "within 24 hours". Every link here goes to a public page.
 */
const steps = [
  {
    title: 'Create your account',
    body: 'Sign up and create your organization.',
  },
  {
    title: 'Connect your AWS account',
    body:
      'After signing in, open Connect AWS. Create an IAM role in your AWS account whose name starts with ' +
      'DevControlRole, using the trust policy DevControl shows you (it includes your external ID). Attach the ' +
      'AWS-managed ReadOnlyAccess policy, then paste the role ARN back into DevControl. No AWS access keys are needed.',
  },
  {
    title: 'Review your first findings',
    body:
      'Cost and security findings appear after the first scan. DevControl then scans your account again every 6 hours.',
  },
  {
    title: 'Optional: track deployments',
    body: 'Send GitHub deployment events to DevControl to see DORA metrics for your services.',
  },
];

const faqs = [
  {
    q: 'What AWS permissions does DevControl need?',
    a:
      'Standard onboarding attaches the AWS-managed ReadOnlyAccess policy, which grants read access across AWS ' +
      'services and no write access. Optional remediation actions need separate, explicit permission and your approval.',
  },
  {
    q: 'Can I remove access later?',
    a: 'Yes. Delete the IAM role in your AWS account and DevControl can no longer read it.',
  },
];

export default function GettingStartedPage() {
  return (
    <div className="min-h-screen bg-background py-12 md:py-16">
      <div className="mx-auto max-w-2xl px-4 sm:px-6">
        <h1 className="text-3xl font-bold text-foreground md:text-4xl">Getting started</h1>
        <p className="mt-3 text-lg text-muted-foreground">Setup takes a few minutes.</p>

        <ol className="mt-8 space-y-4">
          {steps.map((step, i) => (
            <li key={step.title}>
              <Card>
                <CardContent className="flex gap-4 pt-6">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <h2 className="font-semibold text-foreground">{step.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button asChild>
            <Link href="/register">Create your account</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>

        <h2 className="mt-12 text-xl font-bold text-foreground">Common questions</h2>
        <dl className="mt-4 space-y-4">
          {faqs.map((faq) => (
            <div key={faq.q}>
              <dt className="font-semibold text-foreground">{faq.q}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{faq.a}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-12 text-sm text-muted-foreground">
          Stuck? <Link href="/contact" className="text-primary hover:underline">Contact us</Link> or go back to the{' '}
          <Link href="/docs" className="text-primary hover:underline">documentation</Link>.
        </p>
      </div>
    </div>
  );
}
