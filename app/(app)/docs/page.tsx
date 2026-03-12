import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Book,
  Rocket,
  FileCode,
  HelpCircle,
  ArrowRight,
  Search,
  Terminal,
  Cloud,
  Shield,
  BarChart3,
  Layers,
  GitBranch,
  Bell,
  Users,
  Settings,
  ExternalLink,
  MessageCircle,
  FileText,
  Zap,
} from 'lucide-react';
import Link from 'next/link';

// ============================================
// HERO SECTION
// ============================================
function DocsHero() {
  return (
    <section className="bg-gradient-to-br from-primary/5 via-background to-primary/10 py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4">
            Documentation
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-8">
            Everything you need to get started with DevControl. Guides, tutorials, API references, and best practices.
          </p>

          {/* Search Bar */}
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search documentation..."
              className="w-full h-12 pl-12 pr-4 rounded-lg border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================
// QUICK START CARDS
// ============================================
function QuickStartSection() {
  const quickStart = [
    {
      title: 'Getting Started',
      description: 'Set up DevControl in under 5 minutes with our quickstart guide',
      icon: Rocket,
      href: '/docs/getting-started',
      badge: 'Start here',
    },
    {
      title: 'API Reference',
      description: 'Complete REST API documentation with examples',
      icon: FileCode,
      href: '/docs/api',
      badge: null,
    },
    {
      title: 'Integrations',
      description: 'Connect with AWS, GitHub, Slack, and more',
      icon: Zap,
      href: '/docs',
      badge: null,
    },
    {
      title: 'FAQ',
      description: 'Answers to frequently asked questions',
      icon: HelpCircle,
      href: '/docs',
      badge: null,
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickStart.map((item) => (
            <Link key={item.title} href={item.href}>
              <Card className="h-full hover:shadow-md transition-shadow group cursor-pointer">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                      <item.icon className="w-5 h-5 text-primary" />
                    </div>
                    {item.badge && (
                      <Badge variant="secondary" className="text-xs">{item.badge}</Badge>
                    )}
                  </div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {item.title}
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">{item.description}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// POPULAR TOPICS
// ============================================
function PopularTopicsSection() {
  const topics = [
    { title: 'Connect AWS Account', href: '/docs/getting-started', icon: Cloud },
    { title: 'Set Up Cost Alerts', href: '/docs', icon: Bell },
    { title: 'Configure RBAC', href: '/docs', icon: Users },
    { title: 'Security Scanning', href: '/docs', icon: Shield },
    { title: 'DORA Metrics Setup', href: '/app/dora-metrics', icon: BarChart3 },
    { title: 'Service Catalog', href: '/services', icon: Layers },
    { title: 'CI/CD Integration', href: '/docs', icon: GitBranch },
    { title: 'API Authentication', href: '/docs/api', icon: FileCode },
  ];

  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Popular Topics
          </h2>
          <p className="text-muted-foreground">
            Most frequently accessed documentation
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl mx-auto">
          {topics.map((topic) => (
            <Link key={topic.title} href={topic.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4 flex items-center gap-3">
                  <topic.icon className="w-5 h-5 text-primary shrink-0" />
                  <span className="text-sm font-medium">{topic.title}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// DOCUMENTATION CATEGORIES
// ============================================
function CategoriesSection() {
  const categories = [
    {
      title: 'Core Concepts',
      description: 'Understand the fundamentals of DevControl',
      icon: Book,
      links: [
        { title: 'What is DevControl?', href: '/docs' },
        { title: 'Architecture Overview', href: '/docs' },
        { title: 'Key Features', href: '/docs' },
        { title: 'Glossary', href: '/docs' },
      ],
    },
    {
      title: 'AWS Integration',
      description: 'Connect and manage your AWS infrastructure',
      icon: Cloud,
      links: [
        { title: 'IAM Role Setup', href: '/docs' },
        { title: 'Resource Discovery', href: '/docs' },
        { title: 'Multi-Account Setup', href: '/docs' },
        { title: 'Supported Services', href: '/docs' },
      ],
    },
    {
      title: 'Security & Compliance',
      description: 'Configure security scanning and compliance',
      icon: Shield,
      links: [
        { title: 'Security Checks', href: '/docs' },
        { title: 'Compliance Frameworks', href: '/docs' },
        { title: 'Custom Policies', href: '/docs' },
        { title: 'Remediation Guides', href: '/docs' },
      ],
    },
    {
      title: 'Cost Management',
      description: 'Optimize and track cloud spending',
      icon: BarChart3,
      links: [
        { title: 'Cost Analysis', href: '/docs' },
        { title: 'Budget Alerts', href: '/docs' },
        { title: 'Rightsizing', href: '/docs' },
        { title: 'Reserved Instances', href: '/docs' },
      ],
    },
    {
      title: 'Platform Engineering',
      description: 'Build your internal developer platform',
      icon: Layers,
      links: [
        { title: 'Service Catalog', href: '/docs' },
        { title: 'Golden Paths', href: '/docs' },
        { title: 'Self-Service Workflows', href: '/docs' },
        { title: 'DORA Metrics', href: '/docs' },
      ],
    },
    {
      title: 'Administration',
      description: 'Manage users, teams, and settings',
      icon: Settings,
      links: [
        { title: 'User Management', href: '/docs' },
        { title: 'Team Setup', href: '/docs' },
        { title: 'SSO Configuration', href: '/docs' },
        { title: 'Audit Logs', href: '/audit-logs' },
      ],
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Documentation by Category
          </h2>
          <p className="text-muted-foreground">
            Browse documentation organized by topic
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((category) => (
            <Card key={category.title} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <category.icon className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{category.title}</CardTitle>
                    <CardDescription className="text-xs">{category.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {category.links.map((link) => (
                    <li key={link.title}>
                      <Link
                        href={link.href}
                        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-2 group"
                      >
                        <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        {link.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// CODE EXAMPLES
// ============================================
function CodeExamplesSection() {
  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Quick Reference
          </h2>
          <p className="text-muted-foreground">
            Common commands and code snippets
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 max-w-5xl mx-auto">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal className="w-4 h-4 text-primary" />
                CLI Quick Start
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-background p-3 rounded-lg overflow-x-auto text-xs">
                <code className="text-muted-foreground">{`# Install CLI
npm install -g @devcontrol/cli

# Authenticate
devcontrol login

# Discover resources
devcontrol discover --aws`}</code>
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <FileCode className="w-4 h-4 text-primary" />
                API Request
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-background p-3 rounded-lg overflow-x-auto text-xs">
                <code className="text-muted-foreground">{`curl -X GET \\
  https://api.devcontrol.io/v1/services \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json"`}</code>
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Cloud className="w-4 h-4 text-primary" />
                AWS IAM Policy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-background p-3 rounded-lg overflow-x-auto text-xs">
                <code className="text-muted-foreground">{`{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ec2:Describe*"],
    "Resource": "*"
  }]
}`}</code>
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-primary" />
                GitHub Action
              </CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="bg-background p-3 rounded-lg overflow-x-auto text-xs">
                <code className="text-muted-foreground">{`- name: Record Deployment
  uses: devcontrol/deploy-action@v1
  with:
    api-key: \${{ secrets.DEVCONTROL_KEY }}
    service: my-service`}</code>
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}

// ============================================
// RESOURCES SECTION
// ============================================
function ResourcesSection() {
  const resources = [
    {
      title: 'Community Slack',
      description: 'Join 500+ DevControl users',
      icon: MessageCircle,
      href: '#',
      external: true,
    },
    {
      title: 'Changelog',
      description: 'See what\'s new in DevControl',
      icon: FileText,
      href: '/changelog',
      external: false,
    },
    {
      title: 'Status Page',
      description: 'Check system status',
      icon: BarChart3,
      href: '#',
      external: true,
    },
    {
      title: 'Contact Support',
      description: 'Get help from our team',
      icon: HelpCircle,
      href: '/contact',
      external: false,
    },
  ];

  return (
    <section className="py-12 lg:py-16">
      <div className="max-w-7xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Additional Resources
          </h2>
          <p className="text-muted-foreground">
            More ways to get help and stay updated
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          {resources.map((resource) => (
            <Link key={resource.title} href={resource.href} target={resource.external ? '_blank' : undefined}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full text-center">
                <CardContent className="p-4">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <resource.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-medium text-sm flex items-center justify-center gap-1">
                    {resource.title}
                    {resource.external && <ExternalLink className="w-3 h-3" />}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">{resource.description}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================
// CTA SECTION
// ============================================
function CTASection() {
  return (
    <section className="py-12 lg:py-16 bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-4">
          Can't Find What You're Looking For?
        </h2>
        <p className="text-muted-foreground max-w-xl mx-auto mb-6">
          Our team is here to help. Reach out and we'll get you pointed in the right direction.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild>
            <Link href="/contact">
              Contact Support
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <a href="mailto:support@devcontrol.io">
              Email Us
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}

// ============================================
// MAIN PAGE
// ============================================
export default function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <DocsHero />
      <QuickStartSection />
      <PopularTopicsSection />
      <CategoriesSection />
      <CodeExamplesSection />
      <ResourcesSection />
      <CTASection />
    </div>
  );
}
