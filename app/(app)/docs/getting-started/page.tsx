import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Rocket, CheckCircle, ArrowRight, Terminal } from 'lucide-react';
import Link from 'next/link';

export default function GettingStartedPage() {
  const steps = [
    {
      step: 1,
      title: 'Create your account',
      description: 'Sign up for DevControl and create your organization.',
      completed: true,
    },
    {
      step: 2,
      title: 'Connect your AWS account',
      description: 'Grant DevControl read-only access to discover your resources.',
      completed: false,
    },
    {
      step: 3,
      title: 'Register your services',
      description: 'Add your services to the catalog with ownership and metadata.',
      completed: false,
    },
    {
      step: 4,
      title: 'Track deployments',
      description: 'Connect your CI/CD pipeline to track deployment frequency.',
      completed: false,
    },
  ];

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Rocket className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            Getting Started
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Get up and running with DevControl in under 5 minutes.
            Follow these steps to set up your infrastructure catalog.
          </p>
        </div>

        <div className="space-y-4 mb-12">
          {steps.map((step) => (
            <Card key={step.step} className={step.completed ? 'border-primary/50 bg-primary/5' : ''}>
              <CardHeader className="flex flex-row items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  step.completed
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {step.completed ? <CheckCircle className="w-5 h-5" /> : step.step}
                </div>
                <div className="flex-1">
                  <CardTitle className="text-lg">{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="w-5 h-5" />
              Quick Start with CLI
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-background p-4 rounded-lg overflow-x-auto text-sm">
              <code>{`# Install the DevControl CLI
npm install -g @devcontrol/cli

# Login to your account
devcontrol login

# Discover AWS resources
devcontrol discover --aws

# Register a service
devcontrol service create --name my-service`}</code>
            </pre>
          </CardContent>
        </Card>

        <div className="text-center mt-8">
          <Button asChild size="lg" className="gap-2">
            <Link href="/dashboard">
              Go to Dashboard
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
