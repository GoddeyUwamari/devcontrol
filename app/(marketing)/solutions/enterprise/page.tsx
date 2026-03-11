import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Users,
  Shield,
  ArrowRight,
  CheckCircle2,
  Lock,
  Globe,
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
  FileCheck,
  Landmark,
  CloudCog,
  HardDrive,
} from 'lucide-react';
import Link from 'next/link';
import { enterpriseMetrics } from './data/enterpriseMetrics';
import { enterpriseValueCards } from './data/enterpriseValueCards';

// ============================================
// ENTERPRISE HERO SECTION
// ============================================
function EnterpriseHero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-sm">
            For teams of 100+ engineers
          </Badge>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 leading-tight">
            Mission-Critical{' '}
            <span className="text-primary">Infrastructure Visibility</span>
            <br />
            at Enterprise Scale
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-6 leading-relaxed">
            DevControl delivers the security, compliance, and scalability that Fortune 500
            engineering organizations demand—with deployment options that fit your requirements.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-8">
            <Button asChild size="lg" className="gap-2 px-6 h-11">
              <Link href="/contact">
                Contact Sales
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-6 h-11">
              <Link href="/dashboard">
                Request Demo
              </Link>
            </Button>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Custom deployment options</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Dedicated success manager</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span>Enterprise SLAs</span>
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
    { label: 'Fortune 500 Customers', icon: Landmark },
    { label: 'SOC 2 Type II Certified', icon: Shield },
    { label: 'FedRAMP Authorized', icon: FileCheck },
    { label: '99.99% Uptime SLA', icon: CheckCircle2 },
  ];

  return (
    <section className="py-8 border-b">
      <div className="max-w-7xl mx-auto px-4">
        <p className="text-center text-sm text-muted-foreground mb-5">
          Trusted by enterprise engineering organizations worldwide
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
// ENTERPRISE METRICS SECTION
// ============================================
function MetricsSection() {
  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Built for Enterprise Scale
          </h2>
          <p className="text-muted-foreground">
            No limits, no compromises—infrastructure visibility that grows with you
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {enterpriseMetrics.map((metric, index) => (
            <Card key={index} className="text-center border-0 shadow-md bg-card">
              <CardHeader className="pb-1 pt-5">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <metric.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-4xl font-bold text-primary mb-1">
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
// VALUE PROPOSITION CARDS
// ============================================
function ValuePropsSection() {
  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Enterprise-Grade Capabilities
          </h2>
          <p className="text-muted-foreground">
            Security, compliance, and governance features your organization requires
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {enterpriseValueCards.map((card, index) => (
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
// ENTERPRISE USE CASES
// ============================================
function UseCasesSection() {
  const useCases = [
    {
      problem: 'Sprawling multi-account AWS environments',
      solution: 'Unified visibility across hundreds of accounts and regions with centralized governance',
      icon: Globe,
      color: 'text-blue-500',
    },
    {
      problem: 'Complex compliance requirements across teams',
      solution: 'Automated compliance scanning with customizable frameworks and audit-ready reporting',
      icon: FileCheck,
      color: 'text-green-500',
    },
    {
      problem: 'Security policies enforced inconsistently',
      solution: 'Centralized policy definition with automated enforcement and real-time violation alerts',
      icon: Shield,
      color: 'text-purple-500',
    },
    {
      problem: 'Lack of visibility into infrastructure changes',
      solution: 'Complete audit trail with change attribution, approval workflows, and blast radius analysis',
      icon: Network,
      color: 'text-orange-500',
    },
  ];

  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Enterprise Challenges, Solved
          </h2>
          <p className="text-muted-foreground">
            Common pain points at scale—addressed comprehensively
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
                    <p className="text-xs text-muted-foreground mb-0.5">The Challenge</p>
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
// DEPLOYMENT OPTIONS
// ============================================
function DeploymentSection() {
  const deploymentOptions = [
    {
      icon: Cloud,
      title: 'SaaS',
      description: 'Fully managed cloud deployment with enterprise security controls and data isolation.',
      features: ['Automatic updates', 'No infrastructure to manage', 'SOC 2 compliant hosting'],
    },
    {
      icon: CloudCog,
      title: 'Private Cloud',
      description: 'Dedicated instance deployed in your own VPC for maximum control and data residency.',
      features: ['Your AWS account', 'Data never leaves your VPC', 'Custom networking'],
    },
    {
      icon: HardDrive,
      title: 'On-Premise',
      description: 'Self-hosted deployment for organizations with strict air-gap or compliance requirements.',
      features: ['Complete data control', 'Air-gap compatible', 'Custom integrations'],
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Flexible Deployment Options
          </h2>
          <p className="text-muted-foreground">
            Deploy DevControl where it makes sense for your organization
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {deploymentOptions.map((option, index) => (
            <Card key={index} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                  <option.icon className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{option.title}</CardTitle>
                <CardDescription className="text-sm">
                  {option.description}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {option.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// SECURITY & COMPLIANCE
// ============================================
function SecuritySection() {
  const certifications = [
    { name: 'SOC 2 Type II', description: 'Annual audit by independent third party' },
    { name: 'HIPAA', description: 'BAA available for healthcare organizations' },
    { name: 'PCI-DSS', description: 'Level 1 service provider compliance' },
    { name: 'ISO 27001', description: 'Information security management' },
    { name: 'FedRAMP', description: 'Authorized for federal government use' },
    { name: 'GDPR', description: 'EU data protection compliance' },
  ];

  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Security & Compliance
          </h2>
          <p className="text-muted-foreground">
            Certifications and standards your security team requires
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-4xl mx-auto">
          {certifications.map((cert, index) => (
            <Card key={index} className="text-center">
              <CardHeader className="pb-1 pt-4">
                <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center mx-auto mb-2">
                  <Check className="w-4 h-4 text-green-500" />
                </div>
                <CardTitle className="text-base">{cert.name}</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <CardDescription className="text-xs">{cert.description}</CardDescription>
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
    { feature: 'Time to value', devcontrol: 'Days', others: '6-12 months' },
    { feature: 'Total cost of ownership', devcontrol: 'Predictable subscription', others: '$500K+ build cost' },
    { feature: 'Maintenance burden', devcontrol: 'Zero', others: '2-4 FTE ongoing' },
    { feature: 'Feature updates', devcontrol: 'Continuous', others: 'Manual development' },
    { feature: 'Multi-cloud support', devcontrol: true, others: 'Custom development' },
    { feature: 'Enterprise support', devcontrol: '24/7 with SLA', others: 'Internal team' },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Build vs. Buy
          </h2>
          <p className="text-muted-foreground">
            Why leading enterprises choose DevControl over building in-house
          </p>
        </div>

        <Card className="overflow-hidden max-w-3xl mx-auto">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-semibold text-sm">Consideration</th>
                  <th className="text-center p-3 font-semibold text-sm text-primary">DevControl</th>
                  <th className="text-center p-3 font-semibold text-sm text-muted-foreground">Build In-House</th>
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
// FINAL CTA SECTION
// ============================================
function FinalCTASection() {
  return (
    <section className="py-14 lg:py-20 bg-gradient-to-br from-primary/10 via-background to-primary/5">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-4">
          Ready for Enterprise-Grade Infrastructure Visibility?
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
          Join Fortune 500 engineering organizations using DevControl to secure, govern, and optimize their AWS infrastructure.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
          <Button asChild size="lg" className="gap-2 px-6 h-11">
            <Link href="/contact">
              Contact Sales
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="gap-2 px-6 h-11">
            <Link href="/dashboard">
              Request Demo
            </Link>
          </Button>
        </div>

        <div className="flex flex-wrap justify-center items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>Custom pricing</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>Dedicated onboarding</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>Enterprise SLAs</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================
// MAIN PAGE
// ============================================
export default function EnterprisePage() {
  return (
    <div className="min-h-screen bg-background">
      <EnterpriseHero />
      <TrustedBySection />
      <MetricsSection />
      <ValuePropsSection />
      <UseCasesSection />
      <DeploymentSection />
      <SecuritySection />
      <ComparisonSection />
      <FinalCTASection />
    </div>
  );
}
