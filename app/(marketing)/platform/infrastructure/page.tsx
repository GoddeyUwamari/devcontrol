import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Server, ArrowRight, CheckCircle2, Search, GitBranch,
  Activity, RefreshCw, Shield, BarChart3, Layers, Cloud,
} from 'lucide-react';
import Link from 'next/link';

export default function InfrastructureManagementPage() {
  const features = [
    { icon: Search,      title: 'Instant resource discovery',  desc: 'Auto-discover every EC2, RDS, Lambda, ECS, S3, and 50+ other resource types across all AWS accounts and regions. Updated in real time.' },
    { icon: Layers,      title: 'Visual topology maps',        desc: 'Interactive dependency graphs show how every resource connects. Understand your architecture at a glance — no manual diagramming.' },
    { icon: RefreshCw,   title: 'Drift detection',             desc: 'Know the moment your actual infrastructure diverges from your Terraform or CDK definitions. Catch config drift before it causes incidents.' },
    { icon: GitBranch,   title: 'Change history',              desc: 'Full audit trail of every infrastructure change with who made it, when, and what changed. Essential for debugging and compliance.' },
    { icon: Activity,    title: 'Health monitoring',           desc: 'Real-time health status for every resource. Aggregate service health scores surface problems before your users notice them.' },
    { icon: Shield,      title: 'Tag governance',              desc: 'Enforce tagging standards across all resources. Auto-tag new resources by policy and report on untagged assets for cost and security.' },
  ];

  const awsServices = [
    'EC2', 'RDS', 'Lambda', 'ECS / EKS', 'S3', 'CloudFront',
    'VPC', 'IAM', 'CloudWatch', 'Route 53', 'ElastiCache', 'SQS / SNS',
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-primary/10 py-20 lg:py-28">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center max-w-4xl mx-auto">
            <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm">Platform · Infrastructure Management</Badge>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6 leading-tight">
              Complete Visibility Into{' '}
              <span className="text-primary">Your Entire Infrastructure</span>
            </h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed">
              Stop managing infrastructure blind. DevControl auto-discovers, maps, and monitors
              every cloud resource across all your AWS accounts — no agents, no manual inventory.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
              <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
                <Link href="/register">Start Free Trial <ArrowRight className="w-5 h-5" /></Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="px-8 h-12 text-base">
                <Link href="/docs">Read the Docs</Link>
              </Button>
            </div>
            <div className="flex flex-wrap justify-center items-center gap-6 text-sm text-muted-foreground">
              {['50+ AWS resource types', 'Multi-account & multi-region', 'Real-time updates'].map((t) => (
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

      {/* Features */}
      <section className="py-16 lg:py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Everything You Need to Manage Infrastructure at Scale</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">From discovery to governance — one unified platform</p>
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

      {/* AWS Coverage */}
      <section className="py-16 lg:py-24 bg-muted/30">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">50+ AWS Services Supported</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">Deep integration with the services your team actually uses</p>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4 mb-8">
            {awsServices.map((s) => (
              <div key={s} className="flex items-center justify-center p-4 rounded-xl bg-background border text-sm font-medium text-center h-14">
                {s}
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-muted-foreground">+ 40 more services including EKS, Redshift, OpenSearch, Glue, Step Functions, and more</p>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 lg:py-24">
        <div className="max-w-6xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">Up and Running in 5 Minutes</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Connect your AWS account', desc: 'Grant read-only IAM access using our CloudFormation template. No agents, no code changes, no complexity.' },
              { step: '02', title: 'Auto-discovery runs',      desc: 'DevControl scans all regions and accounts, builds your resource inventory, and constructs dependency maps automatically.' },
              { step: '03', title: 'Monitor & act',            desc: 'Get your live infrastructure dashboard with health monitoring, drift alerts, and change history from day one.' },
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
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-6">Know Your Infrastructure, Inside and Out</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            Connect your AWS account and get a complete infrastructure map in under 5 minutes.
          </p>
          <Button asChild size="lg" className="gap-2 px-8 h-12 text-base">
            <Link href="/register">Start Free Trial <ArrowRight className="w-5 h-5" /></Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
