import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  TrendingUp, ArrowRight, CheckCircle2, Shield, DollarSign,
  BarChart3, Users, Zap, GitBranch, Activity, AlertTriangle,
  Check, X, Clock, Server,
} from 'lucide-react';
import Link from 'next/link';

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20 lg:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">
            Built for Series A–C engineering teams
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
            Scale Your Infrastructure{' '}
            <span className="text-primary">Without Scaling Your Problems.</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
            DevControl gives scale-up engineering teams complete platform visibility — reduce cloud
            waste, enforce security standards, and ship reliably as headcount doubles.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
              <Link href="/register">
                Start Free Trial <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="gap-2 px-8 h-12 text-base">
              <Link href="/pricing">View Pricing</Link>
            </Button>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
            {['14-day free trial', 'No credit card required', 'Setup in under 10 minutes'].map((t) => (
              <div key={t} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>{t}</span>
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
    { value: '42%', label: 'Average cloud cost reduction', icon: DollarSign },
    { value: '3×', label: 'Faster incident resolution',    icon: Activity },
    { value: '80%', label: 'Less time on infra toil',       icon: Clock },
    { value: '500+', label: 'Scale-up teams onboarded',    icon: Users },
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

function Challenges() {
  const items = [
    {
      problem: 'Cloud bill growing faster than revenue',
      solution: 'AI-powered rightsizing and waste detection across all AWS accounts',
      icon: DollarSign, color: 'text-green-500',
    },
    {
      problem: 'New engineers can\'t understand the infra',
      solution: 'Visual dependency maps and auto-generated architecture docs',
      icon: Users, color: 'text-blue-500',
    },
    {
      problem: 'Security reviews blocking every release',
      solution: 'Continuous compliance scanning with one-click remediation',
      icon: Shield, color: 'text-purple-500',
    },
    {
      problem: 'On-call rota burning out your team',
      solution: 'DORA metrics and anomaly detection to prevent incidents before they happen',
      icon: AlertTriangle, color: 'text-orange-500',
    },
  ];
  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Scale-Up Growing Pains — Solved</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">The infrastructure problems that emerge at 50–500 engineers</p>
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

function Features() {
  const features = [
    { icon: BarChart3, title: 'Multi-account visibility', desc: 'Unified dashboard across all AWS accounts and regions. One pane of glass for your entire infrastructure.' },
    { icon: DollarSign, title: 'Cost allocation by team', desc: 'Tag-based cost attribution so every team owns their cloud spend. No more surprise bills.' },
    { icon: Shield, title: 'Policy enforcement', desc: 'Define and enforce security policies across all environments. Drift detection alerts you instantly.' },
    { icon: GitBranch, title: 'Deployment tracking', desc: 'DORA metrics measured automatically. Know your deployment frequency, lead time, and change failure rate.' },
    { icon: Server, title: 'Capacity planning', desc: 'Forecasted resource utilisation so you provision ahead of demand, not in reaction to it.' },
    { icon: Activity, title: 'Service dependency maps', desc: 'Auto-discovered dependency graphs updated in real time. Understand blast radius before you deploy.' },
  ];
  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Built for Your Growth Stage</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">The controls enterprise teams have — at a price scale-ups can actually afford</p>
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

function Comparison() {
  const rows = [
    { feature: 'Multi-account dashboard',  devcontrol: true,        others: false },
    { feature: 'Setup time',               devcontrol: '< 10 min',  others: '2–6 weeks' },
    { feature: 'Per-team cost allocation', devcontrol: true,        others: false },
    { feature: 'DORA metrics',             devcontrol: true,        others: false },
    { feature: 'Starting price',           devcontrol: '$199/mo',   others: '$1,000+/mo' },
    { feature: 'No agents required',       devcontrol: true,        others: false },
  ];
  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Why Scale-Ups Choose DevControl</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Enterprise features without enterprise complexity or pricing</p>
        </div>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-4 font-semibold">Feature</th>
                  <th className="text-center p-4 font-semibold text-primary">DevControl</th>
                  <th className="text-center p-4 font-semibold text-muted-foreground">Traditional Tools</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.feature} className="border-b last:border-0">
                    <td className="p-4 font-medium">{row.feature}</td>
                    <td className="p-4 text-center">
                      {typeof row.devcontrol === 'boolean'
                        ? row.devcontrol ? <Check className="w-5 h-5 text-green-500 mx-auto" /> : <X className="w-5 h-5 text-red-500 mx-auto" />
                        : <span className="font-semibold text-primary">{row.devcontrol}</span>}
                    </td>
                    <td className="p-4 text-center text-muted-foreground">
                      {typeof row.others === 'boolean'
                        ? row.others ? <Check className="w-5 h-5 text-green-500 mx-auto" /> : <X className="w-5 h-5 text-red-500 mx-auto" />
                        : row.others}
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

function CTA() {
  return (
    <section className="py-20 lg:py-28 bg-gradient-to-br from-primary/10 via-background to-primary/5">
      <div className="max-w-4xl mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-6">
          Ready to Scale With Confidence?
        </h2>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          Join hundreds of scale-up teams who use DevControl to grow their infrastructure without growing their toil.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-8">
          <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
            <Link href="/register">Start Free Trial <ArrowRight className="w-5 h-5" /></Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="px-8 h-12 text-base">
            <Link href="/pricing">See Pricing</Link>
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

export default function ScaleupsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <Stats />
      <Challenges />
      <Features />
      <Comparison />
      <CTA />
    </div>
  );
}
