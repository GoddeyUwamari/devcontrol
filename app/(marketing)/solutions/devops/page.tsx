import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  GitBranch, ArrowRight, CheckCircle2, Shield, DollarSign,
  BarChart3, Activity, Zap, Container, Clock, Server,
  RefreshCw, AlertTriangle, Check, X,
} from 'lucide-react';
import Link from 'next/link';

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20 lg:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">
            For DevOps & Platform teams
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
            Ship More. Toil Less.{' '}
            <span className="text-primary">Own Your Pipeline.</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
            DevControl gives DevOps teams real-time visibility across deployments, infrastructure
            drift, security posture, and DORA metrics — all in one unified platform.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
              <Link href="/register">
                Start Free Trial <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-8 h-12 text-base">
              <Link href="/docs">View Docs</Link>
            </Button>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
            {['Connects in 5 minutes', 'No agents to install', 'Read-only AWS access'].map((t) => (
              <div key={t} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" /><span>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -top-24 -right-24 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
      <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
    </section>
  );
}

function Stats() {
  const stats = [
    { value: '4×', label: 'Deployment frequency increase', icon: GitBranch },
    { value: '68%', label: 'Reduction in MTTR',             icon: Clock },
    { value: '91%', label: 'Less infrastructure drift',     icon: RefreshCw },
    { value: '30min', label: 'Average onboarding time',     icon: Zap },
  ];
  return (
    <section className="py-14 border-b">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map(({ value, label, icon: Icon }) => (
            <div key={label} className="flex flex-col items-center gap-2 p-6 rounded-xl bg-muted/50 text-center">
              <Icon className="w-6 h-6 text-primary" />
              <span className="text-3xl font-bold text-primary">{value}</span>
              <span className="text-sm text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    { icon: GitBranch, title: 'Deployment pipeline visibility', desc: 'Track every deployment across GitHub Actions, CircleCI, and more. Know exactly what shipped, when, and to which environment.' },
    { icon: BarChart3, title: 'DORA metrics dashboard', desc: 'Deployment frequency, lead time for changes, MTTR, and change failure rate — calculated automatically from your real data.' },
    { icon: RefreshCw, title: 'Infrastructure drift detection', desc: 'Instant alerts when your actual infrastructure diverges from your Terraform/CDK definitions. Prevent config debt before it compounds.' },
    { icon: Shield, title: 'Security posture scoring', desc: 'Continuous CIS benchmark scanning with actionable remediation steps. Ship with security confidence on every deployment.' },
    { icon: Activity, title: 'Service health monitoring', desc: 'Dependency-aware health checks across all services. Know the blast radius of every change before you make it.' },
    { icon: Container, title: 'Container & Lambda insights', desc: 'Deep visibility into ECS, EKS, and Lambda workloads. Performance, cost, and error tracking in one place.' },
  ];
  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">The Platform Your DevOps Team Actually Wants</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Fewer dashboards. Less context-switching. More time shipping.</p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <Card key={f.title} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <f.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{f.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">{f.desc}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function UseCases() {
  const items = [
    { problem: 'Mystery outage at 2am', solution: 'Service dependency maps pinpoint the root cause in minutes — not hours of log diving', icon: AlertTriangle, color: 'text-orange-500' },
    { problem: 'Deployment slowed to a crawl', solution: 'DORA trends identify which steps are bottlenecks so you can prioritise fixes', icon: Clock, color: 'text-red-500' },
    { problem: 'Infra drift causing prod failures', solution: 'Real-time drift detection with auto-remediation suggestions before anything breaks', icon: RefreshCw, color: 'text-purple-500' },
    { problem: 'Security blocked your release', solution: 'Pre-deploy security checks surface issues in CI so security never surprises you', icon: Shield, color: 'text-purple-500' },
  ];
  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Scenarios You Know Too Well</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Common DevOps pain points — and how DevControl eliminates them</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          {items.map((item) => (
            <Card key={item.problem} className="overflow-hidden">
              <CardHeader className="bg-muted/50 border-b">
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg bg-background ${item.color}`}>
                    <item.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">The Problem</p>
                    <CardTitle className="text-lg">{item.problem}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">DevControl Solution</p>
                    <p className="font-medium">{item.solution}</p>
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

function Integrations() {
  const tools = [
    'GitHub Actions', 'CircleCI', 'GitLab CI', 'ArgoCD',
    'Terraform', 'AWS CDK', 'PagerDuty', 'Datadog',
    'Slack', 'Jira', 'OpsGenie', 'Prometheus',
  ];
  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Integrates With Your Entire Stack</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">DevControl plugs into the tools you already use — no ripping and replacing</p>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
          {tools.map((tool) => (
            <div key={tool} className="flex items-center justify-center p-4 rounded-xl bg-muted/50 text-sm font-medium text-center h-16">
              {tool}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-20 lg:py-28 bg-gradient-to-br from-primary/10 via-background to-primary/5">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-6">
          Better Pipelines Start Today
        </h2>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          Connect DevControl to your AWS account in 5 minutes. No agents. No complex setup. Just instant visibility.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
          <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
            <Link href="/register">Start Free Trial <ArrowRight className="w-5 h-5" /></Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="px-8 h-12 text-base">
            <Link href="/docs">Read the Docs</Link>
          </Button>
        </div>
        <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
          {['14-day free trial', 'No credit card required', 'Cancel anytime'].map((t) => (
            <div key={t} className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" /><span>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function DevOpsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <Stats />
      <Features />
      <UseCases />
      <Integrations />
      <CTA />
    </div>
  );
}
