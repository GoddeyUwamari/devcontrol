import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DollarSign, ArrowRight, CheckCircle2, TrendingDown,
  BarChart3, Users, Zap, PieChart, Target, Bell,
  FileText, Server, Activity,
} from 'lucide-react';
import Link from 'next/link';

function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20 lg:py-28">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-4xl mx-auto">
          <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">
            For FinOps practitioners & cloud finance teams
          </Badge>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
            Cut Cloud Spend.{' '}
            <span className="text-primary">Without Cutting Velocity.</span>
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
            DevControl gives FinOps teams the visibility, attribution, and automation they need to
            reduce cloud costs by up to 40% — without slowing down engineering.
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
            {['Average 42% cost reduction', 'ROI positive in week 1', 'No engineering required to start'].map((t) => (
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

function ROIStats() {
  const stats = [
    { value: '42%', label: 'Average cloud cost reduction',     icon: TrendingDown },
    { value: '$47K', label: 'Average annual savings per team', icon: DollarSign },
    { value: '3 days', label: 'Time to first savings finding',  icon: Zap },
    { value: '100%', label: 'Coverage across AWS accounts',    icon: Server },
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
    {
      icon: PieChart,
      title: 'Cost allocation & showback',
      desc: 'Automatically allocate cloud costs to teams, products, and environments using tags and service ownership. Send weekly cost reports to each team.',
    },
    {
      icon: TrendingDown,
      title: 'AI waste detection',
      desc: 'Continuously identify idle resources, oversized instances, unused reserved capacity, and orphaned storage. Prioritised by savings impact.',
    },
    {
      icon: Target,
      title: 'Rightsizing recommendations',
      desc: 'ML-powered instance rightsizing based on 30-day utilisation data. One-click approval workflow for teams to implement recommendations.',
    },
    {
      icon: BarChart3,
      title: 'Cost forecasting',
      desc: 'Predict next month\'s cloud bill by account, service, and team. Get alerted when forecasts deviate from budget by more than your defined threshold.',
    },
    {
      icon: Bell,
      title: 'Budget alerts',
      desc: 'Set per-team, per-service, and per-account budgets. Receive Slack or email alerts at 80% and 100% thresholds before bills surprise you.',
    },
    {
      icon: FileText,
      title: 'Executive cost reports',
      desc: 'Automated monthly cost review reports with trends, top movers, and savings achieved. Ready to share with CFO or board in one click.',
    },
    {
      icon: Activity,
      title: 'Anomaly detection',
      desc: 'Instant alerts when spend spikes unexpectedly. ML baselines detect abnormal patterns and surface root-cause resources within minutes.',
    },
    {
      icon: Users,
      title: 'Team cost accountability',
      desc: 'Make every team aware of and accountable for their cloud spend. FinOps culture built in — not bolted on.',
    },
    {
      icon: DollarSign,
      title: 'Reserved & savings plans',
      desc: 'Utilisation tracking for all Reserved Instances and Savings Plans. Identify coverage gaps and recommend optimal commitment levels.',
    },
  ];
  return (
    <section className="py-16 lg:py-24">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Every FinOps Capability in One Platform</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From waste detection to chargeback reporting — DevControl covers the full FinOps lifecycle
          </p>
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

function FinOpsFramework() {
  const phases = [
    { phase: 'Inform',    desc: 'Full cost visibility across all teams, services, and AWS accounts with auto-tagging and allocation.',     step: '01' },
    { phase: 'Optimise',  desc: 'AI-generated rightsizing, waste removal, and reserved instance recommendations — ranked by ROI.',        step: '02' },
    { phase: 'Operate',   desc: 'Budget enforcement, anomaly alerting, and automated cost reports keep FinOps running continuously.',     step: '03' },
  ];
  return (
    <section className="py-16 lg:py-24 bg-muted/30">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Aligned to the FinOps Framework</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            DevControl supports every phase of the FinOps lifecycle out of the box
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {phases.map(({ phase, desc, step }) => (
            <Card key={phase} className="relative overflow-hidden">
              <div className="absolute top-4 right-4 text-6xl font-black text-primary/5">{step}</div>
              <CardHeader>
                <Badge variant="secondary" className="w-fit mb-2">Phase {step}</Badge>
                <CardTitle className="text-2xl text-primary">{phase}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-base leading-relaxed">{desc}</CardDescription>
              </CardContent>
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
          Start Saving on Day One
        </h2>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          Connect DevControl to your AWS account and get your first cost optimisation report within 24 hours.
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
          {['14-day free trial', 'Average ROI in first week', 'Cancel anytime'].map((t) => (
            <div key={t} className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" /><span>{t}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function FinOpsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <ROIStats />
      <Features />
      <FinOpsFramework />
      <CTA />
    </div>
  );
}
