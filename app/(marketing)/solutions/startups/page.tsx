import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Zap,
  Users,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  Shield,
  Clock,
  DollarSign,
  BarChart3,
  AlertTriangle,
  Lightbulb,
  Check,
  X,
  Server,
  Database,
  Cloud,
  GitBranch,
  Container,
  Lock,
} from 'lucide-react';
import Link from 'next/link';
import { startupQuickWins } from './data/startupQuickWins';
import { startupValueCards } from './data/startupValueCards';
import { startupFAQs } from './data/startupFAQs';

// ============================================
// STARTUP HERO SECTION
// ============================================
function StartupHero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20 lg:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-4xl mx-auto">
          {/* Badge */}
          <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">
            Built for teams of 5-50 engineers
          </Badge>

          {/* Headline */}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
            Ship Faster.{' '}
            <span className="text-primary">Save $2,400/month.</span>
            <br />
            Sleep Better.
          </h1>

          {/* Subheadline */}
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
            DevControl gives startup engineering teams complete visibility into their AWS
            infrastructure—find cost savings, catch security issues, and ship with confidence.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
              <Link href="/dashboard">
                Start Free Trial
                <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-8 h-12 text-base">
              <Link href="/pricing">
                View Pricing
              </Link>
            </Button>
          </div>

          {/* Trust indicators */}
          <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>14-day free trial</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>No credit card required</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Setup in 5 minutes</span>
            </div>
          </div>
        </div>
      </div>

      {/* Background decoration */}
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
    </section>
  );
}

