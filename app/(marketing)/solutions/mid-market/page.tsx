import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  Shield,
  ArrowRight,
  CheckCircle2,
  Lock,
  DollarSign,
  AlertTriangle,
  Lightbulb,
  Check,
  X,
  Server,
  Database,
  Cloud,
  GitBranch,
  Container,
  BarChart3,
  Gauge,
  Network,
} from 'lucide-react';
import Link from 'next/link';
import { midMarketQuickWins } from './data/midMarketQuickWins';
import { midMarketValueCards } from './data/midMarketValueCards';

// ============================================
// MID-MARKET HERO SECTION
// ============================================
function MidMarketHero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-sm">
            Built for teams of 20-100 engineers
          </Badge>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 leading-tight">
            Scale with Confidence.{' '}
            <span className="text-primary">Cut Costs 35%.</span>
            <br />
            Stay Compliant.
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-6 leading-relaxed">
            DevControl gives growing engineering organizations complete visibility
            into their AWS infrastructure—without enterprise complexity or startup limitations.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-8">
            <Button asChild size="lg" className="gap-2 px-6 h-11">
              <Link href="/dashboard">
                Start Free Trial
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-6 h-11">
              <Link href="/contact">
                Talk to Sales
              </Link>
            </Button>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>14-day free trial</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Setup in 15 minutes</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
    </section>
  );
}

