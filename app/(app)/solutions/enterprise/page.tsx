import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, Shield, Clock, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function EnterprisePage() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Building2 className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            DevControl for Enterprise
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Enterprise-grade infrastructure management for teams of 100+ engineers.
            Advanced security, compliance, and dedicated support.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Enterprise Security
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                SSO, SCIM provisioning, advanced audit logging, and custom security policies.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                24/7 Support
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Dedicated success manager and 24/7 priority support with guaranteed SLAs.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                Custom Deployment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Private cloud, on-premise, or hybrid deployment options available.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Button asChild size="lg" className="gap-2">
            <Link href="/dashboard">
              Contact Sales
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
