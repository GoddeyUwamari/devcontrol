'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  FileCode,
  Key,
  Layers,
  Rocket,
  Server,
  Users,
  ArrowRight,
  Copy,
  Check,
  Code2,
  BookOpen,
  Zap,
  Shield,
  Globe,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Terminal,
  FileJson,
  Activity,
  Clock,
  Lock,
  MessageCircle,
} from 'lucide-react';
import Link from 'next/link';

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

export default function ApiReferencePage() {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const handleCopy = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const endpoints = [
    {
      title: 'Services API',
      description: 'Create, update, and manage services in your catalog',
      icon: Layers,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      baseUrl: '/api/services',
      examples: [
        {
          title: 'List discovered resources',
          method: 'GET',
          endpoint: '/api/services',
          description: 'Retrieve the discovered AWS resources in your organization',
        },
        {
          title: 'List registered services',
          method: 'GET',
          endpoint: '/api/services/registered',
          description: 'Retrieve the services registered in your catalog',
        },
        {
          title: 'Create a service',
          method: 'POST',
          endpoint: '/api/services',
          description: 'Register a new service in the catalog (organization owners and admins)',
        },
      ],
    },
    {
      title: 'Deployments API',
      description: 'Track and record deployment events',
      icon: Rocket,
      methods: ['GET', 'POST'],
      baseUrl: '/v1/deployments',
      examples: [
        {
          title: 'Record deployment',
          method: 'POST',
          endpoint: '/v1/deployments',
          description: 'Track a new deployment event',
        },
        {
          title: 'Get deployment history',
          method: 'GET',
          endpoint: '/v1/deployments',
          description: 'Retrieve deployment history',
        },
      ],
    },
    {
      title: 'Infrastructure API',
      description: 'Query and manage AWS resources',
      icon: Server,
      methods: ['GET', 'PUT'],
      baseUrl: '/v1/resources',
      examples: [
        {
          title: 'List resources',
          method: 'GET',
          endpoint: '/v1/resources',
          description: 'Get all discovered AWS resources',
        },
        {
          title: 'Update resource tags',
          method: 'PUT',
          endpoint: '/v1/resources/:id',
          description: 'Update metadata for a resource',
        },
      ],
    },
    {
      title: 'Teams API',
      description: 'Manage teams and memberships',
      icon: Users,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      baseUrl: '/v1/teams',
      examples: [
        {
          title: 'List teams',
          method: 'GET',
          endpoint: '/v1/teams',
          description: 'Get all teams in your organization',
        },
        {
          title: 'Create team',
          method: 'POST',
          endpoint: '/v1/teams',
          description: 'Create a new team',
        },
      ],
    },
    {
      title: 'Metrics API',
      description: 'Access DORA metrics and performance data',
      icon: Activity,
      methods: ['GET'],
      baseUrl: '/v1/metrics',
      examples: [
        {
          title: 'Get DORA metrics',
          method: 'GET',
          endpoint: '/v1/metrics/dora',
          description: 'Retrieve DORA metrics for your services',
        },
        {
          title: 'Get cost metrics',
          method: 'GET',
          endpoint: '/v1/metrics/costs',
          description: 'Access cost and spend data',
        },
      ],
    },
    {
      title: 'Webhooks API',
      description: 'Configure webhooks for event notifications',
      icon: Zap,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      baseUrl: '/v1/webhooks',
      examples: [
        {
          title: 'Create webhook',
          method: 'POST',
          endpoint: '/v1/webhooks',
          description: 'Register a new webhook endpoint',
        },
        {
          title: 'Test webhook',
          method: 'POST',
          endpoint: '/v1/webhooks/:id/test',
          description: 'Send a test event to webhook',
        },
      ],
    },
  ];

  const authExample = `curl -X GET https://api.getdevcontrol.com/api/services \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "Content-Type: application/json"`;

  // POST /api/services: body validated by createServiceSchema
  // (backend/src/validators/schemas.ts), answered 201 by ServicesController.create.
  const createServiceExample = `{
  "name": "payment-service",
  "template": "api",
  "owner": "owner@example.com",
  "team_id": "00000000-0000-4000-8000-000000000000",
  "github_url": "https://github.com/example-org/payment-service",
  "description": "Handles payment processing"
}`;

  const responseExample = `{
  "success": true,
  "data": {
    "id": "00000000-0000-4000-8000-000000000001",
    "name": "payment-service",
    "template": "api",
    "owner": "owner@example.com",
    "team_id": "00000000-0000-4000-8000-000000000000",
    "github_url": "https://github.com/example-org/payment-service",
    "status": "active",
    "description": "Handles payment processing",
    "metadata": {},
    "organization_id": "00000000-0000-4000-8000-000000000002",
    "created_at": "2026-01-15T10:30:00.000Z",
    "updated_at": "2026-01-15T10:30:00.000Z"
  },
  "message": "Service created successfully"
}`;

  // What validateBody (backend/src/middleware/validation.ts) answers with 400,
  // here for POST /api/services with an empty name.
  const errorExample = `{
  "success": false,
  "error": "Validation failed",
  "details": "name: Service name is required"
}`;

  const webhookExample = `{
  "event": "deployment.completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "deployment_id": "dep_5f6g7h8i",
    "service": "payment-service",
    "environment": "production",
    "status": "success",
    "duration_seconds": 120
  }
}`;

  return (
    <div className="min-h-screen bg-background py-8 md:py-12">
      <div className="max-w-7xl mx-auto px-6 lg:px-8 xl:px-12" style={{ paddingLeft: isMobile ? '16px' : isTablet ? '24px' : undefined, paddingRight: isMobile ? '16px' : isTablet ? '24px' : undefined }}>
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/20">
            <FileCode className="w-8 h-8 text-primary" />
          </div>

          <div className="flex items-center justify-center gap-3 mb-4">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground" style={{ fontSize: isMobile ? 'clamp(1.8rem,5vw,2.4rem)' : undefined }}>
              API Reference
            </h1>
            <Badge variant="secondary" className="text-sm">
              v1.0
            </Badge>
          </div>

          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto mb-6">
            Complete REST API documentation for DevControl. Build powerful integrations
            with your existing tools and workflows.
          </p>

          {/* Quick Links */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="default" className="gap-2">
              <Link href="/login">
                <Key className="w-4 h-4" />
                Sign In
              </Link>
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <a href="#authentication">
                <Lock className="w-4 h-4" />
                Authentication
              </a>
            </Button>
            <Button asChild variant="outline" className="gap-2">
              <a href="#endpoints">
                <Code2 className="w-4 h-4" />
                Endpoints
              </a>
            </Button>
          </div>
        </div>

        {/* Key Features */}
        <div className="grid md:grid-cols-3 gap-4 mb-12">
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Fast & Reliable</h3>
                  <p className="text-sm text-muted-foreground">
                    99.9% uptime SLA with response times under 100ms
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-green-500/20 bg-green-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                  <Shield className="w-5 h-5 text-green-600 dark:text-green-500" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Secure by Default</h3>
                  <p className="text-sm text-muted-foreground">
                    Requests use your access token and are limited to your organization and role
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                  <Globe className="w-5 h-5 text-blue-600 dark:text-blue-500" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">RESTful Design</h3>
                  <p className="text-sm text-muted-foreground">
                    Intuitive endpoints following REST best practices
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Base URL */}
        <Card className="mb-8 border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Base URL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4 bg-background p-3 rounded-lg border">
              <code className="text-sm font-mono text-foreground">
                https://api.getdevcontrol.com
              </code>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleCopy('https://api.getdevcontrol.com', 'base-url')}
              >
                {copiedCode === 'base-url' ? (
                  <Check className="w-4 h-4 text-green-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              All API requests should be made to this base URL. Append the endpoint path
              to construct the full URL.
            </p>
          </CardContent>
        </Card>

        {/* Authentication Section */}
        <div id="authentication" className="mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6 flex items-center gap-3" style={{ fontSize: isMobile ? 'clamp(1.5rem,4vw,2rem)' : undefined }}>
            <Key className="w-7 h-7 text-primary" />
            Authentication
          </h2>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">Access Token Authentication</CardTitle>
              <CardDescription>
                All API requests require authentication using a Bearer token in the
                Authorization header: the access token you get by signing in
                (POST /api/auth/login returns it as data.accessToken). It is valid for 7 days.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs md:text-sm border">
                  <code className="text-muted-foreground">{authExample}</code>
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCopy(authExample, 'auth')}
                  className="absolute top-2 right-2 gap-2"
                >
                  {copiedCode === 'auth' ? (
                    <>
                      <Check className="w-4 h-4 text-green-600" />
                      <span className="text-xs">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span className="text-xs">Copy</span>
                    </>
                  )}
                </Button>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-sm mb-1">Best Practices</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• Store access tokens securely (environment variables)</li>
                        <li>• Sign in again when a token expires (after 7 days)</li>
                        <li>• Requests act as you, with your organization and role</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-4">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-sm mb-1">Important</h4>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• Never commit tokens to version control</li>
                        <li>• Don&apos;t expose tokens in client-side code</li>
                        <li>• Treat a token like your password: anyone holding it can act as you</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                <Button asChild size="sm" className="gap-2" style={{ width: isMobile ? '100%' : undefined }}>
                  <Link href="/login">
                    <Key className="w-4 h-4" />
                    Sign In
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline" className="gap-2" style={{ width: isMobile ? '100%' : undefined }}>
                  <Link href="/docs/api">
                    <BookOpen className="w-4 h-4" />
                    Security Guide
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Rate Limiting */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                Rate Limiting
              </CardTitle>
              <CardDescription>
                API requests are rate limited to ensure service quality for all users.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4 mb-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-primary mb-1">1,000</div>
                  <div className="text-sm text-muted-foreground">requests/hour</div>
                  <Badge variant="secondary" className="mt-2">Free Plan</Badge>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-primary mb-1">10,000</div>
                  <div className="text-sm text-muted-foreground">requests/hour</div>
                  <Badge variant="secondary" className="mt-2">Pro Plan</Badge>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-primary mb-1">100,000</div>
                  <div className="text-sm text-muted-foreground">requests/hour</div>
                  <Badge variant="secondary" className="mt-2">Enterprise</Badge>
                </div>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <FileJson className="w-4 h-4" />
                  Rate Limit Headers
                </h4>
                <div className="space-y-1 text-sm text-muted-foreground font-mono">
                  <div>X-RateLimit-Limit: 1000</div>
                  <div>X-RateLimit-Remaining: 999</div>
                  <div>X-RateLimit-Reset: 1642348800</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* API Endpoints */}
        <div id="endpoints" className="mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6 flex items-center gap-3" style={{ fontSize: isMobile ? 'clamp(1.5rem,4vw,2rem)' : undefined }}>
            <Code2 className="w-7 h-7 text-primary" />
            API Endpoints
          </h2>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {endpoints.map((endpoint) => {
              const Icon = endpoint.icon;
              return (
                <Card key={endpoint.title} className="group hover:shadow-lg transition-all cursor-pointer">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {endpoint.methods.length} methods
                      </Badge>
                    </div>
                    <CardTitle className="text-lg group-hover:text-primary transition-colors">
                      {endpoint.title}
                    </CardTitle>
                    <CardDescription className="text-sm">
                      {endpoint.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-3">
                      <code className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                        {endpoint.baseUrl}
                      </code>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {endpoint.methods.map((method) => (
                        <Badge
                          key={method}
                          variant={
                            method === 'GET'
                              ? 'default'
                              : method === 'POST'
                              ? 'secondary'
                              : 'outline'
                          }
                          className={`text-xs ${
                            method === 'GET'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800'
                              : method === 'POST'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                              : method === 'PUT'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800'
                          }`}
                        >
                          {method}
                        </Badge>
                      ))}
                    </div>
                    <ul className="mt-4 space-y-2 border-t pt-4" aria-label={`${endpoint.title} examples`}>
                      {endpoint.examples.map((example) => (
                        <li key={`${example.method} ${example.endpoint} ${example.title}`} className="text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-semibold text-muted-foreground">{example.method}</span>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded break-all">{example.endpoint}</code>
                          </div>
                          <div className="font-medium mt-1">{example.title}</div>
                          <div className="text-xs text-muted-foreground">{example.description}</div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Example: Create Service */}
        <div className="mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6 flex items-center gap-3" style={{ fontSize: isMobile ? 'clamp(1.5rem,4vw,2rem)' : undefined }}>
            <Terminal className="w-7 h-7 text-primary" />
            Example: Create a Service
          </h2>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Request */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800">
                    POST
                  </Badge>
                  Request Body
                </CardTitle>
                <CardDescription>
                  Create a new service in your catalog. Organization owners and admins only.
                  name, template (api, frontend, worker or database), owner (an email) and
                  team_id (one of your organization&apos;s teams) are required; github_url and
                  description are optional.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs border max-h-80">
                    <code className="text-muted-foreground">{createServiceExample}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopy(createServiceExample, 'request')}
                    className="absolute top-2 right-2"
                  >
                    {copiedCode === 'request' ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Response */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800">
                    201
                  </Badge>
                  Response
                </CardTitle>
                <CardDescription>
                  Successful service creation response
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs border max-h-80">
                    <code className="text-muted-foreground">{responseExample}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopy(responseExample, 'response')}
                    className="absolute top-2 right-2"
                  >
                    {copiedCode === 'response' ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Error Handling */}
        <div className="mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6 flex items-center gap-3" style={{ fontSize: isMobile ? 'clamp(1.5rem,4vw,2rem)' : undefined }}>
            <AlertCircle className="w-7 h-7 text-primary" />
            Error Handling
          </h2>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-lg">HTTP Status Codes</CardTitle>
              <CardDescription>
                The API uses conventional HTTP status codes to indicate success or failure
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 shrink-0">
                      200
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">OK</div>
                      <div className="text-xs text-muted-foreground">
                        Request succeeded
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800 shrink-0">
                      201
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">Created</div>
                      <div className="text-xs text-muted-foreground">
                        Resource created successfully
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 shrink-0">
                      400
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">Bad Request</div>
                      <div className="text-xs text-muted-foreground">
                        Invalid request parameters
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 shrink-0">
                      401
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">Unauthorized</div>
                      <div className="text-xs text-muted-foreground">
                        Missing, invalid or expired access token
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 shrink-0">
                      403
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">Forbidden</div>
                      <div className="text-xs text-muted-foreground">
                        Insufficient permissions
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 shrink-0">
                      404
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">Not Found</div>
                      <div className="text-xs text-muted-foreground">
                        Resource doesn&apos;t exist
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 shrink-0">
                      429
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">Too Many Requests</div>
                      <div className="text-xs text-muted-foreground">
                        Rate limit exceeded
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 shrink-0">
                      500
                    </Badge>
                    <div>
                      <div className="font-medium text-sm">Internal Server Error</div>
                      <div className="text-xs text-muted-foreground">
                        Server-side error occurred
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Error Response Format</CardTitle>
              <CardDescription>
                All errors return a consistent JSON structure
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs border">
                  <code className="text-muted-foreground">{errorExample}</code>
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleCopy(errorExample, 'error')}
                  className="absolute top-2 right-2"
                >
                  {copiedCode === 'error' ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Webhooks */}
        <div className="mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6 flex items-center gap-3" style={{ fontSize: isMobile ? 'clamp(1.5rem,4vw,2rem)' : undefined }}>
            <Zap className="w-7 h-7 text-primary" />
            Webhooks
          </h2>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Event Notifications</CardTitle>
              <CardDescription>
                Receive real-time notifications when events occur in your DevControl account
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="font-semibold text-sm mb-3">Available Events</h4>
                <div className="grid md:grid-cols-2 gap-3">
                  {[
                    'deployment.completed',
                    'deployment.failed',
                    'service.created',
                    'service.updated',
                    'alert.triggered',
                    'cost.threshold_exceeded',
                    'security.issue_detected',
                    'resource.discovered',
                  ].map((event) => (
                    <div
                      key={event}
                      className="flex items-center gap-2 text-sm p-2 bg-muted rounded"
                    >
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      <code className="text-xs">{event}</code>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-sm mb-3">Webhook Payload Example</h4>
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs border">
                    <code className="text-muted-foreground">{webhookExample}</code>
                  </pre>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCopy(webhookExample, 'webhook')}
                    className="absolute top-2 right-2"
                  >
                    {copiedCode === 'webhook' ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>

              <Button asChild className="gap-2">
                <Link href="/settings/webhooks">
                  <Zap className="w-4 h-4" />
                  Configure Webhooks
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* SDKs & Tools */}
        <div className="mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6 flex items-center gap-3" style={{ fontSize: isMobile ? 'clamp(1.5rem,4vw,2rem)' : undefined }}>
            <Code2 className="w-7 h-7 text-primary" />
            SDKs & Libraries
          </h2>

          <div className="grid md:grid-cols-3 gap-4 mb-6">
            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-primary" />
                  Node.js SDK
                </CardTitle>
                <CardDescription>
                  Official JavaScript/TypeScript library
                </CardDescription>
              </CardHeader>
              <CardContent>
                <code className="text-xs bg-muted px-2 py-1 rounded block mb-3">
                  npm install @devcontrol/sdk
                </code>
                <Button asChild size="sm" variant="outline" className="w-full gap-2">
                  <a href="/docs" target="_blank" rel="noopener noreferrer">
                    <BookOpen className="w-4 h-4" />
                    View Docs
                    <ExternalLink className="w-3 h-3" />
                    <span style={{ fontSize: '10px', color: '#94A3B8' }}>(coming soon)</span>
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-primary" />
                  Python SDK
                </CardTitle>
                <CardDescription>
                  Official Python client library
                </CardDescription>
              </CardHeader>
              <CardContent>
                <code className="text-xs bg-muted px-2 py-1 rounded block mb-3">
                  pip install devcontrol
                </code>
                <Button asChild size="sm" variant="outline" className="w-full gap-2">
                  <a href="/docs" target="_blank" rel="noopener noreferrer">
                    <BookOpen className="w-4 h-4" />
                    View Docs
                    <ExternalLink className="w-3 h-3" />
                    <span style={{ fontSize: '10px', color: '#94A3B8' }}>(coming soon)</span>
                  </a>
                </Button>
              </CardContent>
            </Card>

            <Card className="hover:shadow-md transition-shadow">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Terminal className="w-5 h-5 text-primary" />
                  CLI Tool
                </CardTitle>
                <CardDescription>
                  Command-line interface for DevControl
                </CardDescription>
              </CardHeader>
              <CardContent>
                <code className="text-xs bg-muted px-2 py-1 rounded block mb-3">
                  npm install -g @devcontrol/cli
                </code>
                <Button asChild size="sm" variant="outline" className="w-full gap-2">
                  <Link href="/docs">
                    <BookOpen className="w-4 h-4" />
                    View Docs
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* FAQs */}
        <div className="mb-12">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-6 flex items-center gap-3" style={{ fontSize: isMobile ? 'clamp(1.5rem,4vw,2rem)' : undefined }}>
            <BookOpen className="w-7 h-7 text-primary" />
            Frequently Asked Questions
          </h2>

          <Card>
            <CardContent className="pt-6">
              <Accordion type="single" collapsible className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger className="hover:no-underline">
                    How do I get started with the API?
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    First, sign in to get an access token (POST /api/auth/login returns it as
                    data.accessToken). Then, include it in the Authorization header of your
                    requests. Check out our Getting Started guide for a complete walkthrough.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-2">
                  <AccordionTrigger className="hover:no-underline">
                    Is there a sandbox environment for testing?
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    Yes! Use your access token with{' '}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">
                      https://api.getdevcontrol.com
                    </code>{' '}
                    and test data to explore the API safely before going live.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-3">
                  <AccordionTrigger className="hover:no-underline">
                    What happens if I exceed rate limits?
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    You&apos;ll receive a 429 Too Many Requests response. The
                    X-RateLimit-Reset header tells you when your limit resets. Implement
                    exponential backoff in your client to handle this gracefully.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-4">
                  <AccordionTrigger className="hover:no-underline">
                    Are there any API usage limits?
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    Rate limits vary by plan. Free tier: 500 requests/hour, Pro: 10,000
                    requests/hour, Enterprise: 100,000 requests/hour. Contact us for custom
                    limits.
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="item-5">
                  <AccordionTrigger className="hover:no-underline">
                    How do I handle pagination?
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    List endpoints return paginated results. Use the{' '}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">limit</code> and{' '}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">offset</code>{' '}
                    query parameters. The response includes{' '}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">total</code>,{' '}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">has_more</code>,
                    and <code className="bg-muted px-1 py-0.5 rounded text-xs">next</code>{' '}
                    fields.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>
        </div>

        {/* Support CTA */}
        <Card className="bg-gradient-to-r from-primary/10 via-primary/5 to-background border-primary/20">
          <CardContent className="pt-6">
            <div className="text-center max-w-2xl mx-auto">
              <h3 className="text-xl md:text-2xl font-bold mb-3">
                Need Help with Integration?
              </h3>
              <p className="text-muted-foreground mb-6">
                Our team is here to help you build powerful integrations. Get in touch for
                technical support, custom solutions, or partnership opportunities.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3" style={{ flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center' }}>
                <Button asChild size="lg" className="gap-2" style={{ width: isMobile ? '100%' : undefined }}>
                  <a href="mailto:support@getdevcontrol.com">
                    <MessageCircle className="w-4 h-4" />
                    Contact API Support
                  </a>
                </Button>
                <Button asChild size="lg" variant="outline" className="gap-2" style={{ width: isMobile ? '100%' : undefined }}>
                  <Link href="/docs">
                    <BookOpen className="w-4 h-4" />
                    Browse Documentation
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
