import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Server,
  Layers,
  GitBranch,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Check,
  X,
  Workflow,
  Users,
  Clock,
  FileText,
  Network,
  Compass,
} from 'lucide-react';
import Link from 'next/link';
import { platformMetrics } from './data/platformMetrics';
import { platformFeatures } from './data/platformFeatures';

// ============================================
// HERO SECTION
// ============================================
function PlatformHero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-purple-500/5 via-background to-purple-500/10 py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-sm">
            Internal Developer Platform
          </Badge>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 leading-tight">
            Build Your{' '}
            <span className="text-purple-500">Developer Platform</span>
            <br />
            Without Building From Scratch
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-6 leading-relaxed">
            DevControl gives platform teams everything they need to create golden paths,
            self-service workflows, and service catalogs—so developers can ship faster with guardrails.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-8">
            <Button asChild size="lg" className="gap-2 px-6 h-11 bg-purple-600 hover:bg-purple-700">
              <Link href="/dashboard">
                Start Building
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-6 h-11">
              <Link href="/services">
                View Demo
              </Link>
            </Button>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-purple-500" />
              <span>Service catalog included</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-purple-500" />
              <span>Auto-discovery</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-purple-500" />
              <span>No code required</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-24 -right-24 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl" />
    </section>
  );
}

// ============================================
// TRUST SECTION
// ============================================
function TrustSection() {
  const stats = [
    { value: '10x', label: 'Faster Onboarding' },
    { value: '80%', label: 'Fewer Tickets' },
    { value: '100%', label: 'Service Coverage' },
    { value: '50+', label: 'AWS Services' },
  ];

  return (
    <section className="py-8 border-b">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, index) => (
            <div key={index} className="text-center p-3">
              <div className="text-2xl font-bold text-purple-600">{stat.value}</div>
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
            Platform Engineering Outcomes
          </h2>
          <p className="text-muted-foreground">
            Measurable improvements for your engineering organization
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {platformMetrics.map((metric, index) => (
            <Card key={index} className="text-center border-0 shadow-md bg-card">
              <CardHeader className="pb-1 pt-5">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-3">
                  <metric.icon className="w-6 h-6 text-purple-600" />
                </div>
                <CardTitle className="text-4xl font-bold text-purple-600 mb-1">
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
// PLATFORM PILLARS
// ============================================
function PlatformPillarsSection() {
  const pillars = [
    {
      icon: Layers,
      title: 'Discover',
      description: 'Auto-discover all services, infrastructure, and dependencies across your AWS environment.',
    },
    {
      icon: FileText,
      title: 'Document',
      description: 'Generate living documentation, architecture diagrams, and runbooks automatically.',
    },
    {
      icon: Workflow,
      title: 'Enable',
      description: 'Create self-service workflows that let developers move fast within guardrails.',
    },
    {
      icon: Compass,
      title: 'Guide',
      description: 'Provide golden paths and standards that make the right way the easy way.',
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            The Four Pillars of Platform Engineering
          </h2>
          <p className="text-muted-foreground">
            A complete foundation for your internal developer platform
          </p>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          {pillars.map((pillar, index) => (
            <Card key={index} className="text-center hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="text-3xl font-bold text-muted-foreground/20 mb-2">
                  0{index + 1}
                </div>
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mx-auto mb-2">
                  <pillar.icon className="w-5 h-5 text-purple-600" />
                </div>
                <CardTitle className="text-lg">{pillar.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">{pillar.description}</CardDescription>
              </CardContent>
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
            Everything You Need for Your IDP
          </h2>
          <p className="text-muted-foreground">
            Purpose-built tools for platform engineering teams
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {platformFeatures.map((feature, index) => (
            <Card key={index} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-2">
                  <feature.icon className="w-5 h-5 text-purple-600" />
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
      problem: 'New developers take weeks to ship their first PR',
      solution: 'Self-service dev environments and clear service documentation cut onboarding from weeks to days',
      icon: Users,
    },
    {
      problem: 'Platform team drowning in tickets for basic requests',
      solution: 'Self-service workflows for common tasks—databases, queues, environments—with approval where needed',
      icon: Clock,
    },
    {
      problem: 'Nobody knows who owns what or how services connect',
      solution: 'Auto-discovered service catalog with owners, dependencies, and always-current architecture diagrams',
      icon: Network,
    },
    {
      problem: 'Teams reinvent the wheel for every new service',
      solution: 'Golden path templates encode best practices. New services start right, every time',
      icon: GitBranch,
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Platform Challenges, Solved
          </h2>
          <p className="text-muted-foreground">
            Common pain points for growing engineering organizations
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
                  <div className="p-2 rounded-lg bg-purple-500/10 text-purple-600">
                    <useCase.icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-0.5">DevControl Solution</p>
                    <p className="text-sm font-medium leading-snug">{useCase.solution}</p>
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
    { feature: 'Time to launch', devcontrol: 'Days', others: '6-12 months' },
    { feature: 'Engineering investment', devcontrol: 'Zero', others: '2-4 FTE' },
    { feature: 'Service discovery', devcontrol: 'Automatic', others: 'Manual entry' },
    { feature: 'Dependency mapping', devcontrol: 'Auto-generated', others: 'Custom development' },
    { feature: 'Maintenance burden', devcontrol: 'Managed by DevControl', others: 'Your team' },
    { feature: 'Integration with AWS', devcontrol: '50+ services', others: 'Build each one' },
  ];

  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            DevControl vs. Building From Scratch
          </h2>
          <p className="text-muted-foreground">
            Ship your IDP in days, not months
          </p>
        </div>

        <Card className="overflow-hidden max-w-3xl mx-auto">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-semibold text-sm">Capability</th>
                  <th className="text-center p-3 font-semibold text-sm text-purple-600">DevControl</th>
                  <th className="text-center p-3 font-semibold text-sm text-muted-foreground">DIY Platform</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((row, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="p-3 text-sm font-medium">{row.feature}</td>
                    <td className="p-3 text-center">
                      {typeof row.devcontrol === 'boolean' ? (
                        <Check className="w-4 h-4 text-purple-500 mx-auto" />
                      ) : (
                        <span className="text-sm font-semibold text-purple-600">{row.devcontrol}</span>
                      )}
                    </td>
                    <td className="p-3 text-center text-muted-foreground">
                      {typeof row.others === 'boolean' ? (
                        row.others ? (
                          <Check className="w-4 h-4 text-purple-500 mx-auto" />
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
    <section className="py-14 lg:py-20 bg-gradient-to-br from-purple-500/10 via-background to-purple-500/5">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-4">
          Ready to Build Your Developer Platform?
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
          Start with a complete service catalog and dependency map. Add self-service workflows as you grow.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
          <Button asChild size="lg" className="gap-2 px-6 h-11 bg-purple-600 hover:bg-purple-700">
            <Link href="/dashboard">
              Start Free Trial
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
            <CheckCircle2 className="w-4 h-4 text-purple-500" />
            <span>Service catalog included</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-purple-500" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-purple-500" />
            <span>14-day free trial</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================
// MAIN PAGE
// ============================================
export default function PlatformEngineeringPage() {
  return (
    <div className="min-h-screen bg-background">
      <PlatformHero />
      <TrustSection />
      <MetricsSection />
      <PlatformPillarsSection />
      <FeaturesSection />
      <UseCasesSection />
      <ComparisonSection />
      <FinalCTASection />
    </div>
  );
}