// ============================================
// TRUSTED BY SECTION
// ============================================
function TrustedByLogos() {
  const trustIndicators = [
    { label: 'SOC 2 Type II Certified', icon: Shield },
    { label: 'Read-Only AWS Access', icon: Lock },
    { label: 'YC & Techstars Approved', icon: CheckCircle2 },
    { label: 'Join 500+ Startups', icon: Users },
  ];

  return (
    <section className="py-12 border-b">
      <div className="max-w-6xl mx-auto px-6">
        <p className="text-center text-sm text-muted-foreground mb-8">
          Trusted by fast-moving engineering teams
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {trustIndicators.map((item, index) => (
            <div
              key={index}
              className="flex flex-col items-center gap-2 p-4 rounded-lg bg-muted/50"
            >
              <item.icon className="w-6 h-6 text-primary" />
              <span className="text-sm font-medium text-center">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// QUICK WINS SECTION
// ============================================
function QuickWins() {
  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Results You Can Measure
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Real outcomes from startups like yours
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          {startupQuickWins.map((win, index) => (
            <Card key={index} className="text-center border-0 shadow-lg bg-card">
              <CardHeader className="pb-2">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <win.icon className="w-7 h-7 text-primary" />
                </div>
                <CardTitle className="text-4xl md:text-5xl font-bold text-primary">
                  {win.value}
                </CardTitle>
                <CardDescription className="text-base font-semibold text-foreground">
                  {win.label}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{win.description}</p>
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
function ValuePropCards() {
  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Everything You Need to Move Fast
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            DevControl replaces 5+ tools with one unified platform
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {startupValueCards.map((card, index) => (
            <Card key={index} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <card.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{card.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">
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
// STARTUP USE CASES
// ============================================
function StartupUseCases() {
  const useCases = [
    {
      problem: 'AWS bill doubled overnight',
      solution: 'Find unused resources and rightsizing opportunities in minutes',
      icon: DollarSign,
      color: 'text-green-500',
    },
    {
      problem: 'Failed SOC 2 security review',
      solution: 'Continuous security scanning with automated compliance reports',
      icon: Shield,
      color: 'text-blue-500',
    },
    {
      problem: 'Production outage, no one knows why',
      solution: 'Dependency mapping shows exactly what broke and why',
      icon: AlertTriangle,
      color: 'text-orange-500',
    },
    {
      problem: 'New hire takes weeks to onboard',
      solution: 'Visual infrastructure maps get engineers productive fast',
      icon: Users,
      color: 'text-purple-500',
    },
  ];

  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Sound Familiar?
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Problems every growing startup faces—solved
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {useCases.map((useCase, index) => (
            <Card key={index} className="overflow-hidden">
              <CardHeader className="bg-muted/50 border-b">
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg bg-background ${useCase.color}`}>
                    <useCase.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">The Problem</p>
                    <CardTitle className="text-lg">{useCase.problem}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Lightbulb className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">DevControl Solution</p>
                    <p className="font-medium">{useCase.solution}</p>
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
// PRICING SECTION (Starter Tier Focus)
// ============================================
function PricingSection() {
  const features = [
    'Up to 100 AWS resources',
    'Cost optimization recommendations',
    'Security vulnerability scanning',
    'Dependency mapping',
    'DORA metrics dashboard',
    'GitHub & Slack integrations',
    'Email support (24hr response)',
    'Community Slack access',
  ];

  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Simple, Startup-Friendly Pricing
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Start free, pay only when you&apos;re ready
          </p>
        </div>

        <Card className="relative overflow-hidden border-2 border-primary shadow-xl">
          {/* Popular badge */}
          <div className="absolute top-0 right-0">
            <Badge className="rounded-none rounded-bl-lg px-4 py-1">Most Popular</Badge>
          </div>

          <CardHeader className="text-center pt-12 pb-6">
            <CardTitle className="text-2xl mb-2">Starter Plan</CardTitle>
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-5xl font-bold">$79</span>
              <span className="text-muted-foreground">/month</span>
            </div>
            <CardDescription className="mt-2">
              Perfect for early-stage startups with 5-20 engineers
            </CardDescription>
          </CardHeader>

          <CardContent className="pb-8">
            <div className="grid sm:grid-cols-2 gap-3 mb-8">
              {features.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Check className="w-5 h-5 text-green-500 shrink-0" />
                  <span className="text-sm">{feature}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg" className="gap-2 px-8">
                <Link href="/dashboard">
                  Start Free Trial
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/pricing">See All Plans</Link>
              </Button>
            </div>

            <p className="text-center text-sm text-muted-foreground mt-4">
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
function StartupComparison() {
  const comparisons = [
    { feature: 'Setup time', devcontrol: '5 minutes', others: '2-4 weeks' },
    { feature: 'Starting price', devcontrol: '$79/mo', others: '$500+/mo' },
    { feature: 'Agent installation', devcontrol: 'None required', others: 'Required' },
    { feature: 'All-in-one platform', devcontrol: true, others: false },
    { feature: 'Startup-focused', devcontrol: true, others: false },
  ];

  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Why Startups Choose DevControl
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Built specifically for fast-moving teams, not enterprises
          </p>
        </div>

        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-4 font-semibold">Feature</th>
                  <th className="text-center p-4 font-semibold text-primary">DevControl</th>
                  <th className="text-center p-4 font-semibold text-muted-foreground">
                    Traditional Tools
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((row, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="p-4 font-medium">{row.feature}</td>
                    <td className="p-4 text-center">
                      {typeof row.devcontrol === 'boolean' ? (
                        row.devcontrol ? (
                          <Check className="w-5 h-5 text-green-500 mx-auto" />
                        ) : (
                          <X className="w-5 h-5 text-red-500 mx-auto" />
                        )
                      ) : (
                        <span className="font-semibold text-primary">{row.devcontrol}</span>
                      )}
                    </td>
                    <td className="p-4 text-center text-muted-foreground">
                      {typeof row.others === 'boolean' ? (
                        row.others ? (
                          <Check className="w-5 h-5 text-green-500 mx-auto" />
                        ) : (
                          <X className="w-5 h-5 text-red-500 mx-auto" />
                        )
                      ) : (
                        row.others
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
function IntegrationShowcase() {
  const awsServices = [
    { name: 'EC2', icon: Server },
    { name: 'RDS', icon: Database },
    { name: 'Lambda', icon: Cloud },
    { name: 'ECS', icon: Container },
    { name: 'S3', icon: Database },
    { name: 'CloudWatch', icon: BarChart3 },
  ];

  const integrations = [
    { name: 'GitHub', icon: GitBranch },
    { name: 'Slack', icon: Users },
    { name: 'PagerDuty', icon: AlertTriangle },
    { name: 'Datadog', icon: BarChart3 },
  ];

  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Works With Your Stack
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Deep AWS integration plus connections to your favorite tools
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          {/* AWS Services */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">50+ AWS Services</CardTitle>
              <CardDescription>Full visibility across your entire AWS footprint</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                {awsServices.map((service, index) => (
                  <div
                    key={index}
                    className="flex flex-col items-center gap-2 p-3 rounded-lg bg-muted/50"
                  >
                    <service.icon className="w-6 h-6 text-primary" />
                    <span className="text-sm font-medium">{service.name}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Third-party Integrations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">20+ Integrations</CardTitle>
              <CardDescription>Connect to your existing workflow tools</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                {integrations.map((integration, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                  >
                    <integration.icon className="w-5 h-5 text-primary" />
                    <span className="font-medium">{integration.name}</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-4 text-center">
                + API & Webhooks for custom integrations
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

// ============================================
// FAQ SECTION
// ============================================
function FAQSection() {
  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about DevControl for startups
          </p>
        </div>

        <Accordion type="single" collapsible className="space-y-4">
          {startupFAQs.map((faq, index) => (
            <AccordionItem
              key={index}
              value={`item-${index}`}
              className="bg-card rounded-lg border px-4"
            >
              <AccordionTrigger className="text-left hover:no-underline">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

// ============================================
// FINAL CTA SECTION
// ============================================
function FinalCTA() {
  return (
    <section className="py-20 lg:py-28 bg-gradient-to-br from-primary/10 via-background to-primary/5">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-6">
          Ready to Ship Faster and Save Money?
        </h2>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          Join hundreds of startup teams using DevControl to build better, faster, and more securely.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
          <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
            <Link href="/dashboard">
              Start Your Free Trial
              <ArrowRight className="w-5 h-5" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="gap-2 px-8 h-12 text-base">
            <Link href="/contact">
              Talk to Sales
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>14-day free trial</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-2">
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
export default function StartupsPage() {
  return (
    <div className="min-h-screen bg-background">
      <StartupHero />
      <TrustedByLogos />
      <QuickWins />
      <ValuePropCards />
      <StartupUseCases />
      <PricingSection />
      <StartupComparison />
      <IntegrationShowcase />
      <FAQSection />
      <FinalCTA />
    </div>
  );
}
