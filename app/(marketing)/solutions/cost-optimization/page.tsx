import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DollarSign,
  TrendingDown,
  ArrowRight,
  CheckCircle2,
  Search,
  PieChart,
  Lightbulb,
  Check,
  X,
  Zap,
  BarChart3,
  AlertTriangle,
  Server,
  Database,
  HardDrive,
} from 'lucide-react';
import Link from 'next/link';
import { costMetrics } from './data/costMetrics';
import { costFeatures } from './data/costFeatures';

// ============================================
// HERO SECTION
// ============================================
function CostHero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-green-500/5 via-background to-green-500/10 py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-sm">
            FinOps & Cloud Cost Management
          </Badge>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 leading-tight">
            Cut Your AWS Bill by{' '}
            <span className="text-green-500">30%</span>
            <br />
            Without Sacrificing Performance
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-6 leading-relaxed">
            DevControl analyzes your AWS infrastructure to find unused resources, rightsizing
            opportunities, and Reserved Instance savings—with actionable recommendations you can implement today.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-8">
            <Button asChild size="lg" className="gap-2 px-6 h-11 bg-green-600 hover:bg-green-700">
              <Link href="/dashboard">
                See Your Savings
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-6 h-11">
              <Link href="/infrastructure/recommendations">
                View Demo
              </Link>
            </Button>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Free savings analysis</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Read-only access</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-24 -right-24 w-96 h-96 bg-green-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-green-500/5 rounded-full blur-3xl" />
    </section>
  );
}

