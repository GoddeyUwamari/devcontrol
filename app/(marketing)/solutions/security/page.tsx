import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Shield,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Check,
  X,
  Eye,
  FileCheck,
  UserX,
  Network,
  KeyRound,
  Database,
} from 'lucide-react';
import Link from 'next/link';
import { securityMetrics } from './data/securityMetrics';
import { securityFeatures } from './data/securityFeatures';

// ============================================
// HERO SECTION
// ============================================
function SecurityHero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-blue-500/5 via-background to-blue-500/10 py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-4 px-4 py-1.5 text-sm">
            Cloud Security & Compliance
          </Badge>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 leading-tight">
            Secure Your Cloud.{' '}
            <span className="text-blue-500">Automate Compliance.</span>
            <br />
            Sleep at Night.
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-6 leading-relaxed">
            DevControl continuously monitors your AWS infrastructure for security misconfigurations
            and compliance violations—so you can fix issues before auditors or attackers find them.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-8">
            <Button asChild size="lg" className="gap-2 px-6 h-11 bg-blue-600 hover:bg-blue-700">
              <Link href="/dashboard">
                Start Security Scan
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-6 h-11">
              <Link href="/audit-logs">
                View Demo
              </Link>
            </Button>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-blue-500" />
              <span>200+ security checks</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-blue-500" />
              <span>Read-only access</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-blue-500" />
              <span>Results in minutes</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute -top-24 -right-24 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl" />
    </section>
  );
}

