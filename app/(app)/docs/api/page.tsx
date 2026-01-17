import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileCode, Key, Layers, Rocket, Server, Users, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function ApiReferencePage() {
  const endpoints = [
    {
      title: 'Services API',
      description: 'Create, update, and manage services in your catalog',
      icon: Layers,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
    {
      title: 'Deployments API',
      description: 'Track and record deployment events',
      icon: Rocket,
      methods: ['GET', 'POST'],
    },
    {
      title: 'Infrastructure API',
      description: 'Manage infrastructure resources',
      icon: Server,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
    {
      title: 'Teams API',
      description: 'Manage teams and memberships',
      icon: Users,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
    },
  ];

  return (
    <div className="min-h-screen bg-background py-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <FileCode className="w-8 h-8 text-primary" />
          </div>

          <h1 className="text-4xl font-bold text-foreground mb-4">
            API Reference
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Complete REST API documentation for DevControl. Integrate with your
            existing tools and workflows.
          </p>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              Authentication
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              All API requests require authentication using an API key passed in the header:
            </p>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
              <code>{`Authorization: Bearer YOUR_API_KEY`}</code>
            </pre>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {endpoints.map((endpoint) => {
            const Icon = endpoint.icon;
            return (
              <Card key={endpoint.title} className="group hover:shadow-md transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>
                    {endpoint.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="mb-3">{endpoint.description}</CardDescription>
                  <div className="flex gap-2">
                    {endpoint.methods.map((method) => (
                      <span
                        key={method}
                        className={`px-2 py-0.5 text-xs font-medium rounded ${
                          method === 'GET' ? 'bg-green-100 text-green-700' :
                          method === 'POST' ? 'bg-blue-100 text-blue-700' :
                          method === 'PUT' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}
                      >
                        {method}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="text-center">
          <Button asChild size="lg" className="gap-2">
            <Link href="/settings/profile">
              Get API Key
              <ArrowRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