// ============================================
// TRUST SECTION
// ============================================
function TrustSection() {
  const stats = [
    { value: '$2.4M+', label: 'Savings Identified' },
    { value: '500+', label: 'Companies Optimized' },
    { value: '1M+', label: 'Resources Analyzed' },
    { value: '30%', label: 'Avg Cost Reduction' },
  ];

  return (
    <section className="py-8 border-b">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, index) => (
            <div key={index} className="text-center p-3">
              <div className="text-2xl font-bold text-green-600">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// METRICS SECTION
// ============================================
function MetricsSection() {
  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Real Results, Real Savings
          </h2>
          <p className="text-muted-foreground">
            Join hundreds of teams who have reduced their cloud spend
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {costMetrics.map((metric, index) => (
            <Card key={index} className="text-center border-0 shadow-md bg-card">
              <CardHeader className="pb-1 pt-5">
                <div className="w-12 h-12 rounded-xl bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                  <metric.icon className="w-6 h-6 text-green-600" />
                </div>
                <CardTitle className="text-4xl font-bold text-green-600 mb-1">
                  {metric.value}
                </CardTitle>
                <CardDescription className="text-base font-semibold text-foreground">
                  {metric.label}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-5">
                <p className="text-sm text-muted-foreground leading-relaxed">{metric.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// HOW IT WORKS
// ============================================
function HowItWorksSection() {
  const steps = [
    {
      step: '01',
      title: 'Connect',
      description: 'Link your AWS account with a read-only IAM role. Takes 5 minutes.',
      icon: Zap,
    },
    {
      step: '02',
      title: 'Analyze',
      description: 'We scan your infrastructure and analyze usage patterns across all resources.',
      icon: Search,
    },
    {
      step: '03',
      title: 'Recommend',
      description: 'Get prioritized recommendations ranked by potential savings and effort.',
      icon: Lightbulb,
    },
    {
      step: '04',
      title: 'Save',
      description: 'Implement recommendations and track your savings over time.',
      icon: DollarSign,
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            How It Works
          </h2>
          <p className="text-muted-foreground">
            From setup to savings in four simple steps
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          {steps.map((step, index) => (
            <Card key={index} className="relative text-center">
              <CardHeader className="pb-2">
                <div className="text-4xl font-bold text-muted-foreground/20 mb-2">
                  {step.step}
                </div>
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center mx-auto mb-2">
                  <step.icon className="w-5 h-5 text-green-600" />
                </div>
                <CardTitle className="text-lg">{step.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">{step.description}</CardDescription>
              </CardContent>
              {index < steps.length - 1 && (
                <div className="hidden md:block absolute top-1/2 -right-2 transform -translate-y-1/2">
                  <ArrowRight className="w-4 h-4 text-muted-foreground/30" />
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// FEATURES SECTION
// ============================================
function FeaturesSection() {
  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Complete Cost Optimization Toolkit
          </h2>
          <p className="text-muted-foreground">
            Everything you need to find and eliminate cloud waste
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {costFeatures.map((feature, index) => (
            <Card key={index} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center mb-2">
                  <feature.icon className="w-5 h-5 text-green-600" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// USE CASES
// ============================================
function UseCasesSection() {
  const useCases = [
    {
      problem: 'Development instances running 24/7',
      solution: 'Automated scheduling recommendations save 65% on non-production environments',
      savings: '$8,400/mo',
      icon: Server,
    },
    {
      problem: 'Oversized production instances',
      solution: 'Rightsizing analysis identified instances using less than 10% of capacity',
      savings: '$12,000/mo',
      icon: TrendingDown,
    },
    {
      problem: 'Orphaned EBS volumes and snapshots',
      solution: 'Found 2TB of unattached storage and 500+ obsolete snapshots',
      savings: '$3,200/mo',
      icon: HardDrive,
    },
    {
      problem: 'Missing Reserved Instance coverage',
      solution: 'RI recommendations for stable workloads with 1-year commitment',
      savings: '$15,000/mo',
      icon: Database,
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Where Teams Find Savings
          </h2>
          <p className="text-muted-foreground">
            Real examples from DevControl customers
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {useCases.map((useCase, index) => (
            <Card key={index} className="overflow-hidden">
              <CardHeader className="bg-muted/50 border-b py-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-red-500/10 text-red-500">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-0.5">The Problem</p>
                    <CardTitle className="text-base leading-snug">{useCase.problem}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10 text-green-600">
                    <useCase.icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-0.5">DevControl Found</p>
                    <p className="text-sm font-medium leading-snug">{useCase.solution}</p>
                    <Badge variant="secondary" className="mt-2 bg-green-500/10 text-green-600">
                      Saved {useCase.savings}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// COMPARISON TABLE
// ============================================
function ComparisonSection() {
  const comparisons = [
    { feature: 'Time to find savings', devcontrol: '5 minutes', others: 'Days/weeks' },
    { feature: 'Coverage', devcontrol: '50+ AWS services', others: 'Manual spreadsheets' },
    { feature: 'Recommendations', devcontrol: 'Prioritized & actionable', others: 'Raw data only' },
    { feature: 'Continuous monitoring', devcontrol: true, others: false },
    { feature: 'Cost allocation', devcontrol: 'Automatic tagging', others: 'Manual effort' },
    { feature: 'Anomaly detection', devcontrol: true, others: false },
  ];

  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            DevControl vs. Manual Cost Management
          </h2>
          <p className="text-muted-foreground">
            Stop spending hours in the AWS Cost Explorer
          </p>
        </div>

        <Card className="overflow-hidden max-w-3xl mx-auto">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-semibold text-sm">Capability</th>
                  <th className="text-center p-3 font-semibold text-sm text-green-600">DevControl</th>
                  <th className="text-center p-3 font-semibold text-sm text-muted-foreground">Manual Process</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((row, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="p-3 text-sm font-medium">{row.feature}</td>
                    <td className="p-3 text-center">
                      {typeof row.devcontrol === 'boolean' ? (
                        <Check className="w-4 h-4 text-green-500 mx-auto" />
                      ) : (
                        <span className="text-sm font-semibold text-green-600">{row.devcontrol}</span>
                      )}
                    </td>
                    <td className="p-3 text-center text-muted-foreground">
                      {typeof row.others === 'boolean' ? (
                        row.others ? (
                          <Check className="w-4 h-4 text-green-500 mx-auto" />
                        ) : (
                          <X className="w-4 h-4 text-red-500 mx-auto" />
                        )
                      ) : (
                        <span className="text-sm">{row.others}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </section>
  );
}

// ============================================
// FINAL CTA
// ============================================
function FinalCTASection() {
  return (
    <section className="py-14 lg:py-20 bg-gradient-to-br from-green-500/10 via-background to-green-500/5">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-4">
          Ready to See How Much You Can Save?
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
          Connect your AWS account and get your personalized savings report in minutes. No commitment required.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
          <Button asChild size="lg" className="gap-2 px-6 h-11 bg-green-600 hover:bg-green-700">
            <Link href="/dashboard">
              Get Your Free Analysis
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="gap-2 px-6 h-11">
            <Link href="/pricing">
              View Pricing
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>Free savings report</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>5-minute setup</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================
// MAIN PAGE
// ============================================
export default function CostOptimizationPage() {
  return (
    <div className="min-h-screen bg-background">
      <CostHero />
      <TrustSection />
      <MetricsSection />
      <HowItWorksSection />
      <FeaturesSection />
      <UseCasesSection />
      <ComparisonSection />
      <FinalCTASection />
    </div>
  );
}
