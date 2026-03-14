'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Rocket,
  CheckCircle,
  ArrowRight,
  Terminal,
  Shield,
  Copy,
  Check,
  Clock,
  MessageCircle,
  Calendar,
  ExternalLink,
  HelpCircle,
  Sparkles,
  Trophy,
  Users,
  AlertCircle,
  BookOpen,
  Play,
  ChevronRight,
  BarChart3,
} from 'lucide-react';
import Link from 'next/link';

export default function GettingStartedPage() {
  const [copiedCode, setCopiedCode] = useState(false);

  // TODO: Replace with actual API calls to check completion status
  // This would integrate with your backend to check:
  // - AWS connection status
  // - Services registered count
  // - Deployments tracked
  const steps = [
    {
      step: 1,
      title: 'Create your account',
      description: 'Sign up for DevControl and create your organization.',
      completed: true,
      timeEstimate: '1 min',
      value: 'Access to full platform features',
      actionLabel: 'View Account',
      actionUrl: '/settings/account',
      helpUrl: '/docs/account-setup',
    },
    {
      step: 2,
      title: 'Connect your AWS account',
      description: 'Grant DevControl read-only access to discover your resources.',
      completed: false, // TODO: Check if AWS is connected via API
      timeEstimate: '3 min',
      value: 'Unlock cost optimization, security scanning, and resource inventory',
      actionLabel: 'Connect AWS',
      actionUrl: '/settings/integrations',
      helpUrl: '/docs/aws-integration',
    },
    {
      step: 3,
      title: 'Register your services',
      description: 'Add your services to the catalog with ownership and metadata.',
      completed: false, // TODO: Check if services exist via API
      timeEstimate: '2 min',
      value: 'Enable service health monitoring and dependency tracking',
      actionLabel: 'Add Service',
      actionUrl: '/services',
      helpUrl: '/docs/service-catalog',
    },
    {
      step: 4,
      title: 'Track deployments',
      description: 'Connect your CI/CD pipeline to track deployment frequency.',
      completed: false, // TODO: Check if deployments tracked via API
      timeEstimate: '4 min',
      value: 'Measure DORA metrics and deployment velocity',
      actionLabel: 'Setup CI/CD',
      actionUrl: '/deployments',
      helpUrl: '/docs/cicd-integration',
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const totalSteps = steps.length;
  const completionPercentage = Math.round((completedCount / totalSteps) * 100);
  const allCompleted = completedCount === totalSteps;

  const cliCode = `# Install the DevControl CLI
npm install -g @devcontrol/cli

# Login to your account
devcontrol login

# Discover AWS resources
devcontrol discover --aws

# Register a service
devcontrol service create --name my-service`;

  const handleCopyCode = () => {
    navigator.clipboard.writeText(cliCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background py-8 md:py-12">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 xl:px-12">
        {/* Hero Section */}
        <div className="text-center mb-8 md:mb-12">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/20">
            <Rocket className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Getting Started with DevControl
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-6">
            Get up and running in <strong className="text-foreground">under 10 minutes</strong>.
            Follow these steps to unlock the full power of your infrastructure platform.
          </p>

          {/* Progress Bar */}
          <div className="max-w-md mx-auto">
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="font-medium text-foreground">
                {completedCount} of {totalSteps} completed
              </span>
              <span className="text-muted-foreground">{completionPercentage}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-primary/80 transition-all duration-500"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>
        </div>

        {/* Completion Celebration */}
        {allCompleted && (
          <Card className="mb-8 bg-gradient-to-r from-green-500/10 via-primary/10 to-blue-500/10 border-primary shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Trophy className="w-6 h-6 text-amber-500" />
                Congratulations! You&apos;re All Set!
              </CardTitle>
              <CardDescription className="text-base">
                Your DevControl workspace is fully configured and ready to go. Here&apos;s what you can do next:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-3 gap-3">
                <Button asChild className="w-full">
                  <Link href="/dashboard">
                    <BarChart3 className="w-4 h-4 mr-2" />
                    View Dashboard
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/settings/team">
                    <Users className="w-4 h-4 mr-2" />
                    Invite Team
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <a href="mailto:success@devcontrol.io?subject=Schedule Onboarding Call">
                    <Calendar className="w-4 h-4 mr-2" />
                    Book Call
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Security Trust Signals */}
        <Card className="mb-8 border-green-500/30 bg-green-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-400">
              <Shield className="w-5 h-5" />
              Enterprise-Grade Security & Compliance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-500 shrink-0" />
                <span>Read-only AWS access (no write permissions)</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-500 shrink-0" />
                <span>SOC 2 Type II certified</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-500 shrink-0" />
                <span>Data encrypted at rest and in transit</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-500 shrink-0" />
                <span>GDPR & HIPAA compliant</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Onboarding Steps */}
        <div className="space-y-4 mb-8">
          {steps.map((step) => (
            <Card
              key={step.step}
              className={`transition-all ${
                step.completed
                  ? 'border-primary/50 bg-primary/5 shadow-sm'
                  : 'hover:shadow-md'
              }`}
            >
              <CardHeader>
                <div className="flex items-start gap-4">
                  {/* Step Number/Check */}
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold shrink-0 ${
                      step.completed
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {step.completed ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      step.step
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <CardTitle className="text-lg md:text-xl flex items-center gap-2 flex-wrap">
                          {step.title}
                          <Badge variant="secondary" className="text-xs">
                            <Clock className="w-3 h-3 mr-1" />
                            {step.timeEstimate}
                          </Badge>
                        </CardTitle>
                        <CardDescription className="mt-1 text-sm md:text-base">
                          {step.description}
                        </CardDescription>
                      </div>
                    </div>

                    {/* Value Proposition */}
                    <div className="flex items-start gap-2 text-sm text-primary/80 dark:text-primary/70 bg-primary/5 rounded-lg p-3 mb-4">
                      <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="font-medium">{step.value}</span>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-3">
                      {!step.completed ? (
                        <>
                          <Button asChild size="sm" className="gap-2">
                            <Link href={step.actionUrl}>
                              <Play className="w-4 h-4" />
                              {step.actionLabel}
                              <ArrowRight className="w-4 h-4" />
                            </Link>
                          </Button>
                          <Button asChild variant="ghost" size="sm" className="gap-2">
                            <Link href={step.helpUrl}>
                              <BookOpen className="w-4 h-4" />
                              View Guide
                            </Link>
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button asChild variant="outline" size="sm" className="gap-2">
                            <Link href={step.actionUrl}>
                              <ExternalLink className="w-4 h-4" />
                              Review Settings
                            </Link>
                          </Button>
                          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500 font-medium">
                            <CheckCircle className="w-4 h-4" />
                            Completed
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>

        {/* Two Column Layout */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          {/* CLI Quick Start */}
          <Card className="bg-muted/50">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base md:text-lg">
                <span className="flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-primary" />
                  Quick Start with CLI
                </span>
                <Badge variant="secondary">v2.1.0</Badge>
              </CardTitle>
              <CardDescription>
                Install and configure the DevControl CLI in seconds
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-background p-4 rounded-lg overflow-x-auto text-xs md:text-sm border">
                  <code className="text-muted-foreground">{cliCode}</code>
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleCopyCode}
                  className="absolute top-2 right-2 gap-2"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-xs">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span className="text-xs">Copy</span>
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-xs md:text-sm text-muted-foreground flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                  <span>
                    Requires Node.js 18+ and npm 9+.{' '}
                    <Link href="/docs/cli" className="text-primary hover:underline">
                      View full CLI docs
                    </Link>
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Common Issues */}
          <Card className="bg-muted/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <HelpCircle className="w-5 h-5 text-primary" />
                Common Questions
              </CardTitle>
              <CardDescription>
                Quick answers to help you get unstuck
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger className="text-sm hover:no-underline">
                    How long does AWS connection take?
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    Initial resource discovery takes 2-5 minutes depending on your
                    infrastructure size. Subsequent syncs are incremental and faster.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-2">
                  <AccordionTrigger className="text-sm hover:no-underline">
                    What AWS permissions are needed?
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    We require read-only access (Describe*, List*, Get*). No write or
                    modification permissions.{' '}
                    <Link href="/docs/aws-iam" className="text-primary hover:underline">
                      View IAM policy template
                    </Link>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-3">
                  <AccordionTrigger className="text-sm hover:no-underline">
                    Can I skip steps and come back later?
                  </AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">
                    Yes! Your progress is automatically saved. You can complete steps in
                    any order and return anytime.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <Button asChild variant="link" className="mt-2 px-0 gap-1 text-sm" size="sm">
                <Link href="/docs/faq">
                  View all FAQs
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Team Invitation Prompt */}
        {!allCompleted && (
          <Card className="mb-8 border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                Pro Tip: Collaborate with Your Team
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                DevControl works best when your whole team is involved. Invite teammates
                to collaborate on services, view metrics, and manage infrastructure together.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild size="sm" variant="outline" className="gap-2">
                  <Link href="/settings/team">
                    <Users className="w-4 h-4" />
                    Invite Team Members
                  </Link>
                </Button>
                <Button asChild size="sm" variant="ghost" className="gap-2">
                  <Link href="/docs/team-management">
                    <BookOpen className="w-4 h-4" />
                    Learn about roles
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Social Proof */}
        <div className="text-center text-sm text-muted-foreground mb-8 pb-8 border-b">
          <p className="mb-3">
            Join <strong className="text-foreground">2,500+ engineering teams</strong> already using DevControl
          </p>
          <div className="flex items-center justify-center gap-2">
            <div className="flex -space-x-2">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-8 h-8 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-background flex items-center justify-center text-xs font-semibold"
                >
                  {String.fromCharCode(65 + i)}
                </div>
              ))}
            </div>
            <span className="text-xs">
              <strong className="text-foreground">850+ teams</strong> completed setup this month
            </span>
          </div>
        </div>

        {/* Help & Support CTA */}
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="hover:shadow-md transition-shadow cursor-pointer group">
            <Link href="/docs">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 group-hover:text-primary transition-colors">
                  <BookOpen className="w-5 h-5" />
                  Browse Documentation
                  <ArrowRight className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </CardTitle>
                <CardDescription>
                  Comprehensive guides, API references, and tutorials
                </CardDescription>
              </CardHeader>
            </Link>
          </Card>

          <Card className="hover:shadow-md transition-shadow cursor-pointer group">
            <a href="mailto:support@devcontrol.io">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 group-hover:text-primary transition-colors">
                  <MessageCircle className="w-5 h-5" />
                  Contact Support
                  <ArrowRight className="w-4 h-4 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </CardTitle>
                <CardDescription>
                  Get help from our team within 24 hours
                </CardDescription>
              </CardHeader>
            </a>
          </Card>
        </div>

        {/* Floating Help Button - Mobile Only */}
        <div className="fixed bottom-6 right-6 flex flex-col gap-2 lg:hidden">
          <Button
            asChild
            size="sm"
            className="shadow-lg gap-2 rounded-full px-4"
          >
            <a href="mailto:support@devcontrol.io">
              <MessageCircle className="w-4 h-4" />
              Get Help
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
