import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, TrendingDown, PieChart, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function CostOptimizationPage() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <DollarSign className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            Cloud Cost Optimization
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Reduce your AWS spend by 15-30% with intelligent cost analysis,
            rightsizing recommendations, and automated optimization.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-primary" />
                15-30% Savings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Average customers save 15-30% on their monthly cloud bills.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PieChart className="w-5 h-5 text-primary" />
                Cost Allocation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Track costs by team, service, or project with automatic tagging.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-primary" />
                Rightsizing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                AI-powered recommendations to rightsize your infrastructure.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Button asChild size="lg" className="gap-2">
            <Link href="/infrastructure/recommendations">
              View Recommendations
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
