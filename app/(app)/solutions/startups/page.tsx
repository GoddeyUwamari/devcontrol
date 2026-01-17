import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Zap, Users, TrendingUp, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function StartupsPage() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Zap className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            DevControl for Startups
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Move fast without breaking things. DevControl helps teams of 5-20 engineers
            ship faster while maintaining visibility across your infrastructure.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Small Teams
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Perfect for teams of 5-20 engineers who need visibility without overhead.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-primary" />
                Fast Setup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Get started in under 5 minutes. No complex configuration required.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Scale Ready
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Grow from startup to enterprise without changing tools.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Button asChild size="lg" className="gap-2">
            <Link href="/dashboard">
              Get Started
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