// ============================================
// TRUSTED BY SECTION
// ============================================
function TrustedBySection() {
  const trustIndicators = [
    { label: 'SOC 2 Type II Certified', icon: Shield },
    { label: 'Read-Only AWS Access', icon: Lock },
    { label: 'HIPAA & GDPR Ready', icon: CheckCircle2 },
    { label: '200+ Mid-Market Teams', icon: Users },
  ];

  return (
    <section className="py-8 border-b">
      <div className="max-w-7xl mx-auto px-4">
        <p className="text-center text-sm text-muted-foreground mb-5">
          Trusted by growing engineering organizations
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {trustIndicators.map((item, index) => (
            <div
              key={index}
              className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/50"
            >
              <item.icon className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-center">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// QUICK WINS / METRICS SECTION
// ============================================
function QuickWinsSection() {
  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Results That Matter
          </h2>
          <p className="text-muted-foreground">
            Measurable outcomes from mid-market teams like yours
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {midMarketQuickWins.map((win, index) => (
            <Card key={index} className="text-center border-0 shadow-md bg-card">
              <CardHeader className="pb-1 pt-5">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <win.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-4xl font-bold text-primary mb-1">
                  {win.value}
                </CardTitle>
                <CardDescription className="text-base font-semibold text-foreground">
                  {win.label}
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-5">
                <p className="text-sm text-muted-foreground leading-relaxed">{win.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// VALUE PROPOSITION CARDS
// ============================================
function ValuePropsSection() {
  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Built for Growing Organizations
          </h2>
          <p className="text-muted-foreground">
            Everything you need to scale without the chaos
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {midMarketValueCards.map((card, index) => (
            <Card key={index} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <card.icon className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{card.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm leading-relaxed">
                  {card.description}
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
// MID-MARKET USE CASES
// ============================================
function UseCasesSection() {
  const useCases = [
    {
      problem: 'Teams stepping on each other\'s infrastructure',
      solution: 'Clear ownership with RBAC ensures teams only see and manage what they own',
      icon: Users,
      color: 'text-purple-500',
    },
    {
      problem: 'Cloud costs growing faster than revenue',
      solution: 'Cost attribution by team and project with automated rightsizing recommendations',
      icon: DollarSign,
      color: 'text-green-500',
    },
    {
      problem: 'Failed compliance audit surprises',
      solution: 'Continuous compliance monitoring with real-time violation alerts',
      icon: Shield,
      color: 'text-blue-500',
    },
    {
      problem: 'No one knows what depends on what',
      solution: 'Auto-discovered dependency maps show exactly how services connect',
      icon: Network,
      color: 'text-orange-500',
    },
  ];

  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Growing Pains? We&apos;ve Got Solutions
          </h2>
          <p className="text-muted-foreground">
            Common mid-market challenges—solved
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {useCases.map((useCase, index) => (
            <Card key={index} className="overflow-hidden">
              <CardHeader className="bg-muted/50 border-b py-4">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg bg-background ${useCase.color}`}>
                    <useCase.icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">The Problem</p>
                    <CardTitle className="text-base leading-snug">{useCase.problem}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Lightbulb className="w-4 h-4" />
                  </div>
                  <div>
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
// PRICING SECTION (Growth Tier Focus)
// ============================================
function PricingSection() {
  const features = [
    'Up to 500 AWS resources',
    'Unlimited team members',
    'Multi-team management',
    'Role-based access control',
    'Cost attribution & budgets',
    'SOC 2, HIPAA, GDPR scanning',
    'SAML SSO integration',
    'Audit logs & reporting',
    'DORA metrics dashboard',
    'Priority support (4hr SLA)',
    'Slack & PagerDuty integration',
    'API & webhook access',
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Transparent, Predictable Pricing
          </h2>
          <p className="text-muted-foreground">
            Pay for resources, not seats—scale without surprises
          </p>
        </div>

        <Card className="relative overflow-hidden border-2 border-primary shadow-lg max-w-3xl mx-auto">
          <div className="absolute top-0 right-0">
            <Badge className="rounded-none rounded-bl-lg px-3 py-1">Recommended</Badge>
          </div>

          <CardHeader className="text-center pt-8 pb-4">
            <CardTitle className="text-xl mb-2">Growth Plan</CardTitle>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl md:text-5xl font-bold">$299</span>
              <span className="text-lg text-muted-foreground">/month</span>
            </div>
            <CardDescription className="mt-2">
              Perfect for mid-market teams with 20-100 engineers
            </CardDescription>
          </CardHeader>

          <CardContent className="pb-8">
            <div className="grid sm:grid-cols-2 gap-2 mb-6">
              {features.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-green-500 shrink-0" />
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="gap-2 px-6">
                <Link href="/dashboard">
                  Start Free Trial
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/pricing">Compare All Plans</Link>
              </Button>
            </div>

            <p className="text-center text-xs text-muted-foreground mt-4">
              14-day free trial • No credit card required • Cancel anytime
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

// ============================================
// COMPARISON TABLE
// ============================================
function ComparisonSection() {
  const comparisons = [
    { feature: 'Target audience', devcontrol: 'Mid-market focus', others: 'Enterprise-first' },
    { feature: 'Setup time', devcontrol: '15 minutes', others: '2-6 weeks' },
    { feature: 'Pricing model', devcontrol: '$299/mo flat', others: '$1,000+/mo' },
    { feature: 'Agent installation', devcontrol: 'None required', others: 'Required' },
    { feature: 'Multi-team RBAC', devcontrol: true, others: 'Enterprise only' },
    { feature: 'Compliance automation', devcontrol: true, others: 'Add-on cost' },
  ];

  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            The Right Fit for Growing Teams
          </h2>
          <p className="text-muted-foreground">
            More capable than startup tools, simpler than enterprise platforms
          </p>
        </div>

        <Card className="overflow-hidden max-w-3xl mx-auto">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-semibold text-sm">Feature</th>
                  <th className="text-center p-3 font-semibold text-sm text-primary">DevControl</th>
                  <th className="text-center p-3 font-semibold text-sm text-muted-foreground">Enterprise Tools</th>
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
                        <span className="text-sm font-semibold text-primary">{row.devcontrol}</span>
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
// INTEGRATION SHOWCASE
// ============================================
function IntegrationSection() {
  const awsServices = [
    { name: 'EC2', icon: Server },
    { name: 'RDS', icon: Database },
    { name: 'Lambda', icon: Cloud },
    { name: 'ECS/EKS', icon: Container },
    { name: 'S3', icon: Database },
    { name: 'CloudWatch', icon: Gauge },
  ];

  const integrations = [
    { name: 'GitHub / GitLab', icon: GitBranch },
    { name: 'Slack', icon: Users },
    { name: 'PagerDuty', icon: AlertTriangle },
    { name: 'Jira', icon: BarChart3 },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Integrates With Your Stack
          </h2>
          <p className="text-muted-foreground">
            Deep AWS visibility plus seamless connections to your workflow tools
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 max-w-4xl mx-auto">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">50+ AWS Services</CardTitle>
              <CardDescription>Complete visibility across your AWS footprint</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                {awsServices.map((service, index) => (
                  <div
                    key={index}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-muted/50"
                  >
                    <service.icon className="w-5 h-5 text-primary" />
                    <span className="text-xs font-medium">{service.name}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3 text-center">
                + VPC, IAM, Route53, CloudFront, and more
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">20+ Integrations</CardTitle>
              <CardDescription>Connect to your existing workflow tools</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2">
                {integrations.map((integration, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 rounded-lg bg-muted/50"
                  >
                    <integration.icon className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium">{integration.name}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3 text-center">
                + Okta SSO, Azure AD, Datadog, and REST API
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

// ============================================
// FINAL CTA SECTION
// ============================================
function FinalCTASection() {
  return (
    <section className="py-14 lg:py-20 bg-gradient-to-br from-primary/10 via-background to-primary/5">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-4">
          Ready to Scale Your Engineering Organization?
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
          Join 200+ mid-market teams using DevControl to grow faster, stay compliant, and control costs.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
          <Button asChild size="lg" className="gap-2 px-6 h-11">
            <Link href="/dashboard">
              Start Your Free Trial
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="gap-2 px-6 h-11">
            <Link href="/contact">
              Schedule a Demo
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>14-day free trial</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>Cancel anytime</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================
// MAIN PAGE
// ============================================
export default function MidMarketPage() {
  return (
    <div className="min-h-screen bg-background">
      <MidMarketHero />
      <TrustedBySection />
      <QuickWinsSection />
      <ValuePropsSection />
      <UseCasesSection />
      <PricingSection />
      <ComparisonSection />
      <IntegrationSection />
      <FinalCTASection />
    </div>
  );
}
