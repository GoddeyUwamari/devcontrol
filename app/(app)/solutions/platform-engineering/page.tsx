import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Server, Layers, GitBranch, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function PlatformEngineeringPage() {
  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Server className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            Platform Engineering
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Build your internal developer platform with DevControl. Service catalogs,
            self-service infrastructure, and golden paths for your engineering teams.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-primary" />
                Service Catalog
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Unified view of all services with ownership, dependencies, and documentation.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="w-5 h-5 text-primary" />
                Golden Paths
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Standardized templates and workflows for common engineering tasks.
              </CardDescription>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5 text-primary" />
                Self-Service
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Enable developers to provision infrastructure without tickets.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        <div className="text-center">
          <Button asChild size="lg" className="gap-2">
            <Link href="/services">
              View Service Catalog
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
