import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DollarSign, ArrowRight, CheckCircle2, TrendingDown, BarChart3,
  Bell, PieChart, Target, Zap, Activity, FileText,
} from 'lucide-react';
import Link from 'next/link';

export default function CostOptimizationPage() {
  const features = [
    { icon: TrendingDown, title: 'AI waste detection',           desc: 'ML models continuously analyse usage patterns to surface idle instances, orphaned storage, unused load balancers, and oversized resources — ranked by savings.' },
    { icon: Target,       title: 'Rightsizing engine',           desc: 'Instance rightsizing recommendations based on 30-day CPU, memory, and network utilisation. One-click approval workflow for fast implementation.' },
    { icon: PieChart,     title: 'Cost allocation',              desc: 'Attribute every dollar to a team, service, or environment using tags. Automatic allocation for untagged resources using intelligent heuristics.' },
    { icon: BarChart3,    title: 'Spend forecasting',            desc: 'Predict next month\'s bill by account, service, and team. ML-powered forecasts trained on your historical spend patterns.' },
    { icon: Bell,         title: 'Budget alerting',              desc: 'Set budgets at any granularity — account, team, service, or tag. Get Slack and email alerts at 80% and 100% of budget thresholds.' },
    { icon: Activity,     title: 'Anomaly detection',            desc: 'Instant alerts when spend spikes unexpectedly. Surfaces the exact resource causing the anomaly within minutes of detection.' },
    { icon: FileText,     title: 'Savings reports',              desc: 'Monthly cost review reports showing savings achieved, top spenders, trends, and next actions. Shareable with finance and leadership.' },
    { icon: DollarSign,   title: 'Reserved Instance tracking',   desc: 'Utilisation and coverage reporting for all RIs and Savings Plans. Identify expiring commitments and recommend optimal renewal strategies.' },
    { icon: Zap,          title: 'Automated remediation',        desc: 'Optional auto-remediation policies that shut down idle dev environments on a schedule or right-size resources after team approval.' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20 lg:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-4xl mx-auto">
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">Platform · Cost Optimization</Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
              Reduce Cloud Spend by{' '}
              <span className="text-primary">Up to 42%</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
              DevControl's AI-powered cost optimisation engine continuously finds waste, recommends
              rightsizing, and gives every team visibility into their cloud spend — so savings happen
              every month, not just when someone runs an audit.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
              <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
                <Link href="/register">Start Free Trial <ArrowRight className="w-5 h-5" /></Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="px-8 h-12 text-base">
                <Link href="/pricing">View Pricing</Link>
              </Button>
            </div>
            <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
              {['Average 42% cost reduction', 'ROI positive in week 1', 'No code changes required'].map((t) => (
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

      {/* Stats */}
      <section className="py-14 border-b">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { value: '42%',  label: 'Average cost reduction',      icon: TrendingDown },
              { value: '$47K', label: 'Average annual savings',       icon: DollarSign },
              { value: '3 days', label: 'Time to first savings',      icon: Zap },
              { value: '500+', label: 'Teams saving with DevControl', icon: BarChart3 },
            ].map(({ value, label, icon: Icon }) => (
              <div key={label} className="flex flex-col items-center gap-2 p-6 rounded-xl bg-muted/50 text-center">
                <Icon className="w-6 h-6 text-primary" />
                <span className="text-3xl font-bold text-primary">{value}</span>
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 lg:py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">The Complete Cost Optimisation Toolkit</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">From detection to remediation — everything FinOps teams need in one place</p>
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

      {/* How it works */}
      <section className="py-16 lg:py-24 bg-muted/30">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Savings in 3 Steps</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Connect',  desc: 'Link your AWS account with read-only access. DevControl ingests your billing data and resource utilisation history.' },
              { step: '02', title: 'Discover', desc: 'AI scans your entire infrastructure to identify waste, rightsizing opportunities, and cost anomalies in under 24 hours.' },
              { step: '03', title: 'Save',     desc: 'Review prioritised recommendations with estimated savings. Implement with one click or route to the owning team.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center mx-auto mb-4 text-lg font-bold">{step}</div>
                <h3 className="text-xl font-bold mb-3">{title}</h3>
                <p className="text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-primary/10 via-background to-primary/5">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">
            Find Your First Savings in 24 Hours
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Connect DevControl to your AWS account and get a complete cost optimisation report by tomorrow.
          </p>
          <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
            <Link href="/register">Start Free Trial <ArrowRight className="w-5 h-5" /></Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
