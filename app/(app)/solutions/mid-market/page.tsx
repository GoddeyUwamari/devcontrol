import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building, Users, Shield, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function MidMarketPage() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Building className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            DevControl for Mid-Market
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Scale your engineering organization with confidence. Perfect for teams
            of 20-100 engineers who need robust tooling without enterprise complexity.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Team Collaboration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Multi-team support with role-based access control and ownership tracking.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Compliance Ready
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                SOC 2, HIPAA, and GDPR compliance features built-in.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building className="w-5 h-5 text-primary" />
                Cost Control
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Track and optimize cloud costs across all your infrastructure.
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
