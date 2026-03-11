import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Layers, ArrowRight, CheckCircle2, Shield, DollarSign,
  BarChart3, Activity, Zap, Server, Users, GitBranch,
  RefreshCw, Search, Lock,
} from 'lucide-react';
import Link from 'next/link';

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20 lg:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">
            For Internal Developer Platform teams
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
            Build Golden Paths.{' '}
            <span className="text-primary">Not Ticket Queues.</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
            DevControl gives platform engineering teams the data layer they need to build great
            internal developer platforms — with infrastructure visibility, self-service guardrails,
            and DORA metrics out of the box.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
              <Link href="/register">
                Start Free Trial <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-8 h-12 text-base">
              <Link href="/docs/api">View API Reference</Link>
            </Button>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
            {['Full REST API & webhooks', 'Terraform provider available', 'SSO & SCIM supported'].map((t) => (
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

function PlatformCapabilities() {
  const capabilities = [
    {
      icon: Search,
      title: 'Resource catalogue',
      desc: 'Auto-discovered, auto-tagged inventory of every cloud resource across all accounts and regions. Always up to date.',
    },
    {
      icon: Shield,
      title: 'Policy as code',
      desc: 'Define guardrails in code. DevControl enforces them continuously and alerts on any drift — before it becomes a prod incident.',
    },
    {
      icon: Layers,
      title: 'Self-service templates',
      desc: 'Give developers pre-approved infrastructure templates. They provision what they need, within the guardrails you define.',
    },
    {
      icon: BarChart3,
      title: 'Platform engineering metrics',
      desc: 'Measure the health of your platform: onboarding time, self-service adoption rate, paved road coverage, and more.',
    },
    {
      icon: GitBranch,
      title: 'DORA for the whole org',
      desc: 'Aggregate DORA metrics across all teams and services. Identify which teams need platform investment most.',
    },
    {
      icon: RefreshCw,
      title: 'Dependency graph API',
      desc: 'Expose service and infrastructure relationships via API. Build your own IDP portals on top of DevControl\'s data.',
    },
    {
      icon: Lock,
      title: 'RBAC & audit logs',
      desc: 'Fine-grained role-based access control with a complete, tamper-proof audit trail of every action.',
    },
    {
      icon: Activity,
      title: 'Reliability scoring',
      desc: 'Per-service reliability scores based on uptime, error rates, and deployment stability. Drive platform quality with data.',
    },
    {
      icon: Users,
      title: 'Team ownership mapping',
      desc: 'Define which team owns which service and infrastructure. Route alerts and cost reports to the right people automatically.',
    },
  ];
  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Your Platform Data Layer</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            DevControl is the data layer under your IDP. Use our UI directly or build your own portal on top of our API.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {capabilities.map((c) => (
            <Card key={c.title} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                  <c.icon className="w-6 h-6 text-primary" />
                </div>
                <CardTitle className="text-xl">{c.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">{c.desc}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

function IDPIntegration() {
  const portals = ['Backstage', 'Port', 'Cortex', 'OpsLevel', 'Custom portal'];
  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <Badge variant="secondary" className="mb-4">IDP Integration</Badge>
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
              Works With Your IDP of Choice
            </h2>
            <p className="text-lg text-muted-foreground mb-6 leading-relaxed">
              Already building on Backstage, Port, or a custom portal? DevControl exposes its full
              data set via REST API and webhooks. Pipe infrastructure data, health scores, cost
              breakdowns, and DORA metrics directly into your existing developer portal.
            </p>
            <ul className="space-y-3">
              {[
                'REST API with OpenAPI spec',
                'Webhooks for real-time events',
                'Terraform provider for GitOps workflows',
                'CLI for scripting and automation',
                'Native Backstage plugin (coming soon)',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Compatible with</p>
            <div className="grid grid-cols-2 gap-4">
              {portals.map((p) => (
                <div key={p} className="flex items-center justify-center p-4 rounded-xl bg-background border text-sm font-medium text-center h-14">
                  {p}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metrics() {
  const items = [
    { value: '85%', label: 'Reduction in infra tickets', icon: Zap },
    { value: '10×', label: 'Faster resource provisioning', icon: Server },
    { value: '100%', label: 'Policy compliance coverage', icon: Shield },
    { value: '60%', label: 'Improvement in developer NPS', icon: Users },
  ];
  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Platform Engineering Outcomes</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Measured results from platform teams using DevControl</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {items.map(({ value, label, icon: Icon }) => (
            <Card key={label} className="text-center p-6">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Icon className="w-6 h-6 text-primary" />
              </div>
              <div className="text-4xl font-bold text-primary mb-2">{value}</div>
              <p className="text-sm text-muted-foreground">{label}</p>
            </Card>
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
          Build the Platform Your Developers Deserve
        </h2>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          Give your engineering teams the self-service infrastructure experience they expect — backed by the governance your org requires.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
          <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
            <Link href="/register">Start Free Trial <ArrowRight className="w-5 h-5" /></Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="px-8 h-12 text-base">
            <Link href="/docs/api">Explore the API</Link>
          </Button>
        </div>
        <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
          {['14-day free trial', 'Full API access included', 'Dedicated onboarding support'].map((t) => (
            <div key={t} className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" /><span>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function PlatformEngineersPage() {
  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <PlatformCapabilities />
      <IDPIntegration />
      <Metrics />
      <CTA />
    </div>
  );
}
