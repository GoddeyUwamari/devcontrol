import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Shield, Lock, FileCheck, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            Security & Compliance
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Automated compliance scanning, security posture management, and
            continuous monitoring for SOC 2, HIPAA, and more.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-primary" />
                Compliance Scanning
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Automated scans for SOC 2, HIPAA, PCI-DSS, and custom frameworks.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Security Posture
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Real-time security scoring and vulnerability detection.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary" />
                Access Control
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Fine-grained RBAC with audit logging for all actions.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Button asChild size="lg" className="gap-2">
            <Link href="/audit-logs">
              View Audit Logs
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