// ============================================
// TRUST SECTION
// ============================================
function TrustSection() {
  const stats = [
    { value: '200+', label: 'Security Checks' },
    { value: '6', label: 'Compliance Frameworks' },
    { value: '50+', label: 'AWS Services Covered' },
    { value: '24/7', label: 'Continuous Monitoring' },
  ];

  return (
    <section className="py-8 border-b">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stats.map((stat, index) => (
            <div key={index} className="text-center p-3">
              <div className="text-2xl font-bold text-blue-600">{stat.value}</div>
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
            Comprehensive Cloud Security
          </h2>
          <p className="text-muted-foreground">
            Enterprise-grade security monitoring without the enterprise complexity
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {securityMetrics.map((metric, index) => (
            <Card key={index} className="text-center border-0 shadow-md bg-card">
              <CardHeader className="pb-1 pt-5">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
                  <metric.icon className="w-6 h-6 text-blue-600" />
                </div>
                <CardTitle className="text-4xl font-bold text-blue-600 mb-1">
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
// COMPLIANCE FRAMEWORKS
// ============================================
function ComplianceFrameworksSection() {
  const frameworks = [
    { name: 'SOC 2 Type II', checks: '45+ controls', description: 'Trust service criteria' },
    { name: 'HIPAA', checks: '30+ controls', description: 'Healthcare data protection' },
    { name: 'PCI-DSS', checks: '40+ controls', description: 'Payment card security' },
    { name: 'GDPR', checks: '25+ controls', description: 'EU data privacy' },
    { name: 'ISO 27001', checks: '50+ controls', description: 'Information security' },
    { name: 'CIS Benchmarks', checks: '100+ checks', description: 'AWS hardening' },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Compliance Frameworks
          </h2>
          <p className="text-muted-foreground">
            Built-in support for major compliance standards
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-4xl mx-auto">
          {frameworks.map((framework, index) => (
            <Card key={index} className="text-center hover:shadow-md transition-shadow">
              <CardHeader className="pb-1 pt-4">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center mx-auto mb-2">
                  <Check className="w-4 h-4 text-blue-600" />
                </div>
                <CardTitle className="text-base">{framework.name}</CardTitle>
              </CardHeader>
              <CardContent className="pb-4">
                <Badge variant="secondary" className="mb-1 text-xs">{framework.checks}</Badge>
                <CardDescription className="text-xs">{framework.description}</CardDescription>
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
            Complete Security Toolkit
          </h2>
          <p className="text-muted-foreground">
            Everything you need to secure your AWS infrastructure
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {securityFeatures.map((feature, index) => (
            <Card key={index} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center mb-2">
                  <feature.icon className="w-5 h-5 text-blue-600" />
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
      problem: 'Public S3 buckets exposing sensitive data',
      solution: 'Automated detection of public buckets with data classification and remediation guidance',
      icon: Database,
      severity: 'Critical',
    },
    {
      problem: 'IAM users with unused access keys',
      solution: 'Identify credentials unused for 90+ days and overly permissive policies',
      icon: KeyRound,
      severity: 'High',
    },
    {
      problem: 'Security groups allowing unrestricted access',
      solution: 'Flag rules allowing 0.0.0.0/0 on sensitive ports with network topology context',
      icon: Network,
      severity: 'High',
    },
    {
      problem: 'Unencrypted data at rest',
      solution: 'Scan EBS volumes, RDS instances, and S3 buckets for missing encryption',
      icon: Lock,
      severity: 'Medium',
    },
  ];

  const severityColors: Record<string, string> = {
    Critical: 'bg-red-500/10 text-red-600',
    High: 'bg-orange-500/10 text-orange-600',
    Medium: 'bg-yellow-500/10 text-yellow-600',
  };

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            What DevControl Finds
          </h2>
          <p className="text-muted-foreground">
            Common security issues detected in AWS environments
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
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-xs text-muted-foreground">Security Issue</p>
                      <Badge variant="secondary" className={`text-xs ${severityColors[useCase.severity]}`}>
                        {useCase.severity}
                      </Badge>
                    </div>
                    <CardTitle className="text-base leading-snug">{useCase.problem}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600">
                    <useCase.icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground mb-0.5">DevControl Detection</p>
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
    { feature: 'Time to complete audit', devcontrol: 'Minutes', others: 'Weeks' },
    { feature: 'Coverage', devcontrol: '200+ automated checks', others: 'Manual checklists' },
    { feature: 'Continuous monitoring', devcontrol: true, others: false },
    { feature: 'Compliance reports', devcontrol: 'One-click generation', others: 'Manual compilation' },
    { feature: 'Remediation guidance', devcontrol: 'Step-by-step fixes', others: 'Generic advice' },
    { feature: 'Drift detection', devcontrol: true, others: false },
  ];

  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            DevControl vs. Manual Security Audits
          </h2>
          <p className="text-muted-foreground">
            Automate what used to take weeks
          </p>
        </div>

        <Card className="overflow-hidden max-w-3xl mx-auto">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-semibold text-sm">Capability</th>
                  <th className="text-center p-3 font-semibold text-sm text-blue-600">DevControl</th>
                  <th className="text-center p-3 font-semibold text-sm text-muted-foreground">Manual Audit</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((row, index) => (
                  <tr key={index} className="border-b last:border-0">
                    <td className="p-3 text-sm font-medium">{row.feature}</td>
                    <td className="p-3 text-center">
                      {typeof row.devcontrol === 'boolean' ? (
                        <Check className="w-4 h-4 text-blue-500 mx-auto" />
                      ) : (
                        <span className="text-sm font-semibold text-blue-600">{row.devcontrol}</span>
                      )}
                    </td>
                    <td className="p-3 text-center text-muted-foreground">
                      {typeof row.others === 'boolean' ? (
                        row.others ? (
                          <Check className="w-4 h-4 text-blue-500 mx-auto" />
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
    <section className="py-14 lg:py-20 bg-gradient-to-br from-blue-500/10 via-background to-blue-500/5">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground mb-4">
          Ready to Secure Your AWS Infrastructure?
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
          Run your first security scan in minutes. See exactly where your vulnerabilities are and how to fix them.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-6">
          <Button asChild size="lg" className="gap-2 px-6 h-11 bg-blue-600 hover:bg-blue-700">
            <Link href="/dashboard">
              Start Free Security Scan
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
            <CheckCircle2 className="w-4 h-4 text-blue-500" />
            <span>200+ security checks</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-blue-500" />
            <span>No credit card required</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-blue-500" />
            <span>Results in minutes</span>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================
// MAIN PAGE
// ============================================
export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-background">
      <SecurityHero />
      <TrustSection />
      <MetricsSection />
      <ComplianceFrameworksSection />
      <FeaturesSection />
      <UseCasesSection />
      <ComparisonSection />
      <FinalCTASection />
    </div>
  );
}
